# 014 Real Broker Minimal Path — `git.*` Local Ops & `github.create_pr`

## Outcome

The first real verbs behind the Phase-1 broker seam: the **`git.*` local verb
family** (clone, fetch, branch, commit, push — auto tier) driving the real git CLI
(push over HTTPS + the slot identity's PAT via `http.extraHeader`), and
**`github.create_pr`** (auto-with-audit tier) through the **`GitPlatformAdapter`**
backed **CLI-first by `gh`** (REST `fetch` only as a gap fallback) — each with the
full PRD §5 per-verb contract: `submit`, `poll_status`, terminal states, backoff,
timeout + escalation, and a **reconcile path keyed by external correlation** (branch
name / PR head). Every mutating verb is **gated by a read-only `verifySetup`
preflight**: on failure the broker does not submit — terminal `blocked-needs-setup` +
a `system:setup` inbox item (no half-done op). The Phase-1 broker lifecycle (Epic 005) is
unchanged — these are adapters plugged into it; unit tests stay hermetic (git runs
against local temp repos and bare local remotes; the platform adapter runs against a
hand-written double shaped by the SU2 `gh`-surface findings). The live proof is
Epic 019. Design: `.agent/plan/feedback/014-real-broker-minimal-path/git-platform-adapter.md`.

## Decision Anchors

- phases.md Phase 2A Deliverable 3 — minimal real broker path: `git.*` local ops
  (auto) + `github.create_pr` (auto-with-audit), each with submit, poll_status,
  terminal states, backoff, timeout+escalation, and a reconcile path.
- PRD §5 — each async verb declares submit / poll_status / terminal states /
  backoff / timeout+escalation / rate-limit behavior / whether observed state can
  regress; a verb with no reconcile path cannot be async; idempotency keys on every
  mutating call; never a generic HTTP proxy.
- PRD §5 — durable operation ledger with external correlation (branch / PR) so
  reconciliation queries real remote state → done | failed | resubmit(idempotent)
  | escalate.
- phases.md Security invariant — this Epic's mutating verbs are registered behind
  the Epic 013 outbound scan (dependency, not a claim re-proven here).
- Epic 011 SU1/SU2/SU4/SU7 findings — the git invocation contract, the `gh` command
  surface + idempotency-by-head-branch behavior, the per-identity PAT keyring, and the
  `GitPlatformAdapter` + `verifySetup` seam these adapters code against.

## Stories

- `000-git-platform-foundation.md` — the shared foundation the verb stories build on
  (implements Epic 011 SU7): git execution seam, credential keyring of named
  identities, CLI-first `GitPlatformAdapter` (`gh`), read-only `verifySetup` preflight
  (→ `system:setup` inbox item), and the non-interactive bootstrap CLI. Runs before
  001–003.
- `001-git-local-verb-family.md` — `git.clone/fetch/branch/commit` adapters over
  the git CLI on repo slots; fast local ops still normalized through the async
  lifecycle.
- `002-git-push-and-correlation.md` — `git.push` as the first externally-mutating
  verb: idempotency (pushing the same branch/sha resolves, not double-errors),
  correlation = branch+sha in the ledger, reconcile = query the remote ref.
- `003-github-create-pr-adapter.md` — `github.create_pr` with idempotency-by-head-
  branch, poll_status over PR state, backoff on rate-limit signals, timeout →
  escalation, and reconcile finding an existing PR by head branch.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- Every mutating verb is gated by the read-only `verifySetup` preflight: with a
  failing check (e.g. missing scope) on its double, `submit` is **not** called — the
  op reaches terminal `blocked-needs-setup` and a `system:setup` inbox item names the
  repo/platform/identity + remediation; with checks passing, the verb submits
  normally.
- Each verb has a registry entry declaring the **complete PRD §5 contract** —
  tier, timeout, idempotency, retry/backoff, rate-limit behavior, and
  observed-state-regression policy — with explicit `n/a` values where a
  dimension does not apply (local verbs declare `rate-limit: n/a`), never by
  omission (debate finding); registering any of them without a reconcile path is
  rejected (Epic 005 rule re-checked on the real entries).
- Every mutating verb defines its **desired effect** precisely enough to
  reconcile: `git.branch` = ref at sha; `git.commit` = branch head whose **tree
  hash** matches (content identity — commit sha is not reproducible across
  retries); `git.push` = remote ref at sha; `github.create_pr` = open PR for
  head branch (debate finding — reconcile is only as good as the effect
  definition).
- The `git.push` **diff content** (branch vs remote base) passes the Epic 013
  scanner before submit — the repository bytes leaving the machine are scanned,
  not only the request payload (debate finding; Epic 013 outbound-surface item
  2).
- On a temp repo with a local bare remote: submit `git.branch` + `git.commit` +
  `git.push` through the broker → the bare remote has the branch at the commit;
  the completion rows appear via the Epic 005 poll lifecycle (no bypass).
- Re-submitting `git.push` with the same idempotency key (same branch+sha)
  resolves to the same `op_id` and the remote is unchanged — no double-push error
  escalation.
- `github.create_pr` against the adapter double (a fake `gh` shaped by the SU2
  findings): submit creates the PR and records the PR number as correlation;
  poll_status reaches terminal `done` when the double reports the PR open; a
  rate-limited response backs off per the registry entry (fake clock); a double that
  never responds hits the per-verb timeout and emits the escalation-needed state.
- **Crash mid-create_pr reconciles by correlation:** ledger says in-flight, double
  holds an already-created PR for the head branch ⇒ reconcile resolves `done`
  without creating a second PR; double holds no PR ⇒ idempotent resubmit creates
  one; double reports a closed-by-human PR ⇒ escalate (each branch asserted —
  this is the hermetic version of the 2A checkpoint criterion).
- All tests hermetic: git against local paths only; GitHub against the in-process
  double; the Phase-1 no-network guard stays green for the harness suite.

## Dependencies

- **Epic 005** (broker lifecycle, ledger, reconciliation machinery — adapters plug
  in). **Epic 013** (outbound scan + breaker active on the submit path — ordering
  gate). **Epic 011 SU1/SU2/SU4** (git findings, GitHub findings, credential
  custody). **Epic 012** (real store for the durable ledger).
- **Honesty note (debate finding):** "adapters plug in, lifecycle unchanged" is
  the intent, not a guarantee — these are the first real verbs to exercise
  desired-effect hashing, external correlation, and idempotent resubmit under
  load. If an adapter forces a lifecycle/ledger change, that is a seam
  correction: short decision record + harness update, per phases.md — not a
  silent edit.

## Non-Goals

- No other verb families (`jira.*`, `github.merge`, `github.create_issue`,
  observers) — Epic 022 (Phase 2B).
- No approval-tier enforcement UI — `github.create_pr` is auto-with-audit;
  approval routing is Epic 017.
- No webhooks — completion detection stays poll-only (PRD §5).
- No worktree management — `git.*` verbs operate on paths the repo-slot layer
  (Epic 016) hands them; slot/worktree lifecycle is Epic 016.
- The GitHub adapter double (fake `gh`) models only the surfaces the SU2 findings record
  (create, get-by-number, list-by-head, rate-limit shape) — it is a test double,
  not a GitHub emulator.

## Findings Out

- If the SU2-recorded API behavior diverges once the double meets reality in Epic
  019's live proof, the correction is a decision record + double update
  (phases.md — 2A is expected to correct contract hypotheses); write it to
  `.agent/plan/feedback/014-real-broker-minimal-path/live-corrections.md`.
