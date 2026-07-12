/**
 * src/daemon/commits-ahead — count commits on a branch not yet on base
 *
 * Factory: makeCommitsAhead({ cwd, runGit }) → commitsAhead(branch, base)
 * Runs: git rev-list --count <base>..<branch>
 * Throws a typed Error on any git failure (never returns 0 on error).
 */

import type { GitResult, RunGitOpts } from "../git/exec.ts";

type RunGitFn = (args: string[], opts: RunGitOpts) => Promise<GitResult>;

export type CommitsAheadOpts = {
  cwd: string;
  runGit: RunGitFn;
};

export function makeCommitsAhead(
  opts: CommitsAheadOpts,
): (branch: string, base: string) => Promise<number> {
  const { cwd, runGit } = opts;
  return async function commitsAhead(
    branch: string,
    base: string,
  ): Promise<number> {
    const range = `${base}..${branch}`;
    const result = await runGit(["rev-list", "--count", range], { cwd });
    if (result.kind !== "success" && result.kind !== "noop") {
      const msg =
        `git rev-list failed for range "${range}": ` +
        (result.stderr.trim() || result.stdout.trim() || result.kind);
      const err = new Error(msg) as NodeJS.ErrnoException;
      err.code = "GIT_REVLIST_FAILED";
      throw err;
    }
    const parsed = parseInt(result.stdout.trim(), 10);
    if (Number.isNaN(parsed)) {
      throw new Error(
        `git rev-list returned non-integer stdout: "${result.stdout.trim()}"`,
      );
    }
    return parsed;
  };
}
