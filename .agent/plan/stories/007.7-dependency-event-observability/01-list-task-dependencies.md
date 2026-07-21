# Story 1 — S1 (BUG-4): declared `dependencies` in `list task --json`

Epic: `.agent/plan/epics/007.7-dependency-event-observability.md`

## Goal

`list task --initiative <id> --json` returns per task
`{ id, title, status, state, waiting }` — it exposes the _runtime_ `waiting` set
(the currently-unsatisfied deps) but **omits the static declared edges**. The DAG
the graph declared is not observable from the list, so a client cannot
reconstruct the graph from one call. The domain entity already carries
`dependencies: string[]` (`src/domain/task.ts`), so this is a projection gap, not
a model gap. This story adds the declared `dependencies` array to the list read
model beside `waiting`.

## Contract (tests assert this)

- `TaskRow` (`src/app/task/list-tasks.ts`) gains a `dependencies: string[]`
  field, populated from the task entity's `dependencies` in its stored order.
- `ListTasks.execute` returns each row with `dependencies` equal to that task's
  declared edges: a root task with no edges → `[]`; a sibling that declares one
  edge → `[<depId>]`. The value is the **full** declared set, independent of
  `waiting`.
- `dependencies` and `waiting` are distinct and both present:
  - `dependencies` — static; every declared edge, regardless of completion.
  - `waiting` — dynamic; the subset of deps not yet satisfied.
    For a pending sibling whose dep is still incomplete, `dependencies` ==
    `waiting` == `[depId]`. Once the dep completes, `waiting` becomes `[]` while
    `dependencies` stays `[depId]`.
- `list task --json` (`runListTasks` JSON branch, `src/apps/cli/list-tasks.ts`)
  includes `dependencies` for every row. That branch already
  `JSON.stringify(rows)`, so the field flows through once `TaskRow` carries it —
  assert the parsed JSON round-trips `dependencies`, do not add bespoke CLI
  formatting.
- Human (non-JSON) output is **unchanged**. The epic allows a compact deps
  count/ids in human mode but does not require it; we keep human output as-is to
  stay surgical. JSON is the contract.

## Constraints

- Query-side only (CQRS-lite read). **No domain change, no new port method** —
  `Task` already carries `dependencies` and `listByInitiative` already returns
  full task entities.
- Surgical: add the field to the `TaskRow` interface and map it in
  `ListTasks.execute`'s row builder. Do not alter the existing
  `status` / `state` / `waiting` logic or the human-output formatter.
- Apps stay transport-neutral: no formatting logic added to the use case; the CLI
  JSON branch serializes rows as-is (AGENTS.md apps rule).

## Verification Gate

- `node --test src/app/task/list-tasks.test.ts` — for an initiative whose
  sibling depends on the root:
  - root row `dependencies` deepEqual `[]`;
  - sibling row `dependencies` deepEqual `[<rootId>]`;
  - `waiting` still present on both rows;
  - a case where the root is `complete`: the sibling row shows
    `dependencies` deepEqual `[<rootId>]` while `waiting` deepEqual `[]` (proves
    the two are distinct projections).
- `node --test src/apps/cli/list-tasks.test.ts` — `list task --json` stdout,
  parsed, carries a `dependencies` array on each row equal to the declared edges.
- `npm run typecheck` exits 0; `npm run lint` clean.
