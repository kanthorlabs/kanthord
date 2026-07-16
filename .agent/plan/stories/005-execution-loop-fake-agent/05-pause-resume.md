# Story 05 — Pause / resume per initiative

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

A human can freeze an initiative's execution to re-arrange its graph
without racing the claimer: `pause initiative <id>` / `resume initiative
<id>` set the flag the loop honors (claim skip = S02-T4; scan skip =
S03-T1). This story also owns the pause **storage slice** (`setPaused`,
`listAllInitiatives`).

## Acceptance Criteria

- `InitiativeRepository` gains `setPaused(id, paused)` and
  `listAllInitiatives()` (capability map).
- `app/initiative/pause-initiative.ts` / `resume-initiative.ts` —
  `PauseInitiative` / `ResumeInitiative.execute({ initiativeId })`:
  - the id must resolve to `initiative` (`resolveKind`) — else
    `Unknown`/`WrongTypeReferenceError` (EPIC 004 error surface);
  - set `paused` true/false; pausing a paused initiative (or resuming an
    unpaused one) is a no-op success — idempotent.
- Handlers `runPauseInitiative` / `runResumeInitiative` for
  `pause initiative <id>` / `resume initiative <id>` (positional id):
  exit 0, stderr `initiative paused: <id>` / `initiative resumed: <id>`;
  bad reference → exit 1, one `error:` line.
- Integration (real temp DB): pause → the scan skips the initiative and
  `claim()` skips its already-queued jobs; resume → the next scan/claim
  picks them up.

## Constraints

- A task already `running` when its initiative is paused finishes normally
  (pause gates claiming, not in-flight work) — documented in the handler
  help text.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — pause storage + use cases + CLI handlers

**Requires:** S02-T2 (paused column); EPIC 003 S003
(`SqliteInitiativeRepository`); EPIC 004 S02 (`resolveKind`, error
surface), S01 (command table).

**Input:** `src/storage/port.ts`,
`src/storage/sqlite/sqlite-initiative-repository.ts` + test (extend);
`src/app/initiative/pause-initiative.ts`, `resume-initiative.ts` (new) +
tests; `src/apps/cli/initiative.ts` (extend) + test.

**Action — RED:** (a) temp-DB: `setPaused(id, true)` +
`listAllInitiatives()` reflect the flag; (b) hermetic: pause sets, resume
clears, both idempotent; (c) a task id → `WrongTypeReferenceError`; an
unknown ULID → `UnknownReferenceError`; (d) handler happy/error lines and
exit codes per AC. Fails today: methods/modules do not exist.

**Action — GREEN:** implement the repo slice, the two use cases, the
handlers; register `pause initiative` / `resume initiative` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** pause/resume end to end (flag semantics; loop enforcement
covered by S02-T4/S03-T1 tests).

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — pause honored across the loop (integration)

**Requires:** S05-T1; S03-T1/T2; S02 (real adapters).

**Input:** `src/app/initiative/pause-loop.test.ts` (new — real temp DB +
`FakeRunner`).

**Action — RED:** (a) two initiatives, one paused → loop until idle runs
only the unpaused one's tasks; paused tasks stay `pending`, their queued
jobs stay queued; (b) resume + another loop round completes them. Fails
today: test does not exist.

**Action — GREEN:** none expected; fix what it flushes out.

**Action — REFACTOR:** none.

**Output:** the pause story proven against the real claim path.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
