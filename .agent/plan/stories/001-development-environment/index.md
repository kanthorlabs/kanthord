# EPIC 001 — Development environment · story index

**Format:** maintainer checklist. EPIC 001 is a maintainer epic —
`scripts/lane-check.sh` denies both engineer roles from `package.json`,
`tsconfig*.json`, `*.config.*`, `scripts/**`, `.claude/**`, `.agent/plan/**`.
These tasks are executed **directly by the human + assistant**, not dispatched
through `/work`. `/work` starts at EPIC 002.

Every task states explicitly: **Pre-requirements** (tasks that must be done
first) → **Input** (what it needs) → **Action** (what to do) → **Output**
(what it must produce) → **Verify** (how to prove the output is correct).

## Stories

1. [Story 1 — Toolchain baseline](01-toolchain-baseline.md)
2. [Story 2 — Import-boundary lint](02-import-boundary-lint.md)
3. [Story 3 — Walking skeleton + migration runner](03-walking-skeleton-migrations.md)
4. [Story 4 — Pipeline seams](04-pipeline-seams.md)
5. [Story 5 — Verify bundle](05-verify-bundle.md)

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

Derived from each task's pre-requirements:

1. S4-T1 seed `ts-gotchas.md`
2. S1-T1 audit tsconfig · S1-T2 hello module (test-first)
3. S2-T1 lint stack · S2-T2 flat config · S2-T3 `lint` script
4. S3-T1 → S3-T2 → S3-T3 → S3-T4 walking skeleton + migration runner (test-first)
5. S2-T4 automated negative boundary proof (after src exists)
6. S4-T2 working dirs · S4-T3 pre-flight smoke
7. S5-T1 verify bundle (last — aggregates everything)

## Non-goals

- No real domain model (EPIC 002). The skeleton schema is the single
  version-stamped `tasks(id)` table created by migration 1.
- EPIC 001 owns the **migration runner**; it adds no schema beyond migration 1.
  Later epics (002 domain, 003 persistence/queue/events) register their own
  migrations through this runner.
- No CI pipeline, no container build.
