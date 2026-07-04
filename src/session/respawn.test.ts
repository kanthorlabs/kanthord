/**
 * Tests for src/session/respawn
 * Story 003 — Respawn-Equivalence (one code path)
 * Task T1 — Field-by-field equivalence after respawn
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeatureStore } from "../store/feature-store.ts";
import { spawnSession } from "./agent-session.ts";
import {
  respawnCoordinator,
  shouldTriggerThreshold,
  type RespawnRequest,
  type RespawnTrigger,
  type ModelConfig,
  type SchedulerView,
  type LeaseView,
} from "./respawn.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeSchedulerView implements SchedulerView {
  private readonly tasks: string[];
  constructor(tasks: string[]) {
    this.tasks = tasks;
  }
  pendingTaskIds(_featureId: string): string[] {
    return [...this.tasks];
  }
}

class FakeLeaseView implements LeaseView {
  private readonly caps: string[];
  constructor(caps: string[]) {
    this.caps = caps;
  }
  heldBy(_taskId: string): string[] {
    return [...this.caps];
  }
}

// ---------------------------------------------------------------------------
// Helper: write a minimal feature dir + STATE.md + AGENTS.md into a temp dir
// ---------------------------------------------------------------------------

async function setupDir(stateContent: string): Promise<{
  dir: string;
  store: FeatureStore;
  agentsMdPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "krespawn-t1-"));
  const store = new FeatureStore(dir);
  await store.writeFeature({
    epic: { frontmatter: { id: "e1" }, body: "epic-body" },
    runbook: "runbook-text",
    stories: [
      {
        story: { id: "s1", content: "# index" },
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
  await store.writeState("s1", "t1", stateContent);
  const agentsMdPath = join(dir, "AGENTS.md");
  await writeFile(agentsMdPath, "agents-text", "utf8");
  return { dir, store, agentsMdPath };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/session/respawn", () => {
  describe("T1 — field-by-field equivalence after respawn", () => {
    test("post-respawn brief STATE equals the pre-respawn checkpointed STATE", async () => {
      const stateContent = "# STATE\n\ncurrent_phase: failing_test_exists\n";
      const { dir, store, agentsMdPath } = await setupDir(stateContent);
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        const firstSession = await spawnSession(ctx);
        const req: RespawnRequest = {
          ctx,
          currentSession: firstSession,
          featureId: "e1",
          taskId: "task-1",
          schedulerView: new FakeSchedulerView([]),
          leaseView: new FakeLeaseView([]),
        };
        const result = await respawnCoordinator(req);
        assert.strictEqual(
          result.session.brief.state,
          stateContent,
          `post-respawn brief.state should equal the pre-respawn STATE; got: ${result.session.brief.state}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("post-respawn pending-task set equals the pre-respawn set", async () => {
      const { dir, store, agentsMdPath } = await setupDir(
        "current_phase: failing_test_exists",
      );
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        const firstSession = await spawnSession(ctx);
        const preTasks = ["task-alpha", "task-beta"];
        const req: RespawnRequest = {
          ctx,
          currentSession: firstSession,
          featureId: "e1",
          taskId: "task-alpha",
          schedulerView: new FakeSchedulerView(preTasks),
          leaseView: new FakeLeaseView([]),
        };
        const result = await respawnCoordinator(req);
        assert.deepEqual(
          result.pendingTaskIds,
          preTasks,
          "post-respawn pendingTaskIds should equal the pre-respawn set",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("post-respawn lease ownership equals the pre-respawn held capabilities", async () => {
      const { dir, store, agentsMdPath } = await setupDir(
        "current_phase: failing_test_exists",
      );
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        const firstSession = await spawnSession(ctx);
        const preCaps = ["write_scope:ios", "resource:db-lock"];
        const req: RespawnRequest = {
          ctx,
          currentSession: firstSession,
          featureId: "e1",
          taskId: "task-1",
          schedulerView: new FakeSchedulerView([]),
          leaseView: new FakeLeaseView(preCaps),
        };
        const result = await respawnCoordinator(req);
        assert.deepEqual(
          result.heldCapabilityKeys,
          preCaps,
          "post-respawn heldCapabilityKeys should equal the pre-respawn lease ownership",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("post-respawn currentPhase matches the checkpointed phase", async () => {
      const { dir, store, agentsMdPath } = await setupDir(
        "# STATE\n\ncurrent_phase: tests_pass\n",
      );
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        const firstSession = await spawnSession(ctx);
        const req: RespawnRequest = {
          ctx,
          currentSession: firstSession,
          featureId: "e1",
          taskId: "task-1",
          schedulerView: new FakeSchedulerView([]),
          leaseView: new FakeLeaseView([]),
        };
        const result = await respawnCoordinator(req);
        assert.strictEqual(
          result.currentPhase,
          "tests_pass",
          `post-respawn currentPhase should be "tests_pass"; got: ${result.currentPhase}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("prior-session-only in-memory key is absent from post-respawn session", async () => {
      const { dir, store, agentsMdPath } = await setupDir(
        "current_phase: failing_test_exists",
      );
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        const firstSession = await spawnSession(ctx);
        // Simulate live context set only in the prior session's in-memory state
        (firstSession as unknown as Record<string, unknown>).liveCtxKey =
          "live-model-context";
        const req: RespawnRequest = {
          ctx,
          currentSession: firstSession,
          featureId: "e1",
          taskId: "task-1",
          schedulerView: new FakeSchedulerView([]),
          leaseView: new FakeLeaseView([]),
        };
        const result = await respawnCoordinator(req);
        assert.strictEqual(
          (result.session as unknown as Record<string, unknown>).liveCtxKey,
          undefined,
          "post-respawn session must not carry any in-memory key from the prior session",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Task T2 — identical transition stages across triggers + per-model threshold
  // -------------------------------------------------------------------------

  describe("T2 — identical stages + per-model threshold", () => {
    async function setupDirT2(initialState: string): Promise<{
      dir: string;
      store: FeatureStore;
      agentsMdPath: string;
      cleanup: () => Promise<void>;
    }> {
      const dir = await mkdtemp(join(tmpdir(), "krespawn-t2-"));
      const store = new FeatureStore(dir);
      await store.writeFeature({
        epic: { frontmatter: { id: "e1" }, body: "epic-body" },
        runbook: "runbook-text",
        stories: [
          {
            story: { id: "s1", content: "# index" },
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
      await store.writeState("s1", "t1", initialState);
      const agentsMdPath = join(dir, "AGENTS.md");
      await writeFile(agentsMdPath, "agents-text", "utf8");
      return {
        dir,
        store,
        agentsMdPath,
        cleanup: () => rm(dir, { recursive: true }),
      };
    }

    // Fake checkpointable: writes newState to STATE on disk when checkpoint() is called
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

    test(
      "threshold trigger calls checkpoint before teardown — post-respawn brief STATE equals the checkpoint content",
      async () => {
        const initialState = "current_phase: failing_test_exists";
        const checkpointState = "current_phase: tests_pass";
        const { store, agentsMdPath, cleanup } = await setupDirT2(initialState);
        try {
          const ctx = {
            store,
            storyId: "s1",
            taskStem: "t1",
            agentsMdPath,
            agent: { steps: [] },
          };
          const firstSession = await spawnSession(ctx);
          const workflow = new FakeCheckpointable(
            store,
            "s1",
            "t1",
            checkpointState,
          );
          const req = {
            ctx,
            currentSession: firstSession,
            featureId: "e1",
            taskId: "task-1",
            schedulerView: new FakeSchedulerView([]),
            leaseView: new FakeLeaseView([]),
            trigger: "threshold" as RespawnTrigger,
            workflow,
          };
          const result = await respawnCoordinator(req);
          assert.strictEqual(
            result.session.brief.state,
            checkpointState,
            `threshold respawn: brief.state should equal checkpoint content; got: ${result.session.brief.state}`,
          );
        } finally {
          await cleanup();
        }
      },
    );

    test(
      "task-boundary trigger skips checkpoint — post-respawn brief STATE equals the pre-existing on-disk STATE",
      async () => {
        const initialState = "current_phase: failing_test_exists";
        const checkpointState = "current_phase: tests_pass";
        const { store, agentsMdPath, cleanup } = await setupDirT2(initialState);
        try {
          const ctx = {
            store,
            storyId: "s1",
            taskStem: "t1",
            agentsMdPath,
            agent: { steps: [] },
          };
          const firstSession = await spawnSession(ctx);
          const workflow = new FakeCheckpointable(
            store,
            "s1",
            "t1",
            checkpointState,
          );
          const req = {
            ctx,
            currentSession: firstSession,
            featureId: "e1",
            taskId: "task-1",
            schedulerView: new FakeSchedulerView([]),
            leaseView: new FakeLeaseView([]),
            trigger: "task-boundary" as RespawnTrigger,
            workflow,
          };
          const result = await respawnCoordinator(req);
          assert.strictEqual(
            result.session.brief.state,
            initialState,
            `task-boundary respawn: brief.state should equal initial STATE (no checkpoint); got: ${result.session.brief.state}`,
          );
        } finally {
          await cleanup();
        }
      },
    );

    test(
      "crash-recovery trigger skips checkpoint — post-respawn brief STATE equals the pre-existing on-disk STATE",
      async () => {
        const initialState = "current_phase: failing_test_exists";
        const checkpointState = "current_phase: tests_pass";
        const { store, agentsMdPath, cleanup } = await setupDirT2(initialState);
        try {
          const ctx = {
            store,
            storyId: "s1",
            taskStem: "t1",
            agentsMdPath,
            agent: { steps: [] },
          };
          const firstSession = await spawnSession(ctx);
          const workflow = new FakeCheckpointable(
            store,
            "s1",
            "t1",
            checkpointState,
          );
          const req = {
            ctx,
            currentSession: firstSession,
            featureId: "e1",
            taskId: "task-1",
            schedulerView: new FakeSchedulerView([]),
            leaseView: new FakeLeaseView([]),
            trigger: "crash" as RespawnTrigger,
            workflow,
          };
          const result = await respawnCoordinator(req);
          assert.strictEqual(
            result.session.brief.state,
            initialState,
            `crash respawn: brief.state should equal initial STATE (no checkpoint); got: ${result.session.brief.state}`,
          );
        } finally {
          await cleanup();
        }
      },
    );

    test(
      "all three triggers produce the same equivalence-snapshot fields given identical pre-respawn conditions",
      async () => {
        const initialState = "current_phase: failing_test_exists";
        const [
          { store: storeA, agentsMdPath: amdA, cleanup: cleanA },
          { store: storeB, agentsMdPath: amdB, cleanup: cleanB },
          { store: storeC, agentsMdPath: amdC, cleanup: cleanC },
        ] = await Promise.all([
          setupDirT2(initialState),
          setupDirT2(initialState),
          setupDirT2(initialState),
        ]);
        try {
          const tasks = ["task-alpha", "task-beta"];
          const caps = ["cap-x", "cap-y"];
          const ctxA = {
            store: storeA,
            storyId: "s1",
            taskStem: "t1",
            agentsMdPath: amdA,
            agent: { steps: [] },
          };
          const ctxB = {
            store: storeB,
            storyId: "s1",
            taskStem: "t1",
            agentsMdPath: amdB,
            agent: { steps: [] },
          };
          const ctxC = {
            store: storeC,
            storyId: "s1",
            taskStem: "t1",
            agentsMdPath: amdC,
            agent: { steps: [] },
          };
          const [sessA, sessB, sessC] = await Promise.all([
            spawnSession(ctxA),
            spawnSession(ctxB),
            spawnSession(ctxC),
          ]);
          // Threshold: checkpoint writes the same STATE so currentPhase stays identical
          const wfA = new FakeCheckpointable(storeA, "s1", "t1", initialState);
          const reqThreshold = {
            ctx: ctxA,
            currentSession: sessA,
            featureId: "e1",
            taskId: "task-1",
            schedulerView: new FakeSchedulerView(tasks),
            leaseView: new FakeLeaseView(caps),
            trigger: "threshold" as RespawnTrigger,
            workflow: wfA,
          };
          const reqTaskBoundary = {
            ctx: ctxB,
            currentSession: sessB,
            featureId: "e1",
            taskId: "task-1",
            schedulerView: new FakeSchedulerView(tasks),
            leaseView: new FakeLeaseView(caps),
            trigger: "task-boundary" as RespawnTrigger,
          };
          const reqCrash = {
            ctx: ctxC,
            currentSession: sessC,
            featureId: "e1",
            taskId: "task-1",
            schedulerView: new FakeSchedulerView(tasks),
            leaseView: new FakeLeaseView(caps),
            trigger: "crash" as RespawnTrigger,
          };
          const [rThreshold, rTaskBoundary, rCrash] = await Promise.all([
            respawnCoordinator(reqThreshold),
            respawnCoordinator(reqTaskBoundary),
            respawnCoordinator(reqCrash),
          ]);
          assert.deepEqual(
            rThreshold.pendingTaskIds,
            tasks,
            "threshold pendingTaskIds",
          );
          assert.deepEqual(
            rTaskBoundary.pendingTaskIds,
            tasks,
            "task-boundary pendingTaskIds",
          );
          assert.deepEqual(
            rCrash.pendingTaskIds,
            tasks,
            "crash pendingTaskIds",
          );
          assert.deepEqual(
            rThreshold.heldCapabilityKeys,
            caps,
            "threshold heldCapabilityKeys",
          );
          assert.deepEqual(
            rTaskBoundary.heldCapabilityKeys,
            caps,
            "task-boundary heldCapabilityKeys",
          );
          assert.deepEqual(
            rCrash.heldCapabilityKeys,
            caps,
            "crash heldCapabilityKeys",
          );
          assert.strictEqual(
            rThreshold.currentPhase,
            "failing_test_exists",
            "threshold currentPhase",
          );
          assert.strictEqual(
            rTaskBoundary.currentPhase,
            "failing_test_exists",
            "task-boundary currentPhase",
          );
          assert.strictEqual(
            rCrash.currentPhase,
            "failing_test_exists",
            "crash currentPhase",
          );
        } finally {
          await Promise.all([cleanA(), cleanB(), cleanC()]);
        }
      },
    );

    test(
      "shouldTriggerThreshold returns true when reported size exceeds the 55%-window threshold for model A",
      () => {
        // Model A: windowTokens=1000, compactionRatio=0.55 → threshold=550
        const modelA: ModelConfig = { windowTokens: 1000, compactionRatio: 0.55 };
        assert.strictEqual(
          shouldTriggerThreshold(600, modelA),
          true,
          "size 600 > threshold 550: should trigger for model A",
        );
      },
    );

    test(
      "shouldTriggerThreshold returns false when reported size is below the larger model B threshold",
      () => {
        // Model B: windowTokens=2000, compactionRatio=0.55 → threshold=1100
        const modelB: ModelConfig = { windowTokens: 2000, compactionRatio: 0.55 };
        assert.strictEqual(
          shouldTriggerThreshold(600, modelB),
          false,
          "size 600 < threshold 1100: should not trigger for model B",
        );
      },
    );
  });
});
