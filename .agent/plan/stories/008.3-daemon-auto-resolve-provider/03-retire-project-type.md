# Story C — Retire the project-scoped `ai_provider` type (migration 18)

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: Story A (daemon no longer needs project `ai_provider` bindings).

## Change

- **Domain** — `src/domain/resource.ts`: remove `"ai_provider"` from
  `RESOURCE_TYPES` (:4-10); delete the `AIProvider` interface (:53-60), the
  `AIProvider` member of the `Resource` union (:69), `isAIProvider` (:83-85), the
  `ai_provider` branch of `buildResource` (:187-213), and
  `REASONING_EFFORTS`/`ReasoningEffort` (:42-51) if unused elsewhere (they are
  AIProvider-only). Update the mirrored `ResourceType` + `REASONING_EFFORTS` in
  `src/apps/cli/resource.ts:17-29`.
- **Delete commands + use case**: `src/apps/cli/commands/create/ai-provider.ts`,
  `src/apps/cli/commands/update/ai-provider.ts`, their runners `runCreateAiProvider`
  (`resource.ts:208`) + `runUpdateAiProvider` (`resource.ts:333`), the
  `UpdateAiProvider` use case (`src/app/resource/update-ai-provider.ts` + its
  `.test.ts`), and their registration in `commands/create.ts` / `commands/update.ts`
  and `deps.ts` (`updateAiProvider` field) / `composition.ts:213,687`.
- **Migration 18** — `src/storage/sqlite/migrations.ts`, append after 008.2's
  migration 17. Rebuild `resources` to drop `'ai_provider'` from the `type` CHECK
  (SQLite can't ALTER a CHECK) — follow the `events_new` pattern and **reproduce
  the migration-7 columns**:
  ```
  {
    version: 18,
    name: "008.3-s-retire-ai-provider-type",
    up: (db) =>
      db.exec(`
  CREATE TABLE resources_new (
    id         TEXT PRIMARY KEY,
    projectId  TEXT NOT NULL REFERENCES projects(id),
    type       TEXT NOT NULL CHECK (type IN
                ('repository','credential','notification','filesystem')),
    name       TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    remoteUrl        TEXT,
    authKind         TEXT DEFAULT 'ambient',
    authCredentialId TEXT
  );
  INSERT INTO resources_new SELECT id,projectId,type,name,attributes,remoteUrl,authKind,authCredentialId FROM resources WHERE type != 'ai_provider';
  DROP TABLE resources;
  ALTER TABLE resources_new RENAME TO resources;
  DELETE FROM task_context WHERE type IN ('ai_provider','credential');
  `),
  },
  ```
  (Verify the exact `resources` column list/order against `migrations.ts:25-32` +
  `:169-171` before writing; copy every column.)
- **Fixtures** — `scripts/e2e/make-todo-graph.sh`: remove the `provider:
ai_provider` / `cred: credential` binding aliases (:29-30) and every per-task
  `provider:`/`cred:` context line (55-56, 87-88, 117-118, 145-146, 174-175). Do
  the same in `scripts/e2e/make-initiative-graph.sh` (:47-48, 73-74, 97-98,
  133-134, 158-159). (`make-landing-graph.sh` inherits todo-graph.)
- **architecture.test.ts**: set `EXPECTED_LEAF_FILE_COUNT = 58`,
  `EXPECTED_LEAF_COUNT = 60`; drop the `["create","ai-provider"]` `MATRIX` row
  (:166); add to `OLD_SPELLINGS` (:130-140): `["create ai-provider (retired)",
["create","ai-provider"]]`.

## Constraints

- `credential` resource type + repository `authCredentialId` are **untouched** —
  the rebuilt `resources` table keeps `credential`,`filesystem`,`notification`,
  `repository` and all migration-7 columns; only `ai_provider` leaves the CHECK.
- Migration 18 copies **only** non-`ai_provider` rows and cleans stale
  `task_context` AI bindings.

## Verify

- Extend `src/storage/sqlite/migrations.test.ts`: `userVersion` → 18; the
  `resources` `type` CHECK now rejects `'ai_provider'`
  (`assert.throws(() => …INSERT type='ai_provider'…)`) and still accepts
  `'credential'`/`'repository'`; migration-7 columns still present; a seeded
  `type='ai_provider'` row (inserted at version 17) is gone after 18, and its
  `task_context` rows are deleted.
- Update/remove `src/apps/cli/commands/read.test.ts` and any test referencing
  `create/update ai-provider`; the `architecture.test.ts` OLD_SPELLINGS asserts
  `create ai-provider` now exits non-zero "unknown".
- `npm run verify` exits 0.
- Proof (008.3 Proof block): delivers **PASS C** (`create ai-provider` is a hard
  unknown-command) and **PASS C-regress** (repository https-token `credential` +
  `authCredentialId` still round-trips).
