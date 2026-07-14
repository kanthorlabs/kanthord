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

- LP1 — Golden single-repo feature end-to-end: **PASS** (2026-07-13; evidence below)
- LP2 — Forced out-of-scope write (live): _pending_
- LP3 — Forced budget breach (live): **PASS** (2026-07-13; evidence below)
- LP4 — Kill mid-`create_pr`, reconcile against real GitHub: **PASS** (2026-07-14; evidence below)
- LP5 — Zero divergence + corrections recorded: **PASS** (2026-07-14; evidence below)

### LP1 — Golden single-repo feature end-to-end (PASS, 2026-07-13)

Run context:
- Runtime: Podman container `kanthord-lpa-run`, image `kanthord-lpa-live`, source copied into image; host data mounted as `./.data:/data`.
- Data root: `/data/kanthord-auth` (host: `.data/kanthord-auth`).
- Slot: `/data/kanthord-auth/slots/kanthord-verify.yaml` → `https://github.com/kanthorlabs/kanthord-verify.git`, identity `kanthordverify`.
- Provider account: `codex`; model used for the live daemon: `gpt-5.4-mini`.
- Committer identity: repo git config copied to `.data/kanthord-auth/committer.json` (`Tuan Nguyen <tuan.nguyen@kanthorlabs.com>`).

Command shape:
- `podman run ... -v "$PWD/.data:/data:Z" -e KANTHORD_DATA=/data/kanthord-auth ... node src/cli/run.ts --slot /data/kanthord-auth/slots/kanthord-verify.yaml --account codex --model gpt-5.4-mini --port 7777`

GitHub evidence:
- PR URL: `https://github.com/kanthorlabs/kanthord-verify/pull/5`
- PR number: `5`
- Head branch: `implement-slugify`
- Final PR state observed via GitHub API: `state=closed`, `merged=true`, `merged_at=2026-07-13T15:38:35Z`
- Merge commit SHA: `dad141a385eb1e773c6d7217c2444af6fa0cd3f9`

Daemon/store evidence after restart and after merge observation:
- `scheduler_task`: `implement-slugify`, feature `feat-slugify`, status `complete`.
- `broker_in_flight` contains `github.create_pr` op `op_01KXBJGXW1EKASH9P9Y7XF0TW1` with idempotency key `create_pr:implement-slugify`.
- `broker_completion` contains the immutable PR-open evidence for that op: status `done`, result `{"head_branch":"implement-slugify","pr_number":5}`.
- `external_tracking`: row `ext:46c7c71611bae01a464374a7e44295d3`, `local_id=implement-slugify`, `external_id=5`, `created_by_op_id=op_01KXBJGXW1EKASH9P9Y7XF0TW1`, `tracking_status=terminal`.
- Inbox review request: `esc:e682cbe49c348036c9915d3802dd39ea`, kind `escalation`, reason `review_requested`, `pr_number=5`, `pr_url=https://github.com/kanthorlabs/kanthord-verify/pull/5`, status `resolved` after PR terminal observation.
- Model-call ledger has four recorded calls for the run (`gpt-5.5` rows from the pre-existing live attempt in the mounted DB; total cost rows present). No raw credentials recorded here.

Restart survival evidence:
- `podman restart kanthord-lpa-run` emitted a fresh boot + recovery summary.
- After restart while PR #5 was still open: task remained `delivering`, the `review_requested` inbox item remained open, and `external_tracking` remained active for PR `5`.
- After human merge of PR #5: the restarted daemon observed `merged=true`, set task `complete`, set `external_tracking.tracking_status='terminal'`, and resolved the review-request inbox item.

Notes / corrections discovered during LP1:
- The old LP runbook's "no launcher" blocker is obsolete: `src/cli/run.ts` exists and boots the live daemon.
- The checked-in dev `Containerfile` is still a smoke harness, so LP-A used a temporary proof image that copies current source and mounts only `./.data` at runtime.
- A legacy PR-open completion row did not initially have a durable `external_tracking` row or review inbox item after restart; fixed in code by recovering tracking/review state from existing `github.create_pr` completion evidence at boot.
- Existing completion evidence had `pr_number` but no `pr_url`; recovery derives the canonical GitHub PR URL from `prStateRepo` when needed.
- The daemon status server now honors `--port`; internal container health returned `200 ok`. macOS Podman host TCP forwarding returned an empty reply on `127.0.0.1:7778`, so proof interaction used `podman exec` plus mounted DB evidence.
- Token hygiene: during setup inspection the local PAT file was accidentally displayed once in the assistant/tool transcript. Rotate that token after the proof campaign.

### LP3 — Forced budget breach halts, survives restart (PASS, 2026-07-13)

Run context:
- Runtime: Podman container `kanthord-lpa3-run`, image `kanthord-lpa-live`, host data mounted as `./.data:/data`.
- Isolated data root: `/data/lpa3` (host: `.data/lpa3`), copied from the existing auth setup with no credential values recorded here.
- Slot: `/data/lpa3/slots/kanthord-verify.yaml`.
- Command shape: `node src/cli/run.ts --slot /data/lpa3/slots/kanthord-verify.yaml --account codex --model gpt-5.4-mini --port 7777 --budget-ceiling 0 --budget-cost 1`.

Feature seeded:
- Feature id: `feat-lpa3-budget`.
- Task id: `budget-breach`.
- Task write scope: `src/`.
- The task body was ordinary work, but the daemon budget ceiling was zero, so the model/session must not run.

Observed before restart:
- `scheduler_task`: `budget-breach`, status `parked`.
- `inbox_items`: open escalation `esc:2c6483647a4866a83ba6a940311f788e`, reason `budget-breach`, evidence task id `budget-breach`.
- `model_call_log`: empty for this isolated run, proving the halt happened before a provider/model call.

Restart survival:
- `podman restart kanthord-lpa3-run` emitted a fresh boot + recovery summary.
- After restart: task `budget-breach` remained `parked`, the budget-breach inbox item remained open, and `model_call_log` remained empty.

Pass criteria mapping:
- Halt before breaching call executes: **PASS** (`model_call_log` empty; no session spawned).
- Halt survives daemon restart: **PASS** (`scheduler_task.status='parked'` after restart).
- Breach interaction captured with cost attribution: **PARTIAL/PASS for current implementation** — an inbox escalation exists with typed reason `budget-breach`; no provider cost row exists because the call was prevented before execution.

### LP4 — Kill mid-`create_pr`, reconcile against real GitHub (PASS, 2026-07-14)

Run context:
- Runtime: Podman image `kanthord-lpa-live` **rebuilt 2026-07-14** from current
  source (`Containerfile.lpa`) so it carries the durable external-tracking +
  `reconcileHeldOps` code (Epic 019.18). The earlier attempt failed only because
  its image predated `reconcileHeldOps`.
- Isolated data root: `/data/lpa4` (host: `.data/lpa4`); `checkout/` wiped for a
  fresh clone, credentials/slots preserved. No credential values recorded here.
- Slot: `/data/lpa4/slots/kanthord-verify.yaml` → `kanthorlabs/kanthord-verify`.

Driver (direct broker probe, `src/cli/lp-a4-probe.ts` — temporary proof tooling):
- Reuses the **real** live wiring via `bootstrapLiveRun` (real `github.create_pr`
  adapter, real GitHub HTTP seam, real per-identity PAT, real store) — no LLM
  session spent (LP4 tests broker crash-recovery, not the agent).
- Pushes a real head branch with a trivial diff, then runs the real broker
  `submit()` for `github.create_pr` with a **pre-completion hold-point**: the
  adapter opens the PR on GitHub, then `submit()` records the op `held` (no
  completion row) and the probe exits — the exact state a daemon killed
  mid-`create_pr` leaves behind.

The cutpoint: `submit.ts` runs `adapter.submit` (real PR created) **before**
marking the op `held`, so the restart's head-branch lookup finds the existing PR.
(The e2e spec permits either the pre-submit or the between-submit-and-completion
cutpoint; `run.ts --hold-point` and this probe use pre-completion.)

Evidence:
- Held op: `op_01KXF1TVXGNA2ZF690GEDBGE9Z`, verb `github.create_pr`, idempotency
  key `create_pr:lp-a4-1783990413008`, head branch `lp-a4-1783990413008`.
- Real PR opened: `https://github.com/kanthorlabs/kanthord-verify/pull/8`.

Ledger + GitHub state **before restart** (killed mid-op):
- `broker_in_flight`: op `…GE9Z` status `held`, payload `{head,base,title,body}`.
- `broker_completion`: **0 rows** (no terminal state yet).
- `external_tracking`: **0 rows**; `inbox_items`: **0 rows**.
- GitHub PRs for head `lp-a4-1783990413008` (`GET /pulls?head=kanthorlabs:…&state=all`):
  **exactly 1** — PR #8, `open`.

Restart: `node src/cli/run.ts --slot … --account codex --model gpt-5.4-mini`.
At daemon startup `reconcileHeldOps` scans `broker_in_flight` for `held` ops with
no completion and drives `reconcileOp` → the adapter's **head-branch lookup**
(`listByHead`) → terminal completion. No second `createPr` is issued.

Ledger + GitHub state **after restart**:
- `broker_completion`: op `…GE9Z` status `done`, result
  `{"head_branch":"lp-a4-1783990413008","pr_number":8,"pr_url":"https://github.com/kanthorlabs/kanthord-verify/pull/8"}`.
- `external_tracking`: row `ext:1a3eaee4c98c64f7549469b7e565b652`,
  `local_id=lp-a4-1783990413008`, `external_id=8`, `tracking_status=active`,
  `created_by_op_id=op_01KXF1TVXGNA2ZF690GEDBGE9Z` (rebuilt at boot by
  `recoverPrTrackingFromCompletions`).
- `inbox_items`: `esc:da19c34dea4bea72e2a4677673585fce`, kind `escalation`,
  reason `review_requested`, PR #8, status `open`.
- GitHub PRs for the head branch: **still exactly 1** — PR #8, `open`. **No
  duplicate PR.**

Pass criteria mapping:
- No duplicate PR (head-branch lookup, not re-create): **PASS** — GitHub shows one
  PR (#8) for the head branch before and after restart.
- Op identity recovered from the durable ledger, not RAM: **PASS** — the `held`
  op was reconciled from `broker_in_flight` (durable sqlite) via `reconcileHeldOps`
  at boot; the adapter's in-memory `states` Map was empty after restart.
- Terminal state consistent with the real PR: **PASS** — `broker_completion.done`
  with `pr_number=8` / `pr_url` matches the open PR #8.
- Evidence includes real GitHub observed state + ledger before/after: **PASS**
  (above).
- Idempotent across further restarts: **PASS by construction** — `reconcileHeldOps`
  filters `WHERE status='held' AND broker_completion IS NULL`; the completion row
  now excludes the op.

Notes / corrections discovered during LP4:
- **IC-4 (below) — result persistence in reconcile.** The reconcile path did not
  persist the adapter's result into `broker_completion`, so a boot-reconciled op
  lost its `pr_number`/`pr_url`. Fixed so `reconcileOp` writes `result_json`, and
  `github.create_pr` reconcile now returns `pr_url` and falls back to `head` from
  the submit payload correlation. Without this, `recoverPrTrackingFromCompletions`
  could not rebuild `external_tracking` after a mid-op kill.
- **Observability gap (suggestion, non-blocking):** `reconcileHeldOps` reconciles
  silently — no log line. The earlier failed attempt's `recovery-summary
  reconciledOps:0` was misleading because that counter is the boot.ts git-ledger
  path, unrelated to `reconcileHeldOps`. A per-op reconcile log line at boot would
  have pinpointed the earlier failure immediately (AGENTS.md "logs first").
- The probe (`src/cli/lp-a4-probe.ts`) and `Containerfile.lpa` were temporary proof
  tooling, **removed after this run**; their full logic is documented above so the
  run stays reproducible (recreate `Containerfile.lpa` from the image history if the
  `kanthord-lpa-live` image is ever rebuilt).

### LP5 — Zero divergence + corrections recorded (PASS, 2026-07-14)

Action: `node src/cli/verify.ts --from-markdown --read-only` against the LP1
golden store (the real compiled feature from LP1):
- `--store .data/kanthord-auth/checkout/.kanthord/features`
- `--db .data/kanthord-auth/checkout/.kanthord/db.sqlite`

Result:
- `verify: 0 divergences — store matches markdown source`, **exit code 0**
  (confirmed with output redirected, not piped).
- The LP4 store (`lpa4`) is not a verify target — the direct broker probe authors
  no feature markdown (no `epic.md`), so verify only applies to the LP1 golden
  store.

Pass criteria mapping:
- `verify` exits 0 (zero divergence): **PASS**.
- Every 2A interface correction has a decision record: **PASS** — IC-1 (reconcile
  `{status}`), IC-2/IC-3 (unified schema bootstrap) above, plus **IC-4** (reconcile
  result persistence) recorded below.
- `npm test` green on the corrected seams: **PASS** — full suite **1057 tests, 0
  fail**; `npm run typecheck` clean. LP4-specific suites (reconcile, hold-point,
  review-router, run-loop) 102/102.

### IC-4 — Reconcile persists the adapter result (PR identity survives a mid-op kill)

- **What changed:** `reconcileOp` (`src/broker/reconcile.ts`) now writes the
  adapter's `result` into `broker_completion.result_json` (previously always
  `NULL`). The `github.create_pr` adapter (`src/broker/verbs/github-create-pr.ts`)
  now returns `pr_url` in its reconcile result and resolves the head branch from
  the submit-payload correlation via a `parsed.head` fallback (the held op stores
  the raw `{head,base,title,body}` payload, not `head_branch`).
- **Why the run forced it:** LP4 kills the daemon after the PR is created but
  before completion. On restart `reconcileHeldOps` drives the head-branch lookup to
  a terminal `done`, but with the old code the completion row carried no
  `pr_number`/`pr_url`, so `recoverPrTrackingFromCompletions` could not rebuild the
  `external_tracking` row or the review inbox item — the PR would be reconciled yet
  untracked (the exact class of bug the durable-external-state rule exists to
  prevent).
- **Epics/stories affected:** Epic 005 (broker reconcile/completion), Epic 014
  (`github.create_pr` adapter), Epic 019.18 (durable external tracking).
- **Harness update:** covered by the existing broker + run-loop suites (102/102
  green): `reconcile.test.ts` doubles assert the persisted `result_json`;
  run-loop's Epic 019.18 suites assert `external_tracking` + review-request rebuild
  from completion evidence at boot.
