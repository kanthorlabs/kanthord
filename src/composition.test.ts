import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { buildDeps, buildEmitCallback } from "./composition.ts";
import type { Event } from "./domain/event.ts";
import type { Logger } from "./logger/port.ts";
import type { Repository } from "./domain/resource.ts";
import { LocalWorkspaceManager } from "./workspace/local.ts";
import { runCli as dispatch } from "./apps/cli/commands/run-cli.ts";

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

// Story 03 T3 — get resource via dispatch: credential value absent from stdout (D6 + composition wiring)
// Characterization test: the SE implemented the composition.ts wiring in T2's GREEN phase.
// Sensitivity: if 'getResource' is removed from buildDeps or the dispatch handler breaks,
// exitCode would be non-zero and/or the credential value would appear in stdout.
test("T3: dispatch get resource returns credential view with canary value absent from stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t3-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);

    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    const rp = await dispatch(["create", "project", "--name", "t3demo"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    // Use the use case directly (CLI create credential requires --value-file; bypass for smoke).
    const CANARY = "CANARY_SECRET_VALUE";
    const credId = await deps.addResource.execute({
      type: "credential",
      projectId: PROJECT,
      name: "k1",
      provider: "anthropic",
      value: CANARY,
    });

    const rg = await dispatch(["get", "resource", "--id", credId], deps);
    assert.equal(rg.exitCode, 0, "get resource exits 0");
    assert.ok(
      !rg.stdout.join("").includes(CANARY),
      "canary credential value is absent from get resource stdout (D6 structural omission)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 04 T4 — CLI: remove --allow-unknown-model / --base-url; surface
// UnknownModelError as exitCode 1 with "list model" in stderr.
// ---------------------------------------------------------------------------

// T4a: PRIMARY RED test.
// UnknownModelError from PiModelCatalog (via buildDeps) must be handled by
// toResult → exitCode 1 with "list model" in stderr.
// FAILS today: UnknownModelError is not in toResult's guard, so it re-throws;
// dispatch propagates the exception instead of returning { exitCode: 1, ... }.
test("T4a: dispatch create ai-provider with unknown model returns exitCode 1 with 'list model' in stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4a-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    await dispatch(["db", "migrate"], deps);
    const rp = await dispatch(["create", "project", "--name", "t4demo"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    const result = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "bad",
        "--provider",
        "openai-codex",
        "--model",
        "no-such-model-xyz",
      ],
      deps,
    );

    assert.equal(result.exitCode, 1, "unknown model must return exitCode 1");
    assert.ok(
      result.stderr.join("").toLowerCase().includes("list model"),
      `expected 'list model' in stderr, got: ${result.stderr.join("")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T4b: Characterization — --allow-unknown-model was never in the parse config;
// strict mode already rejects it. This pinned the pre-existing behavior.
test("T4b: dispatch create ai-provider with --allow-unknown-model returns exitCode 1 (unknown option)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4b-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    await dispatch(["db", "migrate"], deps);
    const rp = await dispatch(["create", "project", "--name", "t4bdemo"], deps);
    const PROJECT = rp.stdout[0]!;

    const result = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "x",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
        "--allow-unknown-model",
      ],
      deps,
    );

    assert.equal(
      result.exitCode,
      1,
      "--allow-unknown-model (unknown flag) must return exitCode 1 from strict parse",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// T4c: Characterization — valid pair succeeds end-to-end with real PiModelCatalog.
test("T4c: dispatch create ai-provider with valid pair (openai-codex/gpt-5.6-terra) returns exitCode 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-t4c-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    await dispatch(["db", "migrate"], deps);
    const rp = await dispatch(["create", "project", "--name", "t4cdemo"], deps);
    const PROJECT = rp.stdout[0]!;

    const result = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "gpt",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
      ],
      deps,
    );

    assert.equal(result.exitCode, 0, "valid model must succeed");
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDeps returns a RouterDeps bundle with all registered capabilities", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-test-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    assert.ok(
      typeof deps === "object" && deps !== null,
      "buildDeps returns an object",
    );
    assert.ok("migrateDb" in deps, "deps.migrateDb present");
    assert.ok("getDbStatus" in deps, "deps.getDbStatus present");
    assert.ok("createProject" in deps, "deps.createProject present");
    assert.ok("renameProject" in deps, "deps.renameProject present");
    assert.ok("getProject" in deps, "deps.getProject present");
    assert.ok("findProject" in deps, "deps.findProject present");
    assert.ok("createInitiative" in deps, "deps.createInitiative present");
    assert.ok("renameInitiative" in deps, "deps.renameInitiative present");
    assert.ok("findInitiative" in deps, "deps.findInitiative present");
    assert.ok("createObjective" in deps, "deps.createObjective present");
    assert.ok("renameObjective" in deps, "deps.renameObjective present");
    assert.ok("findObjective" in deps, "deps.findObjective present");
    assert.ok("addResource" in deps, "deps.addResource present");
    assert.ok("findResource" in deps, "deps.findResource present");
    assert.ok("createTask" in deps, "deps.createTask present");
    assert.ok("addDependency" in deps, "deps.addDependency present");
    assert.ok("removeDependency" in deps, "deps.removeDependency present");
    assert.ok("listTasks" in deps, "deps.listTasks present");
    assert.ok("getResource" in deps, "deps.getResource present");
    // Story 05 T5 characterization: all five update use cases wired by SE in T4 GREEN
    assert.ok("updateAiProvider" in deps, "deps.updateAiProvider present");
    assert.ok("updateCredential" in deps, "deps.updateCredential present");
    assert.ok("updateRepository" in deps, "deps.updateRepository present");
    assert.ok("updateNotification" in deps, "deps.updateNotification present");
    assert.ok("updateFilesystem" in deps, "deps.updateFilesystem present");
    // Story C (007.12) — approve objective broker use case wired through composition
    assert.ok("approveObjective" in deps, "deps.approveObjective present");
    // Story E (007.12) — retry objective (conflict resolution) wired through composition
    assert.ok("retryObjective" in deps, "deps.retryObjective present");
    // Story F (007.12) — get initiative / get objective read use cases wired through composition
    assert.ok("getInitiative" in deps, "deps.getInitiative present");
    assert.ok("getObjective" in deps, "deps.getObjective present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 02 T1 (F2) — daemon accounting stdout line for agent.finished
// Focused test of the emit callback (the seam buildDaemon wires into the runner).
// Fails today: there is no exported buildEmitCallback, and the inline callback
// has no agent.finished branch, so no `agent finished:` line is emitted.
// ---------------------------------------------------------------------------
test("T1: emit callback prints `agent finished:` line with turns/tokensIn/tokensOut and still appends the event", () => {
  const lines: string[] = [];
  const logger: Logger = {
    info: (m: string) => lines.push(m),
    warn: () => {},
    error: () => {},
  };
  const appended: Event[] = [];
  const events = {
    append: (e: Event) => {
      appended.push(e);
    },
  };

  const emit = buildEmitCallback(logger, events);
  emit("t1", "agent.finished", {
    outcome: "completed",
    turns: "8",
    tokensIn: "1234",
    tokensOut: "567",
  });

  assert.ok(
    lines.includes(
      "task t1: agent finished: turns=8 tokensIn=1234 tokensOut=567",
    ),
    `expected the agent finished line; got: ${JSON.stringify(lines)}`,
  );
  // The event must still be appended to the feed (decoupled from the line).
  assert.equal(appended.length, 1, "exactly one event appended to the feed");
  assert.equal(appended[0]!.type, "agent.finished");
  assert.equal(appended[0]!.taskId, "t1");
});

// ---------------------------------------------------------------------------
// B1 regression (007.5) — composition wiring: retryTask must receive the
// ConflictCandidateStore (landingRepository) so that a conflict-marked
// awaiting_confirmation task recovers to pending via the real wired path.
//
// Fails against the current (unwired) composition because RetryTask is
// constructed without the 6th candidateStore arg, so execute() always throws
// TaskNotRetryableError for awaiting_confirmation tasks.
// ---------------------------------------------------------------------------
test("B1 regression: retryTask wired with candidateStore recovers a conflict-candidate task through the real buildDeps composition", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-b1-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);

    // Set up schema
    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    // Create minimal entity tree: project → initiative → objective → task
    const rp = await dispatch(["create", "project", "--name", "b1demo"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    const ri = await dispatch(
      ["create", "initiative", "--project", PROJECT, "--name", "b1init"],
      deps,
    );
    assert.equal(ri.exitCode, 0, "create initiative exits 0");
    const INITIATIVE = ri.stdout[0]!;

    const ro = await dispatch(
      ["create", "objective", "--initiative", INITIATIVE, "--name", "b1obj"],
      deps,
    );
    assert.equal(ro.exitCode, 0, "create objective exits 0");
    const OBJECTIVE = ro.stdout[0]!;

    const rt = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "b1 task",
        "--instructions",
        "do it",
        "--ac",
        "done",
      ],
      deps,
    );
    assert.equal(rt.exitCode, 0, "create task exits 0");
    const TASK_ID = rt.stdout[0]!;

    // Use a second DatabaseSync connection to inject the conflict state.
    // (Both connections share the WAL-mode file; this is safe for test setup.)
    const db2 = new DatabaseSync(dbPath);

    // Transition task to awaiting_confirmation status directly in the DB.
    db2
      .prepare("UPDATE tasks SET status = 'awaiting_confirmation' WHERE id = ?")
      .run(TASK_ID);

    // Insert a landing_candidate row with state='conflict' for this task.
    const CAND_ID = "01JZZZZZZZZZZZZZZZZB1CAND1";
    db2
      .prepare(
        `INSERT INTO landing_candidates
           (id, task_id, repo_id, base_sha, candidate_sha, ref, target, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'conflict')`,
      )
      .run(
        CAND_ID,
        TASK_ID,
        "01JZZZZZZZZZZZZZZZZZZZREPOX",
        "deadbeef",
        "cafebabe",
        `kanthord/${TASK_ID}`,
        "main",
      );
    db2.close();

    // Call retryTask through the real wired composition-root instance.
    // FAILS today: RetryTask is wired without the 6th ConflictCandidateStore arg,
    // so it throws TaskNotRetryableError(awaiting_confirmation) instead of recovering.
    await assert.doesNotReject(
      () => deps.retryTask.execute({ taskId: TASK_ID }),
      "conflict-candidate task must recover (not throw TaskNotRetryableError) when candidateStore is wired",
    );

    // After recovery the task must be pending.
    const rg = await dispatch(["get", "task", "--id", TASK_ID, "--json"], deps);
    assert.equal(rg.exitCode, 0, "get task exits 0");
    const taskJson = JSON.parse(rg.stdout.join("")) as { status: string };
    assert.equal(
      taskJson.status,
      "pending",
      `task must be pending after conflict-recovery retry; got: ${taskJson.status}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S3 (007.6) — composition: getPriorFeedback reads persisted note back
//
// RED today: buildDeps does not expose getPriorFeedback; calling
// deps.getPriorFeedback(taskId) throws TypeError at runtime.
// After SE renames getPriorRejection → getPriorFeedback and exposes the
// accessor from buildDeps, this test verifies the wiring end-to-end.
// ---------------------------------------------------------------------------
test("(S3-composition-note) composition: getPriorFeedback reads note persisted by retryTask.execute", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-s3-comp-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);

    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    // Create minimal entity tree: project → initiative → objective → task
    const rp = await dispatch(["create", "project", "--name", "s3demo"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    const ri = await dispatch(
      ["create", "initiative", "--project", PROJECT, "--name", "s3init"],
      deps,
    );
    assert.equal(ri.exitCode, 0, "create initiative exits 0");
    const INITIATIVE = ri.stdout[0]!;

    const ro = await dispatch(
      ["create", "objective", "--initiative", INITIATIVE, "--name", "s3obj"],
      deps,
    );
    assert.equal(ro.exitCode, 0, "create objective exits 0");
    const OBJECTIVE = ro.stdout[0]!;

    const rt = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "s3 task",
        "--instructions",
        "do it",
        "--ac",
        "done",
      ],
      deps,
    );
    assert.equal(rt.exitCode, 0, "create task exits 0");
    const TASK_ID = rt.stdout[0]!;

    // Inject conflict state directly via a second DB connection (same as B1 regression)
    const db2 = new DatabaseSync(dbPath);
    db2
      .prepare("UPDATE tasks SET status = 'awaiting_confirmation' WHERE id = ?")
      .run(TASK_ID);
    const CAND_ID = "01JZZZZZZZZZZZZZZZZS3CAND1";
    db2
      .prepare(
        `INSERT INTO landing_candidates
         (id, task_id, repo_id, base_sha, candidate_sha, ref, target, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'conflict')`,
      )
      .run(
        CAND_ID,
        TASK_ID,
        "01JZZZZZZZZZZZZZZZZZZZREPOY",
        "deadbeef",
        "cafebabe",
        `kanthord/${TASK_ID}`,
        "main",
      );
    db2.close();

    // Retry with a note — the note must be persisted
    await assert.doesNotReject(
      () =>
        deps.retryTask.execute({
          taskId: TASK_ID,
          note: "keep both handlers",
        } as Parameters<typeof deps.retryTask.execute>[0]),
      "conflict-candidate retry with note must not throw",
    );

    // RED: deps.getPriorFeedback is not yet exposed from buildDeps.
    // After the SE exposes it, calling it must return { note: "keep both handlers" }.
    const depsAny = deps as Record<string, unknown>;
    const getPriorFeedback = depsAny["getPriorFeedback"] as
      | ((
          taskId: string,
        ) =>
          | { note?: string; conflictContext?: string; priorSummary?: string }
          | undefined)
      | undefined;

    assert.ok(
      typeof getPriorFeedback === "function",
      "deps.getPriorFeedback must be exposed from buildDeps after the S3 rename",
    );

    const feedback = getPriorFeedback!(TASK_ID);
    assert.ok(
      feedback !== undefined,
      "getPriorFeedback must return a value after a note has been stored",
    );
    assert.equal(
      feedback.note,
      "keep both handlers",
      "getPriorFeedback must return the note that was persisted by retryTask.execute",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// EPIC 007.12 — daemon-path objective squash wiring gap
//
// The prior SE turn wired `initiativeWorkspaces.ensure` into buildDaemon's
// real RunNextTask, but flagged that the *squash* seam (`opts.workspaces`,
// the `WorkspaceSquasher`) plus the store's `getObjective`/`saveObjective`/
// `getObjectiveParentOid` reads are NOT supplied to the real `RunNextTask`
// constructed in `buildDaemon` — so the objective-boundary squash (Story B,
// already unit-tested against fakes in run-next-task.test.ts) never actually
// runs during a real `run daemon` pass. This is the exact gap the EPIC
// Proof's PASS B/C steps depend on.
//
// RED today: a real `buildDeps` composition, given an initiative-clone task
// (a "workspace" context binding surfaced by the initiative's persisted
// `workspace` column) that completes as the last task of its objective,
// never squashes and never transitions the objective past "building" —
// because `buildDaemon`'s real `RunNextTask` is constructed without a
// `workspaces` squasher or a store exposing `getObjective`/`saveObjective`/
// `getObjectiveParentOid`.
// ---------------------------------------------------------------------------
test("(007.12 daemon wiring) a real `run daemon` pass squashes an initiative-clone task's objective to awaiting_confirmation with a real commitOid", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-0712-daemon-squash-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    // Seed remote with one commit.
    const seedDir = join(dir, "seed.git");
    await mkdir(seedDir, { recursive: true });
    await execFile("git", ["init", "-b", "main"], { cwd: seedDir });
    await execFile("git", ["config", "user.email", "test@localhost"], {
      cwd: seedDir,
    });
    await execFile("git", ["config", "user.name", "Test"], { cwd: seedDir });
    await writeFile(join(seedDir, "README.md"), "# seed");
    await execFile("git", ["add", "."], { cwd: seedDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: seedDir });

    const deps = buildDeps(dbPath);
    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    const rp = await dispatch(
      ["create", "project", "--name", "sq-daemon"],
      deps,
    );
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    const ri = await dispatch(
      ["create", "initiative", "--project", PROJECT, "--name", "sq-init"],
      deps,
    );
    assert.equal(ri.exitCode, 0, "create initiative exits 0");
    const INIT_ID = ri.stdout[0]!;

    const ro = await dispatch(
      ["create", "objective", "--initiative", INIT_ID, "--name", "sq-obj"],
      deps,
    );
    assert.equal(ro.exitCode, 0, "create objective exits 0");
    const OBJ_ID = ro.stdout[0]!;

    const rt = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJ_ID,
        "--title",
        "sq task",
        "--instructions",
        "do it",
        "--ac",
        "done",
        "--agent",
        "fake@1",
      ],
      deps,
    );
    assert.equal(rt.exitCode, 0, "create task exits 0");
    const TASK_ID = rt.stdout[0]!;

    // Provision the initiative branch + isolated clone directly through a
    // standalone `LocalWorkspaceManager` (Story A's `prepareInitiative`,
    // already implemented/unit-tested) rather than `deps.workspaces`, whose
    // lock-file path construction does not yet handle a branch name
    // containing "/" (a separate, pre-existing bug unrelated to this
    // Task's wiring gap) — bypasses the FakeRunner (which performs no git
    // work of its own) either way.
    const homePath = join(dir, "home");
    const wsRoot = join(dir, "ws-root");
    await mkdir(wsRoot, { recursive: true });
    const bootstrapWorkspaces = new LocalWorkspaceManager({ root: wsRoot });

    // Persist a real repository resource (so composition.ts's
    // resolveInitiativeHomeDir / resolveInitiativeRepository /
    // getObjectiveParentOid — which read the "repository" context binding
    // off a task and then look the id up as a real project resource — can
    // resolve it) and bind it onto the task's context, mirroring how the
    // EPIC Proof's `import graph --bind repository=...` populates the same
    // "repository" task-context row.
    const rr = await dispatch(
      [
        "create",
        "repository",
        "--project",
        PROJECT,
        "--name",
        "sq-repo",
        "--remote-url",
        `file://${seedDir}`,
        "--branch",
        "main",
        "--auth",
        "ambient",
        "--path",
        homePath,
      ],
      deps,
    );
    assert.equal(rr.exitCode, 0, "create repository exits 0");
    const REPO_ID = rr.stdout[0]!;
    const repo: Repository = {
      id: REPO_ID,
      type: "repository",
      name: "sq-repo",
      remoteUrl: `file://${seedDir}`,
      branch: "main",
      path: homePath,
      auth: { kind: "ambient" },
    };
    await bootstrapWorkspaces.prepare("bootstrap-task", repo);
    const ws = await bootstrapWorkspaces.prepareInitiative(INIT_ID, repo);

    const dbCtx = new DatabaseSync(dbPath);
    dbCtx
      .prepare(
        "INSERT INTO task_context (task_id, type, resource_id) VALUES (?, 'repository', ?)",
      )
      .run(TASK_ID, REPO_ID);
    dbCtx.close();
    const homeInitRefBefore = await git(
      homePath,
      "rev-parse",
      `refs/heads/kanthord/init/${INIT_ID}`,
    );

    // Simulate the objective's work already having produced one commit in
    // the isolated clone (the real agent runner would do this; FakeRunner
    // does not).
    await writeFile(join(ws.dir, "work.txt"), "objective work\n");
    await execFile("git", ["add", "."], { cwd: ws.dir });
    await execFile(
      "git",
      [
        "-c",
        "user.email=test@localhost",
        "-c",
        "user.name=Test",
        "commit",
        "-m",
        "task work",
      ],
      { cwd: ws.dir },
    );

    // Record the provisioned clone dir on the initiative directly (the
    // same effect `ensureInitiativeWorkspace` would have produced, done here
    // so the manual commit above survives — `prepareInitiative` wipes and
    // re-clones its target directory on every call).
    const db2 = new DatabaseSync(dbPath);
    db2
      .prepare("UPDATE initiatives SET workspace = ? WHERE id = ?")
      .run(ws.dir, INIT_ID);
    db2.close();

    // Run a real daemon pass — this is the seam under test.
    const result = await deps.buildDaemon([]).execute({ untilIdle: true });
    assert.equal(result.exitCode, 0, "daemon run exits 0");

    const rg = await dispatch(
      ["get", "objective", "--id", OBJ_ID, "--json"],
      deps,
    );
    assert.equal(rg.exitCode, 0, "get objective exits 0");
    const objectiveJson = JSON.parse(rg.stdout.join("")) as {
      status: string;
    };
    assert.equal(
      objectiveJson.status,
      "awaiting_confirmation",
      `objective must be squashed to awaiting_confirmation once its last initiative-clone task completes; got status: ${objectiveJson.status}`,
    );

    // `GetObjective`/CLI does not expose `commitOid` (a separate, later
    // Task) — pin it via the persisted row directly, the same seam
    // `ApproveObjective`'s broker will read from.
    const db3 = new DatabaseSync(dbPath);
    const objRow = db3
      .prepare("SELECT commitOid FROM objectives WHERE id = ?")
      .get(OBJ_ID) as { commitOid: string | null };
    db3.close();
    assert.ok(
      typeof objRow.commitOid === "string" && objRow.commitOid.length > 0,
      "objective must record a real commitOid from the squash",
    );

    // The daemon-only broker (approve objective) has not run — home's
    // initiative branch must be untouched by the squash itself.
    const homeInitRefAfter = await git(
      homePath,
      "rev-parse",
      `refs/heads/kanthord/init/${INIT_ID}`,
    );
    assert.equal(
      homeInitRefAfter,
      homeInitRefBefore,
      "squashing in the clone must not write to the initiative branch in home",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// EPIC 007.12 Proof PASS C gap — a second objective's squash must chain onto
// the FIRST objective's own commitOid (domain state), not onto whatever SHA
// home's `kanthord/init/<initId>` ref currently happens to point at. When
// both objectives' tasks become ready and complete in one `run daemon`
// pass — before a human has run `approve objective` on the first one — home
// has NOT advanced past the initiative's original base yet. If the second
// objective's recorded `parentOid` is read from home's live ref (as
// `composition.ts`'s `getObjectiveParentOid` does today) instead of the
// first objective's own `commitOid`, the broker later sees the second
// objective's parent as the pre-initiative base — not the first objective's
// commit — so `countCommitsSince` on approval reports more than one commit
// and the objective is wrongly recorded as `conflict` instead of chaining
// linearly. This reproduces the EPIC Proof's real `FAIL C: count=1`.
// ---------------------------------------------------------------------------
test("(007.12 daemon wiring) a second objective's squash chains onto the first objective's own commitOid, not home's not-yet-advanced ref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-0712-sequential-obj-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const seedDir = join(dir, "seed.git");
    await mkdir(seedDir, { recursive: true });
    await execFile("git", ["init", "-b", "main"], { cwd: seedDir });
    await execFile("git", ["config", "user.email", "test@localhost"], {
      cwd: seedDir,
    });
    await execFile("git", ["config", "user.name", "Test"], { cwd: seedDir });
    await writeFile(join(seedDir, "README.md"), "# seed");
    await execFile("git", ["add", "."], { cwd: seedDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: seedDir });

    const deps = buildDeps(dbPath);
    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    const rp = await dispatch(["create", "project", "--name", "seq-obj"], deps);
    assert.equal(rp.exitCode, 0, "create project exits 0");
    const PROJECT = rp.stdout[0]!;

    const ri = await dispatch(
      ["create", "initiative", "--project", PROJECT, "--name", "seq-init"],
      deps,
    );
    assert.equal(ri.exitCode, 0, "create initiative exits 0");
    const INIT_ID = ri.stdout[0]!;

    const roA = await dispatch(
      ["create", "objective", "--initiative", INIT_ID, "--name", "obj-a"],
      deps,
    );
    assert.equal(roA.exitCode, 0, "create objective A exits 0");
    const OBJ_A_ID = roA.stdout[0]!;

    const roB = await dispatch(
      ["create", "objective", "--initiative", INIT_ID, "--name", "obj-b"],
      deps,
    );
    assert.equal(roB.exitCode, 0, "create objective B exits 0");
    const OBJ_B_ID = roB.stdout[0]!;

    const rtA = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJ_A_ID,
        "--title",
        "obj-a task",
        "--instructions",
        "do it",
        "--ac",
        "done",
        "--agent",
        "fake@1",
      ],
      deps,
    );
    assert.equal(rtA.exitCode, 0, "create task A exits 0");
    const TASK_A_ID = rtA.stdout[0]!;

    const rtB = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJ_B_ID,
        "--title",
        "obj-b task",
        "--instructions",
        "do it",
        "--ac",
        "done",
        "--dependencies",
        TASK_A_ID,
        "--agent",
        "fake@1",
      ],
      deps,
    );
    assert.equal(rtB.exitCode, 0, "create task B exits 0");
    const TASK_B_ID = rtB.stdout[0]!;

    const homePath = join(dir, "home");
    const wsRoot = join(dir, "ws-root");
    await mkdir(wsRoot, { recursive: true });
    const bootstrapWorkspaces = new LocalWorkspaceManager({ root: wsRoot });

    const rr = await dispatch(
      [
        "create",
        "repository",
        "--project",
        PROJECT,
        "--name",
        "seq-repo",
        "--remote-url",
        `file://${seedDir}`,
        "--branch",
        "main",
        "--auth",
        "ambient",
        "--path",
        homePath,
      ],
      deps,
    );
    assert.equal(rr.exitCode, 0, "create repository exits 0");
    const REPO_ID = rr.stdout[0]!;
    const repo: Repository = {
      id: REPO_ID,
      type: "repository",
      name: "seq-repo",
      remoteUrl: `file://${seedDir}`,
      branch: "main",
      path: homePath,
      auth: { kind: "ambient" },
    };
    await bootstrapWorkspaces.prepare("bootstrap-task", repo);
    const ws = await bootstrapWorkspaces.prepareInitiative(INIT_ID, repo);

    const dbCtx = new DatabaseSync(dbPath);
    dbCtx
      .prepare(
        "INSERT INTO task_context (task_id, type, resource_id) VALUES (?, 'repository', ?)",
      )
      .run(TASK_A_ID, REPO_ID);
    dbCtx
      .prepare(
        "INSERT INTO task_context (task_id, type, resource_id) VALUES (?, 'repository', ?)",
      )
      .run(TASK_B_ID, REPO_ID);
    dbCtx.close();

    const homeInitRefBefore = await git(
      homePath,
      "rev-parse",
      `refs/heads/kanthord/init/${INIT_ID}`,
    );

    const db1 = new DatabaseSync(dbPath);
    db1
      .prepare("UPDATE initiatives SET workspace = ? WHERE id = ?")
      .run(ws.dir, INIT_ID);
    db1.close();

    // FakeRunner performs no git work, so the "agent" work for each task is
    // scripted upfront. `RunDaemon.execute({ untilIdle: true })` drains the
    // WHOLE ready queue in one call — it claims + completes task A (which
    // squashes objective A's already-committed work to `awaiting_confirmation`),
    // and then, in the SAME call, claims + completes task B as soon as it
    // becomes ready (task A's dependency satisfied), with NO human
    // `approve objective` step in between — mirroring the real EPIC Proof,
    // where both objectives' tasks become ready and are built in the SAME
    // `run daemon --until-idle` pass.
    //
    // Because objective A's squash resets the clone to whatever is
    // committed at the moment task A completes, task B's own "changed work"
    // must land in the clone strictly AFTER task A's squash but before task
    // B is claimed — there is no await boundary between those two steps
    // that this test's own (sequential, single-threaded) code can land in.
    // The `Logger` passed to `buildDaemon` is an existing constructor seam
    // (3rd positional arg, already used for observability elsewhere in this
    // file); this test reuses it — synchronously, via `execFileSync` — to
    // commit task B's work the instant task A's completion is logged, still
    // inside the single `execute({ untilIdle: true })` call below.
    await writeFile(join(ws.dir, "a.txt"), "objective a work\n");
    await execFile("git", ["add", "."], { cwd: ws.dir });
    await execFile(
      "git",
      [
        "-c",
        "user.email=test@localhost",
        "-c",
        "user.name=Test",
        "commit",
        "-m",
        "obj a task work",
      ],
      { cwd: ws.dir },
    );

    const commitTaskBWork = (): void => {
      writeFileSync(join(ws.dir, "b.txt"), "objective b work\n");
      execFileSync("git", ["add", "."], { cwd: ws.dir });
      execFileSync(
        "git",
        [
          "-c",
          "user.email=test@localhost",
          "-c",
          "user.name=Test",
          "commit",
          "-m",
          "obj b task work",
        ],
        { cwd: ws.dir },
      );
    };
    let taskBWorkCommitted = false;
    const logger: Logger = {
      info: (message: string) => {
        if (!taskBWorkCommitted && message === `task ${TASK_A_ID}: completed`) {
          taskBWorkCommitted = true;
          commitTaskBWork();
        }
      },
      warn: () => {},
      error: () => {},
    };

    // Run the daemon once: a single `untilIdle` drain claims + completes
    // task A (squashing objective A to `awaiting_confirmation`), commits
    // task B's work via the logger hook above, then claims + completes
    // task B (squashing objective B) — all inside this one call.
    const result1 = await deps
      .buildDaemon([], undefined, logger)
      .execute({ untilIdle: true });
    assert.equal(result1.exitCode, 0, "daemon run exits 0");

    // Home's initiative branch has NOT been advanced — no `approve objective`
    // has run yet.
    const homeInitRefAfter = await git(
      homePath,
      "rev-parse",
      `refs/heads/kanthord/init/${INIT_ID}`,
    );
    assert.equal(
      homeInitRefAfter,
      homeInitRefBefore,
      "home's initiative branch must be untouched — no approve objective has run",
    );

    const db2 = new DatabaseSync(dbPath);
    const objA = db2
      .prepare("SELECT status, commitOid FROM objectives WHERE id = ?")
      .get(OBJ_A_ID) as { status: string; commitOid: string | null };
    const objB = db2
      .prepare("SELECT status, parentOid FROM objectives WHERE id = ?")
      .get(OBJ_B_ID) as { status: string; parentOid: string | null };
    db2.close();

    assert.equal(
      objA.status,
      "awaiting_confirmation",
      "objective A must be squashed to awaiting_confirmation",
    );
    assert.equal(
      objB.status,
      "awaiting_confirmation",
      "objective B must be squashed to awaiting_confirmation",
    );
    assert.ok(
      typeof objA.commitOid === "string" && objA.commitOid.length > 0,
      "objective A must record a real commitOid",
    );
    assert.equal(
      objB.parentOid,
      objA.commitOid,
      "objective B's recorded parentOid must chain onto objective A's own commitOid (domain state), " +
        "not home's live initiative-branch ref (which has not advanced — no approve objective has run yet)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
