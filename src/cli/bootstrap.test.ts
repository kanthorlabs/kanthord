/**
 * src/cli/bootstrap — Task T5 Bootstrap CLI (Story 000, RED)
 *
 * Tests:
 *  - non-interactive with complete env populates keyring + slots and reports verifySetup pass
 *  - missing identity value exits non-zero and writes nothing
 *  - run touches no global git/gh path (sandboxed HOME / GH_CONFIG_DIR)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test (does not exist yet — RED)
import type { BootstrapDeps, BootstrapResult } from "./bootstrap.ts";
import { runBootstrap } from "./bootstrap.ts";

// ---------------------------------------------------------------------------
// Helper: create a temp dir
// ---------------------------------------------------------------------------
async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kanthord-bootstrap-"));
}

// ---------------------------------------------------------------------------
// Helper: make a fake gh script that reports all-passing scopes
// ---------------------------------------------------------------------------
async function makeFakeGhPass(dir: string): Promise<string> {
  const script = join(dir, "gh");
  await writeFile(
    script,
    [
      "#!/bin/sh",
      // Dispatch by first argument so checkGhVersion and checkGhToolingAndScopes both pass
      `if [ "$1" = "--version" ]; then`,
      `  printf 'gh version 2.40.0 (2024-01-01)\\n'`,
      `  exit 0`,
      `fi`,
      // Emit a JSON scopes response that includes "repo" for auth status --json
      `printf '%s\\n' '{"scopes":["repo","read:org"]}'`,
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  return script;
}

// ---------------------------------------------------------------------------
// Helper: make a fake git script that reports version >= 2.31
// ---------------------------------------------------------------------------
async function makeFakeGitPass(dir: string): Promise<string> {
  const script = join(dir, "git");
  await writeFile(
    script,
    [
      "#!/bin/sh",
      `printf 'git version 2.40.0\\n'`,
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  return script;
}

// ---------------------------------------------------------------------------
// Test 1: --non-interactive with complete env populates keyring + slots
//         and reports verifySetup pass
// ---------------------------------------------------------------------------
test("bootstrap: --non-interactive with complete env populates keyring+slots and verifySetup passes", async () => {
  const tmpDir = await makeTempDir();
  try {
    const kanthordHome = join(tmpDir, "kanthord-home");
    const ghBin = await makeFakeGhPass(tmpDir);
    const gitBin = await makeFakeGitPass(tmpDir);

    const deps: BootstrapDeps = {
      ghBin,
      gitBin,
      kanthordHome,
      // Provide the identity token inline (simulating env-sourced token in non-interactive mode)
      identities: [
        {
          name: "mybot",
          token: "ghp_test_bootstrap_token",
        },
      ],
      slots: [
        {
          name: "main-repo",
          platform: "github",
          repo: "owner/repo",
          identity: "mybot",
        },
      ],
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    };

    const result: BootstrapResult = await runBootstrap({ nonInteractive: true }, deps);

    // Should succeed
    assert.equal(result.exitCode, 0, "exit code should be 0 on success");

    // verifySetup should pass
    assert.equal(result.verifyReport.ok, true, "verifySetup should pass");
    assert.equal(result.verifyReport.inboxItems.length, 0, "no system:setup inbox items on pass");

    // keyring dir should exist inside kanthordHome
    const keyringDir = join(kanthordHome, "keyring");
    const keyringStat = await stat(keyringDir);
    assert.ok(keyringStat.isDirectory(), "keyring directory should be created");

    // identity file should exist with mode 0600
    const identityFile = join(keyringDir, "mybot.token");
    const identityStat = await stat(identityFile);
    assert.equal(
      identityStat.mode & 0o777,
      0o600,
      "identity file should have mode 0600",
    );

    // slots config should exist
    const slotsFile = join(kanthordHome, "slots.json");
    const slotsStat = await stat(slotsFile);
    assert.ok(slotsStat.isFile(), "slots.json should be created");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: missing identity value exits non-zero and writes nothing
// ---------------------------------------------------------------------------
test("bootstrap: missing identity token exits non-zero and writes nothing", async () => {
  const tmpDir = await makeTempDir();
  try {
    const kanthordHome = join(tmpDir, "kanthord-home");
    const ghBin = await makeFakeGhPass(tmpDir);
    const gitBin = await makeFakeGitPass(tmpDir);

    const deps: BootstrapDeps = {
      ghBin,
      gitBin,
      kanthordHome,
      // Intentionally missing token (empty string = missing)
      identities: [
        {
          name: "notoken-bot",
          token: "",
        },
      ],
      slots: [
        {
          name: "main-repo",
          platform: "github",
          repo: "owner/repo",
          identity: "notoken-bot",
        },
      ],
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    };

    const result: BootstrapResult = await runBootstrap({ nonInteractive: true }, deps);

    // Should fail non-zero
    assert.notEqual(result.exitCode, 0, "exit code should be non-zero for missing token");

    // kanthordHome should NOT have been populated (writes nothing on failure)
    let entries: string[] = [];
    try {
      entries = await readdir(kanthordHome);
    } catch {
      // Dir may not exist at all — that's fine
      entries = [];
    }
    assert.equal(
      entries.length,
      0,
      "kanthordHome should be empty (wrote nothing on failure)",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: run touches no global git/gh path (sandboxed HOME / GH_CONFIG_DIR)
// ---------------------------------------------------------------------------
test("bootstrap: does not write to global git/gh paths (sandboxed HOME)", async () => {
  const tmpDir = await makeTempDir();
  try {
    const kanthordHome = join(tmpDir, "kanthord-home");
    const sandboxedHome = join(tmpDir, "fake-home");
    const ghBin = await makeFakeGhPass(tmpDir);
    const gitBin = await makeFakeGitPass(tmpDir);

    // Track whether any path outside kanthordHome was written
    const writtenPaths: string[] = [];
    const monitoringDeps: BootstrapDeps = {
      ghBin,
      gitBin,
      kanthordHome,
      sandboxedHome,  // bootstrap must use this as HOME and GH_CONFIG_DIR root
      identities: [
        {
          name: "sandbox-bot",
          token: "ghp_sandbox_token",
        },
      ],
      slots: [
        {
          name: "sandbox-repo",
          platform: "github",
          repo: "owner/sandbox",
          identity: "sandbox-bot",
        },
      ],
      stdout: { write: () => {} },
      stderr: {
        write: (msg: string) => {
          writtenPaths.push(msg);
        },
      },
    };

    await runBootstrap({ nonInteractive: true }, monitoringDeps);

    // sandboxedHome should not have .gitconfig or .config/gh written
    let globalGitConfig = false;
    try {
      await stat(join(sandboxedHome, ".gitconfig"));
      globalGitConfig = true;
    } catch {
      // Expected: not found
    }
    assert.equal(globalGitConfig, false, "bootstrap must not write ~/.gitconfig");

    let globalGhConfig = false;
    try {
      await stat(join(sandboxedHome, ".config", "gh"));
      globalGhConfig = true;
    } catch {
      // Expected: not found
    }
    assert.equal(globalGhConfig, false, "bootstrap must not write ~/.config/gh");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Reviewer round-3 B3: bootstrap must call verifySetup with a runGit seam
// so git version checks route through the shared execution seam — not through
// a direct spawnCapture bypass.
//
// Proof: gitBin returns a stale version (2.00.0, below the 2.31 floor) — if
// verifySetup spawns it directly, report.ok is false. The runGit seam injected
// via BootstrapDeps returns "git version 9.9.9" (above the floor) — if
// bootstrap forwards runGit to verifySetup, report.ok is true.
// ---------------------------------------------------------------------------
test("bootstrap: passes runGit seam to verifySetup so git version check uses the seam", async () => {
  const tmpDir = await makeTempDir();
  try {
    const kanthordHome = join(tmpDir, "kanthord-home");
    const ghBin = await makeFakeGhPass(tmpDir);

    // gitBin returns a stale version — would fail if spawned directly by verifySetup.
    const staleGitScript = join(tmpDir, "git-stale");
    await writeFile(staleGitScript, "#!/bin/sh\nprintf 'git version 2.00.0'\nexit 0\n", { mode: 0o755 });

    const deps: BootstrapDeps = {
      ghBin,
      gitBin: staleGitScript,
      kanthordHome,
      identities: [{ name: "seam-bot", token: "ghp_seam_token" }],
      slots: [{ name: "seam-repo", platform: "github", repo: "owner/seam", identity: "seam-bot" }],
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      // Inject a runGit seam that returns a modern version.
      // If bootstrap forwards this to verifySetup, git-version check passes.
      // If bootstrap omits runGit, verifySetup spawns staleGitScript -> report.ok false.
      runGit: async (_args: string[], _opts: { cwd: string; gitBin?: string }) => ({
        kind: "success" as const,
        stdout: "git version 9.9.9",
        stderr: "",
      }),
    };

    const result: BootstrapResult = await runBootstrap({ nonInteractive: true }, deps);

    assert.equal(
      result.verifyReport.ok,
      true,
      "bootstrap must forward runGit seam to verifySetup — git-version passes when seam returns 9.9.9",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
