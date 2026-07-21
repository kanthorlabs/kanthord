/**
 * Story 06 T1 — evidence + verdict + finalize/proposal in the runner
 *
 * Integration tests: FakeSessionFactory (scripted model) + real pi coding tools
 * + real git operations in temp dirs. No network.
 *
 * Tests (a)–(j) per Story 06 Task T1 spec.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { PiAgentRunner } from "./pi.ts";
import { FakeSessionFactory } from "./fake-session.ts";
import type { FakeTurn } from "./fake-session.ts";
import { LocalWorkspaceManager } from "../workspace/local.ts";
import { genericProfile, type PiAgentProfile } from "./pi-profile.ts";
import type { VerificationEvidence } from "./verification.ts";
import type { AIProvider, Credential, Repository } from "../domain/resource.ts";
import type { Task } from "../domain/task.ts";
import type { TaskContextBinding } from "./port.ts";
import type { ProviderSessionFactory } from "./pi-session.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

async function createSeedRepo(dir: string, branch = "main"): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFile("git", ["init", "-b", branch], { cwd: dir });
  await execFile("git", ["config", "user.email", "test@localhost"], {
    cwd: dir,
  });
  await execFile("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# seed");
  await execFile("git", ["add", "."], { cwd: dir });
  await execFile("git", ["commit", "-m", "initial"], { cwd: dir });
}

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

function makeRepo(path: string): Repository {
  return {
    id: "repo-001",
    type: "repository",
    name: "sandbox",
    remoteUrl: "https://github.com/kanthorlabs/sandbox.git",
    branch: "main",
    path,
    auth: { kind: "ambient" },
  };
}

function makeGetResource(repo: Repository): (id: string) => unknown {
  return (id: string) => {
    if (id === AI_PROVIDER.id) return AI_PROVIDER;
    if (id === CREDENTIAL.id) return CREDENTIAL;
    if (id === repo.id) return repo;
    return undefined;
  };
}

function makeContext(repo: Repository): TaskContextBinding[] {
  return [
    { type: "ai_provider", resourceId: AI_PROVIDER.id },
    { type: "credential", resourceId: CREDENTIAL.id },
    { type: "repository", resourceId: repo.id },
  ];
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    objectiveId: "obj-001",
    title: "Add title to README",
    status: "running",
    dependencies: [],
    agent: "generic@1",
    instructions: "Edit README.md to add an H1 title",
    ac: ["README.md has a title"],
    ...overrides,
  };
}

function makeSessionFactory(turns: FakeTurn[]): ProviderSessionFactory {
  return {
    async for(_ai: AIProvider, _cred: Credential) {
      const fake = new FakeSessionFactory(turns);
      return {
        model: {} as unknown as any,
        streamFn: fake.streamFn as unknown as any,
        getApiKey: () => "fake-key",
      } as unknown as any;
    },
  };
}

function makeRunner(opts: {
  turns: FakeTurn[];
  wsRoot: string;
  repo: Repository;
  seedDir: string;
  profile?: PiAgentProfile;
}): PiAgentRunner {
  const profile = opts.profile ?? genericProfile;
  // Redirect the clone source to the local seed dir using file:// URL so
  // LocalWorkspaceManager.prepareFromRepository uses a hermetic local clone
  // instead of a real (non-existent) GitHub remote.
  const repoWithLocalUrl: Repository = {
    ...opts.repo,
    remoteUrl: `file://${opts.seedDir}`,
  };
  return new PiAgentRunner({
    sessions: makeSessionFactory(opts.turns),
    workspaces: new LocalWorkspaceManager({
      root: opts.wsRoot,
    }),
    newInstructionLoader: () => ({ load: () => [] }),
    getResource: makeGetResource(repoWithLocalUrl),
    profiles: new Map([["generic@1", profile]]) as unknown as any,
    getPriorRejection: () => undefined,
  });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let tmpRoot: string;
let seedDir: string;
let seedHead: string;

before(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-verify-"));
  seedDir = join(tmpRoot, "seed");
  await createSeedRepo(seedDir);
  seedHead = await git(seedDir, "rev-parse", "HEAD");
});

after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (a) Agent edits via write tool → candidate (changed work): candidateCommit +
//     baseCommit set, seed repo unchanged. Disclosure: a changed generic@1 task
//     now stops at a landing candidate, no longer completes immediately (007.3).
// ---------------------------------------------------------------------------

test("(a) agent writes file via write tool → candidate (changed work), candidate/base commits set, seed unchanged", async () => {
  const homeDir = join(tmpRoot, "home-a");
  const wsRootA = join(tmpRoot, "ws-a");
  await mkdir(wsRootA, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          {
            name: "write",
            arguments: { path: "RESULT.md", content: "# Result\n" },
          },
        ],
      },
      { text: "Done. I wrote the result file." },
    ],
    wsRoot: wsRootA,
    repo,
    seedDir,
  });

  const result = await runner.run(
    makeTask({ id: "task-a" }),
    makeContext(repo),
  );

  assert.equal(result.outcome, "candidate");
  const r = result as {
    outcome: "candidate";
    workspace?: string;
    branch?: string;
    baseCommit?: string;
    candidateCommit?: string;
    summary?: string;
  };
  assert.ok(
    r.candidateCommit,
    "candidateCommit must be set after proposal commit",
  );
  assert.ok(r.baseCommit, "baseCommit must be set");
  assert.equal(
    r.baseCommit,
    seedHead,
    "baseCommit is the seed HEAD the candidate branched from",
  );
  assert.notEqual(
    r.candidateCommit,
    seedHead,
    "candidate commit differs from seed HEAD",
  );

  // workspace is on the task branch
  assert.ok(r.workspace, "workspace path present");
  assert.ok(r.branch, "branch present");
  assert.equal(
    r.branch,
    "kanthord/task-a",
    "workspace branch is kanthord/task-a",
  );

  // seed repo is untouched
  const seedHeadAfter = await git(seedDir, "rev-parse", "HEAD");
  assert.equal(seedHeadAfter, seedHead, "seed repo HEAD is unchanged");
});

// ---------------------------------------------------------------------------
// (b) Text-only session (no tool calls) → completed (verified no-change is a
//     legitimate completion). Disclosure: 007.3 flips the old `failed
//     NO_CHANGES` verdict — a verified no-change task now completes.
// ---------------------------------------------------------------------------

test("(b) text-only session, no changes → completed (verified no-change is a legitimate completion)", async () => {
  const homeDir = join(tmpRoot, "home-b");
  const wsRootB = join(tmpRoot, "ws-b");
  await mkdir(wsRootB, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [{ text: "I reviewed the task. No changes needed." }],
    wsRoot: wsRootB,
    repo,
    seedDir,
  });

  const result = await runner.run(
    makeTask({ id: "task-b" }),
    makeContext(repo),
  );

  assert.equal(result.outcome, "completed");
  const r = result as { outcome: "completed"; summary?: string };
  assert.ok(r.summary, "summary present for no-change completion");
});

// ---------------------------------------------------------------------------
// (c) Agent commits via bash tool → candidate (changed work), base on seed,
//     task branch has exactly one new commit (no double commit)
// ---------------------------------------------------------------------------

test("(c) agent commits via bash → candidate, exactly one new commit on task branch (no double commit)", async () => {
  const homeDir = join(tmpRoot, "home-c");
  const wsRootC = join(tmpRoot, "ws-c");
  await mkdir(wsRootC, { recursive: true });
  const repo = makeRepo(homeDir);

  const commitCmd =
    'echo "# agent edit" > AGENT_EDIT.md && ' +
    "git -c user.name=agent -c user.email=agent@local add -A && " +
    "git -c user.name=agent -c user.email=agent@local commit -m 'agent commit'";

  const runner = makeRunner({
    turns: [
      { toolCalls: [{ name: "bash", arguments: { command: commitCmd } }] },
      { text: "I committed the changes." },
    ],
    wsRoot: wsRootC,
    repo,
    seedDir,
  });

  const result = await runner.run(
    makeTask({ id: "task-c" }),
    makeContext(repo),
  );

  assert.equal(result.outcome, "candidate");
  const r = result as {
    outcome: "candidate";
    workspace?: string;
    branch?: string;
    baseCommit?: string;
    candidateCommit?: string;
  };
  assert.ok(r.candidateCommit, "candidateCommit set");
  assert.ok(r.baseCommit, "baseCommit set");
  assert.equal(r.baseCommit, seedHead, "baseCommit is the seed HEAD");

  // rev count in workspace must equal seed rev count + 1 (the agent's commit)
  const wsDir = join(wsRootC, "task-c");
  const wsRevCount = parseInt(
    await git(wsDir, "rev-list", "--count", "HEAD"),
    10,
  );
  const seedRevCount = parseInt(
    await git(seedDir, "rev-list", "--count", "HEAD"),
    10,
  );
  assert.equal(
    wsRevCount,
    seedRevCount + 1,
    "exactly one commit on top of seed (no double commit)",
  );
});

// ---------------------------------------------------------------------------
// (d) Agent writes file then escalates → escalated, proposalCommit on
//     kanthord/proposal/<id>, task branch stays at baseCommit, reason carried
// ---------------------------------------------------------------------------

test("(d) write then escalate → escalated, proposalCommit on proposal branch, task branch unchanged", async () => {
  const homeDir = join(tmpRoot, "home-d");
  const wsRootD = join(tmpRoot, "ws-d");
  await mkdir(wsRootD, { recursive: true });
  const repo = makeRepo(homeDir);

  const verifyCallCount = { n: 0 };
  const spyProfile: PiAgentProfile = {
    ...genericProfile,
    verify: async (ev: unknown) => {
      verifyCallCount.n++;
      return genericProfile.verify(ev);
    },
  };

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          {
            name: "write",
            arguments: { path: "PROPOSAL.md", content: "# proposal\n" },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: "escalate",
            arguments: { reason: "need human review of my changes" },
          },
        ],
      },
    ],
    wsRoot: wsRootD,
    repo,
    seedDir,
    profile: spyProfile,
  });

  const result = await runner.run(
    makeTask({ id: "task-d" }),
    makeContext(repo),
  );

  assert.equal(result.outcome, "escalated");
  const r = result as {
    outcome: "escalated";
    reason: string;
    workspace: string;
    branch: string;
    baseCommit: string;
    proposalCommit?: string;
  };

  // verify was NOT called (escalate short-circuits judgment)
  assert.equal(
    verifyCallCount.n,
    0,
    "verify must not be called when agent escalated",
  );

  // reason is carried
  assert.ok(
    r.reason.includes("need human review"),
    `reason must include escalation reason, got: ${r.reason}`,
  );

  // proposal commit exists on kanthord/proposal/<id> branch
  assert.ok(
    r.proposalCommit,
    "proposalCommit must be set (file was written before escalate)",
  );
  const wsDir = join(wsRootD, "task-d");
  const proposalBranchHead = await git(
    wsDir,
    "rev-parse",
    "kanthord/proposal/task-d",
  );
  assert.equal(
    proposalBranchHead,
    r.proposalCommit,
    "proposalCommit matches proposal branch HEAD",
  );

  // task branch still at baseCommit
  const taskBranchHead = await git(wsDir, "rev-parse", "kanthord/task-d");
  assert.equal(
    taskBranchHead,
    r.baseCommit,
    "task branch is unchanged at baseCommit",
  );
});

// ---------------------------------------------------------------------------
// (e) Agent escalates before any change → escalated, proposalCommit undefined
// ---------------------------------------------------------------------------

test("(e) escalate with no change → escalated, proposalCommit absent", async () => {
  const homeDir = join(tmpRoot, "home-e");
  const wsRootE = join(tmpRoot, "ws-e");
  await mkdir(wsRootE, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          {
            name: "escalate",
            arguments: { reason: "not sure how to proceed" },
          },
        ],
      },
    ],
    wsRoot: wsRootE,
    repo,
    seedDir,
  });

  const result = await runner.run(
    makeTask({ id: "task-e" }),
    makeContext(repo),
  );

  assert.equal(result.outcome, "escalated");
  const r = result as {
    outcome: "escalated";
    proposalCommit?: string;
    reason: string;
  };
  assert.equal(
    r.proposalCommit,
    undefined,
    "no proposalCommit for no-change escalation",
  );
  assert.ok(r.reason.includes("not sure"), `reason carried: ${r.reason}`);
});

// ---------------------------------------------------------------------------
// (f) Agent removes .git → failed ResultCaptureError
// ---------------------------------------------------------------------------

test("(f) agent removes .git → failed ResultCaptureError", async () => {
  const homeDir = join(tmpRoot, "home-f");
  const wsRootF = join(tmpRoot, "ws-f");
  await mkdir(wsRootF, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [
      { toolCalls: [{ name: "bash", arguments: { command: "rm -rf .git" } }] },
      { text: "done" },
    ],
    wsRoot: wsRootF,
    repo,
    seedDir,
  });

  const result = await runner.run(
    makeTask({ id: "task-f" }),
    makeContext(repo),
  );

  assert.equal(result.outcome, "failed");
  const r = result as { outcome: "failed"; reason: string };
  assert.ok(
    r.reason.startsWith("ResultCaptureError"),
    `reason must start with ResultCaptureError, got: ${r.reason}`,
  );
});

// ---------------------------------------------------------------------------
// (g) D6: task.verification commands pass → completed, evidence has entries
// ---------------------------------------------------------------------------

test("(g) D6: verification commands all exit 0 → candidate (changed work), evidence array has entries in order", async () => {
  const homeDir = join(tmpRoot, "home-g");
  const wsRootG = join(tmpRoot, "ws-g");
  await mkdir(wsRootG, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          { name: "write", arguments: { path: "DONE.md", content: "done\n" } },
        ],
      },
      { text: "I created the file." },
    ],
    wsRoot: wsRootG,
    repo,
    seedDir,
  });

  const task = makeTask({
    id: "task-g",
    verification: ['sh -c "exit 0"', "echo ok"],
  });

  const result = await runner.run(task, makeContext(repo));

  assert.equal(result.outcome, "candidate");
  const r = result as {
    outcome: "candidate";
    candidateCommit?: string;
    baseCommit?: string;
    summary?: string;
  };
  assert.ok(r.candidateCommit, "candidateCommit set after verified change");
  assert.equal(r.baseCommit, seedHead, "baseCommit is seed HEAD");
  assert.ok(r.summary, "summary present for the candidate");
});

// ---------------------------------------------------------------------------
// (h) Verification command exits 7 → failed VerificationFailedError, no finalize commit
// ---------------------------------------------------------------------------

test("(h) verification exits 7 → failed VerificationFailedError, branch still at agent state (no finalize)", async () => {
  const homeDir = join(tmpRoot, "home-h");
  const wsRootH = join(tmpRoot, "ws-h");
  await mkdir(wsRootH, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          {
            name: "write",
            arguments: { path: "CHANGE.md", content: "change\n" },
          },
        ],
      },
      { text: "I made a change." },
    ],
    wsRoot: wsRootH,
    repo,
    seedDir,
  });

  const task = makeTask({ id: "task-h", verification: ["exit 7"] });

  const result = await runner.run(task, makeContext(repo));

  assert.equal(result.outcome, "failed");
  const r = result as { outcome: "failed"; reason: string };
  assert.ok(
    r.reason.startsWith("VerificationFailedError"),
    `reason must start with VerificationFailedError, got: ${r.reason}`,
  );
  assert.ok(
    r.reason.includes("exit 7"),
    `reason must name exit 7, got: ${r.reason}`,
  );

  // no finalize commit — workspace HEAD is at seedHead (no commit was made)
  const wsDir = join(wsRootH, "task-h");
  const wsHead = await git(wsDir, "rev-parse", "HEAD");
  assert.equal(
    wsHead,
    seedHead,
    "no finalize commit was made when verification failed",
  );
});

// ---------------------------------------------------------------------------
// (i) Escalating session with verification set → escalated, commands never run
// ---------------------------------------------------------------------------

test("(i) escalate with verification set → escalated, verification commands never executed", async () => {
  const homeDir = join(tmpRoot, "home-i");
  const wsRootI = join(tmpRoot, "ws-i");
  await mkdir(wsRootI, { recursive: true });
  const repo = makeRepo(homeDir);

  // Probe file: if the verification command runs, it will create this file.
  // After the task, we assert it does NOT exist.
  const probeCmd = `touch ${join(wsRootI, "probe-was-run.txt")}`;

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          {
            name: "write",
            arguments: { path: "PROPOSAL.md", content: "proposal\n" },
          },
        ],
      },
      {
        toolCalls: [
          { name: "escalate", arguments: { reason: "please review" } },
        ],
      },
    ],
    wsRoot: wsRootI,
    repo,
    seedDir,
  });

  const task = makeTask({ id: "task-i", verification: [probeCmd] });

  const result = await runner.run(task, makeContext(repo));

  assert.equal(result.outcome, "escalated");

  // Probe file must NOT exist — commands were never run
  const probeExists = await rm(join(wsRootI, "probe-was-run.txt"))
    .then(() => true)
    .catch(() => false);
  assert.equal(
    probeExists,
    false,
    "verification probe command must not have been executed",
  );
});

// ---------------------------------------------------------------------------
// (j) No verification field → completed, evidence undefined
// ---------------------------------------------------------------------------

test("(j) no verification field → candidate (changed work), evidence undefined", async () => {
  const homeDir = join(tmpRoot, "home-j");
  const wsRootJ = join(tmpRoot, "ws-j");
  await mkdir(wsRootJ, { recursive: true });
  const repo = makeRepo(homeDir);

  const runner = makeRunner({
    turns: [
      {
        toolCalls: [
          { name: "write", arguments: { path: "DONE.md", content: "done\n" } },
        ],
      },
      { text: "I wrote the file." },
    ],
    wsRoot: wsRootJ,
    repo,
    seedDir,
  });

  // makeTask does NOT include verification field
  const task = makeTask({ id: "task-j" });

  const result = await runner.run(task, makeContext(repo));

  assert.equal(result.outcome, "candidate");
  const r = result as {
    outcome: "candidate";
    candidateCommit?: string;
    baseCommit?: string;
    evidence?: VerificationEvidence[];
  };
  assert.ok(r.candidateCommit, "candidateCommit set");
  assert.equal(r.baseCommit, seedHead, "baseCommit is seed HEAD");
  assert.equal(
    r.evidence,
    undefined,
    "evidence must be absent when task has no verification",
  );
});
