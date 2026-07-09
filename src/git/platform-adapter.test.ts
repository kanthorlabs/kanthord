/**
 * src/git/platform-adapter — GitPlatformAdapter (gh-backed) tests
 *
 * Story 000 / Task T3. All tests run against a fake `gh` runner (no network).
 * The fake is a temp script that exits with a predetermined code + stdout/stderr.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  GitPlatformAdapter,
  PrRef,
  PrState,
  PlatformError,
} from "./platform-adapter.ts";
import { GhAdapter } from "./platform-adapter.ts";

// ---------------------------------------------------------------------------
// Fake gh runner helpers
// ---------------------------------------------------------------------------

type FakeGhBehavior =
  | { kind: "success"; stdout: string }
  | { kind: "failure"; exitCode: number; stderr: string };

async function makeFakeGh(
  tmpDir: string,
  behavior: FakeGhBehavior,
): Promise<string> {
  const scriptPath = join(tmpDir, "gh");
  let body: string;
  if (behavior.kind === "success") {
    const escaped = behavior.stdout.replace(/'/g, "'\\''");
    body = `#!/bin/sh\nprintf '%s' '${escaped}'\nexit 0\n`;
  } else {
    const escaped = behavior.stderr.replace(/'/g, "'\\''");
    body = `#!/bin/sh\nprintf '%s' '${escaped}' >&2\nexit ${behavior.exitCode}\n`;
  }
  await writeFile(scriptPath, body, { mode: 0o755 });
  return tmpDir;
}

async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-gh-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// T3.1 createPr — success: returns PrRef with number and url
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — createPr returns PrRef with pr number and url", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const fakeOut = JSON.stringify({ number: 42, url: "https://github.com/acme/repo/pull/42" });
    await makeFakeGh(dir, { kind: "success", stdout: fakeOut });

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    const pr = await adapter.createPr({
      head: "feat/my-branch",
      base: "main",
      title: "My PR",
      body: "",
      token: "ghp_test_token",
    });

    assert.equal(pr.number, 42);
    assert.equal(pr.url, "https://github.com/acme/repo/pull/42");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T3.2 createPr — duplicate (exit 1 + "already exists") resolves via findPrByHead
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — createPr duplicate resolves via findPrByHead", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    // Script: first invocation (create) fails with duplicate stderr;
    // subsequent invocations (list --head) succeed with a JSON array.
    const listOut = JSON.stringify([{ number: 7, url: "https://github.com/acme/repo/pull/7" }]);
    const scriptPath = join(dir, "gh");
    const script = `#!/bin/sh
# If args contain "pr create", simulate duplicate error.
# If args contain "pr list", return the list JSON.
ARGS="$*"
case "$ARGS" in
  *"pr create"*)
    printf 'a pull request for branch %s already exists' 'feat/dup-branch' >&2
    exit 1
    ;;
  *"pr list"*)
    printf '%s' '${listOut.replace(/'/g, "'\\''")}'
    exit 0
    ;;
  *)
    exit 127
    ;;
esac
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    const pr = await adapter.createPr({
      head: "feat/dup-branch",
      base: "main",
      title: "Dup PR",
      body: "",
      token: "ghp_test_token",
    });

    assert.equal(pr.number, 7);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T3.3 createPr — auth failure (exit 1 + "401" or "authentication") → escalate error
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — createPr auth failure classifies as escalate", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    await makeFakeGh(dir, {
      kind: "failure",
      exitCode: 1,
      stderr: "HTTP 401: Bad credentials. Ensure GITHUB_TOKEN is set.",
    });

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    await assert.rejects(
      () => adapter.createPr({
        head: "feat/auth-fail",
        base: "main",
        title: "Auth Fail PR",
        body: "",
        token: "ghp_bad_token",
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as PlatformError).taxonomy, "escalate");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T3.4 createPr — rate-limit (exit 1 + "rate limit") → retryable-with-delay error
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — createPr rate-limit classifies as retryable-with-delay", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    await makeFakeGh(dir, {
      kind: "failure",
      exitCode: 1,
      stderr: "rate limit exceeded: please wait before retrying",
    });

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    await assert.rejects(
      () => adapter.createPr({
        head: "feat/rate-limit",
        base: "main",
        title: "Rate Limit PR",
        body: "",
        token: "ghp_test_token",
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as PlatformError).taxonomy, "retryable-with-delay");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T3.5 findPrByHead — maps --state all; returns PrRef when found
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — findPrByHead returns PrRef for existing head branch", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const listOut = JSON.stringify([
      { number: 99, url: "https://github.com/acme/repo/pull/99" },
    ]);
    await makeFakeGh(dir, { kind: "success", stdout: listOut });

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    const pr = await adapter.findPrByHead("feat/search-branch", "ghp_test_token");
    assert.ok(pr !== undefined);
    assert.equal(pr.number, 99);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T3.6 findPrByHead — returns undefined when no PR found (empty list)
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — findPrByHead returns undefined when no PR for head", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    await makeFakeGh(dir, { kind: "success", stdout: "[]" });

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    const pr = await adapter.findPrByHead("feat/no-pr", "ghp_test_token");
    assert.equal(pr, undefined);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T3.7 GH_TOKEN is injected per-invocation only; not visible in process.env
// ---------------------------------------------------------------------------

test("src/git/platform-adapter — GH_TOKEN is not set in process.env after createPr", async () => {
  const { dir, cleanup } = await makeTempDir();
  // Swap process.env for a plain object so no-network-guard proxy is bypassed
  // for this credential-absence check. Contract: GH_TOKEN must not be set on
  // the runtime env after the call.
  const savedEnv = process.env;
  const plainEnv: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(savedEnv).filter(([k]) => !k.includes("TOKEN") && !k.includes("SECRET"))
  );
  process.env = plainEnv;
  try {
    const prOut = JSON.stringify({ number: 1, url: "https://github.com/acme/repo/pull/1" });
    const escaped = prOut.replace(/'/g, "'\\''");
    const script = `#!/bin/sh\nprintf '%s' '${escaped}'\nexit 0\n`;
    await writeFile(join(dir, "gh"), script, { mode: 0o755 });

    // GH_TOKEN is absent before the call
    assert.equal(plainEnv["GH_TOKEN"], undefined);

    const adapter = new GhAdapter({
      repo: "acme/repo",
      ghBin: join(dir, "gh"),
      configDir: dir,
    });

    await adapter.createPr({
      head: "feat/token-check",
      base: "main",
      title: "Token check",
      body: "",
      token: "ghp_secret_999",
    });

    // GH_TOKEN must not be visible in process.env after the call
    assert.equal(plainEnv["GH_TOKEN"], undefined);
  } finally {
    process.env = savedEnv;
    await cleanup();
  }
});
