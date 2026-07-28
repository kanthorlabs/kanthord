// src/repository-probe/git.test.ts — EPIC 014 Story 4
// Hermetic unit tests for `GitRepositoryProbe`. The `run` function is
// injected (no real `git`, no real `execFile`); every assertion is on the
// `args`/`opts` passed to `run` and on the returned `RepositoryProbeResult`.
//
// Contract pinned by the EPIC and the Story 4 spec:
//   - `ls-remote --heads <remoteUrl> refs/heads/<branch>` (no `cwd`).
//   - `opts.timeout === REPOSITORY_PROBE_TIMEOUT_MS` on every call.
//   - A reachable remote whose branch is present → `status: "ok"`, detail
//     names the ref.
//   - A reachable remote whose branch is absent → `status: "failed"`, detail
//     names the branch.
//   - A failing `run` (stderr / killed / signal / message) → `status: "failed"`,
//     detail is the redacted first line, truncated to 300 characters.
//   - A timeout (killed/signal) is reported as `timed out`, not the raw
//     message.
//   - The resolved credential value never reaches `detail`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { GitRepositoryProbe } from "./git.ts";
import {
  REPOSITORY_PROBE_TIMEOUT_MS,
  type RepositoryProbeInput,
  type RepositoryProbeResult,
} from "./port.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

interface RunCall {
  args: string[];
  opts: { env: Record<string, string>; timeout: number };
}

interface FakeRun {
  fn: (
    args: string[],
    opts: RunCall["opts"],
  ) => Promise<{
    stdout: string;
    stderr: string;
  }>;
  calls: RunCall[];
}

function makeFakeRun(fn: FakeRun["fn"]): FakeRun["fn"] & { calls: RunCall[] } {
  const calls: RunCall[] = [];
  const wrapped = async (
    args: string[],
    opts: RunCall["opts"],
  ): Promise<{ stdout: string; stderr: string }> => {
    calls.push({ args, opts });
    return fn(args, opts);
  };
  Object.defineProperty(wrapped, "calls", { value: calls, enumerable: true });
  return wrapped as FakeRun["fn"] & { calls: RunCall[] };
}

function ambientInput(
  branch = "main",
  remoteUrl = "https://example.com/repo.git",
): RepositoryProbeInput {
  return { remoteUrl, branch, auth: { kind: "ambient" } };
}

// ── call shape: `ls-remote --heads <url> refs/heads/<branch>`, with timeout, no cwd ─

test("GitRepositoryProbe invokes `run` exactly once with ls-remote --heads <url> refs/heads/<branch> and timeout = REPOSITORY_PROBE_TIMEOUT_MS, with no cwd key on opts", async () => {
  const run = makeFakeRun(async () => ({
    stdout: "abc123\trefs/heads/main\n",
    stderr: "",
  }));
  const probe = new GitRepositoryProbe(undefined, run);

  await probe.probe(ambientInput("main", "https://example.com/repo.git"));

  assert.equal(run.calls.length, 1, "run must be called exactly once");
  const call = run.calls[0]!;
  assert.deepEqual(call.args, [
    "ls-remote",
    "--heads",
    "https://example.com/repo.git",
    "refs/heads/main",
  ]);
  assert.equal(
    call.opts.timeout,
    REPOSITORY_PROBE_TIMEOUT_MS,
    "every probe invocation must carry REPOSITORY_PROBE_TIMEOUT_MS",
  );
  assert.ok(
    !("cwd" in call.opts),
    `opts must not carry a cwd key (the repository --path may not exist); got keys: ${Object.keys(call.opts).join(",")}`,
  );
});

// ── happy path: branch present → ok ─────────────────────────────────────────

test("GitRepositoryProbe returns status:ok when stdout contains refs/heads/<branch>", async () => {
  const run = makeFakeRun(async () => ({
    stdout: "0123456789abcdef0123456789abcdef01234567\trefs/heads/main\n",
    stderr: "",
  }));
  const probe = new GitRepositoryProbe(undefined, run);

  const result = await probe.probe(
    ambientInput("main", "https://example.com/repo.git"),
  );

  assert.equal(result.status, "ok");
  assert.ok(
    result.detail.includes("refs/heads/main"),
    `ok detail should name the ref; got: ${result.detail}`,
  );
});

// ── branch absent on a reachable remote → failed with the branch name in detail

test("GitRepositoryProbe returns status:failed and a detail that names the branch when stdout is empty (remote answered, branch absent)", async () => {
  const run = makeFakeRun(async () => ({ stdout: "", stderr: "" }));
  const probe = new GitRepositoryProbe(undefined, run);

  const result: RepositoryProbeResult = await probe.probe(
    ambientInput("nope", "https://example.com/repo.git"),
  );

  assert.equal(result.status, "failed");
  assert.ok(
    result.detail.includes("nope"),
    `failed detail must contain the branch name verbatim; got: ${result.detail}`,
  );
});

// ── run rejection with stderr → failed with the redacted first line, trimmed ─

test("GitRepositoryProbe returns status:failed and detail === first line of stderr (trimmed) when run rejects with a stderr payload", async () => {
  const run = makeFakeRun(async () => {
    const err = new Error("Command failed: git ls-remote") as Error & {
      stderr: string;
    };
    err.stderr = "fatal: repository not found\n";
    throw err;
  });
  const probe = new GitRepositoryProbe(undefined, run);

  const result = await probe.probe(
    ambientInput("main", "https://example.com/missing.git"),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.detail, "fatal: repository not found");
});

// ── run rejection by timeout (killed / SIGTERM) → failed with "timed out" ──

test("GitRepositoryProbe returns status:failed and detail containing 'timed out' when run rejects with killed: true", async () => {
  const run = makeFakeRun(async () => {
    const err = new Error("Command failed: timeout") as Error & {
      killed: true;
      signal: string;
      stderr: string;
    };
    err.killed = true;
    err.signal = "SIGTERM";
    err.stderr = "some long partial stderr we never want to surface\n";
    throw err;
  });
  const probe = new GitRepositoryProbe(undefined, run);

  const result = await probe.probe(
    ambientInput("main", "https://example.com/slow.git"),
  );

  assert.equal(result.status, "failed");
  assert.ok(
    result.detail.includes("timed out"),
    `timeout detail must say 'timed out'; got: ${result.detail}`,
  );
  assert.ok(
    !result.detail.includes("partial stderr"),
    `timeout detail must not surface the raw stderr; got: ${result.detail}`,
  );
});

// ── credential redaction: the resolved token value never reaches detail ────

test("GitRepositoryProbe with https-token auth and a resolveCredential returning 'sk-secret' redacts the secret out of the failed detail", async () => {
  const run = makeFakeRun(async () => {
    const err = new Error("Command failed: git ls-remote") as Error & {
      stderr: string;
    };
    err.stderr = "fatal: authentication failed for sk-secret\n";
    throw err;
  });
  const resolveCredential = async (_id: string): Promise<string> => "sk-secret";
  const probe = new GitRepositoryProbe(resolveCredential, run);

  const result = await probe.probe({
    remoteUrl: "https://example.com/private.git",
    branch: "main",
    auth: { kind: "https-token", credentialId: "cred-1" },
  });

  assert.equal(result.status, "failed");
  assert.ok(
    !result.detail.includes("sk-secret"),
    `detail must not contain the raw credential value; got: ${result.detail}`,
  );
  assert.ok(
    result.detail.includes("***"),
    `detail must contain the redaction marker ***; got: ${result.detail}`,
  );
});

// ── a throwing resolveCredential is `failed`, never a rejection ─────────────
// `buildGitEnv` resolves the credential, so a dangling / wrong-typed reference
// makes it throw BEFORE any git process starts. `probe` must still resolve with
// `status: "failed"`: `CheckProject` has no catch, so a rejection here replaces
// the whole readiness report with a stack trace.

test("GitRepositoryProbe returns status:failed (never rejects) when resolveCredential throws for a dangling credential", async () => {
  const run = makeFakeRun(async () => {
    throw new Error("run must not be reached when the credential is dangling");
  });
  const resolveCredential = async (id: string): Promise<string> => {
    throw new Error(`no credential resource found for id: ${id}`);
  };
  const probe = new GitRepositoryProbe(resolveCredential, run);

  const result = await probe.probe({
    remoteUrl: "https://example.com/private.git",
    branch: "main",
    auth: { kind: "https-token", credentialId: "cred-missing" },
  });

  assert.equal(result.status, "failed");
  assert.ok(
    result.detail.includes("cred-missing"),
    `detail should name the unresolvable credential; got: ${result.detail}`,
  );
  assert.equal(run.calls.length, 0, "no git process may be spawned");
});

test("GitRepositoryProbe resolves the credential exactly once per probe", async () => {
  const run = makeFakeRun(async () => ({
    stdout: "abc123\trefs/heads/main\n",
    stderr: "",
  }));
  let resolveCalls = 0;
  const resolveCredential = async (_id: string): Promise<string> => {
    resolveCalls++;
    return "sk-secret";
  };
  const probe = new GitRepositoryProbe(resolveCredential, run);

  const result = await probe.probe({
    remoteUrl: "https://example.com/private.git",
    branch: "main",
    auth: { kind: "https-token", credentialId: "cred-1" },
  });

  assert.equal(result.status, "ok");
  assert.equal(resolveCalls, 1);
});

// ── detail length cap: a 5000-character stderr is truncated to <= 300 chars ─

test("GitRepositoryProbe truncates a 5000-character stderr to at most 300 characters", async () => {
  const longStderr = "x".repeat(5_000) + "\n";
  const run = makeFakeRun(async () => {
    const err = new Error("Command failed: git ls-remote") as Error & {
      stderr: string;
    };
    err.stderr = longStderr;
    throw err;
  });
  const probe = new GitRepositoryProbe(undefined, run);

  const result = await probe.probe(
    ambientInput("main", "https://example.com/repo.git"),
  );

  assert.equal(result.status, "failed");
  assert.ok(
    result.detail.length <= 300,
    `detail must be truncated to <= 300 chars; got length ${result.detail.length}`,
  );
});
