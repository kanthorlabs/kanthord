# EPIC 001 — Development environment · story/task checklist

**Format:** maintainer checklist. EPIC 001 is a maintainer epic — `scripts/lane-check.sh`
denies both engineer roles from `package.json`, `tsconfig*.json`, `*.config.*`,
`scripts/**`, `.claude/**`, `.agent/plan/**`. So these tasks are executed
**directly by the human + assistant**, not dispatched through `/work`. This is
NOT the `/work` `Action — RED/GREEN/REFACTOR:` engineer format; it is a plan with
a verify command per task. `/work` starts at EPIC 002.

Two sub-parts are genuinely in-lane (`src/**`): the hello domain module and the
walking-skeleton source + tests. Those are done **test-first by hand** so the
epic's "first RED→GREEN cycle" really happens.

## Locked decisions

- **Migration mechanism:** SQLite native `PRAGMA user_version` + an ordered
  in-code migration list. EPIC 001 owns the **runner** (infrastructure); later
  epics register their own migrations by appending to the list — no new runner
  code. Runs once at bootstrap; idempotent (nothing pending → nothing runs).
- **Keep the hello domain module** (do not substitute `schema-version.ts`) —
  EPIC 001 has no real domain unit yet; that is EPIC 002.
- **`tasks` table** is created **by migration 1**: `tasks(id TEXT PRIMARY KEY)`.
  `schemaVersion()` reads `user_version` (real, runner-set — not hardcoded).
- **SQLite `ExperimentalWarning`** (stderr, exit 0 on Node 24.12) is **not** a
  blocker — the Proof needs exit 0 + stdout, not empty stderr. Document it; do
  not add stderr filtering.
- **Status output format (locked contract):** four `key: value` lines —
  `db:`, `schema:`, `journal_mode:`, `tasks:`.
- **DB env var:** `KANTHORD_DB`, default `.data/kanthord.db` (per epic).

## Recommended execution order

1. S4-T1 seed `ts-gotchas.md`
2. S1 audit tsconfig + hello module (test-first)
3. S2 lint config + `lint` script (skeleton written lint-clean)
4. S3 walking skeleton + migration runner (test-first) + Proof
5. S2-T4 automated negative boundary test (after src exists)
6. S4-T2 / S4-T3 remaining seams + pre-flight smoke
7. S5 verify bundle (last)

---

## Story 1 — Toolchain baseline

Acceptance: strict `tsconfig.json` proven by a real module; first RED→GREEN green.

### Task S1-T1 — Audit tsconfig (maintainer-config)
- **Files:** `tsconfig.json` (audit; edit only if a required flag is missing).
- **Do:** confirm `verbatimModuleSyntax`, `allowImportingTsExtensions`, `strict`,
  `noUncheckedIndexedAccess`, `module/moduleResolution: nodenext`,
  `include: ["src/**/*.ts"]`. (All present today.)
- **Verify:** `npm run typecheck` → exit 0.

### Task S1-T2 — Hello domain module, test-first (src-in-lane)
- **Files:** `src/domain/greeting.ts` + `src/domain/greeting.test.ts`.
- **Do:** write `greeting.test.ts` first (imports `./greeting.ts`, asserts the
  observable return) → `npm test` RED → implement → GREEN.
- **Verify:** `npm test` new test passes; `npm run typecheck` → exit 0.

## Story 2 — Import-boundary lint

Acceptance: flat config encodes the 4 `AGENTS.md` import directions; `npm run lint`
green; a forbidden import is proven to fail lint by an automated, re-runnable check.

### Task S2-T1 — Add complete ESLint + TypeScript stack (maintainer-config)
- **Files:** `package.json` and `package-lock.json`.
- **Do:** add a full TS lint stack, not just `eslint`: `eslint` +
  `typescript-eslint` (parser + config) + a boundary mechanism
  (`eslint-plugin-import` with the TS resolver, or `eslint-plugin-boundaries`).
  Bare `eslint .` will not parse or resolve `.ts` without the parser + resolver.
  Respect `.npmrc` `min-release-age=3` (deps must be ≥3 days old).
- **Verify:** install succeeds; `npx eslint --print-config src/main.ts` shows the
  TS parser active.

### Task S2-T2 — Flat config: explicit globs + test carve-out (maintainer-config)
- **Files:** `eslint.config.js`.
- **Do:** express allowed dependency edges **by source glob**, not broad prose:
  - `src/domain/**` → imports only `src/domain/**` + `node:*`.
  - `src/app/**` → imports `src/domain/**`, `*/port.ts`, `node:*`
    (per `AGENTS.md`: no use-case-calls-use-case).
  - only `src/main.ts` imports concrete adapters (`src/storage/sqlite/**`, …).
  - `src/apps/**` → never imports adapters or `domain/` internals.
  - **Test carve-out:** `src/**/*.test.ts` may import `node:test`, `node:assert`,
    and (co-located adapter tests) the adapter in their own directory. Scope the
    boundary rules to production files or add per-glob overrides.
- **Verify:** `npx eslint .` runs with no config error.

### Task S2-T3 — `lint` script (maintainer-config)
- **Files:** `package.json` → `"lint": "eslint ."`.
- **Verify:** `npm run lint` → exit 0 on current `src/`.

### Task S2-T4 — Automated negative boundary proof (maintainer)
- **Files:** a committed test/fixture (not a manual add-and-revert).
- **Do:** a `RuleTester`-based test for the boundary config, OR a committed
  fixture of known-bad imports checked by a script asserting non-zero exit.
- **Verify:** the negative proof passes (forbidden imports are reported) and
  re-runs on every `npm run lint` / `npm test`. A rule that never fires is worthless.

## Story 3 — Walking skeleton + migration runner

Acceptance: `main.ts` → `apps/cli/` `status` → `app/status/get-status.ts` →
`storage/port.ts` → `storage/sqlite/` on `node:sqlite`, wired end to end; the
migration runner (infrastructure) applies migration 1 at bootstrap; Proof runs.

### Task S3-T1 — `GetStatus` use case + `StatusStore` port, test-first (src-in-lane)
- **Files:** `src/storage/port.ts` (`StatusStore`: `path`, `schemaVersion()`,
  `journalMode()`, `taskCount()`, `close()`); `src/app/status/get-status.ts`
  (`GetStatus.execute()` → `{ dbPath, schemaVersion, journalMode, taskCount }`);
  test `src/app/status/get-status.test.ts` with a hand-written `FakeStatusStore`.
- **Do:** RED (four fields from a faked port) → implement (`import type` the port)
  → GREEN.
- **Verify:** `npm test` green; `npm run typecheck` → exit 0.

### Task S3-T2 — Migration runner (the infrastructure), test-first (src-in-lane)
- **Files:** `src/storage/sqlite/migrate.ts` (`Migration` interface:
  `version:number`, `name:string`, `up(db):void`; `migrate(db, migrations)`
  reads `user_version`, applies each migration with `version > current` in order,
  **each in its own transaction**, bumps `user_version`, returns final version);
  test `src/storage/sqlite/migrate.test.ts` against a temp DB.
- **Do:** RED tests covering: applies pending in order; **skips already-applied
  on re-run (idempotency)**; rolls back a failing migration (no half-applied
  schema); rejects a bad version sequence (not strictly increasing / gaps).
  Use toy migrations in the test — do not depend on the real registry.
- **Verify:** `npm test` green; `npm run typecheck` → exit 0.

### Task S3-T3 — Migration registry + SQLite adapter, test-first (src-in-lane)
- **Files:** `src/storage/sqlite/migrations.ts` (`MIGRATIONS` — migration 1:
  `create tasks table` → `CREATE TABLE tasks(id TEXT PRIMARY KEY)`; later epics
  append here); `src/storage/sqlite/sqlite-status-store.ts` (`SqliteStatusStore`
  implements `StatusStore`: opens/creates the DB, `PRAGMA journal_mode=WAL`, runs
  `migrate(db, migrations)` on open, `schemaVersion()` reads `user_version`,
  `taskCount()` reads `tasks`, `close()` closes the handle; migration list is
  **injected** so tests can pass their own); co-located test against a temp DB
  with deterministic cleanup (`finally`/teardown removes the temp file).
- **Do:** RED (WAL == `wal`, `schemaVersion()` == 1 after migrate, `taskCount()`
  == 0, `close()` works, temp cleanup runs) → implement → GREEN. Use plain
  `CREATE TABLE` in the migration (the `user_version` guard is idempotency; a
  plain create fails loud on unexpected state).
- **Verify:** `npm test` green; `npm run typecheck` → exit 0.

### Task S3-T4 — Composition root + CLI (src-in-lane; proven by Proof)
- **Files:** `src/apps/cli/` (parse argv, `status` → `GetStatus`, format the four
  locked output lines); `src/main.ts` (read `KANTHORD_DB`, default
  `.data/kanthord.db`; **`mkdirSync(dirname(dbPath), { recursive: true })`** so a
  clean checkout without `.data/` does not fail `SQLITE_CANTOPEN`; construct
  `new SqliteStatusStore({ path, migrations: MIGRATIONS })` — migration runs at
  this bootstrap — wire `GetStatus` → CLI; close the store after the command).
- **Verify:** the exact Proof block in S5-T1 (both runs).

## Story 4 — Pipeline seams

Acceptance: TDD memory + history + stories dirs exist; `/work` pre-flight passes.

### Task S4-T1 — Seed `ts-gotchas.md` (maintainer; `.agent/tdd/*`)
- **Files:** `.agent/tdd/memory/ts-gotchas.md`.
- **Do:** seed verified Node 24 pitfalls: explicit `.ts` import extensions;
  `verbatimModuleSyntax` → `import type` for type-only; `node:` builtin form;
  top-level await OK in ESM; **`node:sqlite` prints `ExperimentalWarning` to
  stderr, exit 0 (verified 24.12)**; `noUncheckedIndexedAccess` → indexed access
  is `T | undefined`.
- **Verify:** file exists, lists each pitfall.

### Task S4-T2 — Create working dirs (maintainer)
- **Files:** `.gitkeep` in `.agent/tdd/history/`, `.agent/plan/stories/`,
  `.agent/tdd/memory/test-engineer/`, `.agent/tdd/memory/software-engineer/`.
- **Verify:** `ls -d .agent/tdd/history .agent/plan/stories` succeed.

### Task S4-T3 — `/work` pre-flight smoke (maintainer, read-only)
- **Do:** `/work` has no dry-run mode, so do not invoke it. Run the read-only
  checks directly:
  ```bash
  test -f .agent/plan/epics/001-development-environment.md \
    && test -f .claude/agents/test-engineer.md \
    && test -f .claude/agents/software-engineer.md \
    && test -f .claude/agents/reviewer-engineer.md \
    && test -d .agent/tdd/history && echo "preflight OK"
  ```
- **Verify:** prints `preflight OK`; no subagent dispatched.

## Story 5 — Verify bundle

Acceptance: one command runs gates + prints the Proof.

### Task S5-T1 — `verify` script + exact Proof (maintainer-config)
- **Files:** `package.json` →
  `"verify": "npm run typecheck && npm test && npm run verify:handoff && npm run lint && node src/main.ts status"`.
  Do not add stderr filtering — the `ExperimentalWarning` is acceptable.
- **Proof (exact, copy-paste; runs from a clean checkout):**
  ```bash
  # 1. clean-checkout proof — fresh temp DB proves init from nothing
  export KANTHORD_DB="$(mktemp -d)/kanthord.db"
  node src/main.ts status
  # expected stdout, exit 0 (stderr may carry ExperimentalWarning — OK):
  #   db: <value of $KANTHORD_DB>
  #   schema: 1
  #   journal_mode: wal
  #   tasks: 0

  # 2. default-path proof — confirms .data default + auto dir creation
  unset KANTHORD_DB
  rm -f .data/kanthord.db
  node src/main.ts status
  # expected stdout, exit 0:
  #   db: .data/kanthord.db
  #   schema: 1
  #   journal_mode: wal
  #   tasks: 0
  ```
- **Verify:** `npm run verify` → exit 0; both Proof runs print the block above.

## Non-goals

- No real domain model (EPIC 002). The skeleton schema is the single
  version-stamped `tasks(id)` table created by migration 1.
- EPIC 001 owns the **migration runner**; it does not add any schema beyond
  migration 1. Later epics (002 domain, 003 persistence/queue/events) register
  their own migrations through this runner.
- No CI pipeline, no container build.
