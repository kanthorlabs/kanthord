# Story 007 - check graph wiring

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

`check graph` runs end to end in the real program: `apps/cli` parses the YAML
file and passes plain data to the `CheckGraph` use case, which builds
`GraphNode`s and returns the readiness report. YAML stays in the app adapter
(`app/` imports only `domain/` and ports).

## Acceptance Criteria

- `CheckGraph.execute({ tasks: [{ id, dependencies? }] })` (plain data, no
  YAML): maps each row to a `GraphNode` with status `pending` (node id = the
  given label — no `newTask`, no ULIDs), runs `validateGraph`, and returns
  the story 005 readiness report; domain errors propagate to the caller.
- The CLI handler `runGraphCheck(filePath)` returns
  `{ exitCode, stdout: string[], stderr: string[] }`:
  - valid file → exit 0, `stderr` empty; one `stdout` line per task, input
    order, exactly `<id>: ready` or
    `<id>: blocked (waiting: <dep1>, <dep2>)`.
  - `CycleError` → exit 1, single `stderr` line
    `error: cycle detected: <path joined with " -> ">`.
  - `UnknownDependencyError` → exit 1,
    `error: unknown dependency: <dep> (referenced by <task>)`.
  - `DuplicateTaskError` → exit 1, `error: duplicate task id: <id>`.
  - unreadable file → exit 1, `error: invalid graph file: cannot read file`;
    YAML parse failure → `error: invalid graph file: invalid YAML`;
    wrong shape → `error: invalid graph file: tasks must be a list of
    { id, dependencies? }`.
- `node src/main.ts check graph --path <file>` prints `stdout` lines to stdout
  and `stderr` lines to stderr, exits with the returned code; the EPIC 001
  `status` command still works. Command grammar is verb-first `check graph`
  with the file path in the `--path <file>` flag (no positional argument).

## Constraints

- The YAML key is `dependencies` — verbatim the entity field name (locked;
  no `deps` alias). Extra top-level keys in the file are ignored.
- YAML parsing (the `yaml` package) and file reading live in
  `src/apps/cli/graph-check.ts` only. `src/app/graph/check-graph.ts` imports
  only `domain/`. `main.ts` registers `check graph` in the existing command
  table beside `status`; `check graph` opens no database.
- T2's tests read the committed `examples/*.yaml` fixtures (read-only inputs;
  maintainer story 008 M2 commits them before /work). Cases with no committed
  fixture (malformed file, duplicate id) use temp files the test creates and
  removes. Tests assert on the returned struct, not captured process output.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green. The EPIC Proof (the three
  `examples/` runs) is executed by the maintainer per story 008 M3 — it is
  the epic-level gate, not this story's test suite.

### Task T1 - CheckGraph use case

**Requires:** S005-T1 and S005-T2 (`GraphNode`, `validateGraph`,
`readiness`).

**Input:** `src/app/graph/check-graph.ts` (new),
`src/app/graph/check-graph.test.ts` (new); consumes `GraphNode`,
`validateGraph`, `readiness` from `domain/graph.ts`.

**Action - RED:** hermetic tests with plain input data: (a) a valid input
returns the readiness report (roots `ready`, dependents `blocked` with the
right `waiting`); (b) a cyclic input throws `CycleError`; (c) an unknown
dependency throws `UnknownDependencyError`; (d) a duplicate id throws
`DuplicateTaskError`. Fails today: module does not exist.

**Action - GREEN:** implement `CheckGraph` (one class, one `execute()`):
map plain `{ id, dependencies }` rows to pending `GraphNode`s,
`validateGraph`, return `readiness`.

**Action - REFACTOR:** none.

**Output:** `src/app/graph/check-graph.ts` exports `CheckGraph` with
`execute({ tasks }): ReadinessReport` per the Acceptance Criteria, importing
only `domain/`.

**Verify:** `npm test` green (all four RED cases); `npm run typecheck`
exit 0.

### Task T2 - CLI `check graph` + composition

**Requires:** S007-T1 (`CheckGraph`); story 008 M2 (fixtures committed —
maintainer, before /work).

**Input:** `src/apps/cli/graph-check.ts` (new),
`src/apps/cli/graph-check.test.ts` (new), the EPIC 001 CLI command-table
file under `src/apps/cli/`, `src/main.ts`; consumes `CheckGraph`, the `yaml`
package, and the committed `examples/*.yaml`.

**Action - RED:** tests call `runGraphCheck(path)`: (a) on
`examples/demo-graph.yaml` → exit 0 and exactly the four locked lines from
the epic Proof; (b) on `examples/invalid-cycle.yaml` → exit 1 and the locked
cycle message; (c) on `examples/invalid-unknown-dep.yaml` → exit 1 and the
locked message; (d) on a temp non-YAML file, a temp YAML file without
`tasks`, and a temp file with a duplicate id → exit 1 and the matching
locked `error:` line each. Fails today: module does not exist.

**Action - GREEN:** implement `runGraphCheck`: read the file, `yaml` parse,
shape-validate, call `CheckGraph`, format the locked lines; catch the three
domain errors into their locked messages. Register `check graph` in the CLI
command table (the `--path` flag supplies the file path); `main.ts` prints
the two streams and sets `process.exitCode`.

**Action - REFACTOR:** none.

**Output:** `src/apps/cli/graph-check.ts` exports `runGraphCheck(filePath):
{ exitCode, stdout, stderr }` per the Acceptance Criteria; `check graph` is
registered in the command table; `main.ts` wires it; `status` unaffected.

**Verify:** `npm test` green (all six RED cases); `npm run typecheck`
exit 0. Epic Proof runs per story 008 M3.
