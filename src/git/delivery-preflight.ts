/**
 * src/git/delivery-preflight — lightweight delivery preflight for the git+REST path
 *
 * Exports:
 *   - DeliveryPreflightOpts — input options
 *   - makeDeliveryVerifySetup — factory returning () => Promise<VerifyReport>
 *
 * Checks:
 *   1. Identity token is non-empty.
 *   2. Git binary is runnable (via injected or default runGit seam).
 *
 * Intentionally narrower than verifySetup(): the gh CLI and scope checks are
 * irrelevant here — the live create_pr uses the GitHub REST http seam, not gh.
 */

import type { VerifyReport, SetupInboxItem, RunGitSeam } from "./verify-setup.ts";
import { runGit as defaultRunGit } from "./exec.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DeliveryPreflightOpts = {
  token: string;
  gitBin: string;
  cwd: string;
  runGit?: RunGitSeam;
};

// ---------------------------------------------------------------------------
// makeDeliveryVerifySetup
// ---------------------------------------------------------------------------

/**
 * Returns a preflight function `() => Promise<VerifyReport>` suitable for
 * passing as `verifySetup` to delivery adapters (makeAddAdapter,
 * makeCommitAdapter, makePushAdapter, makeCreatePrAdapter).
 *
 * Resolves `ok: true` when:
 *   - `token` is non-empty, AND
 *   - git is runnable (probe via the injected seam or the default runGit).
 *
 * Resolves `ok: false` with a single `system:setup` inbox item otherwise.
 */
export function makeDeliveryVerifySetup(
  opts: DeliveryPreflightOpts,
): () => Promise<VerifyReport> {
  return async (): Promise<VerifyReport> => {
    const { token, gitBin, cwd } = opts;
    const effectiveRunGit: RunGitSeam = opts.runGit ?? defaultRunGit;

    // Check 1: token must be present
    if (token.length === 0) {
      const item: SetupInboxItem = {
        kind: "system:setup",
        message: "Delivery setup required: identity token is missing",
        details:
          "A GitHub identity token is required to push branches and open pull requests.",
        remediation:
          "Configure a GitHub PAT with the 'repo' scope in the identity keyring.",
      };
      return {
        platform: "delivery",
        repo: "",
        identity: "",
        ok: false,
        checks: [],
        inboxItems: [item],
      };
    }

    // Check 2: git must be runnable
    const gitResult = await effectiveRunGit(["--version"], { cwd, gitBin });
    if (gitResult.kind !== "success") {
      const item: SetupInboxItem = {
        kind: "system:setup",
        message: "Delivery setup required: git is not runnable",
        details: `git probe returned ${gitResult.kind}: ${gitResult.stderr || "(no stderr)"}`,
        remediation: "Install git >= 2.31 and ensure it is on PATH.",
      };
      return {
        platform: "delivery",
        repo: "",
        identity: "",
        ok: false,
        checks: [],
        inboxItems: [item],
      };
    }

    return {
      platform: "delivery",
      repo: "",
      identity: "",
      ok: true,
      checks: [],
      inboxItems: [],
    };
  };
}
