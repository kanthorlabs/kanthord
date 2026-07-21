/**
 * Story 10 T1 — EPIC 006 agent smoke test
 *
 * Four phases through the composition root with a FakeSessionFactory override
 * injected at the buildDeps seam — hermetic, no network, no real AI calls.
 *
 *   Phase 1+2: happy path (README edit → completed) + escalation round-trip
 *   Phase 3:   rejection resolutions — retry (re-run with feedback) + discard
 *   Phase 4:   credential provider mismatch → daemon exits 1
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { buildDeps } from "../../composition.ts";
import { runCli as dispatch } from "./commands/run-cli.ts";
import { FakeSessionFactory } from "../../agent-runner/fake-session.ts";
import type { FakeTurn } from "../../agent-runner/fake-session.ts";
import type { ProviderSessionFactory } from "../../agent-runner/pi-session.ts";
import { CredentialError } from "../../agent-runner/pi-session.ts";
import type { AIProvider, Credential } from "../../domain/resource.ts";

const execFileAsync = promisify(execFileCb);
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ---------------------------------------------------------------------------
// Fake session factory — queued turns; throws CredentialError on mismatch.
// ---------------------------------------------------------------------------

class SmokeSessionFactory {
  private readonly _queue: FakeTurn[][];

  constructor(queue: FakeTurn[][]) {
    this._queue = queue;
  }

  async for(aiProvider: AIProvider, credential: Credential): Promise<unknown> {
    if (aiProvider.provider !== credential.provider) {
      throw new CredentialError(
        credential.name,
        credential.provider,
        `provider mismatch: ${credential.provider} vs ${aiProvider.provider}`,
      );
    }
    const turns = this._queue.shift();
    if (turns === undefined) {
      throw new Error("SmokeSessionFactory: no more turns in queue");
    }
    const fake = new FakeSessionFactory(turns);
    return {
      model: {} as unknown,
      streamFn: fake.streamFn,
      getApiKey: () => "smoke-fake-key",
    };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Initialize a local sandbox git repo with a README and an origin remote. */
async function makeSandbox(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@localhost"], {
    cwd: dir,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# seed\n");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

  // Create a bare origin so the workspace manager can fetch it hermetically
  // (no network). The repository resource's remote-url points at this clone.
  const originDir = `${dir}.git`;
  await execFileAsync("git", ["clone", "--bare", dir, originDir], {});
  await execFileAsync(
    "git",
    ["remote", "add", "origin", `file://${originDir}`],
    { cwd: dir },
  );
  await execFileAsync("git", ["fetch", "origin"], { cwd: dir });
}

/**
 * Run the standard resource + project setup (db migrate, project, ai-provider,
 * credential, repository, initiative, objective) and return the key ids.
 */
async function runSetup(
  deps: ReturnType<typeof buildDeps>,
  sandboxDir: string,
  credentialValue: string = "smoke-fake-key",
): Promise<{
  PROJECT: string;
  AIPROV: string;
  CRED: string;
  REPO: string;
  INITIATIVE: string;
  OBJECTIVE: string;
}> {
  const m = await dispatch(["db", "migrate"], deps);
  assert.equal(m.exitCode, 0, "db migrate");

  const p = await dispatch(
    ["create", "project", "--name", "smoke-project"],
    deps,
  );
  assert.equal(p.exitCode, 0);
  const PROJECT = p.stdout[0]!;
  assert.match(PROJECT, ULID_RE);

  const ap = await dispatch(
    [
      "create",
      "ai-provider",
      "--project",
      PROJECT,
      "--name",
      "openai",
      "--provider",
      "openai",
      "--model",
      "gpt-5.5",
    ],
    deps,
  );
  assert.equal(ap.exitCode, 0);
  const AIPROV = ap.stdout[0]!;
  assert.match(AIPROV, ULID_RE);

  // D4: --value is removed; write value to a temp file and use --value-file
  const credValueFile = join(sandboxDir, ".credential-value");
  await writeFile(credValueFile, credentialValue, { encoding: "utf8" });
  const cr = await dispatch(
    [
      "create",
      "credential",
      "--project",
      PROJECT,
      "--name",
      "openai-key",
      "--provider",
      "openai",
      "--value-file",
      credValueFile,
    ],
    deps,
  );
  assert.equal(cr.exitCode, 0);
  const CRED = cr.stdout[0]!;
  assert.match(CRED, ULID_RE);

  const rp = await dispatch(
    [
      "create",
      "repository",
      "--project",
      PROJECT,
      "--name",
      "sandbox",
      "--remote-url",
      `file://${sandboxDir}.git`,
      "--branch",
      "main",
      "--path",
      sandboxDir,
    ],
    deps,
  );
  assert.equal(rp.exitCode, 0);
  const REPO = rp.stdout[0]!;
  assert.match(REPO, ULID_RE);

  const ini = await dispatch(
    [
      "create",
      "initiative",
      "--project",
      PROJECT,
      "--name",
      "smoke-initiative",
    ],
    deps,
  );
  assert.equal(ini.exitCode, 0);
  const INITIATIVE = ini.stdout[0]!;
  assert.match(INITIATIVE, ULID_RE);

  const obj = await dispatch(
    [
      "create",
      "objective",
      "--initiative",
      INITIATIVE,
      "--name",
      "smoke-objective",
    ],
    deps,
  );
  assert.equal(obj.exitCode, 0);
  const OBJECTIVE = obj.stdout[0]!;
  assert.match(OBJECTIVE, ULID_RE);

  return { PROJECT, AIPROV, CRED, REPO, INITIATIVE, OBJECTIVE };
}

function makeCtxArgs(
  aiprovId: string,
  credId: string,
  repoId: string,
): string[] {
  return [
    "--context",
    `ai_provider=${aiprovId}`,
    "--context",
    `credential=${credId}`,
    "--context",
    `repository=${repoId}`,
  ];
}

// ---------------------------------------------------------------------------
// Phase 1+2: happy path + escalation round-trip
// ---------------------------------------------------------------------------

test("Phase 1+2: happy path README edit and escalation round-trip", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-agent-smoke-"));
  const sandboxDir = join(tmpRoot, "sandbox");
  const dbPath = join(tmpRoot, "kanthord.db");

  try {
    await makeSandbox(sandboxDir);

    // Phase 1 session: bash edits README, then text "Done"
    // Phase 2 (TASK2): bash edits a file, then escalate
    // Phase 2 (TASK3 dependent): text "done after approval"
    const factory = new SmokeSessionFactory([
      // TASK1
      [
        {
          toolCalls: [
            {
              name: "bash",
              arguments: { command: "printf '# Title\\n' > README.md" },
            },
          ],
        },
        { text: "Added H1 title to README.md" },
      ],
      // TASK2 (escalate)
      [
        {
          toolCalls: [
            {
              name: "bash",
              arguments: { command: "echo 'second line' >> README.md" },
            },
          ],
        },
        {
          toolCalls: [
            { name: "escalate", arguments: { reason: "need human review" } },
          ],
        },
      ],
      // TASK3 (dependent of TASK2, runs after approval)
      // Needs a bash call so genericProfile.verify sees hasChanges=true (not NO_CHANGES)
      [
        {
          toolCalls: [
            {
              name: "bash",
              arguments: { command: "echo 'cleanup done' >> cleanup.txt" },
            },
          ],
        },
        { text: "finished" },
      ],
    ]);

    const deps = buildDeps(dbPath, {
      sessionFactory: factory as unknown as ProviderSessionFactory,
    });

    const { PROJECT, AIPROV, CRED, REPO, INITIATIVE, OBJECTIVE } =
      await runSetup(deps, sandboxDir);

    // ── Phase 1 ──────────────────────────────────────────────────────────────

    const t1 = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "add title to README",
        "--instructions",
        "Add an H1 title to README.md",
        "--ac",
        "README begins with a level-1 heading",
        ...makeCtxArgs(AIPROV, CRED, REPO),
      ],
      deps,
    );
    assert.equal(t1.exitCode, 0, "create task 1 exits 0");
    const TASK1 = t1.stdout[0]!;
    assert.match(TASK1, ULID_RE, "task1 is a ULID");

    const d1 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(
      d1.exitCode,
      0,
      "Phase 1 daemon exits 0 (changed task gates as a candidate)",
    );

    // get task 1 with --json
    const g1 = await dispatch(["get", "task", "--id", TASK1, "--json"], deps);
    assert.equal(g1.exitCode, 0, "get task1 exits 0");
    const task1Data = JSON.parse(g1.stdout[0]!) as {
      id: string;
      status: string;
      result?: {
        workspace: string | null;
        branch: string | null;
        baseCommit: string | null;
        proposalCommit: string | null;
      };
    };
    assert.equal(
      task1Data.status,
      "awaiting_confirmation",
      "task1 is awaiting_confirmation (changed work gates as a candidate)",
    );
    assert.ok(task1Data.result !== undefined, "task1 has a result");
    assert.ok(
      task1Data.result.workspace !== null,
      "task1 result has workspace",
    );
    assert.ok(task1Data.result.branch !== null, "task1 result has branch");
    assert.ok(
      task1Data.result.baseCommit !== null,
      "task1 result has baseCommit",
    );
    assert.ok(
      task1Data.result.proposalCommit !== null,
      "task1 result has proposalCommit (candidate)",
    );
    assert.equal(
      task1Data.result.branch,
      `kanthord/${TASK1}`,
      "task1 branch is kanthord/<task-id>",
    );

    // sandbox README must still be "# seed\n" (untouched — change is gated)
    const sandboxReadme = await readFile(join(sandboxDir, "README.md"), "utf8");
    assert.equal(
      sandboxReadme,
      "# seed\n",
      "sandbox README is untouched after Phase 1",
    );

    // approve TASK1 → lands the candidate onto the canonical branch + completed
    const approve1 = await dispatch(["approve", "task", "--id", TASK1], deps);
    assert.equal(approve1.exitCode, 0, "approve task1 exits 0");

    const g1after = await dispatch(
      ["get", "task", "--id", TASK1, "--json"],
      deps,
    );
    assert.equal(g1after.exitCode, 0, "get task1 after approve exits 0");
    const task1After = JSON.parse(g1after.stdout[0]!) as {
      status: string;
      result?: { workspace: string | null; commitSha: string | null };
    };
    assert.equal(
      task1After.status,
      "completed",
      "TASK1 is completed after approval",
    );
    assert.ok(
      task1After.result?.commitSha !== null,
      "TASK1 completed has a commitSha (landed proposal)",
    );

    // events: task.started → agent.started → ≥1 agent.progress → agent.finished
    //   → task.approved → task.completed
    const ev1 = await dispatch(
      ["list", "event", "--after", "0", "--limit", "1000", "--json"],
      deps,
    );
    assert.equal(ev1.exitCode, 0, "events exits 0");
    const task1Events = ev1.stdout
      .map((line) => JSON.parse(line) as { type: string; taskId: string })
      .filter((e) => e.taskId === TASK1)
      .map((e) => e.type);

    const startIdx = task1Events.indexOf("task.started");
    const agentStartIdx = task1Events.indexOf("agent.started");
    const progressIdx = task1Events.findIndex((t) => t === "agent.progress");
    const agentFinishedIdx = task1Events.lastIndexOf("agent.finished");
    const approvedIdx = task1Events.indexOf("task.approved");
    const completedIdx = task1Events.lastIndexOf("task.completed");

    assert.ok(startIdx !== -1, "task.started event emitted");
    assert.ok(agentStartIdx !== -1, "agent.started event emitted");
    assert.ok(progressIdx !== -1, "at least one agent.progress event emitted");
    assert.ok(agentFinishedIdx !== -1, "agent.finished event emitted");
    assert.ok(approvedIdx !== -1, "task.approved event emitted");
    assert.ok(completedIdx !== -1, "task.completed event emitted");
    assert.ok(startIdx < agentStartIdx, "task.started before agent.started");
    assert.ok(
      agentStartIdx < progressIdx,
      "agent.started before first progress",
    );
    assert.ok(progressIdx < agentFinishedIdx, "progress before agent.finished");
    assert.ok(
      agentFinishedIdx < approvedIdx,
      "agent.finished before task.approved",
    );
    assert.ok(
      approvedIdx < completedIdx,
      "task.approved before task.completed",
    );

    // ── Phase 2 ──────────────────────────────────────────────────────────────

    // TASK2 (will escalate) + TASK3 (depends on TASK2)
    const t2 = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "add second line to README",
        "--instructions",
        "Add a second line and escalate for review",
        "--ac",
        "second line added",
        ...makeCtxArgs(AIPROV, CRED, REPO),
      ],
      deps,
    );
    assert.equal(t2.exitCode, 0);
    const TASK2 = t2.stdout[0]!;
    assert.match(TASK2, ULID_RE);

    const t3 = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "cleanup after review",
        "--instructions",
        "Do cleanup",
        "--ac",
        "cleaned up",
        "--dependencies",
        TASK2,
        ...makeCtxArgs(AIPROV, CRED, REPO),
      ],
      deps,
    );
    assert.equal(t3.exitCode, 0);
    const TASK3 = t3.stdout[0]!;
    assert.match(TASK3, ULID_RE);

    const d2 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d2.exitCode, 0, "Phase 2 first daemon exits 0");
    assert.ok(
      d2.stderr.some((l) => l.includes("1 task(s) awaiting confirmation")),
      "daemon reports 1 task awaiting confirmation",
    );

    const g2 = await dispatch(["get", "task", "--id", TASK2, "--json"], deps);
    assert.equal(g2.exitCode, 0);
    const task2Data = JSON.parse(g2.stdout[0]!) as {
      status: string;
      result?: {
        workspace: string | null;
        branch: string | null;
        baseCommit: string | null;
        proposalCommit: string | null;
      };
    };
    assert.equal(
      task2Data.status,
      "awaiting_confirmation",
      "TASK2 is awaiting_confirmation",
    );
    assert.ok(task2Data.result !== undefined, "TASK2 has a result row");

    // proposal branch exists in workspace
    if (
      task2Data.result?.workspace !== null &&
      task2Data.result?.workspace !== undefined
    ) {
      const { stdout: proposalRef } = await execFileAsync(
        "git",
        ["rev-parse", `kanthord/proposal/${TASK2}`],
        { cwd: task2Data.result.workspace },
      );
      assert.ok(
        proposalRef.trim().length > 0,
        "kanthord/proposal/<TASK2> branch exists in workspace",
      );
    }

    // task.escalated event has reason = "need human review"
    const ev2 = await dispatch(
      ["list", "event", "--after", "0", "--limit", "1000", "--json"],
      deps,
    );
    const task2EscalatedEvent = ev2.stdout
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            taskId: string;
            payload?: Record<string, string>;
          },
      )
      .find((e) => e.taskId === TASK2 && e.type === "task.escalated");
    assert.ok(
      task2EscalatedEvent !== undefined,
      "task.escalated event emitted for TASK2",
    );
    assert.equal(
      task2EscalatedEvent?.payload?.["reason"],
      "need human review",
      "escalated event carries the reason",
    );

    // TASK3 still pending
    const g3before = await dispatch(
      ["get", "task", "--id", TASK3, "--json"],
      deps,
    );
    const task3Before = JSON.parse(g3before.stdout[0]!) as { status: string };
    assert.equal(
      task3Before.status,
      "pending",
      "TASK3 is still pending before approval",
    );

    // approve TASK2
    const approve = await dispatch(["approve", "task", "--id", TASK2], deps);
    assert.equal(approve.exitCode, 0, "approve task2 exits 0");

    // kanthord/<TASK2> branch now at proposal commit
    const g2after = await dispatch(
      ["get", "task", "--id", TASK2, "--json"],
      deps,
    );
    const task2After = JSON.parse(g2after.stdout[0]!) as {
      status: string;
      result?: {
        workspace: string | null;
        commitSha: string | null;
        proposalCommit: string | null;
      };
    };
    assert.equal(
      task2After.status,
      "completed",
      "TASK2 is completed after approval",
    );
    if (
      task2After.result?.workspace !== null &&
      task2After.result?.workspace !== undefined
    ) {
      const { stdout: branchAfter } = await execFileAsync(
        "git",
        ["rev-parse", `kanthord/${TASK2}`],
        { cwd: task2After.result.workspace },
      );
      assert.equal(
        branchAfter.trim(),
        task2After.result.commitSha,
        "kanthord/<TASK2> branch at proposal commit after approval",
      );
    }

    // second daemon run makes TASK3 a candidate (changed work gates)
    const d3 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d3.exitCode, 0, "Phase 2 second daemon exits 0");

    const g3after = await dispatch(
      ["get", "task", "--id", TASK3, "--json"],
      deps,
    );
    const task3After = JSON.parse(g3after.stdout[0]!) as { status: string };
    assert.equal(
      task3After.status,
      "awaiting_confirmation",
      "TASK3 gates as awaiting_confirmation (changed work is a candidate)",
    );

    // approve TASK3 → lands the candidate + completed
    const approve3 = await dispatch(["approve", "task", "--id", TASK3], deps);
    assert.equal(approve3.exitCode, 0, "approve task3 exits 0");

    const g3final = await dispatch(
      ["get", "task", "--id", TASK3, "--json"],
      deps,
    );
    const task3Final = JSON.parse(g3final.stdout[0]!) as { status: string };
    assert.equal(
      task3Final.status,
      "completed",
      "TASK3 completes after approval",
    );

    // events: task.escalated → task.approved → task.completed for TASK2
    const ev3 = await dispatch(
      ["list", "event", "--after", "0", "--limit", "1000", "--json"],
      deps,
    );
    const task2Events = ev3.stdout
      .map((line) => JSON.parse(line) as { type: string; taskId: string })
      .filter((e) => e.taskId === TASK2)
      .map((e) => e.type);
    const escalIdx = task2Events.indexOf("task.escalated");
    const approveIdx = task2Events.indexOf("task.approved");
    const completedIdx2 = task2Events.indexOf("task.completed");
    assert.ok(escalIdx !== -1, "task.escalated event present for TASK2");
    assert.ok(approveIdx !== -1, "task.approved event present for TASK2");
    assert.ok(completedIdx2 !== -1, "task.completed event present for TASK2");
    assert.ok(escalIdx < approveIdx, "task.escalated before task.approved");
    assert.ok(
      approveIdx < completedIdx2,
      "task.approved before task.completed",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 3: rejection resolutions (retry + discard)
// ---------------------------------------------------------------------------

test("Phase 3a: retry rejection — task re-runs and completes; no task.failed event", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-agent-smoke-"));
  const sandboxDir = join(tmpRoot, "sandbox");
  const dbPath = join(tmpRoot, "kanthord.db");

  try {
    await makeSandbox(sandboxDir);

    // TASK_RETRY run 1: escalate; run 2: complete
    const factory = new SmokeSessionFactory([
      [
        {
          toolCalls: [
            {
              name: "bash",
              arguments: { command: "echo 'retry content' >> file.txt" },
            },
          ],
        },
        {
          toolCalls: [
            { name: "escalate", arguments: { reason: "needs review" } },
          ],
        },
      ],
      // Needs a bash call so genericProfile.verify sees hasChanges=true (not NO_CHANGES)
      [
        {
          toolCalls: [
            {
              name: "bash",
              arguments: {
                command: "echo 'done after retry' >> retry-done.txt",
              },
            },
          ],
        },
        { text: "done after retry" },
      ],
    ]);

    const deps = buildDeps(dbPath, {
      sessionFactory: factory as unknown as ProviderSessionFactory,
    });
    const { AIPROV, CRED, REPO, OBJECTIVE } = await runSetup(deps, sandboxDir);

    const t = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "retry task",
        "--instructions",
        "do something",
        "--ac",
        "done",
        ...makeCtxArgs(AIPROV, CRED, REPO),
      ],
      deps,
    );
    assert.equal(t.exitCode, 0);
    const TASK_RETRY = t.stdout[0]!;

    // first daemon run → escalates
    const d1 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d1.exitCode, 0, "first daemon exits 0 (escalated)");
    assert.ok(
      d1.stderr.some((l) => l.includes("1 task(s) awaiting confirmation")),
      "escalation reported",
    );

    // reject with retry
    const rj = await dispatch(
      [
        "reject",
        "task",
        "--id",
        TASK_RETRY,
        "--resolution",
        "retry",
        "--reason",
        "please fix this issue",
      ],
      deps,
    );
    assert.equal(rj.exitCode, 0, "reject task exits 0");

    // task is pending (NOT failed)
    const gRetry = await dispatch(
      ["get", "task", "--id", TASK_RETRY, "--json"],
      deps,
    );
    const retryData = JSON.parse(gRetry.stdout[0]!) as { status: string };
    assert.equal(retryData.status, "pending", "rejected-retry task is pending");

    // no task.failed event was emitted
    const ev = await dispatch(
      ["list", "event", "--after", "0", "--limit", "1000", "--json"],
      deps,
    );
    const failedEvents = ev.stdout
      .map((line) => JSON.parse(line) as { type: string; taskId: string })
      .filter((e) => e.taskId === TASK_RETRY && e.type === "task.failed");
    assert.equal(
      failedEvents.length,
      0,
      "no task.failed event for retry-rejected task",
    );

    // second daemon run → gates as a candidate (changed work after retry)
    const d2 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d2.exitCode, 0, "second daemon exits 0 (candidate)");

    const gAfter = await dispatch(
      ["get", "task", "--id", TASK_RETRY, "--json"],
      deps,
    );
    const afterData = JSON.parse(gAfter.stdout[0]!) as { status: string };
    assert.equal(
      afterData.status,
      "awaiting_confirmation",
      "TASK_RETRY gates as awaiting_confirmation after retry (changed work is a candidate)",
    );

    // approve TASK_RETRY → lands the candidate + completed
    const approveRetry = await dispatch(
      ["approve", "task", "--id", TASK_RETRY],
      deps,
    );
    assert.equal(approveRetry.exitCode, 0, "approve task-retry exits 0");

    const gFinal = await dispatch(
      ["get", "task", "--id", TASK_RETRY, "--json"],
      deps,
    );
    const finalData = JSON.parse(gFinal.stdout[0]!) as { status: string };
    assert.equal(
      finalData.status,
      "completed",
      "TASK_RETRY completed after approval",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("Phase 3b: discard rejection — task discarded, dependent blocked, daemon still exits 0", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-agent-smoke-"));
  const sandboxDir = join(tmpRoot, "sandbox");
  const dbPath = join(tmpRoot, "kanthord.db");

  try {
    await makeSandbox(sandboxDir);

    // TASK_DISCARD: escalate (then discard); TASK_DEP never runs
    const factory = new SmokeSessionFactory([
      [
        {
          toolCalls: [
            {
              name: "bash",
              arguments: { command: "echo 'discard content' >> discard.txt" },
            },
          ],
        },
        {
          toolCalls: [
            { name: "escalate", arguments: { reason: "discard this" } },
          ],
        },
      ],
    ]);

    const deps = buildDeps(dbPath, {
      sessionFactory: factory as unknown as ProviderSessionFactory,
    });
    const { AIPROV, CRED, REPO, OBJECTIVE } = await runSetup(deps, sandboxDir);

    const td = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "discard task",
        "--instructions",
        "do something to discard",
        "--ac",
        "n/a",
        ...makeCtxArgs(AIPROV, CRED, REPO),
      ],
      deps,
    );
    assert.equal(td.exitCode, 0);
    const TASK_DISCARD = td.stdout[0]!;

    const tdep = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "dependent task",
        "--instructions",
        "depends on discard task",
        "--ac",
        "n/a",
        "--dependencies",
        TASK_DISCARD,
        ...makeCtxArgs(AIPROV, CRED, REPO),
      ],
      deps,
    );
    assert.equal(tdep.exitCode, 0);
    const TASK_DEP = tdep.stdout[0]!;

    // first daemon run → TASK_DISCARD escalates
    const d1 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d1.exitCode, 0, "daemon exits 0 after escalation");
    assert.ok(
      d1.stderr.some((l) => l.includes("1 task(s) awaiting confirmation")),
      "escalation reported",
    );

    // discard
    const rj = await dispatch(
      ["reject", "task", "--id", TASK_DISCARD, "--resolution", "discard"],
      deps,
    );
    assert.equal(rj.exitCode, 0, "reject with discard exits 0");

    // TASK_DISCARD is discarded
    const gd = await dispatch(
      ["get", "task", "--id", TASK_DISCARD, "--json"],
      deps,
    );
    const discardData = JSON.parse(gd.stdout[0]!) as { status: string };
    assert.equal(discardData.status, "discarded", "TASK_DISCARD is discarded");

    // events: task.discarded + task.blocked for TASK_DEP
    const ev = await dispatch(
      ["list", "event", "--after", "0", "--limit", "1000", "--json"],
      deps,
    );
    const allEvents = ev.stdout.map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          taskId: string;
          payload?: Record<string, string>;
        },
    );
    const discardedEvent = allEvents.find(
      (e) => e.taskId === TASK_DISCARD && e.type === "task.discarded",
    );
    assert.ok(discardedEvent !== undefined, "task.discarded event emitted");
    const blockedEvent = allEvents.find(
      (e) => e.taskId === TASK_DEP && e.type === "task.blocked",
    );
    assert.ok(
      blockedEvent !== undefined,
      "task.blocked event emitted for dependent",
    );
    assert.equal(
      blockedEvent?.payload?.["dependencyId"],
      TASK_DISCARD,
      "task.blocked names the discarded dependency",
    );

    // daemon run — exits 0, dependent never runs
    const d2 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d2.exitCode, 0, "daemon exits 0 when dependent is blocked");

    // TASK_DEP dependencyStatus shows the discarded dependency
    const gdep = await dispatch(
      ["get", "task", "--id", TASK_DEP, "--json"],
      deps,
    );
    const depData = JSON.parse(gdep.stdout[0]!) as {
      status: string;
      dependencyStatus?: Array<{ id: string; status: string }>;
    };
    assert.ok(
      depData.dependencyStatus?.some(
        (ds) => ds.id === TASK_DISCARD && ds.status === "discarded",
      ),
      "dependent's dependencyStatus lists discarded dependency",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 4: credential provider mismatch → daemon exits 1
// ---------------------------------------------------------------------------

test("Phase 4: provider-mismatched credential fails daemon exit 1; no credential value in output", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-agent-smoke-"));
  const sandboxDir = join(tmpRoot, "sandbox");
  const dbPath = join(tmpRoot, "kanthord.db");

  const BAD_CRED_VALUE = "secret-bad-cred-value";

  try {
    await makeSandbox(sandboxDir);

    // Factory will throw CredentialError when provider mismatch is detected;
    // no turns needed since session.for() never returns.
    const factory = new SmokeSessionFactory([]);

    const deps = buildDeps(dbPath, {
      sessionFactory: factory as unknown as ProviderSessionFactory,
    });
    const { PROJECT, AIPROV, REPO, INITIATIVE, OBJECTIVE } = await runSetup(
      deps,
      sandboxDir,
    );

    // Create a credential with provider="anthropic" (mismatches ai_provider's "openai")
    // D4: --value is removed; write value to a temp file and use --value-file
    const badCredValueFile = join(sandboxDir, ".bad-credential-value");
    await writeFile(badCredValueFile, BAD_CRED_VALUE, { encoding: "utf8" });
    const badCr = await dispatch(
      [
        "create",
        "credential",
        "--project",
        PROJECT,
        "--name",
        "wrong-provider",
        "--provider",
        "anthropic",
        "--value-file",
        badCredValueFile,
      ],
      deps,
    );
    assert.equal(badCr.exitCode, 0);
    const BADCRED = badCr.stdout[0]!;

    const t4 = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "task with bad credential",
        "--instructions",
        "will fail due to provider mismatch",
        "--ac",
        "n/a",
        "--context",
        `ai_provider=${AIPROV}`,
        "--context",
        `credential=${BADCRED}`,
        "--context",
        `repository=${REPO}`,
      ],
      deps,
    );
    assert.equal(t4.exitCode, 0);
    const TASK4 = t4.stdout[0]!;

    // daemon exits 1 (EPIC 005 contract: failed task → non-zero exit)
    const d4 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d4.exitCode, 1, "Phase 4 daemon exits 1 for credential error");

    // task is failed
    const g4 = await dispatch(["get", "task", "--id", TASK4, "--json"], deps);
    assert.equal(g4.exitCode, 0);
    const task4Data = JSON.parse(g4.stdout[0]!) as {
      status: string;
      result?: { reason: string | null };
    };
    assert.equal(task4Data.status, "failed", "TASK4 is failed");

    // task.failed event reason starts with "CredentialError"
    const ev4 = await dispatch(
      ["list", "event", "--after", "0", "--limit", "1000", "--json"],
      deps,
    );
    const failedEvent = ev4.stdout
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            taskId: string;
            payload?: Record<string, string>;
          },
      )
      .find((e) => e.taskId === TASK4 && e.type === "task.failed");
    assert.ok(failedEvent !== undefined, "task.failed event emitted");
    assert.ok(
      failedEvent?.payload?.["reason"]?.startsWith("CredentialError"),
      `task.failed reason starts with CredentialError, got: ${failedEvent?.payload?.["reason"]}`,
    );

    // no output anywhere contains the bad credential value
    const allOutput = [
      ...d4.stdout,
      ...d4.stderr,
      ...g4.stdout,
      ...g4.stderr,
      ...ev4.stdout,
      ...ev4.stderr,
    ].join(" ");
    assert.ok(
      !allOutput.includes(BAD_CRED_VALUE),
      "bad credential value must not appear in any output",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
