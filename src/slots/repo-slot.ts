/**
 * src/slots/repo-slot — Repo slot registry + registration validation
 * Story 001 — Repo Slots & Worktrees
 * Task T1 — Slot registry + registration validation
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { GitResult, RunGitOpts } from "../git/exec.ts";
import { runGit } from "../git/exec.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RepoSlot {
  repo: string;
  strategy: "worktree";
  maxConcurrentTasks: number;
  workflowsAllowed: string[];
  identity: string;
  committer?: { name: string; email: string };
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a slot yaml file fails validation (unknown strategy, missing
 * required fields). The message always includes the yaml file path.
 */
export class SlotConfigError extends Error {
  constructor(yamlPath: string, reason: string) {
    super(`Slot config error in ${yamlPath}: ${reason}`);
    this.name = "SlotConfigError";
  }
}

/**
 * Thrown when the repo path referenced in the slot yaml is not a git
 * repository or does not exist. Thrown at registration time.
 */
export class SlotRegistrationError extends Error {
  constructor(repoPath: string, reason: string) {
    super(`Slot registration error for repo "${repoPath}": ${reason}`);
    this.name = "SlotRegistrationError";
  }
}

// ---------------------------------------------------------------------------
// Git seam (injectable for tests — defaults to the real runGit)
// ---------------------------------------------------------------------------

export type RunGitFn = (args: string[], opts: RunGitOpts) => Promise<GitResult>;

// ---------------------------------------------------------------------------
// loadRepoSlot
// ---------------------------------------------------------------------------

/**
 * Parse and validate a per-repo slot yaml file. Runs `git rev-parse
 * --is-inside-work-tree` against the repo path to confirm it is a git
 * repository before returning.
 *
 * @param yamlPath - Absolute path to the slot yaml file.
 * @param runGitFn - Optional git seam override (defaults to `runGit`).
 * @throws {SlotConfigError}       Invalid/missing yaml fields.
 * @throws {SlotRegistrationError} Repo path is not a git repository or absent.
 */
export async function loadRepoSlot(
  yamlPath: string,
  runGitFn: RunGitFn = runGit,
): Promise<RepoSlot> {
  // 1. Read + parse yaml
  let text: string;
  try {
    text = await readFile(yamlPath, "utf8");
  } catch (err) {
    throw new SlotConfigError(
      yamlPath,
      `cannot read file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new SlotConfigError(
      yamlPath,
      `invalid yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new SlotConfigError(yamlPath, `expected a yaml mapping`);
  }

  const raw = parsed as Record<string, unknown>;

  // 2. Validate required fields

  if (!("repo" in raw) || typeof raw["repo"] !== "string" || !raw["repo"]) {
    throw new SlotConfigError(yamlPath, `missing or empty required field "repo"`);
  }
  const repo = raw["repo"];

  if (!("strategy" in raw)) {
    throw new SlotConfigError(yamlPath, `missing required field "strategy"`);
  }
  if (raw["strategy"] !== "worktree") {
    throw new SlotConfigError(
      yamlPath,
      `unsupported strategy "${String(raw["strategy"])}"; only "worktree" is supported`,
    );
  }

  const maxConcurrentTasks =
    typeof raw["max_concurrent_tasks"] === "number"
      ? raw["max_concurrent_tasks"]
      : 1;

  const workflowsAllowed: string[] = Array.isArray(raw["workflows_allowed"])
    ? (raw["workflows_allowed"] as unknown[]).map(String)
    : [];

  if (!("identity" in raw) || typeof raw["identity"] !== "string" || !raw["identity"]) {
    throw new SlotConfigError(yamlPath, `missing or empty required field "identity"`);
  }
  const identity = raw["identity"];

  // Parse optional committer block
  let committer: { name: string; email: string } | undefined;
  if (
    "committer" in raw &&
    raw["committer"] !== null &&
    typeof raw["committer"] === "object"
  ) {
    const c = raw["committer"] as Record<string, unknown>;
    if (typeof c["name"] === "string" && typeof c["email"] === "string") {
      committer = { name: c["name"], email: c["email"] };
    }
  }

  // 3. Remote-URL repos are accepted as-is — no local work-tree check possible.
  //    Detect by shape: https?://, ssh://, git@host:, or *.git on a URL-like path.
  if (
    /^https?:\/\//.test(repo) ||
    /^ssh:\/\//.test(repo) ||
    /^git@[^:]+:/.test(repo) ||
    (!repo.startsWith("/") && repo.endsWith(".git") && repo.includes("/"))
  ) {
    return { repo, strategy: "worktree", maxConcurrentTasks, workflowsAllowed, identity, committer };
  }

  // 4. Validate local repo path is a git work-tree via the git seam

  const result = await runGitFn(
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: repo },
  ).catch((err: unknown) => {
    throw new SlotRegistrationError(
      repo,
      `git check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  if (result.kind !== "success") {
    throw new SlotRegistrationError(
      repo,
      `path is not inside a git work tree (git exited: ${result.kind}; stderr: ${result.stderr.trim()})`,
    );
  }

  return {
    repo,
    strategy: "worktree",
    maxConcurrentTasks,
    workflowsAllowed,
    identity,
    committer,
  };
}
