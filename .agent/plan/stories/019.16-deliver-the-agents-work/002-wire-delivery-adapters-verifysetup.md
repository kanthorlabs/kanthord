# Story 002 - wire delivery adapters with a verifySetup preflight

Epic: `.agent/plan/epics/019.16-deliver-the-agents-work.md`

## Goal

The live config builds the `git.add` / `git.commit` / `git.push` /
`github.create_pr` broker adapters with a real `verifySetup` preflight, so their
`submit` runs the underlying `git` / GitHub-REST effect instead of returning
`blocked-needs-setup`. With Story 001's commit landing `commitsAhead > 0`, the
broker then pushes `taskBranch` and opens a real PR on `kanthord-verify`.

## Acceptance Criteria

- A delivery preflight helper returns a `VerifyReport` with `ok: true` when the
  git+REST delivery path is usable — `git` is runnable in the checkout and the
  identity token is present — and `ok: false` (with a setup inbox item) otherwise.
  It does **not** require the `gh` CLI (the live create_pr uses the GitHub REST
  http seam, not `gh`).
- In the async `buildRealDeps` path, each delivery adapter (`git.add`,
  `git.commit`, `git.push`, `github.create_pr`) is constructed **with** this
  preflight as its `verifySetup`. As a result, an adapter's `submit` no longer
  short-circuits to `blocked-needs-setup` when setup is valid — it runs the git /
  REST effect.
- Behavior proof (hermetic): a `git.commit` adapter built with a passing preflight,
  submitted against a temp repo with staged changes, produces a real commit
  (`poll_status` → `done`, `HEAD` advanced); a `git.push` adapter built with a
  passing preflight pushes a branch to a bare remote; the same adapter built with a
  **failing** preflight returns `blocked-needs-setup` and does **not** push.
- Live proof (Epic gate, LP-A1): after Story 001's commit, the broker pushes
  `taskBranch` to the remote and opens a **real PR** on `kanthord-verify` (base
  `main`, head `taskBranch`).

## Constraints

- **Reuse the `VerifyReport` contract** from `src/git/verify-setup.ts` (its
  interfaces/shape) rather than inventing a parallel report type. The full
  `verifySetup()` does not fit (its `gh`-CLI + scope checks are irrelevant to the
  REST create_pr path and would false-block); mirror only the git-availability +
  token check adapted to this seam (`CLAUDE.local.md` reuse rule #2; memory
  `git-platform-integration-approach` — REST for gaps).
- **Wire at construction** — the preflight is threaded into
  `makeAddAdapter` / `makeCommitAdapter` / `makePushAdapter` / `makeCreatePrAdapter`
  where they are built in `run-deps.ts` (the async identity path); no change to the
  adapters' own gate logic.
- **Fail-closed on bad setup** — a failing preflight must still yield
  `blocked-needs-setup` (never a silent success). The preflight decides delivery
  readiness; it does not weaken the existing gate.
- **Token already plumbed** — the identity token is loaded by the async
  `buildRealDeps` path; the preflight uses it, no new secret handling.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  `git-local` / `git-push` / `github-create-pr` / `run-deps` / `bootstrap-live-run`
  tests pass; guard green.

### Task T1 - delivery preflight helper

**Input:** `src/git/delivery-preflight.ts` (new),
`src/git/delivery-preflight.test.ts` (new)

**Action - RED:** a hermetic test builds the preflight for a temp checkout with a
non-empty token and asserts the returned function resolves a `VerifyReport` with
`ok: true`; a second case (empty token, or a `runGit` fake that fails the git
check) asserts `ok: false` with a non-empty `inboxItems`. Fails today (module
absent).

**Action - GREEN:** create `makeDeliveryVerifySetup(opts: { token: string; gitBin:
string; cwd: string; runGit?: RunGitSeam }): () => Promise<VerifyReport>` — returns
`ok: true` when a git probe (e.g. `git --version` / `rev-parse`) succeeds and
`token` is non-empty; otherwise `ok: false` with a `SetupInboxItem`. Reuse the
`VerifyReport` / `SetupInboxItem` types from `verify-setup.ts`.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/git/delivery-preflight.test.ts` green.

### Task T2 - build the live delivery adapters with the preflight

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a test on the async `buildRealDeps` path asserts that the
`git.commit` (and `git.push`) adapter in the returned `verbAdapters`, when
submitted against a temp repo with staged changes / a bare remote, performs the
real effect (`poll_status` → `done`, commit created / branch pushed) rather than
returning `blocked-needs-setup`. Fails today (adapters built without `verifySetup`
→ `blocked-needs-setup`).

**Action - GREEN:** in `run-deps.ts`, construct the delivery preflight via
`makeDeliveryVerifySetup({ token, gitBin: "git", cwd: <checkout dir> })` and pass it
as `verifySetup` to `makeAddAdapter` / `makeCommitAdapter` / `makePushAdapter` /
`makeCreatePrAdapter`. Keep the `git.branch` adapter's construction as-is unless the
same preflight applies.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green.

### Task T3 - bootstrap-live-run threads the checkout dir for the preflight

**Input:** `src/cli/bootstrap-live-run.ts`, `src/cli/bootstrap-live-run.test.ts`

**Action - RED:** a test asserts that the `LiveRunDeps` returned by
`bootstrapLiveRun` carries delivery adapters whose `verifySetup` is satisfied for
the bootstrapped checkout — i.e. submitting `git.commit` against the checkout after
staging a change produces a commit (not `blocked-needs-setup`). Fails today
(adapters carry no preflight). If `buildRealDeps` already receives the checkout dir,
this may reduce to asserting the wired preflight passes end to end.

**Action - GREEN:** ensure `bootstrap-live-run.ts` passes the checkout dir needed by
the preflight into `buildRealDeps` (add a `checkoutDir`/`cwd` field to
`BuildRealDepsOpts` if not already threaded), so the delivery preflight probes the
real checkout. No other behavior change.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/bootstrap-live-run.test.ts` green.
