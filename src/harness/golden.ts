/**
 * Golden scenario — tdd@1 feature end-to-end on fakes.
 *
 * Story 001 T2 (Epic 010).
 *
 * Drives the golden fixture (feat-001: task-alpha → api-spec → task-beta,
 * task-gamma parallel, 2-stage deploy chain) through the Epic 001–009 public
 * seams: compile → dispatchable + setTaskStatus → artifact handoff →
 * TddWorkflow gate pair → runChain. All I/O is on fixture.store and
 * fixture.clock; the no-network guard must never fire.
 */

import type { HarnessFixture } from "./harness.ts";
import { compile } from "../compiler/compile.ts";
import {
  loadTasks,
  dispatchable,
  markExitGatePassed,
  setTaskStatus,
} from "../scheduler/dispatch.ts";
import { TddWorkflow } from "../workflow/tdd-workflow.ts";
import type { GateOutcome, GateResultSink } from "../workflow/workflow.ts";
import {
  publishArtifact,
  consumeArtifact,
} from "../workflow/artifact-gates.ts";
import type { ArtifactRegistry } from "../workflow/artifact-gates.ts";
import { runChain } from "../deploy/chain.ts";
import type { Clock } from "../foundations/clock.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GoldenResult = { status: "complete" };

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

// Handler function type matching HandlerMap's value type.
type ObserverFn = (
  stageId: string,
  clock: Clock,
) => Promise<{ healthy: boolean; value: unknown }>;

// ---------------------------------------------------------------------------
// runGoldenScenario — public entry point
// ---------------------------------------------------------------------------

/**
 * Run the golden tdd@1 feature end-to-end on the provided harness fixture.
 *
 * Wave ordering:
 *   Wave 1 — task-alpha (root; no task predecessors)
 *   Wave 2 — task-beta + task-gamma (task-alpha predecessor passed; parallel)
 *   Deploy  — runChain drives staging + production (handlers use "run" key,
 *             not "observer" key, so handler gate is a pass-through; soak is
 *             skipped because "1h"/"24h" parse to 0 ms in parseSoakDurationMs)
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
    // 3. Initialise scheduler rows (INSERT OR IGNORE for every task/deploy node)
    // -----------------------------------------------------------------------
    loadTasks(fixture.store, "feat-001");

    // -----------------------------------------------------------------------
    // 4. Shared scenario state
    // -----------------------------------------------------------------------
    const registry = new InMemoryArtifactRegistry();
    const sink = new NoopSink();

    // -----------------------------------------------------------------------
    // 5. Wave 1 — task-alpha
    //    task-alpha has no task/deploy-stage predecessors → dispatchable first.
    //    task-beta and task-gamma each have a grammar edge from task-alpha
    //    (major 1 → major 2), so they wait for task-alpha's exit gate.
    // -----------------------------------------------------------------------
    const w1 = dispatchable(fixture.store, "feat-001");
    const alphaTask = w1.find((t) => t.id === "task-alpha");
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
    const w2 = dispatchable(fixture.store, "feat-001").filter(
      (t) => t.id === "task-beta" || t.id === "task-gamma",
    );
    for (const task of w2) {
      if (task.id === "task-beta") {
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
      markExitGatePassed(fixture.store, task.id);
      setTaskStatus(fixture.store, task.id, "complete");
    }

    // -----------------------------------------------------------------------
    // 7. Deploy chain — both stages via runChain
    //    Handlers use "run" key (not "observer"), so handler gate is a no-op.
    //    soak_duration "1h"/"24h" parses to 0 ms → soak phase is skipped.
    //    Result is always { result: "pass" } with no network access.
    // -----------------------------------------------------------------------
    const emptyHandlers = new Map<string, ObserverFn>();
    await runChain(fixture.store, "feat-001", emptyHandlers, fixture.clock);

    // Mark deploy-stage nodes done in the scheduler.
    const deployNodes = fixture.store.all<{ id: string }>(
      "SELECT id FROM plan_node WHERE feature_id = ? AND kind = 'deploy-stage'",
      "feat-001",
    );
    for (const node of deployNodes) {
      markExitGatePassed(fixture.store, node.id);
      setTaskStatus(fixture.store, node.id, "complete");
    }

    return { status: "complete" };
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
}
