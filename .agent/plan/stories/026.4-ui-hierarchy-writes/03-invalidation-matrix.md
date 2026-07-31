# Story 03 — the invalidation matrix and its guard

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decision 5)

## Change

### `ui/src/lib/invalidation.ts` — new file

```ts
export type MutationName =
  | "project.create"
  | "project.rename"
  | "initiative.create"
  | "initiative.rename"
  | "objective.create"
  | "objective.rename"
  | "task.create"
  | "dependency.write";

export interface InvalidationTarget {
  readonly queryKey: readonly unknown[];
  readonly exact: boolean;
  /** Narrows a prefix match; used only by the project-list row. */
  readonly predicate?: (queryKey: readonly unknown[]) => boolean;
}

export interface InvalidationContext {
  readonly projectId?: string;
  readonly initiativeId?: string;
  readonly objectiveId?: string;
  readonly id?: string;
  /** The source entity's detail key, for `dependency.write`. */
  readonly entityKey?: readonly unknown[];
}

export function projectListTarget(): InvalidationTarget;

export const INVALIDATION_MATRIX: Readonly<
  Record<
    MutationName,
    (ctx: InvalidationContext) => readonly InvalidationTarget[]
  >
>;

export async function invalidateFor(
  client: QueryClient,
  mutation: MutationName,
  ctx: InvalidationContext,
): Promise<void>;
```

**Exactness is part of the matrix, not an afterthought.** A bare
`invalidateQueries({queryKey: ["project"]})` is a prefix match and would also
invalidate every `["project", id, …]` detail, overview, initiative list and
resource list — 026.2 S2 forbids that. So:

- `projectListTarget()` returns
  `{ queryKey: ["project"], exact: false, predicate: (k) => k.length === 1 || (k.length === 2 && typeof k[1] === "object" && k[1] !== null) }`
  — it matches `projectKeys.list()` (`["project"]`) and
  `projectKeys.list(name)` (`["project", {name}]`) and **nothing else**;
- every other target is built from the 026.2/026.3 key factories in
  `@/lib/query-keys` — never a hand-written array literal;
- `taskKeys.list(initiativeId)` is the only other `exact: false` row, because the
  objective-filtered list `["initiative", iid, "task", {objective}]` sits under
  the same prefix and must refresh too. Nothing else lives under that prefix.

The eight rows, matching the epic's table exactly:

| `MutationName`      | targets                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `project.create`    | `projectListTarget()`                                                                                   |
| `project.rename`    | `projectListTarget()`, `{projectKeys.detail(id), exact:true}`, `{projectKeys.overview(id), exact:true}` |
| `initiative.create` | `{initiativeKeys.list(projectId), exact:true}`, `{projectKeys.overview(projectId), exact:true}`         |
| `initiative.rename` | the `initiative.create` rows + `{initiativeKeys.detail(id), exact:true}`                                |
| `objective.create`  | `{objectiveKeys.list(initiativeId), exact:true}`, `{projectKeys.overview(projectId), exact:true}`       |
| `objective.rename`  | the `objective.create` rows + `{objectiveKeys.detail(id), exact:true}`                                  |
| `task.create`       | `{taskKeys.list(initiativeId), exact:false}`, `{projectKeys.overview(projectId), exact:true}`           |
| `dependency.write`  | `{entityKey, exact:true}`, `{projectKeys.overview(projectId), exact:true}`                              |

- A row whose context field is missing **throws** `new Error(\`invalidation
  ${mutation} needs ctx.${field}\`)` — it must never silently invalidate less.
- `invalidateFor` maps each target to
  `client.invalidateQueries({ queryKey, exact })`, adding
  `predicate: (q) => target.predicate(q.queryKey)` when present, and awaits
  `Promise.all`. It contains no `switch` and no per-mutation branch.
- Declare the matrix with `satisfies Record<MutationName, …>` so a new
  `MutationName` fails `tsc` until it has a row.
- Do not change `invalidateOverview` from 026.2 — leave it in place; new callers
  use `invalidateFor`.

## Constraints

- Surgical: `ui/src/lib/query-keys.ts` is not edited by this story.
- The module imports `@tanstack/react-query` types and the key factories only —
  no component, no api-client.
- Later epics add rows here; do not add a row for a surface this epic does not
  write (no graph, no readiness, no resource).

## Verify

`npm run test --workspace ui -- src/lib/invalidation.test.ts` — new file, using a
real `QueryClient` with seeded cache entries and a spy on `invalidateQueries`:

- **one test per matrix row** (eight tests): assert the exact array of
  `{queryKey, exact}` passed to `invalidateQueries`, in the table's order.
- **the guard test**: iterate `Object.keys(INVALIDATION_MATRIX)` and assert it
  deep-equals the full `MutationName` list; assert every value is a function that
  returns at least one target for a fully-populated context. A mutation name with
  no row fails here as well as at `tsc`.
- **project-list exactness**: seed `["project"]`, `["project", {name:"a"}]`,
  `["project","p1"]`, `["project","p1","overview"]`, `["project","p1","initiative"]`;
  run `project.create`; assert the first two are invalidated and the last three
  are **not** (`client.getQueryState(key)?.isInvalidated`).
- **`project.rename` does invalidate the detail and overview** of that id, and
  still not `["project","p2"]`.
- **`task.create` prefix**: seed `["initiative","i1","task"]` and
  `["initiative","i1","task",{objective:"o1"}]`; both are invalidated; seed
  `["initiative","i2","task"]` and assert it is not.
- **missing context throws**: `invalidateFor(client, "objective.create", {})`
  rejects with a message naming `initiativeId`.

`npm run verify` exits 0.

Proof: `ui-writes-proof.sh:179-182` — after the recovery resubmit the new name
appears in `project-table` **and** in the `breadcrumb` on the Overview, which is
`project.rename`'s three rows holding.
