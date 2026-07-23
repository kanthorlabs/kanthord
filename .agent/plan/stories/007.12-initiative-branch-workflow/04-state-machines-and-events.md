# Story D — state machines + non-tip immutability + event contract

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
Land **first** (A–C build on it); the non-tip guard can follow C.

## Change

`Initiative`/`Objective` have no status today (`src/domain/initiative.ts:4-20`).
`Task` machine is `src/domain/task.ts:87-117`.

- **Objective machine** (`src/domain/initiative.ts` or new
  `src/domain/objective.ts`): `building → awaiting_confirmation → (conflict |
integrated)`, `conflict → awaiting_confirmation`. Add
  `transitionObjective(objective, to)` guard mirroring `transitionTask`
  (`task.ts:111-117`). Do **not** reuse the `landed` candidate state
  (`src/domain/landing.ts:4`).
- **Initiative machine:** `building → awaiting_pr → delivered`. Add
  `transitionInitiative`.
- Persist `status` on objective + initiative (migration = next contiguous
  version, `src/storage/sqlite/migrate.ts:47-55`; default existing rows
  `building`). Extend `InitiativeRepository` (`src/storage/port.ts:70-97`) with
  status read/write.
- **Event contract:** add types to `EVENT_TYPES` (`src/domain/event.ts:3-21`):
  `objective.building`, `objective.awaiting_confirmation`,
  `objective.integrated`, `objective.conflict`, `initiative.awaiting_pr`,
  `initiative.delivered`. `Event.taskId` is required non-null (`:25-30`) — relax
  it to nullable **or** add optional `objectiveId`/`initiativeId`, and update the
  sqlite feed (`src/events/sqlite.ts:12-51`), `list event` consumer
  (`src/apps/cli/events.ts`), and the `--json` envelope. Keep `payload:
Record<string,string>`.
- **Non-tip immutability:** an integrated non-tip objective is immutable.
  `retry objective --id <objId>` on a non-tip integrated objective is **refused**
  with a message containing one of: `non-tip` / `corrective` / `restart` /
  `not rewritable` / `already integrated`. Tip / `conflict` → Story E.

## Constraints

- No `execute()` on entities (data + state rules only).
- Migrations append-only + contiguous; plain `CREATE`/`ALTER`, `user_version` is
  the guard.
- Migrate the events table + every reader in **this** story.

## Verify

- `node --test src/domain/*`: `transitionObjective`/`transitionInitiative` allow
  exactly the listed edges, throw otherwise; non-tip predicate tested.
- `node --test src/events/sqlite.test.ts` + `src/apps/cli/events.test.ts`: an
  objective-scoped event round-trips (append → `readAfter` → `list event` human +
  `--json`) with null/absent `taskId`.
- `node --test` migration: new columns exist, defaults applied,
  `validateSequence` passes.
- `node --test` `retry objective`: non-tip integrated → refused with the string;
  tip/conflict → routed on.
- `npm run verify` exits 0.
- Proof D.
