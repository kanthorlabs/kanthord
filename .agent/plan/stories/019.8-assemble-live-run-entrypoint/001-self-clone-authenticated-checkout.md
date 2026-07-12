# Story 001 - self-clone into a PAT-authenticated local checkout

Epic: `.agent/plan/epics/019.8-assemble-live-run-entrypoint.md`

## Goal

The daemon clones the slot repo (a URL) into a local checkout under the data root
and configures HTTPS auth with the identity token, so subsequent fetch/push work
without an operator pre-clone. Reuses the existing `git.clone` adapter; adds only
the orchestration + auth config.

## Acceptance Criteria

- A `bootstrapLocalCheckout({ repoUrl, identityToken, checkoutDir, runGit })`
  function clones `repoUrl` into `checkoutDir` when it is not already a git repo,
  and is **re-run-safe**: when `checkoutDir` already holds a clone of that repo it
  succeeds without re-cloning and leaves the working tree untouched.
- After bootstrap, the checkout is configured so `git fetch`/`git push` over HTTPS
  authenticate using the identity token via `http.extraHeader` — the token is
  present in the repo's local git config header, and is **not** written into the
  persisted remote URL (`git remote get-url origin` contains no token).
- The function returns the local checkout path, which the caller uses as the repo
  root (for `featureDir`/db derivation and per-task worktrees).
- The token never appears in a thrown error, a log line, or the remote URL.

## Constraints

- **Reuse the `git.clone` adapter / `runGit` seam** — no reimplemented clone; the
  clone is re-run-safe per the adapter's existing contract.
- **HTTPS auth via `http.extraHeader`** (SU1 custody posture) — configure
  `http.extraHeader` = `Authorization: Basic <base64("x-access-token:<token>")>`
  (or `Bearer <token>`), set on the local checkout only; never embed the token in
  the remote URL. Cite SU1.
- **Injected `runGit`** — the function takes the git runner as a seam so the
  hermetic test drives it against a local bare repo (temp-remote pattern); no real
  network under `npm test`.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — clone + auth-config test passes
  against a local bare "remote"; guard green.

### Task T1 - bootstrapLocalCheckout (clone + auth config)

**Input:** `src/slots/local-checkout.ts`, `src/slots/local-checkout.test.ts`

**Action - RED:** a hermetic test creates a local **bare** git repo (with a commit)
as the "remote", then calls `bootstrapLocalCheckout({ repoUrl: <bare path>,
identityToken: "tkn_fake", checkoutDir: <temp>, runGit })` and asserts: the
checkout is a git repo with the seed commit; `http.extraHeader` in the checkout's
config carries the token; `git remote get-url origin` contains **no** token; a
second call is a no-op (re-run-safe) and does not error. Also asserts a thrown
error (e.g. bad path) carries no token.

**Action - GREEN:** implement `bootstrapLocalCheckout` in
`src/slots/local-checkout.ts`: clone when absent (via the git.clone adapter or
`runGit(["clone", ...])`), then `runGit(["config", "http.extraHeader",
<auth-header>])` on the checkout; return the path. Re-run-safe when the checkout
exists.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/slots/local-checkout.test.ts` green.
