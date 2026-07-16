# Story 02 — Error surface & reference resolution

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

The app-level error vocabulary, the single CLI mapping from those errors to
`{ exit code, one stderr line }`, and the `ReferenceResolver` read port that
makes "unknown" vs "wrong-type" references distinguishable. Defined before the
commands so every command throws the same typed errors and no expected error
ever prints a stack trace.

## Acceptance Criteria

- `src/app/errors.ts` exports transport-independent app errors with structured
  fields and locked `.message` strings:
  - `UnknownReferenceError { kind, id }` — `no <kind> with id <id>`
  - `WrongTypeReferenceError { expected, actual, id }` —
    `<id> is a <actual>, expected a <expected>`
  - `DuplicateNameError { kind, scope, name }` —
    `a <kind> named <name> already exists in <scope>`
  - `AmbiguousNameError { kind, name, ids }` —
    `multiple <kind> named <name>: <id>, <id>`
- CLI-parsing errors stay under `apps/cli` (NOT in `app/errors.ts`) — a
  `MissingFlagError { flag }` (`missing required flag --<flag>`) and the
  `--context` `key=value` parse error live beside the router.
- `src/apps/cli/error-map.ts` exports `toResult(err): { exitCode, stderr[] }`:
  each known app/CLI error → exit 1 + exactly one `error: <message>` line; an
  unknown/unexpected `Error` **rethrows** (a real bug still crashes loudly).
- `ReferenceResolver` port (`storage/port.ts`) exports
  `resolveKind(id): 'project'|'initiative'|'objective'|'task'|'resource'|undefined`;
  the SQLite adapter answers it with one indexed lookup across the id-owning
  tables.

## Constraints

- `app/errors.ts` is pure values (domain-free); `app/` may import it.
- `error-map.ts` and `MissingFlagError` import only `app/errors.ts` + local
  CLI types.
- `ReferenceResolver` is a read port; its adapter is tested on a temp DB.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — app error classes

**Requires:** none.

**Input:** `src/app/errors.ts` (new), `src/app/errors.test.ts` (new).

**Action — RED:** test constructs each of the four errors and asserts fields +
the locked `.message` string. Fails today: module absent.

**Action — GREEN:** implement the four classes (extend `Error`, set `name`).

**Action — REFACTOR:** none.

**Output:** `app/errors.ts` exports the four typed errors.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — CLI error mapping + MissingFlagError

**Requires:** T1; S01-T1 (handler result shape).

**Input:** `src/apps/cli/error-map.ts` (new), `src/apps/cli/error-map.test.ts`
(new).

**Action — RED:** test asserts each known error (the four app errors +
`MissingFlagError`) → `{ exitCode: 1, stderr: ["error: <locked msg>"] }`; an
unexpected `Error` rethrows. Fails today: module absent.

**Action — GREEN:** implement `MissingFlagError` (in `apps/cli`) and `toResult`
with a type-switch over the known errors; default = rethrow.

**Action — REFACTOR:** none.

**Output:** `error-map.ts` exports `toResult`; `MissingFlagError` lives under
`apps/cli`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — ReferenceResolver port + SQLite adapter

**Requires:** EPIC 003 (8-table schema, `openDatabase`); T1.

**Input:** `src/storage/port.ts`, `src/storage/sqlite/reference-resolver.ts`
(new) + `*.test.ts`.

**Action — RED:** temp-DB test seeds one row in each aggregate table and
asserts `resolveKind` returns the correct kind for each id and `undefined` for
an id present in no table. Fails today: method absent.

**Action — GREEN:** add `ReferenceResolver` to the port; implement the SQLite
adapter with one lookup per aggregate table (short-circuit on first hit).

**Action — REFACTOR:** none.

**Output:** `resolveKind(id)` distinguishes unknown (`undefined`) from every
aggregate kind — the basis for `UnknownReferenceError` vs
`WrongTypeReferenceError`.

**Verify:** `npm test` green (kind matrix + unknown); `npm run typecheck`
exit 0.
