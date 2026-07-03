# Story 001 - State-Regression Depth

Epic: `.agent/plan/epics/032-broker-reconciliation-depth.md`

## Goal

Observed external state moving backwards is a declared, per-verb property with
fixed lifecycle semantics — never an accident the poller mis-terminalizes on.

## Acceptance Criteria

- Every verb registered in `broker/verbs/*.yaml` declares
  `state_can_regress: true|false`; a `true` verb must also declare
  `max_regressions` explicitly (debate finding — the bound is part of the
  per-verb semantics; no global default for `true` verbs); a registered verb
  missing either fails registry load with a diagnostic naming the verb and
  the missing field.
- Regression **recognition is adapter-owned** (debate finding — external
  states are not linearly ordered in general): each verb's adapter classifies
  an observation as `regressed` per its own state order/predicate and the
  broker core consumes that classified signal; the poller never compares raw
  states generically.
- On a `state_can_regress: true` verb, the poller observing a pre-terminal
  regression (e.g. a rollout going `progressing → pending`) keeps the op
  `in_flight`, appends a journal event recording observed-before/observed-after,
  and continues polling on the verb's schedule.
- Regressions on one op are bounded: after the verb's declared
  `max_regressions`, the op parks `needs_reconciliation` and raises an inbox
  escalation carrying the regression history.
- On a `state_can_regress: false` verb, any observed regression immediately
  parks the op `needs_reconciliation` and raises an inbox escalation naming the
  verb's declaration (the anomaly is the evidence).
- An op already terminal (`done`/`failed`/`expired`) never leaves its terminal
  state on any later **poll observation** (asserted by attempting one).
  Scope note (debate finding — no contradiction with Story 003): the one
  sanctioned terminal transition is Story 003's *reconcile-and-human-resolve*
  path for fired-but-expired ops; polling can never do it.
- The per-verb matrix test enumerates every registered verb and asserts its
  declared value drives the above behavior on the verb double.

## Constraints

- Extend the Epic 005 op state model and poller — no parallel lifecycle
  (Epic 032 anchor; Epic 005 state model).
- Registry declaration validated at load per the Epic 005 registry pattern
  (PRD §5 — each async verb must declare whether observed state can regress).
- Fake clock only (Epic 001); verb doubles from Epics 014/022.

## Verification Gate

- `npm test` green for `src/broker/regression.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Declaration + regression lifecycle

**Input:** `src/broker/regression.ts`, `src/broker/poller.ts`,
`src/broker/registry.ts`, `src/broker/regression.test.ts`

**Action - RED:** Write tests: (a) registry load rejects a verb yaml missing
`state_can_regress`, diagnostic names verb + field; (b) `true` verb:
pre-terminal regression stays `in_flight` + journal event with both observed
states; (c) regression count exceeding `max_regressions` parks
`needs_reconciliation` + escalation with history; (d) `false` verb: first
regression parks + escalates naming the declaration; (e) a `done` op receiving
a later regressed observation stays `done`.

**Action - GREEN:** Implement the declaration validation and the
regression-aware poll transition over the existing poller/state model.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Per-verb matrix

**Input:** `src/broker/regression-matrix.test.ts`, `broker/verbs/*.yaml`
(declaration fields only — adding `state_can_regress`/`max_regressions` keys
to the existing registered verb files)

**Action - RED:** Write the matrix test: enumerate every yaml in
`broker/verbs/`, assert each declares `state_can_regress`, and for each verb
drive its double through a regression observation asserting the
declaration-appropriate outcome from T1's semantics.

**Action - GREEN:** Add the declaration keys to every registered verb yaml
with values justified by the external system (git local ops: false;
`k8s.rollout_status` + observer reads: true; PR/issue states: per the Epic
014/022 taxonomy notes), each with a source citation comment in the yaml
(debate finding — declared values need traceability to the spike findings or
taxonomy, not bare assertion).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; a temporarily-added undeclared verb fixture
fails the matrix (demonstrated in test via a temp registry dir).
