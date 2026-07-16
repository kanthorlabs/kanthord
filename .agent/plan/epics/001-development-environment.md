# EPIC 001 — Development environment

## Goal

The repository is ready for the coding-assistant pipeline: the Node 24 / ESM /
type-stripping toolchain is proven by real code, every gate command runs green,
the import-boundary rules from `AGENTS.md` are machine-enforced, and — most
important — a **walking skeleton** exists: `main.ts` composition root, a thin
`apps/cli/`, one trivial use case, and the `node:sqlite` adapter, wired end to
end against a real database file. After this epic, every later epic extends a
running program instead of building parts to wire later.

## Verification Gate

Gates:  `npm run typecheck && npm test && npm run verify:handoff && npm run lint`
Proof:  `node src/main.ts status` — opens (creating if absent) the real SQLite
        file at `.data/kanthord.db`, and prints the DB path, schema version,
        journal mode (`wal`), and task count (`0`). Exit 0.

## Stories

- **Toolchain baseline.** Strict `tsconfig.json` for Node 24 type stripping
  (`verbatimModuleSyntax`, explicit `.ts` import extensions), proven by one
  hello domain module + its co-located `node:test` test — the first green
  RED→GREEN cycle in the repo.
- **Import-boundary lint.** ESLint flat config with an import-boundary rule
  encoding the `AGENTS.md` import directions (`domain/` imports nothing
  outside itself; `app/` only `domain/` + `*/port.ts`; only `main.ts` imports
  concrete adapters; `apps/` never imports adapters or `domain/` internals).
  `npm run lint` added and green.
- **Walking skeleton + migration runner.** `src/main.ts` composition root +
  `src/apps/cli/` with a `status` command → `app/status/get-status.ts` use case
  → `storage/port.ts` → `storage/sqlite/` adapter on `node:sqlite` (WAL mode,
  DB path from `KANTHORD_DB` env with `.data/kanthord.db` default). This epic
  owns the **migration runner** (`storage/sqlite/migrate.ts`): a `user_version`
  + ordered-list mechanism run once at bootstrap, idempotent (nothing pending →
  nothing runs). Migration 1 creates the version-stamped `tasks(id)` table;
  `schemaVersion()` reads `user_version`. Later epics register their own
  migrations by appending to the list. The full architecture path exists and runs.
- **Pipeline seams.** Seed `.agent/tdd/memory/ts-gotchas.md` with the known
  Node 24 type-stripping pitfalls; create `.agent/tdd/history/` and
  `.agent/plan/stories/`; confirm `/work` pre-flight passes against this epic.
- **Verify bundle.** `npm run verify` runs gates + prints the Proof command
  output, so "is the repo healthy?" is one command.

## Non-goals

- No real domain model (EPIC 002) — the skeleton's schema is a single
  version-stamped table created by migration 1. The migration *runner* lives
  here; EPIC 003 (persistence/queue/events) does not build a framework, it
  registers its own migrations through this runner.
- No CI pipeline, no container build.
- **Maintainer epic:** most stories edit lane-forbidden files (`tsconfig`,
  eslint config, `package.json`), so this epic is executed directly by the
  human + assistant, not dispatched through `/work`. `/work` starts at
  EPIC 002.
