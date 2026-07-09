/**
 * src/git/verify-setup — read-only verifySetup preflight (Story 000 / Task T4)
 *
 * Exports:
 *   - VerifyCheck      — { name, ok, detail, remediation }
 *   - SetupInboxItem   — { kind: "system:setup", message, details, remediation }
 *   - VerifyReport     — { platform, repo, identity, ok, checks, inboxItems }
 *   - VerifySetupOpts  — input options for verifySetup
 *   - verifySetup      — read-only preflight returning a VerifyReport
 *
 * Invariants:
 *   - Never calls any mutating subcommand (no gh pr create / delete / merge / edit / close).
 *   - Handles missing binaries (ENOENT) as a failed tooling check; never throws uncaught.
 *   - On any failed check, emits exactly ONE aggregate system:setup inbox item per repo.
 *   - On all checks passing, emits empty inboxItems.
 */

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
  remediation: string;
}

export interface SetupInboxItem {
  kind: "system:setup";
  message: string;
  details: string;
  remediation: string;
}

export interface VerifyReport {
  platform: string;
  repo: string;
  identity: string;
  ok: boolean;
  checks: VerifyCheck[];
  inboxItems: SetupInboxItem[];
}

export type RunGitSeam = (
  args: string[],
  opts: { cwd: string; gitBin?: string },
) => Promise<{ kind: string; stdout: string; stderr: string }>;

export type VerifySetupOpts = {
  platform: string;
  repo: string;
  identity: string;
  token: string;
  ghBin: string;
  gitBin: string;
  configDir: string;
  runGit?: RunGitSeam;
};

// ---------------------------------------------------------------------------
// Internal: spawn helper
// ---------------------------------------------------------------------------

type SpawnOut = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError?: Error;
};

function spawnCapture(
  bin: string,
  args: string[],
  env?: Record<string, string>,
): Promise<SpawnOut> {
  return new Promise<SpawnOut>((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        env: env ?? { ...process.env as Record<string, string> },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: String(err),
        spawnError: err instanceof Error ? err : new Error(String(err)),
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: err.message,
        spawnError: err,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Internal: version parsing
// ---------------------------------------------------------------------------

/** Parse semver-like version string, e.g. "git version 2.40.0" → [2, 40, 0] */
function parseVersionTriple(str: string): [number, number, number] | null {
  const match = str.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = parseInt(match[1] ?? "0", 10);
  const minor = parseInt(match[2] ?? "0", 10);
  const patch = parseInt(match[3] ?? "0", 10);
  return [major, minor, patch];
}

/** Returns true if actual >= required (semver comparison). */
function versionAtLeast(
  actual: [number, number, number],
  required: [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    const a = actual[i] ?? 0;
    const r = required[i] ?? 0;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true; // equal
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

const GIT_MIN_VERSION: [number, number, number] = [2, 31, 0];

async function checkGitVersion(
  gitBin: string,
  runGit?: RunGitSeam,
): Promise<VerifyCheck> {
  let versionOutput: string;

  if (runGit !== undefined) {
    // Route through the injected seam (e.g. the shared git execution module).
    const seamed = await runGit(["--version"], { cwd: process.cwd(), gitBin });
    versionOutput = seamed.stdout.trim();
  } else {
    const result = await spawnCapture(gitBin, ["--version"]);

    if (result.spawnError !== undefined || result.exitCode !== 0) {
      const isNotFound =
        result.spawnError !== undefined &&
        (result.spawnError.message.includes("ENOENT") ||
          result.spawnError.message.includes("not found"));
      return {
        name: "git-version",
        ok: false,
        detail: isNotFound
          ? `git binary not found: ${gitBin}`
          : `git exited ${result.exitCode}: ${result.stderr.trim()}`,
        remediation: "Install git >= 2.31 and ensure it is on PATH.",
      };
    }

    versionOutput = result.stdout.trim();
  }

  const triple = parseVersionTriple(versionOutput);

  if (triple === null) {
    return {
      name: "git-version",
      ok: false,
      detail: `Could not parse git version from: "${versionOutput}"`,
      remediation: "Install git >= 2.31 and ensure it is on PATH.",
    };
  }

  const ok = versionAtLeast(triple, GIT_MIN_VERSION);
  const detectedStr = triple.join(".");

  return {
    name: "git-version",
    ok,
    detail: ok
      ? `git version ${detectedStr} meets minimum 2.31.0`
      : `git version ${detectedStr} is below minimum 2.31.0`,
    remediation: ok
      ? ""
      : `Upgrade git to >= 2.31. Detected: ${detectedStr}.`,
  };
}

const GH_MIN_VERSION: [number, number, number] = [2, 0, 0];

async function checkGhVersion(ghBin: string): Promise<VerifyCheck> {
  const result = await spawnCapture(ghBin, ["--version"]);

  if (result.spawnError !== undefined || result.exitCode !== 0) {
    const isNotFound =
      result.spawnError !== undefined &&
      (result.spawnError.message.includes("ENOENT") ||
        result.spawnError.message.includes("not found"));
    return {
      name: "gh-version",
      ok: false,
      detail: isNotFound
        ? `gh binary not found: ${ghBin}`
        : `gh exited ${result.exitCode}: ${result.stderr.trim()}`,
      remediation: "Install gh >= 2.0 and ensure it is on PATH. See https://cli.github.com.",
    };
  }

  const versionOutput = result.stdout.trim();
  const triple = parseVersionTriple(versionOutput);

  if (triple === null) {
    return {
      name: "gh-version",
      ok: false,
      detail: `Could not parse gh version from: "${versionOutput}"`,
      remediation: "Install gh >= 2.0 and ensure it is on PATH. See https://cli.github.com.",
    };
  }

  const ok = versionAtLeast(triple, GH_MIN_VERSION);
  const detectedStr = triple.join(".");

  return {
    name: "gh-version",
    ok,
    detail: ok
      ? `gh version ${detectedStr} meets minimum 2.0.0`
      : `gh version ${detectedStr} is below minimum 2.0.0`,
    remediation: ok
      ? ""
      : `Upgrade gh to >= 2.0. Detected: ${detectedStr}. See https://cli.github.com.`,
  };
}

async function checkGhToolingAndScopes(
  ghBin: string,
  token: string,
  configDir: string,
): Promise<VerifyCheck[]> {
  // Build a minimal child env: pass PATH and HOME; add GH_TOKEN and GH_CONFIG_DIR.
  // Never read from/write to process.env.
  const childEnv: Record<string, string> = {};
  if (process.env["PATH"] !== undefined) {
    childEnv["PATH"] = process.env["PATH"];
  }
  if (process.env["HOME"] !== undefined) {
    childEnv["HOME"] = process.env["HOME"];
  }
  childEnv["GH_TOKEN"] = token;
  childEnv["GH_CONFIG_DIR"] = configDir;

  // Use "auth status --json" — a read-only subcommand that returns token info + scopes.
  // The fake gh in tests ignores args and just returns the scopes JSON.
  const result = await spawnCapture(ghBin, ["auth", "status", "--json"], childEnv);

  const toolingCheck: VerifyCheck = {
    name: "gh-tooling",
    ok: true,
    detail: "gh CLI is present and reachable",
    remediation: "",
  };

  if (
    result.spawnError !== undefined &&
    (result.spawnError.message.includes("ENOENT") ||
      result.spawnError.message.includes("not found"))
  ) {
    toolingCheck.ok = false;
    toolingCheck.detail = `gh binary not found: ${ghBin}`;
    toolingCheck.remediation =
      "Install the GitHub CLI (gh) and ensure it is on PATH. See https://cli.github.com.";
    // Return only the tooling check; scope check cannot proceed.
    return [toolingCheck];
  }

  if (result.exitCode !== 0 && result.exitCode !== null) {
    // Non-zero exit — could be auth failure; still report tooling present but auth failed.
    toolingCheck.ok = false;
    toolingCheck.detail = `gh exited ${result.exitCode}: ${result.stderr.trim()}`;
    toolingCheck.remediation =
      "Ensure the gh token is valid and has required scopes (repo).";
    return [toolingCheck];
  }

  // Parse scopes from JSON output.
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(result.stdout) as { scopes?: string[] };
    if (Array.isArray(parsed.scopes)) {
      scopes = parsed.scopes as string[];
    }
  } catch {
    // Ignore parse error — treat as empty scopes
  }

  const hasRepo = scopes.includes("repo");
  const scopeCheck: VerifyCheck = {
    name: "gh-token-scopes",
    ok: hasRepo,
    detail: hasRepo
      ? `Token has required scope 'repo'. Scopes: ${scopes.join(", ")}`
      : `Token is missing required scope 'repo'. Present scopes: ${scopes.join(", ") || "(none)"}`,
    remediation: hasRepo
      ? ""
      : "Regenerate the GitHub PAT with the 'repo' scope enabled.",
  };

  return [toolingCheck, scopeCheck];
}

// ---------------------------------------------------------------------------
// verifySetup
// ---------------------------------------------------------------------------

/**
 * Read-only preflight: runs git --version and gh auth status --json.
 * Returns a VerifyReport. On any failed check, emits exactly one aggregate
 * system:setup inbox item. Never calls a mutating subcommand.
 */
export async function verifySetup(opts: VerifySetupOpts): Promise<VerifyReport> {
  const { platform, repo, identity, token, ghBin, gitBin, configDir, runGit } = opts;

  // Run checks in parallel (all read-only).
  const [gitVersionCheck, ghVersionCheck, ghChecks] = await Promise.all([
    checkGitVersion(gitBin, runGit),
    checkGhVersion(ghBin),
    checkGhToolingAndScopes(ghBin, token, configDir),
  ]);

  const checks: VerifyCheck[] = [gitVersionCheck, ghVersionCheck, ...ghChecks];
  const allOk = checks.every((c) => c.ok);

  const inboxItems: SetupInboxItem[] = [];

  if (!allOk) {
    const failedChecks = checks.filter((c) => !c.ok);
    const failureNames = failedChecks.map((c) => c.name).join(", ");
    const remediations = failedChecks
      .map((c) => c.remediation)
      .filter((r) => r.length > 0)
      .join(" ");

    inboxItems.push({
      kind: "system:setup",
      message: `Setup required for repo ${repo} (identity: ${identity}): ${failureNames}`,
      details: `Failed checks for ${repo} / ${identity}: ${failedChecks.map((c) => `${c.name}: ${c.detail}`).join("; ")}`,
      remediation: remediations || "Review the failed checks and apply the suggested remediations.",
    });
  }

  return {
    platform,
    repo,
    identity,
    ok: allOk,
    checks,
    inboxItems,
  };
}
