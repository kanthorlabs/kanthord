# Story S6 — `GET /api/database`

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decisions 8, 14)

## Change

### 1. `src/app/db/get-db-status.ts` — two derived fields, no port change

`expectedSchemaVersion` already exists in the composition root, and
`pendingMigrations` is derivable, so **`StatusStore` is not touched**.

Add to `DbStatus` (`:4-9`) and to the returned object (`:20-25`), and take the
expected version as a second constructor argument — the same shape `CheckProject`
already receives it in (`src/composition.ts:763`):

```ts
export interface DbStatus {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  tables: Array<{ name: string; rows: number }>;
  expectedSchemaVersion: number;
  /**
   * `validateSequence` (src/storage/sqlite/migrate.ts:54-63) enforces migration
   * versions to be exactly 1..n contiguous, so the count of unapplied migrations
   * is exactly the version gap. No list scan is needed.
   */
  pendingMigrations: number;
}
```

```ts
  constructor(store: StatusStore, expectedSchemaVersion: number) { … }

  async execute(): Promise<DbStatus> {
    const schemaVersion = this.#store.schemaVersion();
    return {
      dbPath: this.#store.path,
      schemaVersion,
      journalMode: this.#store.journalMode(),
      tables: this.#store.tables(),
      expectedSchemaVersion: this.#expected,
      pendingMigrations: this.#expected - schemaVersion,
    };
  }
```

### 2. `src/composition.ts` — hoist the existing expression

`:763` already computes `MIGRATIONS[MIGRATIONS.length - 1]!.version` for
`CheckProject`. Hoist it to a const declared before `:194` and use it in both
places, so there is exactly one source:

```ts
  const expectedSchemaVersion = MIGRATIONS[MIGRATIONS.length - 1]!.version;
  …
  const getDbStatus = new GetDbStatus(store, expectedSchemaVersion);
```

and replace the inline expression at `:763` with `expectedSchemaVersion`.

### 2b. `db status --json` — the parity flag

`db status` is the only read leaf with no `--json`, which is why the Proof had to
scrape a `schema:` line out of formatted text. Add the flag.

`src/apps/cli/db.ts` — `runDbStatus(getDbStatus, args)` gains an args parameter and
an early return, following `src/apps/cli/list-tasks.ts:23-27`:

```ts
const status = await getDbStatus.execute();
if (args?.json) {
  return { exitCode: 0, stdout: [JSON.stringify(status)], stderr: [] };
}
```

`src/apps/cli/commands/db/status.ts` — add
`.option("--json", "print the status as JSON")` and pass `{ json: opts.json }`.

The default text branch is byte-for-byte unchanged, so `src/apps/cli/db.test.ts`
stays green as-is. The JSON payload is the full `DbStatus` (including `dbPath`,
`journalMode` and `tables`) — it is a local diagnostic, unlike the HTTP view.

### 3. `src/apps/http/views/database.ts` (new)

Mirror `src/apps/http/views/health.ts` exactly, including the index signature.

```ts
export interface DatabaseResult {
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  readonly pendingMigrations: number;
}

export interface DatabaseView {
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  readonly pendingMigrations: number;
  readonly [key: string]: unknown;
}

export function databaseView(result: DatabaseResult): DatabaseView {
  return {
    schemaVersion: result.schemaVersion,
    expectedSchemaVersion: result.expectedSchemaVersion,
    pendingMigrations: result.pendingMigrations,
  };
}
```

`dbPath`, `journalMode` and `tables` are deliberately NOT on the wire: a
filesystem path is not the UI's business and the table census is a CLI
diagnostic. The literal field list is what keeps the ETag stable.

### 4. `src/apps/http/routes.ts` — the row

Import `databaseView` beside `healthView` (`:4`). Insert immediately after
`queue.get` (ends `:474`), grouping it with the other no-param top-level
collections:

```ts
  defineRoute({
    id: "database.get",
    method: "GET",
    path: "/api/database",
    successStatus: 200,
    kind: "json",
    cliCommands: ["db status"],
    decode: () => ({}),
    run: async (deps) => deps.getDbStatus.execute(),
    present: (result) => databaseView(result),
  }),
```

No ETag code: `src/apps/http/app.ts:282-284` sets it for every `200` json row.

### 5. Wiring

- `src/apps/http/deps.ts`: import `GetDbStatus` from
  `"../../app/db/get-db-status.ts"` and add `readonly getDbStatus: GetDbStatus;`.
- `src/apps/cli/commands/serve.ts:84-85`: add `getDbStatus: deps.getDbStatus,`.
  `CliDeps` already has it (`src/apps/cli/deps.ts:172`) — no `CliDeps` change.

### 6. Counters (deltas — epic Decision 14)

- `src/apps/http/routes.test.ts:63` — add `"database"` to `PATH_SEGMENTS`
  (singular, no trailing `s`, so `NOT_PLURAL` is untouched).
- `src/apps/http/routes.test.ts:299-300` — apply **`+1`** to the asserted
  `ROUTES.length` (52 → 53 at authoring) and update the test name to mention the
  025 row.
- `src/apps/http/cli-coverage.test.ts:143-150` — apply **`−1`** to whatever S5
  left (24 → 23 at authoring).

## Constraints

- Do not add a `StatusStore` method — `expectedSchemaVersion` already exists and
  `pendingMigrations` is arithmetic.
- Do not put `dbPath` on the wire.
- Do not change the DEFAULT `db status` text output — only add the `--json`
  branch beside it.
- Do not compute the expected version from a literal — always from `MIGRATIONS`.

## Verify

- `node --test src/apps/http/views/database.test.ts` (new; mirror
  `views/health.test.ts`): returns exactly the three fields in order and drops
  extra fields present on the input object.
- `node --test src/app/db/get-db-status.test.ts` — on a fully migrated store
  `pendingMigrations === 0` and `expectedSchemaVersion === schemaVersion`; with a
  fake store reporting `schemaVersion` two behind, `pendingMigrations === 2`.
- `node --test src/apps/http/routes.test.ts` — `ROUTES.length` is one higher than
  before this story; the path-vocabulary test accepts `/api/database`; the policy
  suite passes.
- A wire test in the read-row style (`src/apps/http/routes.initiative.test.ts:1-20`
  harness): `GET /api/database` with auth → `200`, body
  `{data:{schemaVersion, expectedSchemaVersion, pendingMigrations}}`, **no
  `dbPath` key**, an `ETag` header present; without auth → `401`.
- `node --test src/apps/http/cli-coverage.test.ts` — `"db status"` is a real leaf
  and the uncovered count dropped by one.
- `node --test src/apps/cli/db.test.ts` — the existing text-output tests stay
  green unchanged, plus a new case: `db status --json` emits exactly one stdout
  line that `JSON.parse`s to an object carrying `schemaVersion`,
  `expectedSchemaVersion` and `pendingMigrations`.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-execution-proof.sh` phase **H** — `/api/database`
  returns `200` and its `schemaVersion` equals `db status --json`'s
  `schemaVersion`.
