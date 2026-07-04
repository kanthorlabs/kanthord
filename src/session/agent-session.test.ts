/**
 * Tests for src/session/agent-session
 * Story 002 — Agent Session (spawn / teardown / respawn)
 * Task T1 — Spawn assembles the brief; beforeToolCall always consulted
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeatureStore } from "../store/feature-store.ts";
import {
  spawnSession,
  respawnSession,
  type ToolCall,
} from "./agent-session.ts";

// ---------------------------------------------------------------------------
// Helper: write a minimal feature dir + state + AGENTS.md into a temp dir
// ---------------------------------------------------------------------------

interface SetupOpts {
  epicBody: string;
  runbook: string;
  storyId: string;
  taskStem: string;
  taskBody: string;
  state: string;
  agentsMdContent: string;
}

async function setupDir(opts: SetupOpts): Promise<{
  dir: string;
  store: FeatureStore;
  agentsMdPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "ksession-t1-"));
  const store = new FeatureStore(dir);
  await store.writeFeature({
    epic: { frontmatter: { id: "e1" }, body: opts.epicBody },
    runbook: opts.runbook,
    stories: [
      {
        story: { id: opts.storyId, content: "# index" },
        tasks: [
          {
            filename: `${opts.taskStem}.md`,
            frontmatter: { id: opts.taskStem },
            body: opts.taskBody,
          },
        ],
      },
    ],
  });
  // Write STATE for the task (requires story dir already created by writeFeature)
  await store.writeState(opts.storyId, opts.taskStem, opts.state);
  // Write AGENTS.md at a path the test controls
  const agentsMdPath = join(dir, "AGENTS.md");
  await writeFile(agentsMdPath, opts.agentsMdContent, "utf8");
  return { dir, store, agentsMdPath };
}

// ---------------------------------------------------------------------------
// Suite: brief assembly — each part must appear in the assembled brief
// ---------------------------------------------------------------------------

describe("src/session/agent-session", () => {
  describe("spawnSession — brief assembly", () => {
    test("brief contains the task body", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "epic-body",
        runbook: "runbook-text",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "TASK_BODY_UNIQUE",
        state: "state-text",
        agentsMdContent: "agents-text",
      });
      try {
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        });
        assert.ok(
          session.brief.taskBody.includes("TASK_BODY_UNIQUE"),
          `taskBody should include written task body; got: ${session.brief.taskBody}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("brief contains the epic body", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "EPIC_BODY_UNIQUE",
        runbook: "runbook-text",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "task-text",
        state: "state-text",
        agentsMdContent: "agents-text",
      });
      try {
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        });
        assert.ok(
          session.brief.epicBody.includes("EPIC_BODY_UNIQUE"),
          `epicBody should include written epic body; got: ${session.brief.epicBody}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("brief contains the RUNBOOK", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "epic-text",
        runbook: "RUNBOOK_UNIQUE",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "task-text",
        state: "state-text",
        agentsMdContent: "agents-text",
      });
      try {
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        });
        assert.ok(
          session.brief.runbook.includes("RUNBOOK_UNIQUE"),
          `runbook should include written RUNBOOK; got: ${session.brief.runbook}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("brief contains the STATE", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "epic-text",
        runbook: "runbook-text",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "task-text",
        state: "STATE_UNIQUE",
        agentsMdContent: "agents-text",
      });
      try {
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        });
        assert.ok(
          session.brief.state.includes("STATE_UNIQUE"),
          `state should include written STATE; got: ${session.brief.state}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("brief contains AGENTS.md", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "epic-text",
        runbook: "runbook-text",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "task-text",
        state: "state-text",
        agentsMdContent: "AGENTS_UNIQUE",
      });
      try {
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        });
        assert.ok(
          session.brief.agentsMd.includes("AGENTS_UNIQUE"),
          `agentsMd should include written AGENTS.md; got: ${session.brief.agentsMd}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite: teardown + respawn — reads only STATE.md + durable inputs (T2)
  // -------------------------------------------------------------------------

  describe("respawnSession — reads only STATE.md, not prior session context", () => {
    test("respawn reads updated STATE.md after teardown, not prior session in-memory state", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ksession-t2-a-"));
      const store = new FeatureStore(dir);
      const agentsMdPath = join(dir, "AGENTS.md");
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
      await store.writeState("s1", "t1", "STALE_STATE");
      await (await import("node:fs/promises")).writeFile(
        agentsMdPath,
        "agents-text",
        "utf8",
      );
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        // First session sees STALE_STATE
        const s1 = await spawnSession(ctx);
        assert.ok(
          s1.brief.state.includes("STALE_STATE"),
          `S1 brief.state should be STALE_STATE; got: ${s1.brief.state}`,
        );
        // Simulate checkpoint: update STATE.md on disk
        await store.writeState("s1", "t1", "FRESH_STATE");
        // Teardown S1 — discards in-memory context
        s1.teardown();
        // Respawn S2 — must read fresh from disk
        const s2 = await respawnSession(ctx);
        assert.ok(
          s2.brief.state.includes("FRESH_STATE"),
          `S2 brief.state should be FRESH_STATE after respawn; got: ${s2.brief.state}`,
        );
        assert.ok(
          !s2.brief.state.includes("STALE_STATE"),
          `S2 brief.state must NOT contain stale value; got: ${s2.brief.state}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("respawn brief has same durable inputs as original spawn", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ksession-t2-b-"));
      const store = new FeatureStore(dir);
      const agentsMdPath = join(dir, "AGENTS.md");
      await store.writeFeature({
        epic: { frontmatter: { id: "e1" }, body: "DURABLE_EPIC" },
        runbook: "DURABLE_RUNBOOK",
        stories: [
          {
            story: { id: "s1", content: "# index" },
            tasks: [
              {
                filename: "t1.md",
                frontmatter: { id: "t1" },
                body: "DURABLE_TASK",
              },
            ],
          },
        ],
      });
      await store.writeState("s1", "t1", "state-v1");
      await (await import("node:fs/promises")).writeFile(
        agentsMdPath,
        "DURABLE_AGENTS",
        "utf8",
      );
      try {
        const ctx = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [] },
        };
        const s1 = await spawnSession(ctx);
        s1.teardown();
        await store.writeState("s1", "t1", "state-v2");
        const s2 = await respawnSession(ctx);
        // Durable inputs unchanged
        assert.ok(
          s2.brief.taskBody.includes("DURABLE_TASK"),
          `taskBody should be durable; got: ${s2.brief.taskBody}`,
        );
        assert.ok(
          s2.brief.epicBody.includes("DURABLE_EPIC"),
          `epicBody should be durable; got: ${s2.brief.epicBody}`,
        );
        assert.ok(
          s2.brief.runbook.includes("DURABLE_RUNBOOK"),
          `runbook should be durable; got: ${s2.brief.runbook}`,
        );
        assert.ok(
          s2.brief.agentsMd.includes("DURABLE_AGENTS"),
          `agentsMd should be durable; got: ${s2.brief.agentsMd}`,
        );
        // STATE reflects the last checkpoint, not the original spawn value
        assert.ok(
          s2.brief.state.includes("state-v2"),
          `state should reflect latest checkpoint; got: ${s2.brief.state}`,
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite: beforeToolCall block enforcement — S1 regression
  // Reviewer blocker: run() must throw and stop when hook returns "block"
  // -------------------------------------------------------------------------

  describe("spawnSession — beforeToolCall block enforcement", () => {
    test("run() rejects with 'tool call blocked: <name>' when hook returns block", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "e",
        runbook: "r",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "b",
        state: "st",
        agentsMdContent: "a",
      });
      try {
        const hookInvocations: string[] = [];
        const steps: ToolCall[] = [
          { name: "write_file", args: { path: "a.ts" } },
          { name: "read_file", args: { path: "b.ts" } },
        ];
        const blockingHook = (tc: ToolCall): "allow" | "block" => {
          hookInvocations.push(tc.name);
          return tc.name === "write_file" ? "block" : "allow";
        };
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps },
          beforeToolCall: blockingHook,
        });
        // run() must reject when hook returns "block"
        await assert.rejects(
          () => session.run(),
          (err: unknown) => {
            assert.ok(
              err instanceof Error,
              `thrown value must be an Error; got: ${String(err)}`,
            );
            assert.ok(
              err.message.includes("tool call blocked") &&
                err.message.includes("write_file"),
              `error message must include 'tool call blocked' and step name; got: ${err.message}`,
            );
            return true;
          },
        );
        // Only the blocked step's hook was consulted; subsequent steps must not be reached
        assert.strictEqual(
          hookInvocations.length,
          1,
          `hook must be called exactly once (blocked step only); called ${hookInvocations.length} times`,
        );
        const firstInvocation = hookInvocations[0];
        assert.ok(firstInvocation !== undefined, "hook must have been called");
        assert.strictEqual(firstInvocation, "write_file");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite: beforeToolCall seam — always consulted, default is allow
  // -------------------------------------------------------------------------

  describe("spawnSession — beforeToolCall seam", () => {
    test("beforeToolCall is invoked for every tool call", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "e",
        runbook: "r",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "b",
        state: "st",
        agentsMdContent: "a",
      });
      try {
        const invocations: ToolCall[] = [];
        const hook = (tc: ToolCall): "allow" | "block" => {
          invocations.push(tc);
          return "allow";
        };
        const steps: ToolCall[] = [
          { name: "read_file", args: { path: "x.ts" } },
          { name: "write_file", args: { path: "y.ts", content: "" } },
        ];
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps },
          beforeToolCall: hook,
        });
        await session.run();
        assert.strictEqual(invocations.length, 2);
        assert.strictEqual(invocations[0]?.name, "read_file");
        assert.strictEqual(invocations[1]?.name, "write_file");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("beforeToolCall defaults to allow", async () => {
      // No beforeToolCall provided — the default must be allow so run() completes
      const { dir, store, agentsMdPath } = await setupDir({
        epicBody: "e",
        runbook: "r",
        storyId: "s1",
        taskStem: "t1",
        taskBody: "b",
        state: "st",
        agentsMdContent: "a",
      });
      try {
        const session = await spawnSession({
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          agent: { steps: [{ name: "noop", args: {} }] },
          // beforeToolCall intentionally omitted
        });
        // Must not reject — default allow lets all tool calls through
        await session.run();
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
