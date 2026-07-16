# Story 01 — CLI argument layer

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

A `parseArgs`-based, **verb-first** command router in `src/apps/cli/` with an
explicit, grep-able command table, per-command `--help`, and the locked handler
contract (`{ exitCode, stdout[], stderr[] }`). Every later command plugs into
this; the EPIC 002/003 pre-existing commands (`check graph`, `db migrate`,
`db status`) keep working.

## Acceptance Criteria

- `src/apps/cli/router.ts` exports `dispatch(argv, deps)` and a `COMMANDS`
  table keyed by `"<verb> <object>"` (e.g. `"create project"`) → `{ handler,
  usage, parse }`. The key maps 1:1 to a use-case class name.
- Unknown command → exit 1, stderr `error: unknown command: <verb> <object>`,
  plus a one-line list of known commands.
- `--help`/`-h` on any command → exit 0, usage text to stdout.
- `parseArgs` runs in `strict: true`; an unknown flag or missing required
  positional → exit 1, `error: <msg>` + usage on stderr.
- `main.ts` routes every argv through `dispatch`, prints `stdout` to stdout and
  `stderr` to stderr, sets `process.exitCode`. `check graph`, `db migrate`,
  `db status` are registered in the same table and behave exactly as before.

## Constraints

- `node:util` `parseArgs` only — no arg-parsing dependency (Principle 6).
- `router.ts` imports handler + use-case types only; no domain/adapter logic.
- `deps` is the composition-root bundle injected by `main.ts` (story 09
  extracts `buildDeps(dbPath)`; until then `main.ts` builds inline).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — command table + dispatch

**Requires:** EPIC 002 S007 (`runGraphCheck`), EPIC 003 (db commands + storage
port) — the pre-existing handlers registered in the table.

**Input:** `src/apps/cli/router.ts` (new), `src/apps/cli/router.test.ts` (new).

**Action — RED:** test asserts (a) `dispatch(["create","project","--help"],
deps)` → exit 0, usage on stdout; (b) an unknown command → exit 1 + a
known-command list on stderr; (c) an unknown flag under strict `parseArgs` →
exit 1 + usage. Seeds a stub `create project` handler returning exit 0. Fails
today: module absent.

**Action — GREEN:** implement the `COMMANDS` table (seeded with the stub +
the pre-existing `check graph`/`db *` entries) and `dispatch` with per-command
`parseArgs` config and `--help`.

**Action — REFACTOR:** none.

**Output:** `router.ts` exports `dispatch(argv, deps)` and `COMMANDS` with the
verb-first key contract above.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — main.ts wiring + stream/exit contract

**Requires:** T1.

**Input:** `src/main.ts`, `src/apps/cli/router.test.ts`.

**Action — RED:** test drives `dispatch` for a stub handler returning
`{ exitCode: 2, stdout: ["X"], stderr: ["Y"] }` and asserts the router
surfaces all three unchanged; `main.ts`'s printing is asserted through an
injected writer. `check graph` and `db *` still resolve through the table.

**Action — GREEN:** `main.ts` builds `deps`, calls `dispatch`, writes the two
streams, sets `process.exitCode`; move the `check graph` + `db *` registrations
into `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `main.ts` routes all commands through `dispatch`; the two-stream +
exit contract holds; prior commands intact.

**Verify:** `npm test` green; `npm run typecheck` exit 0; `node src/main.ts
check graph --path examples/demo-graph.yaml` still exits 0 (manual sanity).
