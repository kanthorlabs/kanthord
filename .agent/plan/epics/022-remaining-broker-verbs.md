# 022 Remaining MVP Broker Verbs

## Outcome

The rest of the PRD §5 MVP verb families behind the Phase-1 broker lifecycle,
each with the full per-verb contract (Epic 014 standard — explicit values, `n/a`
by declaration, desired effect defined, reconcile mandatory): **`jira.transition`
+ `jira.comment`** and **`github.create_issue`** (auto-with-audit),
**`github.merge`** (approval-required — the first approval-tier verb through the
Epic 017 inbox), **read-only observer verbs** (`k8s.rollout_status`,
`sentry.new_issues`, `signoz.query`, `k8s.logs`) as a distinct
no-idempotency/no-approval family for the Epic 028 deploy observers, and
**`slack.dm`** (auto-with-audit) for the Epic 029 dead-man ping. Hermetic tests
against per-service doubles built from the SU3 spike findings; live validation
rides the Epic 030 proof.

## Decision Anchors

- phases.md Phase 2B Deliverable 2 — remaining MVP verbs with the same per-verb
  contract as 2A; PRD §5 MVP verb families and tiers (merge stays
  approval/human).
- PRD §5 — read-only observer verbs exist as a family; PRD §7.4 — observers are
  read-only broker verbs; PRD §3.1 — dead-man ping is a Slack DM **via broker**
  (the verb lands here; the ping logic is Epic 029).
- PRD §6.3 — sync outward is one-directional and shallow: the agent pushes
  status transitions and summary comments; two-way rich sync rejected.
- Epic 014 — the per-verb authoring standard (complete contract, desired effect,
  error taxonomy, redaction); Epic 017 — approval routing for `github.merge`.
- Epic 020 SU3 findings — Jira/Slack endpoints, idempotency signals, error
  taxonomy.

## Stories

- `001-jira-verbs.md` — `jira.transition` + `jira.comment`: desired effect =
  issue in target status / comment with idempotency marker present; reconcile by
  reading the issue; one-directional shallow sync only.
- `002-github-issue-and-merge.md` — `github.create_issue` (idempotency by
  title+marker, reconcile by search) and `github.merge`
  (approval-required: parks `pending` in the Epic 017 inbox; desired effect =
  PR merged; reconcile distinguishes merged / closed-unmerged / still-open).
- `003-observer-verb-family.md` — the read-only family: registry declares
  `desired_effect: n/a` and `reconcile: re_read` — inside the broker lifecycle,
  not exempted from it (debate finding — "nothing to reconcile" would invite
  special-casing); bounded retries, audit entries and `observed_at` semantics
  per read; results normalized into a generic observation record, passed
  through **inbound sanitation** (size cap + secret-pattern scan on stored
  payloads — observers ingest hostile external data; debate finding) before the
  chain executor consumes them (Epic 008's generic-outcome rule).
- `004-slack-dm.md` — `slack.dm`: auto-with-audit, idempotency key per message,
  desired effect = message delivered (timestamp id recorded as correlation).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (all
  services as in-process doubles per SU3 findings; no network).
- Every new registry entry declares the complete contract with explicit `n/a`s
  (Epic 014 gate rule re-applied); every mutating verb rejects a missing
  idempotency key; every entry has a reconcile path or fails registration.
- `jira.transition` to an illegal target state (per the double) resolves
  `failed` with the taxonomy-mapped reason; a retried transition whose issue is
  already in the target state reconciles `done` (idempotent by observed state).
- `github.merge` submitted parks `pending` and appears as an Epic 017 approval
  item; approval fires the merge exactly once (crash-window test per Epic 017);
  denial never calls the adapter; reconcile of an interrupted merge resolves
  merged ⇒ `done`, closed-unmerged ⇒ `failed(closed-externally)` + escalation,
  still-open ⇒ resubmit-eligible.
- Observer verbs return normalized observation records with `observed_at` and
  correlation; retries are bounded by the registry entry (no free resubmit
  storms — debate finding); each read produces an audit entry; stored payloads
  are size-capped and secret-scanned (a seeded token in a fake log payload is
  redacted in the stored record); they cannot be registered at a mutating tier
  (a config attempt is a load error); their results are consumable by the
  Epic 008 executor (shape asserted).
- Each verb's tests enumerate its taxonomy branches explicitly — auth failure,
  permission denied, not-found, validation/illegal, rate limit, transient
  server error, already-done, closed-externally — as applicable per verb
  (debate finding: "SU3 taxonomy" alone is a claim, not coverage).
- `slack.dm` delivers once per idempotency key on the double; a rate-limited
  response backs off per registry.
- All outbound payloads pass the Epic 013 scan (choke-point inheritance
  asserted once for the new families); credential redaction sweep per Epic 014.

## Dependencies

- **Epic 005** (lifecycle), **Epic 013** (scan/breaker on the path), **Epic 014**
  (per-verb standard + github double/base), **Epic 017** (approval inbox for
  `github.merge`), **Epic 020 SU3** (Jira/Slack findings + credentials).

## Non-Goals

- No `k8s.deploy` — reconciled precisely (debate finding): PRD §5 lists the verb
  in the MVP families, but PRD §7.4/§9 fix MVP *behavior* as observe-and-notify
  with the human holding the deploy/merge buttons, and phases.md 2B Deliverable
  7 wires observers, not deploy execution. Executing deploys is the "auto-deploy"
  config flip that PRD §9 explicitly defers past MVP — so the verb has no MVP
  caller and building it would be speculative. It is **deferred to the
  auto-deploy flip**, not silently dropped from "remaining MVP verbs".
- No webhooks; no two-way Jira sync (PRD §6.3 — tarpit, rejected).
- No observer handler *logic* (thresholds, criteria) — Epic 028; this Epic ships
  the verbs.
- No live-service validation — Epic 030's proof.

## Findings Out

- none. Live corrections during Epic 030 follow the Epic 014 live-corrections
  protocol (decision record + double update, recorded in the Epic 030 proof
  file).
