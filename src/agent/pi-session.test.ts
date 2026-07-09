/**
 * Tests for src/agent/pi-session
 * Story 016/002 — pi Session Lifecycle
 * Task T1 — Spawn contract
 *
 * All tests use a hand-written fake pi surface (no @earendil-works packages,
 * no network calls, no credentials required in the default hermetic suite).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeatureStore } from "../store/feature-store.ts";
import {
  spawnPiSession,
  teardownPiSession,
  respawnPiSession,
  NoRing1ChainError,
  type PiSessionHandle,
  type PiSpawnOpts,
  type FakePiSurface,
  type PiTeardownOpts,
  type PiRespawnOpts,
} from "./pi-session.ts";

// ---------------------------------------------------------------------------
// Fake pi surface
// A hand-written double that records spawn arguments and exposes captured
// args for assertion; never calls a real model.
// ---------------------------------------------------------------------------

function makeFakePiSurface(): FakePiSurface & {
  lastSystemPrompt: string;
  lastTools: string[];
  lastBeforeToolCallAttached: boolean;
  lastEnv: Record<string, string>;
  lastWorktreePath: string | undefined;
  callCount: number;
} {
  let lastSystemPrompt = "";
  let lastTools: string[] = [];
  let lastBeforeToolCallAttached = false;
  let lastEnv: Record<string, string> = {};
  let lastWorktreePath: string | undefined = undefined;
  let callCount = 0;

  const surface: FakePiSurface & {
    lastSystemPrompt: string;
    lastTools: string[];
    lastBeforeToolCallAttached: boolean;
    lastEnv: Record<string, string>;
    lastWorktreePath: string | undefined;
    callCount: number;
  } = {
    get lastSystemPrompt() {
      return lastSystemPrompt;
    },
    get lastTools() {
      return lastTools;
    },
    get lastBeforeToolCallAttached() {
      return lastBeforeToolCallAttached;
    },
    get lastEnv() {
      return lastEnv;
    },
    get lastWorktreePath() {
      return lastWorktreePath;
    },
    get callCount() {
      return callCount;
    },
    spawnAgent(opts: {
      systemPrompt: string;
      tools: string[];
      beforeToolCall: unknown;
      env: Record<string, string>;
      worktreePath?: string;
    }): PiSessionHandle {
      callCount += 1;
      lastSystemPrompt = opts.systemPrompt;
      lastTools = [...opts.tools];
      lastBeforeToolCallAttached = opts.beforeToolCall !== undefined;
      lastEnv = { ...opts.env };
      lastWorktreePath = opts.worktreePath;
      return {
        abort() {},
        waitForIdle(): Promise<void> {
          return Promise.resolve();
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };
  return surface;
}

// ---------------------------------------------------------------------------
// Helpers: set up a temp feature store + AGENTS.md
// ---------------------------------------------------------------------------

interface SetupOpts {
  epicBody?: string;
  runbook?: string;
  taskBody?: string;
  state?: string;
  agentsMdContent?: string | null; // null means no AGENTS.md file on disk
}

async function setupDir(opts: SetupOpts = {}): Promise<{
  dir: string;
  store: FeatureStore;
  agentsMdPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "kpisession-t1-"));
  const store = new FeatureStore(dir);

  await store.writeFeature({
    epic: {
      frontmatter: { id: "e016" },
      body: opts.epicBody ?? "epic-body-default",
    },
    runbook: opts.runbook ?? "runbook-default",
    stories: [
      {
        story: { id: "s1", content: "# story" },
        tasks: [
          {
            filename: "t1.md",
            frontmatter: { id: "t1" },
            body: opts.taskBody ?? "task-body-default",
          },
        ],
      },
    ],
  });

  if (opts.state !== undefined) {
    await store.writeState("s1", "t1", opts.state);
  }

  const agentsMdPath = join(dir, "AGENTS.md");
  if (opts.agentsMdContent !== null) {
    await writeFile(agentsMdPath, opts.agentsMdContent ?? "agents-md-default", "utf8");
  }

  return { dir, store, agentsMdPath };
}

// ---------------------------------------------------------------------------
// Suite: spawn contract
// ---------------------------------------------------------------------------

describe("src/agent/pi-session", () => {
  // -------------------------------------------------------------------------
  // (a) brief assembly — parts injected in documented order
  // -------------------------------------------------------------------------

  describe("spawnPiSession — brief assembly", () => {
    test("system prompt contains taskBody, epicBody, runbook, state, and agentsMd in documented order", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        taskBody: "TASK_BODY_MARKER",
        epicBody: "EPIC_BODY_MARKER",
        runbook: "RUNBOOK_MARKER",
        state: "STATE_MARKER",
        agentsMdContent: "AGENTS_MD_MARKER",
      });

      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: ["read_file", "write_file"],
          spawnEnv: {},
        };

        await spawnPiSession(opts);

        const prompt = surface.lastSystemPrompt;
        // All five parts must appear in the system prompt
        assert.ok(prompt.includes("TASK_BODY_MARKER"), "missing taskBody");
        assert.ok(prompt.includes("EPIC_BODY_MARKER"), "missing epicBody");
        assert.ok(prompt.includes("RUNBOOK_MARKER"), "missing runbook");
        assert.ok(prompt.includes("STATE_MARKER"), "missing state");
        assert.ok(prompt.includes("AGENTS_MD_MARKER"), "missing agentsMd");

        // Documented order: task, epic, runbook, state, agents
        const taskIdx = prompt.indexOf("TASK_BODY_MARKER");
        const epicIdx = prompt.indexOf("EPIC_BODY_MARKER");
        const runbookIdx = prompt.indexOf("RUNBOOK_MARKER");
        const stateIdx = prompt.indexOf("STATE_MARKER");
        const agentsIdx = prompt.indexOf("AGENTS_MD_MARKER");
        assert.ok(taskIdx < epicIdx, "taskBody must precede epicBody");
        assert.ok(epicIdx < runbookIdx, "epicBody must precede runbook");
        assert.ok(runbookIdx < stateIdx, "runbook must precede state");
        assert.ok(stateIdx < agentsIdx, "state must precede agentsMd");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (a) manifest — the tool list passed to pi lacks prohibited tool names
    // -------------------------------------------------------------------------

    test("spawned tool list lacks prohibited network/exec tool names", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          // Attempt to pass network/exec tool names alongside allowed ones
          allowedToolNames: ["read_file", "fetch", "bash", "write_file"],
          spawnEnv: {},
        };

        await spawnPiSession(opts);

        // "fetch" and "bash" must be absent from the passed tool list
        assert.ok(!surface.lastTools.includes("fetch"), "fetch must be absent from tool manifest");
        assert.ok(!surface.lastTools.includes("bash"), "bash must be absent from tool manifest");
        // Safe tools pass through
        assert.ok(surface.lastTools.includes("read_file"), "read_file must be present");
        assert.ok(surface.lastTools.includes("write_file"), "write_file must be present");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (a) env — the credential env is excluded
    // -------------------------------------------------------------------------

    test("spawn env excludes credential values present in the inherited baseline", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        // Hostile baseline: contains SU4 credentials + safe vars
        const hostileEnv: Record<string, string> = {
          ANTHROPIC_API_KEY: "secret-anthropic",
          OPENAI_API_KEY: "secret-openai",
          SSH_AUTH_SOCK: "/var/run/agent.sock",
          AWS_SECRET_ACCESS_KEY: "secret-aws",
          GITHUB_TOKEN: "secret-github",
          NPM_TOKEN: "secret-npm",
          HOME: "/home/user",
          PATH: "/usr/bin:/bin",
        };

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: ["read_file"],
          spawnEnv: hostileEnv,
          safeEnvAllowlist: ["HOME", "PATH"],
        };

        await spawnPiSession(opts);

        const env = surface.lastEnv;
        // Credentials must be absent
        assert.ok(!("ANTHROPIC_API_KEY" in env), "ANTHROPIC_API_KEY must be excluded");
        assert.ok(!("OPENAI_API_KEY" in env), "OPENAI_API_KEY must be excluded");
        assert.ok(!("SSH_AUTH_SOCK" in env), "SSH_AUTH_SOCK must be excluded");
        assert.ok(!("AWS_SECRET_ACCESS_KEY" in env), "AWS_SECRET_ACCESS_KEY must be excluded");
        assert.ok(!("GITHUB_TOKEN" in env), "GITHUB_TOKEN must be excluded");
        assert.ok(!("NPM_TOKEN" in env), "NPM_TOKEN must be excluded");
        // Safe vars pass through
        assert.equal(env["HOME"], "/home/user", "HOME must pass through");
        assert.equal(env["PATH"], "/usr/bin:/bin", "PATH must pass through");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (b) spawn without ring-1 chain ⇒ NoRing1ChainError
    // -------------------------------------------------------------------------

    test("spawn without ring1Chain throws NoRing1ChainError", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();

        const opts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: undefined,
          piSurface: surface,
          allowedToolNames: ["read_file"],
          spawnEnv: {},
        } as unknown as PiSpawnOpts;

        await assert.rejects(
          () => spawnPiSession(opts),
          (err: unknown) => {
            assert.ok(err instanceof NoRing1ChainError, "must be NoRing1ChainError");
            return true;
          },
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (c) missing STATE ⇒ documented empty-state default
    // -------------------------------------------------------------------------

    test("missing STATE uses empty-state default (no throw)", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        // Deliberately NOT writing state
        state: undefined,
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
        };

        // Must not throw; state part must be empty string (or the documented default)
        await spawnPiSession(opts);
        // The system prompt must still be built and surface called
        assert.equal(surface.callCount, 1, "spawnAgent must be called exactly once");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (c) missing AGENTS.md ⇒ tolerated + journaled
    // -------------------------------------------------------------------------

    test("missing AGENTS.md is tolerated (no throw) and event is journaled", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        agentsMdContent: null, // no file on disk
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath, // points to a non-existent file
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
        };

        // Must not throw
        await spawnPiSession(opts);
        assert.equal(surface.callCount, 1, "spawnAgent must still be called");

        // A journal event noting the missing AGENTS.md must be present
        const journal = await store.readJournal("s1", "t1");
        const hasEntry = journal.some(
          (e) => typeof e === "object" && e !== null && "tag" in e &&
            (e as Record<string, unknown>)["tag"] === "agents_md_missing",
        );
        assert.ok(hasEntry, "journal must contain an agents_md_missing event");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (d) poisoned prior adapter — nothing leaks into a fresh spawn
    // -------------------------------------------------------------------------

    test("a poisoned prior session adapter leaks nothing into a fresh spawn", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        taskBody: "FRESH_TASK",
        state: "FRESH_STATE",
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        // First spawn — the "poisoned prior adapter"
        const firstOpts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          // Inject a "prior session" marker to simulate poison
          priorContext: "POISON_PRIOR_CONTEXT_DO_NOT_LEAK",
        };
        await spawnPiSession(firstOpts);

        // Second spawn — fresh, no priorContext
        const secondOpts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
        };
        await spawnPiSession(secondOpts);

        // The second spawn must not see the poisoned prior context
        assert.ok(
          !surface.lastSystemPrompt.includes("POISON_PRIOR_CONTEXT_DO_NOT_LEAK"),
          "fresh spawn must not contain prior session content",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (e) scripted model-call sequence charges the Epic 013 budget ledger
    // -------------------------------------------------------------------------

    test("a scripted model-call sequence charges the budget ledger", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        // Fake budget ledger that records charged amounts
        const chargedAmounts: number[] = [];
        const fakeBudgetLedger = {
          charge(taskId: string, tokens: number): void {
            chargedAmounts.push(tokens);
          },
        };

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          taskId: "task-ledger-test",
          budgetLedger: fakeBudgetLedger,
          // Scripted model calls to simulate token usage
          scriptedTokenUsage: [150, 200],
        };

        await spawnPiSession(opts);

        // The budget ledger must have been charged for the scripted calls
        assert.ok(chargedAmounts.length > 0, "budget ledger must be charged at least once");
        const total = chargedAmounts.reduce((a, b) => a + b, 0);
        assert.ok(total >= 150, "total charged tokens must match scripted usage");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    // -------------------------------------------------------------------------
    // (f) spawn events journaled
    // -------------------------------------------------------------------------

    test("a spawned event with taskId and sessionId is appended to the journal", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          taskId: "task-journal-test",
        };

        await spawnPiSession(opts);

        const journal = await store.readJournal("s1", "t1");
        const spawnEvent = journal.find(
          (e) =>
            typeof e === "object" &&
            e !== null &&
            "tag" in e &&
            (e as Record<string, unknown>)["tag"] === "session_spawned",
        );
        assert.ok(spawnEvent !== undefined, "journal must contain a session_spawned event");
        assert.ok(
          (spawnEvent as Record<string, unknown>)["taskId"] !== undefined,
          "session_spawned event must include taskId",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite T2: teardown / respawn through the coordinator
  // Story 016/002 — Task T2
  // -------------------------------------------------------------------------

  describe("teardownPiSession — checkpoint then destroy", () => {
    test("teardown writes STATE through the store then calls abort on the handle", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        state: "ORIGINAL_STATE",
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        // Track abort calls
        let abortCalled = false;
        const capturedHandle: PiSessionHandle = {
          abort() { abortCalled = true; },
          waitForIdle(): Promise<void> { return Promise.resolve(); },
          reset() {},
          contextTokens: 0,
        };

        // Surface that returns our tracked handle
        const trackingSurface: FakePiSurface = {
          spawnAgent(opts: {
            systemPrompt: string;
            tools: string[];
            beforeToolCall: unknown;
            env: Record<string, string>;
          }): PiSessionHandle {
            surface.spawnAgent(opts);
            return capturedHandle;
          },
        };

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: trackingSurface,
          allowedToolNames: [],
          spawnEnv: {},
        };
        const handle = await spawnPiSession(opts);

        const teardownOpts: PiTeardownOpts = {
          handle,
          store,
          storyId: "s1",
          taskStem: "t1",
          checkpointState: "CHECKPOINT_STATE",
        };
        await teardownPiSession(teardownOpts);

        // STATE must have been written via the store (checkpoint)
        const stateOnDisk = await store.readState("s1", "t1");
        assert.equal(stateOnDisk, "CHECKPOINT_STATE", "checkpoint must write state to disk");

        // abort must have been called on the handle
        assert.ok(abortCalled, "abort() must be called on the handle during teardown");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("teardown journals a session_torn_down event", async () => {
      const { dir, store, agentsMdPath } = await setupDir({});
      try {
        const fakeChain = async () => undefined;
        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: makeFakePiSurface(),
          allowedToolNames: [],
          spawnEnv: {},
          taskId: "task-teardown-journal",
        };
        const handle = await spawnPiSession(opts);
        await teardownPiSession({
          handle,
          store,
          storyId: "s1",
          taskStem: "t1",
          checkpointState: "state-after-teardown",
          taskId: "task-teardown-journal",
        });

        const journal = await store.readJournal("s1", "t1");
        const teardownEvent = journal.find(
          (e) =>
            typeof e === "object" &&
            e !== null &&
            "tag" in e &&
            (e as Record<string, unknown>)["tag"] === "session_torn_down",
        );
        assert.ok(teardownEvent !== undefined, "journal must contain a session_torn_down event");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  describe("respawnPiSession — injects only STATE + durable inputs", () => {
    test("respawn reads the new STATE from disk, not prior session content", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        taskBody: "DURABLE_TASK",
        epicBody: "DURABLE_EPIC",
        runbook: "DURABLE_RUNBOOK",
        state: "OLD_STATE",
        agentsMdContent: "DURABLE_AGENTS",
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const spawnOpts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
        };

        // First spawn
        await spawnPiSession(spawnOpts);

        // Simulate a checkpoint: write new state to disk
        await store.writeState("s1", "t1", "NEW_STATE_AFTER_CHECKPOINT");

        // Respawn — must read fresh state from disk
        const respawnOpts: PiRespawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
        };
        await respawnPiSession(respawnOpts);

        // The respawn system prompt must contain the new state
        assert.ok(
          surface.lastSystemPrompt.includes("NEW_STATE_AFTER_CHECKPOINT"),
          "respawn system prompt must contain the fresh STATE",
        );
        // The respawn must NOT contain prior-session-only content
        assert.ok(
          !surface.lastSystemPrompt.includes("OLD_STATE"),
          "respawn system prompt must NOT contain the old/stale STATE",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("respawn preserves durable inputs (taskBody, epicBody, runbook, agentsMd)", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        taskBody: "TASK_DURABLE",
        epicBody: "EPIC_DURABLE",
        runbook: "RUNBOOK_DURABLE",
        state: "state-v1",
        agentsMdContent: "AGENTS_DURABLE",
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        await store.writeState("s1", "t1", "state-v2");

        const respawnOpts: PiRespawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
        };
        await respawnPiSession(respawnOpts);

        const prompt = surface.lastSystemPrompt;
        assert.ok(prompt.includes("TASK_DURABLE"), "respawn must contain durable taskBody");
        assert.ok(prompt.includes("EPIC_DURABLE"), "respawn must contain durable epicBody");
        assert.ok(prompt.includes("RUNBOOK_DURABLE"), "respawn must contain durable runbook");
        assert.ok(prompt.includes("AGENTS_DURABLE"), "respawn must contain durable agentsMd");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("respawnPiSession journals a session_respawned event", async () => {
      const { dir, store, agentsMdPath } = await setupDir({ state: "some-state" });
      try {
        const fakeChain = async () => undefined;
        const respawnOpts: PiRespawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: makeFakePiSurface(),
          allowedToolNames: [],
          spawnEnv: {},
          taskId: "task-respawn-journal",
        };
        await respawnPiSession(respawnOpts);

        const journal = await store.readJournal("s1", "t1");
        const respawnEvent = journal.find(
          (e) =>
            typeof e === "object" &&
            e !== null &&
            "tag" in e &&
            (e as Record<string, unknown>)["tag"] === "session_respawned",
        );
        assert.ok(respawnEvent !== undefined, "journal must contain a session_respawned event");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("respawn does not leak priorContext into the new session prompt", async () => {
      const { dir, store, agentsMdPath } = await setupDir({ state: "current-state" });
      try {
        const fakeChain = async () => undefined;
        const surface = makeFakePiSurface();

        // Spawn with a poisoned priorContext
        const spawnOpts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          priorContext: "LEAKED_PRIOR_CONTEXT_MARKER",
        };
        await spawnPiSession(spawnOpts);

        // Respawn — must not see the priorContext from the previous spawn
        const respawnOpts: PiRespawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          // priorContext intentionally absent
        };
        await respawnPiSession(respawnOpts);

        assert.ok(
          !surface.lastSystemPrompt.includes("LEAKED_PRIOR_CONTEXT_MARKER"),
          "respawn must not contain priorContext from the prior spawn",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // B2 — pi session spawn seam must carry a worktree cwd/path
  // The real pi adapter needs to know the worktree directory to cd into.
  // -------------------------------------------------------------------------

  describe("spawnPiSession — worktree cwd", () => {
    test("spawnAgent receives the worktreePath from PiSpawnOpts", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: ["read_file"],
          spawnEnv: {},
          worktreePath: "/tmp/worktrees/my-task",
        };

        await spawnPiSession(opts);

        assert.equal(
          surface.lastWorktreePath,
          "/tmp/worktrees/my-task",
          "spawnAgent must receive worktreePath from the spawn opts",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("spawnAgent receives undefined worktreePath when omitted", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          // worktreePath intentionally absent
        };

        await spawnPiSession(opts);

        assert.equal(
          surface.lastWorktreePath,
          undefined,
          "spawnAgent must receive undefined worktreePath when omitted",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
