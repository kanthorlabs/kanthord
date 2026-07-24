# EPIC 007.15 — Close the delivery lifecycle — stories

Epic: `.agent/plan/epics/007.15-e2e-delivery-lifecycle.md`
Prereq: EPIC 007.14 (sequence order).

After this epic an initiative reaches a `landed` (local-done) terminal state
with an event automatically when its objectives integrate; `awaiting_pr` is
reserved for the future `pr@1` agent; and `publish repository` is observable on
the pull-based event feed.

## Dispatch order

1. Story A — `01-repository-published-event.md`
2. Story B — `02-landed-local-done-status.md`

Story A is hermetic (fake `EventFeed`, no sqlite) so it passes `npm run verify`
on its own. Story B owns the single events-table CHECK migration and MUST list
**both** new event types (`repository.published` from A and `initiative.landed`
from B) so the real DB accepts them. The epic Proof runs after both land.

## Stories

- A — emit `repository.published` from `PublishRepository` → `01-repository-published-event.md`
- B — `landed` local-done initiative status + `initiative.landed` event, and the CHECK migration → `02-landed-local-done-status.md`

## Facts (needed for implementation)

- **Event port is `EventFeed`, not "EventRepository".** `src/events/port.ts:10-13`:
  `append(event: Event): void` / `readAfter(cursor, limit?)`. One shared
  `SqliteEventFeed` instance is created at `src/composition.ts:155` (`const
events = new SqliteEventFeed(db)`) and injected into every event-emitting use
  case. `PublishRepository` is the only event-relevant use case NOT given it
  (`composition.ts:471-477`).
- **Events are built with** `newEvent(type, { taskId?, objectiveId?,
initiativeId?, payload? })` (`src/domain/event.ts:41-67`); `id` is generated
  inside. `Event.payload` is `Record<string,string>` (`event.ts:32-39`).
- **`EVENT_TYPES` union** is `src/domain/event.ts:3-28`. `initiative.delivered`
  already exists (line 26). `repository.published` does NOT exist yet — Story A
  adds it.
- **Emits are wrapped in `unitOfWork.transaction(...)`.** See `ApproveObjective`
  (`src/app/objective/approve-objective.ts:93-112`): it takes a UnitOfWork as
  its 4th constructor arg, injected as `unitOfWork` (`composition.ts:617`).
- **Initiative domain** (`src/domain/initiative.ts`): today `INITIATIVE_STATUSES`
  is `building/awaiting_pr/delivered` (lines 4-8) and `LEGAL_INITIATIVE_TRANSITIONS`
  is `building->awaiting_pr` + `awaiting_pr->delivered` (lines 59-60). Story B
  replaces these with `building/landed` and a single `building->landed`.
  `transitionInitiative(ini, to)` (lines 99-109) throws
  `IllegalInitiativeTransitionError` on an illegal key.
- **`awaiting_pr` production references to retarget/remove** (grep): domain
  (`initiative.ts`), event union (`event.ts:25-26`), `approve-objective.ts:103,107`,
  `run-daemon.ts:148` (+ comment :33), and migrations CHECKs (`migrations.ts:290,
310,368`). Tests referencing the removed states are listed in Story B's Verify.
- **Integration sets the post-objective initiative state.** All-siblings-integrated
  branch is `src/app/objective/approve-objective.ts:100-111` — today it does
  `transitionInitiative(initiative, "awaiting_pr")` + appends
  `newEvent("initiative.awaiting_pr", …)`. Story B retargets this to `"landed"`
  / `"initiative.landed"`.
- **Migration anchors** (`src/storage/sqlite/migrations.ts`): initiative status
  CHECK is set at migration **11**, lines 289-290
  (`CHECK (status IN ('building','awaiting_pr','delivered'))`). Events type CHECK
  is rebuilt at migration **16**, lines 356-379 (the CREATE-new / INSERT-SELECT /
  DROP / RENAME pattern to copy for both new tables). Highest existing version is
  **16** — new migrations use the next integer(s) with `007.15-*` names.
- **CLI shape:** top-level groups assembled in `src/apps/cli/index.ts:45-85`
  (publish built at `:56`, added at `:85`). A verb = a group builder in
  `commands/<verb>.ts` + a subcommand in `commands/<verb>/<noun>.ts` +
  (usually) a pure handler in `src/apps/cli/<domain>.ts` returning
  `{exitCode, stdout[], stderr[]}`. Use cases come from the `CliDeps` bundle
  (`src/apps/cli/deps.ts:117-183`), built in `buildDeps` (`composition.ts`).
- **CLI test styles:** handler unit test with a fake use case
  (`src/apps/cli/objective.test.ts:184-211`, `get-initiative.test.ts:40-77`),
  and full e2e through real composition + real sqlite in a temp dir
  (`src/apps/cli/e2e-smoke.test.ts:12-30`). Both use `node:test` +
  `node:assert/strict`.
