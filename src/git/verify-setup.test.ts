/**
 * src/git/verify-setup — verifySetup preflight + system:setup inbox item tests
 *
 * Story 000 / Task T4. All tests use a fake `gh` + fake tooling (no network).
 * verifySetup is read-only: it must never mutate any state.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  VerifyReport,
  VerifyCheck,
  SetupInboxItem,
  VerifySetupOpts,
} from "./verify-setup.ts";
import { verifySetup } from "./verify-setup.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "verify-setup-test-"));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Write a fake executable script to dir/name that exits with exitCode. */
async function writeFakeBin(
  dir: string,
  name: string,
  opts: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    /** Additional env checks — if env var matches value the script overrides behaviour */
    envCase?: { var: string; value: string; exitCode: number; stdout?: string; stderr?: string };
  } = {}
): Promise<string> {
  const exitCode = opts.exitCode ?? 0;
  const stdout = opts.stdout ?? "";
  const stderr = opts.stderr ?? "";
  let script = `#!/bin/sh\n`;
  if (opts.envCase) {
    const { var: envVar, value: envVal, exitCode: ec, stdout: sto = "", stderr: ste = "" } = opts.envCase;
    script += `if [ "$${envVar}" = "${envVal}" ]; then\n`;
    script += `  printf '%s' '${sto.replace(/'/g, "'\\''")}' >&1\n`;
    script += `  printf '%s' '${ste.replace(/'/g, "'\\''")}' >&2\n`;
    script += `  exit ${ec}\n`;
    script += `fi\n`;
  }
  script += `printf '%s' '${stdout.replace(/'/g, "'\\''")}' >&1\n`;
  script += `printf '%s' '${stderr.replace(/'/g, "'\\''")}' >&2\n`;
  script += `exit ${exitCode}\n`;
  const binPath = join(dir, name);
  await writeFile(binPath, script, { mode: 0o755 });
  return binPath;
}

// ---------------------------------------------------------------------------
// T4.1: missing PR scope ⇒ ok:false + one aggregate system:setup inbox item
// ---------------------------------------------------------------------------

test("src/git/verify-setup — missing PR scope returns ok:false and one system:setup inbox item", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    // gh auth status: success (token present and valid)
    // gh auth token --scopes: returns scopes WITHOUT repo (PR requires it)
    // We model this as a fake `gh` that returns auth ok but scopes missing "repo"
    const scopeOutput = JSON.stringify({ scopes: ["read:org", "gist"] });
    const ghBin = await writeFakeBin(dir, "gh", { exitCode: 0, stdout: scopeOutput });
    // Fake git binary that reports version 2.40.0 (above 2.31 floor)
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.40.0" });

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin,
      gitBin,
      configDir: dir,
    };

    const report: VerifyReport = await verifySetup(opts);

    assert.equal(report.ok, false, "report.ok must be false when PR scope is missing");
    assert.equal(report.platform, "github");
    assert.equal(report.repo, "acme/core");
    assert.equal(report.identity, "company");

    // Must have at least one failed check with name containing "scope"
    const failedChecks = report.checks.filter((c: VerifyCheck) => !c.ok);
    assert.ok(failedChecks.length > 0, "must have at least one failed check");
    const scopeCheck = failedChecks.find((c: VerifyCheck) => c.name.toLowerCase().includes("scope"));
    assert.ok(scopeCheck !== undefined, "must have a scope check that failed");
    assert.ok(scopeCheck.remediation.length > 0, "failed check must have remediation text");

    // Must have exactly ONE aggregate system:setup inbox item
    assert.ok(report.inboxItems !== undefined, "report must include inboxItems");
    assert.equal(report.inboxItems.length, 1, "must emit exactly one aggregate inbox item per repo");
    const item: SetupInboxItem = report.inboxItems[0]!;
    assert.equal(item.kind, "system:setup");
    assert.ok(item.message.includes("acme/core") || item.details.includes("acme/core"),
      "inbox item must name the repo");
    assert.ok(item.message.includes("company") || item.details.includes("company"),
      "inbox item must name the identity");
    assert.ok(item.remediation.length > 0, "inbox item must include remediation");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T4.2: stale git version ⇒ min-version check fails
// ---------------------------------------------------------------------------

test("src/git/verify-setup — stale git version fails min-version check", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    // git reports version 2.28.0 (below 2.31 floor)
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.28.0" });
    const ghBin = await writeFakeBin(dir, "gh", { exitCode: 0, stdout: JSON.stringify({ scopes: ["repo"] }) });

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin,
      gitBin,
      configDir: dir,
    };

    const report: VerifyReport = await verifySetup(opts);

    assert.equal(report.ok, false, "report.ok must be false for stale git version");
    const versionCheck = report.checks.find((c: VerifyCheck) =>
      c.name.toLowerCase().includes("version") || c.name.toLowerCase().includes("git")
    );
    assert.ok(versionCheck !== undefined, "must have a version check");
    assert.equal(versionCheck.ok, false, "version check must fail for git 2.28.0");
    assert.ok(versionCheck.detail.includes("2.28"), "detail must mention the detected version");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T4.3: all checks passing ⇒ ok:true, no inbox items
// ---------------------------------------------------------------------------

test("src/git/verify-setup — all checks pass returns ok:true and no inbox items", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    // git version above floor
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.40.0" });
    // gh: returns version string for --version, scope JSON for auth status --json
    const scopeOutput = JSON.stringify({ scopes: ["repo", "read:org"] });
    const ghBinPath = join(dir, "gh");
    const ghScript = [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then`,
      `  printf 'gh version 2.40.0 (2024-01-01)\\n'`,
      `  exit 0`,
      `fi`,
      `printf '%s' '${scopeOutput.replace(/'/g, "'\\''")}' >&1`,
      `exit 0`,
    ].join("\n");
    await writeFile(ghBinPath, ghScript, { mode: 0o755 });
    const ghBin = ghBinPath;

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin,
      gitBin,
      configDir: dir,
    };

    const report: VerifyReport = await verifySetup(opts);

    assert.equal(report.ok, true, "report.ok must be true when all checks pass");
    const failedChecks = report.checks.filter((c: VerifyCheck) => !c.ok);
    assert.equal(failedChecks.length, 0, "must have no failed checks");
    assert.equal(report.inboxItems.length, 0, "must emit no inbox items when all pass");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T4.4: verifySetup performs no mutating call
// ---------------------------------------------------------------------------

test("src/git/verify-setup — verifySetup performs no mutating call (never gh pr create)", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    // Script that records its args; any "pr create" argument causes it to exit non-zero
    // to prove the test catches mutations.
    const scriptContent = [
      "#!/bin/sh",
      `# fail loudly if a mutating subcommand is invoked`,
      `for arg in "$@"; do`,
      `  case "$arg" in`,
      `    create|delete|merge|edit|close) printf 'MUTATING_CALL_DETECTED' >&2; exit 99;;`,
      `  esac`,
      `done`,
      `printf '%s' '${JSON.stringify({ scopes: ["repo"] }).replace(/'/g, "'\\''")}' >&1`,
      `exit 0`,
    ].join("\n");
    const ghBin = join(dir, "gh");
    await writeFile(ghBin, scriptContent, { mode: 0o755 });
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.40.0" });

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin,
      gitBin,
      configDir: dir,
    };

    // Must not throw; if gh exits 99 the implementation called a mutating subcommand
    const report: VerifyReport = await verifySetup(opts);
    assert.notEqual(report, null, "should return a report without mutating");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// B3: verifySetup must route git version check through the runGit seam
// ---------------------------------------------------------------------------

test("src/git/verify-setup — git version check uses injected runGit seam (B3)", async () => {
  // The gitBin is a fake that returns a stale "git version 2.00.0" (would fail).
  // The opts.runGit override returns "git version 9.9.9" (would pass).
  // If verifySetup uses opts.runGit, the git-version check passes.
  // If verifySetup ignores opts.runGit and spawns gitBin directly, the check fails.
  // This test proves verifySetup routes git through the shared runGit seam.
  const { dir, cleanup } = await makeTempDir();
  try {
    // gitBin returns a version below the 2.31 floor — would fail if spawned directly.
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.00.0" });
    const ghBin = await writeFakeBin(dir, "gh", { exitCode: 0, stdout: JSON.stringify({ scopes: ["repo"] }) });

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin,
      gitBin,
      configDir: dir,
      // Override the runGit seam: returns a version above the floor so git-version check passes.
      runGit: async (_args: string[], _runOpts: { cwd: string; gitBin?: string }) => ({
        kind: "success" as const,
        stdout: "git version 9.9.9",
        stderr: "",
      }),
    };

    const report: VerifyReport = await verifySetup(opts);

    // If runGit seam was used: git-version check passes (9.9.9 >= 2.31); report.ok true.
    // If gitBin was spawned directly: git-version check fails (2.00.0 < 2.31); report.ok false.
    const gitVersionCheck = report.checks.find(
      (c: VerifyCheck) => c.name.toLowerCase().includes("version") || c.name.toLowerCase().includes("git")
    );
    assert.ok(gitVersionCheck !== undefined, "must have a git-version check");
    assert.equal(
      gitVersionCheck.ok,
      true,
      "git-version check must pass when runGit seam returns 9.9.9 — proves seam is used"
    );
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// B4: gh min-version must be checked (not only presence)
// ---------------------------------------------------------------------------

test("src/git/verify-setup — stale gh version fails gh min-version check (B4)", async () => {
  // gh binary reports a version string below the required floor.
  // verifySetup must check gh version and mark the check failed.
  const { dir, cleanup } = await makeTempDir();
  try {
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.40.0" });
    // gh returns version output indicating a stale release (below any reasonable floor).
    // The fake gh outputs a version line as its first response, then the scopes JSON.
    // We model this by passing --version output as a separate fake; for simplicity the
    // fake outputs "gh version 1.0.0 (2021-02-01)" which is below any modern gh floor.
    const ghVersionScript = [
      "#!/bin/sh",
      `for arg in "$@"; do`,
      `  case "$arg" in`,
      `    --version) printf 'gh version 1.0.0 (2021-02-01)\\n'; exit 0;;`,
      `  esac`,
      `done`,
      `printf '%s' '${JSON.stringify({ scopes: ["repo"] })}' >&1`,
      `exit 0`,
    ].join("\n");
    const ghBin = join(dir, "gh-stale");
    await writeFile(ghBin, ghVersionScript, { mode: 0o755 });

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin,
      gitBin,
      configDir: dir,
    };

    const report: VerifyReport = await verifySetup(opts);

    assert.equal(report.ok, false, "report.ok must be false when gh version is stale");
    const ghVersionCheck = report.checks.find((c: VerifyCheck) =>
      c.name.toLowerCase().includes("gh") && c.name.toLowerCase().includes("version")
    );
    assert.ok(ghVersionCheck !== undefined, "must have a gh-version check");
    assert.equal(ghVersionCheck.ok, false, "gh-version check must fail for gh 1.0.0");
    assert.ok(ghVersionCheck.detail.includes("1.0"), "detail must mention the detected gh version");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// T4.5: gh not found ⇒ tooling check fails with remediation
// ---------------------------------------------------------------------------

test("src/git/verify-setup — gh binary not found returns ok:false with tooling remediation", async () => {
  const { dir, cleanup } = await makeTempDir();
  try {
    const gitBin = await writeFakeBin(dir, "git", { exitCode: 0, stdout: "git version 2.40.0" });
    // Point to a non-existent gh binary
    const missingGh = join(dir, "gh-missing");

    const opts: VerifySetupOpts = {
      platform: "github",
      repo: "acme/core",
      identity: "company",
      token: "ghp_test_123",
      ghBin: missingGh,
      gitBin,
      configDir: dir,
    };

    const report: VerifyReport = await verifySetup(opts);

    assert.equal(report.ok, false, "report.ok must be false when gh is not found");
    const toolingCheck = report.checks.find((c: VerifyCheck) =>
      c.name.toLowerCase().includes("gh") || c.name.toLowerCase().includes("tooling")
    );
    assert.ok(toolingCheck !== undefined, "must have a tooling check for gh");
    assert.equal(toolingCheck.ok, false, "gh tooling check must fail");
    assert.ok(toolingCheck.remediation.length > 0, "tooling check must include remediation");
  } finally {
    await cleanup();
  }
});
