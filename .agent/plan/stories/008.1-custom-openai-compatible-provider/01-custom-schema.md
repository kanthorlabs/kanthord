# Story A — Custom-provider schema in the registry

Epic: `.agent/plan/epics/008.1-custom-openai-compatible-provider.md`
Depends on: `008.1-global-ai-provider-registry` (ai_providers table, registry).

## Change

- **Migration 20** — `src/storage/sqlite/migrations.ts`, append after the last
  008.x migration (19). Add nullable columns to `ai_providers`:
  ```
  {
    version: 20,
    name: "008.1-custom-openai-compatible",
    up: (db) =>
      db.exec(`
  ALTER TABLE ai_providers ADD COLUMN api TEXT CHECK (api IN ('openai-completions','openai-responses'));
  ALTER TABLE ai_providers ADD COLUMN contextWindow INTEGER;
  ALTER TABLE ai_providers ADD COLUMN maxTokens INTEGER;
  `),
  },
  ```
  A record is **custom** iff `api IS NOT NULL`. (`ALTER TABLE ADD COLUMN` is used
  — not a rebuild — because these are additive nullable columns; the `api` CHECK
  applies to new writes.)
- **Port + record** — `src/storage/port.ts`: extend `GlobalAiProvider` with
  `api: "openai-completions" | "openai-responses" | null; contextWindow: number |
null; maxTokens: number | null;`. Extend `AiProviderRegistry.insert` (and the
  adapter's INSERT/SELECT column lists) to carry the three new fields.
- **Adapter** — `src/storage/sqlite/ai-provider-registry.ts`: include `api`,
  `contextWindow`, `maxTokens` in `insert`'s INSERT and every `get`/`list`/
  `listAssigned` SELECT→row mapping (coerce absent to `null`).

## Constraints

- Additive + nullable only — existing builtin records (`api IS NULL`) are
  unchanged; a `NULL api` means "pinned-catalog builtin provider" (008.1/008.3
  path), non-null means "custom" (Story C path).
- `node:sqlite`, single shared `db`.

## Verify

- Extend `src/storage/sqlite/ai-provider-registry.test.ts`: insert a custom
  record (`api='openai-completions'`, `contextWindow=32768`, `maxTokens=4096`) →
  `get` round-trips all three fields; a builtin record (`api=null`) round-trips
  with nulls; the `api` CHECK rejects a bogus flavor.
- Extend `src/storage/sqlite/migrations.test.ts`: `userVersion` → 20; the new
  columns appear on `ai_providers` (`columnNames`); `INSERT … api='bogus'` throws.
- `npm run verify` exits 0.
- Proof: no standalone `PASS` line — substrate for Stories B/C.
