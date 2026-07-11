# Story 004 - failure attribution (machine-fact + human-confirmed)

Epic: `.agent/plan/epics/019.5-task-audit-timeline.md`

## Goal

Make the failing step identifiable **without faking precision**: a machine-derived
`observed_failure_signal` on the failing timeline event (factual, narrow) plus an optional
human/reviewer-confirmed `suspected_root_cause`. Complete the escalation `SIGNAL_MAP` so
every known signal carries a proposed type.

## Acceptance Criteria

- A failing timeline event carries a machine-derived `observed_failure_signal` from the
  closed set `rate_limited | quota_exhausted | auth_failed | tool_blocked | budget_breach |
  broker_failed | gate_failed`, derived from concrete events (Story 001 model-call error,
  ring-1 block, budget ledger halt, broker op failure, gate result) — never guessed.
- `suspected_root_cause` and `root_cause_confidence` are **optional** and only ever set by
  a human/reviewer decision path (the inbox response), never by machine code — a test
  asserts no machine writer sets `suspected_root_cause`.
- A prompt-issue / model-behaved-weird failure records a **factual** signal (e.g.
  `gate_failed`) with `suspected_root_cause` left unset for human confirmation — it is not
  auto-labelled "prompt issue".
- `SIGNAL_MAP` (`src/metrics/interaction-capture.ts`) covers **every** architecture
  §6.2.3 signal (scope-violation, secret-scan block, verb timeout/reconcile, ring-2
  verdict, deploy-observer fail, plus the existing approval-tier-verb, budget-breach), so
  every known signal reaches the operator with a proposed type (026 Input 2).

## Constraints

- **Machine records facts only** — interpretive causes (prompt/model-behavior) are
  human/reviewer-confirmed, per PRD posture ("coarse, approximate, human-confirmed")
  (Decision Anchor). The schema stores `observed_failure_signal` (machine) separately from
  `suspected_root_cause` (human) + `root_cause_confidence`.
- **Signals derived from existing events** — each machine signal maps 1:1 to a concrete
  event source already present (ring-1 block, budget halt, broker op status, gate result,
  Story 003 typed error); no new failure-detection mechanism.
- **`SIGNAL_MAP` completion** — extend the existing map (026 Input 2); making it
  data-driven can wait.

## Verification Gate

- `npm test` green for the attribution + SIGNAL_MAP suites; typecheck 0; zero-network
  guard green.
- Each machine signal is asserted from its concrete source; the "no machine writer sets
  suspected_root_cause" invariant holds; the prompt/model-weird case records a factual
  signal with `suspected_root_cause` unset; `SIGNAL_MAP` covers every architecture signal.

### Task T1 - observed_failure_signal derived from concrete events

**Input:** `src/metrics/failure-signal.ts`, `src/metrics/failure-signal.test.ts`,
`src/metrics/task-timeline.ts`

**Action - RED:** for each concrete source (ring-1 block → `tool_blocked`; budget halt →
`budget_breach`; broker op fail → `broker_failed`; gate fail → `gate_failed`; Story 003
typed error → `rate_limited`/`quota_exhausted`/`auth_failed`), a scripted event asserts the
failing timeline event carries the right `observed_failure_signal`; a prompt/model-weird
gate fail records `gate_failed` with `suspected_root_cause` unset.

**Action - GREEN:** implement the signal derivation from the concrete event sources and
attach it to the failing timeline event; keep `suspected_root_cause` off the machine path.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/failure-signal.test.ts` — T1 cases green.

### Task T2 - human-confirmed suspected_root_cause via the inbox path

**Input:** `src/metrics/failure-signal.ts`, `src/rpc/inbox-respond.ts`,
`src/metrics/failure-signal.test.ts`

**Action - RED:** a test asserts a human inbox response can set `suspected_root_cause` +
`root_cause_confidence` on a task/attempt, and that no non-human code path writes them
(scan the writers).

**Action - GREEN:** add the human-confirmed attribution write on the inbox-response path
only.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/failure-signal.test.ts` — T2 case green.

### Task T3 - complete SIGNAL_MAP (026 Input 2)

**Input:** `src/metrics/interaction-capture.ts`, `src/metrics/interaction-capture.test.ts`

**Action - RED:** a test asserts every architecture §6.2.3 signal has a proposed type in
`SIGNAL_MAP` (no known signal reaches the operator unmapped).

**Action - GREEN:** extend `SIGNAL_MAP` to cover all listed signals.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/interaction-capture.test.ts` — T3 case green.
