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
import { GitRepositoryLanding } from "./git.ts";
import { LandingConflictError } from "./port.ts";
import type { LandingCandidate } from "./port.ts";
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

    const result = await landing.land(homeDir, cand);

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

    const result = await landing.land(homeDir, cand);

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
// (c) Typed conflict — LandingConflictError with conflict files
// ---------------------------------------------------------------------------
test("(c) conflict: conflicting changes produce LandingConflictError with conflict file listed", async () => {
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

    let caught: LandingConflictError | undefined;
    try {
      await landing.land(homeDir, cand);
      assert.fail("land must throw LandingConflictError for a conflict");
    } catch (err) {
      assert.ok(
        err instanceof LandingConflictError,
        `expected LandingConflictError, got: ${String(err)}`,
      );
      caught = err;
    }
    assert.ok(caught !== undefined);
    assert.ok(
      caught.conflictFiles.includes("conflict.ts"),
      `conflictFiles must include 'conflict.ts'; got: [${caught.conflictFiles.join(", ")}]`,
    );
    assert.equal(
      caught.candidate.id,
      "cand-c",
      "error must carry the candidate that conflicted",
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

    const result = await landing.land(homeDir, cand);

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

    // First land succeeds (ff)
    await landing.land(homeDir, cand);
    const headAfterFirst = await git(homeDir, "rev-parse", "main");

    // Second land: same candidate — candidateSHA is now reachable from main
    const fakeRepo2 = new FakeLandingRepository();
    const landing2 = new GitRepositoryLanding(lockDir, fakeRepo2, GIT_CONFIG);
    const result2 = await landing2.land(homeDir, cand);

    assert.equal(
      result2.outcome.kind,
      "already-landed",
      "re-landing same candidateSHA must return already-landed",
    );
    const headAfterSecond = await git(homeDir, "rev-parse", "main");
    assert.equal(
      headAfterSecond,
      headAfterFirst,
      "home main HEAD must not change for already-landed outcome",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (f) Lock contention: two concurrent land calls run sequentially, no stale lock
// ---------------------------------------------------------------------------
test("(f) lock-contention: two concurrent land calls run sequentially, no stale lock file after", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-f-"));
  try {
    const homeDir = join(tmp, "home");
    const ws1Dir = join(tmp, "ws1");
    const ws2Dir = join(tmp, "ws2");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    const baseSHA = await initHome(homeDir);
    // Both workspaces clone from the same home (same base)
    await cloneWs(homeDir, ws1Dir);
    await cloneWs(homeDir, ws2Dir);

    // ws1: adds file_a.ts (non-conflicting)
    const sha1 = await wsCommit(ws1Dir, "file_a.ts", "const a = 1;");
    // ws2: adds file_b.ts (non-conflicting)
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

    // Both instances share the SAME lockDir → they contend on the same lock file
    const fakeRepo1 = new FakeLandingRepository();
    const fakeRepo2 = new FakeLandingRepository();
    const lander1 = new GitRepositoryLanding(lockDir, fakeRepo1, GIT_CONFIG);
    const lander2 = new GitRepositoryLanding(lockDir, fakeRepo2, GIT_CONFIG);

    // Concurrent: one acquires the lock immediately; the other retries under backoff
    const [result1, result2] = await Promise.all([
      lander1.land(homeDir, cand1),
      lander2.land(homeDir, cand2),
    ]);

    const VALID_OUTCOMES = new Set(["fast-forward", "merge"]);
    assert.ok(
      VALID_OUTCOMES.has(result1.outcome.kind),
      `result1 outcome must be ff or merge; got '${result1.outcome.kind}'`,
    );
    assert.ok(
      VALID_OUTCOMES.has(result2.outcome.kind),
      `result2 outcome must be ff or merge; got '${result2.outcome.kind}'`,
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

    const result = await landing.land(homeDir, cand);

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

    const result = await landing.land(homeDir, cand);

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

    await landing.land(homeDir, cand);

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

    const result = await landing.land(homeDir, cand);

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
// Story 07 T1 — adapter: abort + persist the conflict integration row.
// Faithful to the locked behavior in 07-f3-conflict-lifecycle.md:
//   on conflict, `land` must (1) abort the merge leaving the target HEAD
//   UNCHANGED, (2) persist candidate.state = "conflict", (3) persist an
//   integration row { outcome:"conflict", canonicalSHA:<unchanged target HEAD>,
//   conflictFiles }, and (4) throw LandingConflictError with the same files.
// NOTE: the conflict path shipped in 007.1 already does (1)(2)(4) and writes a
// conflict integration row — but it records canonicalSHA = candidateSHA (the
// candidate's commit), NOT the unchanged target HEAD the lock requires. That is
// the genuine failing seam this test pins; the other three assertions guard
// the already-shipped behavior from regressing.
// ---------------------------------------------------------------------------
test("Story 07 T1 conflict: adapter aborts merge, persists conflict candidate state + integration row with canonicalSHA = unchanged target HEAD", async () => {
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

    // (a) capture target HEAD before land
    const targetHeadBefore = await git(homeDir, "rev-parse", "main");

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

    let caught: LandingConflictError | undefined;
    try {
      await landing.land(homeDir, cand);
      assert.fail("land must throw LandingConflictError for a conflict");
    } catch (err) {
      assert.ok(
        err instanceof LandingConflictError,
        `expected LandingConflictError, got: ${String(err)}`,
      );
      caught = err;
    }

    // (a) home target HEAD unchanged (merge aborted, no half-merge)
    const targetHeadAfter = await git(homeDir, "rev-parse", "main");
    assert.equal(
      targetHeadAfter,
      targetHeadBefore,
      "home target HEAD must be unchanged after a conflict (merge aborted, no half-merge)",
    );

    // (b) candidate state persisted as conflict
    const saved = fakeRepo.getCandidate("cand-s7t1");
    assert.ok(saved !== undefined, "candidate row must exist after conflict");
    assert.equal(
      saved.state,
      "conflict",
      "candidate.state must be 'conflict' after a conflict",
    );

    // (c) integration row exists: outcome conflict + conflictFiles + canonicalSHA = unchanged target HEAD
    const integ = fakeRepo.getIntegration("cand-s7t1");
    assert.ok(integ !== undefined, "integration row must exist after conflict");
    assert.equal(
      integ.outcome,
      "conflict",
      "integration.outcome must be 'conflict'",
    );
    assert.ok(
      integ.conflictFiles !== undefined &&
        integ.conflictFiles.includes("conflict.ts"),
      `conflictFiles must include 'conflict.ts'; got: ${JSON.stringify(integ.conflictFiles)}`,
    );
    assert.equal(
      integ.canonicalSHA,
      targetHeadBefore,
      "integration.canonicalSHA must be the UNCHANGED target HEAD (the lock requires this, not the candidate SHA)",
    );

    // (d) the thrown error carries the same conflict files
    assert.ok(caught !== undefined, "LandingConflictError must be thrown");
    assert.ok(
      caught.conflictFiles.includes("conflict.ts"),
      "LandingConflictError.conflictFiles must include 'conflict.ts'",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// EPIC 007.4 S1 — GitRepositoryLanding invariant + end-to-end with relative root
//
// (g) relative candidate.workspace → LandingInvariantError (typed, before git fetch)
// (h) real land: LocalWorkspaceManager with relative root in non-trivial cwd succeeds (ff)
//
// RED today for (g): current code runs `git fetch <relative-path> <sha>` and
// throws an ExecFile error (git subprocess failure), NOT a LandingInvariantError.
// RED today for (h): prepare() produces a relative ws.dir → git fetch fails.
// ---------------------------------------------------------------------------

test("(g) S1-F1: relative candidate.workspace throws LandingInvariantError before any git fetch", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "kanthord-land-s1g-"));
  try {
    const homeDir = join(tmp, "home");
    const lockDir = join(tmp, "locks");
    await mkdir(lockDir, { recursive: true });

    // homeDir must be a valid git repo so we can acquire the lock; the fetch
    // must be blocked BEFORE any subprocess call by the invariant check.
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
      workspace: "relative/path/to/workspace", // RELATIVE — triggers the invariant
    };

    await assert.rejects(
      () => landing.land(homeDir, cand),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must throw an Error subclass");
        assert.equal(
          (err as Error).name,
          "LandingInvariantError",
          `expected LandingInvariantError; got ${(err as Error).name}: ${(err as Error).message}`,
        );
        return true;
      },
    );
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

    const result = await landing.land(mirrorDir, cand);

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
