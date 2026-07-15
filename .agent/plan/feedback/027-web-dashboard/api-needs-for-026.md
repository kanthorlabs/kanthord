# API needs for Epic 026 (raised from the Epic 027 web build)

Collected by Aelita during the Epic 027 UI-first build (2026-07-15), per Ulrich's
direction: build the web UI first against the proto interface hypothesis, then
raise the API needs at the end for the Epic 026 core worktree
(`work/026-control-plane-api-core`). The UI renders only what the committed proto
(`proto/kanthord/v1/daemon.proto`) exposes; each item below is a place where the
UI's acceptance criteria want a field/behavior the current proto does not carry,
or a server behavior the UI depends on.

These are **not** UI defects — the UI faithfully renders the current schema.
Each needs an Epic 026 decision: add the field (maintainer schema change +
regen), or amend the owning Story's AC.

## Build approach for proto-gapped surfaces (decision, 2026-07-15)

Where a Story's ACs need data the current proto does not carry (inbox evidence,
badges, classification suggestion, expiry), the UI is built against a **UI-side
view-model + a thin adapter** from the generated client — the shared proto is
**NOT edited in this worktree** (Epic 026 owns the proto's evolution for the API
it implements; editing it here would collide with `work/026-control-plane-api-core`).
Hermetic component tests drive the view-model with fixtures; action calls use the
real generated methods where they exist. Each gap below is the concrete proto
shape the adapter needs 026 to provide so the surface lights up on live data.

## Proto field gaps

- **N1 — `FeatureSummary.name`** (Story 001 AC1). AC1 lists the features-list
  columns as "id, **name**, status, phase", but `FeatureSummary` has only
  `feature_id`, `status`, `phase`, `progress_summary` (see
  `ListFeaturesResponse`). The list currently renders id/status/phase (+ progress)
  and omits name. Decision for 026: add `string name` to `FeatureSummary`, or
  amend AC1 to drop "name" (use feature_id as the display id). Reviewer finding
  Story 001 B3 (action:NO).

- **N2 — `InboxItem` is under-specified for the inbox surface** (Story 003; the
  biggest gap). Current `InboxItem` = `{id, kind, feature_id, summary}`. The
  Story 003 ACs + fold-ins need, per item:
  - `evidence` — the attached evidence CONTENT (phases.md 2B D6 "inbox with
    evidence attached"; the UI must display it, never a bare reference). Diff-type
    evidence needs a structured/​unified-diff form the UI renders in the DiffPane
    (files → add/del/ctx lines); non-diff evidence is displayed text. Proposed:
    an `evidence` message with a `type` ("diff" | "text" | …) + payload (for diff,
    the file/line structure the DiffPane consumes; see Story 002 `DiffPane`).
  - `type` and `severity` — the escalation/approval type + severity for the
    per-row §4 domain badge, incl. the distinct `unclassified-artifact-change`
    type (daily-usage Input 2).
  - `suggested_category` — the daemon's proposed interaction category
    (approval/clarification/correction/takeover) so the respond control can offer
    "Accept suggested: <type>" (honest-classification Input 1). `confirmed_category`
    already exists on the respond requests; the *suggestion* to confirm does not.
  - item `status` + `expires_at`/`expired` — so a deep-linked item can render an
    explicit resolved/expired/missing state (daily-usage Input 5) and Story 004's
    expired approval state.
  - a `GetInboxItem(id)` method (or make `ListInboxItems` return the full items) —
    the deep-link item view (Story 003) needs to fetch one item incl. its evidence.
- **N3 — approval-tier op context + expiry** (Story 004). The parked
  `github.merge` approval needs its context (verb + target) and an `expired`/
  `expires_at` on the *approval item* to render the expired-and-disabled state.
  `BrokerOperation` carries `expires_at`/`expiring`, but the link from a parked
  BrokerOperation to the approval inbox item the UI approves (`RespondToApproval`
  id) is unspecified. Proposed: expose the approval item's expiry (via N2's
  `InboxItem.expires_at`) and a stable reference between the broker op and its
  approval item.
- **N4 — no `ListBudgets` / per-task ledger method** (Story 006 AC "renders the
  per-task ledger"). Only `GetBudget(task_id)` exists (single task). The budgets
  surface needs a list of per-task budgets. Proposed: `ListBudgets` returning
  repeated `GetBudgetResponse`-shaped rows.
- **N5 — broker op "reconciliation status" is not a distinct field** (Story 005
  AC "reconciliation status"). `BrokerOperation` has `state` (lifecycle) +
  `correlation` (external id/idempotency key); the UI renders both, but there is
  no explicit reconciliation-status field (e.g. externally-reconciled vs
  locally-resolved). If the AC needs that distinction surfaced, add a
  `reconciliation_status` (or similar) field to `BrokerOperation`. Low priority —
  the surface is read-only and renders the available fields today.

## Server-behavior dependencies (verify when 026 handlers land)

- **D1 — auth rejection surfaces as Connect `Unauthenticated`.** The web
  `AuthProvider` treats a probe call rejected with `Code.Unauthenticated` as the
  unauthenticated state (→ auth-required screen). Epic 026's auth (Basic auth
  over TLS) must return the `Unauthenticated` Connect code on an unauthenticated
  call, not a generic error, for the client's auth baseline to work
  (Story 001 AC4 / Story 004 enforcement-observed).

## Deferred (need the live daemon — build when 026 is up)

- The 3 E2E specs are deferred (no live daemon): Story 001 T3
  (`features.spec.ts`), Story 003 T3 (`inbox-approval-loop.spec.ts`),
  Story 004 T2 (`enforcement-observed.spec.ts`), plus the epic gate run's full
  `npm run e2e:web` + the pre-flight script boot. These are the join/gate items
  once Epic 026 serves the API.
- **AppRouter surface wiring.** The six area routes in `clients/web/src/app/AppRouter.tsx`
  still render Story 000 placeholders — the built surfaces (FeatureList/FeatureDetail,
  Inbox/InboxItemView, plan-flows, ApprovalActions, BrokerViews/RepoSlots,
  Budgets/DaemonOps) are NOT yet mounted into the shell routes. Mounting them is
  integration work best done with the live daemon (the E2E gate proves it), so it
  is deferred with the E2E.
- **Container / fetch layer for the view-model surfaces.** The inbox (Story 003),
  approvals (004), and budgets (006) surfaces are presentational — they take
  view-model props (or a fake client) in the hermetic tests. A thin container that
  fetches via the generated client, maps proto→view-model (the N2/N3/N4 adapters),
  and feeds the presentational components is the remaining wiring; it becomes
  meaningful (and its adapters fully populated) once Epic 026 adds the N2/N3/N4
  fields and serves the data.

## Design-system (DESIGN §P2) note — RESOLVED 2026-07-15 (not an API need)

- **Diff-add / success / warning semantic color tokens — DONE.** Ulrich approved
  adding them. The §P2 token pass added `--success`/`--warning`/`--diff-add`/
  `--diff-del` (+ `-foreground`) oklch tokens (light+dark, globals.css), the
  `success`/`warning` Badge variants (ui/badge.tsx), and updated
  `TONE_BADGE_VARIANT` (success→success, warning→warning). Now `done`→green,
  `halted`→amber, breaker closed→green / half-open→amber, parked→amber, severity
  medium→amber; `DiffPane` additions/deletions use the diff tokens. DESIGN §3/§4/§11
  updated. Color values are sensible defaults — tweak the oklch in globals.css to
  taste.

<!-- Appended as more gaps surface during the remaining stories. -->
