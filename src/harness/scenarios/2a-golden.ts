/**
 * 2A golden scenario — tdd@1 feature end-to-end on 2A bricks.
 * Story 001 T1 (Epic 019).
 *
 * Wires: real GitStore (Epic 012) commits feature files into the git-backed
 * store root; fixture.store (SQLite) carries all scheduler/broker state as
 * in the Phase-1 golden. GithubHttpSeam and FakePiSurface are accepted at the
 * seam and will be wired in the T2 security scenarios.
 */

import type { FakeClock } from "../../foundations/clock.ts";
import type { Store } from "../../foundations/sqlite-store.ts";
import type { GitStore } from "../../store/git-store.ts";
import type { GithubHttpSeam } from "../../broker/verbs/github-create-pr.ts";
import { makeCreatePrAdapter } from "../../broker/verbs/github-create-pr.ts";
import { makePushAdapter } from "../../broker/verbs/git-push.ts";
import type { FakePiSurface } from "../../agent/pi-session.ts";
import { compile } from "../../compiler/compile.ts";
import {
  markExitGatePassed,
  setTaskStatus,
  loadTasks,
} from "../../scheduler/dispatch.ts";
import { initSchema } from "../../store/schema.ts";
import { TddWorkflow } from "../../workflow/tdd-workflow.ts";
import type { GateOutcome, GateResultSink } from "../../workflow/workflow.ts";
import {
  publishArtifact,
  consumeArtifact,
} from "../../workflow/artifact-gates.ts";
import type { ArtifactRegistry } from "../../workflow/artifact-gates.ts";
import type { HandlerMap } from "../../deploy/chain.ts";
import { LeaseManager } from "../../scheduler/leases.ts";
import type { Capability } from "../../scheduler/leases.ts";
import { pollOnce } from "../../scheduler/poll.ts";
import { park, resume } from "../../scheduler/blocked-on.ts";
import { submit, getInFlightOp } from "../../broker/submit.ts";
import { startPolling } from "../../broker/poller.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "../../broker/registry.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { GoldenResult } from "../golden.ts";
import type { GoldenResult } from "../golden.ts";

export type Run2aGoldenFixture = {
  clock: FakeClock;
  store: Store;
  gitWorkDir: string;
  bareRemoteDir: string;
  gitStore: GitStore;
  githubDouble: GithubHttpSeam;
  piSurface: FakePiSurface;
};

// ---------------------------------------------------------------------------
// Golden fixture file contents (mirrors golden.ts — feat-001, 3 tasks, 2-stage deploy)
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

class NoopSink implements GateResultSink {
  record(_phase: string, _outcome: GateOutcome): void {
    // golden scenario does not persist gate results
  }
}

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

function liveCompileHash(store: Store, featureId: string): string {
  const row = store.get<{ compile_hash: string }>(
    "SELECT compile_hash FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
    featureId,
  );
  if (row === undefined) {
    throw new Error(`run2aGoldenScenario: no compiled generation for ${featureId}`);
  }
  return row.compile_hash;
}

async function runTaskWorkflow(sink: GateResultSink): Promise<void> {
  const wf = new TddWorkflow(
    { failing_test_exists: "pass", tests_pass: "pass" },
    sink,
  );
  await wf.gateCheck("failing_test_exists");
  await wf.gateCheck("tests_pass");
}

async function exerciseSuccessfulBrokerWakeup(
  store: Store,
  clock: FakeClock,
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
    store,
  );
  const op = getInFlightOp(opId, store);
  if (op === undefined) {
    throw new Error("run2aGoldenScenario: in-flight broker op not found");
  }

  if (!lm.acquire("task-alpha", [capability])) {
    throw new Error("run2aGoldenScenario: could not acquire broker wakeup capability");
  }
  setTaskStatus(store, "task-alpha", "running");
  park(store, "task-alpha", opId, [capability], lm);

  startPolling(op, BROKER_SUCCESS_ENTRY, adapter, store, clock);
  clock.advance(BROKER_SUCCESS_ENTRY.poll_interval);
  await Promise.resolve();

  const completion = store.get<{
    status: string;
    result_json: string | null;
  }>(
    "SELECT status, result_json FROM broker_completion WHERE op_id = ?",
    opId,
  );
  const contexts = resume(store, "feat-001", lm);

  return {
    completionStatus: completion?.status ?? "",
    completionResultJson: completion?.result_json ?? null,
    wakeupTaskIds: contexts.map((ctx) => ctx.taskId),
  };
}

// ---------------------------------------------------------------------------
// run2aGoldenScenario — public entry point
// ---------------------------------------------------------------------------

/**
 * Run the golden tdd@1 feature end-to-end with 2A bricks substituted.
 *
 * Feature files are committed to the real GitStore (Epic 012); all
 * scheduler/broker state uses the fixture's SQLite store. GithubHttpSeam and
 * FakePiSurface are wired at the fixture boundary (exercised in T2 scenarios).
 *
 * Wave ordering matches runGoldenScenario exactly so that the Phase-1 outcome
 * assertions hold when the bricks are swapped in.
 */
export async function run2aGoldenScenario(
  fixture: Run2aGoldenFixture,
): Promise<GoldenResult> {
  const { clock, store, gitStore, bareRemoteDir, githubDouble, piSurface } = fixture;

  // -------------------------------------------------------------------------
  // 1. Write golden fixture files via real GitStore (Epic 012 commit-per-write)
  // -------------------------------------------------------------------------
  const featureDir = join(gitStore.dir, "feat-001");

  await gitStore.commit(
    featureDir,
    async () => {
      await mkdir(featureDir, { recursive: true });
      await writeFile(join(featureDir, "epic.md"), EPIC_MD);
      await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");

      const storyA = join(featureDir, "001-story-a");
      await mkdir(storyA, { recursive: true });
      await writeFile(join(storyA, "INDEX.md"), "# Story A\n");
      await writeFile(join(storyA, "001-task-alpha.md"), TASK_ALPHA_MD);

      const storyB = join(featureDir, "002.1-story-b");
      await mkdir(storyB, { recursive: true });
      await writeFile(join(storyB, "INDEX.md"), "# Story B\n");
      await writeFile(join(storyB, "001-task-beta.md"), TASK_BETA_MD);

      const storyC = join(featureDir, "002.2-story-c");
      await mkdir(storyC, { recursive: true });
      await writeFile(join(storyC, "INDEX.md"), "# Story C\n");
      await writeFile(join(storyC, "001-task-gamma.md"), TASK_GAMMA_MD);
    },
    { changeClass: "plan", actor: "golden-2a" },
  );

  // -------------------------------------------------------------------------
  // 1b. Epic 014 — push the commit to the bare remote via the real git.push seam
  // -------------------------------------------------------------------------
  const pushAdapter = makePushAdapter({
    gitBin: "git",
    verifySetup: async () => ({
      platform: "github",
      repo: "org/repo",
      identity: "kanthord",
      ok: true,
      checks: [],
      inboxItems: [],
    }),
  });
  await pushAdapter.submit({ cwd: gitStore.dir, branch: "main", remote: bareRemoteDir });

  // -------------------------------------------------------------------------
  // 1c. Epic 015 — invoke github.create_pr against the fixture double
  // -------------------------------------------------------------------------
  const prAdapter = makeCreatePrAdapter({
    repo: "org/repo",
    token: "test-token",
    http: githubDouble,
    verifySetup: async () => ({
      platform: "github",
      repo: "org/repo",
      identity: "kanthord",
      ok: true,
      checks: [],
      inboxItems: [],
    }),
  });
  await prAdapter.submit({ head: "feature/golden-2a", base: "main", title: "Golden 2A PR", body: "proof" });

  // -------------------------------------------------------------------------
  // 1d. Epic 016 — spawn a pi session via the fixture surface
  // -------------------------------------------------------------------------
  piSurface.spawnAgent({ systemPrompt: "golden-2a", tools: [], beforeToolCall: null, env: {} });

  // -------------------------------------------------------------------------
  // 2. Compile the feature plan into fixture.store (SQLite)
  // -------------------------------------------------------------------------
  await compile(featureDir, store, COMPILE_OPTS);

  // -------------------------------------------------------------------------
  // 3. Initialise all subsystem schemas, then scheduler rows
  // -------------------------------------------------------------------------
  initSchema(store);
  loadTasks(store, "feat-001");

  const liveHash = liveCompileHash(store, "feat-001");
  const lm = new LeaseManager(store, clock);

  // -------------------------------------------------------------------------
  // 4. Shared scenario state
  // -------------------------------------------------------------------------
  const registry = new InMemoryArtifactRegistry();
  const sink = new NoopSink();
  const taskCapabilities = new Map<string, Capability[]>();

  const brokerWakeup = await exerciseSuccessfulBrokerWakeup(store, clock, lm);

  // -------------------------------------------------------------------------
  // 5. Wave 1 — task-alpha (root; no task predecessors)
  // -------------------------------------------------------------------------
  const w1 = pollOnce(store, "feat-001", liveHash, lm, taskCapabilities);
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
    markExitGatePassed(store, "task-alpha");
    setTaskStatus(store, "task-alpha", "complete");
  }

  // -------------------------------------------------------------------------
  // 6. Wave 2 — task-beta + task-gamma (task-alpha exit gate now passed)
  // -------------------------------------------------------------------------
  const w2 = pollOnce(store, "feat-001", liveHash, lm, taskCapabilities).filter(
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
    markExitGatePassed(store, task.taskId);
    setTaskStatus(store, task.taskId, "complete");
  }

  // -------------------------------------------------------------------------
  // 7. Deploy chain — both stages via scheduler pollOnce lifecycle
  // -------------------------------------------------------------------------
  const emptyHandlers: HandlerMap = new Map();
  const deployEvents: Array<{ event: string; stageId: string }> = [];
  const onEvent = (event: string, ctx: Record<string, unknown>): void => {
    deployEvents.push({ event, stageId: String(ctx["stageId"] ?? "") });
  };
  const deployDispatches = [
    ...(await pollOnce(store, "feat-001", liveHash, lm, taskCapabilities, {
      handlers: emptyHandlers,
      clock,
      onEvent,
    })),
    ...(await pollOnce(store, "feat-001", liveHash, lm, taskCapabilities, {
      handlers: emptyHandlers,
      clock,
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
}
