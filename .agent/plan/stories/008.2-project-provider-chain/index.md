# EPIC 008.2 — Project provider assignment + ordered resolution chain — stories

Epic: `.agent/plan/epics/008.2-project-provider-chain.md`
Prereq: EPIC 008.1 (global registry, `AiProviderRegistry`, `list ai-provider`,
`remove ai-provider`, `ai-provider-view`).

A project assigns global providers in a total rank order; the resolved chain =
assigned (rank order, logged-out excluded) + default appended if absent;
`list ai-provider --project <id>` shows it; `remove` becomes assignment-aware.

## Dispatch order

1. **01** — `project_ai_providers` table + registry `assign/unassign/listAssigned`.
2. **02** — assign/unassign use cases + CLI verbs.
3. **03** — `resolveProviderChain` pure function.
4. **04** — `list ai-provider --project` resolved-chain branch (folds `resolve`).
5. **05** — assignment-aware `remove` (`--replacement` / `--cascade`).

## Stories

- A — ordered assignment store → `01-assignment-store.md`
- B — assign/unassign use cases + CLI → `02-assign-unassign.md`
- C — pure chain resolver → `03-resolve-provider-chain.md`
- D — `list ai-provider --project` resolved chain → `04-list-project-branch.md`
- E — assignment-aware removal → `05-assignment-aware-remove.md`

## Facts (needed for implementation)

- **Migration 18… no — 17.** Append migration **17** to `MIGRATIONS`
  (`src/storage/sqlite/migrations.ts`, after 008.1's migration 16, before the
  array close). Bump `assert.equal(userVersion(db), 16)` → `17` and add the new
  table to the columns/tables asserts in `migrations.test.ts`.
- **`projects` table** FK target at `migrations.ts:21`. **`ai_providers`** table
  from 008.1 migration 16.
- **Pure-resolver template**: `src/app/graph/binding-resolver.ts:37-89`
  (`resolveTaskContext`, `validateExecutorBindings` — zero-I/O functions, throw
  typed errors from a sibling `*-errors.ts`). Mirror it for
  `resolveProviderChain`.
- **Registry port/adapter** to extend: `AiProviderRegistry`
  (`src/storage/port.ts`, added by 008.1) + `SqliteAiProviderRegistry`
  (`src/storage/sqlite/ai-provider-registry.ts`, added by 008.1).
- **Command surface from 008.1**: `list ai-provider` global (Story 008.1-03,
  `commands/list/resource.ts` global builder + `runListAiProviders` in
  `src/apps/cli/ai-provider.ts`); `remove ai-provider` leaf
  (`commands/remove/ai-provider.ts` + `RemoveAiProvider` use case, which already
  accepts a `--cascade` no-op flag to be made real here).
- **New verbs** `assign` / `unassign` do not exist (greenfield). Register in
  `src/apps/cli/index.ts` `buildProgram` like 008.1's `register`/`set-default`.
- **`architecture.test.ts` counters**: 008.1 leaves them at
  `EXPECTED_LEAF_FILE_COUNT = 58`, `EXPECTED_LEAF_COUNT = 60`. Story 02 adds 2
  leaf files (`assign/ai-provider.ts`, `unassign/ai-provider.ts`) → set both
  branches to **60 / 62**. Stories 04 and 05 EDIT existing leaves (`list`,
  `remove`) — no count change.
- **CLI/test conventions**: see `.agent/plan/stories/008.1-global-ai-provider-registry/index.md`
  Facts (unchanged) — migration harness, adapter test `makeTempDb()`, use-case
  fake-port tests, CLI `capture()` tests, `emitResult` id-on-stdout contract,
  `error-map.ts` `instanceof` chain for new typed errors.
