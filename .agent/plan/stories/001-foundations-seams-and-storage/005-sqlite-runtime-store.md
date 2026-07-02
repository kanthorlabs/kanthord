# Story 005 - SQLite Runtime Store

Epic: `.agent/plan/epics/001-foundations-seams-and-storage.md`

## Goal

Open the disposable SQLite index in WAL mode with a busy timeout, run a versioned
migration on a fresh database, and expose a minimal typed execution seam later
Epics (compiler, scheduler, broker) build their own tables on. This Story ships
the **connection + migration-runner mechanism only** — no domain tables, no
compiled-plan projection (those belong to Epics 002/003/004).

## Acceptance Criteria

- Opening the store on a fresh temp path creates the database and records the
  current migration version in a `schema_version` metadata row.
- After opening, `PRAGMA journal_mode` reads `wal` and `PRAGMA busy_timeout` reads
  the configured non-zero value (live PRAGMA read).
- Re-opening an already-migrated database does not re-run applied migrations and
  leaves `schema_version` unchanged.
- A value written through the store's execution seam reads back equal (row
  round-trip), proving the seam works — using a throwaway migration-created table,
  not a product table.
- The store is disposable: deleting the file and re-opening reproduces the same
  `schema_version` from the migration list (PRD §6.1 — rebuildable, never synced).

## Constraints

- Use the SQLite access path confirmed by the **prerequisite spike gate** below
  (PRD §6.1 — local derived index; Principle 6 — prefer platform built-ins;
  `node:sqlite` avoids a native `better-sqlite3` build step). If the spike finds
  `node:sqlite` requires an unstable experimental flag or emits blocking warnings
  on Node 24, the findings file records `better-sqlite3` (provisioned like `yaml`)
  as the fallback and this Story codes against that instead — the spike decides.
- WAL + `busy_timeout` are mandatory because the daemon and broker both touch the
  DB (PRD §6.1).
- Migrations are versioned and forward-only for Phase 1, guarded by the recorded
  `schema_version` (PRD §6.1 — schema evolution stays migration-aware).
- The execution seam is a small `run`/`get`/`all` interface the consumer defines,
  injected by constructor/factory, so later Epics can fake it and tests run against
  a temp-file DB (PROFILE.md DI style). This mechanism is a Constraint, not an AC.

## Prerequisite - Spike gate (**Epic 000 SU2**; maintainer, NOT a TDD Task)

This spike is owned and tracked as **Epic 000 SU2** (the milestone-setup gate) — it is
**not** a `### Task` here because it edits nothing in the `src/**` lane and has no
RED/GREEN loop; the TDD lane also cannot install `better-sqlite3` if that fallback is
chosen. The technical detail below is what SU2 must produce; T1/T2 read its findings.
Spike triggers (authoring.md): **a pinned dependency's real surface** + **OS/container
boundary behavior**.

- **Gate action:** on Node 24, probe `node:sqlite` — open a temp DB, set
  `journal_mode=wal` and `busy_timeout`, run a `PRAGMA` read, exercise
  `exec`/`prepare`. Determine: (a) whether a runtime flag is required and which,
  (b) the exact open/exec/query API calls, (c) whether WAL + busy_timeout take
  effect, (d) any blocking experimental warning. If unusable, evaluate
  `better-sqlite3` as the fallback.
- **Gate output (blocks T1):**
  `.agent/plan/feedback/001-foundations-seams-and-storage/sqlite-access.md` stating
  the chosen library, any required runtime flag (so Epic 009's entrypoint and the
  `npm test` invocation can be configured), the concrete API calls to use, and the
  observed WAL/busy_timeout behavior. Consumed by Epics 002/003/004/009.

## Verification Gate

- Prerequisite spike findings file exists and names the chosen SQLite library +
  any required flag.
- `npm test` green for `src/foundations/sqlite-store.test.ts`, using a temp-file DB.
- A live `PRAGMA` read in the test asserts `journal_mode=wal` and non-zero
  `busy_timeout`.

### Task T1 - Open in WAL with busy_timeout + versioned migration

**Input:** `src/foundations/sqlite-store.ts`, `src/foundations/sqlite-store.test.ts`.
Reads (does not edit) the spike findings file for the confirmed API/flag.

**Action - RED:** Write a test that opens the store on a fresh temp path and asserts
`PRAGMA journal_mode` reads `wal`, `PRAGMA busy_timeout` reads the configured value,
and the `schema_version` row equals the current version.

**Action - GREEN:** Implement `openStore(path, opts)` using the spike's confirmed
calls: set WAL + busy_timeout pragmas, run pending migrations in order, record
`schema_version`. Ship an empty migration list plus one throwaway migration that
creates the round-trip test table used by T2 — no product/domain tables.

**Action - REFACTOR:** Extract the migration runner into a named helper if the open
path grows beyond linear setup; otherwise `none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Idempotent re-open + execution-seam row round-trip

**Input:** `src/foundations/sqlite-store.ts`, `src/foundations/sqlite-store.test.ts`

**Action - RED:** Write a test that opens, closes, and re-opens the same DB and
asserts migrations did not re-run (`schema_version` unchanged, no duplicate rows),
then inserts and reads a row through the `run`/`get`/`all` seam using the throwaway
table.

**Action - GREEN:** Guard migrations by recorded version; expose typed
`run`/`get`/`all` wrapping the confirmed prepare/execute calls.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
