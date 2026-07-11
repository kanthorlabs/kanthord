import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { compile, relintCompiledGraph, buildCorePlan } from "./compile.ts";
import type { CorePlanGraph, CompileOptions, PlanNodeRow, SourceProvider } from "./compile.ts";
import { walkFeature } from "./grammar.ts";

// ---- Golden fixture file contents ----------------------------------------
// Feature: feat-001
//   Story 001-story-a       (major=1, no lane)  → task-alpha (produces api-spec)
//   Story 002.1-story-b     (major=2, lane=1)   → task-beta  (consumes api-spec; frozen)
//   Story 002.2-story-c     (major=2, lane=2)   → task-gamma (unrelated task)
// Epic frontmatter declares a 2-stage deploy chain.

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

const COMPILE_OPTS: CompileOptions = { repoRegistry: ["backend"] };

// ---- T2 helper: build a minimal single-story fixture dir ------------------

async function makeMinimalFixture(overrides: {
  epicExtra?: string;
  taskName?: string;
  storyName?: string;
} = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-compile-t2-"));
  await writeFile(join(dir, "epic.md"), EPIC_MD + (overrides.epicExtra ?? ""));
  await writeFile(join(dir, "RUNBOOK.md"), "# Runbook\n");
  const storyName = overrides.storyName ?? "001-story-a";
  const storyDir = join(dir, storyName);
  await mkdir(storyDir);
  await writeFile(join(storyDir, "INDEX.md"), "# Story A\n");
  const taskName = overrides.taskName ?? "001-task-alpha.md";
  await writeFile(join(storyDir, taskName), TASK_ALPHA_MD);
  return dir;
}

// ---- Helper for relint fixtures -------------------------------------------

function makeNode(
  id: string,
  kind: "epic" | "story" | "task" | "deploy-stage" = "task",
): PlanNodeRow {
  return {
    id,
    kind,
    feature_id: "feat-001",
    repo: "backend",
    ticket_system: "jira",
    ticket_ref: "JIRA-001",
    major: 1,
    lane: null,
    slug: id,
    generation: 1,
  };
}

// ---- Test suites -----------------------------------------------------------

describe("src/compiler/compile", () => {
  describe("compile — golden fixture: node/edge/gate/artifact rows", () => {
    let featureDir = "";

    before(async () => {
      featureDir = await mkdtemp(join(tmpdir(), "kanthord-compile-t1-"));

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
    });

    after(async () => {
      if (featureDir) await rm(featureDir, { recursive: true, force: true });
    });

    test(
      "golden fixture: compiles to expected node, edge, gate, artifact, and deploy-stage rows",
      async () => {
        const dbPath = join(featureDir, "test.db");
        const store = openStore(dbPath, { busyTimeout: 1000 });
        try {
          await compile(featureDir, store, COMPILE_OPTS);

          // ---- plan_node counts by kind ----
          const epicNodes = store.all<{ id: string }>(
            "SELECT id FROM plan_node WHERE kind = 'epic'",
          );
          assert.equal(epicNodes.length, 1, "one epic node");
          assert.equal(
            epicNodes[0]?.id,
            "feat-001",
            "epic node id matches frontmatter",
          );

          const storyNodes = store.all<{ id: string }>(
            "SELECT id FROM plan_node WHERE kind = 'story'",
          );
          assert.equal(storyNodes.length, 3, "three story nodes");

          const taskNodes = store.all<{ id: string }>(
            "SELECT id FROM plan_node WHERE kind = 'task'",
          );
          assert.equal(taskNodes.length, 3, "three task nodes");
          const taskIds = taskNodes.map((r) => r.id);
          assert.ok(taskIds.includes("task-alpha"), "task-alpha node in store");
          assert.ok(taskIds.includes("task-beta"), "task-beta node in store");
          assert.ok(taskIds.includes("task-gamma"), "task-gamma node in store");

          // ---- plan_edge: grammar edges ----
          const grammarEdges = store.all<{
            from_node_id: string;
            to_node_id: string;
          }>(
            "SELECT from_node_id, to_node_id FROM plan_edge WHERE kind = 'grammar'",
          );
          assert.ok(
            grammarEdges.length >= 2,
            "at least 2 grammar edges from the sequential story groups",
          );

          // ---- plan_edge: handoff edge from producer (task-alpha) to consumer (task-beta) ----
          const handoffEdge = store.get<{ semantics: string }>(
            "SELECT semantics FROM plan_edge WHERE from_node_id = ? AND to_node_id = ? AND kind = 'handoff'",
            "task-alpha",
            "task-beta",
          );
          assert.ok(
            handoffEdge !== undefined,
            "handoff edge task-alpha → task-beta in store",
          );
          assert.equal(
            handoffEdge.semantics,
            "frozen",
            "handoff edge carries frozen semantics",
          );

          // ---- plan_gate: TDD gate pair for task-alpha ----
          const entryGate = store.get<{ name: string }>(
            "SELECT name FROM plan_gate WHERE node_id = ? AND position = 'entry' AND name = 'failing_test_exists'",
            "task-alpha",
          );
          assert.ok(
            entryGate !== undefined,
            "TDD entry gate (failing_test_exists) for task-alpha",
          );

          const exitGate = store.get<{ name: string }>(
            "SELECT name FROM plan_gate WHERE node_id = ? AND position = 'exit' AND name = 'tests_pass'",
            "task-alpha",
          );
          assert.ok(
            exitGate !== undefined,
            "TDD exit gate (tests_pass) for task-alpha",
          );

          // ---- plan_gate: phase-0 setup gate for task-alpha (## Prerequisites present) ----
          const setupGate = store.get<{ node_id: string }>(
            "SELECT node_id FROM plan_gate WHERE node_id = ? AND phase = 0",
            "task-alpha",
          );
          assert.ok(
            setupGate !== undefined,
            "phase-0 setup gate for task-alpha",
          );

          // ---- plan_gate: artifact-consumption entry gate for task-beta ----
          const consumptionGate = store.get<{ semantics: string }>(
            "SELECT semantics FROM plan_gate WHERE node_id = ? AND artifact_id = 'api-spec' AND position = 'entry'",
            "task-beta",
          );
          assert.ok(
            consumptionGate !== undefined,
            "artifact-consumption entry gate for task-beta exists",
          );
          assert.equal(
            consumptionGate.semantics,
            "frozen",
            "consumption gate carries frozen semantics",
          );

          // ---- plan_gate: feature-level exit criterion (from epic ## Acceptance) ----
          const featureExitGate = store.get<{ node_id: string }>(
            "SELECT node_id FROM plan_gate WHERE node_id = ? AND position = 'exit'",
            "feat-001",
          );
          assert.ok(
            featureExitGate !== undefined,
            "feature-level exit criterion gate for feat-001",
          );

          // ---- plan_artifact: artifact registry row ----
          const artifact = store.get<{
            publisher_node_id: string;
            kind: string;
            path: string;
          }>(
            "SELECT publisher_node_id, kind, path FROM plan_artifact WHERE id = 'api-spec'",
          );
          assert.ok(artifact !== undefined, "api-spec artifact row in store");
          assert.equal(
            artifact.publisher_node_id,
            "task-alpha",
            "api-spec published by task-alpha",
          );
          assert.equal(artifact.kind, "api", "artifact kind is api");
          assert.equal(
            artifact.path,
            "api/spec.yaml",
            "artifact path matches frontmatter",
          );

          // ---- plan_artifact_consumer: consumer row ----
          const consumer = store.get<{ consumer_node_id: string }>(
            "SELECT consumer_node_id FROM plan_artifact_consumer WHERE artifact_id = 'api-spec'",
          );
          assert.ok(consumer !== undefined, "api-spec consumer row in store");
          assert.equal(
            consumer.consumer_node_id,
            "task-beta",
            "task-beta is the consumer of api-spec",
          );

          // ---- deploy-stage nodes (epic declares a 2-stage deploy chain) ----
          const deployNodes = store.all<{ id: string }>(
            "SELECT id FROM plan_node WHERE kind = 'deploy-stage'",
          );
          assert.equal(
            deployNodes.length,
            2,
            "two deploy-stage nodes from the 2-stage deploy chain",
          );

          // ---- B3: deploy-stage nodes connected into DAG via edges ----
          const incomingDeployEdges = store.all<{
            from_node_id: string;
            to_node_id: string;
          }>(
            "SELECT from_node_id, to_node_id FROM plan_edge WHERE to_node_id LIKE 'feat-001-deploy-%'",
          );
          assert.ok(
            incomingDeployEdges.length > 0,
            "B3: deploy-stage nodes must have at least one incoming edge connecting them into the DAG",
          );

          // ---- B4: deploy-stage nodes carry handlers/success_criteria/soak_duration ----
          const stagingDeployData = store.get<{
            success_criteria: string;
          }>(
            "SELECT success_criteria FROM plan_deploy_stage WHERE node_id = ?",
            "feat-001-deploy-staging",
          );
          assert.ok(
            stagingDeployData !== undefined,
            "B4: plan_deploy_stage row for feat-001-deploy-staging must exist",
          );
          assert.ok(
            stagingDeployData.success_criteria.includes("smoke"),
            "B4: success_criteria carries the fixture value ('smoke tests pass')",
          );

          // ---- plan_generation: generation stamped on first compile ----
          const generation = store.get<{
            generation: number;
            feature_id: string;
          }>(
            "SELECT generation, feature_id FROM plan_generation WHERE feature_id = 'feat-001'",
          );
          assert.ok(
            generation !== undefined,
            "generation row for feat-001 exists",
          );
          assert.equal(
            generation.generation,
            1,
            "first compile stamps generation 1",
          );
        } finally {
          store.close();
        }
      },
    );
  });

  describe("relintCompiledGraph — malformed graph rejection", () => {
    test("dangling edge endpoint → diagnostic naming the dangling node id", () => {
      const graph: CorePlanGraph = {
        nodes: [makeNode("n1")],
        edges: [
          {
            from_node_id: "ghost-node",
            to_node_id: "n1",
            kind: "grammar",
            semantics: null,
          },
        ],
        gates: [],
        artifacts: [],
        artifactConsumers: [],
      };
      const result = relintCompiledGraph(graph);
      assert.ok(
        result.diagnostics.length > 0,
        "dangling edge endpoint produces at least one diagnostic",
      );
      assert.ok(
        result.diagnostics.some((d) => d.message.includes("ghost-node")),
        "diagnostic names the dangling endpoint id",
      );
    });

    test("unresolved gate owner → diagnostic naming the missing node id", () => {
      const graph: CorePlanGraph = {
        nodes: [makeNode("n1")],
        edges: [],
        gates: [
          {
            node_id: "no-such-node",
            phase: 1,
            position: "entry",
            name: "failing_test_exists",
            artifact_id: null,
            semantics: null,
          },
        ],
        artifacts: [],
        artifactConsumers: [],
      };
      const result = relintCompiledGraph(graph);
      assert.ok(
        result.diagnostics.length > 0,
        "unresolved gate owner produces at least one diagnostic",
      );
      assert.ok(
        result.diagnostics.some((d) => d.message.includes("no-such-node")),
        "diagnostic names the unresolved gate owner id",
      );
    });

    test("gate name outside tdd@1 vocabulary → diagnostic naming the gate", () => {
      const graph: CorePlanGraph = {
        nodes: [makeNode("n1")],
        edges: [],
        gates: [
          {
            node_id: "n1",
            phase: 1,
            position: "entry",
            name: "unknown-gate-name",
            artifact_id: null,
            semantics: null,
          },
        ],
        artifacts: [],
        artifactConsumers: [],
      };
      const result = relintCompiledGraph(graph);
      assert.ok(
        result.diagnostics.length > 0,
        "unknown gate name produces at least one diagnostic",
      );
      assert.ok(
        result.diagnostics.some((d) => d.message.includes("unknown-gate-name")),
        "diagnostic names the invalid gate name",
      );
    });

    test("unresolved artifact publisher → diagnostic naming the missing node id", () => {
      const graph: CorePlanGraph = {
        nodes: [makeNode("n1")],
        edges: [],
        gates: [],
        artifacts: [
          {
            id: "some-artifact",
            publisher_node_id: "phantom-publisher",
            kind: "api",
            path: "api/spec.yaml",
          },
        ],
        artifactConsumers: [],
      };
      const result = relintCompiledGraph(graph);
      assert.ok(
        result.diagnostics.length > 0,
        "unresolved artifact publisher produces at least one diagnostic",
      );
      assert.ok(
        result.diagnostics.some((d) =>
          d.message.includes("phantom-publisher"),
        ),
        "diagnostic names the unresolved publisher node id",
      );
    });

    test("emitted cycle → diagnostic naming the node ids on the cycle", () => {
      const graph: CorePlanGraph = {
        nodes: [makeNode("c1"), makeNode("c2")],
        edges: [
          { from_node_id: "c1", to_node_id: "c2", kind: "grammar", semantics: null },
          { from_node_id: "c2", to_node_id: "c1", kind: "grammar", semantics: null },
        ],
        gates: [],
        artifacts: [],
        artifactConsumers: [],
      };
      const result = relintCompiledGraph(graph);
      assert.ok(
        result.diagnostics.length > 0,
        "cycle in emitted graph produces at least one diagnostic",
      );
      assert.ok(
        result.diagnostics.some(
          (d) => d.message.includes("c1") && d.message.includes("c2"),
        ),
        "diagnostic names both nodes on the cycle",
      );
    });

    // B5: relintCompiledGraph must check consumer_node_id resolves to a node.
    test("unresolved artifactConsumers.consumer_node_id → diagnostic naming the missing consumer id", () => {
      const graph: CorePlanGraph = {
        nodes: [makeNode("n-pub"), makeNode("n-other")],
        edges: [],
        gates: [],
        artifacts: [
          {
            id: "art-b5",
            publisher_node_id: "n-pub",
            kind: "api",
            path: "api/spec.yaml",
          },
        ],
        artifactConsumers: [
          { artifact_id: "art-b5", consumer_node_id: "ghost-consumer" },
        ],
      };
      const result = relintCompiledGraph(graph);
      assert.ok(
        result.diagnostics.length > 0,
        "B5: unresolved consumer_node_id must produce at least one diagnostic",
      );
      assert.ok(
        result.diagnostics.some((d) => d.message.includes("ghost-consumer")),
        "B5: diagnostic must name the unresolved consumer_node_id",
      );
    });
  });

  // --------------------------------------------------------------------------
  // T2: compile_hash coverage, generation semantics, sign-off write
  // --------------------------------------------------------------------------

  describe("compile_hash — determinism and coverage", () => {
    test(
      "unchanged fixture recompile: compile_hash is non-empty and does not mint a new generation row",
      async () => {
        const dir = await makeMinimalFixture();
        const store = openStore(join(dir, "gen.db"), { busyTimeout: 1000 });
        try {
          await compile(dir, store, COMPILE_OPTS);
          const row = store.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          );
          assert.ok(row !== undefined, "generation row exists after first compile");
          assert.ok(
            (row.compile_hash ?? "").length > 0,
            "compile_hash is non-empty",
          );
          await compile(dir, store, COMPILE_OPTS);
          const rows = store.all<{ generation: number }>(
            "SELECT generation FROM plan_generation WHERE feature_id = 'feat-001'",
          );
          assert.equal(rows.length, 1, "unchanged recompile does not mint a new generation row");
        } finally {
          store.close();
          await rm(dir, { recursive: true, force: true });
        }
      },
    );

    test("editing epic.md body changes compile_hash", async () => {
      const dir1 = await makeMinimalFixture();
      const dir2 = await makeMinimalFixture({ epicExtra: "\n<!-- body change -->\n" });
      try {
        const s1 = openStore(join(dir1, "h1.db"), { busyTimeout: 1000 });
        await compile(dir1, s1, COMPILE_OPTS);
        const h1 =
          s1.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s1.close();

        const s2 = openStore(join(dir2, "h2.db"), { busyTimeout: 1000 });
        await compile(dir2, s2, COMPILE_OPTS);
        const h2 =
          s2.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s2.close();

        assert.ok(h1.length > 0, "baseline compile_hash is non-empty");
        assert.notEqual(h1, h2, "editing epic.md body changes compile_hash");
      } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    test("editing INDEX.md changes compile_hash", async () => {
      const dir1 = await makeMinimalFixture();
      const dir2 = await makeMinimalFixture();
      await writeFile(join(dir2, "001-story-a", "INDEX.md"), "# Story A — modified\n");
      try {
        const s1 = openStore(join(dir1, "idx1.db"), { busyTimeout: 1000 });
        await compile(dir1, s1, COMPILE_OPTS);
        const h1 =
          s1.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s1.close();

        const s2 = openStore(join(dir2, "idx2.db"), { busyTimeout: 1000 });
        await compile(dir2, s2, COMPILE_OPTS);
        const h2 =
          s2.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s2.close();

        assert.ok(h1.length > 0, "baseline compile_hash is non-empty");
        assert.notEqual(h1, h2, "editing INDEX.md changes compile_hash");
      } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    test("editing a task file's content changes compile_hash", async () => {
      const dir1 = await makeMinimalFixture();
      const dir2 = await makeMinimalFixture();
      await writeFile(
        join(dir2, "001-story-a", "001-task-alpha.md"),
        TASK_ALPHA_MD + "\n<!-- task body change -->\n",
      );
      try {
        const s1 = openStore(join(dir1, "tc1.db"), { busyTimeout: 1000 });
        await compile(dir1, s1, COMPILE_OPTS);
        const h1 =
          s1.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s1.close();

        const s2 = openStore(join(dir2, "tc2.db"), { busyTimeout: 1000 });
        await compile(dir2, s2, COMPILE_OPTS);
        const h2 =
          s2.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s2.close();

        assert.ok(h1.length > 0, "baseline compile_hash is non-empty");
        assert.notEqual(h1, h2, "editing task file content changes compile_hash");
      } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    test("renaming a task file changes compile_hash", async () => {
      // dir1: task file named 001-task-alpha.md; dir2: named 002-task-alpha.md (same frontmatter)
      const dir1 = await makeMinimalFixture();
      const dir2 = await makeMinimalFixture({ taskName: "002-task-alpha.md" });
      try {
        const s1 = openStore(join(dir1, "rf1.db"), { busyTimeout: 1000 });
        await compile(dir1, s1, COMPILE_OPTS);
        const h1 =
          s1.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s1.close();

        const s2 = openStore(join(dir2, "rf2.db"), { busyTimeout: 1000 });
        await compile(dir2, s2, COMPILE_OPTS);
        const h2 =
          s2.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s2.close();

        assert.ok(h1.length > 0, "baseline compile_hash is non-empty");
        assert.notEqual(h1, h2, "renaming a task file changes compile_hash");
      } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    test("renaming a story directory changes compile_hash", async () => {
      // dir1: story dir 001-story-a; dir2: story dir 001-story-b (same task inside)
      const dir1 = await makeMinimalFixture();
      const dir2 = await makeMinimalFixture({ storyName: "001-story-b" });
      try {
        const s1 = openStore(join(dir1, "rs1.db"), { busyTimeout: 1000 });
        await compile(dir1, s1, COMPILE_OPTS);
        const h1 =
          s1.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s1.close();

        const s2 = openStore(join(dir2, "rs2.db"), { busyTimeout: 1000 });
        await compile(dir2, s2, COMPILE_OPTS);
        const h2 =
          s2.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s2.close();

        assert.ok(h1.length > 0, "baseline compile_hash is non-empty");
        assert.notEqual(h1, h2, "renaming a story directory changes compile_hash");
      } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    test(
      "editing excluded files (RUNBOOK.md, *.state.md, *.journal.jsonl) each leave compile_hash unchanged",
      async () => {
        const dir1 = await makeMinimalFixture();
        const dir2 = await makeMinimalFixture();
        // Add excluded files to dir2 (RUNBOOK modified, state + journal created)
        await writeFile(join(dir2, "RUNBOOK.md"), "# Runbook — modified\n");
        await writeFile(
          join(dir2, "001-story-a", "task-alpha.state.md"),
          "state content\n",
        );
        await writeFile(
          join(dir2, "001-story-a", "task-alpha.journal.jsonl"),
          '{"entry":1}\n',
        );
        try {
          const s1 = openStore(join(dir1, "excl1.db"), { busyTimeout: 1000 });
          await compile(dir1, s1, COMPILE_OPTS);
          const h1 =
            s1.get<{ compile_hash: string }>(
              "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
            )?.compile_hash ?? "";
          s1.close();

          const s2 = openStore(join(dir2, "excl2.db"), { busyTimeout: 1000 });
          await compile(dir2, s2, COMPILE_OPTS);
          const h2 =
            s2.get<{ compile_hash: string }>(
              "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
            )?.compile_hash ?? "";
          s2.close();

          assert.ok(h1.length > 0, "baseline compile_hash is non-empty");
          assert.equal(h1, h2, "editing excluded files leaves compile_hash unchanged");
        } finally {
          await rm(dir1, { recursive: true, force: true });
          await rm(dir2, { recursive: true, force: true });
        }
      },
    );

    // S4: computeCompileHash must include the feature-root INDEX.md
    test("changing a feature-root INDEX.md changes compile_hash (S4)", async () => {
      const dir1 = await makeMinimalFixture();
      const dir2 = await makeMinimalFixture();
      await writeFile(join(dir1, "INDEX.md"), "# Feature root\n");
      await writeFile(join(dir2, "INDEX.md"), "# Feature root — modified\n");
      try {
        const s1 = openStore(join(dir1, "s4a.db"), { busyTimeout: 1000 });
        await compile(dir1, s1, COMPILE_OPTS);
        const h1 =
          s1.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s1.close();

        const s2 = openStore(join(dir2, "s4b.db"), { busyTimeout: 1000 });
        await compile(dir2, s2, COMPILE_OPTS);
        const h2 =
          s2.get<{ compile_hash: string }>(
            "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001'",
          )?.compile_hash ?? "";
        s2.close();

        assert.ok(h1.length > 0, "S4: baseline compile_hash is non-empty");
        assert.notEqual(h1, h2, "S4: changing feature-root INDEX.md must change compile_hash");
      } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    test("covered-file change stamps G+1 on recompile (same store)", async () => {
      const dir = await makeMinimalFixture();
      const store = openStore(join(dir, "g1.db"), { busyTimeout: 1000 });
      try {
        await compile(dir, store, COMPILE_OPTS);
        const row1 = store.get<{ compile_hash: string; generation: number }>(
          "SELECT compile_hash, generation FROM plan_generation WHERE feature_id = 'feat-001'",
        );
        assert.ok(
          (row1?.compile_hash ?? "").length > 0,
          "first compile_hash is non-empty",
        );
        // Modify a covered file and recompile into the same store
        const epicPath = join(dir, "epic.md");
        const original = await readFile(epicPath, "utf8");
        await writeFile(epicPath, original + "\n<!-- covered change -->\n");
        await compile(dir, store, COMPILE_OPTS);
        const rows = store.all<{ generation: number }>(
          "SELECT generation FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation",
        );
        assert.equal(rows.length, 2, "covered-file change mints a second generation row");
        assert.equal(rows[1]?.generation, 2, "new generation is G+1 = 2");
      } finally {
        store.close();
        await rm(dir, { recursive: true, force: true });
      }
    });

    // RR-S1: computeCompileHash bare catch {} swallows ALL errors, not just ENOENT.
    // Creating INDEX.md as a directory triggers EISDIR when readFile is called.
    // After the fix (rethrow unless err.code === "ENOENT"), compile() must propagate.
    test(
      "feature-root INDEX.md as a directory (EISDIR) → compile throws instead of silently skipping (RR-S1)",
      async () => {
        const dir = await makeMinimalFixture();
        // INDEX.md is a directory — readFile("utf8") on it throws EISDIR.
        await mkdir(join(dir, "INDEX.md"));
        const store = openStore(join(dir, "rrs1.db"), { busyTimeout: 1000 });
        try {
          await assert.rejects(
            compile(dir, store, COMPILE_OPTS),
            { code: "EISDIR" },
            "RR-S1: compile() must propagate EISDIR from INDEX.md read, not swallow it",
          );
        } finally {
          store.close();
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  });

  describe("compile: block — written to epic.md after compile", () => {
    test("after compile epic.md frontmatter has compile: { shape, hash, at } block", async () => {
      const dir = await makeMinimalFixture();
      const store = openStore(join(dir, "block.db"), { busyTimeout: 1000 });
      try {
        await compile(dir, store, COMPILE_OPTS);
        const epicText = await readFile(join(dir, "epic.md"), "utf8");
        assert.ok(
          epicText.includes("compile:"),
          "epic.md has compile: block after compile()",
        );
        assert.ok(
          epicText.includes("tdd@1") || epicText.includes("'tdd@1'"),
          "compile block names shape tdd@1",
        );
        assert.ok(epicText.includes("hash:"), "compile block contains hash:");
        assert.ok(epicText.includes("at:"), "compile block contains at:");
      } finally {
        store.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("sign-off only — compile() writes block; walk/lint do not", () => {
    test(
      "compile() writes compile: block to epic.md; walkFeature and buildCorePlan alone do not",
      async () => {
        const dir = await makeMinimalFixture();
        const epicPath = join(dir, "epic.md");
        try {
          // Pure walk + lint: epic.md must remain unchanged (no compile: block)
          await walkFeature(dir);
          await buildCorePlan(dir, COMPILE_OPTS);
          const epicAfterLint = await readFile(epicPath, "utf8");
          assert.ok(
            !epicAfterLint.includes("compile:"),
            "walkFeature + buildCorePlan must not write compile: block",
          );

          // compile() must write the block
          const store = openStore(join(dir, "signoff.db"), { busyTimeout: 1000 });
          try {
            await compile(dir, store, COMPILE_OPTS);
          } finally {
            store.close();
          }
          const epicAfterCompile = await readFile(epicPath, "utf8");
          assert.ok(
            epicAfterCompile.includes("compile:"),
            "compile() must write compile: block to epic.md",
          );
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  });

  describe("clone-on-sign-off — content_hash and snapshot_at per node", () => {
    test(
      "after compile with fake SourceProvider each node row carries content_hash and snapshot_at",
      async () => {
        const dir = await makeMinimalFixture();
        const fakeProvider: SourceProvider = {
          async getSnapshot(nodeId: string) {
            return {
              content_hash: `fake-hash-${nodeId}`,
              snapshot_at: 1_700_000_000_000,
            };
          },
        };
        const store = openStore(join(dir, "clone.db"), { busyTimeout: 1000 });
        try {
          await compile(dir, store, { ...COMPILE_OPTS, sourceProvider: fakeProvider });
          const node = store.get<{ content_hash: string; snapshot_at: number }>(
            "SELECT content_hash, snapshot_at FROM plan_node WHERE id = ?",
            "task-alpha",
          );
          assert.ok(node !== undefined, "task-alpha node row exists");
          assert.equal(
            node.content_hash,
            "fake-hash-task-alpha",
            "content_hash comes from fake SourceProvider",
          );
          assert.equal(
            typeof node.snapshot_at,
            "number",
            "snapshot_at round-trips as a JS number (epoch ms), not a string",
          );
          assert.equal(
            node.snapshot_at,
            1_700_000_000_000,
            "snapshot_at holds the epoch-ms value returned by getSnapshot",
          );
        } finally {
          store.close();
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  });

  // --------------------------------------------------------------------------
  // S1 — buildCorePlan must stamp generation=0 sentinel; compile() real generation
  // --------------------------------------------------------------------------

  describe("buildCorePlan — generation=0 sentinel (S1)", () => {
    test(
      "buildCorePlan stamps generation=0 on all PlanNodeRows; compile() inserts real generation",
      async () => {
        const dir = await makeMinimalFixture();
        try {
          const graph = await buildCorePlan(dir, COMPILE_OPTS);
          // S1a: buildCorePlan must stamp generation=0 (unassigned sentinel) — RED now (currently hardcoded to 1)
          for (const node of graph.nodes) {
            assert.equal(
              node.generation,
              0,
              `S1: buildCorePlan node "${node.id}" must have generation=0, got ${node.generation}`,
            );
          }
          // S1b: compile() must insert rows with the real (non-zero) generation
          const store = openStore(join(dir, "s1.db"), { busyTimeout: 1000 });
          try {
            await compile(dir, store, COMPILE_OPTS);
            const taskRow = store.get<{ generation: number }>(
              "SELECT generation FROM plan_node WHERE id = 'task-alpha'",
            );
            assert.ok(taskRow !== undefined, "S1: task-alpha row must exist after compile");
            assert.ok(
              taskRow.generation >= 1,
              `S1: compile() must store real generation (>= 1), got ${taskRow.generation}`,
            );
          } finally {
            store.close();
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  });

  // --------------------------------------------------------------------------
  // B2 — integration tests: compile() rejects invalid feature directories
  // with planner-vocabulary diagnostics (proves B1 lint wiring once fixed).
  // Each test currently fails because buildCorePlan calls no lint functions.
  // --------------------------------------------------------------------------

  // Minimal epic for invalid-fixture tests (no deploy_chain).
  const EPIC_B2_MD = `---
id: feat-b2
repo: backend
ticket_system: jira
ticket: JIRA-B2
---

## Acceptance

B2 test feature.
`;

  // cycle: task-cy-a depends on task-cy-b AND task-cy-b depends on task-cy-a.
  const TASK_CY_A_MD = `---
id: task-cy-a
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-CYA
outputs:
  - cy-out-a
depends_on:
  - task: task-cy-b
    output: cy-out-b
    semantics: frozen
---

## Prerequisites

setup cy-a

## Inputs

cy-out-b from task-cy-b.

## Outputs

cy-out-a

## Tests

cy-a tests.
`;

  const TASK_CY_B_MD = `---
id: task-cy-b
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-CYB
outputs:
  - cy-out-b
depends_on:
  - task: task-cy-a
    output: cy-out-a
    semantics: frozen
---

## Prerequisites

setup cy-b

## Inputs

cy-out-a from task-cy-a.

## Outputs

cy-out-b

## Tests

cy-b tests.
`;

  // forward handoff: task-fh-early (major=1) depends on task-fh-late (major=3).
  // Produces a backward edge (late→early) that creates a cycle with grammar edges.
  const TASK_FH_EARLY_MD = `---
id: task-fh-early
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-FHE
depends_on:
  - task: task-fh-late
    output: fh-late-out
    semantics: frozen
---

## Prerequisites

setup early

## Inputs

fh-late-out from task-fh-late.

## Outputs

nothing

## Tests

early tests.
`;

  const TASK_FH_LATE_MD = `---
id: task-fh-late
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-FHL
outputs:
  - fh-late-out
---

## Prerequisites

setup late

## Inputs

Nothing.

## Outputs

fh-late-out

## Tests

late tests.
`;

  // overlapping lanes: 001.1 and 001.2 both write to lib/shared/.
  const TASK_LANE1_MD_B2 = `---
id: task-lane1
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-L1
write_scope:
  - lib/shared/
---

## Prerequisites

setup lane1

## Inputs

Nothing.

## Outputs

nothing

## Tests

lane1 tests.
`;

  const TASK_LANE2_MD_B2 = `---
id: task-lane2
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-L2
write_scope:
  - lib/shared/utils/
---

## Prerequisites

setup lane2

## Inputs

Nothing.

## Outputs

nothing

## Tests

lane2 tests.
`;

  // missing ticket: no ticket field.
  const TASK_NO_TICKET_MD_B2 = `---
id: task-no-ticket
workflow: tdd@1
repo: backend
ticket_system: jira
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

nothing

## Tests

tests.
`;

  // missing body section: ## Tests absent.
  const TASK_NO_TESTS_MD_B2 = `---
id: task-no-tests
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-NTS
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

nothing
`;

  // workflow override: custom@1 instead of tdd@1.
  const TASK_WORKFLOW_OVERRIDE_MD_B2 = `---
id: task-workflow-override
workflow: custom@1
repo: backend
ticket_system: jira
ticket: JIRA-WO
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

nothing

## Tests

tests.
`;

  async function makeInvalidFixture(
    storyDirs: Array<{
      name: string;
      files: Array<{ name: string; content: string }>;
    }>,
  ): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-b2-"));
    await writeFile(join(dir, "epic.md"), EPIC_B2_MD);
    await writeFile(join(dir, "RUNBOOK.md"), "# Runbook\n");
    for (const story of storyDirs) {
      const storyPath = join(dir, story.name);
      await mkdir(storyPath);
      await writeFile(join(storyPath, "INDEX.md"), `# ${story.name}\n`);
      for (const file of story.files) {
        await writeFile(join(storyPath, file.name), file.content);
      }
    }
    return dir;
  }

  async function expectCompileThrows(dir: string, ...msgHints: string[]): Promise<void> {
    const store = openStore(join(dir, "test.db"), { busyTimeout: 1000 });
    try {
      let thrown: Error | undefined;
      try {
        await compile(dir, store, COMPILE_OPTS);
      } catch (e) {
        if (e instanceof Error) thrown = e;
        else throw e;
      }
      assert.ok(thrown !== undefined, "compile() must throw for this invalid fixture");
      for (const hint of msgHints) {
        assert.ok(
          thrown.message.toLowerCase().includes(hint.toLowerCase()),
          `error message must name "${hint}": got "${thrown.message}"`,
        );
      }
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  describe("compile — invalid fixtures: lint rejection (B2)", () => {
    test(
      "cycle: circular depends_on between two tasks → compile throws naming a cycle task id",
      async () => {
        const dir = await makeInvalidFixture([
          {
            name: "001-story-cycle",
            files: [
              { name: "001-task-cy-a.md", content: TASK_CY_A_MD },
              { name: "002-task-cy-b.md", content: TASK_CY_B_MD },
            ],
          },
        ]);
        await expectCompileThrows(dir, "task-cy-a");
      },
    );

    test(
      "forward handoff: producer major > consumer major → compile throws planner-vocabulary diagnostic",
      async () => {
        const dir = await makeInvalidFixture([
          {
            name: "001-story-early",
            files: [{ name: "001-task-fh-early.md", content: TASK_FH_EARLY_MD }],
          },
          {
            name: "003-story-late",
            files: [{ name: "001-task-fh-late.md", content: TASK_FH_LATE_MD }],
          },
        ]);
        await expectCompileThrows(
          dir,
          "Forward handoff: story group 01 cannot depend on story group 03 (producer follows consumer)",
        );
      },
    );

    test(
      "overlapping lanes: parallel stories share write_scope prefix → compile throws naming lane labels",
      async () => {
        const dir = await makeInvalidFixture([
          {
            name: "001.1-story-lane1",
            files: [{ name: "001-task-lane1.md", content: TASK_LANE1_MD_B2 }],
          },
          {
            name: "001.2-story-lane2",
            files: [{ name: "001-task-lane2.md", content: TASK_LANE2_MD_B2 }],
          },
        ]);
        await expectCompileThrows(dir, "001.1", "001.2");
      },
    );

    test(
      "missing ticket: task without ticket field → compile throws naming the task",
      async () => {
        const dir = await makeInvalidFixture([
          {
            name: "001-story-a",
            files: [{ name: "001-task-no-ticket.md", content: TASK_NO_TICKET_MD_B2 }],
          },
        ]);
        await expectCompileThrows(dir, "task-no-ticket");
      },
    );

    test(
      "missing body section: task without ## Tests → compile throws naming task and section",
      async () => {
        const dir = await makeInvalidFixture([
          {
            name: "001-story-a",
            files: [{ name: "001-task-no-tests.md", content: TASK_NO_TESTS_MD_B2 }],
          },
        ]);
        await expectCompileThrows(dir, "task-no-tests");
      },
    );

    test(
      "workflow override: task with custom@1 → compile throws naming the task",
      async () => {
        const dir = await makeInvalidFixture([
          {
            name: "001-story-a",
            files: [{ name: "001-task-workflow-override.md", content: TASK_WORKFLOW_OVERRIDE_MD_B2 }],
          },
        ]);
        await expectCompileThrows(dir, "task-workflow-override");
      },
    );
  });

  // --------------------------------------------------------------------------
  // 008.1 Story 001-T1 — compiler wires terminal task(s) of last-major story
  // to the first deploy-stage node (additive; story→deploy edges kept).
  // --------------------------------------------------------------------------

  describe("008.1 T1 — buildCorePlan emits terminal-task→deploy edges", () => {
    test(
      "buildCorePlan emits edge from each terminal task of last-major story to first deploy-stage; story→deploy grammar edges kept",
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "kanthord-008-t1-"));
        try {
          // Golden 3-story fixture: major=1 (story-a/task-alpha), major=2 (story-b/task-beta, story-c/task-gamma)
          // Last-major stories: 002.1-story-b (task-beta) and 002.2-story-c (task-gamma)
          // task-beta has no successor task → terminal; task-gamma has no successor task → terminal
          await writeFile(join(dir, "epic.md"), EPIC_MD);
          await writeFile(join(dir, "RUNBOOK.md"), "# Runbook\n");
          const sA = join(dir, "001-story-a");
          await mkdir(sA);
          await writeFile(join(sA, "INDEX.md"), "# Story A\n");
          await writeFile(join(sA, "001-task-alpha.md"), TASK_ALPHA_MD);
          const sB = join(dir, "002.1-story-b");
          await mkdir(sB);
          await writeFile(join(sB, "INDEX.md"), "# Story B\n");
          await writeFile(join(sB, "001-task-beta.md"), TASK_BETA_MD);
          const sC = join(dir, "002.2-story-c");
          await mkdir(sC);
          await writeFile(join(sC, "INDEX.md"), "# Story C\n");
          await writeFile(join(sC, "001-task-gamma.md"), TASK_GAMMA_MD);

          const graph = await buildCorePlan(dir, COMPILE_OPTS);
          const firstDeployId = "feat-001-deploy-staging";

          // (a) Terminal task nodes → first deploy stage (NEW edges from T1)
          assert.ok(
            graph.edges.some(
              (e) => e.from_node_id === "task-beta" && e.to_node_id === firstDeployId,
            ),
            "terminal task task-beta must have edge to first deploy-stage node",
          );
          assert.ok(
            graph.edges.some(
              (e) => e.from_node_id === "task-gamma" && e.to_node_id === firstDeployId,
            ),
            "terminal task task-gamma must have edge to first deploy-stage node",
          );

          // (b) Pre-existing story→deploy grammar edges still present (structural documentation, kept)
          assert.ok(
            graph.edges.some(
              (e) => e.from_node_id === "002.1-story-b" && e.to_node_id === firstDeployId,
            ),
            "pre-existing story→deploy grammar edge for 002.1-story-b must still be present",
          );
          assert.ok(
            graph.edges.some(
              (e) => e.from_node_id === "002.2-story-c" && e.to_node_id === firstDeployId,
            ),
            "pre-existing story→deploy grammar edge for 002.2-story-c must still be present",
          );
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  });
});
