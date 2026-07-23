/**
 * Story 11 T4 — GitRepositoryLanding adapter + SqliteLandingRepository
 *
 * All git-facing tests use real git in temp dirs (file:// remotes, no network).
 * Each test is hermetic: creates its own mkdtemp dir and removes it in finally.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { GitRepositoryLanding, buildConflictContext } from "./git.ts";
import type { LandingCandidate, PreviewOutcome } from "./port.ts";
import { SqliteLandingRepository } from "../storage/sqlite/landing.ts";
import { LocalWorkspaceManager } from "../workspace/local.ts";
import type {
  ChangeCandidate,
  CandidateState,
  Integration,
} from "../domain/landing.ts";

const execFileProm = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileProm("git", args, { cwd });
  return stdout.trim();
}

/** Initialises a non-bare git repo on `main`, makes an empty initial commit, returns baseSHA. */
async function initHome(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await execFileProm("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileProm("git", ["config", "user.email", "test@localhost"], {
    cwd: dir,
  });
  await execFileProm("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileProm("git", ["commit", "--allow-empty", "-q", "-m", "init"], {
    cwd: dir,
  });
  return git(dir, "rev-parse", "HEAD");
}

/** Clones homeDir into wsDir and sets git identity. */
async function cloneWs(homeDir: string, wsDir: string): Promise<void> {
  await execFileProm("git", ["clone", "-q", homeDir, wsDir]);
  await execFileProm("git", ["config", "user.email", "test@localhost"], {
    cwd: wsDir,
  });
  await execFileProm("git", ["config", "user.name", "Test"], { cwd: wsDir });
}

/** Writes a file in wsDir, stages it, commits it; returns new HEAD SHA. */
async function wsCommit(
  wsDir: string,
  filename: string,
  content: string,
  msg = "task output",
): Promise<string> {
  await writeFile(join(wsDir, filename), content);
  await execFileProm("git", ["add", filename], { cwd: wsDir });
  await execFileProm("git", ["commit", "-q", "-m", msg], { cwd: wsDir });
  return git(wsDir, "rev-parse", "HEAD");
}

function makeCandidate(
  id: string,
  repoId: string,
  baseSHA: string,
  candidateSHA: string,
  taskId = "task-1",
  workspace = "",
): LandingCandidate {
  return {
    id,
    taskId,
    repoId,
    baseSHA,
    candidateSHA,
    ref: `kanthord/${taskId}`,
    target: "main",
    workspace,
  };
}

const GIT_CONFIG = { name: "Test Merger", email: "test@localhost" };

/**
 * In-memory LandingRepository for git adapter tests.
 * Mirrors the LandingRepository interface that storage/port.ts will export.
 */
class FakeLandingRepository {
  readonly candidates = new Map<string, ChangeCandidate>();
  readonly integrations = new Map<string, Integration>();

  saveCandidate(candidate: ChangeCandidate): void {
    this.candidates.set(candidate.id, { ...candidate });
  }
  getCandidate(id: string): ChangeCandidate | undefined {
    return this.candidates.get(id);
  }
  updateCandidateState(id: string, state: CandidateState): void {
    const c = this.candidates.get(id);
    if (c !== undefined) this.candidates.set(id, { ...c, state });
  }
  saveIntegration(integration: Integration): void {
    this.integrations.set(integration.candidateId, { ...integration });
  }
  getIntegration(candidateId: string): Integration | undefined {
    return this.integrations.get(candidateId);
  }
}

/** Creates an in-memory SQLite DB with just the landing tables (no FK constraints). */
function openLandingDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE landing_candidates (
      id            TEXT PRIMARY KEY,
      task_id       TEXT,
      repo_id       TEXT NOT NULL,
      base_sha      TEXT NOT NULL,
      candidate_sha TEXT NOT NULL,
      ref           TEXT NOT NULL,
      target        TEXT NOT NULL,
      state         TEXT NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','landed','conflict'))
    );
    CREATE TABLE landing_integrations (
      candidate_id  TEXT PRIMARY KEY,
      outcome       TEXT NOT NULL,
      canonical_sha TEXT NOT NULL,
      merge_commit  TEXT,
      conflict_files TEXT
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// (a) Fast-forward landing
// ---------------------------------------------------------------------------
test("(a) ff: candidateSHA on direct-ancestor path is fast-forward landed", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-a-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "answer.ts",
      "export const x = 1;",
    );

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-a",
      "repo-a",
      baseSHA,
      candidateSHA,
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "fast-forward",
      "direct ancestor preview must be fast-forward",
    );
    const result = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      result.outcome.kind,
      "fast-forward",
      "direct ancestor must produce fast-forward outcome",
    );
    assert.equal(
      result.canonicalSHA,
      candidateSHA,
      "canonicalSHA must equal candidateSHA after ff",
    );
    const homeHead = await git(homeDir, "rev-parse", "main");
    assert.equal(
      homeHead,
      candidateSHA,
      "home main HEAD must equal candidateSHA after fast-forward",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) Merge landing
// ---------------------------------------------------------------------------
test("(b) merge: diverged candidate produces merge commit on home main", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-b-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // workspace commits file_a.ts (the candidate we will land)
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    // home also makes a commit (diverge) — candidate is now NOT a linear ancestor
    await writeFile(join(homeDir, "file_b.ts"), "const b = 2;");
    await execFileProm("git", ["add", "file_b.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "diverge on home"], {
      cwd: homeDir,
    });

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-b",
      "repo-b",
      baseSHA,
      candidateSHA,
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "mergeable",
      "diverged candidate preview must be mergeable",
    );
    assert.ok(
      previewOutcome.kind === "mergeable" &&
        typeof previewOutcome.treeOID === "string" &&
        previewOutcome.treeOID.length > 0,
      "mergeable preview must carry treeOID",
    );

    const result = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      result.outcome.kind,
      "merge",
      "diverged candidate should produce merge outcome",
    );
    const outcome = result.outcome;
    assert.ok(
      outcome.kind === "merge" && outcome.mergeCommit,
      "merge result must carry mergeCommit SHA",
    );

    // candidateSHA must now be reachable from home main
    const isAncestor = await execFileProm(
      "git",
      ["merge-base", "--is-ancestor", candidateSHA, "main"],
      { cwd: homeDir },
    )
      .then(() => true)
      .catch(() => false);
    assert.ok(
      isAncestor,
      "candidateSHA must be ancestor of home main after merge",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) Conflict detection via preview — returns conflict outcome with files
// ---------------------------------------------------------------------------
test("(c) conflict: conflicting changes produce conflict preview outcome with file listed", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-c-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    // home: initial commit with conflict.ts
    await mkdir(homeDir, { recursive: true });
    await execFileProm("git", ["init", "-q", "-b", "main"], { cwd: homeDir });
    await execFileProm("git", ["config", "user.email", "test@localhost"], {
      cwd: homeDir,
    });
    await execFileProm("git", ["config", "user.name", "Test"], {
      cwd: homeDir,
    });
    await writeFile(join(homeDir, "conflict.ts"), "const x = 'base';\n");
    await execFileProm("git", ["add", "conflict.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "init with conflict.ts"], {
      cwd: homeDir,
    });
    const baseSHA = await git(homeDir, "rev-parse", "HEAD");

    // ws: clone, modify conflict.ts in a conflicting way
    await cloneWs(homeDir, wsDir);
    await writeFile(join(wsDir, "conflict.ts"), "const x = 'ws-version';\n");
    await execFileProm("git", ["add", "conflict.ts"], { cwd: wsDir });
    await execFileProm("git", ["commit", "-q", "-m", "ws change"], {
      cwd: wsDir,
    });
    const candidateSHA = await git(wsDir, "rev-parse", "HEAD");

    // home: also modify conflict.ts differently (diverge + conflict)
    await writeFile(
      join(homeDir, "conflict.ts"),
      "const x = 'home-version';\n",
    );
    await execFileProm("git", ["add", "conflict.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "home diverge"], {
      cwd: homeDir,
    });

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-c",
      "repo-c",
      baseSHA,
      candidateSHA,
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);

    assert.equal(
      previewOutcome.kind,
      "conflict",
      "conflicting changes must return conflict preview outcome",
    );
    assert.ok(
      previewOutcome.kind === "conflict" &&
        previewOutcome.files.includes("conflict.ts"),
      `conflict files must include 'conflict.ts'; got ${previewOutcome.kind === "conflict" ? JSON.stringify(previewOutcome.files) : "(wrong kind)"}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) Crash-idempotent recovery: pending row + unmerged candidate → completes on retry
// ---------------------------------------------------------------------------
test("(d) crash-idempotent: pending row + unmerged candidate → land completes on retry", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-d-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "output.ts",
      "export const done = true;",
    );

    // Simulate crash: pre-populate the candidate as 'pending' (saveCandidate was called
    // before crash; git mutation never happened). Use FakeLandingRepository with pre-seeded state.
    const fakeRepo = new FakeLandingRepository();
    const crashedCandidate: ChangeCandidate = {
      id: "cand-d",
      taskId: "task-d",
      repoId: "repo-d",
      baseSHA,
      candidateSHA,
      ref: "kanthord/task-d",
      target: "main",
      state: "pending",
    };
    fakeRepo.saveCandidate(crashedCandidate); // as if crash happened after this call

    // Retry: new GitRepositoryLanding instance using the same fake repo (same in-memory state).
    // The adapter finds the pending row; candidateSHA is NOT yet an ancestor → proceeds with landing.
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-d",
      "repo-d",
      baseSHA,
      candidateSHA,
      "task-d",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    const result = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      result.outcome.kind,
      "fast-forward",
      "crash-recovery must complete with fast-forward",
    );
    const homeHead = await git(homeDir, "rev-parse", "main");
    assert.equal(
      homeHead,
      candidateSHA,
      "home main HEAD must be candidateSHA after crash-recovery land",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (e) Already-landed: candidateSHA already reachable → already-landed, no mutation
// ---------------------------------------------------------------------------
test("(e) already-landed: candidateSHA reachable from target returns already-landed without mutation", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-e-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "done.ts",
      "export const v = 1;",
    );

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-e",
      "repo-e",
      baseSHA,
      candidateSHA,
      "task-1",
      wsDir,
    );

    // First land succeeds (ff) via object path
    {
      const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
      const previewOutcome = await landing.preview(homeDir, cand, targetOID);
      assert.equal(
        previewOutcome.kind,
        "fast-forward",
        "setup: first preview must be ff",
      );
      await landing.landPreviewed(homeDir, cand, previewOutcome, targetOID);
    }
    const headAfterFirst = await git(homeDir, "rev-parse", "main");

    // Second land: same candidate — candidateSHA is now the current main tip
    const fakeRepo2 = new FakeLandingRepository();
    const landing2 = new GitRepositoryLanding(lockDir, fakeRepo2, GIT_CONFIG);
    const targetOID2 = await landing2.resolveTargetOID(homeDir, cand.target);
    const previewOutcome2 = await landing2.preview(homeDir, cand, targetOID2);
    const result2 = await landing2.landPreviewed(
      homeDir,
      cand,
      previewOutcome2,
      targetOID2,
    );

    // With the object path, re-landing a landed candidate is a no-op ff (CAS update-ref from its own OID)
    assert.equal(
      result2.outcome.kind,
      "fast-forward",
      "re-landing same candidateSHA via object path returns fast-forward (no-op CAS)",
    );
    const headAfterSecond = await git(homeDir, "rev-parse", "main");
    assert.equal(
      headAfterSecond,
      headAfterFirst,
      "home main HEAD must not change after re-landing an already-landed candidate",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (f) Lock contention: two concurrent landPreviewed calls serialize; no stale lock
// ---------------------------------------------------------------------------
test("(f) lock-contention: two concurrent landPreviewed calls serialize; at least one lands, no stale .lock", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-f-"));
  try {
    const homeDir = join(tmp, "home");
    const ws1Dir = join(tmp, "ws1");
    const ws2Dir = join(tmp, "ws2");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, ws1Dir);
    await cloneWs(homeDir, ws2Dir);

    const sha1 = await wsCommit(ws1Dir, "file_a.ts", "const a = 1;");
    const sha2 = await wsCommit(ws2Dir, "file_b.ts", "const b = 2;");

    const cand1 = makeCandidate(
      "cand-f1",
      "repo-f",
      baseSHA,
      sha1,
      "task-f1",
      ws1Dir,
    );
    const cand2 = makeCandidate(
      "cand-f2",
      "repo-f",
      baseSHA,
      sha2,
      "task-f2",
      ws2Dir,
    );

    const fakeRepo1 = new FakeLandingRepository();
    const fakeRepo2 = new FakeLandingRepository();
    const lander1 = new GitRepositoryLanding(lockDir, fakeRepo1, GIT_CONFIG);
    const lander2 = new GitRepositoryLanding(lockDir, fakeRepo2, GIT_CONFIG);

    // Both preview concurrently (no lock needed — pure read-only)
    const targetOID = await lander1.resolveTargetOID(homeDir, "main");
    const [preview1, preview2] = await Promise.all([
      lander1.preview(homeDir, cand1, targetOID),
      lander2.preview(homeDir, cand2, targetOID),
    ]);
    assert.equal(preview1.kind, "fast-forward", "cand1 preview must be ff");
    assert.equal(preview2.kind, "fast-forward", "cand2 preview must be ff");

    // Concurrent landPreviewed: one acquires the lock and advances the branch;
    // the other gets a CAS mismatch (branch moved between preview and CAS).
    // Both should settle without throwing unexpected errors.
    const settled = await Promise.allSettled([
      lander1.landPreviewed(homeDir, cand1, preview1, targetOID),
      lander2.landPreviewed(homeDir, cand2, preview2, targetOID),
    ]);
    const outcomes = settled.map((s) =>
      s.status === "fulfilled" ? s.value.outcome.kind : "CAS-mismatch",
    );
    assert.ok(
      outcomes.includes("fast-forward") || outcomes.includes("merge"),
      `at least one land must succeed (ff or merge); outcomes: ${JSON.stringify(outcomes)}`,
    );

    // No stale lock file after both complete
    const lockFiles = (await readdir(lockDir)).filter((f) =>
      f.endsWith(".lock"),
    );
    assert.equal(
      lockFiles.length,
      0,
      `no stale lock files must remain after both lands complete; found: ${lockFiles.join(", ")}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SqliteLandingRepository CRUD smoke tests
// ---------------------------------------------------------------------------
test("SqliteLandingRepository: saveCandidate + getCandidate round-trips id, state, candidateSHA", () => {
  const db = openLandingDb();
  const repo = new SqliteLandingRepository(db);

  const cand: ChangeCandidate = {
    id: "sql-cand-1",
    taskId: "task-x",
    repoId: "repo-x",
    baseSHA: "abc123",
    candidateSHA: "def456",
    ref: "kanthord/task-x",
    target: "main",
    state: "pending",
  };

  repo.saveCandidate(cand);
  const found = repo.getCandidate("sql-cand-1");
  assert.ok(
    found !== undefined,
    "getCandidate must return the saved candidate",
  );
  assert.equal(found.id, "sql-cand-1");
  assert.equal(found.state, "pending");
  assert.equal(found.candidateSHA, "def456");
  assert.equal(found.repoId, "repo-x");
});

test("SqliteLandingRepository: updateCandidateState changes state field", () => {
  const db = openLandingDb();
  const repo = new SqliteLandingRepository(db);

  const cand: ChangeCandidate = {
    id: "sql-cand-2",
    taskId: "task-y",
    repoId: "repo-y",
    baseSHA: "aaa",
    candidateSHA: "bbb",
    ref: "kanthord/task-y",
    target: "main",
    state: "pending",
  };

  repo.saveCandidate(cand);
  repo.updateCandidateState("sql-cand-2", "landed");
  const updated = repo.getCandidate("sql-cand-2");
  assert.ok(updated !== undefined);
  assert.equal(updated.state, "landed");
});

// ---------------------------------------------------------------------------
// Story 5 T2 — land onto the CONFIGURED branch (not `main`) of the home repo.
// Every test below uses a home repo whose canonical branch is `trunk` while the
// checked-out branch is `main`, proving `land()` updates the NAMED target ref
// (not the currently checked-out HEAD). The pre-fix code merges into HEAD
// (`main`), leaving `trunk` untouched → these tests RED until the adapter
// targets `candidate.target` under CAS.
// ---------------------------------------------------------------------------

/** Initialises a git repo on `branch`, makes an empty initial commit, returns baseSHA. */
async function initHomeBranch(dir: string, branch: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await execFileProm("git", ["init", "-q", "-b", branch], { cwd: dir });
  await execFileProm("git", ["config", "user.email", "test@localhost"], {
    cwd: dir,
  });
  await execFileProm("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileProm("git", ["commit", "--allow-empty", "-q", "-m", "init"], {
    cwd: dir,
  });
  return git(dir, "rev-parse", "HEAD");
}

/** Writes+commits a file on the CURRENTLY checked-out branch of `dir`; returns new HEAD SHA. */
async function homeCommit(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  await writeFile(join(dir, filename), content);
  await execFileProm("git", ["add", filename], { cwd: dir });
  await execFileProm("git", ["commit", "-q", "-m", `home change ${filename}`], {
    cwd: dir,
  });
  return git(dir, "rev-parse", "HEAD");
}

function makeCandidateTargeted(
  id: string,
  repoId: string,
  baseSHA: string,
  candidateSHA: string,
  target: string,
  taskId = "task-1",
  workspace = "",
): LandingCandidate {
  return {
    id,
    taskId,
    repoId,
    baseSHA,
    candidateSHA,
    ref: `kanthord/${taskId}`,
    target,
    workspace,
  };
}

test("Story 05 T2 (a) fast-forward lands onto the configured non-main target branch (trunk) and advances that named ref", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-t2a-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHomeBranch(homeDir, "trunk");
    await execFileProm("git", ["checkout", "-q", "-b", "main"], {
      cwd: homeDir,
    }); // HEAD = main (not target)

    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "answer.ts",
      "export const x = 1;",
    );

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidateTargeted(
      "cand-t2a",
      "repo-t2a",
      baseSHA,
      candidateSHA,
      "trunk",
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(previewOutcome.kind, "fast-forward");
    const result = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      result.outcome.kind,
      "fast-forward",
      "linear descendant of trunk must fast-forward",
    );
    assert.equal(
      result.canonicalSHA,
      candidateSHA,
      "canonicalSHA must equal candidateSHA after ff",
    );
    const trunkHead = await git(homeDir, "rev-parse", "trunk");
    assert.equal(
      trunkHead,
      candidateSHA,
      "the named target ref 'trunk' must advance to candidateSHA",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("Story 05 T2 (b) diverged candidate merges onto the configured non-main target branch (trunk)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-t2b-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHomeBranch(homeDir, "trunk");
    await execFileProm("git", ["checkout", "-q", "-b", "main"], {
      cwd: homeDir,
    });
    // diverge: add a commit directly on trunk (the target), then back to main
    await execFileProm("git", ["checkout", "-q", "trunk"], { cwd: homeDir });
    await homeCommit(homeDir, "file_b.ts", "const b = 2;");
    await execFileProm("git", ["checkout", "-q", "main"], { cwd: homeDir });

    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidateTargeted(
      "cand-t2b",
      "repo-t2b",
      baseSHA,
      candidateSHA,
      "trunk",
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "mergeable",
      "diverged candidate preview must be mergeable",
    );
    const result = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      result.outcome.kind,
      "merge",
      "diverged candidate must merge onto trunk",
    );
    const parents = (
      await git(homeDir, "rev-list", "--parents", "-n", "1", "trunk")
    ).split(" ").length;
    assert.equal(parents, 3, "trunk must be a merge commit with two parents");
    const reachable = await execFileProm(
      "git",
      ["merge-base", "--is-ancestor", candidateSHA, "trunk"],
      { cwd: homeDir },
    )
      .then(() => true)
      .catch(() => false);
    assert.ok(
      reachable,
      "candidateSHA must be reachable from trunk after merge",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("Story 05 T2 (c) landing onto a non-checked-out target leaves the checked-out branch (main) untouched", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-t2c-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHomeBranch(homeDir, "trunk");
    await execFileProm("git", ["checkout", "-q", "-b", "main"], {
      cwd: homeDir,
    });

    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "answer.ts",
      "export const x = 1;",
    );

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidateTargeted(
      "cand-t2c",
      "repo-t2c",
      baseSHA,
      candidateSHA,
      "trunk",
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    await landing.landPreviewed(homeDir, cand, previewOutcome, targetOID);

    const mainHead = await git(homeDir, "rev-parse", "main");
    assert.equal(
      mainHead,
      baseSHA,
      "the checked-out branch main must NOT advance when landing onto trunk",
    );
    const trunkHead = await git(homeDir, "rev-parse", "trunk");
    assert.equal(
      trunkHead,
      candidateSHA,
      "the named target ref trunk must advance to candidateSHA",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S1 (007.6) — preview: non-mutating conflict prediction via merge-tree --write-tree
// ---------------------------------------------------------------------------

test("(S1-preview-a) preview fast-forward: returns {kind:'fast-forward',candidateOID}; refs/HEAD/status unchanged", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s1pa-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "file.ts",
      "export const v = 1;",
    );

    // candidateSHA is a direct descendant of baseSHA → fast-forward
    const targetOID = baseSHA;

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s1pa",
      "repo-s1pa",
      baseSHA,
      candidateSHA,
      "task-s1pa",
      wsDir,
    );

    const beforeBranch = await git(homeDir, "rev-parse", "main");
    const beforeHead = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: bso } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    const beforeStatus = bso.trim();

    const outcome = await landing.preview(homeDir, cand, targetOID);

    const afterBranch = await git(homeDir, "rev-parse", "main");
    const afterHead = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: aso } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    const afterStatus = aso.trim();

    assert.equal(
      outcome.kind,
      "fast-forward",
      "direct ancestor must return kind fast-forward",
    );
    assert.ok(
      outcome.kind === "fast-forward" && outcome.candidateOID === candidateSHA,
      `candidateOID must equal candidateSHA; got ${outcome.kind === "fast-forward" ? outcome.candidateOID : "(wrong kind)"}`,
    );
    assert.equal(
      afterBranch,
      beforeBranch,
      "main ref must be unchanged after ff preview",
    );
    assert.equal(
      afterHead,
      beforeHead,
      "HEAD must be unchanged after ff preview",
    );
    assert.equal(
      afterStatus,
      beforeStatus,
      "worktree/index status must be unchanged after ff preview",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(S1-preview-b) preview mergeable: returns {kind:'mergeable',treeOID} (treeOID is a real tree object); refs/HEAD/status unchanged", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s1pb-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // ws: add file_a.ts (disjoint change)
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    // home: diverging commit on file_b.ts (disjoint from candidate)
    await writeFile(join(homeDir, "file_b.ts"), "const b = 2;");
    await execFileProm("git", ["add", "file_b.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "home diverge"], {
      cwd: homeDir,
    });
    const targetOID = await git(homeDir, "rev-parse", "main");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s1pb",
      "repo-s1pb",
      baseSHA,
      candidateSHA,
      "task-s1pb",
      wsDir,
    );

    const beforeBranch = await git(homeDir, "rev-parse", "main");
    const beforeHead = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: bso } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    const beforeStatus = bso.trim();

    const outcome = await landing.preview(homeDir, cand, targetOID);

    const afterBranch = await git(homeDir, "rev-parse", "main");
    const afterHead = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: aso } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    const afterStatus = aso.trim();

    assert.equal(
      outcome.kind,
      "mergeable",
      "disjoint changes must return kind mergeable",
    );
    assert.ok(
      outcome.kind === "mergeable" &&
        typeof outcome.treeOID === "string" &&
        outcome.treeOID.length > 0,
      `treeOID must be a non-empty string; got ${outcome.kind === "mergeable" ? outcome.treeOID : "(wrong kind)"}`,
    );

    if (outcome.kind === "mergeable") {
      const { stdout: objType } = await execFileProm(
        "git",
        ["cat-file", "-t", outcome.treeOID],
        { cwd: homeDir },
      );
      assert.equal(
        objType.trim(),
        "tree",
        "treeOID must refer to a real tree object in the object DB",
      );
    }

    assert.equal(
      afterBranch,
      beforeBranch,
      "main ref must be unchanged after mergeable preview",
    );
    assert.equal(
      afterHead,
      beforeHead,
      "HEAD must be unchanged after mergeable preview",
    );
    assert.equal(
      afterStatus,
      beforeStatus,
      "worktree/index status must be unchanged after mergeable preview",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(S1-preview-c) preview conflict: returns {kind:'conflict',files,perFile} with <<<<<<< and >>>>>>>; refs/HEAD/status unchanged", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s1pc-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    // home: initial commit with conflict.ts
    await mkdir(homeDir, { recursive: true });
    await execFileProm("git", ["init", "-q", "-b", "main"], { cwd: homeDir });
    await execFileProm("git", ["config", "user.email", "test@localhost"], {
      cwd: homeDir,
    });
    await execFileProm("git", ["config", "user.name", "Test"], {
      cwd: homeDir,
    });
    await writeFile(join(homeDir, "conflict.ts"), "const x = 'base';\n");
    await execFileProm("git", ["add", "conflict.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "init with conflict.ts"], {
      cwd: homeDir,
    });
    const baseSHA = await git(homeDir, "rev-parse", "HEAD");

    // ws: conflicting change to conflict.ts
    await cloneWs(homeDir, wsDir);
    await writeFile(join(wsDir, "conflict.ts"), "const x = 'ws-version';\n");
    await execFileProm("git", ["add", "conflict.ts"], { cwd: wsDir });
    await execFileProm("git", ["commit", "-q", "-m", "ws change"], {
      cwd: wsDir,
    });
    const candidateSHA = await git(wsDir, "rev-parse", "HEAD");

    // home: also modify conflict.ts differently (diverge + conflict)
    await writeFile(
      join(homeDir, "conflict.ts"),
      "const x = 'home-version';\n",
    );
    await execFileProm("git", ["add", "conflict.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "home diverge"], {
      cwd: homeDir,
    });
    const targetOID = await git(homeDir, "rev-parse", "main");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s1pc",
      "repo-s1pc",
      baseSHA,
      candidateSHA,
      "task-s1pc",
      wsDir,
    );

    const beforeBranch = await git(homeDir, "rev-parse", "main");
    const beforeHead = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: bso } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    const beforeStatus = bso.trim();

    const outcome = await landing.preview(homeDir, cand, targetOID);

    const afterBranch = await git(homeDir, "rev-parse", "main");
    const afterHead = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: aso } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    const afterStatus = aso.trim();

    assert.equal(
      outcome.kind,
      "conflict",
      "conflicting changes must return kind conflict",
    );
    assert.ok(
      outcome.kind === "conflict" && outcome.files.includes("conflict.ts"),
      `files must include 'conflict.ts'; got ${outcome.kind === "conflict" ? JSON.stringify(outcome.files) : "(wrong kind)"}`,
    );
    const conflictEntry =
      outcome.kind === "conflict"
        ? outcome.perFile.find((f) => f.path === "conflict.ts")
        : undefined;
    assert.ok(
      conflictEntry !== undefined,
      "perFile must have an entry for conflict.ts",
    );
    assert.ok(
      conflictEntry.hunks.includes("<<<<<<<"),
      "hunks must contain <<<<<<< conflict marker",
    );
    assert.ok(
      conflictEntry.hunks.includes(">>>>>>>"),
      "hunks must contain >>>>>>> conflict marker",
    );

    assert.equal(
      afterBranch,
      beforeBranch,
      "main ref must be unchanged after conflict preview",
    );
    assert.equal(
      afterHead,
      beforeHead,
      "HEAD must be unchanged after conflict preview",
    );
    assert.equal(
      afterStatus,
      beforeStatus,
      "worktree/index status must be unchanged after conflict preview",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("Story 05 T2 (d) stale baseSHA (target moved) merges without losing target commits (CAS, no silent overwrite)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-t2d-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHomeBranch(homeDir, "trunk");
    await execFileProm("git", ["checkout", "-q", "-b", "main"], {
      cwd: homeDir,
    });
    // target (trunk) moves forward AFTER the candidate was minted → baseSHA is now stale
    await execFileProm("git", ["checkout", "-q", "trunk"], { cwd: homeDir });
    const extraSha = await homeCommit(homeDir, "extra.ts", "const e = 9;");
    await execFileProm("git", ["checkout", "-q", "main"], { cwd: homeDir });

    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidateTargeted(
      "cand-t2d",
      "repo-t2d",
      baseSHA,
      candidateSHA,
      "trunk",
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    const result = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.ok(
      result.outcome.kind === "merge" || result.outcome.kind === "fast-forward",
      `stale-base land must complete (merge/ff); got '${result.outcome.kind}'`,
    );
    // No target commit may be silently overwritten: the extra commit that moved trunk must survive.
    const extraPreserved = await execFileProm(
      "git",
      ["merge-base", "--is-ancestor", extraSha, "trunk"],
      { cwd: homeDir },
    )
      .then(() => true)
      .catch(() => false);
    assert.ok(
      extraPreserved,
      "the commit that moved trunk must remain reachable after landing (no silent overwrite)",
    );
    const candidatePreserved = await execFileProm(
      "git",
      ["merge-base", "--is-ancestor", candidateSHA, "trunk"],
      { cwd: homeDir },
    )
      .then(() => true)
      .catch(() => false);
    assert.ok(
      candidatePreserved,
      "candidateSHA must be reachable from trunk after landing",
    );
    const parents = (
      await git(homeDir, "rev-list", "--parents", "-n", "1", "trunk")
    ).split(" ").length;
    assert.equal(
      parents,
      3,
      "trunk must be a merge commit combining both lineages",
    );
    const mainHead = await git(homeDir, "rev-parse", "main");
    assert.equal(
      mainHead,
      baseSHA,
      "checked-out branch main must remain untouched",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 07 T1 — preview detects conflict without mutating refs/HEAD/status.
// The old `land()` aborted + persisted state/integration rows; the object path
// separates read-only conflict detection (preview) from landing (landPreviewed).
// This test verifies that preview correctly identifies the conflict and leaves
// the target ref, HEAD, and working tree unchanged.
// ---------------------------------------------------------------------------
test("Story 07 T1 conflict: preview detects conflict; target HEAD, refs, status unchanged", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s7t1-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    // home: initial commit with conflict.ts on main
    await mkdir(homeDir, { recursive: true });
    await execFileProm("git", ["init", "-q", "-b", "main"], { cwd: homeDir });
    await execFileProm("git", ["config", "user.email", "test@localhost"], {
      cwd: homeDir,
    });
    await execFileProm("git", ["config", "user.name", "Test"], {
      cwd: homeDir,
    });
    await writeFile(join(homeDir, "conflict.ts"), "const x = 'base';\n");
    await execFileProm("git", ["add", "conflict.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "init with conflict.ts"], {
      cwd: homeDir,
    });
    const baseSHA = await git(homeDir, "rev-parse", "HEAD");

    // ws: clone, conflicting change
    await cloneWs(homeDir, wsDir);
    await writeFile(join(wsDir, "conflict.ts"), "const x = 'ws-version';\n");
    await execFileProm("git", ["add", "conflict.ts"], { cwd: wsDir });
    await execFileProm("git", ["commit", "-q", "-m", "ws change"], {
      cwd: wsDir,
    });
    const candidateSHA = await git(wsDir, "rev-parse", "HEAD");

    // home: also modify conflict.ts differently (diverge + conflict)
    await writeFile(
      join(homeDir, "conflict.ts"),
      "const x = 'home-version';\n",
    );
    await execFileProm("git", ["add", "conflict.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "home diverge"], {
      cwd: homeDir,
    });

    // Capture state before preview
    const targetHeadBefore = await git(homeDir, "rev-parse", "main");
    const headRefBefore = await git(homeDir, "rev-parse", "HEAD");
    const { stdout: statusBefore } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s7t1",
      "repo-s7t1",
      baseSHA,
      candidateSHA,
      "task-1",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, cand.target);
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);

    // preview must detect conflict
    assert.equal(
      previewOutcome.kind,
      "conflict",
      "conflicting changes must return conflict preview outcome",
    );
    assert.ok(
      previewOutcome.kind === "conflict" &&
        previewOutcome.files.includes("conflict.ts"),
      `conflict files must include 'conflict.ts'; got ${previewOutcome.kind === "conflict" ? JSON.stringify(previewOutcome.files) : "(wrong kind)"}`,
    );

    // target HEAD unchanged (preview is read-only)
    const targetHeadAfter = await git(homeDir, "rev-parse", "main");
    assert.equal(
      targetHeadAfter,
      targetHeadBefore,
      "home target HEAD must be unchanged after conflict preview (read-only)",
    );

    // HEAD unchanged
    const headRefAfter = await git(homeDir, "rev-parse", "HEAD");
    assert.equal(
      headRefAfter,
      headRefBefore,
      "HEAD must be unchanged after conflict preview",
    );

    // status unchanged (no side-effect on working tree/index)
    const { stdout: statusAfter } = await execFileProm(
      "git",
      ["status", "--porcelain"],
      { cwd: homeDir },
    );
    assert.equal(
      statusAfter.trim(),
      statusBefore.trim(),
      "git status must be unchanged after conflict preview",
    );

    // No candidate or integration rows written by preview (pure read)
    assert.equal(
      fakeRepo.getCandidate("cand-s7t1"),
      undefined,
      "preview must not write candidate state rows (pure read-only)",
    );
    assert.equal(
      fakeRepo.getIntegration("cand-s7t1"),
      undefined,
      "preview must not write integration rows (pure read-only)",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// EPIC 007.4 S1 — GitRepositoryLanding end-to-end with relative root
//
// (g) The old `land()` had an invariant check for relative workspace paths.
//     The object path (preview) does not — it passes the path to git fetch
//     directly. This test verifies the behavior change: preview with a relative
//     workspace and unreachable SHA does NOT throw LandingInvariantError.
// (h) real land: LocalWorkspaceManager with relative root in non-trivial cwd
//     succeeds (ff) via the object path.
// ---------------------------------------------------------------------------

test("(g) S1-F1: preview with relative workspace does not throw LandingInvariantError (old land() invariant removed)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s1g-"));
  try {
    const homeDir = join(tmp, "home");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);

    const cand: LandingCandidate = {
      id: "cand-s1-inv",
      taskId: "task-s1-inv",
      repoId: "repo-s1-inv",
      baseSHA,
      candidateSHA: "0000000000000000000000000000000000000000",
      ref: "kanthord/task-s1-inv",
      target: "main",
      workspace: "relative/path/to/workspace",
    };

    // preview does not have the old land() invariant check — it will throw a
    // generic git/spawn error (the relative fetch path doesn't exist), NOT
    // a LandingInvariantError.
    try {
      await landing.preview(homeDir, cand, baseSHA);
    } catch (err) {
      assert.notEqual(
        (err as Error).name,
        "LandingInvariantError",
        "preview must NOT throw LandingInvariantError (the invariant check was removed with land())",
      );
      return; // expected — git fetch with bogus relative path fails
    }
    // If no error, the test still passes — the important thing is no LandingInvariantError
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(h) S1-F1: real land — LocalWorkspaceManager with relative root produces absolute workspace and lands (ff)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s1h-"));
  try {
    const remoteDir = join(tmp, "remote");
    const mirrorDir = join(tmp, "mirror");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    // Initialise the "remote" git repo (plays the role of the origin)
    const baseSHA = await initHome(remoteDir);

    // Build a relative root from process.cwd() into a subdir of tmp —
    // same default-install scenario as the local.test.ts S1 test.
    const absoluteWsRoot = join(tmp, "workspaces");
    const relativeWsRoot = relative(process.cwd(), absoluteWsRoot);
    assert.ok(
      !isAbsolute(relativeWsRoot),
      `precondition: relativeWsRoot must be relative; got: "${relativeWsRoot}"`,
    );

    const mgr = new LocalWorkspaceManager({ root: relativeWsRoot });

    // repo.path is the mirror dir (absolute), remoteUrl is file:// on the remote
    const repo = {
      id: "repo-s1h",
      type: "repository" as const,
      name: "test",
      remoteUrl: `file://${remoteDir}`,
      branch: "main",
      path: mirrorDir,
      auth: { kind: "ambient" as const },
    };

    // prepare(): clones remoteDir → mirrorDir, then mirrorDir → workspace
    const ws = await mgr.prepare("task-s1h", repo);

    // ws.dir must be absolute (S1 fix in LocalWorkspaceManager)
    assert.ok(
      isAbsolute(ws.dir),
      `ws.dir must be absolute after S1 fix; got: "${ws.dir}"`,
    );

    // Commit a file in the workspace so there is something to land
    await writeFile(join(ws.dir, "output.ts"), "export const v = 1;");
    await execFileProm("git", ["add", "output.ts"], { cwd: ws.dir });
    await execFileProm(
      "git",
      [
        "-c",
        "user.email=t@t.t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "task output",
      ],
      { cwd: ws.dir },
    );
    const candidateSHA = await git(ws.dir, "rev-parse", "HEAD");

    // Land: candidate.workspace is ws.dir (absolute after S1 fix)
    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand: LandingCandidate = {
      id: "cand-s1h",
      taskId: "task-s1h",
      repoId: "repo-s1h",
      baseSHA,
      candidateSHA,
      ref: "kanthord/task-s1h",
      target: "main",
      workspace: ws.dir, // absolute after S1 fix → git fetch succeeds
    };

    const targetOID = await landing.resolveTargetOID(mirrorDir, cand.target);
    const previewOutcome = await landing.preview(mirrorDir, cand, targetOID);
    const result = await landing.landPreviewed(
      mirrorDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      result.outcome.kind,
      "fast-forward",
      "land must fast-forward when workspace path is absolute (S1-F1 end-to-end)",
    );
    assert.equal(
      result.canonicalSHA,
      candidateSHA,
      "canonicalSHA must equal candidateSHA after ff",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S4 (007.6) — landPreviewed: land the previewed tree via atomic CAS
// ---------------------------------------------------------------------------

test("(S4-git-mergeable-tree-matches-preview) landPreviewed mergeable: committed tree equals previewed treeOID; parents are {targetOID, candidateOID}", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s4m-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // Candidate adds file_a.ts (disjoint from target's change)
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    // Target (home) diverges on file_b.ts
    await writeFile(join(homeDir, "file_b.ts"), "const b = 2;");
    await execFileProm("git", ["add", "file_b.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "home diverge"], {
      cwd: homeDir,
    });
    const targetOID = await git(homeDir, "rev-parse", "main");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s4m",
      "repo-s4m",
      baseSHA,
      candidateSHA,
      "task-s4m",
      wsDir,
    );

    // First preview to get the merged treeOID
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "mergeable",
      "setup: preview must return mergeable",
    );
    assert.ok(previewOutcome.kind === "mergeable");

    // Land the previewed tree
    const landResult = await (
      landing as unknown as {
        landPreviewed(
          homeDir: string,
          candidate: LandingCandidate,
          outcome: PreviewOutcome,
          targetOID: string,
        ): Promise<{ canonicalSHA: string }>;
      }
    ).landPreviewed(homeDir, cand, previewOutcome, targetOID);

    const canonicalSHA = landResult.canonicalSHA;

    // Branch must have advanced
    const newBranchOID = await git(homeDir, "rev-parse", "main");
    assert.equal(
      newBranchOID,
      canonicalSHA,
      "main must point to the new merge commit after landPreviewed",
    );

    // The committed tree must equal the previewed treeOID (land-the-tree, not re-merge)
    const committedTree = await git(
      homeDir,
      "rev-parse",
      `${canonicalSHA}^{tree}`,
    );
    assert.equal(
      committedTree,
      previewOutcome.treeOID,
      "landed commit tree must equal the previewed treeOID (construction guarantee)",
    );

    // Parents must include both targetOID and candidateSHA
    const parentLine = await git(
      homeDir,
      "rev-list",
      "--parents",
      "-n",
      "1",
      canonicalSHA,
    );
    const parents = parentLine.split(" ").slice(1);
    assert.ok(
      parents.includes(targetOID),
      `targetOID (${targetOID}) must be a parent of the merge commit; parents: ${JSON.stringify(parents)}`,
    );
    assert.ok(
      parents.includes(candidateSHA),
      `candidateSHA (${candidateSHA}) must be a parent of the merge commit; parents: ${JSON.stringify(parents)}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(S4-git-ff-advances-branch) landPreviewed fast-forward: branch advances to candidateOID atomically", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s4ff-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // Candidate is a direct descendant → fast-forward scenario
    const candidateSHA = await wsCommit(wsDir, "new.ts", "const x = 1;");
    const targetOID = baseSHA; // home is at baseSHA, candidate is ahead

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s4ff",
      "repo-s4ff",
      baseSHA,
      candidateSHA,
      "task-s4ff",
      wsDir,
    );

    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "fast-forward",
      "setup: preview must return fast-forward",
    );
    assert.ok(previewOutcome.kind === "fast-forward");

    const landResult = await (
      landing as unknown as {
        landPreviewed(
          homeDir: string,
          candidate: LandingCandidate,
          outcome: PreviewOutcome,
          targetOID: string,
        ): Promise<{ canonicalSHA: string }>;
      }
    ).landPreviewed(homeDir, cand, previewOutcome, targetOID);

    // Branch must equal candidateSHA
    const newBranchOID = await git(homeDir, "rev-parse", "main");
    assert.equal(
      newBranchOID,
      candidateSHA,
      "main must advance to candidateSHA after ff landPreviewed",
    );
    assert.equal(
      landResult.canonicalSHA,
      candidateSHA,
      "canonicalSHA from landPreviewed must equal candidateSHA",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(S4-git-stale-cas-fails-branch-untouched) landPreviewed stale expectedOld: throws with newTargetOID; branch stays at current position", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s4cas-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // Candidate adds file_a.ts (disjoint from target's change → mergeable)
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    // Target diverges on file_b.ts
    await writeFile(join(homeDir, "file_b.ts"), "const b = 2;");
    await execFileProm("git", ["add", "file_b.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "home diverge"], {
      cwd: homeDir,
    });
    const targetOID = await git(homeDir, "rev-parse", "main");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-s4cas",
      "repo-s4cas",
      baseSHA,
      candidateSHA,
      "task-s4cas",
      wsDir,
    );

    // Preview against the current targetOID
    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "mergeable",
      "setup: preview must return mergeable",
    );
    assert.ok(previewOutcome.kind === "mergeable");

    // Externally advance the branch (simulate concurrent push) — stale CAS
    await writeFile(join(homeDir, "file_c.ts"), "const c = 3;");
    await execFileProm("git", ["add", "file_c.ts"], { cwd: homeDir });
    await execFileProm("git", ["commit", "-q", "-m", "concurrent push"], {
      cwd: homeDir,
    });
    const advancedOID = await git(homeDir, "rev-parse", "main");
    assert.notEqual(
      advancedOID,
      targetOID,
      "setup: branch must have moved past targetOID",
    );

    // landPreviewed with stale expectedOld must throw
    let threw = false;
    let thrownErr: unknown;
    try {
      await (
        landing as unknown as {
          landPreviewed(
            homeDir: string,
            candidate: LandingCandidate,
            outcome: PreviewOutcome,
            targetOID: string,
          ): Promise<unknown>;
        }
      ).landPreviewed(homeDir, cand, previewOutcome, targetOID);
    } catch (err) {
      threw = true;
      thrownErr = err;
    }

    assert.ok(
      threw,
      "landPreviewed with stale expectedOld must throw (CAS mismatch)",
    );
    assert.ok(
      thrownErr !== null &&
        typeof thrownErr === "object" &&
        "newTargetOID" in (thrownErr as object),
      `thrown error must carry newTargetOID property; got: ${JSON.stringify(thrownErr)}`,
    );

    // Branch must remain at the externally-advanced position, NOT at candidateSHA
    const finalOID = await git(homeDir, "rev-parse", "main");
    assert.equal(
      finalOID,
      advancedOID,
      "after stale-CAS failure, branch must remain at the concurrently-advanced OID (not mutated)",
    );
    assert.notEqual(
      finalOID,
      candidateSHA,
      "after stale-CAS failure, branch must NOT be at candidateSHA (never landed on wrong base)",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B2 regression — preview() with empty workspace and ODB-reachable candidateSHA
//
// GetConflict builds a LandingCandidate with workspace:"" (the workspace path
// is not stored on the candidate row).  preview() currently runs
//   git fetch "" <sha>
// unconditionally, which fails.  When candidateSHA is already reachable in
// homeDir's object DB (it was fetched during the original land() attempt),
// preview() must classify without throwing — the fetch must be guarded.
// ---------------------------------------------------------------------------
test("(B2-preview-empty-workspace) preview with empty workspace and candidateSHA already reachable in ODB: classifies (fast-forward) without throwing", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-b2-"));
  try {
    const homeDir = join(tmp, "home");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // Make a candidate commit in wsDir (fast-forward: candidateSHA directly ahead of baseSHA)
    const candidateSHA = await wsCommit(
      wsDir,
      "feature.ts",
      "export const x = 1;",
    );

    // Pre-fetch the candidateSHA into homeDir's ODB — this mirrors what land() does;
    // GetConflict calls preview() after land() already fetched the object but
    // stored workspace:"" on the candidate row.
    await execFileProm("git", ["fetch", wsDir, candidateSHA], { cwd: homeDir });

    // Verify the object is reachable (setup guard)
    const { stdout: objType } = await execFileProm(
      "git",
      ["cat-file", "-t", candidateSHA],
      { cwd: homeDir },
    );
    assert.equal(
      objType.trim(),
      "commit",
      "setup: candidateSHA must be reachable in homeDir before calling preview with empty workspace",
    );

    const targetOID = baseSHA; // baseSHA is an ancestor of candidateSHA → fast-forward

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);

    // workspace is intentionally "" — the GetConflict scenario (no workspace stored)
    const cand = makeCandidate(
      "cand-b2",
      "repo-b2",
      baseSHA,
      candidateSHA,
      "task-b2",
      "", // empty workspace — triggers `git fetch "" <sha>` in the current code
    );

    // Must NOT throw; must classify correctly even though workspace is "".
    const outcome = await landing.preview(homeDir, cand, targetOID);

    assert.equal(
      outcome.kind,
      "fast-forward",
      `preview with empty workspace + reachable candidateSHA must return fast-forward; got: ${outcome.kind}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B1 (EPIC 007.6) — buildConflictContext tripwire stub
// ---------------------------------------------------------------------------

test("(B1-build-conflict-context-stub) buildConflictContext throws 'not implemented' — EPIC 007.6 B1", () => {
  assert.throws(
    () => buildConflictContext([]),
    (err: unknown) =>
      err instanceof Error && err.message.includes("not implemented"),
    "buildConflictContext must throw with message containing 'not implemented'",
  );
});

// ---------------------------------------------------------------------------
// Story C — bare home landing via object path (update-ref)
//
// Characterization tests: the object path (preview + landPreviewed) already
// works on bare repos because it uses update-ref / merge-tree (no checkout).
// These tests pin the already-shipped behavior and demonstrate that the
// infrastructure is ready for the CLI reroute in Story C.
// ---------------------------------------------------------------------------

/** Initialises a BARE git repo on `branch`, makes an empty initial commit, returns baseSHA. */
async function initBareHome(dir: string, branch = "main"): Promise<string> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await execFileProm("git", ["init", "--bare", "-q", "-b", branch, dir]);
  // Clone, commit, push to create the initial commit in the bare repo
  const cloneDir = dir + "_seed";
  await rm(cloneDir, { recursive: true, force: true });
  await execFileProm("git", ["clone", "-q", dir, cloneDir]);
  await execFileProm("git", ["config", "user.email", "test@localhost"], {
    cwd: cloneDir,
  });
  await execFileProm("git", ["config", "user.name", "Test"], { cwd: cloneDir });
  await execFileProm("git", ["commit", "--allow-empty", "-q", "-m", "init"], {
    cwd: cloneDir,
  });
  const sha = await git(cloneDir, "rev-parse", "HEAD");
  await execFileProm("git", ["push", "-q", "origin", `HEAD:${branch}`], {
    cwd: cloneDir,
  });
  await rm(cloneDir, { recursive: true, force: true });
  return sha;
}

/** Advances a bare repo by making a commit via a temp clone. Returns new HEAD SHA. */
async function advanceBareHome(
  bareDir: string,
  filename: string,
  content: string,
  branch = "main",
): Promise<string> {
  const tmpDir = bareDir + "_adv";
  await rm(tmpDir, { recursive: true, force: true });
  await execFileProm("git", ["clone", "-q", bareDir, tmpDir]);
  await execFileProm("git", ["config", "user.email", "test@localhost"], {
    cwd: tmpDir,
  });
  await execFileProm("git", ["config", "user.name", "Test"], { cwd: tmpDir });
  await writeFile(join(tmpDir, filename), content);
  await execFileProm("git", ["add", filename], { cwd: tmpDir });
  await execFileProm("git", ["commit", "-q", "-m", `home ${filename}`], {
    cwd: tmpDir,
  });
  const sha = await git(tmpDir, "rev-parse", "HEAD");
  await execFileProm("git", ["push", "-q", "origin", `HEAD:${branch}`], {
    cwd: tmpDir,
  });
  await rm(tmpDir, { recursive: true, force: true });
  return sha;
}

test("(C-bare-ff) landPreviewed fast-forward on a bare home: branch advances to candidateOID via update-ref", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-cbareff-"));
  try {
    const homeDir = join(tmp, "home.git");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initBareHome(homeDir);
    await cloneWs(homeDir, wsDir);
    const candidateSHA = await wsCommit(
      wsDir,
      "answer.ts",
      "export const x = 1;",
    );

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-cbareff",
      "repo-cbareff",
      baseSHA,
      candidateSHA,
      "task-cbareff",
      wsDir,
    );

    // Object path: resolveTargetOID → preview → landPreviewed
    const targetOID = await landing.resolveTargetOID(homeDir, "main");
    assert.equal(
      targetOID,
      baseSHA,
      "bare home main must be at baseSHA before landing",
    );

    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "fast-forward",
      "candidate is direct descendant → fast-forward",
    );
    assert.ok(previewOutcome.kind === "fast-forward");

    const landResult = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(landResult.outcome.kind, "fast-forward");
    const newHead = await git(homeDir, "rev-parse", "main");
    assert.equal(
      newHead,
      candidateSHA,
      "bare home main must advance to candidateSHA via update-ref",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(C-bare-merge) landPreviewed mergeable on a bare home: merge commit combines target and candidate parents", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-cbaremerge-"));
  try {
    const homeDir = join(tmp, "home.git");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initBareHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // Workspace adds file_a.ts (diverging from home)
    const candidateSHA = await wsCommit(wsDir, "file_a.ts", "const a = 1;");

    // Home independently advances (disjoint change)
    const homeOID = await advanceBareHome(homeDir, "file_b.ts", "const b = 2;");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-cbaremerge",
      "repo-cbaremerge",
      baseSHA,
      candidateSHA,
      "task-cbaremerge",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, "main");
    assert.equal(
      targetOID,
      homeOID,
      "bare home must have advanced before merge",
    );

    const previewOutcome = await landing.preview(homeDir, cand, targetOID);
    assert.equal(
      previewOutcome.kind,
      "mergeable",
      "disjoint changes must be mergeable",
    );
    assert.ok(previewOutcome.kind === "mergeable");

    const landResult = await landing.landPreviewed(
      homeDir,
      cand,
      previewOutcome,
      targetOID,
    );

    assert.equal(
      landResult.outcome.kind,
      "merge",
      "diverged landing on bare home must produce merge",
    );

    // Verify merge commit has both parents
    const mergeCommit = landResult.canonicalSHA;
    const parentLine = await git(
      homeDir,
      "rev-list",
      "--parents",
      "-n",
      "1",
      mergeCommit,
    );
    const parents = parentLine.split(" ").slice(1);
    assert.ok(
      parents.includes(targetOID),
      `targetOID must be a parent; parents: ${JSON.stringify(parents)}`,
    );
    assert.ok(
      parents.includes(candidateSHA),
      `candidateSHA must be a parent; parents: ${JSON.stringify(parents)}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("(C-bare-conflict) preview on a bare home: conflicting changes return conflict outcome with files", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-cbarecon-"));
  try {
    const homeDir = join(tmp, "home.git");
    const wsDir = join(tmp, "ws");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initBareHome(homeDir);
    await cloneWs(homeDir, wsDir);

    // Workspace modifies conflict.ts
    const candidateSHA = await wsCommit(
      wsDir,
      "conflict.ts",
      "const x = 'ws';",
    );

    // Home independently modifies the same file (conflict)
    await advanceBareHome(homeDir, "conflict.ts", "const x = 'home';");

    const fakeRepo = new FakeLandingRepository();
    const landing = new GitRepositoryLanding(lockDir, fakeRepo, GIT_CONFIG);
    const cand = makeCandidate(
      "cand-cbarecon",
      "repo-cbarecon",
      baseSHA,
      candidateSHA,
      "task-cbarecon",
      wsDir,
    );

    const targetOID = await landing.resolveTargetOID(homeDir, "main");

    const previewOutcome = await landing.preview(homeDir, cand, targetOID);

    assert.equal(
      previewOutcome.kind,
      "conflict",
      "conflicting changes must return conflict outcome on bare home",
    );
    assert.ok(
      previewOutcome.kind === "conflict" &&
        previewOutcome.files.includes("conflict.ts"),
      `conflict files must include 'conflict.ts'; got ${previewOutcome.kind === "conflict" ? JSON.stringify(previewOutcome.files) : "(wrong kind)"}`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
