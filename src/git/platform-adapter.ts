/**
 * src/git/platform-adapter — GitPlatformAdapter (gh-backed) (Story 000 / Task T3)
 *
 * Exports:
 *   - GitPlatformAdapter  — interface for platform operations
 *   - CreatePrOpts        — options for creating a pull request
 *   - PrRef               — { number, url }
 *   - PrState             — { number, url, state }
 *   - PlatformError       — typed error with taxonomy field
 *   - GhAdapterOpts       — configuration for GhAdapter
 *   - GhAdapter           — class implementing GitPlatformAdapter using the gh CLI
 *
 * Security invariants:
 *   - GH_TOKEN is injected only into the child env per-invocation.
 *   - GH_CONFIG_DIR is set to configDir in child env to isolate gh state.
 *   - process.env is never mutated.
 */

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GitPlatformAdapter {
  createPr(opts: CreatePrOpts): Promise<PrRef>;
  getPr(number: number, token: string): Promise<PrState>;
  findPrByHead(branch: string, token: string): Promise<PrRef | undefined>;
}

export type CreatePrOpts = {
  head: string;
  base: string;
  title: string;
  body: string;
  token: string;
};

export type PrRef = {
  number: number;
  url: string;
};

export type PrState = {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
};

export type GhAdapterOpts = {
  repo: string;
  ghBin: string;
  configDir: string;
};

// ---------------------------------------------------------------------------
// PlatformError
// ---------------------------------------------------------------------------

export class PlatformError extends Error {
  taxonomy: "escalate" | "retryable-with-delay" | "terminal";

  constructor(
    taxonomy: "escalate" | "retryable-with-delay" | "terminal",
    message: string,
  ) {
    super(message);
    this.name = "PlatformError";
    this.taxonomy = taxonomy;
  }
}

// ---------------------------------------------------------------------------
// GhAdapter
// ---------------------------------------------------------------------------

type SpawnResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

/**
 * Spawn the gh CLI binary and capture stdout/stderr.
 * The token is passed via GH_TOKEN in the child env — never in process.env.
 */
function runGh(
  ghBin: string,
  args: string[],
  token: string,
  configDir: string,
): Promise<SpawnResult> {
  // Build an isolated child env: inherit a minimal set from process.env,
  // then add GH_TOKEN and GH_CONFIG_DIR.
  const childEnv: Record<string, string> = {};

  // Pass through PATH so the binary can be found/executed
  if (process.env["PATH"] !== undefined) {
    childEnv["PATH"] = process.env["PATH"];
  }
  if (process.env["HOME"] !== undefined) {
    childEnv["HOME"] = process.env["HOME"];
  }

  // Set token and config dir per-invocation only
  childEnv["GH_TOKEN"] = token;
  childEnv["GH_CONFIG_DIR"] = configDir;

  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(ghBin, args, {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
      });
    });
  });
}

/**
 * Classify gh CLI error output into a PlatformError taxonomy.
 */
function classifyGhError(stderr: string): PlatformError {
  const lower = stderr.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("authentication") ||
    lower.includes("bad credentials")
  ) {
    return new PlatformError(
      "escalate",
      `gh authentication failure: ${stderr.trim()}`,
    );
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("secondary rate") ||
    lower.includes("429")
  ) {
    return new PlatformError(
      "retryable-with-delay",
      `gh rate limit: ${stderr.trim()}`,
    );
  }

  return new PlatformError("terminal", `gh command failed: ${stderr.trim()}`);
}

export class GhAdapter implements GitPlatformAdapter {
  private repo: string;
  private ghBin: string;
  private configDir: string;

  constructor(opts: GhAdapterOpts) {
    this.repo = opts.repo;
    this.ghBin = opts.ghBin;
    this.configDir = opts.configDir;
  }

  /**
   * Create a pull request. On duplicate-PR error, falls back to findPrByHead.
   */
  async createPr(opts: CreatePrOpts): Promise<PrRef> {
    const args = [
      "pr", "create",
      "--repo", this.repo,
      "--head", opts.head,
      "--base", opts.base,
      "--title", opts.title,
      "--body", opts.body,
      "--json", "number,url",
    ];

    const result = await runGh(this.ghBin, args, opts.token, this.configDir);

    if (result.exitCode === 0) {
      const parsed = JSON.parse(result.stdout) as { number: number; url: string };
      return { number: parsed.number, url: parsed.url };
    }

    // Check for duplicate PR error
    const stderrLower = result.stderr.toLowerCase();
    if (
      stderrLower.includes("already exists") ||
      stderrLower.includes("a pull request for branch")
    ) {
      const existing = await this.findPrByHead(opts.head, opts.token);
      if (existing !== undefined) {
        return existing;
      }
    }

    throw classifyGhError(result.stderr);
  }

  /**
   * Get PR details by number.
   */
  async getPr(number: number, token: string): Promise<PrState> {
    const args = [
      "pr", "view",
      String(number),
      "--repo", this.repo,
      "--json", "number,url,state",
    ];

    const result = await runGh(this.ghBin, args, token, this.configDir);

    if (result.exitCode === 0) {
      const parsed = JSON.parse(result.stdout) as {
        number: number;
        url: string;
        state: string;
      };
      return {
        number: parsed.number,
        url: parsed.url,
        state: parsed.state.toLowerCase() as "open" | "closed" | "merged",
      };
    }

    throw classifyGhError(result.stderr);
  }

  /**
   * Find an existing PR by head branch using --state all.
   * Returns undefined if no PR is found.
   */
  async findPrByHead(
    branch: string,
    token: string,
  ): Promise<PrRef | undefined> {
    const args = [
      "pr", "list",
      "--repo", this.repo,
      "--head", branch,
      "--state", "all",
      "--json", "number,url",
    ];

    const result = await runGh(this.ghBin, args, token, this.configDir);

    if (result.exitCode === 0) {
      const list = JSON.parse(result.stdout) as Array<{
        number: number;
        url: string;
      }>;
      if (list.length === 0) {
        return undefined;
      }
      const first = list[0];
      if (first === undefined) {
        return undefined;
      }
      return { number: first.number, url: first.url };
    }

    throw classifyGhError(result.stderr);
  }
}
