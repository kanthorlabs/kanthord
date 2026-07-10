/**
 * Story 001 / Task T1 + T2 — git.branch/commit/clone/fetch adapters
 *
 * T1 tests:
 *  (a) registry loads git.branch/git.commit with tier:auto + full §5 contract
 *  (b) submit branch+commit on a temp repo → branch/commit on disk + completion rows
 *  (c) commit with nothing staged → failed with stderr summary
 *
 * T2 tests:
 *  (d) git.clone from local bare path materializes the work tree
 *  (e) git.fetch updates refs after bare remote gains a commit
 *  (f) reconcile on interrupted commit resolves done when tree hash matches, resubmit otherwise
 *
 * B1 tests (blocker: missing verifySetup gate):
 *  (g) verifySetup failing check prevents git.branch submit and emits blocked-needs-setup
 *  (h) verifySetup failing check prevents git.commit submit and emits blocked-needs-setup
 *  (i) verifySetup failing check prevents git.clone submit and emits blocked-needs-setup
 *  (j) verifySetup failing check prevents git.fetch submit and emits blocked-needs-setup
 *
 * S1 tests (blocker: adapter gitBin option still ignored):
 *  (k) makeCloneAdapter passes gitBin to runGit (fake binary intercepted)
 *  (l) makeFetchAdapter passes gitBin to runGit (fake binary intercepted)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { openStore } from "../../foundations/sqlite-store.ts";
import { FakeClock } from "../../foundations/clock.ts";
import { loadVerbRegistry, registerVerb } from "../registry.ts";
import { initSchema } from "../../store/schema.ts";
import { submit, getInFlightOp } from "../submit.ts";
import { startPolling } from "../poller.ts";
import {
  makeBranchAdapter,
  makeCommitAdapter,
  makeCloneAdapter,
  makeFetchAdapter,
} from "./git-local.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

/**
 * Always-pass verifySetup fixture: returns ok:true so lifecycle tests that
 * exercise real git ops are not blocked by the absent-verifySetup gate.
 * Use this in any adapter construction where the test is NOT asserting the
 * gate behaviour — it is a fixture concern only.
 */
const alwaysPassVerifySetup = async (): Promise<VerifyReport> => ({
  platform: "test",
  repo: "test/repo",
  identity: "test-identity",
  ok: true,
  checks: [],
  inboxItems: [],
});

/** Row shape of broker_completion as read back from SQLite. */
interface CompletionRow {
  op_id: string;
  status: string;
  result_json: string | null;
  error_json: string | null;
}

/** Initialize a bare temp git repo and return its path. */
function initBareRepo(parentDir: string): string {
  const bareDir = join(parentDir, "remote.git");
  execSync(`git init --bare "${bareDir}"`, { stdio: "pipe" });
  return bareDir;
}

/** Initialize a working git repo cloned from the bare remote. */
function initWorkRepo(parentDir: string, bareDir: string): string {
  const workDir = join(parentDir, "work");
  execSync(`git clone "${bareDir}" "${workDir}"`, { stdio: "pipe" });
  // Configure dummy identity so commits work in the hermetic env
  execSync(
    `git -C "${workDir}" config user.email "test@example.com" && git -C "${workDir}" config user.name "Test"`,
    { stdio: "pipe", shell: "/bin/sh" },
  );
  // Create an initial commit on the default branch so the repo is non-empty
  execSync(
    `git -C "${workDir}" commit --allow-empty -m "init"`,
    { stdio: "pipe" },
  );
  execSync(`git -C "${workDir}" push origin HEAD`, { stdio: "pipe" });
  return workDir;
}

/** Build a minimal git.branch VerbRegistryEntry in memory (no YAML needed). */
function makeBranchEntry() {
  return {
    verb: "git.branch",
    tier: "auto" as const,
    timeout: 30000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 50,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 0 },
    observed_state_can_regress: false,
  };
}

/** Build a minimal git.commit VerbRegistryEntry in memory. */
function makeCommitEntry() {
  return {
    verb: "git.commit",
    tier: "auto" as const,
    timeout: 30000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 50,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 0 },
    observed_state_can_regress: false,
  };
}

describe("src/broker/verbs/git-local.ts", () => {
  // -------------------------------------------------------------------------
  // (a) Registry — YAML entries load with tier:auto and full §5 contract
  // -------------------------------------------------------------------------
  test("registry YAML files load git.branch and git.commit with tier:auto and full §5 contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-reg-"));
    try {
      // Write the two YAML registry files (path matches Story 001 T1 spec)
      await writeFile(
        join(dir, "git.branch.yaml"),
        [
          "verb: git.branch",
          "tier: auto",
          "timeout: 30000",
          "idempotency:",
          "  window_ms: 0",
          "retry:",
          "  max: 3",
          "  backoff: exponential",
          "poll_interval: 5000",
          "terminal_states:",
          "  - done",
          "  - failed",
          "rate_limit:",
          "  requests_per_minute: 0",
          "observed_state_can_regress: false",
        ].join("\n"),
      );
      await writeFile(
        join(dir, "git.commit.yaml"),
        [
          "verb: git.commit",
          "tier: auto",
          "timeout: 30000",
          "idempotency:",
          "  window_ms: 0",
          "retry:",
          "  max: 3",
          "  backoff: exponential",
          "poll_interval: 5000",
          "terminal_states:",
          "  - done",
          "  - failed",
          "rate_limit:",
          "  requests_per_minute: 0",
          "observed_state_can_regress: false",
        ].join("\n"),
      );

      const registry = await loadVerbRegistry(dir);

      const branch = registry["git.branch"];
      assert.ok(branch !== undefined, "git.branch entry must be present");
      assert.equal(branch.tier, "auto", "git.branch tier must be auto");
      assert.equal(branch.timeout, 30000, "git.branch timeout declared");
      assert.deepEqual(
        branch.terminal_states,
        ["done", "failed"],
        "git.branch terminal_states declared",
      );
      assert.equal(
        branch.rate_limit.requests_per_minute,
        0,
        "git.branch rate_limit n/a declared as 0",
      );
      assert.equal(
        branch.observed_state_can_regress,
        false,
        "git.branch regression:n/a declared",
      );

      const commit = registry["git.commit"];
      assert.ok(commit !== undefined, "git.commit entry must be present");
      assert.equal(commit.tier, "auto", "git.commit tier must be auto");
      assert.equal(commit.timeout, 30000, "git.commit timeout declared");
      assert.deepEqual(
        commit.terminal_states,
        ["done", "failed"],
        "git.commit terminal_states declared",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (b) Lifecycle — submit branch+commit → disk effect + completion rows
  // -------------------------------------------------------------------------
  test("submit git.branch then git.commit produces the branch and commit on disk with completion rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-lifecycle-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(0);

      const branchEntry = makeBranchEntry();
      const commitEntry = makeCommitEntry();

      const branchAdapter = makeBranchAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });
      const commitAdapter = makeCommitAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });

      // Both adapters must have a reconcile path (Epic 005 rule)
      registerVerb(branchEntry, branchAdapter);
      registerVerb(commitEntry, commitAdapter);

      // Submit git.branch: create branch "feature/t1" at HEAD
      const branchOpId = await submit(
        branchEntry,
        branchAdapter,
        { cwd: workDir, branch: "feature/t1", startPoint: "HEAD" },
        "idem-branch-001",
        store,
      );
      assert.ok(typeof branchOpId === "string", "branch op_id is a string");

      // Poll the branch op to completion synchronously via FakeClock
      const branchOp = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        branchOpId,
      );
      assert.ok(branchOp !== undefined, "branch op must be in-flight in store");

      startPolling(
        { op_id: branchOp.op_id, verb: branchOp.verb, request_id: branchOp.request_id, status: "in_flight" },
        branchEntry,
        branchAdapter,
        store,
        clock,
      );
      clock.advance(branchEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const branchCompletion = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        branchOpId,
      );
      assert.ok(branchCompletion !== undefined, "branch completion row must exist");
      assert.equal(branchCompletion.status, "done", "branch op completes as done");

      // Verify the branch exists on disk
      const branchList = execSync(`git -C "${workDir}" branch`, { encoding: "utf8" });
      assert.ok(
        branchList.includes("feature/t1"),
        "feature/t1 branch must exist on disk after adapter submit",
      );

      // Now commit: stage a file, then submit git.commit
      await writeFile(join(workDir, "hello.txt"), "hello");
      execSync(`git -C "${workDir}" add hello.txt`, { stdio: "pipe" });

      const commitOpId = await submit(
        commitEntry,
        commitAdapter,
        { cwd: workDir, message: "add hello" },
        "idem-commit-001",
        store,
      );
      assert.ok(typeof commitOpId === "string", "commit op_id is a string");

      const commitOp = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        commitOpId,
      );
      assert.ok(commitOp !== undefined, "commit op must be in-flight in store");

      startPolling(
        { op_id: commitOp.op_id, verb: commitOp.verb, request_id: commitOp.request_id, status: "in_flight" },
        commitEntry,
        commitAdapter,
        store,
        clock,
      );
      clock.advance(commitEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const commitCompletion = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        commitOpId,
      );
      assert.ok(commitCompletion !== undefined, "commit completion row must exist");
      assert.equal(commitCompletion.status, "done", "commit op completes as done");

      // Verify the commit exists on the branch
      const logOut = execSync(`git -C "${workDir}" log --oneline HEAD`, { encoding: "utf8" });
      assert.ok(logOut.includes("add hello"), "commit must appear in git log");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (c) Failing commit — nothing staged → failed with stderr summary
  // -------------------------------------------------------------------------
  test("commit with nothing staged resolves failed with git stderr summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-fail-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(0);

      const commitEntry = makeCommitEntry();
      const commitAdapter = makeCommitAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });

      // Submit commit with nothing staged
      const failOpId = await submit(
        commitEntry,
        commitAdapter,
        { cwd: workDir, message: "empty commit should fail" },
        "idem-commit-fail-001",
        store,
      );

      const failOp = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        failOpId,
      );
      assert.ok(failOp !== undefined, "fail commit op must be in-flight");

      startPolling(
        { op_id: failOp.op_id, verb: failOp.verb, request_id: failOp.request_id, status: "in_flight" },
        commitEntry,
        commitAdapter,
        store,
        clock,
      );
      clock.advance(commitEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const failCompletion = store.get<CompletionRow>(
        "SELECT op_id, status, error_json FROM broker_completion WHERE op_id = ?",
        failOpId,
      );
      assert.ok(failCompletion !== undefined, "fail commit completion row must exist");
      assert.equal(failCompletion.status, "failed", "nothing-staged commit must complete as failed");

      // The error_json must contain a stderr summary from git
      assert.ok(
        failCompletion.error_json !== null,
        "failed completion must carry error_json with stderr summary",
      );
      const errorObj = JSON.parse(failCompletion.error_json) as { stderr?: string };
      assert.ok(
        typeof errorObj.stderr === "string" && errorObj.stderr.length > 0,
        "error_json.stderr must contain git's error output",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (d) git.clone materializes work tree from local bare path
  // -------------------------------------------------------------------------
  test("git.clone from a local bare path materializes the work tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-clone-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir1 = initWorkRepo(dir, bareDir);
      // Create a file on the default branch and push it
      await writeFile(join(workDir1, "seed.txt"), "seed");
      execSync(`git -C "${workDir1}" add seed.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir1}" commit -m "seed"`, { stdio: "pipe" });
      execSync(`git -C "${workDir1}" push origin HEAD`, { stdio: "pipe" });

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(0);

      const cloneEntry = {
        verb: "git.clone",
        tier: "auto" as const,
        timeout: 60000,
        idempotency: { window_ms: 0 },
        retry: { max: 3, backoff: "exponential" },
        poll_interval: 50,
        terminal_states: ["done", "failed"],
        rate_limit: { requests_per_minute: 0 },
        observed_state_can_regress: false,
      };
      const cloneAdapter = makeCloneAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });
      registerVerb(cloneEntry, cloneAdapter);

      const cloneTarget = join(dir, "clone-out");
      const cloneOpId = await submit(
        cloneEntry,
        cloneAdapter,
        { remote: bareDir, cwd: cloneTarget },
        "idem-clone-001",
        store,
      );
      assert.ok(typeof cloneOpId === "string", "clone op_id is a string");

      const cloneOp = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        cloneOpId,
      );
      assert.ok(cloneOp !== undefined, "clone op must be in-flight");

      startPolling(
        { op_id: cloneOp.op_id, verb: cloneOp.verb, request_id: cloneOp.request_id, status: "in_flight" },
        cloneEntry,
        cloneAdapter,
        store,
        clock,
      );
      clock.advance(cloneEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const cloneCompletion = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        cloneOpId,
      );
      assert.ok(cloneCompletion !== undefined, "clone completion row must exist");
      assert.equal(cloneCompletion.status, "done", "clone op completes as done");

      // The cloned work tree must exist and contain seed.txt
      const seedContent = execSync(`cat "${join(cloneTarget, "seed.txt")}"`, { encoding: "utf8" });
      assert.equal(seedContent.trim(), "seed", "cloned work tree must contain seeded file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (e) git.fetch updates refs from bare remote after it gains a commit
  // -------------------------------------------------------------------------
  test("git.fetch updates refs after the bare remote gains a commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-fetch-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Create a second work dir as a "pusher" that adds a commit to bare
      const pusherDir = join(dir, "pusher");
      execSync(`git clone "${bareDir}" "${pusherDir}"`, { stdio: "pipe" });
      execSync(
        `git -C "${pusherDir}" config user.email "p@example.com" && git -C "${pusherDir}" config user.name "Pusher"`,
        { stdio: "pipe", shell: "/bin/sh" },
      );
      await writeFile(join(pusherDir, "remote.txt"), "from-remote");
      execSync(`git -C "${pusherDir}" add remote.txt`, { stdio: "pipe" });
      execSync(`git -C "${pusherDir}" commit -m "remote commit"`, { stdio: "pipe" });
      execSync(`git -C "${pusherDir}" push origin HEAD`, { stdio: "pipe" });

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(0);

      const fetchEntry = {
        verb: "git.fetch",
        tier: "auto" as const,
        timeout: 30000,
        idempotency: { window_ms: 0 },
        retry: { max: 3, backoff: "exponential" },
        poll_interval: 50,
        terminal_states: ["done", "failed"],
        rate_limit: { requests_per_minute: 0 },
        observed_state_can_regress: false,
      };
      const fetchAdapter = makeFetchAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });
      registerVerb(fetchEntry, fetchAdapter);

      const fetchOpId = await submit(
        fetchEntry,
        fetchAdapter,
        { cwd: workDir },
        "idem-fetch-001",
        store,
      );
      assert.ok(typeof fetchOpId === "string", "fetch op_id is a string");

      const fetchOp = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        fetchOpId,
      );
      assert.ok(fetchOp !== undefined, "fetch op must be in-flight");

      startPolling(
        { op_id: fetchOp.op_id, verb: fetchOp.verb, request_id: fetchOp.request_id, status: "in_flight" },
        fetchEntry,
        fetchAdapter,
        store,
        clock,
      );
      clock.advance(fetchEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const fetchCompletion = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        fetchOpId,
      );
      assert.ok(fetchCompletion !== undefined, "fetch completion row must exist");
      assert.equal(fetchCompletion.status, "done", "fetch op completes as done");

      // After fetch, FETCH_HEAD in workDir should reference the remote commit sha
      const fetchHead = execSync(
        `git -C "${workDir}" rev-parse FETCH_HEAD`,
        { encoding: "utf8" },
      ).trim();
      const pusherHead = execSync(
        `git -C "${pusherDir}" rev-parse HEAD`,
        { encoding: "utf8" },
      ).trim();
      assert.equal(fetchHead, pusherHead, "FETCH_HEAD must equal the remote HEAD after fetch");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (f) Reconcile on interrupted commit
  // -------------------------------------------------------------------------
  test("reconcile resolves done when tree hash matches, resubmit when not, and resubmit does not stack a second commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-reconcile-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Stage a file and capture its tree hash before calling submit
      await writeFile(join(workDir, "reconcile.txt"), "reconcile-content");
      execSync(`git -C "${workDir}" add reconcile.txt`, { stdio: "pipe" });
      // Capture the tree hash of the index (what a commit would produce)
      const indexTreeHash = execSync(
        `git -C "${workDir}" write-tree`,
        { encoding: "utf8" },
      ).trim();

      const commitAdapter = makeCommitAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });

      // Submit the commit — it should succeed and store the tree hash internally
      const requestId = await commitAdapter.submit({ cwd: workDir, message: "reconcile test" }) as string;

      // reconcile with the correct desired tree hash → must resolve done
      const doneResult = await commitAdapter.reconcile({
        requestId,
        input: { cwd: workDir, message: "reconcile test" },
        desiredTreeHash: indexTreeHash,
      }) as { status: string };
      assert.equal(doneResult.status, "done", "reconcile with matching tree hash must resolve done");

      // reconcile with a wrong tree hash → must resolve resubmit
      const wrongHash = "0000000000000000000000000000000000000000";
      const resubmitResult = await commitAdapter.reconcile({
        requestId,
        input: { cwd: workDir, message: "reconcile test" },
        desiredTreeHash: wrongHash,
      }) as { status: string };
      assert.equal(resubmitResult.status, "resubmit", "reconcile with wrong tree hash must resolve resubmit");

      // Re-submit with the same content when commit already happened:
      // staging the same file again would result in nothing to commit
      await writeFile(join(workDir, "reconcile.txt"), "reconcile-content");
      execSync(`git -C "${workDir}" add reconcile.txt`, { stdio: "pipe" });
      const logBefore = execSync(`git -C "${workDir}" log --oneline HEAD`, { encoding: "utf8" }).trim().split("\n").length;

      // Submit again — since nothing changes, it should be classified as noop/failed (not stacking a second commit)
      const requestId2 = await commitAdapter.submit({ cwd: workDir, message: "reconcile test" }) as string;
      const state2 = await commitAdapter.poll_status(requestId2) as { status: string };
      // A re-submit with nothing new to stage must not succeed (noop → failed)
      assert.equal(state2.status, "failed", "re-submit with nothing new to stage must not produce a second commit");

      const logAfter = execSync(`git -C "${workDir}" log --oneline HEAD`, { encoding: "utf8" }).trim().split("\n").length;
      assert.equal(logAfter, logBefore, "commit count must not increase on noop re-submit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // B3 — git.branch reconcile must compare expected sha (not just existence)
  //
  // Epic defines git.branch desired-effect as "ref at sha" — reconcile must
  // return resubmit when the branch exists but points to a DIFFERENT sha, and
  // done only when the branch points to the EXACT expected sha.
  // -------------------------------------------------------------------------
  test("branch reconcile resolves done at correct sha and resubmit when branch points to a different sha", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-b3-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Capture the initial HEAD sha — this will be the expected sha for the branch
      const startSha = execSync(
        `git -C "${workDir}" rev-parse HEAD`,
        { encoding: "utf8" },
      ).trim();

      // Create a second commit to produce a different sha for the branch tip later
      await writeFile(join(workDir, "second.txt"), "second");
      execSync(`git -C "${workDir}" add second.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "second commit"`, { stdio: "pipe" });
      const secondSha = execSync(
        `git -C "${workDir}" rev-parse HEAD`,
        { encoding: "utf8" },
      ).trim();

      // Create a branch at startSha (first commit)
      const branchAdapter = makeBranchAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });
      await branchAdapter.submit({ cwd: workDir, branch: "feature/b3-reconcile", startPoint: startSha });

      // Reconcile with desiredSha = startSha → branch points to startSha → done
      const doneResult = await branchAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/b3-reconcile", startPoint: startSha },
        desiredSha: startSha,
      }) as { status: string };
      assert.equal(
        doneResult.status,
        "done",
        "reconcile must return done when branch ref equals desiredSha",
      );

      // Reconcile with desiredSha = secondSha → branch points to startSha (different) → resubmit
      const resubmitResult = await branchAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/b3-reconcile", startPoint: startSha },
        desiredSha: secondSha,
      }) as { status: string };
      assert.equal(
        resubmitResult.status,
        "resubmit",
        "reconcile must return resubmit when branch ref is at a different sha than desiredSha",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (g) B1: verifySetup failing check prevents git.branch submit
  // -------------------------------------------------------------------------
  test("verifySetup failing check prevents git.branch submit and emits blocked-needs-setup", async () => {
    const failingReport: VerifyReport = {
      platform: "github",
      repo: "owner/repo",
      identity: "test-identity",
      ok: false,
      checks: [
        {
          name: "gh-token-scopes",
          ok: false,
          detail: "Token is missing required scope 'repo'.",
          remediation: "Regenerate the GitHub PAT with the 'repo' scope enabled.",
        },
      ],
      inboxItems: [
        {
          kind: "system:setup",
          message: "Setup required for repo owner/repo (identity: test-identity): gh-token-scopes",
          details: "Failed checks for owner/repo / test-identity: gh-token-scopes: Token is missing required scope 'repo'.",
          remediation: "Regenerate the GitHub PAT with the 'repo' scope enabled.",
        },
      ],
    };
    let runGitCallCount = 0;
    const fakePreflight = async (): Promise<VerifyReport> => failingReport;

    // git.branch adapter with verifySetup option injected
    const branchAdapter = makeBranchAdapter({
      gitBin: "git",
      verifySetup: fakePreflight,
    });

    // submit must NOT call runGit — the op should be short-circuited before mutation
    const result = await branchAdapter.submit({
      cwd: "/nonexistent",
      branch: "feature/blocked",
      startPoint: "HEAD",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "submit must return blocked-needs-setup when verifySetup fails",
    );
    assert.ok(
      Array.isArray(result.inboxItems) && result.inboxItems.length > 0,
      "blocked-needs-setup result must carry inboxItems",
    );
    // Verify no git mutation was attempted: if runGit were called with /nonexistent cwd it
    // would throw a non-ENOENT error, but more directly we assert the status — any git
    // execution on a non-existent cwd would produce a different status (failed).
    assert.equal(runGitCallCount, 0, "runGit must not be called when verifySetup fails");
  });

  // -------------------------------------------------------------------------
  // (h) B1: verifySetup failing check prevents git.commit submit
  // -------------------------------------------------------------------------
  test("verifySetup failing check prevents git.commit submit and emits blocked-needs-setup", async () => {
    const failingReport: VerifyReport = {
      platform: "github",
      repo: "owner/repo",
      identity: "test-identity",
      ok: false,
      checks: [
        {
          name: "git-version",
          ok: false,
          detail: "git binary not found: /no/git",
          remediation: "Install git >= 2.31 and ensure it is on PATH.",
        },
      ],
      inboxItems: [
        {
          kind: "system:setup",
          message: "Setup required for repo owner/repo (identity: test-identity): git-version",
          details: "Failed checks for owner/repo / test-identity: git-version: git binary not found: /no/git",
          remediation: "Install git >= 2.31 and ensure it is on PATH.",
        },
      ],
    };
    const fakePreflight = async (): Promise<VerifyReport> => failingReport;

    // git.commit adapter with verifySetup option injected
    const commitAdapter = makeCommitAdapter({
      gitBin: "git",
      verifySetup: fakePreflight,
    });

    const result = await commitAdapter.submit({
      cwd: "/nonexistent",
      message: "blocked commit",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "commit submit must return blocked-needs-setup when verifySetup fails",
    );
    assert.ok(
      Array.isArray(result.inboxItems) && result.inboxItems.length > 0,
      "blocked-needs-setup result must carry inboxItems from the verifySetup report",
    );
  });

  // -------------------------------------------------------------------------
  // (i) B1: verifySetup failing check prevents git.clone submit
  // -------------------------------------------------------------------------
  test("verifySetup failing check prevents git.clone submit and emits blocked-needs-setup", async () => {
    const failingReport: VerifyReport = {
      platform: "github",
      repo: "owner/repo",
      identity: "test-identity",
      ok: false,
      checks: [
        {
          name: "git-version",
          ok: false,
          detail: "git binary not found: /no/git",
          remediation: "Install git >= 2.31 and ensure it is on PATH.",
        },
      ],
      inboxItems: [
        {
          kind: "system:setup",
          message: "Setup required for repo owner/repo (identity: test-identity): git-version",
          details: "Failed checks for owner/repo / test-identity: git-version: git binary not found: /no/git",
          remediation: "Install git >= 2.31 and ensure it is on PATH.",
        },
      ],
    };
    const fakePreflight = async (): Promise<VerifyReport> => failingReport;

    const cloneAdapter = makeCloneAdapter({
      gitBin: "git",
      verifySetup: fakePreflight,
    });

    const result = await cloneAdapter.submit({
      remote: "https://github.com/example/repo.git",
      cwd: "/nonexistent/clone-target",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "clone submit must return blocked-needs-setup when verifySetup fails",
    );
    assert.ok(
      Array.isArray(result.inboxItems) && result.inboxItems.length > 0,
      "blocked-needs-setup result must carry inboxItems",
    );
  });

  // -------------------------------------------------------------------------
  // (j) B1: verifySetup failing check prevents git.fetch submit
  // -------------------------------------------------------------------------
  test("verifySetup failing check prevents git.fetch submit and emits blocked-needs-setup", async () => {
    const failingReport: VerifyReport = {
      platform: "github",
      repo: "owner/repo",
      identity: "test-identity",
      ok: false,
      checks: [
        {
          name: "gh-token-scopes",
          ok: false,
          detail: "Token is missing required scope 'repo'.",
          remediation: "Regenerate the GitHub PAT with the 'repo' scope enabled.",
        },
      ],
      inboxItems: [
        {
          kind: "system:setup",
          message: "Setup required for repo owner/repo (identity: test-identity): gh-token-scopes",
          details: "Failed checks for owner/repo / test-identity: gh-token-scopes: Token is missing required scope 'repo'.",
          remediation: "Regenerate the GitHub PAT with the 'repo' scope enabled.",
        },
      ],
    };
    const fakePreflight = async (): Promise<VerifyReport> => failingReport;

    const fetchAdapter = makeFetchAdapter({
      gitBin: "git",
      verifySetup: fakePreflight,
    });

    const result = await fetchAdapter.submit({
      cwd: "/nonexistent/fetch-target",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "fetch submit must return blocked-needs-setup when verifySetup fails",
    );
    assert.ok(
      Array.isArray(result.inboxItems) && result.inboxItems.length > 0,
      "blocked-needs-setup result must carry inboxItems",
    );
  });

  // -------------------------------------------------------------------------
  // (k) S1: makeCloneAdapter passes gitBin to runGit (fake binary intercepted)
  // -------------------------------------------------------------------------
  test("makeCloneAdapter passes gitBin to runGit so fake binary is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-s1-clone-"));
    try {
      // Write a fake git binary that emits a sentinel and exits 0
      const fakeBin = join(dir, "fake-git");
      await writeFile(fakeBin, "#!/bin/sh\nprintf 'FAKE-GIT-CLONE'; exit 0\n");
      await chmod(fakeBin, 0o755);

      const cloneAdapter = makeCloneAdapter({ gitBin: fakeBin, verifySetup: alwaysPassVerifySetup });

      // submit runs `git clone <remote> <cwd>`; the fake binary must be invoked
      const resultId = await cloneAdapter.submit({
        remote: dir,        // any path; fake exits 0 regardless
        cwd: join(dir, "out"),
      });

      // poll_status must return done (fake binary exits 0 → success/noop)
      const pollResult = await cloneAdapter.poll_status(resultId) as { status: string };
      assert.equal(
        pollResult.status,
        "done",
        "clone poll_status must be done when gitBin fake-binary exits 0",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (l) S1: makeFetchAdapter passes gitBin to runGit (fake binary intercepted)
  // -------------------------------------------------------------------------
  test("makeFetchAdapter passes gitBin to runGit so fake binary is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-s1-fetch-"));
    try {
      // Write a fake git binary that emits a sentinel and exits 0
      const fakeBin = join(dir, "fake-git");
      await writeFile(fakeBin, "#!/bin/sh\nprintf 'FAKE-GIT-FETCH'; exit 0\n");
      await chmod(fakeBin, 0o755);

      const fetchAdapter = makeFetchAdapter({ gitBin: fakeBin, verifySetup: alwaysPassVerifySetup });

      const resultId = await fetchAdapter.submit({ cwd: dir });

      const pollResult = await fetchAdapter.poll_status(resultId) as { status: string };
      assert.equal(
        pollResult.status,
        "done",
        "fetch poll_status must be done when gitBin fake-binary exits 0",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (m) B1-new: missing verifySetup blocks git.branch submit
  // -------------------------------------------------------------------------
  test("omitting verifySetup blocks git.branch submit (verifySetup must not be optional)", async () => {
    // Construct adapter with NO verifySetup.
    // Epic §58 requires every mutating verb to be gated; absence must block.
    const branchAdapter = makeBranchAdapter({ gitBin: "git" });

    const result = await branchAdapter.submit({
      cwd: "/nonexistent/no-preflight",
      branch: "test-branch",
      startPoint: "HEAD",
    }) as { status: string };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "branch submit without verifySetup must return blocked-needs-setup",
    );
  });

  // -------------------------------------------------------------------------
  // (n) B1-new: missing verifySetup blocks git.commit submit
  // -------------------------------------------------------------------------
  test("omitting verifySetup blocks git.commit submit (verifySetup must not be optional)", async () => {
    const commitAdapter = makeCommitAdapter({ gitBin: "git" });

    const result = await commitAdapter.submit({
      cwd: "/nonexistent/no-preflight",
      message: "test commit",
    }) as { status: string };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "commit submit without verifySetup must return blocked-needs-setup",
    );
  });

  // -------------------------------------------------------------------------
  // (o) S1: makeBranchAdapter passes gitBin to runGit (fake binary intercepted)
  // -------------------------------------------------------------------------
  test("makeBranchAdapter passes gitBin to runGit so fake binary is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-s1-branch-"));
    try {
      const fakeBin = join(dir, "fake-git");
      // Fake binary: exits 0 regardless of args so branch creation "succeeds"
      await writeFile(fakeBin, "#!/bin/sh\nprintf 'FAKE-GIT-BRANCH'; exit 0\n");
      await chmod(fakeBin, 0o755);

      const alwaysPass = async (): Promise<VerifyReport> => ({
        platform: "test", repo: "test", identity: "test",
        ok: true, checks: [], inboxItems: [],
      });

      const branchAdapter = makeBranchAdapter({ gitBin: fakeBin, verifySetup: alwaysPass });

      const resultId = await branchAdapter.submit({
        cwd: dir,
        branch: "test-branch",
        startPoint: "HEAD",
      });

      const pollResult = await branchAdapter.poll_status(resultId) as { status: string };
      assert.equal(
        pollResult.status,
        "done",
        "branch poll_status must be done when gitBin fake-binary exits 0",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (p) S1: makeCommitAdapter passes gitBin to runGit (fake binary intercepted)
  // -------------------------------------------------------------------------
  test("makeCommitAdapter passes gitBin to runGit so fake binary is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-local-s1-commit-"));
    try {
      const fakeBin = join(dir, "fake-git");
      // Fake binary: exits 0 so commit "succeeds"
      await writeFile(fakeBin, "#!/bin/sh\nprintf 'FAKE-GIT-COMMIT'; exit 0\n");
      await chmod(fakeBin, 0o755);

      const alwaysPass = async (): Promise<VerifyReport> => ({
        platform: "test", repo: "test", identity: "test",
        ok: true, checks: [], inboxItems: [],
      });

      const commitAdapter = makeCommitAdapter({ gitBin: fakeBin, verifySetup: alwaysPass });

      const resultId = await commitAdapter.submit({
        cwd: dir,
        message: "test commit",
      });

      const pollResult = await commitAdapter.poll_status(resultId) as { status: string };
      assert.equal(
        pollResult.status,
        "done",
        "commit poll_status must be done when gitBin fake-binary exits 0",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (q) B2: branch adapter must reject flag-like ref before git is invoked
  //
  // Story 000 AC: "every Core-supplied ref is validated
  // (git check-ref-format --branch + allowlist) before use."
  // Reviewer B2: branch/push submit paths pass refs directly to git.
  // -------------------------------------------------------------------------
  test("makeBranchAdapter rejects a flag-like branch name without invoking git", async () => {
    const branchAdapter = makeBranchAdapter({ gitBin: "git", verifySetup: alwaysPassVerifySetup });

    // Flag-like branch name: starts with "-" — must be rejected as invalid ref.
    // cwd /nonexistent ensures any git invocation would produce a different error path.
    const result = await branchAdapter.submit({
      cwd: "/nonexistent",
      branch: "--inject-flag",
      startPoint: "HEAD",
    }) as { status: string; error?: { message?: string; stderr?: string } };

    assert.equal(
      result.status,
      "failed",
      "branch submit with a flag-like name must return failed (invalid ref rejected before git)",
    );
    // The error payload must mention the invalid ref so the caller can diagnose
    const errorStr = JSON.stringify(result.error ?? "");
    assert.ok(
      errorStr.includes("--inject-flag") || errorStr.includes("invalid ref"),
      `error payload must name the invalid ref or say 'invalid ref'; got: ${errorStr}`,
    );
  });
});
