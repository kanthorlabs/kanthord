/**
 * src/git/exec — Git execution seam (Story 000 / Task T1)
 *
 * Covers:
 *  - Exit-code / porcelain classification: nothing-to-commit noop,
 *    push up-to-date idempotent success, non-ff terminal, bad-host retryable
 *  - Ref validation rejects flag-like (`-x`), double-dot (`..`), `@{`
 *  - Child env is allowlisted: no token, no SSH_AUTH_SOCK
 *  - A sleeping child is killed by process group on timeout
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGit,
  validateRef,
  type GitResult,
} from "./exec.ts";

const execFileP = promisify(_execFile);

/** Create a temp dir, init a bare remote, clone it, and return paths. */
async function makeTestRepo(): Promise<{
  dir: string;
  repoPath: string;
  remotePath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-exec-test-"));
  const remotePath = join(dir, "remote.git");
  const repoPath = join(dir, "repo");

  // init bare remote
  await execFileP("git", ["init", "--bare", remotePath]);
  // clone into repoPath
  await execFileP("git", ["clone", remotePath, repoPath]);
  // configure identity for commits (no global config)
  await execFileP("git", ["-C", repoPath, "config", "user.email", "test@example.com"]);
  await execFileP("git", ["-C", repoPath, "config", "user.name", "Test"]);

  // Make an initial commit so the repo is not empty
  await writeFile(join(repoPath, "README.md"), "hello\n");
  await execFileP("git", ["-C", repoPath, "add", "README.md"]);
  await execFileP("git", ["-C", repoPath, "commit", "-m", "init"]);
  await execFileP("git", ["-C", repoPath, "push", "origin", "HEAD"]);

  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, repoPath, remotePath, cleanup };
}

test("src/git/exec — nothing-to-commit classifies as noop (idempotent)", async () => {
  const { repoPath, cleanup } = await makeTestRepo();
  try {
    // No changes staged — commit with nothing should be a noop
    const result = await runGit(["commit", "-m", "empty"], { cwd: repoPath });
    assert.equal(result.kind, "noop", `expected noop, got ${result.kind}`);
  } finally {
    await cleanup();
  }
});

test("src/git/exec — push up-to-date classifies as success (idempotent)", async () => {
  const { repoPath, remotePath, cleanup } = await makeTestRepo();
  try {
    // First push already done in setup. A second push of same branch should be up-to-date.
    const result = await runGit(
      ["push", "--porcelain", "origin", "HEAD"],
      { cwd: repoPath },
    );
    assert.equal(
      result.kind,
      "success",
      `expected success (up-to-date), got ${result.kind}`,
    );
  } finally {
    await cleanup();
  }
});

test("src/git/exec — non-fast-forward push classifies as terminal", async () => {
  const { repoPath, remotePath, dir, cleanup } = await makeTestRepo();
  try {
    // Create a conflicting commit directly on the bare remote to make remote ahead
    const repo2 = join(dir, "repo2");
    await execFileP("git", ["clone", remotePath, repo2]);
    await execFileP("git", ["-C", repo2, "config", "user.email", "test@example.com"]);
    await execFileP("git", ["-C", repo2, "config", "user.name", "Test"]);
    await writeFile(join(repo2, "conflict.txt"), "conflict\n");
    await execFileP("git", ["-C", repo2, "add", "conflict.txt"]);
    await execFileP("git", ["-C", repo2, "commit", "-m", "conflict"]);
    await execFileP("git", ["-C", repo2, "push", "origin", "HEAD"]);

    // Now make a commit in repoPath (diverged) and try to push — should be non-ff
    await writeFile(join(repoPath, "local.txt"), "local\n");
    await execFileP("git", ["-C", repoPath, "add", "local.txt"]);
    await execFileP("git", ["-C", repoPath, "commit", "-m", "local"]);

    const result = await runGit(
      ["push", "--porcelain", "origin", "HEAD"],
      { cwd: repoPath },
    );
    assert.equal(
      result.kind,
      "terminal",
      `expected terminal (non-fast-forward), got ${result.kind}`,
    );
  } finally {
    await cleanup();
  }
});

test("src/git/exec — network failure (ECONNREFUSED) classifies as retryable", async () => {
  // Use a loopback port that is known to refuse connections (port 1 is privileged
  // and always refused on Linux/macOS without root). This exercises the retryable
  // network-error classification without external DNS lookup, staying hermetic.
  const dir = await mkdtemp(join(tmpdir(), "kanthord-exec-retryable-"));
  try {
    await execFileP("git", ["init", dir]);
    await execFileP("git", ["-C", dir, "config", "user.email", "t@t.com"]);
    await execFileP("git", ["-C", dir, "config", "user.name", "T"]);
    const result = await runGit(
      ["ls-remote", "git://127.0.0.1:1/repo.git"],
      { cwd: dir },
    );
    assert.equal(
      result.kind,
      "retryable",
      `expected retryable (connection refused), got ${result.kind}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("src/git/exec — ref validation rejects flag-like -badname", () => {
  assert.throws(
    () => validateRef("-badname"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalid ref/i);
      return true;
    },
  );
});

test("src/git/exec — ref validation rejects double-dot name", () => {
  assert.throws(
    () => validateRef("bad..name"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalid ref/i);
      return true;
    },
  );
});

test("src/git/exec — ref validation rejects @{ pattern", () => {
  assert.throws(
    () => validateRef("bad@{name}"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalid ref/i);
      return true;
    },
  );
});

test("src/git/exec — child env excludes ambient token and SSH_AUTH_SOCK", async () => {
  // Verify the child env returned by runGit(captureEnv:true) contains no
  // _TOKEN / _KEY / _SECRET / _PASSWORD keys and no SSH_AUTH_SOCK.
  // We do NOT inject a canary via process.env — the no-network-guard proxy
  // blocks _TOKEN reads AND Node's env binding rejects defineProperty for non-
  // simple-string assignments. Instead we assert structural absence: if the
  // allowlist works, none of those keys can appear in childEnv regardless of
  // what the ambient env holds.
  const dir = await mkdtemp(join(tmpdir(), "kanthord-exec-env-"));
  try {
    await execFileP("git", ["init", dir]);
    const result = await runGit(["rev-parse", "--git-dir"], {
      cwd: dir,
      captureEnv: true,
    });
    assert.ok(
      "childEnv" in result,
      "runGit with captureEnv must return childEnv field",
    );
    const childEnv = (result as { childEnv: Record<string, string> }).childEnv;
    const credSuffixes = ["_TOKEN", "_KEY", "_SECRET", "_PASSWORD"];
    for (const k of Object.keys(childEnv)) {
      const upper = k.toUpperCase();
      const isCredential = credSuffixes.some((sfx) => upper.endsWith(sfx));
      assert.ok(
        !isCredential,
        `child env must not contain credential key "${k}"`,
      );
    }
    assert.ok(
      !Object.prototype.hasOwnProperty.call(childEnv, "SSH_AUTH_SOCK"),
      "SSH_AUTH_SOCK must not appear in child env",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("src/git/exec — sleeping child is killed by process group on timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-exec-timeout-"));
  try {
    await execFileP("git", ["init", dir]);
    // git ls-remote against a silent local server simulated by /dev/stdin
    // We use a short timeout and a command that will hang: git fetch a nonexistent
    // tcp port (127.0.0.1:1 is refused fast, we need something that hangs).
    // Use git credential fill on a blocking fd to simulate a hang, or use
    // a subprocess approach: spawn "sleep 9999" via git config askpass so git hangs.
    // Simpler: run `git fetch git://127.0.0.1:39999/` which connects to a closed port
    // but with GIT_TERMINAL_PROMPT=0 and no helper might hang briefly. Instead:
    // Use a synthetic approach — verify the timeout/kill plumbing is wired correctly
    // by running `git ls-remote` against a TCP endpoint that never responds.
    // We start a server that accepts but never replies.
    const net = await import("node:net");
    const server = net.createServer(() => { /* accept and hang */ });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const port = addr.port;

    try {
      const start = Date.now();
      const result = await runGit(
        ["ls-remote", `git://127.0.0.1:${port}/repo.git`],
        { cwd: dir, timeout: 500 },
      );
      const elapsed = Date.now() - start;
      assert.equal(
        result.kind,
        "timeout",
        `expected timeout, got ${result.kind}`,
      );
      // Should be killed well within 2 seconds
      assert.ok(elapsed < 2000, `kill took too long: ${elapsed}ms`);
    } finally {
      server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("src/git/exec — ref validation rejects space via git check-ref-format (B2)", async () => {
  // "bad name" passes the current -/../@{ string guards but git check-ref-format
  // --branch rejects it (spaces are not valid in branch names).
  // This test exercises the Story 000 AC: "every Core-supplied ref is validated
  // (git check-ref-format --branch + allowlist) before use".
  await assert.rejects(
    async () => validateRef("bad name"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalid ref/i);
      return true;
    },
    "validateRef must reject a ref name with a space character",
  );
});

test("src/git/exec — ref validation rejects .lock suffix via git check-ref-format (B2)", async () => {
  // "my.lock" passes the current -/../@{ string guards but git check-ref-format
  // --branch rejects it (.lock suffix is reserved by git for lockfile names).
  await assert.rejects(
    async () => validateRef("my.lock"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalid ref/i);
      return true;
    },
    "validateRef must reject a ref name ending in .lock",
  );
});

test("src/git/exec — runGit uses gitBin instead of literal 'git'", async () => {
  // Create a fake git binary that writes "FAKE-GIT" to stdout and exits 0.
  // When runGit honours gitBin, stdout will contain "FAKE-GIT".
  // When runGit ignores gitBin and spawns literal "git", stdout will NOT contain
  // "FAKE-GIT" (it will be real git output or a version string).
  const dir = await mkdtemp(join(tmpdir(), "kanthord-exec-gitbin-"));
  try {
    const fakeBin = join(dir, "fake-git");
    await writeFile(fakeBin, "#!/bin/sh\necho FAKE-GIT\n");
    await chmod(fakeBin, 0o755);

    const result = await runGit(["version"], { cwd: dir, gitBin: fakeBin });
    assert.ok(
      result.stdout.includes("FAKE-GIT"),
      `runGit must invoke gitBin, expected stdout to contain "FAKE-GIT" but got: ${result.stdout.trim()}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
