/**
 * Golden scenario — tdd@1 feature end-to-end on fakes.
 *
 * Story 001 T2 (Epic 010).
 *
 * Drives the golden fixture (feat-001: task-alpha → api-spec → task-beta,
 * task-gamma parallel, 2-stage deploy chain) through the Epic 001–009 public
 * seams: compile → scheduler pollOnce + setTaskStatus → artifact handoff →
 * TddWorkflow gate pair → scheduler-driven deploy. All I/O is on fixture.store and
 * fixture.clock; the no-network guard must never fire.
 */

import type { HarnessFixture } from "./harness.ts";
import { compile } from "../compiler/compile.ts";
import {
  markExitGatePassed,
  setTaskStatus,
  loadTasks,
} from "../scheduler/dispatch.ts";
import { initSchema } from "../store/schema.ts";
import { TddWorkflow } from "../workflow/tdd-workflow.ts";
import type { GateOutcome, GateResultSink } from "../workflow/workflow.ts";
import {
  publishArtifact,
  consumeArtifact,
} from "../workflow/artifact-gates.ts";
import type { ArtifactRegistry } from "../workflow/artifact-gates.ts";
import type { HandlerMap } from "../deploy/chain.ts";
import { LeaseManager } from "../scheduler/leases.ts";
import type { Capability } from "../scheduler/leases.ts";
import { pollOnce } from "../scheduler/poll.ts";
import { park, resume } from "../scheduler/blocked-on.ts";
import { submit, getInFlightOp } from "../broker/submit.ts";
import { startPolling } from "../broker/poller.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "../broker/registry.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GoldenResult = {
  status: "complete";
  brokerCompletionStatus: string;
  brokerCompletionResultJson: string | null;
  schedulerWakeupTaskIds: string[];
  deployDispatches: Array<{ taskId: string; outcome?: "pass" | "halt" }>;
  deployEvents: Array<{ event: string; stageId: string }>;
};

// ---------------------------------------------------------------------------
// Golden fixture file contents
// (mirrors compile.test.ts golden fixture — feat-001, 3 tasks, 2-stage deploy)
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-001
repo: backend
ticket_system: jira
ticket: JIRA-100
deploy_chain:
  - stage: staging
    handlers:
      - run: ./deploy.sh staging
    success_criteria: smoke tests pass
    soak_duration: 1h
  - stage: production
    handlers:
      - run: ./deploy.sh prod
    success_criteria: metrics normal
    soak_duration: 24h
---

## Acceptance

Feature is complete when all tasks pass TDD gates.
`;

const TASK_ALPHA_MD = `---
id: task-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-101
outputs:
  - api-spec
artifacts_out:
  - id: api-spec
    kind: api
    path: api/spec.yaml
---

## Prerequisites

echo "setup api env"

## Inputs

Nothing required.

## Outputs

- api-spec

## Tests

Unit tests for the API spec.
`;

const TASK_BETA_MD = `---
id: task-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-102
depends_on:
  - task: task-alpha
    output: api-spec
    semantics: frozen
---

## Prerequisites

echo "setup beta env"

## Inputs

api-spec from task-alpha.

## Outputs

beta-output

## Tests

Integration tests for beta.
`;

const TASK_GAMMA_MD = `---
id: task-gamma
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-103
write_scope:
  - lib/other/
---

## Prerequisites

echo "setup gamma env"

## Inputs

Nothing.

## Outputs

gamma-output

## Tests

Unit tests for gamma.
`;

const COMPILE_OPTS = { repoRegistry: ["backend"] };

const BROKER_SUCCESS_ENTRY: VerbRegistryEntry = {
  verb: "golden-success-verb",
  tier: "auto",
  timeout: 60_000,
  idempotency: { window_ms: 0 },
  retry: { max: 3, backoff: "linear" },
  poll_interval: 1_000,
  terminal_states: ["done"],
  rate_limit: { requests_per_minute: 60 },
  observed_state_can_regress: false,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Minimal no-op gate result sink for the golden scenario. */
class NoopSink implements GateResultSink {
  record(_phase: string, _outcome: GateOutcome): void {
    // golden scenario does not persist gate results
  }
}

/** Minimal in-memory artifact registry. */
class InMemoryArtifactRegistry implements ArtifactRegistry {
  private readonly items = new Map<
    string,
    { contentHash: string; status: "published" | "draft" }
  >();

  publish(artifactId: string, contentHash: string): void {
    this.items.set(artifactId, { contentHash, status: "published" });
  }

  lookup(
    artifactId: string,
  ): { contentHash: string; status: "published" | "draft" } | undefined {
    return this.items.get(artifactId);
  }
}

/** Drive one task through both tdd@1 gate phases, both passing. */
async function runTaskWorkflow(sink: GateResultSink): Promise<void> {
  const wf = new TddWorkflow(
    { failing_test_exists: "pass", tests_pass: "pass" },
    sink,
  );
  await wf.gateCheck("failing_test_exists");
  await wf.gateCheck("tests_pass");
}

function liveCompileHash(fixture: HarnessFixture, featureId: string): string {
  const row = fixture.store.get<{ compile_hash: string }>(
    "SELECT compile_hash FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
    featureId,
  );
  if (row === undefined) {
    throw new Error(`runGoldenScenario: no compiled generation for ${featureId}`);
  }
  return row.compile_hash;
}

async function exerciseSuccessfulBrokerWakeup(
  fixture: HarnessFixture,
  lm: LeaseManager,
): Promise<{
  completionStatus: string;
  completionResultJson: string | null;
  wakeupTaskIds: string[];
}> {
  const adapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => "golden-req-success-001",
    poll_status: async (_requestId: unknown) => ({
      status: "done",
      result: { ok: true },
    }),
    reconcile: async (_ledger: unknown) => null,
  };
  const capability: Capability = {
    kind: "resource",
    key: "golden-broker-success",
  };

  const opId = await submit(
    BROKER_SUCCESS_ENTRY,
    adapter,
    { taskId: "task-alpha" },
    "golden-success-001",
    fixture.store,
  );
  const op = getInFlightOp(opId, fixture.store);
  if (op === undefined) {
    throw new Error("runGoldenScenario: in-flight broker op not found");
  }

  if (!lm.acquire("task-alpha", [capability])) {
    throw new Error("runGoldenScenario: could not acquire broker wakeup capability");
  }
  setTaskStatus(fixture.store, "task-alpha", "running");
  park(fixture.store, "task-alpha", opId, [capability], lm);

  startPolling(op, BROKER_SUCCESS_ENTRY, adapter, fixture.store, fixture.clock);
  fixture.clock.advance(BROKER_SUCCESS_ENTRY.poll_interval);
  await Promise.resolve();

  const completion = fixture.store.get<{
    status: string;
    result_json: string | null;
  }>(
    "SELECT status, result_json FROM broker_completion WHERE op_id = ?",
    opId,
  );
  const contexts = resume(fixture.store, "feat-001", lm);

  return {
    completionStatus: completion?.status ?? "",
    completionResultJson: completion?.result_json ?? null,
    wakeupTaskIds: contexts.map((ctx) => ctx.taskId),
  };
}

// ---------------------------------------------------------------------------
// runGoldenScenario — public entry point
// ---------------------------------------------------------------------------

/**
 * Run the golden tdd@1 feature end-to-end on the provided harness fixture.
 *
 * Wave ordering:
 *   Wave 1 — task-alpha (root; no task predecessors)
 *   Wave 2 — task-beta + task-gamma (task-alpha predecessor passed; parallel)
 *   Broker  — fake successful async op parks task-alpha, writes a completion
 *             row, then scheduler resume wakes task-alpha.
 *   Deploy  — pollOnce dispatches staging + production through scheduler
 *             lifecycle; passing gates unblock the next stage.
 */
export async function runGoldenScenario(
  fixture: HarnessFixture,
): Promise<GoldenResult> {
  const featureDir = await mkdtemp(join(tmpdir(), "kgolden-"));
  try {
    // -----------------------------------------------------------------------
    // 1. Write golden fixture files into temp feature dir
    // -----------------------------------------------------------------------
    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");

    const storyA = join(featureDir, "001-story-a");
    await mkdir(storyA);
    await writeFile(join(storyA, "INDEX.md"), "# Story A\n");
    await writeFile(join(storyA, "001-task-alpha.md"), TASK_ALPHA_MD);

    const storyB = join(featureDir, "002.1-story-b");
    await mkdir(storyB);
    await writeFile(join(storyB, "INDEX.md"), "# Story B\n");
    await writeFile(join(storyB, "001-task-beta.md"), TASK_BETA_MD);

    const storyC = join(featureDir, "002.2-story-c");
    await mkdir(storyC);
    await writeFile(join(storyC, "INDEX.md"), "# Story C\n");
    await writeFile(join(storyC, "001-task-gamma.md"), TASK_GAMMA_MD);

    // -----------------------------------------------------------------------
    // 2. Compile the feature plan into fixture.store
    // -----------------------------------------------------------------------
    await compile(featureDir, fixture.store, COMPILE_OPTS);

    // -----------------------------------------------------------------------
    // 3. Initialise all subsystem schemas, then scheduler rows (INSERT OR IGNORE).
    // -----------------------------------------------------------------------
    initSchema(fixture.store);
    loadTasks(fixture.store, "feat-001");

    const liveHash = liveCompileHash(fixture, "feat-001");
    const lm = new LeaseManager(fixture.store, fixture.clock);

    // -----------------------------------------------------------------------
    // 4. Shared scenario state
    // -----------------------------------------------------------------------
    const registry = new InMemoryArtifactRegistry();
    const sink = new NoopSink();
    const taskCapabilities = new Map<string, Capability[]>();

    const brokerWakeup = await exerciseSuccessfulBrokerWakeup(fixture, lm);

    // -----------------------------------------------------------------------
    // 5. Wave 1 — task-alpha
    //    task-alpha has no task/deploy-stage predecessors → dispatchable first.
    //    task-beta and task-gamma each have a grammar edge from task-alpha
    //    (major 1 → major 2), so they wait for task-alpha's exit gate.
    // -----------------------------------------------------------------------
    const w1 = pollOnce(
      fixture.store,
      "feat-001",
      liveHash,
      lm,
      taskCapabilities,
    );
    const alphaTask = w1.find((t) => t.taskId === "task-alpha");
    if (alphaTask !== undefined) {
      await runTaskWorkflow(sink);
      await publishArtifact({
        taskId: "task-alpha",
        artifactId: "api-spec",
        content: "openapi: 3.0.0\ninfo:\n  title: API Spec\n  version: 0.1.0\n",
        registry,
        sink,
      });
      markExitGatePassed(fixture.store, "task-alpha");
      setTaskStatus(fixture.store, "task-alpha", "complete");
    }

    // -----------------------------------------------------------------------
    // 6. Wave 2 — task-beta + task-gamma (task-alpha predecessor now passed)
    //    Process both; task-beta additionally consumes the api-spec artifact.
    // -----------------------------------------------------------------------
    const w2 = pollOnce(
      fixture.store,
      "feat-001",
      liveHash,
      lm,
      taskCapabilities,
    ).filter(
      (t) => t.taskId === "task-beta" || t.taskId === "task-gamma",
    );
    for (const task of w2) {
      if (task.taskId === "task-beta") {
        const entry = registry.lookup("api-spec");
        await consumeArtifact({
          taskId: "task-beta",
          artifactId: "api-spec",
          expectedHash: entry?.contentHash ?? "",
          edgeKind: "frozen",
          registry,
          sink,
        });
      }
      await runTaskWorkflow(sink);
      markExitGatePassed(fixture.store, task.taskId);
      setTaskStatus(fixture.store, task.taskId, "complete");
    }

    // -----------------------------------------------------------------------
    // 7. Deploy chain — both stages via scheduler pollOnce lifecycle.
    //    Handlers use "run" key (not "observer"), so handler gate is a no-op,
    //    and unsupported soak strings parse to 0 ms. Passing gates still unblock
    //    the next deploy stage through scheduler state, not manual completion.
    // -----------------------------------------------------------------------
    const emptyHandlers: HandlerMap = new Map();
    const deployEvents: Array<{ event: string; stageId: string }> = [];
    const onEvent = (event: string, ctx: Record<string, unknown>): void => {
      deployEvents.push({ event, stageId: String(ctx["stageId"] ?? "") });
    };
    const deployDispatches = [
      ...(await pollOnce(fixture.store, "feat-001", liveHash, lm, taskCapabilities, {
        handlers: emptyHandlers,
        clock: fixture.clock,
        onEvent,
      })),
      ...(await pollOnce(fixture.store, "feat-001", liveHash, lm, taskCapabilities, {
        handlers: emptyHandlers,
        clock: fixture.clock,
        onEvent,
      })),
    ];

    return {
      status: "complete",
      brokerCompletionStatus: brokerWakeup.completionStatus,
      brokerCompletionResultJson: brokerWakeup.completionResultJson,
      schedulerWakeupTaskIds: brokerWakeup.wakeupTaskIds,
      deployDispatches,
      deployEvents,
    };
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
}
