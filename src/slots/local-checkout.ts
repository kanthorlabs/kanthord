/**
 * src/slots/local-checkout — Bootstrap a PAT-authenticated local clone
 * Story 001 / Task T1
 *
 * SU1 custody posture: the identity token is never written to the remote URL.
 * HTTPS auth is configured via `http.extraHeader` (local checkout config only).
 */

import { dirname } from "node:path";
import type { GitResult, RunGitOpts } from "../git/exec.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BootstrapLocalCheckoutOpts = {
  repoUrl: string;
  identityToken: string;
  checkoutDir: string;
  runGit: (args: string[], opts: RunGitOpts) => Promise<GitResult>;
};

// ---------------------------------------------------------------------------
// bootstrapLocalCheckout
// ---------------------------------------------------------------------------

/**
 * Clone `repoUrl` into `checkoutDir` when not already a git repo, then set
 * `http.extraHeader` in the checkout's local config for HTTPS auth.
 *
 * Re-run-safe: when `checkoutDir` already holds a clone, the clone step is
 * skipped and only the header config is (re-)applied.
 *
 * The identity token is never written into the persisted remote URL, and
 * never appears in a thrown error.
 *
 * Returns the `checkoutDir` path.
 */
export async function bootstrapLocalCheckout(
  opts: BootstrapLocalCheckoutOpts,
): Promise<string> {
  const { repoUrl, identityToken, checkoutDir, runGit } = opts;

  // Re-run-safe guard: check whether checkoutDir is already a git repo.
  // If rev-parse succeeds, skip the clone entirely so the tree is untouched.
  const checkResult = await runGit(
    ["rev-parse", "--git-dir"],
    { cwd: checkoutDir },
  );
  const alreadyCloned =
    checkResult.kind === "success" || checkResult.kind === "noop";

  if (!alreadyCloned) {
    // Clone into checkoutDir (which may not exist yet). Use the parent dir as
    // cwd — it must already exist, which is guaranteed by the data-root setup.
    const cloneResult = await runGit(
      ["clone", repoUrl, checkoutDir],
      { cwd: dirname(checkoutDir) },
    );

    if (cloneResult.kind !== "success" && cloneResult.kind !== "noop") {
      // Redact the token before surfacing the error — token must never appear
      // in a thrown error (SU1 custody posture).
      const raw =
        cloneResult.stderr.trim() ||
        cloneResult.stdout.trim() ||
        "git clone failed";
      const msg = raw.split(identityToken).join("[REDACTED]");
      throw new Error(msg);
    }
  }

  // Configure HTTPS auth: token as Authorization header in local checkout
  // config — never in the remote URL (SU1).
  const b64 = Buffer.from(`x-access-token:${identityToken}`).toString("base64");
  const authHeader = `Authorization: Basic ${b64}`;

  const configResult = await runGit(
    ["config", "--local", "http.extraHeader", authHeader],
    { cwd: checkoutDir },
  );

  if (configResult.kind !== "success" && configResult.kind !== "noop") {
    const raw = configResult.stderr.trim() || "git config failed";
    throw new Error(raw.split(identityToken).join("[REDACTED]"));
  }

  return checkoutDir;
}
