# Story 07 — Query use cases (list / get / readiness)

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

CQRS-lite read side: `list` / `get` per aggregate reading the repo/SQL directly
(skip domain objects), and `list task --initiative` showing computed
ready/blocked state by reusing domain `readiness()`. Every query supports
`--json`.

## Acceptance Criteria

- Queries: `app/project/list-projects.ts`, `app/initiative/list-initiatives.ts`
  (`--project`), `app/objective/list-objectives.ts` (`--initiative`),
  `app/task/list-tasks.ts` (`--initiative` | `--objective`), plus
  `get-<aggregate>.ts` by id. Reads go through the read methods (capability
  map); no command use cases, no domain construction except the `GraphNode`
  map for readiness.
- `ListTasks` over an initiative loads ALL its tasks (across objectives) as
  `GraphNode{ id, status, dependencies }`, runs `validateGraph` + `readiness`
  (EPIC 002; reuses EPIC 003's `CheckStoredGraph` read model where it fits),
  and joins state onto each row. In EPIC 004 no task executes, so all tasks are
  `pending` and all appear.
- Output contract (locked):
  - **default (human):** a table to stdout; the `waiting` column shows
    dependency **titles** (not ids) — matches the epic Proof
    `blocked (waiting: implement api)`. Advisory notes only to stderr.
  - **`--json`:** a JSON array to stdout, each row
    `{ id, title, status, state, waiting: [<dep-id>…] }` (ids in JSON, titles
    in the human table).
  - `get <aggregate> --id` → key/value lines (default) or the single JSON
    object (`--json`); unknown id → `UnknownReferenceError` → exit 1 one line.

## Constraints

- Queries import storage read methods directly + `domain/graph` for readiness
  only; `import type` on the port. No command use cases.
- `ListTasks` runs `validateGraph` on read too — a corrupt persisted graph
  surfaces as a named error rather than a wrong report (debate finding).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — storage read methods

**Requires:** S03-T1, S04-T1, S05-T1 (rows exist to read).

**Input:** `src/storage/port.ts`, `src/storage/sqlite/*repository.ts`
(+ tests).

**Action — RED:** temp-DB test seeds a small graph and asserts each `list*` /
`get*` returns the expected rows; `listTasksByInitiative` spans objectives and
carries each task's `dependencies`. Fails today: methods absent.

**Action — GREEN:** implement `listProjects`, `listInitiatives`,
`listObjectives`, `listTasksByObjective`, `listTasksByInitiative` (SQL join
task→objective→initiative), and the `get*` reads.

**Action — REFACTOR:** none.

**Output:** storage exposes the list/get read methods from the capability map.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — ListTasks with readiness

**Requires:** T1; EPIC 002 S005 (`validateGraph`, `readiness`).

**Input:** `src/app/task/list-tasks.ts` (+ test).

**Action — RED:** hermetic test with a fake read port: two tasks, `deploy`
depends-on `api` → `api` state `ready`, `deploy` `blocked` waiting `[api-id]`;
rows carry titles for display; an unknown scope id → `UnknownReferenceError`.
Fails today: module absent.

**Action — GREEN:** implement `ListTasks`: load tasks, map to `GraphNode`,
`validateGraph` + `readiness`, merge state, attach titles via an id→title map.

**Action — REFACTOR:** none.

**Output:** `ListTasks` returns rows `{ id, title, status, state, waiting }`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — list/get use cases + handlers + `--json`

**Requires:** T2; S01; S02.

**Input:** `app/*/list-*.ts`, `app/*/get-*.ts` (+ tests); `src/apps/cli/*.ts`
(+ tests); `src/apps/cli/format.ts` (new).

**Action — RED:** handler tests: `list task --initiative <id>` default → a
stdout table with `implement api … ready` and `deploy … blocked (waiting:
implement api)`; `--json` → a JSON array on stdout with dep ids; `get <x> --id`
unknown → exit 1 one line. Fails today: modules absent.

**Action — GREEN:** implement the remaining list/get use cases + handlers + a
shared `format.ts` (table vs JSON); register `list *` / `get *` in `COMMANDS`.

**Action — REFACTOR:** fold table/JSON formatting into `format.ts` only where
it removes real duplication.

**Output:** every aggregate has `list` + `get` with `--json`; `list task` shows
ready/blocked with dependency titles.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
