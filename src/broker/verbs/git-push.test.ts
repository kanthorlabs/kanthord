/**
 * Story 002 / Task T1 — git.push adapter + idempotent re-push
 * Story 002 / Task T2 — reconcile against remote ref + scan inheritance
 *
 * Tests:
 *  (a) push lands branch at sha on bare remote, records {branch, sha}
 *      correlation in ledger, completion row is "done"
 *  (b) re-submit with same idempotency key resolves done, remote unchanged
 *      (no double-push error)
 *  (c) non-fast-forward push resolves failed naming the branch
 *  (d) missing idempotency key is rejected (Epic 005 rule: idempotency required)
 *  (e) reconcile: ref at desired sha returns done (full {remote_url,branch,sha} key)
 *  (f) reconcile: ref absent returns resubmit
 *  (g) reconcile: ref at a different sha returns escalate
 *  (h) reconcile: same branch on a different remote does NOT reconcile as done
 *  (i) seeded secret in payload metadata is blocked by OutboundScanGuard before submit
 *  (j) seeded secret in a committed file's diff blocks push before submit (diff-content scan)
 *  (k) B1: verifySetup failing check prevents git.push submit
 *  (l) B4: diff scan uses input.remote as base, not hard-coded origin
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { openStore } from "../../foundations/sqlite-store.ts";
import { FakeClock } from "../../foundations/clock.ts";
import { registerVerb } from "../registry.ts";
import { submit } from "../submit.ts";
import { startPolling } from "../poller.ts";
import { makePushAdapter } from "./git-push.ts";
import { makeOutboundScanGuard } from "../../ring1/outbound-scan-guard.ts";
import type { PatternRegistry } from "../../ring1/secret-scan.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

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
  execSync(
    `git -C "${workDir}" config user.email "test@example.com" && git -C "${workDir}" config user.name "Test"`,
    { stdio: "pipe", shell: "/bin/sh" },
  );
  execSync(
    `git -C "${workDir}" commit --allow-empty -m "init"`,
    { stdio: "pipe" },
  );
  execSync(`git -C "${workDir}" push origin HEAD`, { stdio: "pipe" });
  return workDir;
}

/** Build a git.push VerbRegistryEntry (idempotency required). */
function makePushEntry() {
  return {
    verb: "git.push",
    tier: "auto" as const,
    timeout: 30000,
    idempotency: { window_ms: 3600000 }, // non-zero → key is required
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 50,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 0 },
    observed_state_can_regress: false,
  };
}

/** Passing verifySetup fixture — required by every submit test since verifySetup is unconditional. */
const alwaysPass = async (): Promise<VerifyReport> => ({
  platform: "test",
  repo: "test",
  identity: "test",
  ok: true,
  checks: [],
  inboxItems: [],
});

describe("src/broker/verbs/git-push.ts", () => {
  // -------------------------------------------------------------------------
  // (a) Push lands branch at sha, records correlation, completion row is done
  // -------------------------------------------------------------------------
  test("push lands branch at sha on bare remote and records correlation in ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-a-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Create a feature branch and a commit to push
      execSync(`git -C "${workDir}" checkout -b feature/push-t1`, { stdio: "pipe" });
      await writeFile(join(workDir, "pushed.txt"), "content");
      execSync(`git -C "${workDir}" add pushed.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "push me"`, { stdio: "pipe" });
      const expectedSha = execSync(
        `git -C "${workDir}" rev-parse HEAD`,
        { encoding: "utf8" },
      ).trim();

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const pushEntry = makePushEntry();
      const pushAdapter = makePushAdapter({ gitBin: "git", verifySetup: alwaysPass });
      registerVerb(pushEntry, pushAdapter);

      const opId = await submit(
        pushEntry,
        pushAdapter,
        { cwd: workDir, branch: "feature/push-t1", remote: "origin" },
        "idem-push-a-001",
        store,
      );
      assert.ok(typeof opId === "string", "push op_id is a string");

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "push op must be in-flight in store");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        pushEntry,
        pushAdapter,
        store,
        clock,
      );
      clock.advance(pushEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const completion = store.get<CompletionRow>(
        "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(completion !== undefined, "push completion row must exist");
      assert.equal(completion.status, "done", "push op completes as done");

      // Verify the remote has the branch at the expected sha
      const remoteRef = execSync(
        `git -C "${bareDir}" rev-parse refs/heads/feature/push-t1`,
        { encoding: "utf8" },
      ).trim();
      assert.equal(remoteRef, expectedSha, "remote ref must equal the pushed sha");

      // The completion result_json must carry correlation {branch, sha}
      assert.ok(
        completion.result_json !== null,
        "done completion must carry result_json with correlation",
      );
      const result = JSON.parse(completion.result_json) as { branch?: string; sha?: string; remote_url?: string };
      assert.equal(result.branch, "feature/push-t1", "correlation.branch must match");
      assert.equal(result.sha, expectedSha, "correlation.sha must match");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (b) Re-submit same idempotency key → same op_id, remote unchanged
  // -------------------------------------------------------------------------
  test("re-submitting same idempotency key resolves done and remote is unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-b-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      execSync(`git -C "${workDir}" checkout -b feature/push-idem`, { stdio: "pipe" });
      await writeFile(join(workDir, "idem.txt"), "content");
      execSync(`git -C "${workDir}" add idem.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "idempotent push"`, { stdio: "pipe" });
      const expectedSha = execSync(
        `git -C "${workDir}" rev-parse HEAD`,
        { encoding: "utf8" },
      ).trim();

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const pushEntry = makePushEntry();
      const pushAdapter = makePushAdapter({ gitBin: "git", verifySetup: alwaysPass });
      registerVerb(pushEntry, pushAdapter);

      const input = { cwd: workDir, branch: "feature/push-idem", remote: "origin" };
      const opId1 = await submit(pushEntry, pushAdapter, input, "idem-push-b-001", store);

      // First push — poll to completion
      const op1 = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId1,
      );
      assert.ok(op1 !== undefined, "first push op must be in-flight");
      startPolling(
        { op_id: op1.op_id, verb: op1.verb, request_id: op1.request_id, status: "in_flight" },
        pushEntry,
        pushAdapter,
        store,
        clock,
      );
      clock.advance(pushEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const comp1 = store.get<CompletionRow>(
        "SELECT status FROM broker_completion WHERE op_id = ?",
        opId1,
      );
      assert.equal(comp1?.status, "done", "first push must complete as done");

      // Re-submit with the same idempotency key — must return same op_id
      const opId2 = await submit(pushEntry, pushAdapter, input, "idem-push-b-001", store);
      assert.equal(opId2, opId1, "re-submit with same key must return the same op_id");

      // Remote must still be at expectedSha (no double-push)
      const remoteRef = execSync(
        `git -C "${bareDir}" rev-parse refs/heads/feature/push-idem`,
        { encoding: "utf8" },
      ).trim();
      assert.equal(remoteRef, expectedSha, "remote ref must be unchanged after idempotent re-submit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (c) Non-fast-forward push resolves failed naming the branch
  // -------------------------------------------------------------------------
  test("non-fast-forward push resolves failed naming the branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-c-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Push an initial commit to feature/nff from a second clone
      const clone2Dir = join(dir, "clone2");
      execSync(`git clone "${bareDir}" "${clone2Dir}"`, { stdio: "pipe" });
      execSync(
        `git -C "${clone2Dir}" config user.email "c2@example.com" && git -C "${clone2Dir}" config user.name "C2"`,
        { stdio: "pipe", shell: "/bin/sh" },
      );
      execSync(`git -C "${clone2Dir}" checkout -b feature/nff`, { stdio: "pipe" });
      await writeFile(join(clone2Dir, "nff.txt"), "first");
      execSync(`git -C "${clone2Dir}" add nff.txt`, { stdio: "pipe" });
      execSync(`git -C "${clone2Dir}" commit -m "first on nff"`, { stdio: "pipe" });
      execSync(`git -C "${clone2Dir}" push origin feature/nff`, { stdio: "pipe" });

      // Now workDir creates a divergent branch with the same name
      execSync(`git -C "${workDir}" checkout -b feature/nff`, { stdio: "pipe" });
      await writeFile(join(workDir, "local-nff.txt"), "divergent");
      execSync(`git -C "${workDir}" add local-nff.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "divergent on nff"`, { stdio: "pipe" });

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const pushEntry = makePushEntry();
      const pushAdapter = makePushAdapter({ gitBin: "git", verifySetup: alwaysPass });
      registerVerb(pushEntry, pushAdapter);

      const opId = await submit(
        pushEntry,
        pushAdapter,
        { cwd: workDir, branch: "feature/nff", remote: "origin" },
        "idem-push-c-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "nff push op must be in-flight");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        pushEntry,
        pushAdapter,
        store,
        clock,
      );
      clock.advance(pushEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const completion = store.get<CompletionRow>(
        "SELECT op_id, status, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(completion !== undefined, "nff push completion row must exist");
      assert.equal(completion.status, "failed", "non-fast-forward push must resolve failed");

      // The error_json must name the branch
      assert.ok(
        completion.error_json !== null,
        "failed push must carry error_json",
      );
      const errorObj = JSON.parse(completion.error_json) as { branch?: string; stderr?: string };
      assert.ok(
        errorObj.branch === "feature/nff" || (typeof errorObj.stderr === "string" && errorObj.stderr.includes("feature/nff")),
        "error must name the failed branch",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (d) Missing idempotency key is rejected
  // -------------------------------------------------------------------------
  test("missing idempotency key is rejected for git.push", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-d-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const pushEntry = makePushEntry();
      const pushAdapter = makePushAdapter({ gitBin: "git" });
      registerVerb(pushEntry, pushAdapter);

      await assert.rejects(
        () => submit(
          pushEntry,
          pushAdapter,
          { cwd: workDir, branch: "main", remote: "origin" },
          "", // empty key with non-zero window_ms → must reject
          store,
        ),
        (err: Error) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes("idempotency key is required") ||
            err.message.includes("idempotency"),
            `error message must mention idempotency, got: ${err.message}`,
          );
          return true;
        },
        "submit with empty idempotency key must reject",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Story 002 / Task T2 — reconcile by full correlation + scan inheritance
  // =========================================================================

  // -------------------------------------------------------------------------
  // (e) reconcile: ref at desired sha → done
  // -------------------------------------------------------------------------
  test("reconcile resolves done when remote ref equals desired sha", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-e-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Create and push a branch so the remote has it
      execSync(`git -C "${workDir}" checkout -b feature/reconcile-done`, { stdio: "pipe" });
      await writeFile(join(workDir, "rec.txt"), "reconcile");
      execSync(`git -C "${workDir}" add rec.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "reconcile"`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" push origin feature/reconcile-done`, { stdio: "pipe" });
      const headSha = execSync(`git -C "${workDir}" rev-parse HEAD`, { encoding: "utf8" }).trim();
      const remoteUrl = execSync(`git -C "${workDir}" remote get-url origin`, { encoding: "utf8" }).trim();

      const pushAdapter = makePushAdapter({ gitBin: "git" });

      // Reconcile with the full correlation — remote ref at desired sha → done
      const result = await pushAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/reconcile-done", remote: "origin" },
        correlation: { remote_url: remoteUrl, branch: "feature/reconcile-done", sha: headSha },
      }) as { status: string };

      assert.equal(result.status, "done", "reconcile with matching sha must return done");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (f) reconcile: ref absent → resubmit
  // -------------------------------------------------------------------------
  test("reconcile resolves resubmit when remote ref is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-f-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);
      const remoteUrl = execSync(`git -C "${workDir}" remote get-url origin`, { encoding: "utf8" }).trim();

      const pushAdapter = makePushAdapter({ gitBin: "git" });

      // Reconcile for a branch that was never pushed
      const result = await pushAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/never-pushed", remote: "origin" },
        correlation: { remote_url: remoteUrl, branch: "feature/never-pushed", sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
      }) as { status: string };

      assert.equal(result.status, "resubmit", "reconcile with absent ref must return resubmit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (g) reconcile: ref at a different sha → escalate
  // -------------------------------------------------------------------------
  test("reconcile resolves escalate when remote ref is at a different sha", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-g-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Push a commit to the remote
      execSync(`git -C "${workDir}" checkout -b feature/moved`, { stdio: "pipe" });
      await writeFile(join(workDir, "first.txt"), "first");
      execSync(`git -C "${workDir}" add first.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "first"`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" push origin feature/moved`, { stdio: "pipe" });
      const remoteUrl = execSync(`git -C "${workDir}" remote get-url origin`, { encoding: "utf8" }).trim();

      const pushAdapter = makePushAdapter({ gitBin: "git" });

      // Reconcile with a stale desired sha (old commit) — remote has moved
      const staleSha = "0000000000000000000000000000000000000001";
      const result = await pushAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/moved", remote: "origin" },
        correlation: { remote_url: remoteUrl, branch: "feature/moved", sha: staleSha },
      }) as { status: string };

      assert.equal(result.status, "escalate", "reconcile with diverged sha must return escalate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (h) reconcile: same branch on a DIFFERENT remote does not resolve done
  // -------------------------------------------------------------------------
  test("reconcile does not resolve done for the same branch on a different remote", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-h-"));
    try {
      const bare1Dir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bare1Dir);

      // Push to remote1
      execSync(`git -C "${workDir}" checkout -b feature/multi-remote`, { stdio: "pipe" });
      await writeFile(join(workDir, "multi.txt"), "multi");
      execSync(`git -C "${workDir}" add multi.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "multi"`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" push origin feature/multi-remote`, { stdio: "pipe" });
      const headSha = execSync(`git -C "${workDir}" rev-parse HEAD`, { encoding: "utf8" }).trim();

      // Second bare (different remote)
      const bare2Dir = join(dir, "remote2.git");
      execSync(`git init --bare "${bare2Dir}"`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" remote add origin2 "${bare2Dir}"`, { stdio: "pipe" });

      const pushAdapter = makePushAdapter({ gitBin: "git" });

      // Correlation says remote1 URL, but we ask reconcile using remote2 as cwd remote
      // The correlation.remote_url for remote1 — ref is present on remote1 but not remote2
      // Reconcile must use correlation.remote_url (remote1 path), NOT input.remote
      const remote1Url = execSync(`git -C "${workDir}" remote get-url origin`, { encoding: "utf8" }).trim();

      // Reconcile against the correct remote1 URL → done
      const resultCorrect = await pushAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/multi-remote", remote: "origin" },
        correlation: { remote_url: remote1Url, branch: "feature/multi-remote", sha: headSha },
      }) as { status: string };
      assert.equal(resultCorrect.status, "done", "reconcile with correct remote must return done");

      // Reconcile against remote2 URL (different remote, no branch there) → resubmit or escalate, NOT done
      const remote2Url = execSync(`git -C "${workDir}" remote get-url origin2`, { encoding: "utf8" }).trim();
      const resultWrong = await pushAdapter.reconcile({
        input: { cwd: workDir, branch: "feature/multi-remote", remote: "origin2" },
        correlation: { remote_url: remote2Url, branch: "feature/multi-remote", sha: headSha },
      }) as { status: string };
      assert.notEqual(resultWrong.status, "done", "reconcile against a different remote must NOT return done");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (i) seeded secret in payload metadata is blocked by OutboundScanGuard
  // -------------------------------------------------------------------------
  test("seeded secret in payload metadata is blocked by OutboundScanGuard before submit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-i-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Build a registry that matches a fake secret pattern
      const fakeRegistry: PatternRegistry = {
        version: "1",
        patterns: [
          { name: "fake-secret", regex: "FAKE_SECRET_TOKEN_12345" },
        ],
      };
      const escalations: string[] = [];
      const guard = makeOutboundScanGuard({
        registry: fakeRegistry,
        onEscalate: (e) => { escalations.push(e.tag); },
      });

      // Payload metadata containing the secret pattern
      const taintedPayload = JSON.stringify({
        cwd: workDir,
        branch: "main",
        remote: "origin",
        note: "FAKE_SECRET_TOKEN_12345",
      });

      let submitCalled = false;
      const result = await guard.guardedSubmit({
        verb: "git.push",
        taskId: "task-i-001",
        serializedPayload: taintedPayload,
        submit: async () => { submitCalled = true; },
      });

      assert.equal(result.status, "blocked", "payload with secret must be blocked");
      assert.ok(!submitCalled, "submit must not be called when scan blocks");
      assert.ok(escalations.length > 0, "escalation must be emitted");
      assert.equal(escalations[0], "scan-blocked");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (j) seeded secret in committed file's diff blocks push before submit
  // -------------------------------------------------------------------------
  test("seeded secret in a committed file diff blocks push before submit via diff scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-j-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      // Commit a file containing a secret pattern to a feature branch
      execSync(`git -C "${workDir}" checkout -b feature/secret-in-diff`, { stdio: "pipe" });
      await writeFile(join(workDir, "secret.txt"), "FAKE_SECRET_TOKEN_12345\n");
      execSync(`git -C "${workDir}" add secret.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "secret file"`, { stdio: "pipe" });

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const pushEntry = makePushEntry();

      // Build a registry matching the secret pattern
      const fakeRegistry: PatternRegistry = {
        version: "1",
        patterns: [
          { name: "fake-secret", regex: "FAKE_SECRET_TOKEN_12345" },
        ],
      };
      const escalations: string[] = [];
      const guard = makeOutboundScanGuard({
        registry: fakeRegistry,
        onEscalate: (e) => { escalations.push(e.tag); },
      });

      // makePushAdapter must accept a diffScanGuard option so the diff content
      // is scanned before the push is submitted. This is the seam T2 introduces.
      const pushAdapter = makePushAdapter({
        gitBin: "git",
        diffScanGuard: guard,
        verifySetup: alwaysPass,
      });
      registerVerb(pushEntry, pushAdapter);

      const opId = await submit(
        pushEntry,
        pushAdapter,
        { cwd: workDir, branch: "feature/secret-in-diff", remote: "origin" },
        "idem-push-j-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        pushEntry,
        pushAdapter,
        store,
        clock,
      );
      clock.advance(pushEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const completion = store.get<CompletionRow>(
        "SELECT op_id, status, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(completion !== undefined, "completion row must exist after scan-blocked push");
      assert.equal(completion.status, "failed", "push blocked by diff scan must complete as failed");

      // The remote must NOT have received the secret branch
      let remoteHasBranch = true;
      try {
        execSync(`git -C "${bareDir}" rev-parse refs/heads/feature/secret-in-diff`, { stdio: "pipe" });
      } catch {
        remoteHasBranch = false;
      }
      assert.ok(!remoteHasBranch, "remote must not have the secret branch after scan block");

      assert.ok(escalations.length > 0, "escalation must be emitted for diff scan block");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (l) B4: diff scan must use input.remote as base, not hard-coded origin
  // -------------------------------------------------------------------------
  test("diff scan uses input.remote base so push to non-origin remote is blocked when diff contains secret", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-l-"));
    try {
      // Set up two bare remotes: originBare (will hold the branch already)
      // and upstreamBare (push target — branch does NOT exist there yet).
      const originBare = initBareRepo(dir);
      const upstreamBare = join(dir, "upstream.git");
      execSync(`git init --bare "${upstreamBare}"`, { stdio: "pipe" });

      const workDir = initWorkRepo(dir, originBare);

      // Add 'upstream' remote pointing to upstreamBare
      execSync(`git -C "${workDir}" remote add upstream "${upstreamBare}"`, { stdio: "pipe" });

      // Create branch feature/b4-secret, commit a secret file
      execSync(`git -C "${workDir}" checkout -b feature/b4-secret`, { stdio: "pipe" });
      await writeFile(join(workDir, "secret.txt"), "FAKE_SECRET_TOKEN_12345\n");
      execSync(`git -C "${workDir}" add secret.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "add secret file"`, { stdio: "pipe" });

      // Push the branch to ORIGIN so origin/feature/b4-secret exists and is
      // up-to-date with HEAD.  The diff origin/feature/b4-secret..HEAD is
      // therefore EMPTY — origin is benign from the scan perspective.
      execSync(`git -C "${workDir}" push origin feature/b4-secret`, { stdio: "pipe" });

      // Confirm: diff from origin ref is empty (origin is up-to-date)
      const diffOut = execSync(
        `git -C "${workDir}" diff origin/feature/b4-secret..HEAD`,
        { stdio: "pipe" },
      ).toString();
      assert.equal(diffOut.trim(), "", "origin diff must be empty — origin is up-to-date");

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const pushEntry = makePushEntry();

      const fakeRegistry: PatternRegistry = {
        version: "1",
        patterns: [
          { name: "fake-secret", regex: "FAKE_SECRET_TOKEN_12345" },
        ],
      };
      const escalations: string[] = [];
      const guard = makeOutboundScanGuard({
        registry: fakeRegistry,
        onEscalate: (e) => { escalations.push(e.tag); },
      });

      // Push target is 'upstream', NOT 'origin'.
      // The adapter must base the diff on upstream/feature/b4-secret (absent →
      // falls back to git log -p HEAD which contains the secret).
      // With the bug (hard-coded origin), origin diff is empty → push proceeds.
      const pushAdapter = makePushAdapter({
        gitBin: "git",
        diffScanGuard: guard,
        verifySetup: alwaysPass,
      });
      registerVerb(pushEntry, pushAdapter);

      const opId = await submit(
        pushEntry,
        pushAdapter,
        { cwd: workDir, branch: "feature/b4-secret", remote: "upstream" },
        "idem-push-l-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        pushEntry,
        pushAdapter,
        store,
        clock,
      );
      clock.advance(pushEntry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const completion = store.get<CompletionRow>(
        "SELECT op_id, status, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(completion !== undefined, "completion row must exist after scan-blocked push");
      assert.equal(
        completion.status,
        "failed",
        "push to non-origin remote must be blocked when diff vs that remote contains a secret",
      );

      // The upstream remote must NOT have received the branch
      let upstreamHasBranch = true;
      try {
        execSync(`git -C "${upstreamBare}" rev-parse refs/heads/feature/b4-secret`, { stdio: "pipe" });
      } catch {
        upstreamHasBranch = false;
      }
      assert.ok(!upstreamHasBranch, "upstream remote must not have the secret branch after scan block");

      assert.ok(escalations.length > 0, "escalation must be emitted for diff scan block");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (k) B1: verifySetup failing check prevents git.push submit
  // -------------------------------------------------------------------------
  test("verifySetup failing check prevents git.push submit and emits blocked-needs-setup", async () => {
    const failingReport: VerifyReport = {
      platform: "github",
      repo: "owner/repo",
      identity: "test-identity",
      ok: false,
      checks: [
        {
          name: "token-scope",
          ok: false,
          detail: "PAT missing required scopes: repo",
          remediation: "Re-generate the PAT with repo scope.",
        },
      ],
      inboxItems: [
        {
          kind: "system:setup",
          message: "Setup required for repo owner/repo (identity: test-identity): token-scope",
          details: "PAT missing required scopes: repo",
          remediation: "Re-generate the PAT with repo scope.",
        },
      ],
    };

    const fakePreflight = async () => failingReport;

    // pushAdapter with verifySetup injected — no diffScanGuard needed
    const pushAdapter = makePushAdapter({
      gitBin: "git",
      verifySetup: fakePreflight,
    });

    // submit with a non-existent cwd — if git runs it would error, not block
    const result = await pushAdapter.submit({
      cwd: "/nonexistent",
      branch: "feature/blocked-push",
      remote: "origin",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "git.push submit must return blocked-needs-setup when verifySetup fails",
    );
    assert.ok(
      Array.isArray(result.inboxItems) && result.inboxItems.length > 0,
      "blocked-needs-setup result must carry inboxItems",
    );
  });

  // -------------------------------------------------------------------------
  // (m) B1: absent verifySetup blocks git.push submit (gate must not be optional)
  //
  // Epic §58: "every mutating verb is gated by the read-only verifySetup
  // preflight". An adapter constructed WITHOUT verifySetup must not proceed
  // to submit — it must return blocked-needs-setup.
  // -------------------------------------------------------------------------
  test("omitting verifySetup blocks git.push submit (verifySetup must not be optional)", async () => {
    // No verifySetup provided — the gate must fire unconditionally
    const pushAdapter = makePushAdapter({ gitBin: "git" });

    const result = await pushAdapter.submit({
      cwd: "/nonexistent",
      branch: "feature/no-setup",
      remote: "origin",
    }) as { status: string };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "git.push submit without verifySetup must return blocked-needs-setup (Epic §58)",
    );
  });

  // -------------------------------------------------------------------------
  // (n) B2: flag-like branch name is rejected before git is invoked
  //
  // Story 000 AC: every Core-supplied ref is validated before use.
  // Reviewer B2: push submit path passes refs directly to git without validation.
  // -------------------------------------------------------------------------
  test("git.push submit rejects a flag-like branch name without invoking git", async () => {
    const alwaysPass = async (): Promise<VerifyReport> => ({
      platform: "test",
      repo: "test",
      identity: "test",
      ok: true,
      checks: [],
      inboxItems: [],
    });

    const pushAdapter = makePushAdapter({ gitBin: "git", verifySetup: alwaysPass });

    // Flag-like branch name: starts with "-" — must be rejected as invalid ref.
    // cwd /nonexistent ensures any git invocation would produce a different failure.
    const result = await pushAdapter.submit({
      cwd: "/nonexistent",
      branch: "--flag-inject",
      remote: "origin",
    }) as { status: string; error?: { message?: string; stderr?: string } };

    assert.equal(
      result.status,
      "failed",
      "git.push submit with flag-like branch must return failed (invalid ref rejected before git)",
    );
    const errorStr = JSON.stringify(result.error ?? "");
    assert.ok(
      errorStr.includes("--flag-inject") || errorStr.includes("invalid ref"),
      `error payload must name the invalid ref or say 'invalid ref'; got: ${errorStr}`,
    );
  });

  // -------------------------------------------------------------------------
  // (o) S1: gitBin is passed through to runGit so fake binary is honoured
  //
  // Reviewer S1: runGit supports injected gitBin but push adapter omits it.
  // We inject a gitBin path that does NOT exist on the filesystem.
  // When gitBin IS forwarded, runGit gets ENOENT → classifies as failed.
  // When gitBin is NOT forwarded (current bug), runGit defaults to system "git"
  // → push succeeds → poll_status returns done.
  // So: test asserts poll_status !== "done"; RED fails because current impl returns done.
  // -------------------------------------------------------------------------
  test("makePushAdapter passes gitBin to runGit so injected nonexistent binary is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-push-o-"));
    try {
      const bareDir = initBareRepo(dir);
      const workDir = initWorkRepo(dir, bareDir);

      execSync(`git -C "${workDir}" checkout -b feature/gitbin-push`, { stdio: "pipe" });
      await writeFile(join(workDir, "gitbin.txt"), "content");
      execSync(`git -C "${workDir}" add gitbin.txt`, { stdio: "pipe" });
      execSync(`git -C "${workDir}" commit -m "gitbin pass-through"`, { stdio: "pipe" });

      const alwaysPass = async (): Promise<VerifyReport> => ({
        platform: "test", repo: "test", identity: "test",
        ok: true, checks: [], inboxItems: [],
      });

      // A gitBin path that does not exist — if forwarded, runGit gets ENOENT
      // and classifies the result as failed/retryable (never "done").
      // If NOT forwarded, system "git" runs and push succeeds → poll_status "done".
      const nonexistentBin = join(dir, "no-such-git-binary");

      const pushAdapter = makePushAdapter({ gitBin: nonexistentBin, verifySetup: alwaysPass });

      const requestId = await pushAdapter.submit({
        cwd: workDir,
        branch: "feature/gitbin-push",
        remote: "origin",
      }) as string;

      const pollResult = await pushAdapter.poll_status(requestId) as { status: string };

      // The nonexistent binary must cause a failure — proving gitBin was forwarded.
      // If the current impl ignores gitBin, system git runs and status === "done".
      assert.notEqual(
        pollResult.status,
        "done",
        "push with nonexistent gitBin must not reach done (gitBin must be forwarded to runGit, not silently ignored)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
