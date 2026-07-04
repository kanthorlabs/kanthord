# Story 002 - Soak Duration & Success Criteria

Epic: `.agent/plan/epics/008-deploy-chain-executor.md`

## Goal

The soak part of the gate: a stage's success criteria are an explicit AND of observer
outcomes evaluated repeatedly across a soak duration on the fake clock, so a deploy
that looks healthy early but degrades during soak fails; a fully-healthy soak
resolves `on_pass: notify_human` (merge stays human), a degrading one
`on_fail: halt_and_escalate`.

## Acceptance Criteria

- The stage's success criteria are an explicit **AND** of its observer outcomes
  (e.g. rollout-complete AND error-rate-below-threshold AND zero-new-issues) — one
  failing observer fails the criteria (PRD §7.4 — explicit success criteria).
- The soak holds for the stage's declared duration on the **fake clock**, driving
  **repeated scheduled re-polls** of the fake observer broker verbs (Epic 005 poller)
  across the window — observable as repeated observer invocations at poll points, not
  a private one-shot loop. A deploy whose observers are healthy at the start but flip
  unhealthy **before** the soak elapses resolves `on_fail` (PRD §7.4 — soak duration).
- Observers healthy for the **entire** soak resolve `on_pass` and emit a
  `notify_human` event; the **fake broker's recorded command log shows no
  merge/deploy/rollback verb was called** (the no-auto-merge negative is asserted
  against that log, not a vacuous absence) (PRD §7.4 — on_pass notify_human; §9).
- `on_fail` records `halt_and_escalate` with evidence including which observer failed,
  its observed value, the fake-clock instant, the stage id, and the soak-window
  history of checks (PRD §7.4; debate finding — evidence explains the failure).
- The soak completes with **no real elapsed time** — time advances only via the fake
  clock (PRD §7.4 — async handles the wait; Phase-1 determinism).

## Constraints

- Soak is "observe for N" via the async/poll design on the injected Epic 001 clock;
  observers are read-only fake broker verbs re-polled across the window (PRD §7.4,
  §5). No real waiting.
- Success criteria are declared per stage in the plan's chain definition, AND-combined
  (PRD §7.4). No auto-merge — `notify_human` is an event only (PRD §9, Trade-off #14).
- Evidence is the observed observer outputs over the soak window (PRD §7.4).

## Verification Gate

- `npm test` green for `src/deploy/soak.test.ts` on the fake clock.

### Task T1 - AND criteria + full-soak pass → notify_human

**Input:** `src/deploy/soak.ts`, `src/deploy/soak.test.ts`

**Action - RED:** Write a test on the fake clock: a stage whose fake observers stay
healthy for the entire soak resolves `on_pass`, emits a `notify_human` event, and the
fake broker's recorded command log contains **no** merge/deploy/rollback verb; assert
the observers were re-polled multiple times at scheduled points across the window
(not once). A stage with one observer unhealthy at the start fails the AND criteria.

**Action - GREEN:** Implement `soakStage(stageNode, observers, clock)` re-polling the
fake observer verbs at scheduled points across the soak window, evaluating the AND
criteria each time, resolving `on_pass` → `notify_human` when healthy throughout.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Degrade-during-soak → on_fail halt_and_escalate

**Input:** `src/deploy/soak.ts`, `src/deploy/soak.test.ts`

**Action - RED:** Write a test on the fake clock: fake observers healthy at soak start
but flipping unhealthy partway through resolve `on_fail: halt_and_escalate` with
evidence = {failing observer, observed value, fake-clock instant, stage id,
soak-window history} — proving the scheduled re-polls catch the mid-soak flip rather
than trusting an early snapshot.

**Action - GREEN:** Make `soakStage` re-evaluate observers at each scheduled poll
across the window and resolve `on_fail` with the full soak-window evidence when any
check within the soak fails.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
