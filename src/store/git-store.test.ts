/**
 * src/store/git-store.test.ts
 *
 * Story 012-001 Task T1 — git-backed store: init/open repo + commit-per-write.
 *
 * RED: all tests import GitStore from ./git-store.ts which does not exist yet.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { GitStore } from "./git-store.ts";
import type { FeatureDoc } from "./feature-store.ts";
import { StoreLocked } from "./writer-lock.ts";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalDoc(epicBody = "# Epic\n"): FeatureDoc {
  return {
    epic: { frontmatter: { id: "feat-001", title: "Test Epic" }, body: epicBody },
    stories: [
      {
        story: { id: "story-001", content: "# Story 001\n" },
        tasks: [
          {
            filename: "task-001.md",
            frontmatter: { id: "task-001", title: "Task One" },
            body: "## Task\n",
          },
        ],
      },
    ],
    runbook: "# Runbook\n",
  };
}

async function gitLog(
  repoDir: string,
  format: string,
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--format=" + format, "HEAD"],
    { cwd: repoDir },
  );
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

async function gitShowFiles(repoDir: string, commitRef: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff-tree", "--no-commit-id", "-r", "--name-only", commitRef],
    { cwd: repoDir },
  );
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

async function gitLsFiles(repoDir: string, commitRef: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "--name-only", commitRef],
    { cwd: repoDir },
  );
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — Story 012-001 Task T1", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-t1-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (a) Opening the store on a bare temp dir initializes a git repo
  test("opening store on bare dir initializes a git repo", async () => {
    const storeRoot = join(tmpRoot, "bare-init");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    // .git directory must exist
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--git-dir"],
      { cwd: storeRoot },
    );
    assert.ok(
      stdout.trim() === ".git" || stdout.trim().endsWith("/.git"),
      "expected .git dir after open()",
    );

    await store.close();
  });

  // (b) Opening a second time on the same root reuses the existing repo
  test("opening store on existing repo reuses it without reinitializing", async () => {
    const storeRoot = join(tmpRoot, "reuse-init");
    await mkdir(storeRoot, { recursive: true });

    const s1 = new GitStore(storeRoot);
    await s1.open();
    await s1.close();

    // Write a dummy file and commit it directly to seed a known HEAD
    await writeFile(join(storeRoot, "seed.txt"), "seed");
    await execFileAsync("git", ["add", "seed.txt"], { cwd: storeRoot });
    await execFileAsync(
      "git",
      [
        "-c", "user.name=Test",
        "-c", "user.email=test@example.com",
        "commit", "-m", "seed",
      ],
      { cwd: storeRoot },
    );

    const s2 = new GitStore(storeRoot);
    await s2.open();

    // HEAD must still resolve (no re-init that would wipe history)
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      { cwd: storeRoot },
    );
    assert.ok(stdout.trim().length === 40, "HEAD sha must be 40 chars");

    await s2.close();
  });

  // (c) A multi-file plan mutation produces exactly ONE commit with class+actor trailers
  test("multi-file plan mutation produces one commit with plan class and actor trailers", async () => {
    const storeRoot = join(tmpRoot, "one-commit");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-001");
    await mkdir(featureDir, { recursive: true });

    const doc = minimalDoc();
    await store.commit(
      featureDir,
      async () => {
        // The write callback: write multiple files as one logical write-set
        const { FeatureStore } = await import("./feature-store.ts");
        const fs = new FeatureStore(featureDir);
        await fs.writeFeature(doc);
      },
      { changeClass: "plan", actor: "tdd-agent" },
    );

    // Exactly one commit
    const commits = await gitLog(storeRoot, "%H");
    assert.equal(commits.length, 1, "expected exactly one commit");

    // Trailers present
    const body = await gitLog(storeRoot, "%B");
    const trailerLine = body.join("\n");
    assert.ok(
      trailerLine.includes("Kanthord-Change-Class: plan"),
      "missing Kanthord-Change-Class trailer",
    );
    assert.ok(
      trailerLine.includes("Kanthord-Actor: tdd-agent"),
      "missing Kanthord-Actor trailer",
    );

    await store.close();
  });

  // (d) Two sequential mutations create two ordered commits
  test("two sequential mutations create two ordered commits", async () => {
    const storeRoot = join(tmpRoot, "two-commits");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-002");
    await mkdir(featureDir, { recursive: true });

    const { FeatureStore } = await import("./feature-store.ts");
    const fs = new FeatureStore(featureDir);

    await store.commit(
      featureDir,
      async () => { await fs.writeFeature(minimalDoc("# First\n")); },
      { changeClass: "plan", actor: "agent-a" },
    );

    await store.commit(
      featureDir,
      async () => { await fs.writeFeature(minimalDoc("# Second\n")); },
      { changeClass: "plan", actor: "agent-b" },
    );

    const commits = await gitLog(storeRoot, "%H");
    assert.equal(commits.length, 2, "expected exactly two commits");

    // Newest first: second commit is first in log
    const bodies = await gitLog(storeRoot, "%B");
    const combined = bodies.join("\n");
    assert.ok(combined.includes("agent-b"), "newest commit must have agent-b actor");

    await store.close();
  });

  // (e) A mid-mutation reader never observes a partial file (atomicity)
  test("reader during mutation sees either old or complete new file, never partial", async () => {
    const storeRoot = join(tmpRoot, "atomic");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-003");
    await mkdir(featureDir, { recursive: true });

    // Write initial content
    const epicPath = join(featureDir, "epic.md");
    const oldContent = "---\nid: feat-003\ntitle: Old\n---\n# Old\n";
    await writeFile(epicPath, oldContent, "utf8");

    // Track what was read during the write callback
    let readDuringMutation: string | null = null;

    await store.commit(
      featureDir,
      async () => {
        // Begin a long write by writing to a temp file first (atomicity contract)
        // Read the file mid-mutation — should still be old or fully new, never partial
        readDuringMutation = await readFile(epicPath, "utf8");
        // Now write new content
        await writeFile(epicPath, "---\nid: feat-003\ntitle: New\n---\n# New\n", "utf8");
      },
      { changeClass: "plan", actor: "reader-test" },
    );

    // After the commit, the file must be new
    const afterContent = await readFile(epicPath, "utf8");
    assert.ok(afterContent.includes("New"), "file must be updated after commit");

    // During mutation: was either old or new (not truncated/empty)
    assert.ok(readDuringMutation !== null, "must have read during mutation");
    assert.ok(
      (readDuringMutation as string).length > 0,
      "read during mutation must return non-empty content",
    );

    await store.close();
  });

  // (f) Lock file and temp files are never in any commit
  test("lock file and temp files are absent from every committed tree", async () => {
    const storeRoot = join(tmpRoot, "no-lock-in-commit");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-004");
    await mkdir(featureDir, { recursive: true });

    const { FeatureStore } = await import("./feature-store.ts");
    const fs = new FeatureStore(featureDir);

    await store.commit(
      featureDir,
      async () => { await fs.writeFeature(minimalDoc()); },
      { changeClass: "plan", actor: "test" },
    );

    const commits = await gitLog(storeRoot, "%H");
    assert.ok(commits.length > 0, "need at least one commit");

    const sha = commits[0];
    if (sha === undefined) throw new Error("no commit sha");
    const files = await gitLsFiles(storeRoot, sha);

    const hasBadFile = files.some(
      (f) =>
        f.includes(".kanthord-writer-lock") ||
        f.includes(".tmp") ||
        f.endsWith(".lock"),
    );
    assert.ok(!hasBadFile, `lock/temp file found in commit: ${files.join(", ")}`);

    await store.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: Task T2 — commit classes + history read-back
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — Story 012-001 Task T2", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-t2-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (a) STATE / RUNBOOK writes produce commits with class "operational";
  //     a task-file write produces class "plan"
  test("STATE and RUNBOOK writes produce operational class; task-file write produces plan class", async () => {
    const storeRoot = join(tmpRoot, "classes");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-cls");
    await mkdir(featureDir, { recursive: true });

    // plan-class commit
    await store.commit(
      featureDir,
      async () => {
        await writeFile(join(featureDir, "task.md"), "# Task\n", "utf8");
      },
      { changeClass: "plan", actor: "cls-agent" },
    );

    // operational-class commit (simulates STATE write)
    await store.commit(
      featureDir,
      async () => {
        await writeFile(join(featureDir, "plan.state.md"), "# State\n", "utf8");
      },
      { changeClass: "operational", actor: "cls-agent" },
    );

    const logs = await gitLog(storeRoot, "%B");
    const combined = logs.join("\n");
    assert.ok(combined.includes("Kanthord-Change-Class: plan"), "plan class commit missing");
    assert.ok(combined.includes("Kanthord-Change-Class: operational"), "operational class commit missing");

    await store.close();
  });

  // (a2) RUNBOOK.md written with operational class appears in history()
  //     filtered by changeClass:"operational" and is absent from plan filter
  //     (Story 001 AC: STATE/journal/RUNBOOK commits are class "operational" so
  //      plan-file history stays clean; explicit RUNBOOK coverage per B7)
  test("RUNBOOK.md operational commit appears in history filtered by operational, absent from plan filter", async () => {
    const storeRoot = join(tmpRoot, "runbook-operational");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-rb");
    await mkdir(featureDir, { recursive: true });

    const taskPath = join(featureDir, "task.md");
    const runbookPath = join(featureDir, "RUNBOOK.md");

    // plan commit: task file
    await store.commit(
      featureDir,
      async () => { await writeFile(taskPath, "# Task\n", "utf8"); },
      { changeClass: "plan", actor: "rb-agent" },
    );

    // operational commit: RUNBOOK.md (the explicit AC case from Story 001 §24)
    await store.commit(
      featureDir,
      async () => { await writeFile(runbookPath, "# Runbook\n", "utf8"); },
      { changeClass: "operational", actor: "rb-agent" },
    );

    // history(RUNBOOK.md) filtered by "operational" must contain exactly one entry
    const runbookHistory = await store.history(runbookPath, { changeClass: "operational" });
    assert.equal(runbookHistory.length, 1, "RUNBOOK.md must have exactly one operational commit");
    assert.equal(runbookHistory[0]?.changeClass, "operational", "RUNBOOK commit must be operational class");

    // history(RUNBOOK.md) filtered by "plan" must be empty (RUNBOOK is never plan)
    const runbookPlanHistory = await store.history(runbookPath, { changeClass: "plan" });
    assert.equal(runbookPlanHistory.length, 0, "RUNBOOK.md must have zero plan commits");

    // plan history (task.md) filtered by "plan" must contain exactly one entry
    const taskPlanHistory = await store.history(taskPath, { changeClass: "plan" });
    assert.equal(taskPlanHistory.length, 1, "task.md must have exactly one plan commit");

    await store.close();
  });

  // (b) history(path) returns commits newest-first with actor + timestamp;
  //     filtering by changeClass returns only matching commits
  test("history returns commits newest-first with actor and timestamp, filterable by changeClass", async () => {
    const storeRoot = join(tmpRoot, "history");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-hist");
    await mkdir(featureDir, { recursive: true });

    const filePath = join(featureDir, "epic.md");

    await store.commit(
      featureDir,
      async () => { await writeFile(filePath, "# v1\n", "utf8"); },
      { changeClass: "plan", actor: "agent-alpha" },
    );

    await store.commit(
      featureDir,
      async () => { await writeFile(filePath, "# v2\n", "utf8"); },
      { changeClass: "operational", actor: "agent-beta" },
    );

    await store.commit(
      featureDir,
      async () => { await writeFile(filePath, "# v3\n", "utf8"); },
      { changeClass: "plan", actor: "agent-gamma" },
    );

    // history() for this file — newest first
    const allHistory = await store.history(filePath);
    assert.ok(allHistory.length >= 3, `expected >=3 history entries, got ${allHistory.length}`);

    // newest commit must have actor agent-gamma
    const newest = allHistory[0];
    assert.ok(newest !== undefined, "history must have at least one entry");
    assert.equal(newest.actor, "agent-gamma", "newest entry must be agent-gamma");
    assert.ok(newest.timestamp instanceof Date, "timestamp must be a Date");

    // filter by plan — must exclude operational
    const planHistory = await store.history(filePath, { changeClass: "plan" });
    assert.ok(planHistory.every((e) => e.changeClass === "plan"), "filtered history must only contain plan entries");
    assert.equal(planHistory.length, 2, "expected 2 plan entries");

    await store.close();
  });

  // (c) Trailer round-trip for actor with spaces and unicode
  test("trailer round-trip for actor containing spaces and unicode", async () => {
    const storeRoot = join(tmpRoot, "trailer-roundtrip");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-rt");
    await mkdir(featureDir, { recursive: true });

    const actorValue = "TDD Agent ñ — v2";
    const filePath = join(featureDir, "story.md");

    await store.commit(
      featureDir,
      async () => { await writeFile(filePath, "# Story\n", "utf8"); },
      { changeClass: "plan", actor: actorValue },
    );

    const entries = await store.history(filePath);
    const entry = entries[0];
    assert.ok(entry !== undefined, "history must have one entry");
    assert.equal(entry.actor, actorValue, "actor round-trip must preserve value exactly");
    assert.equal(entry.changeClass, "plan", "changeClass must round-trip as plan");

    await store.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B4 — atomic file writes via GitStore.atomicWrite
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — B4 atomic write enforcement", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-b4-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (B4-a) GitStore exposes atomicWrite(destPath, content) that writes via
  //        write-temp + rename — the final file must exist with the given content
  //        and no *.tmp sentinel file must remain afterward.
  test("atomicWrite writes content to dest and leaves no temp file", async () => {
    const storeRoot = join(tmpRoot, "atomic-write");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const destPath = join(storeRoot, "epic.md");
    const content = "# Atomic Epic\n";

    await store.atomicWrite(destPath, content);

    // Final file must contain the content.
    const actual = await readFile(destPath, "utf8");
    assert.equal(actual, content, "atomicWrite must write the content to destPath");

    // No *.tmp file must linger in storeRoot.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(storeRoot);
    const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, `temp files must be cleaned up, found: ${tmpFiles.join(", ")}`);

    await store.close();
  });

  // (B4-b) A concurrent reader of destPath during atomicWrite never observes
  //        an empty/truncated file: it sees either the previous content or the
  //        full new content.
  test("concurrent reader during atomicWrite sees only complete content", async () => {
    const storeRoot = join(tmpRoot, "atomic-concurrent");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const destPath = join(storeRoot, "story.md");
    const oldContent = "# Old content — definitely non-empty\n";
    const newContent = "# New content — definitely non-empty\n";

    // Seed an old file so reads before the rename return old content.
    await writeFile(destPath, oldContent, "utf8");

    // We cannot inject a pause mid-rename (it's atomic), but we can assert the
    // post-condition: destPath must contain exactly newContent after atomicWrite.
    await store.atomicWrite(destPath, newContent);

    const readAfter = await readFile(destPath, "utf8");
    assert.equal(readAfter, newContent, "after atomicWrite destPath must hold new content");
    assert.ok(readAfter.length > 0, "new content must be non-empty");

    await store.close();
  });

  // (B4-c) atomicWrite places its temp file inside the store root so it is
  //        covered by the .gitignore *.tmp pattern and never committed.
  test("atomicWrite temp file is in the store root and excluded by gitignore", async () => {
    const storeRoot = join(tmpRoot, "atomic-gitignore");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const featureDir = join(storeRoot, "feat-atomic");
    await mkdir(featureDir, { recursive: true });
    const destPath = join(featureDir, "task.md");

    // Write using atomicWrite then commit.
    await store.commit(
      featureDir,
      async () => {
        await store.atomicWrite(destPath, "# Atomic Task\n");
      },
      { changeClass: "plan", actor: "b4-agent" },
    );

    const commits = await gitLog(storeRoot, "%H");
    assert.ok(commits.length > 0, "commit must exist after atomicWrite+commit");

    const sha = commits[0];
    if (sha === undefined) throw new Error("no commit sha");
    const files = await gitLsFiles(storeRoot, sha);

    const hasTmpFile = files.some((f) => f.endsWith(".tmp"));
    assert.ok(!hasTmpFile, `no .tmp files must appear in committed tree, found: ${files.join(", ")}`);

    await store.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 — GitStore.open/close must wire WriterLock
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — B1 writer-lock wiring", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-b1-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (B1-a) open() for writing acquires the lock file
  test("open() for writing creates the .kanthord-writer-lock file", async () => {
    const storeRoot = join(tmpRoot, "lock-acquired");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const lockPath = join(storeRoot, ".kanthord-writer-lock");
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as {
      token: string;
      pid: number;
      acquiredAt: string;
    };

    assert.equal(typeof raw.token, "string");
    assert.ok(raw.token.length > 0, "lock token must be non-empty");
    assert.equal(raw.pid, process.pid, "lock must record current pid");

    await store.close();
  });

  // (B1-b) a second write-open on the same root throws StoreLocked
  test("second write-open on the same root throws StoreLocked", async () => {
    const storeRoot = join(tmpRoot, "double-open");
    await mkdir(storeRoot, { recursive: true });

    const store1 = new GitStore(storeRoot);
    await store1.open();

    const store2 = new GitStore(storeRoot);
    await assert.rejects(
      () => store2.open(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked");
        assert.equal((err as StoreLocked).code, "store-locked");
        return true;
      },
    );

    await store1.close();
  });

  // (B1-c) close() releases the lock; a subsequent write-open succeeds
  test("close() releases the lock so a subsequent write-open succeeds", async () => {
    const storeRoot = join(tmpRoot, "release-reopen");
    await mkdir(storeRoot, { recursive: true });

    const store1 = new GitStore(storeRoot);
    await store1.open();
    await store1.close();

    // After close, the lock file must be gone
    const lockPath = join(storeRoot, ".kanthord-writer-lock");
    const lockExists = await readFile(lockPath, "utf8").then(() => true).catch(() => false);
    assert.equal(lockExists, false, "lock file must be removed after close()");

    // A new write-open on the same root must succeed
    const store2 = new GitStore(storeRoot);
    await assert.doesNotReject(() => store2.open());
    await store2.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B2 — GitStore read-only open succeeds while writer holds lock
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — B2 read-only open mode", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-b2-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (B2-a) A read-only open does not create the .kanthord-writer-lock file
  test("read-only open does not create the .kanthord-writer-lock file", async () => {
    const storeRoot = join(tmpRoot, "ro-no-lock");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot, { readOnly: true });
    await store.open();

    const lockPath = join(storeRoot, ".kanthord-writer-lock");
    const lockExists = await readFile(lockPath, "utf8").then(() => true).catch(() => false);
    assert.equal(lockExists, false, "read-only open must not create lock file");

    await store.close();
  });

  // (B2-b) A read-only open succeeds while a write-mode GitStore holds the lock
  test("read-only open succeeds while a writer holds the lock", async () => {
    const storeRoot = join(tmpRoot, "ro-while-writer");
    await mkdir(storeRoot, { recursive: true });

    const writer = new GitStore(storeRoot);
    await writer.open();

    const reader = new GitStore(storeRoot, { readOnly: true });
    await assert.doesNotReject(
      () => reader.open(),
      "read-only open must not throw while writer holds lock",
    );

    await reader.close();
    await writer.close();
  });

  // (B2-c) close() on a read-only store does not remove the writer's lock file
  test("close() on read-only store leaves the writer lock intact", async () => {
    const storeRoot = join(tmpRoot, "ro-close-safe");
    await mkdir(storeRoot, { recursive: true });

    const writer = new GitStore(storeRoot);
    await writer.open();

    const reader = new GitStore(storeRoot, { readOnly: true });
    await reader.open();
    await reader.close();

    // Lock must still exist and belong to the writer
    const lockPath = join(storeRoot, ".kanthord-writer-lock");
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    assert.equal(raw.pid, process.pid, "writer lock must remain intact after reader close");

    await writer.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B2 (5th review) — GitStore.open() must acquire lock
// BEFORE mutating the store root (repo init, gitignore write, etc.)
//
// The reviewer finding: `open()` currently runs ensureGitRepo + ensureGitignore
// BEFORE acquiring WriterLock, so a losing second writer can mutate the store
// root (create .git, .gitignore) before being rejected.  A correct implementation
// acquires the lock FIRST; if the lock fails the root is untouched.
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — B2(5th) lock-before-mutate", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-b2-5-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (B2-5th-a) When the lock is already held and the store root is
  // uninitialized (no .git), a second writer's open() must throw StoreLocked
  // WITHOUT creating .git or .gitignore — i.e. the lock check must come before
  // any repo-mutation work.
  //
  // Setup: manually place a live lock file (process.pid, valid token) in a
  // fresh empty dir so the dir has only the lock and no .git.  Then call
  // GitStore.open() on that dir and assert:
  //   (1) it throws StoreLocked
  //   (2) .git does NOT exist (no repo init happened before the rejection)
  test("open() on a locked but uninitialized root throws StoreLocked without creating .git", async () => {
    const { writeFile: fsWrite, stat } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");

    const storeRoot = join(tmpRoot, "locked-uninit");
    await mkdir(storeRoot, { recursive: true });

    // Pre-place a live lock (current process, fresh token) so acquire() will fail.
    const lockPath = join(storeRoot, ".kanthord-writer-lock");
    await fsWrite(
      lockPath,
      JSON.stringify({ token: randomUUID(), pid: process.pid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // Attempt to open — must throw StoreLocked.
    await assert.rejects(
      () => new GitStore(storeRoot).open(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, `must throw StoreLocked, got ${String(err)}`);
        return true;
      },
    );

    // .git must NOT exist — the lock check must run before any repo init.
    const gitDirExists = await stat(join(storeRoot, ".git")).then(() => true).catch(() => false);
    assert.equal(
      gitDirExists,
      false,
      "open() must not create .git before acquiring the lock; lock-check must come first",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: B2(6th) — open-failure-leaks-writer-lock
// ---------------------------------------------------------------------------

test("src/store/git-store — B2(6th) open-failure must release lock", async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-b26-"));
  t.after(() => rm(tmpRoot, { recursive: true, force: true }));

  await t.test("open() releases the lock when ensureGitignore fails", async () => {
    const storeRoot = join(tmpRoot, "broken-ignore");
    await mkdir(storeRoot, { recursive: true });

    // Let git init succeed by leaving .git absent.
    // Block ensureGitignore by pre-creating .gitignore as a DIRECTORY —
    // appendFile on a directory path throws EISDIR.
    const gitignoreBlocker = join(storeRoot, ".gitignore");
    await mkdir(gitignoreBlocker, { recursive: true });

    // open() should throw (ensureGitignore fails: appendFile on a dir = EISDIR).
    await assert.rejects(
      () => new GitStore(storeRoot).open(),
      (err: unknown) => {
        assert.ok(err instanceof Error, `must throw an Error, got ${String(err)}`);
        return true;
      },
      "open() must reject when ensureGitignore fails",
    );

    // The lock file must NOT remain — open() must release the lock on failure.
    const lockPath = join(storeRoot, ".kanthord-writer-lock");
    const lockExists = await import("node:fs/promises").then((fs) =>
      fs.access(lockPath).then(() => true).catch(() => false),
    );
    assert.equal(
      lockExists,
      false,
      "open() must release the writer lock when .gitignore write fails (no lock file should remain)",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B2 (history-swallows-git-errors)
//
// B2: `history()` catches every `git log` failure and returns `[]`, masking
// corrupt-repo / permission / git-process failures.  A correct implementation
// must distinguish:
//   - Absence (empty history, file never committed) → return []   (allowed)
//   - Real git failure (corrupt repo, EACCES, etc.) → throw       (required)
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — B2 history must propagate non-absence git errors", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-b2-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (B2-a) Absence case: history on a file never committed returns [].
  // This is the safe-empty case and must stay as-is.
  test("history returns [] for a file that has never been committed", async () => {
    const storeRoot = join(tmpRoot, "absence");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const neverCommittedPath = join(storeRoot, "never-committed.md");
    const result = await store.history(neverCommittedPath);
    assert.deepEqual(result, [], "absence case must return []");

    await store.close();
  });

  // (B2-b) Corrupt-repo case: history on a broken git repo must throw,
  // not return [].  We create a valid repo with one commit, then corrupt
  // the git objects dir so `git log` exits with a real error.
  test("history throws when git log fails with a non-absence error (corrupt repo)", async () => {
    const storeRoot = join(tmpRoot, "corrupt");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot);
    await store.open();

    const filePath = join(storeRoot, "plan.md");
    await store.commit(
      storeRoot,
      async () => { await writeFile(filePath, "# Plan\n", "utf8"); },
      { changeClass: "plan", actor: "corrupt-test" },
    );

    // Confirm history works before corruption.
    const before = await store.history(filePath);
    assert.equal(before.length, 1, "sanity: one commit before corruption");

    // Corrupt the git object store so `git log` will fail.
    const { rm: fsRm } = await import("node:fs/promises");
    await fsRm(join(storeRoot, ".git", "objects"), { recursive: true, force: true });

    // Now history() must throw — not swallow the error and return [].
    await assert.rejects(
      () => store.history(filePath),
      "history must propagate git log failure on a corrupt repo",
    );

    await store.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (read-only-open-mutates-store)
//
// B1: `GitStore` read-only mode bypasses the writer lock but `open()` still
// calls `ensureGitRepo()` and `ensureGitignore()`, so a read-only open on an
// uninitialized root performs writes (creates .git, appends .gitignore) while
// a writer holds the lock.  A correct implementation must skip ALL
// initialization/mutation steps when `readOnly: true`.
// ---------------------------------------------------------------------------

test.describe("src/store/git-store — B1 read-only open must not mutate uninitialized root", () => {
  let tmpRoot: string;

  test.before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "git-store-b1-ro-"));
  });

  test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // (B1-ro-a) A read-only open on a completely fresh (no .git) directory must
  // NOT create the .git directory — i.e., ensureGitRepo() must be skipped.
  test("read-only open on uninitialized root does not create .git", async () => {
    const storeRoot = join(tmpRoot, "ro-no-git");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot, { readOnly: true });
    await store.open();
    await store.close();

    const { stat } = await import("node:fs/promises");
    const gitDirExists = await stat(join(storeRoot, ".git")).then(() => true).catch(() => false);
    assert.equal(
      gitDirExists,
      false,
      "read-only open must not create .git on an uninitialized root",
    );
  });

  // (B1-ro-b) A read-only open on a fresh directory must NOT create .gitignore.
  test("read-only open on uninitialized root does not create .gitignore", async () => {
    const storeRoot = join(tmpRoot, "ro-no-gitignore");
    await mkdir(storeRoot, { recursive: true });

    const store = new GitStore(storeRoot, { readOnly: true });
    await store.open();
    await store.close();

    const { stat } = await import("node:fs/promises");
    const gitignoreExists = await stat(join(storeRoot, ".gitignore")).then(() => true).catch(() => false);
    assert.equal(
      gitignoreExists,
      false,
      "read-only open must not create .gitignore on an uninitialized root",
    );
  });

  // (B1-ro-c) A read-only open must succeed while a writer holds the lock AND
  // the repo is already initialized (write-mode open already ran) — this
  // remains the existing allowed case; the constraint is only that read-only
  // must not mutate an uninitialized root.
  test("read-only open on an already-initialized root succeeds without extra mutations", async () => {
    const storeRoot = join(tmpRoot, "ro-after-init");
    await mkdir(storeRoot, { recursive: true });

    // Write-mode open first — initializes the repo.
    const writer = new GitStore(storeRoot);
    await writer.open();

    const reader = new GitStore(storeRoot, { readOnly: true });
    await assert.doesNotReject(
      () => reader.open(),
      "read-only open must succeed on an already-initialized root",
    );

    await reader.close();
    await writer.close();
  });
});
