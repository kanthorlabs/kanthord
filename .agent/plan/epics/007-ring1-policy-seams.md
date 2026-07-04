# 007 Write-Scope & Model-Call-Budget Ring-1 Seams (enforced against fakes)

## Outcome

**Two** of PRD §4's ring-1 deterministic guardrails — the two phases.md names for
Phase 1 — wired as seams that enforce against fakes: a **write-scope check** in
`beforeToolCall` that blocks a write outside the task's declared `write_scope` and
escalates it, and a **fail-closed model-call cost circuit-breaker** — a durable
per-task budget ledger that **reserves** spend before each (fake) model call and
**halts + escalates** on breach, and whose per-task ceiling **accumulates across
compaction/crash respawns** so a respawn can never reset the breaker. Both are
model-independent: swapping in a permissive (fake) model must not weaken them. No
real model, no network.

This Epic is **scoped to these two guardrails only** (title narrowed per debate). The
other PRD §4 ring-1 items are explicitly **not** in it — see Non-Goals.

## Decision Anchors

- PRD §4 ring 1 — deterministic policy that cannot be talked out of: write-scope
  enforcement via `beforeToolCall` (out-of-scope writes blocked + escalated); a
  **fail-closed** cost circuit-breaker that reserves spend before each model call and
  halts+escalates on breach; the per-task ceiling **accumulates across
  compaction/crash respawns** (stable task identity), so a respawn cannot reset the
  breaker; when exact cost is unavailable, conservative token/request ceilings apply.
- PRD §4 — deterministic guardrails are model-independent; a permissive model must
  not weaken ring one.
- PRD §4 — a blocked out-of-scope write is also a **re-planning signal** (the plan's
  decomposition was likely wrong).
- phases.md Phase 1 "Explicitly out" — Ring-1 *interfaces* (write-scope check, budget
  ledger) **exist as seams but enforce against fakes only**.
- PRD §9 — a hard per-task cost ceiling is **enforced** by ring 1 (fail-closed);
  finer per-task/feature budgets are **logged**.

## Stories

- `001-write-scope-enforcement.md` — `beforeToolCall` blocks a write outside the
  task's `write_scope` and escalates; in-scope writes pass; model-independent.
- `002-budget-circuit-breaker.md` — durable per-task budget ledger that reserves
  before each fake model call, halts+escalates on breach, and accumulates across
  respawns (a respawn cannot reset it); conservative ceiling when cost is unknown.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- A fake tool call writing outside the declared `write_scope` is **blocked**
  (the write does not happen) and an escalation event is recorded tagged as a
  re-planning signal; an in-scope write passes.
- The same block occurs regardless of which (fake) model is configured
  (model-independence asserted).
- A sequence of fake model calls whose reserved spend exceeds the per-task ceiling is
  **halted before** the breaching call executes, and escalated; spend already
  reserved is not lost.
- Splitting that sequence across a **respawn** (Epic 006) still breaches at the same
  cumulative point — the respawn does not reset the ledger (stable task identity).
- When a fake call reports no exact cost, the conservative token/request ceiling is
  applied instead (no unbounded spend).

## Dependencies

- **Epic 001** (durable store + clock), **Epic 003** (durable per-task ledger lives
  in the task's markdown/SQLite so it survives respawn), **Epic 006** (the
  `beforeToolCall` seam and the respawn path this Epic hooks into).

## Non-Goals — the other PRD §4 ring-1 guardrails (explicitly out of this Epic)

Listed so the Epic does not overclaim §4 coverage (debate finding):

- **Secret-pattern scanning on outbound content** — explicitly deferred to **Phase
  2A** (phases.md: "Minimal ring 1: secret-pattern scan … lands before the first
  external mutating verb"). Not a conditional/"if needed" seam here — simply out.
- **No-direct-network / broker-only enforcement** — Phase 2A (real broker path).
  Phase 1 write-scope covers **agent tool writes only** (`beforeToolCall`); broker
  outbound policy is Phase 2A.
- **Path allow/deny by agent role** — Phase 2 (full ring 1 for agents, phases.md 2A).
- **Tool-call and wall-clock budget limits** — PRD §4 lists these alongside model
  calls; Phase 1 ships the **model-call budget seam only** (named + bounded), the
  other two limit dimensions are Phase 2.
- **Ring 2** classifier and **ring 3** approval UI — Phase 2 (PRD §4).
- **Real model cost / reconcile-after** — the fake reports a scripted cost; Phase 1
  tests **conservative pre-call bounding only**, real provider cost reconciliation is
  Phase 2A (PRD §4). No per-day global kill switch UI (Phase 2).
- Finer per-task/feature budget **enforcement** — only the per-task hard max is
  enforced; finer tiers are **logged** (PRD §9).

## Findings Out

- none as a TDD-task output. The `beforeToolCall` enforcement contract and the budget
  ledger's respawn-accumulation property are documented here and asserted by tests;
  Epic 010's harness drives the out-of-scope-write and budget-breach scenarios.
