# Story 10 — End-to-end smoke test

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

The epic's Proof as one hermetic regression test: the full EPIC 004 setup
plus all three Proof phases (drain to idle; insert-after-idle re-run;
fresh-DB failure path) through the composition root against temp DBs —
the wiring lesson encoded, as in EPIC 004 story 09.

## Acceptance Criteria

- Extends the EPIC 004 smoke harness (same entry as `main.ts` command
  dispatch, temp `KANTHORD_DB`):
  - **Phase 1:** EPIC 004 Proof setup (project → repository → initiative →
    objective → tasks with dependencies) → `daemon run --runner fake
    --until-idle` exits 0 → `list task --initiative` shows every task
    `completed` → `events --after 0` shows `ready → started → completed`
    per task, ids strictly ascending, dependency order respected
    (`implement api` completes before `deploy` starts).
  - **Phase 2:** create one more task → `daemon run … --until-idle` exits
    0 → only the new task ran (previously completed tasks' event counts
    unchanged).
  - **Phase 3 (fresh DB):** re-run the setup → `daemon run --runner fake
    --fail $TASK_DEPLOY --until-idle` exits non-zero → `deploy` is
    `failed`, its dependents `pending`/blocked, the `task.failed` event
    carries the reason.

## Constraints

- Hermetic: temp DBs, `FakeRunner` only, no timers (until-idle mode), no
  network. The manual Proof block in the epic stays the human-run
  verification; this test is its CI twin.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — Proof-sequence smoke test

**Requires:** S07-T2; S08-T1; S06-T1; EPIC 004 S09 (smoke harness).

**Input:** `src/apps/cli/daemon-smoke.test.ts` (new).

**Action — RED:** the three phases as one ordered test (or three tests
sharing helpers), asserting exit codes, task statuses, and the event
stream per the AC. Fails today: test does not exist.

**Action — GREEN:** none expected — this is the integration gate; fix
whatever it flushes out.

**Action — REFACTOR:** none.

**Output:** the EPIC 005 Proof runs green in CI on every commit.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
