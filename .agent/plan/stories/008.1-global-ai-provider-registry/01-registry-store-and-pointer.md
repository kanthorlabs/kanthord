# Story A — Global `ai_providers` store + default pointer

Epic: `.agent/plan/epics/008.1-global-ai-provider-registry.md`

## Change

- **Migration 16** — `src/storage/sqlite/migrations.ts`: append one new element to
  the `MIGRATIONS` array (after the version-15 element ending line 352, before the
  closing `]` line 353):
  ```
  {
    version: 16,
    name: "008.1-s-ai-provider-registry",
    up: (db) =>
      db.exec(`
  CREATE TABLE ai_providers (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    provider         TEXT NOT NULL,
    model            TEXT NOT NULL,
    baseUrl          TEXT,
    effort           TEXT,
    value            TEXT NOT NULL,
    state            TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','logged_out')),
    credentialVersion INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE ai_provider_default (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    providerId TEXT NOT NULL REFERENCES ai_providers(id)
  );
  `),
  },
  ```
  The `id = 1` CHECK makes `ai_provider_default` a single-row pointer (0 or 1
  rows). `name UNIQUE` enforces globally-unique names.
- **Port** — `src/storage/port.ts`: after `PublicationRepository` (ends line 208)
  add the record type and interface:
  ```
  export interface GlobalAiProvider {
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string | null;
    effort: string | null;
    value: string;
    state: "active" | "logged_out";
    credentialVersion: number;
  }
  export interface AiProviderRegistry {
    insert(p: GlobalAiProvider): void;
    get(id: string): GlobalAiProvider | undefined;
    getByName(name: string): GlobalAiProvider | undefined;
    list(): GlobalAiProvider[];
    getDefaultId(): string | undefined;
    setDefaultId(providerId: string): void;
    clearDefault(): void;
    setState(id: string, state: "active" | "logged_out", credentialVersion: number): void;
    updateCredential(id: string, value: string, state: "active", credentialVersion: number): void;
    delete(id: string): void;
  }
  ```
- **Adapter** — new file `src/storage/sqlite/ai-provider-registry.ts` modelled on
  `src/storage/sqlite/publication.ts`: `class SqliteAiProviderRegistry implements
AiProviderRegistry { readonly #db: DatabaseSync; constructor(db: DatabaseSync) {
this.#db = db; } … }`. Implement every method with `this.#db.prepare(sql)`:
  - `insert`: `INSERT INTO ai_providers (id,name,provider,model,baseUrl,effort,value,state,credentialVersion) VALUES (?,?,?,?,?,?,?,?,?)`.
  - `get`/`getByName`/`list`: `SELECT …` mapping the row to `GlobalAiProvider`
    (coerce absent `baseUrl`/`effort` to `null`).
  - `getDefaultId`: `SELECT providerId FROM ai_provider_default WHERE id = 1` →
    `row?.providerId`.
  - `setDefaultId`: `INSERT INTO ai_provider_default (id,providerId) VALUES (1,?)
ON CONFLICT(id) DO UPDATE SET providerId = excluded.providerId`.
  - `clearDefault`: `DELETE FROM ai_provider_default WHERE id = 1`.
  - `setState`: `UPDATE ai_providers SET state=?, credentialVersion=? WHERE id=?`.
  - `updateCredential`: `UPDATE ai_providers SET value=?, state=?, credentialVersion=? WHERE id=?`.
  - `delete`: `DELETE FROM ai_providers WHERE id=?`.
- **Composition** — `src/composition.ts`: after line 201
  (`const publicationRepository = …`) add
  `const aiProviderRegistry = new SqliteAiProviderRegistry(db);` and import the
  class near the other sqlite adapter imports (~line 101). It is consumed by the
  use cases in Stories B/C/D (not yet added to the return bundle here).

## Constraints

- `node:sqlite` only; single shared `db` handle (do not open a second db).
- This story is storage-only: no use case, no CLI, no composition return-bundle
  field yet. It must not touch the project-scoped `resources` table or the daemon.
- The "default must reference an active provider" rule is a use-case invariant
  (Stories B/C/D), NOT a schema constraint — do not add a state check to the FK.

## Verify

- New `src/storage/sqlite/ai-provider-registry.test.ts` (template:
  `sqlite-project-repository.test.ts` — `makeTempDb()`, flat `test()` + `after()`):
  - `insert` then `get` round-trips a full `GlobalAiProvider` (incl. `value`,
    `state='active'`, `credentialVersion=1`).
  - `getByName` finds by name; unknown name → `undefined`.
  - `list` returns all inserted rows.
  - `setDefaultId` then `getDefaultId` returns the id; a second `setDefaultId`
    replaces it (still one row); `clearDefault` → `getDefaultId()` undefined.
  - `setState(id,'logged_out',2)` reflects in `get`; `updateCredential` restores
    `value` + `state='active'` + version.
  - `delete(id)` → `get` undefined.
- Extend `src/storage/sqlite/migrations.test.ts`:
  - bump `assert.equal(userVersion(db), 15)` (line 67) to `16`.
  - add `ai_providers` and `ai_provider_default` to the columns `deepEqual`
    block (line ~92) and the `userTables` list (lines 65-88 assert 17 → 19 tables).
  - add a CHECK test: `assert.throws(() => db.prepare("INSERT INTO ai_providers
(id,name,provider,model,value,state) VALUES (?,?,?,?,?,?)").run("a","n","p","m","v","bogus"))`.
- `npm run verify` exits 0.
- Proof: no standalone `PASS` line — this story is the storage substrate for the
  Proof lines delivered by Stories 03 and 04.
