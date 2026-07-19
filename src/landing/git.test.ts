/**
 * Story 11 T4 — GitRepositoryLanding adapter + SqliteLandingRepository
 *
 * All git-facing tests use real git in temp dirs (file:// remotes, no network).
 * Each test is hermetic: creates its own mkdtemp dir and removes it in finally.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { GitRepositoryLanding } from "./git.ts";
import { LandingConflictError } from "./port.ts";
import type { LandingCandidate } from "./port.ts";
import { SqliteLandingRepository } from "../storage/sqlite/landing.ts";
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
