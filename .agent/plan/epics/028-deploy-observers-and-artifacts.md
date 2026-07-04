# 028 Real Deploy Observers & Contract-Artifact Byte-Diff Gate

## Outcome

The Phase-1 chain executor (Epic 008) meets reality: **real read-only observer
verbs** (Epic 022's family) wire into deploy stages as configured handlers with
plan-declared success criteria and soak windows evaluated over real observation
records; and the **contract-artifact MVP stance** lands — authored source
artifacts are hash-snapshotted and byte-diffed, any change without a semantic
handler escalates as `unclassified-artifact-change` and is **excluded from the
automation metric**. No semantic comparators in MVP (explicitly out of Phase 2).

## Decision Anchors

- phases.md Phase 2B Deliverable 7 — deploy-chain observers + real read-only
  verbs wired into the Phase-1 executor; byte-diff fallback +
  `unclassified-artifact-change` escalation for contract artifacts.
- PRD §7.4 — observers are read-only broker verbs registered as handlers;
  explicit success criteria; soak; `on_pass: notify_human`,
  `on_fail: halt_and_escalate`; merge stays human.
- PRD §7.2 — gate the **authored source** artifact, never generated output;
  absent handler ⇒ byte-diff + escalate; the escalation is excluded from the
  automation metric (PRD §2); MVP contract gating is honestly weaker than
  automated verification.
- Epic 008 — the generic executor (knows no product names); Epic 006 Story 005
  — the hash-identity handoff gates this extends.

## Fixed contracts (debate findings — vague here means divergent implementations)

- **Predicate grammar (v1):** dot-path field references into the observation
  record; operators `==`, `!=`, `<`, `<=`, `>`, `>=`, `exists`; criteria AND
  across a stage's handlers and across every soak sample; a missing field
  evaluates the predicate **false** (unhealthy); a malformed predicate is a
  config load error naming the stage.
- **Soak semantics:** first sample at stage start, then one per configured
  interval; the stage passes only if every sample in the window is healthy; a
  sample missing past a configured tolerance is unhealthy; an interval longer
  than the soak window is a config error.
- **Handler resolution:** stages resolve handlers through the **Epic 022 verb
  registry and the broker submit path** — test doubles substitute at the HTTP
  seam, never at the handler seam (the integration is real even when the
  service is fake).
- **Artifact identity (v1):** one authored file per artifact (`{ id, path }`,
  PRD §7.1.1 §5). Multi-file/directory artifacts (proto packages, OpenAPI with
  refs) are a **named MVP limitation** — they need a manifest hash, deferred
  with the semantic handlers.
- **Handler registry seam:** the lookup interface is `format → handler | none`;
  the MVP registry is **empty by config** (default-empty asserted) — the seam
  is real, its MVP content is none.
- **Parked-consumer lifecycle:** a failed consumer gate writes a durable
  blocked-on-escalation state; the human response either accepts the new hash
  (expected hash updated, gate re-evaluates) or halts; a further artifact
  change while parked appends evidence to the same item, still parked.

## Stories

- `001-real-observer-wiring.md` — deploy stages configure Epic 022 observer
  verbs as handlers; criteria are plan-declared predicates over the normalized
  observation records; soak re-polls through the real broker poll path;
  pass ⇒ notify (an inbox/notification event), fail ⇒ halt + escalate with the
  observation evidence.
- `002-artifact-byte-diff-gate.md` — contract artifacts (feature-dir
  `contracts/`) snapshot on publish with content hash; a consumer entry gate
  compares hashes; a changed artifact without a registered handler escalates
  `unclassified-artifact-change` (evidence: byte diff summary), pauses the
  consumer, and tags the interaction excluded-from-automation-metric.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (observer
  verbs on their doubles; artifacts on the real store — hermetic).
- A two-stage deploy chain configured with `k8s.rollout_status` +
  `sentry.new_issues` handlers passes when the doubles report healthy across
  the full soak (re-polls observable on the broker path) and emits
  `notify_human`; the fake side-effect log shows no merge/deploy verb (Epic 008
  negative re-asserted with real observer verbs in the loop).
- A `sentry.new_issues` double turning unhealthy mid-soak halts the stage and
  escalates with the failing observation record, stage id, and soak history —
  through the Epic 017 inbox (evidence attached, PRD §7.4).
- The executor still contains no observer-specific vocabulary — the wiring is
  registry/config, criteria are generic predicates over observation records
  (Epic 008's rule asserted against the new configs).
- Publishing a changed authored artifact re-snapshots and re-hashes it; the
  consumer's entry gate fails on hash mismatch; with no handler registered the
  `unclassified-artifact-change` escalation fires with a byte-diff summary
  (size-capped + secret-scanned before storage — the Epic 022 inbound-sanitation
  standard; debate finding), the consumer parks per the fixed lifecycle above,
  and the interaction event carries the exclusion flag **and the Epic 029
  aggregator reports it in the excluded column, outside the headline**
  (PRD §7.2/§2 — the exclusion asserted on the reporting side too; debate
  finding).
- An unchanged artifact passes the consumer gate silently (no noise on the
  happy path).

## Dependencies

- **Epic 008** (executor), **Epic 022 Story 003** (observer verbs), **Epic 006
  Story 005** (handoff gates), **Epic 017** (inbox + interaction exclusion
  flag), **Epic 012** (artifact snapshots in the real store), **Epic 002**
  (artifact registry rows).

## Non-Goals

- No semantic contract handlers (proto/OpenAPI comparators) — post-MVP;
  byte-diff + escalate is the recorded MVP stance (PRD §7.2; phases.md
  "explicitly out of Phase 2").
- No observer handler business logic beyond generic predicates (thresholds are
  plan/config data; per-project handler code is Phase-3 integration work).
- No auto-merge/auto-deploy/rollback (PRD §7.4).

## Findings Out

- none. The observation-record predicate grammar and artifact snapshot layout
  are documented in the stories and asserted by tests.
