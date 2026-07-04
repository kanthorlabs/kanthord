---
epic: .agent/plan/epics/007-ring1-policy-seams.md
opened: 2026-07-05
cycle: tdd
scope: all
opener: test-engineer
base-ref: 8b5d9dea8aacd4b5535ed33bf0f648d9fa4858a5
---

# Implementation cycle — 007-ring1-policy-seams

Pulled from EPIC: `.agent/plan/epics/007-ring1-policy-seams.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):
> - `npm run typecheck` exits 0; `npm test` green for all Story suites.
> - A fake tool call writing outside the declared `write_scope` is **blocked** (the write does not happen) and an escalation event is recorded tagged as a re-planning signal; an in-scope write passes.
> - The same block occurs regardless of which (fake) model is configured (model-independence asserted).
> - A sequence of fake model calls whose reserved spend exceeds the per-task ceiling is **halted before** the breaching call executes, and escalated; spend already reserved is not lost.
> - Splitting that sequence across a **respawn** (Epic 006) still breaches at the same cumulative point — the respawn does not reset the ledger (stable task identity).
> - When a fake call reports no exact cost, the conservative token/request ceiling is applied instead (no unbounded spend).

TDD protocol:
1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate on every in-scope target and appends IMPLEMENTATION_READY_FOR_REVIEW.
## TEST-ENGINEER — 001-write-scope-enforcement · T1 Block out-of-scope write, allow in-scope + T2 Model-independence

**Cycle.** RED for Tasks `S001-T1` and `S001-T2` (`src/ring1/write-scope.test.ts`).

**Test written.**
- file: `src/ring1/write-scope.test.ts` (new) — suite: `src/ring1/write-scope.ts` — methods: `T1(a): out-of-scope write returns block`, `T1(a): out-of-scope write does not proceed (hook returns block)`, `T1(b): in-scope write returns allow`, `T1(b): deeply nested in-scope write returns allow`, `T1(c): blocked write records escalation tagged as re-planning-signal`, `T1(c): allowed write records no escalation`, `T2: same out-of-scope write is blocked under a permissive fake model config`
- asserts: `makeWriteScopeHook(writeScope, onEscalate)` returns a hook that blocks out-of-scope writes, allows in-scope writes, records an escalation event with `tag: "re-planning-signal"` on block, and never accepts a model config (model-independence proven by constructing two hooks identically — both block, both escalate).

**RED proof.**
- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/ring1/write-scope.ts'`

**Open to Software Engineer.**
- Seam to create: `src/ring1/write-scope.ts`
  - Export `EscalationEvent` — at minimum `{ tag: "re-planning-signal"; [key: string]: unknown }`
  - Export `makeWriteScopeHook(writeScope: string[], onEscalate: (event: EscalationEvent) => void): (call: ToolCall) => "allow" | "block"`
  - `ToolCall` is imported from `../session/agent-session.ts`
  - Path normalization must use the same `/**` / trailing-slash stripping as `src/scheduler/leases.ts`
  - No model parameter anywhere on the public surface

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 001-write-scope-enforcement · T1 Block out-of-scope write, allow in-scope + T2 Model-independence

**Cycle.** GREEN+REFACTOR for `src/ring1/write-scope.test.ts`.

**Files changed.**
- `src/ring1/write-scope.ts` (new) — exports `EscalationEvent`, `makeWriteScopeHook`

**Seam (GREEN).** `makeWriteScopeHook(writeScope, onEscalate)` returns a closure that allows in-scope `write_file` calls, blocks out-of-scope ones and fires `onEscalate({ tag: "re-planning-signal" })`, and unconditionally allows non-write calls; no model parameter exists on the public surface.

**Refactor.** Applied inline: path normalization logic extracted to `normalizeScopePath` (mirrors `leases.ts` pattern), scope membership check extracted to `isPathInScope`, write-tool names isolated in `WRITE_TOOL_NAMES` set — all within the same file.

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `ToolCall.args` is `unknown` (`src/session/agent-session.ts:5`) — cast via `Record<string, unknown>` with an explicit string narrowing for `path`.
- VERIFIED: path normalization pattern (`/** strip + trailing-slash strip`) taken verbatim from `src/scheduler/leases.ts:29-31`.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 001-write-scope-enforcement · Confirm GREEN + 002-budget-circuit-breaker · T1 Reserve-before-call, halt on breach

**Cycle.** Confirm GREEN for S001 T1+T2, then RED for Task `S002-T1` (`src/ring1/budget.test.ts`).

**Confirm GREEN — S001 T1+T2.**
- command: `node --test src/ring1/write-scope.test.ts`
- result: 7 tests, 0 failures — GREEN.
- Build artifact: `npm run typecheck` exits 0 (independently confirmed). Note: `npm run verify:handoff` exits non-zero in this worktree due to a path-resolution bug in `scripts/verify-handoff.mjs` (`new URL("../node_modules/typescript/bin/tsc")` — no local `node_modules` in the worktree); the underlying typecheck command itself passes cleanly. SE's cited artifact (`npm run typecheck` exit 0) is verified.

**Test written — S002-T1.**
- file: `src/ring1/budget.test.ts` (new) — suite: `src/ring1/budget.ts` — methods: `T1(a): calls under the ceiling each proceed`, `T1(b): breaching call — prior spend durable, breach not committed, model never invoked, escalation recorded`, `T1(c): null cost uses conservative ceiling`, `T1(d): same breach halts under permissive fake model config (model-independence)`, `T1(e): finer budget exceeded — logs entry without halting`
- asserts: `makeBudgetBreaker(options, storage, onEscalate, onLog)` reserves spend before each call, halts on breach (returning `"halted"`, never invoking the model, not committing the breaching cost, recording a `"budget-breach"` escalation), uses `conservativeCost` when cost is `null`, halts identically regardless of which (non-existent) model config is in play, and log-only for finer budgets.

**RED proof.**
- command: `node --test src/ring1/budget.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/ring1/budget.ts'`

**Open to Software Engineer.**
- Seam to create: `src/ring1/budget.ts`
  - Export type `BudgetStorage { load(taskId: string): Promise<number>; save(taskId: string, spent: number): Promise<void> }`
  - Export type `BudgetEscalationEvent { tag: "budget-breach"; [key: string]: unknown }`
  - Export type `BudgetLogEntry { kind: "finer-budget-exceeded"; [key: string]: unknown }`
  - Export `makeBudgetBreaker(options: { ceiling: number; conservativeCost: number; finerBudgets?: Array<{ name: string; ceiling: number }> }, storage: BudgetStorage, onEscalate: (e: BudgetEscalationEvent) => void, onLog: (l: BudgetLogEntry) => void): { reserve(taskId: string, cost: number | null): Promise<"proceed" | "halted"> }`
  - No model parameter anywhere on the public surface (model-independence by construction)

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 002-budget-circuit-breaker · T1 Reserve-before-call, halt on breach

**Cycle.** GREEN+REFACTOR for `src/ring1/budget.test.ts`.

**Files changed.**
- `src/ring1/budget.ts` (new) — exports `BudgetStorage`, `BudgetEscalationEvent`, `BudgetLogEntry`, `BudgetOptions`, `makeBudgetBreaker`

**Seam (GREEN).** `makeBudgetBreaker(options, storage, onEscalate, onLog)` returns `{ reserve(taskId, cost) }` that loads the durable total, checks `current + effectiveCost > ceiling` before committing — halts + escalates without saving on breach; saves on proceed then logs any exceeded finer budgets; `null` cost falls back to `conservativeCost`; no model parameter.

**Refactor.** None (Task specifies "REFACTOR: none").

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `noUncheckedIndexedAccess` is on — implementation uses `for...of`, no indexed array access.
- VERIFIED: `verbatimModuleSyntax` satisfied — no external imports in this file, no `import type` mixing issue.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 002-budget-circuit-breaker · T2 Accumulates across respawn

**Cycle.** RED (characterization) for Task `S002-T2` (`src/ring1/budget.test.ts`).

**Confirm GREEN — S002-T1.**
- command: `node --test src/ring1/budget.test.ts` (5 T1 tests)
- result: 5 tests, 0 failures — GREEN.
- Handoff verification: `npm run verify:handoff` fails in this worktree (path-resolution bug in `scripts/verify-handoff.mjs` — no local `node_modules`; same known issue from prior turn). SE cited `npm run typecheck` exit 0 directly; independently re-running it confirms exit 0.

**Test written — S002-T2.**
- file: `src/ring1/budget.test.ts` (edited) — suite: `src/ring1/budget.ts` — methods: `T2: new breaker instance (respawn) loads accumulated spend from durable storage and breaches at same cumulative point`
- asserts: a new `makeBudgetBreaker` instance sharing only the `BudgetStorage` (simulating respawn: fresh runtime, same durable store keyed by stable compiled task id) accumulates from the prior session's total, halts at the same cumulative breach point, and does not commit the breaching cost.

**RED proof — first-run pass (characterization).**
- command: `node --test src/ring1/budget.test.ts`
- exit: 0 (6/6 pass) — **first-run pass (intended)**: the T1 implementation always calls `await storage.load(taskId)` at `budget.ts:59` with no factory-scope in-memory cache, so a new breaker instance with the same `FakeBudgetStorage` immediately sees the prior session's accumulated spend.
- **Sensitivity proof:** if the implementation introduced a factory-scope `Map` initialized to empty that skipped `storage.load()` for subsequent calls after the first (reset-to-zero per new instance), T2 would fail: `r2` would be `"proceed"` instead of `"halted"` and `postEsc.length` would be `0` instead of `1`. Any "start-fresh-at-zero" approach is caught by `assert.equal(r2, "halted")`.
- **Not vacuous:** the test pins the invariant that a respawn cannot reset the breaker; it fires on the specific regression pattern (no storage load on new instance).

**Open to Software Engineer.**
- `src/ring1/budget.ts` already satisfies T2 — `reserve` always calls `storage.load()`, no cross-instance cached total. Action-GREEN is verify-only: run `npm run typecheck` (must exit 0) and `npm test` (must show 6 passing for `src/ring1/budget.test.ts`).

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 002-budget-circuit-breaker · T2 Accumulates across respawn

**Cycle.** GREEN+REFACTOR for `src/ring1/budget.test.ts` (verify-only — T2 already passes).

**Files changed.**
- none — existing `src/ring1/budget.ts` already satisfies the T2 invariant.

**Seam (GREEN).** The invariant holds structurally: `reserve()` in `budget.ts:59` calls `const current = await storage.load(taskId)` on every invocation. `makeBudgetBreaker` captures only `options`, `storage`, `onEscalate`, and `onLog` — there is no factory-scope `Map`, counter, or cached total in the closure. A freshly constructed breaker sharing the same `BudgetStorage` always reads the durable accumulated total on the first `reserve` call, so a respawn cannot reset the ledger.

**Refactor.** None required (verify-only Task; no REFACTOR action named).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `budget.ts:53-81` — the returned object's `reserve` method has no surrounding state other than the four factory parameters; `storage.load` is called at line 59 before any branch.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.**

All gate bullets from `.agent/plan/epics/007-ring1-policy-seams.md`:

- `npm run typecheck` exits 0 — confirmed.
- `npm test` green for all Story suites — 255 tests, 0 failures — confirmed.
- **write-scope block + escalate + re-planning signal + in-scope pass** — covered by `src/ring1/write-scope.test.ts` methods `T1(a): out-of-scope write returns block`, `T1(a): out-of-scope write does not proceed`, `T1(b): in-scope write returns allow`, `T1(b): deeply nested in-scope write returns allow`, `T1(c): blocked write records escalation tagged as re-planning-signal`, `T1(c): allowed write records no escalation`.
- **Model-independence (write-scope)** — covered by `T2: same out-of-scope write is blocked under a permissive fake model config`.
- **Budget reserve-before-call, halt on breach, atomic (prior spend not lost)** — covered by `T1(a): calls under the ceiling each proceed`, `T1(b): breaching call — prior spend durable, breach not committed, model never invoked, escalation recorded`.
- **Conservative ceiling when cost unknown** — covered by `T1(c): null cost uses conservative ceiling`.
- **Respawn accumulation (no ledger reset)** — covered by `T2: new breaker instance (respawn) loads accumulated spend from durable storage and breaches at same cumulative point`.
- **Finer-budget log-only** — covered by `T1(e): finer budget exceeded — logs entry without halting`.
- **Model-independence (budget)** — covered by `T1(d): same breach halts under permissive fake model config`.

Gate targets:
- `core typecheck` (`npm run typecheck`) → exit 0
- `core unit` (`npm test`) → exit 0, 255 pass / 0 fail

**Tasks closed.** 4 Tasks across 2 Stories (S001-T1, S001-T2, S002-T1, S002-T2).

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-05
- state: local-uncommitted

END: TEST-ENGINEER

## REVIEWER-ENGINEER — 007-ring1-policy-seams · Phase B verdict

(Appended by the orchestrator on the reviewer's behalf — the reviewer-engineer persona has Read/Grep/Glob only and cannot shell-append.)

### Summary
- Files reviewed: 2 source (`src/ring1/write-scope.ts`, `src/ring1/budget.ts`), 2 test (`src/ring1/write-scope.test.ts`, `src/ring1/budget.test.ts`)
- Blockers: 0 · Suggestions: 2 · action:YES 0 · action:NO 2
- Verdict: **PASS**

### Blockers
None.

### Suggestions
- S1 - action:NO - write-tool-names-hardcoded - `WRITE_TOOL_NAMES` at `write-scope.ts:59` contains only `"write_file"`; other write verbs pass unchecked. Acceptable for Phase 1 seam-only scope (Epic 007 Non-Goals) but the deferral should be made explicit at the seam.
- S2 - action:NO - model-independence-comment - `budget.test.ts` model-independence case (T1(d)) lacks the clarity comment that `write-scope.test.ts:73` has explaining why identical-constructor calls prove model-independence. Structural proof (no model param on either API) is valid.

### Acceptance criteria coverage
All 12 ACs across both Stories COVERED. S001 AC5 (path-normalization parity with Epic 004) confirmed byte-for-byte: `write-scope.ts:30-31` vs `leases.ts:29-31`. S002 AC4 (respawn accumulation) covered by T2, a justified first-run pass — `reserve()` always calls `storage.load()` at `budget.ts:59`, no factory-scope cache. Fail-closed atomicity correct: `storage.save()` only on the proceed path (`budget.ts:67`). No DDL — SQLite idempotency dimension N/A.

END: REVIEWER-ENGINEER

AUTO_REVIEW: FAIL — reviewer verdict PASS with 0 action:YES and 2 action:NO suggestions; per operator standing instruction (fix-all-suggestions policy, Epic 006 precedent), routing BOTH suggestions to the TDD loop as blockers rather than deferring them to the human.
BLOCKER: S1 write-tool-names-hardcoded — WRITE_TOOL_NAMES (write-scope.ts) lists only "write_file"; make the Phase-1 seam-only deferral explicit at the definition with a comment naming the Phase-2 expansion point (Epic 007 Non-Goals), so the narrow set is a documented decision, not an oversight.
BLOCKER: S2 model-independence-comment — budget.test.ts model-independence case (T1(d)) lacks the clarity comment that write-scope.test.ts has; add the parity note explaining that calling the identical constructor twice, with no model parameter on the API, is what proves model-independence.

## SOFTWARE-ENGINEER — 007-ring1-policy-seams · S1 write-tool-names comment

**Cycle.** GREEN+REFACTOR for review blocker S1 (comment-only; no test cycle).
**Review blocker addressed.** BLOCKER: S1 write-tool-names-hardcoded — WRITE_TOOL_NAMES (write-scope.ts) lists only "write_file"; make the Phase-1 seam-only deferral explicit at the definition with a comment naming the Phase-2 expansion point (Epic 007 Non-Goals).

**Files changed.**
- `src/ring1/write-scope.ts` (edited) — 4-line comment added inside the "Write-tool name registry" block, before the `WRITE_TOOL_NAMES` constant (line 59); no behavior change.

**Seam (GREEN).** The comment states Phase 1 enforces against the fake `write_file` tool only, names edit/patch/move as deferred write verbs, and cites Epic 007 Non-Goals as authority — making the narrow set a documented decision rather than an oversight.

**Refactor.** N/A — comment-only change; no structural refactor needed.

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.**

Review blockers resolved:
- **S1 (write-tool-names-hardcoded):** fixed by SE — 4-line deferral comment added inside the `WRITE_TOOL_NAMES` block in `src/ring1/write-scope.ts`, naming the Phase-2 expansion point and citing Epic 007 Non-Goals. No behavior change.
- **S2 (model-independence-comment):** fixed this turn — 3-line parity comment added to `budget.test.ts` T1(d) at line 101 (before the first `await breaker.reserve` call), matching the write-scope.test.ts:73 style. The comment reads: "Calling the identical constructor twice — with no model parameter anywhere on the breaker API — is precisely what proves model-independence: a permissive model cannot weaken ring 1." No assertion/behavior change.

Gate targets:
- `core typecheck` (`npm run typecheck`) → exit 0
- `core unit` (`npm test`) → exit 0, **255 pass / 0 fail**

**Tasks closed.** 4 Tasks across 2 Stories (S001-T1, S001-T2, S002-T1, S002-T2).

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-05
- state: local-uncommitted

END: TEST-ENGINEER
