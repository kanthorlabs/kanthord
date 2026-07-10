# Phase-2A Single-Repo Proof — Run Record

Sandbox repo: `kanthorlabs/kanthord-verify` (throwaway; no production code). The
daemon uses the **HTTPS** remote (`https://github.com/kanthorlabs/kanthord-verify.git`)
with a per-identity PAT; humans may clone via SSH.

> This file is the Epic 019 proof-run record. The **preamble** below (SU5 posture)
> is authored now, during Epic 011 setup. The **LP1–LP5 results** are filled in by
> the maintainer during the live proof, following the evidence format in the Epic
> 019 authoring (date, repo URL, PR URL(s), commit SHA(s), command outputs,
> ledger/inbox excerpts, verify exit code, decision-record links).

## Preamble — SU5 proof-run posture

Status: **posture defined**; the mutating setup (repo creation, per-identity PAT,
ruleset, push/PR/merge-reject cycle) is maintainer-executed and its sanitized
evidence is recorded here before LP1.

### Credentials (custody = SU4; model = git-platform-adapter.md)

- **One per-identity fine-grained PAT over HTTPS** does both transport and API
  (revised — the earlier SSH deploy-key split is dropped). Scoped to
  `kanthord-verify` **only** (no org access) — Contents: write, Pull requests: write.
  - **Transport:** `git push` over HTTPS with the token via `http.extraHeader` (SU1).
  - **API:** `gh` with the token via `GH_TOKEN` env (SU2, CLI-first).
- Custodied per SU4 (keyring identity, fail-closed, value-redacted). The token cannot
  merge — that boundary is branch protection (below), not token scope.

### Branch protection / human-only merge (the merge boundary)

Merge denial is **not** enforced by token/key scope (a write credential overlaps
push). It is enforced by a GitHub **repository ruleset** (or classic branch
protection) on `main`:

- pull request required before merging;
- **required approval from a non-daemon actor** (a human);
- direct pushes to `main` blocked;
- **no bypass actors** for the daemon identity (the per-identity PAT);
- **admin bypass disabled**.

Verified by: a daemon-token `PUT /repos/kanthorlabs/kanthord-verify/pulls/{n}/merge`
attempt is **rejected** — record the HTTP status + redacted body as the proof.

### Repo-slot registration (PROPOSED — schema owned by Epic 016 story 001)

The slot loader does not exist yet (Epic 016). This is the **proposed** shape,
matching that story's `repo / strategy / max_concurrent_tasks / workflows_allowed`;
it lives in `.data/` (local, git-ignored) and registration verification waits for the
Epic 016 loader:

```yaml
# .data/kanthord/slots/kanthord-verify.yaml  (proposed; not verification-ready)
repo: https://github.com/kanthorlabs/kanthord-verify.git   # HTTPS (per-identity PAT auth)
identity: kanthordverify                                    # keyring identity for this slot
strategy: worktree
max_concurrent_tasks: 1
workflows_allowed: [tdd@1]
```

### Cleanup policy

Every proof branch and PR is **closed and its branch deleted** after each run; the
repo is throwaway and may be reset between proof runs.

### SU5 verify (maintainer-run, sanitized evidence pasted here)

- [x] slot yaml **exists** at `.data/kanthord/slots/kanthord-verify.yaml` (git-ignored, confirmed via `git check-ignore`, 2026-07-05).
- [ ] slot yaml **loads + registration succeeds** (git-repo validation via the SU1 seam) — **DEFERRED to Epic 016**: the loader is Epic 016 story 001 and does not exist yet, so this is a consuming-epic AC, not an Epic-011 maintainer check.
- [x] manual branch push → open PR (`gh pr create`) → close PR cycle with the per-identity PAT works — **DONE 2026-07-05** (`scripts/dev/probes/su2-su5-gh-spike.sh`; evidence below).
- [x] daemon-credential **merge attempt is rejected** — **DONE 2026-07-05** (evidence below): `HTTP 405`, `At least 1 approving review is required by reviewers with write access`.
- [x] posture confirmed against the live repo — **DONE 2026-07-05**: ruleset `main-human-merge` (id 18531847) active on `~DEFAULT_BRANCH`, rules `pull_request` (1 approval) + `non_fast_forward`, **0 bypass actors**.

### SU5 verify evidence (2026-07-05, sanitized)

Spike: `scripts/dev/probes/su2-su5-gh-spike.sh` against `kanthorlabs/kanthord-verify`,
repo-scoped fine-grained PAT (Contents+PR write), token redacted throughout.

- **Repo bootstrap:** `main` created via `PUT /contents/README.md` (repo had no
  default branch before). Confirmed `defaultBranchRef=main`.
- **push → PR → close cycle:**
  - push over HTTPS (`Authorization: Basic`, extraHeader): `* [new branch]
    probe/su-… -> probe/su-…`, exit 0.
  - `gh pr create` → `…/pull/2`; `gh pr list --head` and `pr view 2` show
    `state=OPEN`, `mergedAt=null`.
  - `gh pr close 2 --delete-branch` → `✓ Closed pull request …#2`, `✓ Deleted
    branch probe/su-…`. Repo returned to `main`-only.
- **Ruleset created (2026-07-05):** `main-human-merge` (id 18531847), enforcement
  `active`, target `~DEFAULT_BRANCH`, rules `pull_request` (required_approving_review_count
  = 1) + `non_fast_forward`, `bypass_actors = []` (admin bypass disabled).
- **Merge rejection — VERIFIED.** Daemon-token
  `PUT /repos/kanthorlabs/kanthord-verify/pulls/3/merge` →
  `HTTP/2.0 405 Method Not Allowed`, body
  `{"message":"Repository rule violations found\n\nAt least 1 approving review is
  required by reviewers with write access.","status":"405"}`, exit 1. The ruleset
  blocks the merge for a write-capable token with no bypass → human-only-merge holds.

### SU5/SU4 security finding — least-privilege token boundary (RESOLVED + verified)

During setup the ruleset was created with the PAT briefly granted Administration.
The PAT was then **re-scoped to Contents: write + Pull requests: write only (no
Administration)** and the boundary was re-verified with the least-privilege token
(2026-07-05):

- **Merge attempt** `PUT …/pulls/{n}/merge` → `HTTP 405`, "At least 1 approving
  review is required…", exit 1 → **merge rejected**.
- **Ruleset management is denied** — `POST …/rulesets` and `DELETE …/rulesets/{id}`
  both return `HTTP 403 {"message":"Resource not accessible by personal access
  token"}`; the ruleset survives. So the token **cannot delete/bypass the protection**
  → the human-only-merge boundary is **hard**, not just enforced-if-cooperating.

**Note for readers:** `GET /repos/{}` still reports `"permissions":{"admin":true}` —
this reflects the **token owner's role** (the org owns the repo), NOT the token's
granted permissions. Verify **capability** (403 on ruleset write), not that flag.

**Carry-forward:** mint the real per-identity daemon PAT with Contents:write +
PR:write and **no Administration** (this repo's token is the proven template).

**Evidence discipline (debate finding):** sanitized command transcript; token/key
**identity without the value**; ruleset/branch-protection export; PR URL; branch
name; merge-rejection status + **redacted** body; cleanup confirmation; timestamp +
actor. Do not store raw logs that may contain `Authorization` headers.

## Interface corrections (2A) — decision records

Corrections to Phase-1/2A seams discovered while building the Epic 019 Story 001
hermetic harness suites (and confirmed by maintainer review), recorded per the Epic
019 rule (what changed, why it was forced, epics/stories affected, harness update
that keeps the suite green). Both landed with `npm test` green (697 tests) and
`npm run typecheck` clean.

### IC-1 — Broker reconcile contract aligned to the adapters' `{ status }` shape

- **What changed:** `reconcileOp` (`src/broker/reconcile.ts`) now consumes the verb
  adapters' `{ status }` reconcile result instead of `{ outcome }`; the
  desired-effect hash-match invariant is enforced only when the adapter supplies
  `observed_hash` (verbs without a content hash, e.g. `github.create_pr`, accept
  `status:"done"` as terminal). The `github.create_pr` adapter
  (`src/broker/verbs/github-create-pr.ts`) now reads its head-branch identity from
  the durable `correlation` the broker passes to `reconcile`.
- **Why the run forced it:** the Epic 019 kill-mid-`create_pr` scenario (the
  hermetic mirror of LP4) exposed that `reconcileOp` and every real verb adapter
  spoke different reconcile contracts (`outcome` vs `status`). The durable
  crash-recovery path could not drive any real adapter — it would hit the
  exhaustive-switch default and throw `Unknown reconcile outcome: undefined`. The
  original scenario had masked this by calling `adapter.reconcile()` directly and
  casting, so the durable `broker_completion` row was never written.
- **Epics/stories affected:** Epic 005 (broker ledger/reconcile), Epic 014
  (`github.create_pr` adapter), Epic 019 Story 001.
- **Harness update:** `2a-kill-mid-create-pr` now routes reconcile through
  `reconcileOp` and asserts the durable `broker_completion` row reaches terminal
  `"done"` by `op_id`; `reconcile.test.ts` doubles aligned to `{ status }` (no
  assertion weakened; hash-mismatch branch keeps `observed_hash`).

### IC-2 — Scheduler schema migration is bootstrap-once, not per-method

- **What changed:** the scheduler schema migration is now a single exported
  `initSchedulerSchema` (`src/scheduler/dispatch.ts`) called **once** at daemon boot
  (`src/daemon/boot.ts`, in `doStart()`), and once in each harness/scenario setup;
  the four lazy per-method migration calls (in `loadTasks`, `dispatchable`,
  `markExitGatePassed`, `setTaskStatus`) were removed — the methods now assume the
  schema exists.
- **Why the run forced it:** maintainer review of the out-of-scope-write scenario
  found it abusing `setTaskStatus` purely as a DDL side-effect to create the
  `scheduler_task` table, which surfaced that the scheduler self-migrated inside
  every method. Schema bootstrap belongs once at program start, not on every call.
- **Epics/stories affected:** Epic 004 (scheduler/DAG), Epic 009 (daemon boot),
  Epic 019 Story 001.
- **Harness update:** harness entrypoints (`golden.ts`, `lifecycle.ts`,
  `2a-golden.ts`), the out-of-scope-write scenario, and every scheduler test suite
  now call `initSchedulerSchema` once in setup; new `src/scheduler/migration.test.ts`
  proves idempotency and that scheduler methods throw `no such table` on an
  uninitialised store (no self-migration).

### IC-3 — Unified schema bootstrap (no per-method lazy migration)

- **What changed:** every remaining self-migrating table moved to a single
  `initSchema(store)` aggregator (`src/store/schema.ts`) composing one schema-init
  per subsystem (`broker/`, `inbox/`, `rpc/`, `scheduler/`, `ring1/` `schema.ts`),
  called **once** at `daemon/boot.ts` `doStart()` and in every harness/scenario/test
  setup that opens a fresh Store. All lazy per-method DDL wrappers
  (`ensure*Table` / `apply*Migration`) and their in-method calls were removed;
  methods now assume the schema exists. Left untouched (legitimately one-shot,
  not per-method): compile's `applyCompiledPlanMigration`, rebuild's op_ledger,
  `foundations/sqlite-store.ts` internal init, harness `harness_soak_state`.
- **Why the run forced it:** the scheduler-migration-once fix (IC-2) exposed the
  same anti-pattern across broker/inbox/rpc/scheduler/ring1. Critically,
  `broker_completion` was `CREATE`-d in **three** places with **divergent DDL**
  (`blocked-on.ts` used `at INTEGER NOT NULL DEFAULT 0` / `op_id TEXT NOT NULL
  PRIMARY KEY` vs `reconcile.ts`/`poller.ts`), so the live schema was
  **order-dependent** — a latent bug. Consolidation gives it one canonical owner
  (`broker/schema.ts`).
- **Epics/stories affected:** Epics 004/005/006 (scheduler + broker + inbox),
  Epic 009 (daemon boot), Epic 015 (ring-1 budget ledger), Epic 019 Story 001.
- **Harness update:** ~20 test suites now call `initSchema` once in setup;
  `src/store/schema.test.ts` proves the aggregator creates all tables idempotently
  and that representative methods throw `no such table` on an uninitialised store.
  Whole suite green at 703 tests.

## LP1–LP5 results

_To be filled during the live proof (see Epic 019 authoring for each LP's Action /
Pass criteria)._

- LP1 — Golden single-repo feature end-to-end: _pending_
- LP2 — Forced out-of-scope write (live): _pending_
- LP3 — Forced budget breach (live): _pending_
- LP4 — Kill mid-`create_pr`, reconcile against real GitHub: _pending_
- LP5 — Zero divergence + corrections recorded: _pending_
