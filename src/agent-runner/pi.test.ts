/**
 * Story 05 T1 (a)-(h),(j),(m) — PiAgentRunner hermetic tests
 *
 * Uses FakeSessionFactory + fake WorkspaceManager + stub getResource +
 * synthetic PiAgentProfiles. No network, no real git, no real pi model calls.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PiAgentRunner } from "./pi.ts";
import { FakeSessionFactory } from "./fake-session.ts";
import type { FakeTurn } from "./fake-session.ts";
import { CredentialError } from "./pi-session.ts";
import type { ProviderSessionFactory } from "./pi-session.ts";
import type { Workspace } from "../workspace/port.ts";
import type {
  Repository,
  Credential,
  AIProvider,
  Resource,
  Filesystem,
} from "../domain/resource.ts";
import type { Task } from "../domain/task.ts";
import type { TaskContextBinding } from "./port.ts";
import type { PiAgentRunnerOptions } from "./pi.ts";

// ---------------------------------------------------------------------------
// Local structural types (no import from non-existent ports yet)
// ---------------------------------------------------------------------------

type Instruction = { path: string; content: string };
type InstructionLoader = { load(): Instruction[] };

// Structural shape matching the Story 05 PiAgentProfile spec.
// The verify method is stubbed (story 06 defines OutcomeEvidence/VerificationResult).
type SyntheticProfile = {
  name: string;
  systemPrompt(input: {
    task: Task;
    workspace: Workspace;
    instructions: Instruction[];
  }): string;
  createTools(input: { workspace: Workspace }): Array<{ name: string }>;
  verify(evidence: unknown): Promise<{ accepted: boolean }>;
};

// ---------------------------------------------------------------------------
// Real git workspace setup — FakeWorkspaceManager must hand the runner a real
// on-disk git repo so Story 06 post-run git steps (computeEvidence, finalize)
// succeed. Mirror the pattern from verification.test.ts.
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFileCb);

let tmpPiRoot: string = "";
let realGitDir: string = "";
let realBaseCommit: string = "";

before(async () => {
  tmpPiRoot = await mkdtemp(join(tmpdir(), "kanthord-pi-"));
  realGitDir = join(tmpPiRoot, "ws");
  await mkdir(realGitDir, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: realGitDir });
  await execFileAsync("git", ["config", "user.email", "test@localhost"], {
    cwd: realGitDir,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], {
    cwd: realGitDir,
  });
  await writeFile(join(realGitDir, "README.md"), "# seed");
  await execFileAsync("git", ["add", "."], { cwd: realGitDir });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: realGitDir });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: realGitDir,
  });
  realBaseCommit = stdout.trim();
});

after(async () => {
  if (tmpPiRoot) await rm(tmpPiRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AI_PROVIDER: AIProvider = {
  id: "ai-001",
  type: "ai_provider",
  name: "openai",
  provider: "openai",
  model: "gpt-5.5",
};

const CREDENTIAL: Credential = {
  id: "cred-001",
  type: "credential",
  name: "openai-key",
  provider: "openai",
  value: "sk-test",
};

const REPO: Repository = {
  id: "repo-001",
  type: "repository",
  name: "sandbox",
  remoteUrl: "https://github.com/org/sandbox.git",
  branch: "main",
  path: "/home/user/.kanthord/repos/org/sandbox",
  auth: { kind: "ambient" },
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    objectiveId: "obj-001",
    title: "Add a feature",
    status: "running",
    dependencies: [],
    agent: "synthetic@1",
    instructions: "Do the thing carefully",
    ac: ["it works"],
    ...overrides,
  };
}

function makeContext(
  opts: { ai?: boolean; cred?: boolean; repo?: boolean; fs?: boolean } = {},
): TaskContextBinding[] {
  const { ai = true, cred = true, repo = true, fs = false } = opts;
  const ctx: TaskContextBinding[] = [];
  if (ai) ctx.push({ type: "ai_provider", resourceId: AI_PROVIDER.id });
  if (cred) ctx.push({ type: "credential", resourceId: CREDENTIAL.id });
  if (repo) ctx.push({ type: "repository", resourceId: REPO.id });
  if (fs) ctx.push({ type: "filesystem", resourceId: "fs-001" });
  return ctx;
}

function makeGetResource(
  extra: Resource[] = [],
): (id: string) => Resource | undefined {
  const resources: Resource[] = [AI_PROVIDER, CREDENTIAL, REPO, ...extra];
  return (id: string) => resources.find((r) => r.id === id);
}

function makeSyntheticProfile(
  name: string,
  systemPromptFn?: SyntheticProfile["systemPrompt"],
): SyntheticProfile {
  return {
    name,
    systemPrompt:
      systemPromptFn ??
      (({
        task,
      }: {
        task: Task;
        workspace: Workspace;
        instructions: Instruction[];
      }) => `System prompt for ${task.title} [${name}]`),
    createTools: (_: { workspace: Workspace }) => [],
    verify: async (_: unknown) => ({ accepted: true }),
  };
}

/** FakeWorkspaceManager records prepare calls and returns a real on-disk git
 * workspace (dir = realGitDir, baseCommit = real HEAD sha). This lets Story 06
 * post-run git steps (computeEvidence, finalize) succeed without a real
 * LocalWorkspaceManager. The dir is populated by the before() hook above. */
class FakeWorkspaceManager {
  readonly calls: Array<{ taskId: string; source: unknown }> = [];

  async prepare(taskId: string, source: unknown): Promise<Workspace> {
    this.calls.push({ taskId, source });
    return {
      dir: realGitDir,
      branch: "kanthord/task-001",
      baseCommit: realBaseCommit,
    };
  }
}

/** Build a ProviderSessionFactory backed by a FakeSessionFactory with given turns. */
function makeSessionFactory(
  turns: FakeTurn[],
  captureCtx?: (ctx: unknown) => void,
): ProviderSessionFactory {
  return {
    async for(_ai: AIProvider, _cred: Credential) {
      const fake = new FakeSessionFactory(turns);
      const streamFn = captureCtx
        ? (model: unknown, context: unknown, opts?: unknown) => {
            captureCtx(context);
            return (fake.streamFn as Function)(model, context, opts);
          }
        : fake.streamFn;
      return {
        model: {} as unknown as any,
        streamFn: streamFn as unknown as any,
        getApiKey: () => "fake-key",
      } as unknown as any;
    },
  };
}

function makeRunner(
  opts: {
    sessions?: ProviderSessionFactory;
    workspaces?: FakeWorkspaceManager;
    profiles?: Map<string, SyntheticProfile>;
    newInstructionLoader?: (dir: string) => InstructionLoader;
    getResource?: (id: string) => Resource | undefined;
    getPriorRejection?: (
      taskId: string,
    ) =>
      { reason: string; summary?: string; proposalCommit?: string } | undefined;
  } = {},
) {
  const profiles =
    opts.profiles ??
    new Map([["synthetic@1", makeSyntheticProfile("synthetic@1")]]);
  return new PiAgentRunner({
    sessions: opts.sessions ?? makeSessionFactory([{ text: "done" }]),
    workspaces: opts.workspaces ?? new FakeWorkspaceManager(),
    newInstructionLoader:
      opts.newInstructionLoader ?? ((_dir: string) => ({ load: () => [] })),
    getResource: opts.getResource ?? makeGetResource(),
    profiles: profiles as unknown as any,
    getPriorRejection: opts.getPriorRejection ?? (() => undefined),
  });
}

// ---------------------------------------------------------------------------
// (a) Happy path
// ---------------------------------------------------------------------------

test("PiAgentRunner happy path: completed result, prepare called with repository source", async () => {
  const wm = new FakeWorkspaceManager();
  const runner = makeRunner({
    sessions: makeSessionFactory([{ text: "done" }]),
    workspaces: wm,
  });

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "completed", "task completed");
  assert.equal(wm.calls.length, 1, "prepare called once");
  const call = wm.calls[0];
  assert.ok(call !== undefined, "prepare call recorded");
  assert.equal(
    (call.source as Repository | undefined)?.type,
    "repository",
    "repository source passed to prepare",
  );
});

// ---------------------------------------------------------------------------
// (b) Missing credential binding
// ---------------------------------------------------------------------------

test("PiAgentRunner missing credential binding: failed with CredentialError prefix, session factory not called", async () => {
  let sessionFactoryCalled = false;
  const sessions: ProviderSessionFactory = {
    async for() {
      sessionFactoryCalled = true;
      return {} as unknown as any;
    },
  };
  const runner = makeRunner({ sessions });

  const result = await runner.run(makeTask(), makeContext({ cred: false }));

  assert.equal(result.outcome, "failed");
  assert.ok(
    (result as unknown as { reason: string }).reason.startsWith(
      "CredentialError",
    ),
    `reason should start with CredentialError, got: ${(result as unknown as { reason: string }).reason}`,
  );
  assert.equal(
    sessionFactoryCalled,
    false,
    "session factory not called before credential check",
  );
});

// ---------------------------------------------------------------------------
// (c) Factory throws CredentialError → failed, prepare NOT called
// ---------------------------------------------------------------------------

test("PiAgentRunner factory CredentialError: failed, prepare not called", async () => {
  const wm = new FakeWorkspaceManager();
  const sessions: ProviderSessionFactory = {
    async for() {
      throw new CredentialError(
        "openai-key",
        "anthropic",
        "provider mismatch: anthropic vs openai",
      );
    },
  };
  const runner = makeRunner({ sessions, workspaces: wm });

  const result = await runner.run(makeTask(), makeContext());

  assert.equal(result.outcome, "failed");
  assert.ok(
    (result as unknown as { reason: string }).reason.startsWith(
      "CredentialError",
    ),
    `reason should start with CredentialError, got: ${(result as unknown as { reason: string }).reason}`,
  );
  assert.equal(
    wm.calls.length,
    0,
    "prepare not called when session factory throws",
  );
});

// ---------------------------------------------------------------------------
// (d) No repo/fs binding → WorkspaceUnresolvableError
//     Both repo + fs bindings → InvalidContextError
// ---------------------------------------------------------------------------

test("PiAgentRunner no repo or fs binding: failed WorkspaceUnresolvableError", async () => {
  const runner = makeRunner();

  const result = await runner.run(makeTask(), makeContext({ repo: false }));

  assert.equal(result.outcome, "failed");
  assert.ok(
    (result as unknown as { reason: string }).reason.startsWith(
      "WorkspaceUnresolvableError",
    ),
    `reason should start with WorkspaceUnresolvableError, got: ${(result as unknown as { reason: string }).reason}`,
  );
});

test("PiAgentRunner both repo and fs bindings: failed InvalidContextError", async () => {
  const runner = makeRunner();

  const ctx = [...makeContext(), { type: "filesystem", resourceId: "fs-001" }];
  const result = await runner.run(makeTask(), ctx);

  assert.equal(result.outcome, "failed");
  assert.ok(
    (result as unknown as { reason: string }).reason.startsWith(
      "InvalidContextError",
    ),
    `reason should start with InvalidContextError, got: ${(result as unknown as { reason: string }).reason}`,
  );
});

// ---------------------------------------------------------------------------
// (e) Unknown profile key → failed UnknownAgentError
// ---------------------------------------------------------------------------

test("PiAgentRunner unknown profile key: failed UnknownAgentError", async () => {
  const runner = makeRunner();

  const result = await runner.run(
    makeTask({ agent: "ghost@9" }),
    makeContext(),
  );

  assert.equal(result.outcome, "failed");
  assert.ok(
    (result as unknown as { reason: string }).reason.startsWith(
      "UnknownAgentError",
    ),
    `reason should start with UnknownAgentError, got: ${(result as unknown as { reason: string }).reason}`,
  );
});

// ---------------------------------------------------------------------------
// (f) Scripted stream rejection → failed, runner resolves not throws
// ---------------------------------------------------------------------------

test("PiAgentRunner stream rejection: failed, runner resolves not throws", async () => {
  const sessions: ProviderSessionFactory = {
    async for() {
      return {
        model: {} as unknown as any,
        streamFn: () => {
          throw new Error("provider failed: connection refused");
        },
        getApiKey: () => "key",
      } as unknown as any;
    },
  };
  const runner = makeRunner({ sessions });

  const result = await runner.run(makeTask(), makeContext());

  assert.equal(
    result.outcome,
    "failed",
    "runner resolves to failed (does not throw)",
  );
  assert.ok(
    (result as unknown as { reason: string }).reason.includes(
      "provider failed",
    ),
    `reason should contain the error message, got: ${(result as unknown as { reason: string }).reason}`,
  );
});

// ---------------------------------------------------------------------------
// (g) Two synthetic profiles → different system prompts through same runner
// ---------------------------------------------------------------------------

test("PiAgentRunner two profiles produce different system prompts through same runner instance", async () => {
  const capturedPrompts: string[] = [];

  const sessions: ProviderSessionFactory = {
    async for() {
      const fake = new FakeSessionFactory([{ text: "done" }]);
      const streamFn = (model: unknown, context: unknown, opts?: unknown) => {
        capturedPrompts.push(
          (context as { systemPrompt?: string }).systemPrompt ?? "",
        );
        return (fake.streamFn as Function)(model, context, opts);
      };
      return {
        model: {} as unknown as any,
        streamFn: streamFn as unknown as any,
        getApiKey: () => "key",
      } as unknown as any;
    },
  };

  const profileA = makeSyntheticProfile(
    "alpha@1",
    ({
      task,
    }: {
      task: Task;
      workspace: Workspace;
      instructions: Instruction[];
    }) => `ALPHA system prompt: ${task.title}`,
  );
  const profileB = makeSyntheticProfile(
    "beta@1",
    ({
      task,
    }: {
      task: Task;
      workspace: Workspace;
      instructions: Instruction[];
    }) => `BETA system prompt: ${task.title}`,
  );

  const profiles = new Map([
    ["alpha@1", profileA],
    ["beta@1", profileB],
  ]);

  const runner = makeRunner({ sessions, profiles });

  await runner.run(makeTask({ agent: "alpha@1" }), makeContext());
  await runner.run(makeTask({ agent: "beta@1" }), makeContext());

  assert.equal(capturedPrompts.length, 2, "two runs captured");
  assert.ok(
    capturedPrompts[0]?.includes("ALPHA"),
    `first prompt should contain ALPHA, got: ${capturedPrompts[0]}`,
  );
  assert.ok(
    capturedPrompts[1]?.includes("BETA"),
    `second prompt should contain BETA, got: ${capturedPrompts[1]}`,
  );
  assert.notEqual(
    capturedPrompts[0],
    capturedPrompts[1],
    "two profiles produce different system prompts",
  );
});

// ---------------------------------------------------------------------------
// (h) escalate tool: parks as awaiting_confirmation, records reason,
//     no further scripted turns consumed
// ---------------------------------------------------------------------------

test("PiAgentRunner escalate tool: scripted call results in escalated outcome recording reason", async () => {
  const runner = makeRunner({
    sessions: makeSessionFactory([
      {
        toolCalls: [
          {
            name: "escalate",
            arguments: { reason: "need human review of my changes" },
          },
        ],
      },
      { text: "this should NOT be consumed after escalate" },
    ]),
  });

  const result = await runner.run(makeTask(), makeContext());

  assert.equal(
    result.outcome,
    "escalated",
    "task outcome is escalated (Story 06 renames awaiting_confirmation)",
  );
  assert.ok(
    (result as unknown as { reason: string }).reason.includes(
      "need human review",
    ),
    `escalation reason should be recorded, got: ${(result as unknown as { reason: string }).reason}`,
  );
});

// ---------------------------------------------------------------------------
// (j) getPriorRejection feedback block
// ---------------------------------------------------------------------------

test("PiAgentRunner getPriorRejection returns decision: prompt contains feedback block with reason and summary", async () => {
  let capturedMessages: Array<{ role: string; content: unknown }> = [];

  const sessions: ProviderSessionFactory = {
    async for() {
      const fake = new FakeSessionFactory([{ text: "done" }]);
      const streamFn = (model: unknown, context: unknown, opts?: unknown) => {
        const ctx = context as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        capturedMessages = ctx.messages ?? [];
        return (fake.streamFn as Function)(model, context, opts);
      };
      return {
        model: {} as unknown as any,
        streamFn: streamFn as unknown as any,
        getApiKey: () => "key",
      } as unknown as any;
    },
  };

  const runner = makeRunner({
    sessions,
    getPriorRejection: (taskId: string) => {
      if (taskId === "task-001") {
        return {
          reason: "human rejected: the implementation is broken",
          summary: "the commit introduced test failures",
        };
      }
      return undefined;
    },
  });

  await runner.run(makeTask(), makeContext());

  // The user message prompt should contain the rejection feedback block
  const userMsgs = capturedMessages.filter((m) => m.role === "user");
  const promptText = userMsgs
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as Array<{ text?: string }>)
          .map((c) => c.text ?? "")
          .join("");
      }
      return "";
    })
    .join("\n");

  assert.ok(
    promptText.includes("human rejected: the implementation is broken"),
    `prompt should contain rejection reason, got snippet: ${promptText.slice(0, 300)}`,
  );
  assert.ok(
    promptText.includes("the commit introduced test failures"),
    `prompt should contain prior summary, got snippet: ${promptText.slice(0, 300)}`,
  );
});

test("PiAgentRunner getPriorRejection returns undefined: prompt contains no feedback block", async () => {
  let capturedMessages: Array<{ role: string; content: unknown }> = [];

  const sessions: ProviderSessionFactory = {
    async for() {
      const fake = new FakeSessionFactory([{ text: "done" }]);
      const streamFn = (model: unknown, context: unknown, opts?: unknown) => {
        const ctx = context as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        capturedMessages = ctx.messages ?? [];
        return (fake.streamFn as Function)(model, context, opts);
      };
      return {
        model: {} as unknown as any,
        streamFn: streamFn as unknown as any,
        getApiKey: () => "key",
      } as unknown as any;
    },
  };

  const runner = makeRunner({ sessions, getPriorRejection: () => undefined });

  await runner.run(makeTask(), makeContext());

  const userMsgs = capturedMessages.filter((m) => m.role === "user");
  const promptText = userMsgs
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as Array<{ text?: string }>)
          .map((c) => c.text ?? "")
          .join("");
      }
      return "";
    })
    .join("\n");

  assert.ok(
    !promptText.includes("rejected"),
    `prompt should not contain rejection text when no prior rejection, got snippet: ${promptText.slice(0, 300)}`,
  );
});

// ---------------------------------------------------------------------------
// (m) Profile placement: runner passes instructions; profile decides placement
// ---------------------------------------------------------------------------

test("PiAgentRunner profile placement: placing profile puts instructions in project_context, ignoring profile does not", async () => {
  const instructions: Instruction[] = [
    { path: "AGENTS.md", content: "be careful with tests" },
  ];
  const capturedPrompts: string[] = [];

  const sessions: ProviderSessionFactory = {
    async for() {
      const fake = new FakeSessionFactory([{ text: "done" }]);
      const streamFn = (model: unknown, context: unknown, opts?: unknown) => {
        capturedPrompts.push(
          (context as { systemPrompt?: string }).systemPrompt ?? "",
        );
        return (fake.streamFn as Function)(model, context, opts);
      };
      return {
        model: {} as unknown as any,
        streamFn: streamFn as unknown as any,
        getApiKey: () => "key",
      } as unknown as any;
    },
  };

  const placingProfile = makeSyntheticProfile(
    "placing@1",
    ({
      instructions: instr,
    }: {
      task: Task;
      workspace: Workspace;
      instructions: Instruction[];
    }) => {
      const base = "base system prompt";
      if (instr.length === 0) return base;
      const ctx = instr.map((i) => i.content).join("\n");
      return `${base}\n<project_context>\n${ctx}\n</project_context>`;
    },
  );
  const ignoringProfile = makeSyntheticProfile(
    "ignoring@1",
    (_: { task: Task; workspace: Workspace; instructions: Instruction[] }) =>
      "fixed system prompt without any context",
  );

  const profiles = new Map([
    ["placing@1", placingProfile],
    ["ignoring@1", ignoringProfile],
  ]);

  const runner = makeRunner({
    sessions,
    profiles,
    newInstructionLoader: (_dir: string) => ({ load: () => instructions }),
  });

  await runner.run(makeTask({ agent: "placing@1" }), makeContext());
  await runner.run(makeTask({ agent: "ignoring@1" }), makeContext());

  assert.equal(capturedPrompts.length, 2, "two runs captured");
  assert.ok(
    capturedPrompts[0]?.includes("<project_context>"),
    "placing profile: system prompt contains <project_context>",
  );
  assert.ok(
    capturedPrompts[0]?.includes("be careful with tests"),
    "placing profile: system prompt contains instruction content",
  );
  assert.ok(
    !capturedPrompts[1]?.includes("<project_context>"),
    "ignoring profile: system prompt has no <project_context> block",
  );
});

// ---------------------------------------------------------------------------
// Story 08 T1 — Event emission, throttle, redaction
// ---------------------------------------------------------------------------

// A no-op file-search tool for emission tests (registered so tool_execution_start fires)
const SEARCH_PARAMS_08 = Type.Object({ path: Type.String() });
const searchTool08: AgentTool<typeof SEARCH_PARAMS_08> = {
  name: "search_files",
  label: "Search files",
  description: "Search files in the workspace",
  parameters: SEARCH_PARAMS_08,
  execute: async (_id, params) => ({
    content: [
      { type: "text" as const, text: `found results for: ${params.path}` },
    ],
    details: {},
  }),
};

// Synthetic profile that registers search_files (for emission tests)
const profileWithSearch08: SyntheticProfile = {
  name: "synthetic@1",
  systemPrompt: ({
    task,
  }: {
    task: Task;
    workspace: Workspace;
    instructions: Instruction[];
  }) => `System for ${task.title}`,
  createTools: (_: { workspace: Workspace }) => [
    searchTool08 as unknown as { name: string },
  ],
  verify: async (_: unknown) => ({ accepted: true }),
};

// Captured emission event record
type EmitRecord08 = {
  taskId: string;
  type: string;
  payload: Record<string, string>;
};

/**
 * Build a PiAgentRunner with a recording emit function and optional fake clock.
 * The `emit` and `clock` options are Story 08 seams not yet in PiAgentRunnerOptions.
 * They are passed via a cast to silence TypeScript until the SE adds the fields.
 */
function makeEmitRunner08(
  turns: FakeTurn[],
  emitted: EmitRecord08[],
  clock?: () => number,
  profile?: SyntheticProfile,
  getResource?: (id: string) => Resource | undefined,
) {
  const recordingEmit = (
    taskId: string,
    type: string,
    payload: Record<string, string>,
  ) => {
    emitted.push({ taskId, type, payload });
  };
  const p = profile ?? profileWithSearch08;
  return new PiAgentRunner({
    sessions: makeSessionFactory(turns),
    workspaces: new FakeWorkspaceManager(),
    newInstructionLoader: (_dir: string) => ({ load: () => [] }),
    getResource: getResource ?? makeGetResource(),
    profiles: new Map([
      ["synthetic@1", p],
    ]) as unknown as PiAgentRunnerOptions["profiles"],
    getPriorRejection: () => undefined,
    // Story 08 seams — not yet in PiAgentRunnerOptions; constructor ignores until SE adds them
    emit: recordingEmit,
    clock: clock ?? (() => 0),
  } as unknown as PiAgentRunnerOptions);
}

// (a) Happy run: agent.started → agent.progress ≥ 1 → agent.finished{completed}, all with task id

test("(a) happy run: emits agent.started, agent.progress, agent.finished in order, each with task id", async () => {
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [
    { toolCalls: [{ name: "search_files", arguments: { path: "/src" } }] },
    { text: "task complete" },
  ];
  const runner = makeEmitRunner08(turns, emitted);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "completed", "outcome should be completed");
  const types = emitted.map((e) => e.type);
  assert.ok(
    types.includes("agent.started"),
    `agent.started missing from emitted: [${types}]`,
  );
  assert.ok(
    types.includes("agent.progress"),
    `agent.progress missing from emitted: [${types}]`,
  );
  assert.ok(
    types.includes("agent.finished"),
    `agent.finished missing from emitted: [${types}]`,
  );
  const startedIdx = types.indexOf("agent.started");
  const firstProgressIdx = types.indexOf("agent.progress");
  const finishedIdx = types.indexOf("agent.finished");
  assert.ok(
    startedIdx < firstProgressIdx,
    "agent.started must precede agent.progress",
  );
  assert.ok(
    firstProgressIdx < finishedIdx,
    "agent.progress must precede agent.finished",
  );
  for (const e of emitted) {
    assert.equal(
      e.taskId,
      "task-001",
      `every event must carry task id, got: ${e.taskId}`,
    );
  }
});

// (b) Un-throttled capture: every tool call produces an agent.progress emission (no gate in pi.ts)
// Pre-migrated from the old throttle test — after A3, pi.ts emits on every tool_execution_start.

test("(b) no capture-throttle: 4 tool calls (3 + 1 across turns) produce 4 agent.progress emissions", async () => {
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [
    {
      toolCalls: [
        { name: "search_files", arguments: { path: "/a" } },
        { name: "search_files", arguments: { path: "/b" } },
        { name: "search_files", arguments: { path: "/c" } },
      ],
    },
    { toolCalls: [{ name: "search_files", arguments: { path: "/d" } }] },
    { text: "done" },
  ];
  // No clock injection needed — throttle is removed from pi.ts; emit fires on every tool call.
  const runner = makeEmitRunner08(turns, emitted);

  await runner.run(makeTask({ agent: "synthetic@1" }), makeContext());

  const progressEvents = emitted.filter((e) => e.type === "agent.progress");
  assert.equal(
    progressEvents.length,
    4,
    `expected 4 agent.progress emissions (one per tool call, no capture throttle); got ${progressEvents.length}`,
  );
});

// (A3) Un-throttled capture: 3 tool_execution_start events in 1000 ms → 3 agent.progress
// Fails today: the 1-per-5s gate in pi.ts allows only 1.

test("(A3) un-throttled: 3 tool_execution_start events within 1000 ms each produce an agent.progress emission", async () => {
  const emitted: EmitRecord08[] = [];
  // Clock advances 100 ms per call — all within the old 5000 ms window.
  // After A3 the clock is not consulted; the test verifies all 3 are emitted.
  const clockValues = [0, 100, 200];
  let clockIdx = 0;
  const fakeClock = () => clockValues[clockIdx++] ?? 300;

  const turns: FakeTurn[] = [
    {
      toolCalls: [
        { name: "search_files", arguments: { path: "/a" } },
        { name: "search_files", arguments: { path: "/b" } },
        { name: "search_files", arguments: { path: "/c" } },
      ],
    },
    { text: "done" },
  ];
  const runner = makeEmitRunner08(turns, emitted, fakeClock);

  await runner.run(makeTask({ agent: "synthetic@1" }), makeContext());

  const progressEvents = emitted.filter((e) => e.type === "agent.progress");
  assert.equal(
    progressEvents.length,
    3,
    `expected 3 agent.progress emissions (un-throttled capture, one per tool call); got ${progressEvents.length}`,
  );
});

// (c-failed) Failed run must still emit agent.finished with outcome=failed

test("(c) failed run: agent.finished emitted with outcome failed", async () => {
  const emitted: EmitRecord08[] = [];
  const sessions: ProviderSessionFactory = {
    async for() {
      throw new CredentialError(
        "key",
        "openai",
        "provider mismatch: always fails",
      );
    },
  };
  const runner = new PiAgentRunner({
    sessions,
    workspaces: new FakeWorkspaceManager(),
    newInstructionLoader: (_dir: string) => ({ load: () => [] }),
    getResource: makeGetResource(),
    profiles: new Map([
      ["synthetic@1", profileWithSearch08],
    ]) as unknown as PiAgentRunnerOptions["profiles"],
    getPriorRejection: () => undefined,
    emit: (tid: string, type: string, payload: Record<string, string>) => {
      emitted.push({ taskId: tid, type, payload });
    },
    clock: () => 0,
  } as unknown as PiAgentRunnerOptions);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "failed", "outcome should be failed");
  const finishedEvents = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(
    finishedEvents.length,
    1,
    "agent.finished must be emitted even on pre-agent failure",
  );
  assert.equal(
    finishedEvents[0]?.payload?.outcome,
    "failed",
    "agent.finished payload must carry outcome=failed",
  );
});

// (c-escalated) Escalated run must still emit agent.finished with outcome=escalated

test("(c) escalated run: agent.finished emitted with outcome escalated", async () => {
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [
    {
      toolCalls: [
        { name: "escalate", arguments: { reason: "need human review" } },
      ],
    },
    { text: "escalated" },
  ];
  const runner = makeEmitRunner08(turns, emitted);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "escalated", "outcome should be escalated");
  const finishedEvents = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(
    finishedEvents.length,
    1,
    "agent.finished must be emitted on escalation",
  );
  assert.equal(
    finishedEvents[0]?.payload?.outcome,
    "escalated",
    "agent.finished payload must carry outcome=escalated",
  );
});

// (d-progress) Credential value in tool args: progress payload must not contain it

test("(d) tool args with credential value: progress summary must not contain it (redacted to ***)", async () => {
  const credValue = CREDENTIAL.value; // "sk-test"
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [
    { toolCalls: [{ name: "search_files", arguments: { path: credValue } }] },
    { text: "done" },
  ];
  const runner = makeEmitRunner08(turns, emitted);

  await runner.run(makeTask({ agent: "synthetic@1" }), makeContext());

  const progressEvents = emitted.filter((e) => e.type === "agent.progress");
  assert.ok(
    progressEvents.length >= 1,
    "should emit at least one progress event",
  );
  for (const ev of progressEvents) {
    const payloadStr = JSON.stringify(ev.payload);
    assert.ok(
      !payloadStr.includes(credValue),
      `progress payload must not contain credential value '${credValue}', got: ${payloadStr}`,
    );
  }
});

// (d-reason) Provider error embedding credential value: result.reason must not contain it

test("(d) provider error with credential value in message: result.reason must be redacted", async () => {
  const credValue = CREDENTIAL.value; // "sk-test"
  const emitted: EmitRecord08[] = [];
  const sessions: ProviderSessionFactory = {
    async for() {
      throw new Error(`${credValue} is an invalid key for this provider`);
    },
  };
  const runner = new PiAgentRunner({
    sessions,
    workspaces: new FakeWorkspaceManager(),
    newInstructionLoader: (_dir: string) => ({ load: () => [] }),
    getResource: makeGetResource(),
    profiles: new Map([
      ["synthetic@1", profileWithSearch08],
    ]) as unknown as PiAgentRunnerOptions["profiles"],
    getPriorRejection: () => undefined,
    emit: (tid: string, type: string, payload: Record<string, string>) => {
      emitted.push({ taskId: tid, type, payload });
    },
    clock: () => 0,
  } as unknown as PiAgentRunnerOptions);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "failed");
  const reason = (result as unknown as { reason: string }).reason;
  assert.ok(
    !reason.includes(credValue),
    `reason must not contain credential value '${credValue}', got: ${reason}`,
  );
  assert.ok(
    reason.includes("***"),
    `reason must contain *** (redacted placeholder), got: ${reason}`,
  );
});

// (e) Progress summary never exceeds 200 characters

test("(e) progress summary never exceeds 200 characters", async () => {
  const longPath = "x".repeat(300);
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [
    { toolCalls: [{ name: "search_files", arguments: { path: longPath } }] },
    { text: "done" },
  ];
  const runner = makeEmitRunner08(turns, emitted);

  await runner.run(makeTask({ agent: "synthetic@1" }), makeContext());

  const progressEvents = emitted.filter((e) => e.type === "agent.progress");
  assert.ok(
    progressEvents.length >= 1,
    "should emit at least one progress event",
  );
  for (const ev of progressEvents) {
    const summary = ev.payload.summary ?? "";
    assert.ok(
      summary.length <= 200,
      `summary must not exceed 200 chars, got length=${summary.length}: ${summary.slice(0, 50)}...`,
    );
  }
});

// ---------------------------------------------------------------------------
// Story 08 T2 — Turn budget + env wiring
// ---------------------------------------------------------------------------

// (a-budget) maxTurns=3 with a session that always returns a tool call →
//   runner aborts after 3 turns, result is failed BudgetExceededError,
//   agent.finished{failed} is still emitted. The test's own completion
//   proves the runner is bounded (not hanging).

// ---------------------------------------------------------------------------
// B2 regression — post-waitForIdle agent.state.errorMessage credential leak
// ---------------------------------------------------------------------------
//
// After `waitForIdle()`, pi.ts checks `agent.state.errorMessage` and returns:
//   return { outcome: "failed", reason: agent.state.errorMessage };
// The `redact()` function is in scope but NOT applied here — the raw error
// message (which may contain the credential value) leaks into result.reason.
//
// The test drives the pi Agent into an error state where `agent.state.errorMessage`
// contains the credential value (by having the session factory succeed but having
// the stream function throw with the credential in the message — pi-agent-core
// catches this and sets errorMessage). The runner must redact the value.

test("(B2 regression) post-waitForIdle agent.state.errorMessage containing credential value is redacted in result.reason", async () => {
  const credValue = CREDENTIAL.value; // "sk-test"

  // Factory for() resolves successfully; the returned streamFn throws with the
  // credential value in its message. pi-agent-core catches the throw internally
  // and records it as agent.state.errorMessage.
  const sessions: ProviderSessionFactory = {
    async for() {
      return {
        model: {} as unknown as any,
        streamFn: () => {
          throw new Error(`auth failed: ${credValue} is not a valid API key`);
        },
        getApiKey: () => "key",
      } as unknown as any;
    },
  };
  const runner = makeRunner({ sessions });

  const result = await runner.run(makeTask(), makeContext());

  assert.equal(
    result.outcome,
    "failed",
    "outcome must be failed when stream throws",
  );
  const reason = (result as unknown as { reason: string }).reason;
  // Currently FAILS: pi.ts returns `reason: agent.state.errorMessage` verbatim
  // (no redact applied on line ~432), so "sk-test" leaks into the result.
  assert.ok(
    !reason.includes(credValue),
    `result.reason must NOT contain credential value '${credValue}' (must be redacted), got: ${reason}`,
  );
  assert.ok(
    reason.includes("***"),
    `result.reason must contain *** (redacted placeholder), got: ${reason}`,
  );
});

test("(a) turn budget: maxTurns=3, always tool-calling session → failed BudgetExceededError after 3 turns, agent.finished{failed} emitted", async () => {
  const emitted: EmitRecord08[] = [];

  // Provide 10 identical tool-call turns — more than maxTurns(3)
  const alwaysToolCallTurns: FakeTurn[] = Array.from({ length: 10 }, () => ({
    toolCalls: [{ name: "search_files", arguments: { path: "/repo" } }],
  }));

  const runner = new PiAgentRunner({
    sessions: makeSessionFactory(alwaysToolCallTurns),
    workspaces: new FakeWorkspaceManager(),
    newInstructionLoader: (_dir: string) => ({ load: () => [] }),
    getResource: makeGetResource(),
    profiles: new Map([
      ["synthetic@1", profileWithSearch08],
    ]) as unknown as PiAgentRunnerOptions["profiles"],
    getPriorRejection: () => undefined,
    emit: (tid: string, type: string, payload: Record<string, string>) => {
      emitted.push({ taskId: tid, type, payload });
    },
    clock: () => 0,
    maxTurns: 3,
  } as unknown as PiAgentRunnerOptions);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(
    result.outcome,
    "failed",
    "outcome must be failed when budget exceeded",
  );
  const reason = (result as unknown as { reason: string }).reason;
  assert.ok(
    reason.includes("BudgetExceededError"),
    `reason must contain 'BudgetExceededError', got: ${reason}`,
  );
  assert.ok(
    reason.includes("3"),
    `reason must reference the turn count (3), got: ${reason}`,
  );

  const finishedEvents = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(
    finishedEvents.length,
    1,
    "agent.finished must be emitted after budget exceeded",
  );
  assert.equal(
    finishedEvents[0]?.payload?.outcome,
    "failed",
    "agent.finished payload must carry outcome=failed",
  );
});

// ---------------------------------------------------------------------------
// Story 06 T3 — A4: task.verification events
// ---------------------------------------------------------------------------

// Passing verification command: emits start + end events with exitClass "pass"

test("(T3) task.verification: exit-0 command emits start then end event with exitClass 'pass'", async () => {
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [{ text: "done" }];
  const runner = makeEmitRunner08(turns, emitted);
  const task = makeTask({ agent: "synthetic@1", verification: ["true"] });

  await runner.run(task, makeContext());

  const verifEvents = emitted.filter((e) => e.type === "task.verification");
  assert.equal(
    verifEvents.length,
    2,
    `expected 2 task.verification events (start + end); got ${verifEvents.length}: ${JSON.stringify(verifEvents)}`,
  );
  const startEv = verifEvents[0];
  const endEv = verifEvents[1];
  assert.ok(startEv !== undefined, "start event must exist");
  assert.equal(
    startEv.payload.phase,
    "start",
    "first task.verification event must have phase=start",
  );
  assert.equal(
    startEv.payload.verifierKind,
    "cmd",
    "start event must have verifierKind=cmd",
  );
  assert.ok(endEv !== undefined, "end event must exist");
  assert.equal(
    endEv.payload.phase,
    "end",
    "second task.verification event must have phase=end",
  );
  assert.equal(
    endEv.payload.exitClass,
    "pass",
    "exitClass must be 'pass' for a command that exits 0",
  );
  const durationMs = endEv.payload.durationMs;
  assert.ok(durationMs !== undefined, "end event must carry durationMs field");
  const durationNum = parseInt(durationMs ?? "", 10);
  assert.ok(
    Number.isInteger(durationNum) && durationNum >= 0,
    `durationMs must be a non-negative integer string; got: '${durationMs}'`,
  );
  assert.equal(
    endEv.payload.timedOut,
    "false",
    "timedOut must be 'false' for a normal exit",
  );
});

// Failing verification command: still emits start + end, end has exitClass "fail"

test("(T3) task.verification: exit-1 command emits end event with exitClass 'fail'", async () => {
  const emitted: EmitRecord08[] = [];
  const turns: FakeTurn[] = [{ text: "done" }];
  const runner = makeEmitRunner08(turns, emitted);
  const task = makeTask({ agent: "synthetic@1", verification: ["false"] });

  // outcome will be "failed" because the verification command exits 1
  const result = await runner.run(task, makeContext());

  assert.equal(
    result.outcome,
    "failed",
    "outcome must be failed when verification command exits non-zero",
  );

  const verifEvents = emitted.filter((e) => e.type === "task.verification");
  assert.equal(
    verifEvents.length,
    2,
    `expected 2 task.verification events even when command fails; got ${verifEvents.length}`,
  );
  const endEv = verifEvents[1];
  assert.ok(endEv !== undefined, "end event must exist");
  assert.equal(
    endEv.payload.phase,
    "end",
    "second task.verification event must have phase=end",
  );
  assert.equal(
    endEv.payload.exitClass,
    "fail",
    "exitClass must be 'fail' for a command that exits non-zero",
  );
  assert.equal(
    endEv.payload.timedOut,
    "false",
    "timedOut must be 'false' for a normal non-zero exit",
  );
});

// ---------------------------------------------------------------------------
// Story 06 T4 — A6: turn/token fields in agent.finished
// ---------------------------------------------------------------------------

// A6: agent.finished payload carries turns, tokensIn, tokensOut
// Fails today: payload has only { outcome }.

test("(T4) A6: agent.finished payload carries turns, tokensIn, tokensOut", async () => {
  const emitted: EmitRecord08[] = [];
  // 2 scripted turns → 2 turn_end events → turns must be "2"
  const turns: FakeTurn[] = [
    { toolCalls: [{ name: "search_files", arguments: { path: "/src" } }] },
    { text: "done" },
  ];
  const runner = makeEmitRunner08(turns, emitted);

  await runner.run(makeTask({ agent: "synthetic@1" }), makeContext());

  const finishedEvents = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(
    finishedEvents.length,
    1,
    "exactly one agent.finished event must be emitted",
  );
  const payload = finishedEvents[0]?.payload;
  assert.ok(payload !== undefined, "agent.finished event must have a payload");

  // All four fields must be present
  assert.ok(
    "outcome" in payload,
    "agent.finished payload must carry 'outcome'",
  );
  assert.ok("turns" in payload, "agent.finished payload must carry 'turns'");
  assert.ok(
    "tokensIn" in payload,
    "agent.finished payload must carry 'tokensIn'",
  );
  assert.ok(
    "tokensOut" in payload,
    "agent.finished payload must carry 'tokensOut'",
  );

  // turns must equal number of turn_end events (2 scripted turns → 2 turn_end)
  const turnsNum = parseInt(payload.turns ?? "", 10);
  assert.ok(
    Number.isInteger(turnsNum) && turnsNum > 0,
    `turns must be a positive integer string; got: '${payload.turns}'`,
  );
  assert.equal(
    turnsNum,
    2,
    `turns must equal the number of scripted turns (2); got: ${turnsNum}`,
  );

  // tokensIn and tokensOut must be integer strings (pi-agent-core AgentState
  // has no usage field → implementation uses "0" as placeholder)
  const tokensInNum = parseInt(payload.tokensIn ?? "", 10);
  const tokensOutNum = parseInt(payload.tokensOut ?? "", 10);
  assert.ok(
    Number.isInteger(tokensInNum) && tokensInNum >= 0,
    `tokensIn must be a non-negative integer string; got: '${payload.tokensIn}'`,
  );
  assert.ok(
    Number.isInteger(tokensOutNum) && tokensOutNum >= 0,
    `tokensOut must be a non-negative integer string; got: '${payload.tokensOut}'`,
  );
});

// ---------------------------------------------------------------------------
// Story 01 T1 (F2) — real per-turn token accounting in agent.finished
//
// The existing FakeSessionFactory auto-estimates usage from prompt text and
// cannot deliver a controlled fixture, so this section drives the real pi
// Agent loop with a custom streamFn that emits an AssistantMessageEventStream
// whose `done` event carries an exact, per-turn `usage` fixture. Each assistant
// turn's `usage` is delivered verbatim; no network, no real model.
// ---------------------------------------------------------------------------

// Per-turn usage fixture — mirrors pi's Usage bucket semantics:
// `reasoning` is a SUBSET of `output`; `cacheWrite1h` is a SUBSET of `cacheWrite`.
type UsageFixture = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  cacheWrite1h?: number;
};

function makeFixtureMessage(
  fixture: UsageFixture,
  stopReason: string,
  content: unknown[],
): Record<string, unknown> {
  const usage = {
    input: fixture.input,
    output: fixture.output,
    cacheRead: fixture.cacheRead,
    cacheWrite: fixture.cacheWrite,
    reasoning: fixture.reasoning,
    cacheWrite1h: fixture.cacheWrite1h,
    totalTokens:
      fixture.input + fixture.output + fixture.cacheRead + fixture.cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return {
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage,
    stopReason,
    timestamp: 0,
  };
}

/**
 * Build a ProviderSessionFactory whose streamFn emits a controlled, per-turn
 * `usage` fixture. For each agent turn it returns an AssistantMessageEventStream
 * that delivers a single `done` event carrying the fixture message:
 *   - non-final turns emit a `search_files` toolCall (stopReason "toolUse") so
 *     the agent loop continues to the next turn;
 *   - the final turn emits a `search_files` toolCall too, UNLESS `escalateLast`
 *     is set, in which case it emits an `escalate` toolCall (→ escalated).
 */
function makeUsageSessionFactory(
  usages: UsageFixture[],
  opts: { escalateLast?: boolean } = {},
): ProviderSessionFactory {
  return {
    async for() {
      let callIndex = 0;
      const streamFn = (_model: unknown, _ctx: unknown, _o?: unknown) => {
        const i = callIndex++;
        const fixture = usages[Math.min(i, usages.length - 1)]!;
        const isLast = i >= usages.length - 1;
        let content: unknown[];
        let stopReason: string;
        if (isLast && opts.escalateLast) {
          content = [
            {
              type: "toolCall",
              id: `esc-${i}`,
              name: "escalate",
              arguments: { reason: "need human review" },
            },
          ];
          stopReason = "toolUse";
        } else if (!isLast) {
          content = [
            {
              type: "toolCall",
              id: `sf-${i}`,
              name: "search_files",
              arguments: { path: `/src/${i}` },
            },
          ];
          stopReason = "toolUse";
        } else {
          content = [{ type: "text", text: "done" }];
          stopReason = "stop";
        }
        const message = makeFixtureMessage(fixture, stopReason, content);
        const events = [{ type: "done", reason: stopReason, message }];
        let k = 0;
        const stream = {
          async *[Symbol.asyncIterator]() {
            while (k < events.length) yield events[k++];
          },
          result() {
            return Promise.resolve(message as unknown);
          },
        };
        return stream as unknown;
      };
      return {
        model: {} as unknown as any,
        streamFn: streamFn as unknown as any,
        getApiKey: () => "fake-key",
      } as unknown as any;
    },
  };
}

function makeUsageRunner(
  usages: UsageFixture[],
  emitted: EmitRecord08[],
  opts: { escalateLast?: boolean } = {},
) {
  const sessions = makeUsageSessionFactory(usages, opts);
  return new PiAgentRunner({
    sessions,
    workspaces: new FakeWorkspaceManager(),
    newInstructionLoader: (_dir: string) => ({ load: () => [] }),
    getResource: makeGetResource(),
    profiles: new Map([
      ["synthetic@1", profileWithSearch08],
    ]) as unknown as PiAgentRunnerOptions["profiles"],
    getPriorRejection: () => undefined,
    emit: (tid: string, type: string, payload: Record<string, string>) => {
      emitted.push({ taskId: tid, type, payload });
    },
    clock: () => 0,
  } as unknown as PiAgentRunnerOptions);
}

const F2_USAGES: UsageFixture[] = [
  {
    input: 100,
    cacheRead: 10,
    cacheWrite: 5,
    output: 20,
    reasoning: 8,
    cacheWrite1h: 2,
  },
  { input: 200, cacheRead: 20, cacheWrite: 8, output: 30, reasoning: 12 },
  {
    input: 50,
    cacheRead: 5,
    cacheWrite: 3,
    output: 10,
    reasoning: 4,
    cacheWrite1h: 1,
  },
];

// (a)-(e) Exact arithmetic across ≥3 assistant turns; reasoning and
// cacheWrite1h are subsets and must NOT be added on top of output/cacheWrite.
test("(F2 T1) multi-turn usage: agent.finished tokensIn/tokensOut sum every assistant turn exactly; reasoning & cacheWrite1h not double-counted", async () => {
  const emitted: EmitRecord08[] = [];
  const runner = makeUsageRunner(F2_USAGES, emitted);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "completed", "task completed");
  const finished = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(finished.length, 1, "exactly one agent.finished event");
  const payload = finished[0]?.payload;
  assert.ok(payload !== undefined, "agent.finished must carry a payload");

  // Σ(input+cacheRead+cacheWrite) = (100+10+5)+(200+20+8)+(50+5+3) = 401
  const expectedIn = 100 + 10 + 5 + (200 + 20 + 8) + (50 + 5 + 3);
  // Σ(output) = 20+30+10 = 60 (output already includes reasoning subset)
  const expectedOut = 20 + 30 + 10;

  assert.equal(
    payload.tokensIn,
    String(expectedIn),
    `tokensIn must equal Σ(input+cacheRead+cacheWrite)=${expectedIn}; got '${payload.tokensIn}'`,
  );
  assert.equal(
    payload.tokensOut,
    String(expectedOut),
    `tokensOut must equal Σ(output)=${expectedOut}; got '${payload.tokensOut}'`,
  );
  // reasoning is a subset of output — adding it again would give 84
  assert.notEqual(
    payload.tokensOut,
    String(expectedOut + 8 + 12 + 4),
    "reasoning must NOT be added on top of output (no double count)",
  );
  // cacheWrite1h is a subset of cacheWrite — adding it again would give 404
  assert.notEqual(
    payload.tokensIn,
    String(expectedIn + 2 + 1),
    "cacheWrite1h must NOT be added on top of cacheWrite (no double count)",
  );
});

// (f) A run that ends in `failed` (verification failure) still emits the real
// usage accumulated across the turns that ran.
test("(F2 T1) failed run (verification failure) still emits non-zero tokensIn/tokensOut from the turns that ran", async () => {
  const emitted: EmitRecord08[] = [];
  const runner = makeUsageRunner(F2_USAGES, emitted);

  const result = await runner.run(
    makeTask({ agent: "synthetic@1", verification: ["false"] }),
    makeContext(),
  );

  assert.equal(result.outcome, "failed", "verification failure → failed");
  const finished = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(finished.length, 1, "agent.finished emitted even on failure");
  const payload = finished[0]?.payload;
  assert.ok(payload !== undefined, "agent.finished must carry a payload");
  assert.equal(payload.outcome, "failed", "payload outcome must be failed");
  assert.equal(
    payload.tokensIn,
    String(100 + 10 + 5 + (200 + 20 + 8) + (50 + 5 + 3)),
    `tokensIn must still sum the run's turns; got '${payload.tokensIn}'`,
  );
  assert.equal(
    payload.tokensOut,
    String(20 + 30 + 10),
    `tokensOut must still sum the run's turns; got '${payload.tokensOut}'`,
  );
});

// (f) A run that ends in `escalated` still emits the real usage accumulated
// across the turns that ran.
test("(F2 T1) escalated run still emits non-zero tokensIn/tokensOut from the turns that ran", async () => {
  const emitted: EmitRecord08[] = [];
  const runner = makeUsageRunner(F2_USAGES, emitted, { escalateLast: true });

  const result = await runner.run(
    makeTask({ agent: "synthetic@1" }),
    makeContext(),
  );

  assert.equal(result.outcome, "escalated", "escalate tool → escalated");
  const finished = emitted.filter((e) => e.type === "agent.finished");
  assert.equal(finished.length, 1, "agent.finished emitted on escalation");
  const payload = finished[0]?.payload;
  assert.ok(payload !== undefined, "agent.finished must carry a payload");
  assert.equal(
    payload.outcome,
    "escalated",
    "payload outcome must be escalated",
  );
  assert.equal(
    payload.tokensIn,
    String(100 + 10 + 5 + (200 + 20 + 8) + (50 + 5 + 3)),
    `tokensIn must still sum the run's turns; got '${payload.tokensIn}'`,
  );
  assert.equal(
    payload.tokensOut,
    String(20 + 30 + 10),
    `tokensOut must still sum the run's turns; got '${payload.tokensOut}'`,
  );
});

// ---------------------------------------------------------------------------
// Story 03 T2 (F3) — executor-neutral candidate result contract on the runner
//   changed   → candidate (carrying base + proposal commits)
//   no-change → completed (verified no-change is a legitimate completion)
// Driven with the REAL generic@1 profile (not the synthetic stub) so the
// changed/no-change branch in genericProfile.verify() + pi.ts is exercised.
// ---------------------------------------------------------------------------

import { genericProfile } from "./pi-profile.ts";

class T2WorkspaceManager {
  readonly #ws: { dir: string; baseCommit: string };
  constructor(ws: { dir: string; baseCommit: string }) {
    this.#ws = ws;
  }
  async prepare(_taskId: string, _source: unknown): Promise<Workspace> {
    return {
      dir: this.#ws.dir,
      branch: "kanthord/task-001",
      baseCommit: this.#ws.baseCommit,
    };
  }
}

async function makeT2Workspace(
  dirty: boolean,
): Promise<{ dir: string; baseCommit: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-pi-t2-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@localhost"], {
    cwd: dir,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# seed");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
  });
  const baseCommit = stdout.trim();
  if (dirty) {
    // Leave an untracked new file so computeEvidence sees hasChanges === true.
    await writeFile(join(dir, "feature.ts"), "// new file\n");
  }
  return {
    dir,
    baseCommit,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

function makeGenericRunner(ws: {
  dir: string;
  baseCommit: string;
}): PiAgentRunner {
  return new PiAgentRunner({
    sessions: makeSessionFactory([{ text: "done" }]),
    workspaces: new T2WorkspaceManager(ws),
    newInstructionLoader: (_dir: string) => ({ load: () => [] }),
    getResource: makeGetResource(),
    profiles: new Map([["generic@1", genericProfile]]),
    getPriorRejection: () => undefined,
  });
}

// (b) changed workspace → candidate carrying base + proposal commits
test("(F3 T2) pi runner: changed workspace resolves to candidate (not completed/failed)", async () => {
  const ws = await makeT2Workspace(true);
  try {
    const runner = makeGenericRunner(ws);
    const result = await runner.run(
      makeTask({ agent: "generic@1" }),
      makeContext(),
    );

    assert.equal(
      result.outcome,
      "candidate",
      "changed work must resolve to candidate (awaiting landing gate), not completed/failed",
    );
    const cand = result as unknown as {
      outcome: "candidate";
      baseCommit: string;
      candidateCommit: string;
      branch: string;
      workspace: string;
      summary: string;
    };
    assert.equal(
      cand.baseCommit,
      ws.baseCommit,
      "candidate.baseCommit must equal workspace.baseCommit",
    );
    assert.ok(
      typeof cand.candidateCommit === "string" &&
        cand.candidateCommit.length > 0,
      `candidate.candidateCommit must be a non-empty commit SHA, got: '${cand.candidateCommit}'`,
    );
    assert.notEqual(
      cand.candidateCommit,
      cand.baseCommit,
      "candidate.candidateCommit must differ from baseCommit (it is the proposal commit to land)",
    );
    assert.equal(
      cand.branch,
      "kanthord/task-001",
      "candidate.branch must equal the task branch",
    );
    assert.equal(
      cand.workspace,
      ws.dir,
      "candidate.workspace must equal the workspace dir",
    );
    assert.ok(
      typeof cand.summary === "string",
      "candidate.summary must be a string",
    );
  } finally {
    await ws.cleanup();
  }
});

// (c) no-change workspace → completed (verified no-change is legitimate)
test("(F3 T2) pi runner: no-change workspace resolves to completed (not failed)", async () => {
  const ws = await makeT2Workspace(false);
  try {
    const runner = makeGenericRunner(ws);
    const result = await runner.run(
      makeTask({ agent: "generic@1" }),
      makeContext(),
    );

    assert.equal(
      result.outcome,
      "completed",
      "verified no-change must resolve to completed (legitimate completion, not failed)",
    );
  } finally {
    await ws.cleanup();
  }
});
