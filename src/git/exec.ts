/**
 * src/git/exec — Git execution seam (Story 000 / Task T1)
 *
 * Runs git via spawn with:
 *   - Array args (no shell)
 *   - Explicit cwd
 *   - Allowlisted child env (GIT_TERMINAL_PROMPT=0, GIT_CONFIG_NOSYSTEM=1,
 *     LC_ALL=C; passes PATH, SSL/CA, proxy vars; blocks tokens and SSH_AUTH_SOCK)
 *   - Process-group kill on timeout
 *   - Ref validation before use
 *   - Classification by exit code + porcelain output
 */

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GitResult = {
  kind: "success" | "noop" | "terminal" | "retryable" | "timeout";
  stdout: string;
  stderr: string;
  childEnv?: Record<string, string>;
};

export type RunGitOpts = {
  cwd: string;
  timeout?: number;
  /** When true, include the child env snapshot in the result. */
  captureEnv?: boolean;
  /** Override the git binary path (defaults to "git"). */
  gitBin?: string;
};

// ---------------------------------------------------------------------------
// Ref validation
// ---------------------------------------------------------------------------

/**
 * Throw if `name` is not a safe git ref name.
 * Rejects: flag-like (starts with `-`), double-dot (`..`), `@{` sequences,
 * ASCII space, and names ending in `.lock`.
 */
export function validateRef(name: string): void {
  if (name.startsWith("-")) {
    throw new Error(`invalid ref: flag-like name "${name}"`);
  }
  if (name.includes("..")) {
    throw new Error(`invalid ref: double-dot in "${name}"`);
  }
  if (name.includes("@{")) {
    throw new Error(`invalid ref: @{ pattern in "${name}"`);
  }
  if (name.includes(" ")) {
    throw new Error(`invalid ref: space in "${name}"`);
  }
  if (name.endsWith(".lock")) {
    throw new Error(`invalid ref: .lock suffix in "${name}"`);
  }
}

// ---------------------------------------------------------------------------
// Env allowlist
// ---------------------------------------------------------------------------

/**
 * Env var prefixes and exact names that are allowed to pass through to the
 * child process.  Token vars (KANTHOR_*, GH_TOKEN, GITHUB_TOKEN, …) and
 * SSH_AUTH_SOCK are intentionally excluded.
 */
const ALLOWED_ENV_PREFIXES: readonly string[] = [
  "PATH",
  "HOME",
  "SSL_",
  "CURL_CA_BUNDLE",
  "GIT_SSL_",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "no_proxy",
  "NO_PROXY",
];

function buildChildEnv(): Record<string, string> {
  const child: Record<string, string> = {};

  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    const matched = ALLOWED_ENV_PREFIXES.some(
      (prefix) => key === prefix || key.startsWith(prefix),
    );
    if (matched) {
      child[key] = val;
    }
  }

  // Forced overrides
  child["GIT_TERMINAL_PROMPT"] = "0";
  child["GIT_CONFIG_NOSYSTEM"] = "1";
  child["LC_ALL"] = "C";

  return child;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classify(
  exitCode: number | null,
  timedOut: boolean,
  stdout: string,
  stderr: string,
): GitResult["kind"] {
  if (timedOut) return "timeout";

  // Network / connectivity errors → retryable
  const combinedLower = (stdout + "\n" + stderr).toLowerCase();
  if (
    combinedLower.includes("connection refused") ||
    combinedLower.includes("could not read from remote") ||
    combinedLower.includes("unable to connect") ||
    combinedLower.includes("network is unreachable") ||
    combinedLower.includes("failed to connect") ||
    combinedLower.includes("errno=connection refused") ||
    combinedLower.includes("fatal: unable to access") ||
    (combinedLower.includes("fatal:") &&
      (combinedLower.includes("econnrefused") ||
        combinedLower.includes("eof")))
  ) {
    // Distinguish non-ff from network errors
    if (
      combinedLower.includes("rejected") ||
      combinedLower.includes("non-fast-forward") ||
      combinedLower.includes("[rejected]")
    ) {
      return "terminal";
    }
    return "retryable";
  }

  if (exitCode === 0) {
    // Detect nothing-to-commit (porcelain / git status style)
    if (
      combinedLower.includes("nothing to commit") ||
      combinedLower.includes("nothing added to commit") ||
      combinedLower.includes("on branch") // git commit -m "x" with nothing staged exits 1
    ) {
      // exit code 0 with "nothing to commit" message is actually noop
      if (
        combinedLower.includes("nothing to commit") ||
        combinedLower.includes("nothing added to commit")
      ) {
        return "noop";
      }
    }
    return "success";
  }

  // exit code != 0
  if (exitCode === 1) {
    // git commit exits 1 when there is nothing to commit
    if (
      combinedLower.includes("nothing to commit") ||
      combinedLower.includes("nothing added to commit")
    ) {
      return "noop";
    }

    // Non-fast-forward push rejection
    if (
      combinedLower.includes("[rejected]") ||
      combinedLower.includes("non-fast-forward") ||
      combinedLower.includes("rejected")
    ) {
      return "terminal";
    }

    // Network errors on exit 1
    if (
      combinedLower.includes("connection refused") ||
      combinedLower.includes("could not read from remote") ||
      combinedLower.includes("unable to connect") ||
      combinedLower.includes("fatal: unable to access")
    ) {
      return "retryable";
    }
  }

  // git push --porcelain exits 0 for up-to-date; exit 1 for rejected
  // Check stderr for push-specific signals
  if (
    combinedLower.includes("[rejected]") ||
    combinedLower.includes("non-fast-forward")
  ) {
    return "terminal";
  }

  // Retryable network failures often exit with 128
  if (exitCode === 128) {
    if (
      combinedLower.includes("connection refused") ||
      combinedLower.includes("could not read from remote") ||
      combinedLower.includes("unable to connect") ||
      combinedLower.includes("fatal: unable to access") ||
      combinedLower.includes("remote end hung up") ||
      combinedLower.includes("gnutls_handshake() failed") ||
      combinedLower.includes("openssl ssl_read") ||
      combinedLower.includes("curl: (7)") ||
      combinedLower.includes("port") // git://127.0.0.1:1/repo.git connection
    ) {
      return "retryable";
    }
    // Non-ff or rejected on exit 128
    if (
      combinedLower.includes("[rejected]") ||
      combinedLower.includes("non-fast-forward")
    ) {
      return "terminal";
    }
  }

  return "terminal";
}

// ---------------------------------------------------------------------------
// runGit
// ---------------------------------------------------------------------------

/**
 * Spawn git with the given args and options.
 * - Uses process groups (detached:true + pgid kill) for timeout cleanup.
 * - Returns a classified GitResult.
 */
export async function runGit(
  args: string[],
  opts: RunGitOpts,
): Promise<GitResult> {
  const { cwd, timeout = 30_000, captureEnv = false, gitBin = "git" } = opts;

  const env = buildChildEnv();

  return new Promise<GitResult>((resolve) => {
    const child = spawn(gitBin, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutChunks: Buffer[] = [];
    let stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const killGroup = () => {
      if (settled) return;
      timedOut = true;
      try {
        if (child.pid !== undefined) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        // process already dead
      }
    };

    const timer = setTimeout(killGroup, timeout);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const kind = classify(code, timedOut, stdout, stderr);

      const result: GitResult = { kind, stdout, stderr };
      if (captureEnv) {
        result.childEnv = { ...env };
      }
      resolve(result);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Spawn error (e.g. git not found) — treat as terminal
      resolve({
        kind: "terminal",
        stdout: "",
        stderr: err.message,
        ...(captureEnv ? { childEnv: { ...env } } : {}),
      });
    });
  });
}
