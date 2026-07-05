# SU2 GitHub Platform API Path — Findings

Date: 2026-07-05 (revised — supersedes the first-pass "plain fetch REST" decision).
Status: **VERIFIED live** (2026-07-05) against `kanthorlabs/kanthord-verify` with a
repo-scoped fine-grained PAT — see "Live spike evidence" at the bottom. The
hypotheses below held, with two refinements noted there (`gh pr create` has no
`--json`; duplicate-create exits non-zero).

> **Decision changed (Ulrich's steer):** the GitHub platform API is driven
> **CLI-first via `gh`**, not plain `fetch`. See the consolidated design in
> **`git-platform-adapter.md`** (CLI-first rule, `GitPlatformAdapter` interface,
> keyring, verifySetup, deployment). This file records the GitHub-specific `gh`
> command surface + the error/rate-limit taxonomy, and keeps the REST detail as the
> **fallback reference** for any op `gh` cannot do.

## Decision

Back the GitHub `GitPlatformAdapter` with the **`gh` CLI**. REST (`fetch`) is a
fallback only for a gap operation. No hand-rolled REST client is written up front.
The token is fed per-invocation via **`GH_TOKEN` env** from the keyring (never
`gh auth login`). Always pass **`--repo owner/name`** (never infer from cwd).

Why `gh` over plain `fetch`: the CLI covers the 2A surface, so CLI-first is less
setup, one execution model with the git CLI, and `gh` is the hardened official tool
tracking the API. The broker still owns retry/backoff/timeout (each `gh` call = one
attempt).

## `gh` command surface (2A)

- **Create PR:** `gh pr create --repo O/R --head <branch> --base <base>
  --title ... --body ... [--draft] --json number,url,state`.
- **Get PR by number:** `gh pr view <number> --repo O/R --json number,state,mergedAt,...`.
- **Find PR by head (reconcile key):**
  `gh pr list --repo O/R --head <branch> --state all --json number,state,...`
  (`--state all` so closed/merged PRs are visible for the escalate branch).
- **REST fallback (if ever needed):** `gh api` (still auth'd via `GH_TOKEN`), or plain
  `fetch` to `https://api.github.com` with `Authorization: Bearer`,
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, a
  `User-Agent`, and `AbortSignal.timeout()`.

## Error taxonomy — from `gh` exit code + stderr/`--json`

The taxonomy the broker's poll/backoff/timeout/reconcile codes against (retryable /
terminal / escalate), now sourced from the CLI rather than HTTP status:

- **Duplicate PR:** `gh pr create` non-zero exit, stderr "a pull request for branch
  ... already exists" → **not an error**: run `gh pr list --head` → existing number
  → `done` (idempotency-by-head). **terminal-success-via-reconcile**.
- **Auth failure:** `gh` non-zero, "HTTP 401" / "Bad credentials" (or
  `gh auth status` fails) → **escalate** (credential problem). Distinct shapes still
  matter (401 bad creds vs 403 "Resource not accessible" vs SSO vs fine-grained scope
  vs deleted token) — record each; all escalate, remediation differs.
- **Rate limit:** `gh` surfaces "API rate limit exceeded" / "secondary rate limit" and
  honors it. For the broker: **retryable with mandated delay** — read the reset via
  `gh api -i rate_limit` / `x-ratelimit-*` + `retry-after` when a delay must be
  computed. `retry-after` takes precedence; compute skew from the server `Date`;
  min/max delay + jitter; the broker persists the scheduled-retry time.
- **5xx / network / timeout** → **retryable** (backoff).
- **404** → terminal (repo/PR not found).
- **Validation (no commits between base/head; invalid base; deleted head)** → terminal
  / escalate.

## Reconcile states (found via `gh pr list/view`, not create errors)

Keyed by head branch: open PR → **done**; closed-not-merged, no open → **escalate**
(human closed it; do not recreate — Epic 014 gate); merged → **done**.

## Same-repo constraint

`--head <branch>` assumes the branch is in the target repo (Epic 014 creates branches
in the target repo; no forks). Cross-fork would need the head-repo owner in the key.

## Dependency

`gh` is a **binary in the container image** (not an npm dep); pin its version and
enforce a min-version in `verifySetup`. `package.json`/lockfile unchanged. If a gap
op forces the REST fallback, that uses Node's built-in `fetch` (still no dep).

## Live spike evidence (2026-07-05)

`scripts/dev/probes/su2-su5-gh-spike.sh` against `kanthorlabs/kanthord-verify`
(throwaway), PAT scoped to that repo (Contents+PR write), `gh 2.88.1`. Redacted:

- **Create PR:** `gh pr create --repo O/R --head <b> --base main --title … --body …`
  → prints `https://github.com/kanthorlabs/kanthord-verify/pull/2`, exit 0.
  **Refinement:** `gh pr create` has **no `--json` flag** (any version) — read the
  created PR structurally via `gh pr list --head` (below), not from create.
- **Find by head (reconcile key):**
  `gh pr list --repo O/R --head <b> --state all --json number,state,headRefName,url`
  → `[{"headRefName":"probe/su-…","number":2,"state":"OPEN","url":"…/pull/2"}]`, exit 0.
- **Get PR by number:**
  `gh pr view 2 --repo O/R --json number,state,mergedAt,isDraft,headRefName`
  → `{"headRefName":"probe/su-…","isDraft":false,"mergedAt":null,"number":2,"state":"OPEN"}`, exit 0.
- **Duplicate create (idempotency-by-head):** re-`gh pr create` on the same head →
  stderr `a pull request for branch "probe/su-…" into branch "main" already exists:`
  + the existing URL, **exit 1** (non-zero — confirms the taxonomy: detect the
  message / prefer `pr list --head` first, then `done`).
- **Auth failure shape:** `GH_TOKEN=bogus gh pr list` →
  `HTTP 401: Bad credentials (https://api.github.com/graphql)`, exit 1 → escalate.
- **Rate-limit signal:** `gh api -i rate_limit` returns `X-Ratelimit-Limit: 5000`,
  `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`, `X-Ratelimit-Resource: core`,
  `X-Ratelimit-Used`; body `{"limit":5000,"remaining":…,"reset":…,"used":…}`.
  (`Retry-After` is advertised in `Access-Control-Expose-Headers` for the throttled
  case.)

Corrections land per the phases.md seam-correction rule (`live-corrections.md`).
