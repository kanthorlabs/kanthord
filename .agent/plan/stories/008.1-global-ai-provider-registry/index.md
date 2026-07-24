# EPIC 008.1 — Global AI provider registry + default convention — stories

Epic: `.agent/plan/epics/008.1-global-ai-provider-registry.md`
Prereq: EPIC 007.14 (sequence order).

A global `ai_providers` registry (credential folded in, one active default,
first-wins) with `register` / `list` / `get` / `set-default` / `logout` /
`remove` CLI verbs, added alongside the still-project-scoped daemon path.

## Dispatch order

1. **01** — storage table + registry port/adapter (infra; underpins all).
2. **02** — `RegisterAiProvider` use case (first-wins default, reactivation).
3. **03** — `set-default` use case + all read/register CLI (delivers Proof PASS
   A/B, C, D-coexist, leak).
4. **04** — logout/remove use cases + CLI (delivers Proof PASS D-logout,
   D-guard, D-remove).

Stories 03 and 04 both edit `src/apps/cli/architecture.test.ts` counters — do 03
then 04 in order; each sets the counters to its own post-state value.

## Stories

- A — global store + default pointer → `01-registry-store-and-pointer.md`
- B — register use case + first-wins default → `02-register-usecase.md`
- C — set-default use case + read/register CLI → `03-set-default-and-cli.md`
- D — credential lifecycle: logout + remove → `04-logout-remove.md`

## Facts (needed for implementation)

- **Migrations** (`src/storage/sqlite/migrations.ts`): array of
  `{ version, name, up: (db) => db.exec(\`...\`) }`; latest is **15**
(`007.13-s3-publications`, lines 339-352), array closes line 353. Append
migration **16** as a new element before line 353. Plain `CREATE TABLE`(not`IF NOT EXISTS`). Migrator (`migrate.ts`) is never edited.
- **Migration test harness** (`src/storage/sqlite/migrations.test.ts`):
  `withMigratedDb(run)` (lines 50-61), `columnNames(db,table)` via
  `pragma table_info` (lines 29-34), `userVersion(db)` via `PRAGMA user_version`
  (13-18), `userTables(db)` (20-27). CHECK constraints tested with
  `assert.throws(() => db.prepare("INSERT …").run(…))`. A `deepEqual` block at
  line 92 lists every table's columns and an `assert.equal(userVersion(db), 15)`
  at line 67 — both must be updated to include the new tables/version 16.
- **Port** (`src/storage/port.ts`): plain `export interface`; add
  `AiProviderRegistry` + its record type after `PublicationRepository`
  (ends line 208). `UnitOfWork.transaction<T>(fn)` (37-39) is the transaction
  primitive.
- **Adapter template**: `src/storage/sqlite/publication.ts` (62 lines) —
  `class Sqlite… { readonly #db: DatabaseSync; constructor(db) {…} }`, methods
  use `this.#db.prepare(sql).get(…) as Row | undefined` and
  `.prepare(sql).run(…)`. Adapter test template:
  `src/storage/sqlite/sqlite-project-repository.test.ts` (`makeTempDb()` lines
  21-27, flat `test(...)` + `after()`).
- **Composition** (`src/composition.ts`): `db` at line 146, `migrator` 147,
  `SqliteProjectRepository` 151, `SqlitePublicationRepository` 201. Construct the
  new `SqliteAiProviderRegistry(db)` here and add each new use case to the
  returned `CliDeps` bundle (object literal lines 666-719).
- **Use-case convention**: one class, one `async execute()`, `#`-private DI via a
  deps object or positional args. Templates: `src/app/auth/login-provider.ts`
  (validate refs → dup-name → side effect → return id), `src/app/resource/add-resource.ts:153-165`
  (model validation via `modelCatalog.isValid` → `UnknownModelError`).
- **Typed errors** (`src/app/errors.ts`): reuse `DuplicateNameError(kind,scope,name)`
  (92-104), `UnknownReferenceError(kind,id)` (66-76); `UnknownModelError` already
  re-exported (line 4-21). Any NEW error class must be added to the `instanceof`
  chain in `src/apps/cli/error-map.ts:42-67` or it crashes instead of exit-1.
- **CLI convention**: verb file `commands/<verb>.ts` (grouping,
  `preSubcommand` hook — copy from `commands/login.ts:7-19`), leaf file
  `commands/<verb>/<leaf>.ts` (`new Command(leaf)`, options,
  `.action(async o => emitResult(await run…(…), io))`). `emitResult`
  (`commands/action.ts:22-26`); contract = **id on stdout**, `"<thing> …: <id>"`
  on stderr, exit 0. Register a verb in `src/apps/cli/index.ts` `buildProgram`
  (import 5-28, `.name()` 38-56, `.addCommand()` 65-85). `index.ts` may NOT
  contain `.action(`/`.option(` (architecture.test guard).
- **`--value-file`**: `readCredentialValue({valuefile,tty,stdin,timeoutMs})`
  (`src/apps/cli/credential-input.ts:69-110`); wired via a `reader` object like
  `commands/create/credential.ts:35-38` → `resource.ts:130-135`.
- **`architecture.test.ts` counters** (`src/apps/cli/architecture.test.ts`):
  `EXPECTED_LEAF_FILE_COUNT = 53` (line 28), `EXPECTED_LEAF_COUNT = 55` (line 31)
  — counts non-`.test.ts` files under `commands/*/` and registered leaves. Story
  03 adds 3 leaf files (`register/ai-provider.ts`, `get/ai-provider.ts`,
  `set-default/ai-provider.ts`) → set both to 56 / 58. Story 04 adds 2
  (`logout/ai-provider.ts`, `remove/ai-provider.ts`) → set to 58 / 60. The
  `MATRIX` (164-170) and `OLD_SPELLINGS` (130-140) are unchanged in 008.1.
- **COLLISION — resolved by human decision:** `list ai-provider` already exists
  **project-scoped** (`commands/list/resource.ts:43` `buildListAiProviderCommand`
  → `buildListResourceCommand("ai-provider","ai_provider")`, raw-resource listing,
  `--project` required; behavior pinned by `read.test.ts:587-616`). Decision:
  `list ai-provider` becomes **global by default**, and **`--project <id>`** shows
  the providers **resolved** for that project (the ordered chain). Split across
  epics: **008.1 Story 03** delivers the global-only form (drop the old raw
  project listing; `--project` not accepted yet) and updates
  `read.test.ts:587-616` to the global expectation. **008.2** adds the
  `--project` = resolved-chain branch — this SUBSUMES the 008.2 epic's separate
  `resolve ai-provider --project` command (fold `resolve` into `list --project`;
  the 008.2 epic Proof must be updated from `resolve ai-provider --project` to
  `list ai-provider --project`).
- **Greenfield confirmed**: no global `ai_providers` table, `AiProviderRegistry`,
  or `ai_provider_default` exists (grep-verified). `register`/`set-default`/
  `logout` verbs and `get ai-provider`/`remove ai-provider` leaves do not exist.
