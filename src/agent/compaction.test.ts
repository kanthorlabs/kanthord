/**
 * Tests for src/agent/compaction
 * Story 016/003 — Compaction Threshold
 * Task T1 — Threshold config + boundary trigger
 * Task T2 — One respawn path + equivalence
 *
 * Per-model config loads; the 55_001/55_000/54_999 boundary cases are
 * asserted explicitly; a compaction event is journaled with signal + threshold.
 * T2: three triggers (threshold, task-boundary, crash) produce behaviorally
 * identical respawns via the Epic 006 coordinator.
 * No network, no model calls — hermetic suite.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeatureStore } from "../store/feature-store.ts";
import { spawnSession } from "../session/agent-session.ts";
import type { SchedulerView, LeaseView } from "../session/respawn.ts";
import {
  exceedsCompactionThreshold,
  resolveModelConfig,
  journalCompactionEvent,
  runCompaction,
  type ModelCompactionConfig,
  type CompactionModelRegistry,
  type CompactionTrigger,
} from "./compaction.ts";

// ---------------------------------------------------------------------------
// Helper: temp feature store
// ---------------------------------------------------------------------------

async function setupDir(): Promise<{ dir: string; store: FeatureStore; agentsMdPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "kcompaction-t1-"));
  const store = new FeatureStore(dir);
  await store.writeFeature({
    epic: { frontmatter: { id: "e016" }, body: "epic-body" },
    runbook: "runbook-text",
    stories: [
      {
        story: { id: "s1", content: "# story" },
        tasks: [
          {
            filename: "t1.md",
            frontmatter: { id: "t1" },
            body: "task-body",
          },
        ],
      },
    ],
  });
  const agentsMdPath = join(dir, "AGENTS.md");
  await writeFile(agentsMdPath, "agents-text", "utf8");
  const cleanup = () => rm(dir, { recursive: true });
  return { dir, store, agentsMdPath, cleanup };
}

// ---------------------------------------------------------------------------
// Suite: threshold config + boundary trigger
// ---------------------------------------------------------------------------

describe("src/agent/compaction", () => {
  describe("T1 — threshold config + boundary trigger", () => {
    // -----------------------------------------------------------------------
    // (a) per-model config loads; missing model falls back to system default
    // -----------------------------------------------------------------------

    test("resolveModelConfig returns the per-model config when the model is registered", () => {
      const registry: CompactionModelRegistry = {
        models: {
          "claude-opus-4": { window: 100_000, compaction_threshold: 0.55 },
        },
        default: { window: 200_000, compaction_threshold: 0.60 },
      };
      const cfg = resolveModelConfig("claude-opus-4", registry);
      assert.strictEqual(cfg.window, 100_000, "window must match registered model");
      assert.strictEqual(cfg.compaction_threshold, 0.55, "compaction_threshold must match registered model");
    });

    test("resolveModelConfig falls back to system default when model is absent", () => {
      const registry: CompactionModelRegistry = {
        models: {
          "claude-opus-4": { window: 100_000, compaction_threshold: 0.55 },
        },
        default: { window: 200_000, compaction_threshold: 0.60 },
      };
      const cfg = resolveModelConfig("unknown-model-xyz", registry);
      assert.strictEqual(cfg.window, 200_000, "fallback window must be the system default");
      assert.strictEqual(cfg.compaction_threshold, 0.60, "fallback compaction_threshold must be the system default");
    });

    // -----------------------------------------------------------------------
    // (b) 55_001 triggers; 55_000 does not; 54_999 does not — equality defined
    //     Config: { window: 100_000, compaction_threshold: 0.55 }
    //     Threshold = 100_000 × 0.55 = 55_000 (strict-greater-than, not ≥)
    // -----------------------------------------------------------------------

    test("signal 55_001 exceeds threshold (100k window, 0.55 ratio) — triggers compaction", () => {
      const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
      assert.strictEqual(
        exceedsCompactionThreshold(55_001, cfg),
        true,
        "55_001 must trigger compaction (strictly above 55_000)",
      );
    });

    test("signal 55_000 does NOT exceed threshold (equality is not enough) — no compaction", () => {
      const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
      assert.strictEqual(
        exceedsCompactionThreshold(55_000, cfg),
        false,
        "55_000 must NOT trigger compaction (equality does not trigger)",
      );
    });

    test("signal 54_999 does NOT exceed threshold — no compaction", () => {
      const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
      assert.strictEqual(
        exceedsCompactionThreshold(54_999, cfg),
        false,
        "54_999 must NOT trigger compaction",
      );
    });

    // -----------------------------------------------------------------------
    // (c) compaction event journaled with signal value and threshold
    // -----------------------------------------------------------------------

    test("journalCompactionEvent appends an event with signal and threshold to the store journal", async () => {
      const { store, cleanup } = await setupDir();
      try {
        const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
        await journalCompactionEvent({
          store,
          storyId: "s1",
          taskStem: "t1",
          taskId: "task-compact-001",
          model: "claude-opus-4",
          signalValue: 55_001,
          config: cfg,
        });

        const journal = await store.readJournal("s1", "t1");
        const event = journal.find(
          (e) =>
            typeof e === "object" &&
            e !== null &&
            "tag" in e &&
            (e as Record<string, unknown>)["tag"] === "compaction_triggered",
        );
        assert.ok(event !== undefined, "journal must contain a compaction_triggered event");
        const ev = event as Record<string, unknown>;
        assert.strictEqual(ev["signalValue"], 55_001, "event must record the signal value");
        assert.strictEqual(ev["threshold"], 55_000, "event must record the computed threshold (window × ratio)");
        assert.strictEqual(ev["model"], "claude-opus-4", "event must record the model name");
        assert.strictEqual(ev["taskId"], "task-compact-001", "event must record the taskId");
      } finally {
        await cleanup();
      }
    });
  });

  // -------------------------------------------------------------------------
  // T2 — one respawn path + equivalence
  // -------------------------------------------------------------------------

  describe("T2 — one respawn path + equivalence", () => {
    // Fake scheduler and lease views per the session/respawn seam
    class FakeSchedulerView implements SchedulerView {
      private readonly tasks: string[];
      constructor(tasks: string[]) { this.tasks = tasks; }
      pendingTaskIds(_featureId: string): string[] { return [...this.tasks]; }
    }

    class FakeLeaseView implements LeaseView {
      private readonly caps: string[];
      constructor(caps: string[]) { this.caps = caps; }
      heldBy(_taskId: string): string[] { return [...this.caps]; }
    }

    // Fake Checkpointable that writes newState to disk when checkpoint() fires
    class FakeCheckpointable {
      private store: FeatureStore;
      private storyId: string;
      private taskStem: string;
      private newState: string;
      constructor(
        store: FeatureStore,
        storyId: string,
        taskStem: string,
        newState: string,
      ) {
        this.store = store;
        this.storyId = storyId;
        this.taskStem = taskStem;
        this.newState = newState;
      }
      async checkpoint(): Promise<void> {
        await this.store.writeState(this.storyId, this.taskStem, this.newState);
      }
    }

    async function setupDirT2(initialState: string): Promise<{
      dir: string;
      store: FeatureStore;
      agentsMdPath: string;
      cleanup: () => Promise<void>;
    }> {
      const dir = await mkdtemp(join(tmpdir(), "kcompaction-t2-"));
      const store = new FeatureStore(dir);
      await store.writeFeature({
        epic: { frontmatter: { id: "e016" }, body: "epic-body" },
        runbook: "runbook-text",
        stories: [
          {
            story: { id: "s1", content: "# story" },
            tasks: [{ filename: "t1.md", frontmatter: { id: "t1" }, body: "task-body" }],
          },
        ],
      });
      await store.writeState("s1", "t1", initialState);
      const agentsMdPath = join(dir, "AGENTS.md");
      await writeFile(agentsMdPath, "agents-text", "utf8");
      return { dir, store, agentsMdPath, cleanup: () => rm(dir, { recursive: true }) };
    }

    test("threshold trigger: runCompaction calls checkpoint then produces a respawn result with matching equivalence fields", async () => {
      const initialState = "current_phase: failing_test_exists";
      const checkpointState = "current_phase: tests_pass";
      const { store, agentsMdPath, cleanup } = await setupDirT2(initialState);
      try {
        const ctx = { store, storyId: "s1", taskStem: "t1", agentsMdPath, agent: { steps: [] } };
        const session = await spawnSession(ctx);
        const tasks = ["task-alpha"];
        const caps = ["cap-x"];
        const workflow = new FakeCheckpointable(store, "s1", "t1", checkpointState);
        const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
        const result = await runCompaction({
          trigger: "threshold" as CompactionTrigger,
          ctx,
          currentSession: session,
          featureId: "e016",
          taskId: "task-compact-t2",
          schedulerView: new FakeSchedulerView(tasks),
          leaseView: new FakeLeaseView(caps),
          workflow,
          store,
          storyId: "s1",
          taskStem: "t1",
          model: "claude-opus-4",
          signalValue: 55_001,
          config: cfg,
        });
        // checkpoint was called so brief.state must be the checkpoint content
        assert.strictEqual(
          result.session.brief.state,
          checkpointState,
          "threshold: post-respawn brief.state must equal the checkpoint content",
        );
        assert.deepEqual(result.pendingTaskIds, tasks, "threshold: pendingTaskIds must be preserved");
        assert.deepEqual(result.heldCapabilityKeys, caps, "threshold: heldCapabilityKeys must be preserved");
        // compaction_triggered event must be journaled
        const journal = await store.readJournal("s1", "t1");
        const ev = journal.find(
          (e) => typeof e === "object" && e !== null && "tag" in e &&
          (e as Record<string, unknown>)["tag"] === "compaction_triggered",
        ) as Record<string, unknown> | undefined;
        assert.ok(ev !== undefined, "journal must contain a compaction_triggered event after threshold respawn");
        assert.strictEqual(ev["signalValue"], 55_001, "compaction event must record the signal value");
      } finally {
        await cleanup();
      }
    });

    test("task-boundary trigger: runCompaction skips checkpoint — post-respawn STATE equals the pre-existing on-disk STATE", async () => {
      const initialState = "current_phase: failing_test_exists";
      const { store, agentsMdPath, cleanup } = await setupDirT2(initialState);
      try {
        const ctx = { store, storyId: "s1", taskStem: "t1", agentsMdPath, agent: { steps: [] } };
        const session = await spawnSession(ctx);
        const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
        const result = await runCompaction({
          trigger: "task-boundary" as CompactionTrigger,
          ctx,
          currentSession: session,
          featureId: "e016",
          taskId: "task-compact-t2",
          schedulerView: new FakeSchedulerView([]),
          leaseView: new FakeLeaseView([]),
          store,
          storyId: "s1",
          taskStem: "t1",
          model: "claude-opus-4",
          signalValue: 10_000,
          config: cfg,
        });
        assert.strictEqual(
          result.session.brief.state,
          initialState,
          "task-boundary: post-respawn brief.state must equal the pre-existing STATE (no checkpoint)",
        );
      } finally {
        await cleanup();
      }
    });

    test("crash trigger: runCompaction skips checkpoint — post-respawn STATE equals the pre-existing on-disk STATE", async () => {
      const initialState = "current_phase: failing_test_exists";
      const { store, agentsMdPath, cleanup } = await setupDirT2(initialState);
      try {
        const ctx = { store, storyId: "s1", taskStem: "t1", agentsMdPath, agent: { steps: [] } };
        const session = await spawnSession(ctx);
        const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
        const result = await runCompaction({
          trigger: "crash" as CompactionTrigger,
          ctx,
          currentSession: session,
          featureId: "e016",
          taskId: "task-compact-t2",
          schedulerView: new FakeSchedulerView([]),
          leaseView: new FakeLeaseView([]),
          store,
          storyId: "s1",
          taskStem: "t1",
          model: "claude-opus-4",
          signalValue: 10_000,
          config: cfg,
        });
        assert.strictEqual(
          result.session.brief.state,
          initialState,
          "crash: post-respawn brief.state must equal the pre-existing STATE (no checkpoint)",
        );
      } finally {
        await cleanup();
      }
    });

    test("all three triggers produce identical equivalence-snapshot fields given the same pre-respawn conditions", async () => {
      const initialState = "current_phase: failing_test_exists";
      const [
        { store: sA, agentsMdPath: aA, cleanup: cA },
        { store: sB, agentsMdPath: aB, cleanup: cB },
        { store: sC, agentsMdPath: aC, cleanup: cC },
      ] = await Promise.all([
        setupDirT2(initialState),
        setupDirT2(initialState),
        setupDirT2(initialState),
      ]);
      try {
        const tasks = ["task-alpha", "task-beta"];
        const caps = ["cap-x", "cap-y"];
        const cfg: ModelCompactionConfig = { window: 100_000, compaction_threshold: 0.55 };
        const ctxA = { store: sA, storyId: "s1", taskStem: "t1", agentsMdPath: aA, agent: { steps: [] } };
        const ctxB = { store: sB, storyId: "s1", taskStem: "t1", agentsMdPath: aB, agent: { steps: [] } };
        const ctxC = { store: sC, storyId: "s1", taskStem: "t1", agentsMdPath: aC, agent: { steps: [] } };
        const [sessA, sessB, sessC] = await Promise.all([
          spawnSession(ctxA), spawnSession(ctxB), spawnSession(ctxC),
        ]);
        // threshold: write same initialState back via checkpoint so currentPhase stays identical
        const wfA = new FakeCheckpointable(sA, "s1", "t1", initialState);
        const [rT, rB, rC] = await Promise.all([
          runCompaction({
            trigger: "threshold" as CompactionTrigger, ctx: ctxA, currentSession: sessA,
            featureId: "e016", taskId: "task-1",
            schedulerView: new FakeSchedulerView(tasks), leaseView: new FakeLeaseView(caps),
            workflow: wfA, store: sA, storyId: "s1", taskStem: "t1",
            model: "m", signalValue: 55_001, config: cfg,
          }),
          runCompaction({
            trigger: "task-boundary" as CompactionTrigger, ctx: ctxB, currentSession: sessB,
            featureId: "e016", taskId: "task-1",
            schedulerView: new FakeSchedulerView(tasks), leaseView: new FakeLeaseView(caps),
            store: sB, storyId: "s1", taskStem: "t1",
            model: "m", signalValue: 10_000, config: cfg,
          }),
          runCompaction({
            trigger: "crash" as CompactionTrigger, ctx: ctxC, currentSession: sessC,
            featureId: "e016", taskId: "task-1",
            schedulerView: new FakeSchedulerView(tasks), leaseView: new FakeLeaseView(caps),
            store: sC, storyId: "s1", taskStem: "t1",
            model: "m", signalValue: 10_000, config: cfg,
          }),
        ]);
        assert.deepEqual(rT.pendingTaskIds, tasks, "threshold pendingTaskIds");
        assert.deepEqual(rB.pendingTaskIds, tasks, "task-boundary pendingTaskIds");
        assert.deepEqual(rC.pendingTaskIds, tasks, "crash pendingTaskIds");
        assert.deepEqual(rT.heldCapabilityKeys, caps, "threshold heldCapabilityKeys");
        assert.deepEqual(rB.heldCapabilityKeys, caps, "task-boundary heldCapabilityKeys");
        assert.deepEqual(rC.heldCapabilityKeys, caps, "crash heldCapabilityKeys");
        assert.strictEqual(rT.currentPhase, "failing_test_exists", "threshold currentPhase");
        assert.strictEqual(rB.currentPhase, "failing_test_exists", "task-boundary currentPhase");
        assert.strictEqual(rC.currentPhase, "failing_test_exists", "crash currentPhase");
      } finally {
        await Promise.all([cA(), cB(), cC()]);
      }
    });
  });
});
