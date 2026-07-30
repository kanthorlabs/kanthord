# EPIC 025 — serve-hosted daemon and run control — stories

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md`
Prereq: sequence order is **022 event feed → 023 state transitions → 024
ai-provider writes → 025 (this epic) → 026 the UI**. All of 022, 023 and 024 are
authored, so the chain is complete and `/author`'s N-1 pre-flight is satisfied.

**023 owns run control.** `PUT | DELETE /api/initiative/:id/suspension` and the
`pause initiative` / `resume initiative` leaves belong to EPIC 023 (its decision
2). 025 adds no run-control route — it makes a server obey the flag, and its
Proof drives 023's rows.

`kanthord serve` runs the execution loop in-process under an atomic
single-daemon lease; an initiative's `paused` flag is the run control over HTTP;
`db status` joins the read surface.

## Dispatch order

`S1 → S2 → S3`, then `S4`, then `S5`.

- **S1 before S2** — S2 claims the lease S1 creates.
- **S3 after S2** — the failure seam wraps the host S2 builds.
- **S4** is independent of S1–S3 and may run any time.
- **S5 last** — it records what S4 claims.
- Coupled commit: **S2 must edit the three fixture proofs in the same commit**,
  or `npm run verify` and the sibling proofs disagree between commits.
- The two Proof scripts and the fixture maker are **already in the tree**
  (`scripts/e2e/http-execution-proof.sh`, `http-daemon-ownership-proof.sh`,
  `make-025-execution-graph.sh`). No story authors them.

## Counters are DELTAS (epic Decision 14)

022–025 are planned but unbuilt and each moves the assertions. Baseline at
authoring: `ROUTES.length` = **52** (`src/apps/http/routes.test.ts:299-300`),
uncovered leaves = **26** (`src/apps/http/cli-coverage.test.ts:143-150`). This
epic applies **`+1` row** (S4) and **`−1` uncovered leaf** (S4, for `db status`)
to whatever the assertions hold when 025 runs. 022 takes `ROUTES` 52 → 54 and 023
takes it 54 → 63, so a different starting number is expected, not a surprise.

## Stories

- S1 — the daemon lease: migration, port, adapter, atomic claim → `01-daemon-lease.md`
- S2 — the execution host: `serve` runs the daemon, `--no-daemon`, drain → `02-execution-host.md`
- S3 — daemon-failure observability: `KANTHORD_DAEMON_FAIL_AT`, release-on-failure → `03-daemon-failure-observability.md`
- S4 — `GET /api/database` (+ `db status --json`) → `04-database-read.md`
- S5 — retirement + coverage bookkeeping → `05-retirement-bookkeeping.md`

## Facts (needed for implementation)

**Migration**

- `MIGRATIONS` head at authoring is version **31** (`src/storage/sqlite/migrations.ts:915-929`),
  array closes `:930`. `validateSequence` (`src/storage/sqlite/migrate.ts:54-63`)
  requires versions to be exactly contiguous `1..n`, so the new one is
  **head + 1**, appended last. If 022–025 added migrations first, take the new head.
- Adding a migration turns three existing tests RED: `migrations.test.ts:72`
  (`userVersion`), `:70-96` (table list, alphabetical), `:2180-2192` (head
  name/version).
- Entry shape: `src/storage/sqlite/migrate.ts:8-21` (`{version, name, up(db)}`).
- Singleton-row idiom: `id INTEGER PRIMARY KEY CHECK (id = 1)`
  (`migrations.ts:697-700`, `ai_provider_default`).
- Adapter test convention: **real sqlite in a temp dir, never fakes**
  (`src/storage/sqlite/daemon-heartbeat-repository.test.ts:1-38`, `makeTempDb()`).
  Type the local as the port: `const x: PortName = new SqliteX(db)`.

**Atomic claim**

- The only `RETURNING` in the repo is `src/queue/sqlite.ts:24-45`
  (`SqliteJobQueue.claim`). The `changes === 0` guard idiom is `:47-60` (`finish`).
- `SqliteUnitOfWork` uses `BEGIN IMMEDIATE`; `SqliteTransactor` uses plain `BEGIN`.
- `openDatabase` sets `busy_timeout=5000` and WAL; callers do NOT retry SQLITE_BUSY.

**Lazy adapter construction — load-bearing**

- An adapter that prepares statements in its constructor CANNOT go in the eager
  block at `src/composition.ts:190-204`: `buildDeps` runs in tests before
  `db migrate`. Follow the documented lazy pattern at `:684-706` and `:725-742`.

**The daemon host**

- `src/apps/cli/commands/serve.ts` is 99 lines; the signal block is `:93-97` and
  `stop` awaits nothing. `buildServeCommand` has **no test** —
  `src/apps/cli/serve.test.ts` covers only `parsePort`. S2 extracts a testable
  function for that reason.
- Bracket to mirror: `src/apps/cli/daemon.ts:83-126` — heartbeat `start()` FIRST
  in `try`, `stopHeartbeat?.()` LAST in `finally` after `removeListener`;
  `buildDaemon` called at `:68`, OUTSIDE the try, deliberately.
- `CliDeps` already exposes and serve already ignores: `buildDaemon`
  (`src/apps/cli/deps.ts:220-224`), `logger` (`:225`), `heartbeat` (`:266`),
  `getDbStatus` (`:172`).
- `RunDaemon.stop()` (`src/app/task/run-daemon.ts:93-95`) sets a boolean and does
  NOT interrupt the poll sleep (`:204`). Worst-case drain is one `pollIntervalMs`
  (default 1000ms) plus the in-flight task. Any drain wait must be bounded.
- `heartbeat.start()` is NOT idempotent at composition level (`:725-742`): each
  call creates a new interval under one `instanceId`. Call it once.
- Env-seam precedents: `KANTHORD_MAX_TURNS` validate-and-exit at `src/main.ts:32-43`;
  `KANTHORD_FAKE_AGENT` at `:45-71`; both passed via `buildDeps(dbPath, {...})` at `:73`.
- The three fixture proofs launch serve on a byte-identical line:
  `http-serve-proof.sh:103`, `http-reads-proof.sh:142`, `http-writes-proof.sh:178`.
  Each is followed by a poll grepping `serve.log` for
  `{"msg":"listening","port":N}` — daemon output must not break that grep.

**HTTP**

- 025 does NOT touch `initiative.patch` (`src/apps/http/routes.ts:545-558`).
  Run control is 023's suspension singleton.
- ETag is AUTOMATIC: `src/apps/http/app.ts:282-284` for every `200` json row; the
  PATCH path sets its own at `:247`. No per-row code.
- `initiativeView`/`initiativeDetailView` already emit `paused`, so a pause flips
  the ETag.
- Route policy: `readRow` required iff PATCH and must name a GET row
  (`routes.test.ts:156-178`); `present` forbidden on a `readRow` row (`:180-192`).
- `pause` and `resume` are in `BANNED_VERBS` (`routes.test.ts:19-20`) — no
  `/api/initiative/:id/pause` path is legal.
- Wire-test harness to mirror: `src/apps/http/routes.write-planning.test.ts:1-56`
  (`Recorder`, `recordExecute`, mutable local state so the ETag changes) and its
  PATCH triple at `:340-377`.
- View template: `src/apps/http/views/health.ts` (14 lines) — note the
  `readonly [key: string]: unknown;` index signature on the View interface.

**db status**

- `DbStatus` (`src/app/db/get-db-status.ts:4-9`) is
  `{dbPath, schemaVersion, journalMode, tables}`.
- **`expectedSchemaVersion` already exists** — `src/composition.ts:763` computes
  `MIGRATIONS[MIGRATIONS.length - 1]!.version` and injects it into `CheckProject`
  as a plain number. Reuse it; do NOT add a `StatusStore` method.
- **`pendingMigrations` needs no lookup**: `validateSequence`
  (`src/storage/sqlite/migrate.ts:54-63`) enforces contiguous `1..n`, so
  `pending = expectedSchemaVersion − schemaVersion` is exact.
- `db status` has **no `--json` flag** today; it prints `db:`, `schema:`,
  `journal_mode:`, then one line per table (`src/apps/cli/db.ts:57-68`). S6 adds
  the flag, following `src/apps/cli/list-tasks.ts:23-27`
  (`if (args["json"]) return { exitCode: 0, stdout: [JSON.stringify(x)], stderr: [] }`).
- The coverage walker's leaf string is exactly `"db status"`.

**retirement.md (merged state, `f2251c0`)**

- Headings: Target 020 `:24`, 021 `:45`, 022 `:78`, 023 `:97`, 024 ai-provider
  writes `:108`, 025 async job API `:152`, 026 the UI `:159`, "Not yet assigned to
  a target" `:138`, "Why the numbering changed" `:145`, "Never retired" `:172`,
  "Deliberately unresolved here" `:176`.
- **The retirement plan is on hold** — no leaf is removed until Ulrich revisits
  the file after the UI and integration. S5 records the one route 025 adds; it
  retires nothing.
- Target 023 (`:97-...`) owns `pause initiative` / `resume initiative` via the
  suspension singleton and is **NOT** edited by this epic.
- Target 025 (`:152-157`) is the async-job-API text this epic replaces.
- "Never retired" (`:183-185`) is only `serve` and `commands`.
- "Deliberately unresolved" (`:187-192`) still asks whether `login provider`'s
  device flow can run behind the API, "Decide in 025" — S7 answers it.
