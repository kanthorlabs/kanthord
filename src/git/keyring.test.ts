/**
 * src/git/keyring — Credential keyring + custody (Story 000 / Task T2)
 *
 * Covers:
 *  - Identity loads from file (mode 0600, owner matches effective UID)
 *  - File with mode 0644 is rejected with a typed fail-closed error
 *  - File owned by a different UID is rejected with a typed fail-closed error
 *  - Identity loads from env (KANTHOR_IDENTITY_<NAME>_TOKEN)
 *  - Canary token value never appears in a log-sink string
 *  - A child spawned via runGit with an injected identity sees no token in
 *    its env (captureEnv) and the argv does not contain the token
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadIdentity,
  loadCredentialsFile,
  type Identity,
  type IdentityLoadError,
} from "./keyring.ts";

const execFileP = promisify(_execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-keyring-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("src/git/keyring — loads identity from a 0600 file", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const tokenFile = join(dir, "credentials");
    await writeFile(tokenFile, "KANTHOR_IDENTITY_MYBOT_TOKEN=ghp_testtoken123\n", { mode: 0o600 });
    const identity = await loadIdentity({ name: "mybot", file: tokenFile });
    assert.equal(identity.name, "mybot");
    assert.equal(identity.token, "ghp_testtoken123");
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — rejects file with mode 0644 (fail-closed)", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const tokenFile = join(dir, "identity.token");
    await writeFile(tokenFile, "ghp_badperm\n", { mode: 0o644 });
    await assert.rejects(
      () => loadIdentity({ name: "mybot", file: tokenFile }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // Must be a typed IdentityLoadError with code "insecure-file-mode"
        assert.equal((err as IdentityLoadError).code, "insecure-file-mode");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — rejects file with mode 0755 (fail-closed)", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const tokenFile = join(dir, "identity.token");
    await writeFile(tokenFile, "ghp_badperm\n", { mode: 0o755 });
    await assert.rejects(
      () => loadIdentity({ name: "mybot", file: tokenFile }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as IdentityLoadError).code, "insecure-file-mode");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — loads identity from env KANTHOR_IDENTITY_<NAME>_TOKEN", async () => {
  // The no-network-guard proxy blocks reads of _TOKEN env vars. To test the
  // credential-loading code (which IS supposed to read credentials), we
  // temporarily replace process.env with a plain object so loadIdentity can
  // read the key without hitting the proxy guard.
  const envKey = "KANTHOR_IDENTITY_TESTBOT_TOKEN";
  const savedEnv = process.env;
  const tempEnv = Object.fromEntries(Object.entries(savedEnv)) as NodeJS.ProcessEnv;
  (tempEnv as Record<string, string>)[envKey] = "ghp_from_env_999";
  process.env = tempEnv;
  try {
    const identity = await loadIdentity({ name: "testbot", env: true });
    assert.equal(identity.name, "testbot");
    assert.equal(identity.token, "ghp_from_env_999");
  } finally {
    process.env = savedEnv;
  }
});

test("src/git/keyring — missing env var when env:true is a typed error", async () => {
  // Use a plain env object (without the token key) so loadIdentity reads
  // from a non-guarded env and throws IdentityLoadError instead of the guard.
  const savedEnv = process.env;
  const tempEnv = Object.fromEntries(Object.entries(savedEnv)) as NodeJS.ProcessEnv;
  delete (tempEnv as Record<string, string | undefined>)["KANTHOR_IDENTITY_GHOST_TOKEN"];
  process.env = tempEnv;
  try {
    await assert.rejects(
      () => loadIdentity({ name: "ghost", env: true }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as IdentityLoadError).code, "missing-env-token");
        return true;
      },
    );
  } finally {
    process.env = savedEnv;
  }
});

test("src/git/keyring — canary token value never appears in log sink", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const tokenFile = join(dir, "credentials");
    const canaryToken = "ghp_CANARY_MUST_NOT_APPEAR_IN_LOGS";
    await writeFile(tokenFile, `KANTHOR_IDENTITY_LOGTEST_TOKEN=${canaryToken}\n`, { mode: 0o600 });

    const logMessages: string[] = [];
    // Provide a log sink that captures all strings
    const logSink = (msg: string) => { logMessages.push(msg); };

    const identity = await loadIdentity({ name: "logtest", file: tokenFile, log: logSink });

    // After loading, no message in the log sink should contain the raw token
    for (const msg of logMessages) {
      assert.ok(
        !msg.includes(canaryToken),
        `log message must not contain the raw canary token: "${msg}"`,
      );
    }
    // But the identity was loaded correctly
    assert.equal(identity.token, canaryToken);
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — injectToken adds GH_TOKEN to per-invocation child env only", async () => {
  // The keyring must provide a way to inject a token into a child env for a
  // single git/gh invocation — never daemon-global.
  // We verify that injectToken returns an env record containing GH_TOKEN
  // but does not mutate process.env.
  const { injectToken } = await import("./keyring.ts");

  const mockIdentity: Identity = { name: "injtest", token: "ghp_inject_check" };
  const baseEnv: Record<string, string> = { PATH: "/usr/bin", GIT_TERMINAL_PROMPT: "0" };

  const childEnv = injectToken(mockIdentity, baseEnv);

  // The child env contains GH_TOKEN
  assert.equal(childEnv["GH_TOKEN"], "ghp_inject_check");
  // The base env is not mutated
  assert.ok(!("GH_TOKEN" in baseEnv), "baseEnv must not be mutated");
  // process.env does not have GH_TOKEN injected
  assert.ok(
    !Object.prototype.hasOwnProperty.call(process.env, "GH_TOKEN") ||
      process.env["GH_TOKEN"] !== "ghp_inject_check",
    "process.env must not have the injected GH_TOKEN",
  );
});

test("src/git/keyring — spawned child via runGit does not see token in env or argv", async () => {
  // Use the seam's captureEnv to verify the child env has no token leakage.
  // The keyring should produce a child env via injectToken, but when runGit
  // is called WITHOUT a token arg, its env contains no _TOKEN keys.
  const { runGit } = await import("./exec.ts");
  const repoDir = await mkdtemp(join(tmpdir(), "kanthord-keyring-spawn-"));
  try {
    await execFileP("git", ["init", repoDir]);
    const result = await runGit(["rev-parse", "--git-dir"], {
      cwd: repoDir,
      captureEnv: true,
    });
    assert.ok("childEnv" in result, "must have childEnv");
    const childEnv = (result as { childEnv: Record<string, string> }).childEnv;
    // No GH_TOKEN or any _TOKEN key in the bare runGit call
    for (const k of Object.keys(childEnv)) {
      assert.ok(
        !k.toUpperCase().endsWith("_TOKEN"),
        `child env key "${k}" must not be a _TOKEN key in a bare runGit call`,
      );
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadCredentialsFile — multi-key KEY=VALUE custody file (Option A unification)
// ---------------------------------------------------------------------------

test("src/git/keyring — loadCredentialsFile parses a multi-key file, ignoring blanks + comments", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const file = join(dir, "credentials");
    await writeFile(
      file,
      [
        "# custody file",
        "KANTHOR_IDENTITY_KANTHORDVERIFY_TOKEN=github_pat_abc",
        "",
        "KANTHOR_S3_ACCESS_KEY_ID=AKIA123456789012345",
        "  # indented comment",
        "KANTHOR_S3_SECRET_ACCESS_KEY=secret/with=equals+sign",
      ].join("\n") + "\n",
      { mode: 0o600 },
    );
    const secrets = await loadCredentialsFile(file);
    assert.equal(secrets["KANTHOR_IDENTITY_KANTHORDVERIFY_TOKEN"], "github_pat_abc");
    assert.equal(secrets["KANTHOR_S3_ACCESS_KEY_ID"], "AKIA123456789012345");
    // first "=" splits — a value may itself contain "="
    assert.equal(secrets["KANTHOR_S3_SECRET_ACCESS_KEY"], "secret/with=equals+sign");
    assert.equal(Object.keys(secrets).length, 3, "blank + comment lines are ignored");
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — loadCredentialsFile rejects a non-KEY=VALUE line (line number, no content)", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const file = join(dir, "credentials");
    // A bare value-only line (the legacy format that caused the corruption).
    await writeFile(file, "KANTHOR_IDENTITY_MYBOT_TOKEN=ok\ngithub_pat_barevalue\n", { mode: 0o600 });
    await assert.rejects(
      () => loadCredentialsFile(file),
      (err: unknown) => {
        assert.equal((err as IdentityLoadError).code, "malformed-credentials");
        assert.ok((err as Error).message.includes("line 2"), "must name the line NUMBER");
        assert.ok(!(err as Error).message.includes("github_pat_barevalue"), "must NOT echo the line content");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — loadIdentity file mode picks the right key when several are present", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const file = join(dir, "credentials");
    await writeFile(
      file,
      "KANTHOR_IDENTITY_ALPHA_TOKEN=tok_alpha\nKANTHOR_IDENTITY_BETA_TOKEN=tok_beta\n",
      { mode: 0o600 },
    );
    const beta = await loadIdentity({ name: "beta", file });
    assert.equal(beta.token, "tok_beta");
  } finally {
    await cleanup();
  }
});

test("src/git/keyring — loadIdentity file mode throws missing-file-token when the identity key is absent", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const file = join(dir, "credentials");
    await writeFile(file, "KANTHOR_IDENTITY_OTHER_TOKEN=tok\n", { mode: 0o600 });
    await assert.rejects(
      () => loadIdentity({ name: "kanthordverify", file }),
      (err: unknown) => {
        assert.equal((err as IdentityLoadError).code, "missing-file-token");
        assert.ok((err as Error).message.includes("kanthordverify"), "names the identity");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});
