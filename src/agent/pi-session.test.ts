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
import type { AttemptEvidence } from "../scheduler/attempt-evidence.ts";

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
    // (a) manifest — spawn passes allowedToolNames unfiltered (BLOCKER-019.1
    // new contract); bash is absent from PI_DEFAULT_ALLOWED_MANIFEST because
    // that manifest was constructed without bash — not because spawn filters it.
    // -------------------------------------------------------------------------

    test("session spawned from PI_DEFAULT_ALLOWED_MANIFEST exposes exactly the six non-exec tools — bash absent by construction not by filter", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        // PI_DEFAULT_ALLOWED_MANIFEST = the six non-exec pi tools (values
        // hardcoded to avoid an extra import; the constant is asserted in
        // src/agent/pi-tools.test.ts).
        const sixNonExecTools = ["read", "grep", "find", "ls", "edit", "write"];
        const opts: PiSpawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: sixNonExecTools,
          spawnEnv: {},
        };

        await spawnPiSession(opts);

        // All six tools must pass through unchanged (no filter step at spawn)
        assert.deepStrictEqual(
          new Set(surface.lastTools),
          new Set(sixNonExecTools),
          "spawned tools must equal the six non-exec tools exactly (unfiltered pass-through)",
        );
        assert.ok(
          !surface.lastTools.includes("bash"),
          "bash must be absent — PI_DEFAULT_ALLOWED_MANIFEST excludes it by construction, not by spawn filter",
        );
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

    // -------------------------------------------------------------------------
    // RS1 — respawnPiSession must weave toolGuidance into the assembled system
    // prompt (mirrors GAP5 for spawnPiSession). PiRespawnOpts currently lacks
    // the toolGuidance field and respawnPiSession silently drops guidance on
    // crash/budget-halt respawn.
    // -------------------------------------------------------------------------

    test("RS1 — respawnPiSession assembled system prompt includes per-tool guidance block for allowed manifest", async () => {
      const { dir, store, agentsMdPath } = await setupDir({ state: "respawn-state" });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;
        const allowedTools = ["read", "grep", "find", "ls", "edit", "write"];
        const toolGuidanceMap: Record<string, string> = {
          read: "RESPAWN_TOOL_GUIDANCE_READ_SENTINEL",
          grep: "RESPAWN_TOOL_GUIDANCE_GREP_SENTINEL",
          find: "RESPAWN_TOOL_GUIDANCE_FIND_SENTINEL",
          ls: "RESPAWN_TOOL_GUIDANCE_LS_SENTINEL",
          edit: "RESPAWN_TOOL_GUIDANCE_EDIT_SENTINEL",
          write: "RESPAWN_TOOL_GUIDANCE_WRITE_SENTINEL",
          bash: "RESPAWN_BASH_GUIDANCE_SENTINEL_MUSTNOTAPPEAR",
        };
        // Cast required: toolGuidance field does not exist on PiRespawnOpts yet —
        // the SE must add it and wire it into the prompt assembly as part of RS1.
        const opts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: allowedTools,
          spawnEnv: {},
          toolGuidance: toolGuidanceMap,
        } as unknown as PiRespawnOpts;
        await respawnPiSession(opts);
        const prompt = surface.lastSystemPrompt;
        for (const toolName of allowedTools) {
          assert.ok(
            prompt.includes(toolGuidanceMap[toolName]!),
            `RS1: respawn system prompt must include guidance for allowed tool "${toolName}" — guidance block missing`,
          );
        }
        assert.ok(
          !prompt.includes("RESPAWN_BASH_GUIDANCE_SENTINEL_MUSTNOTAPPEAR"),
          "RS1: respawn system prompt must NOT include guidance for excluded tool bash",
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

  // ---------------------------------------------------------------------------
  // BLOCKER-019.1: unfiltered pass-through contract
  // spawnPiSession / respawnPiSession must NOT filter allowedToolNames — they
  // pass the caller-supplied list straight through to the spawned session's
  // `tools` field.  The bash deny is expressed at the beforeToolCall ring-1
  // seam (PI_EXEC_TOOLS), not at spawn time.  PI_DEFAULT_ALLOWED_MANIFEST
  // already excludes bash so sessions built from it remain bash-free without
  // any filter step.
  //
  // RED: these two tests currently fail because the existing code still
  // filters out bash via PI_BLOCKED_TOOL_NAMES.  They pass once the filter
  // step is removed from spawnPiSession and respawnPiSession.
  // ---------------------------------------------------------------------------

  describe("BLOCKER-019.1: spawnPiSession / respawnPiSession pass allowedToolNames unfiltered", () => {
    // The six non-exec pi tools per the taxonomy (hardcoded to avoid extra import)
    const SIX_REAL_TOOLS = ["read", "grep", "find", "ls", "edit", "write"];

    test("BLOCKER-019.1: spawnPiSession passes allowedToolNames unfiltered — bash present when supplied", async () => {
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
          allowedToolNames: [...SIX_REAL_TOOLS, "bash"],
          spawnEnv: {},
        };
        await spawnPiSession(opts);
        assert.ok(
          surface.lastTools.includes("bash"),
          "bash must be present in spawned tools when supplied (no filter step)",
        );
        assert.deepStrictEqual(
          new Set(surface.lastTools),
          new Set([...SIX_REAL_TOOLS, "bash"]),
          "spawned tools must equal the full unfiltered allowedToolNames",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("BLOCKER-019.1: respawnPiSession passes allowedToolNames unfiltered — bash present when supplied", async () => {
      const { dir, store, agentsMdPath } = await setupDir({ state: "respawn-state" });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;
        const opts: PiRespawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [...SIX_REAL_TOOLS, "bash"],
          spawnEnv: {},
        };
        await respawnPiSession(opts);
        assert.ok(
          surface.lastTools.includes("bash"),
          "bash must be present in respawned tools when supplied (no filter step)",
        );
        assert.deepStrictEqual(
          new Set(surface.lastTools),
          new Set([...SIX_REAL_TOOLS, "bash"]),
          "respawned tools must equal the full unfiltered allowedToolNames",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("T1-019.1-003: spawnPiSession passes manifest without exec tool unchanged", async () => {
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
          allowedToolNames: ["read", "edit", "write"],
          spawnEnv: {},
        };
        await spawnPiSession(opts);
        assert.deepStrictEqual(
          surface.lastTools.slice().sort(),
          ["edit", "read", "write"],
          "manifest without exec tool must pass through unchanged",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GAP5 — tool-guidance block in assembled system prompt
  // spawnPiSession must weave per-tool guidance snippets into the system prompt
  // for every tool in allowedToolNames, and must NOT include guidance for tools
  // that are NOT in allowedToolNames (e.g. bash).
  // ---------------------------------------------------------------------------

  describe("GAP5: tool-guidance block in assembled system prompt", () => {
    test("GAP5 — assembled system prompt includes per-tool guidance for each allowed tool; excludes guidance for bash", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;
        const allowedTools = ["read", "grep", "find", "ls", "edit", "write"];
        const toolGuidanceMap: Record<string, string> = {
          read: "TOOL_GUIDANCE_READ_SENTINEL: use read to view file contents",
          grep: "TOOL_GUIDANCE_GREP_SENTINEL: use grep to search patterns",
          find: "TOOL_GUIDANCE_FIND_SENTINEL: use find to locate files",
          ls: "TOOL_GUIDANCE_LS_SENTINEL: use ls to list directory contents",
          edit: "TOOL_GUIDANCE_EDIT_SENTINEL: use edit to modify existing files",
          write: "TOOL_GUIDANCE_WRITE_SENTINEL: use write to create new files",
          bash: "BASH_GUIDANCE_SENTINEL_MUSTNOTAPPEAR",
        };
        // Cast required: toolGuidance field does not exist on PiSpawnOpts yet —
        // the SE must add it as part of the GAP5 implementation.
        const opts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: allowedTools,
          spawnEnv: {},
          toolGuidance: toolGuidanceMap,
        } as unknown as PiSpawnOpts;
        await spawnPiSession(opts);
        const prompt = surface.lastSystemPrompt;
        for (const toolName of allowedTools) {
          assert.ok(
            prompt.includes(toolGuidanceMap[toolName]!),
            `GAP5: system prompt must include guidance for allowed tool "${toolName}" — guidance block missing`,
          );
        }
        assert.ok(
          !prompt.includes("BASH_GUIDANCE_SENTINEL_MUSTNOTAPPEAR"),
          "GAP5: system prompt must NOT include guidance for excluded tool bash",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Story 002 T2 (Epic 019.3) — evidence element in the spawn brief
  // ---------------------------------------------------------------------------

  describe("Story 002 T2 (Epic 019.3) — evidence element in the spawn brief", () => {
    test("Story 002 T2 (Epic 019.3) — spawn with evidence: sixth element contains summary, appears after agentsMd", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        taskBody: "TASK_BODY_T2",
        epicBody: "EPIC_BODY_T2",
        runbook: "RUNBOOK_T2",
        state: "STATE_T2",
        agentsMdContent: "AGENTS_MD_T2",
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const evidence: AttemptEvidence = {
          taskId: "t1",
          attempt: 2,
          phase: "tdd@1",
          summary: "EVIDENCE_SUMMARY_T2_SENTINEL: 3 tests failed",
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
          evidence,
        };

        await spawnPiSession(opts);
        const prompt = surface.lastSystemPrompt;

        const agentsIdx = prompt.indexOf("AGENTS_MD_T2");
        const evidenceIdx = prompt.indexOf("EVIDENCE_SUMMARY_T2_SENTINEL");
        assert.ok(agentsIdx !== -1, "agentsMd must be in the prompt");
        assert.ok(evidenceIdx !== -1, "evidence summary must be present in the prompt (sixth element)");
        assert.ok(agentsIdx < evidenceIdx, "evidence must appear after agentsMd in documented order");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("Story 002 T2 (Epic 019.3) — spawn with no evidence: brief unchanged, no evidence block", async () => {
      // Characterisation: passes on first run since no evidence block exists yet.
      // Regression guard: ensures no spurious evidence section is ever emitted
      // when evidence is absent. Sensitivity proven by the sibling test above.
      const { dir, store, agentsMdPath } = await setupDir({
        taskBody: "TASK_BODY_T2B",
        epicBody: "EPIC_BODY_T2B",
        runbook: "RUNBOOK_T2B",
        state: "STATE_T2B",
        agentsMdContent: "AGENTS_MD_T2B",
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
        await spawnPiSession(opts);
        const prompt = surface.lastSystemPrompt;

        assert.ok(prompt.includes("TASK_BODY_T2B"), "taskBody must be present");
        assert.ok(prompt.includes("EPIC_BODY_T2B"), "epicBody must be present");
        assert.ok(prompt.includes("RUNBOOK_T2B"), "runbook must be present");
        assert.ok(prompt.includes("STATE_T2B"), "state must be present");
        assert.ok(prompt.includes("AGENTS_MD_T2B"), "agentsMd must be present");
        assert.ok(
          !prompt.includes("EVIDENCE_SUMMARY_T2_SENTINEL"),
          "no evidence block when no evidence passed",
        );
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("Story 002 T2 (Epic 019.3) — respawn re-injects same evidence unchanged, after agentsMd", async () => {
      const { dir, store, agentsMdPath } = await setupDir({
        state: "RESPAWN_STATE_T2",
        agentsMdContent: "AGENTS_MD_RESPAWN_T2",
      });
      try {
        const surface = makeFakePiSurface();
        const fakeChain = async () => undefined;

        const evidence: AttemptEvidence = {
          taskId: "t1",
          attempt: 3,
          phase: "tdd@1",
          summary: "EVIDENCE_RESPAWN_T2_SENTINEL: build failed",
        };

        const opts: PiRespawnOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: fakeChain,
          piSurface: surface,
          allowedToolNames: [],
          spawnEnv: {},
          evidence,
        };

        await respawnPiSession(opts);
        const prompt = surface.lastSystemPrompt;

        assert.ok(
          prompt.includes("EVIDENCE_RESPAWN_T2_SENTINEL"),
          "respawn must re-inject the same evidence (evidence summary not found)",
        );
        const agentsIdx = prompt.indexOf("AGENTS_MD_RESPAWN_T2");
        const evidenceIdx = prompt.indexOf("EVIDENCE_RESPAWN_T2_SENTINEL");
        assert.ok(agentsIdx !== -1, "agentsMd must be in the respawn prompt");
        assert.ok(agentsIdx < evidenceIdx, "evidence must appear after agentsMd on respawn");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite: S3 — provider session wiring (Epic 019.4 review blocker)
  // Asserts that spawnPiSession/respawnPiSession carry model + streamFn
  // through to piSurface.spawnAgent when those opts are provided.
  // Drives: PiSpawnOpts.model?, PiSpawnOpts.streamFn?, PiRespawnOpts.model?,
  //         PiRespawnOpts.streamFn?, FakePiSurface.spawnAgent opts model?/streamFn?,
  //         and the piSurface.spawnAgent({...}) call threading them end-to-end.
  // -------------------------------------------------------------------------

  describe("S3 — provider session wiring (Epic 019.4)", () => {
    test("spawnPiSession forwards model and streamFn to piSurface.spawnAgent", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        let capturedModel: unknown = undefined;
        let capturedStreamFn: unknown = undefined;

        const capturingSurface: FakePiSurface = {
          spawnAgent(opts): PiSessionHandle {
            capturedModel = (opts as Record<string, unknown>)["model"];
            capturedStreamFn = (opts as Record<string, unknown>)["streamFn"];
            return {
              abort() {},
              waitForIdle() { return Promise.resolve(); },
              reset() {},
              contextTokens: 0,
            };
          },
        };

        const fakeStreamFn = async () => undefined;
        const fakeModel = { provider: "acct_s3_spawn", id: "gpt-s3-spawn" };

        const rawOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: async () => undefined,
          piSurface: capturingSurface,
          allowedToolNames: [] as string[],
          spawnEnv: {} as Record<string, string>,
          model: fakeModel,
          streamFn: fakeStreamFn,
        };
        await spawnPiSession(rawOpts as unknown as PiSpawnOpts);

        assert.strictEqual(capturedModel, fakeModel, "spawnAgent must receive the model from PiSpawnOpts");
        assert.strictEqual(capturedStreamFn, fakeStreamFn, "spawnAgent must receive the streamFn from PiSpawnOpts");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("respawnPiSession forwards model and streamFn to piSurface.spawnAgent", async () => {
      const { dir, store, agentsMdPath } = await setupDir();
      try {
        let capturedModel: unknown = undefined;
        let capturedStreamFn: unknown = undefined;

        const capturingSurface: FakePiSurface = {
          spawnAgent(opts): PiSessionHandle {
            capturedModel = (opts as Record<string, unknown>)["model"];
            capturedStreamFn = (opts as Record<string, unknown>)["streamFn"];
            return {
              abort() {},
              waitForIdle() { return Promise.resolve(); },
              reset() {},
              contextTokens: 0,
            };
          },
        };

        const fakeStreamFn = async () => undefined;
        const fakeModel = { provider: "acct_s3_respawn", id: "gpt-s3-respawn" };

        const rawOpts = {
          store,
          storyId: "s1",
          taskStem: "t1",
          agentsMdPath,
          ring1Chain: async () => undefined,
          piSurface: capturingSurface,
          allowedToolNames: [] as string[],
          spawnEnv: {} as Record<string, string>,
          model: fakeModel,
          streamFn: fakeStreamFn,
        };
        await respawnPiSession(rawOpts as unknown as PiRespawnOpts);

        assert.strictEqual(capturedModel, fakeModel, "spawnAgent must receive the model from PiRespawnOpts");
        assert.strictEqual(capturedStreamFn, fakeStreamFn, "spawnAgent must receive the streamFn from PiRespawnOpts");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
