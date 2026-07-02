# Story 002 - Fail-Closed Budget Circuit-Breaker

Epic: `.agent/plan/epics/007-ring1-policy-seams.md`

## Goal

A durable per-task budget ledger that reserves spend **before** each (fake) model
call and halts + escalates when the reservation would breach the per-task ceiling —
fail-closed — and whose accumulated spend survives compaction/crash respawns so a
respawn can never reset the breaker.

## Acceptance Criteria

- Before each fake model call, the breaker **reserves** the call's (scripted) cost;
  the call proceeds only if the reservation stays within the per-task ceiling (PRD §4
  — reserve spend before each model call).
- A call whose reservation would breach the ceiling is **atomic-fail-closed**:
  successful prior reservations remain durable, the breaching reservation is **not
  committed**, the fake **model call is never invoked**, and an escalation event is
  recorded (PRD §4 fail-closed — precise semantics per debate, not just "halted").
- The breaker is **model-independent**: the same breach halts under two fake model
  configs, including a permissive one (PRD §4 — deterministic guardrails are
  model-independent; parity with write-scope Story 001).
- The per-task ledger is **durable**: the accumulated spend is persisted (task
  markdown/SQLite via Epic 003) keyed by the **stable task id**, so after a respawn
  (Epic 006) the cumulative total continues — a sequence split across a respawn
  breaches at the same cumulative point (PRD §4 — accumulates across respawns; a
  respawn cannot reset the breaker).
- When a fake call reports **no exact cost**, a conservative token/request ceiling is
  applied instead so spend stays bounded (PRD §4 — conservative ceilings when exact
  cost unavailable).
- Finer per-task/feature budgets are **logged** but not enforced; only the per-task
  hard max is enforced (PRD §9). This log-only behavior has its own RED test (a finer
  budget being exceeded records a log entry and does **not** halt).
- This is the **model-call** budget seam only; tool-call and wall-clock limits (PRD
  §4) are out (Epic Non-Goals). Phase 1 tests conservative pre-call bounding only —
  no reconcile-after (Phase 2A).

## Constraints

- Fail-closed: the reservation happens **before** the call, and a breach halts rather
  than allowing the call and reconciling later (PRD §4). Deterministic and
  model-independent (ring 1).
- Ledger durability keyed by stable task identity is the crux — it is stored so a
  respawn reads the accumulated total, never a fresh zero (PRD §4). Uses Epic 003
  durable store; the task id is the compiled task id (Epic 002).
- Escalation is recorded as an event; the rate-limited human override is Phase 2
  (Epic 007 Non-Goals).

## Verification Gate

- `npm test` green for `src/ring1/budget.test.ts`.

### Task T1 - Reserve-before-call, halt on breach

**Input:** `src/ring1/budget.ts`, `src/ring1/budget.test.ts`

**Action - RED:** Write tests: (a) fake calls under the ceiling each reserve and
proceed; (b) a breaching call — assert atomicity: prior reservations still durable,
the breaching reservation not committed, the fake model call **never invoked**, an
escalation recorded; (c) a fake call reporting no cost falls back to the conservative
ceiling; (d) the same breach halts under two fake model configs incl. a permissive
one (model-independence); (e) exceeding a **finer** (non-hard-max) budget records a
log entry and does **not** halt.

**Action - GREEN:** Implement the breaker: `reserve(taskId, cost)` against the
durable per-task total, atomic-halting+escalating on breach without invoking the
call, conservative fallback when cost is absent, and log-only for finer budgets.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Accumulates across respawn (breaker cannot be reset)

**Input:** `src/ring1/budget.ts`, `src/ring1/budget.test.ts`

**Action - RED:** Write a test: reserve part of the budget, respawn the task via the
Epic 006 path constructing a **new runtime/session** (not the same in-memory object),
so the ledger must be **loaded by compiled task id from durable storage**; then
continue reserving — assert the cumulative total continues from before the respawn and
breaches at the same point it would have without the respawn (a respawn does not reset
the ledger).

**Action - GREEN:** Persist the per-task total in durable storage keyed by the stable
compiled task id so `reserve` loads the accumulated value into a fresh runtime after a
respawn.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
