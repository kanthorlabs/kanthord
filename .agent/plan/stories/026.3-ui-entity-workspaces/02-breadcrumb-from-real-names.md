# Story 02 — the breadcrumb, built from the chain's real names

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decision 4)
Depends on: Story 01.

## Change

### 1. Add `segments` to every hook in `ui/src/app/entity-chain.ts`

Extend each chain interface with `readonly segments: readonly string[]` and
compute it from the **resolved** queries only. No id ever appears
(`ui/src/components/shell.test.tsx:168`), no client-side cache is assumed, and
no level is guessed from the URL.

```ts
/** Drops every level whose name has not resolved. Never falls back to an id. */
function trail(...names: readonly (string | undefined)[]): readonly string[];
```

`trail` returns `names.filter((n): n is string => n !== undefined)`.

Pinned per hook:

| hook                 | `segments`                                                           |
| -------------------- | -------------------------------------------------------------------- |
| `useInitiativeChain` | `trail(projectName, initiative?.name)`                               |
| `useObjectiveChain`  | `trail(projectName, initiative?.name, objective?.name)`              |
| `useTaskChain`       | `trail(projectName, initiative?.name, objective?.name, task?.title)` |
| `useResourceChain`   | `trail(projectName, RESOURCE_TYPE_LABEL[type], resource?.name)`      |

`RESOURCE_TYPE_LABEL` is a new export in `ui/src/lib/dto.ts`, the labels EPIC
026.2 Story 06 already renders on the tabs, so the two surfaces cannot drift:

```ts
export const RESOURCE_TYPE_LABEL: Readonly<Record<ResourceTypeKey, string>> = {
  repository: "Repositories",
  credential: "Credentials",
  notification: "Notifications",
  filesystem: "Filesystems",
};
```

`RESOURCE_TYPE_LABEL[type]` is `undefined` for an unknown `:type`, so `trail`
drops that level and the breadcrumb reads `alpha › repo-1` — never
`alpha › not-a-type › repo-1`. If 026.2 Story 06 already exports a label map,
import that one and add nothing (`rg -n "Repositories" ui/src`).

The ancestor **name** queries are the same ones Story 01 already runs for
validation: `projectKeys.detail`, `initiativeKeys.detail`, `objectiveKeys.detail`
and `resourceKeys.detail`. This story adds **no new request**. In particular the
task page reads the initiative and objective _detail_ endpoints it already has
in its chain, not the ids from the URL.

### 2. Wire `segments` in the four pages

In `ui/src/pages/entity-initiative.tsx`, `entity-objective.tsx`,
`entity-task.tsx` and `entity-resource.tsx`, replace `segments={[]}` with
`segments={chain.segments}`.

`EntityWorkspace` already forwards `segments` to `ProjectShell` (Story 01 §7), so
the breadcrumb is populated in **every** gate state — a scope mismatch or a
missing entity still shows the ancestors that did resolve.

## Constraints

- A segment is a real name or the level is dropped. Never an id, never `"…"`,
  never the raw `:type` slug.
- No new query and no new key. Adding a name-only fetch here would duplicate a
  chain query and break Story 08's request-count expectations.
- Do not change `ui/src/components/shell.tsx` — the breadcrumb markup is 026.1's
  and renders `segments` verbatim.
- Do not put the entity id in the header, the title or the breadcrumb.

## Verify

- Extend `ui/src/pages/entity-routes.test.tsx` (Story 01's file) —
  `npm run test --workspace ui -- src/pages/entity-routes.test.tsx`:
  - `/project/p1/initiative/i1` fully resolved → `[data-testid="breadcrumb"]`
    text contains `alpha` and `init-1`, and contains neither `p1` nor `i1`.
  - `/project/p1/initiative/i1/objective/o1` → the breadcrumb contains `alpha`,
    `init-1` and `obj-1`, in that document order (assert with
    `indexOf` over the breadcrumb's `textContent`).
  - `/project/p1/initiative/i1/objective/o1/task/t1` → the breadcrumb contains
    all four, ending with the task title `main-task`, and contains no id.
  - `/project/p1/resource/repository/r1` → the breadcrumb is exactly
    `alpha`, `Repositories`, `repo-1` in that order.
  - `/project/p1/resource/not-a-type/r1` (the resource answers
    `type: "repository"`) → the breadcrumb contains `alpha` and `repo-1` and
    **does not** contain `not-a-type`.
  - partial resolution: `fetchInitiative` left pending while the project query
    resolves → the breadcrumb text is exactly `alpha` (one segment) and
    `[data-testid="async-loading"]` is present.
  - scope mismatch: the wrong-objective task case from Story 01 → the breadcrumb
    still contains `alpha` and `init-1`, and `[data-testid="scope-mismatch"]` is
    present.
  - request budget: after `/project/p1/initiative/i1/objective/o1/task/t1`
    settles, `fetchInitiative`, `fetchObjective` and `fetchTask` have each been
    called exactly **once**, and `fetchObjectives` exactly once.
- `npm run verify` exits 0.
- Proof: **phase C** (`breadcrumb` names the real project and initiative) and the
  breadcrumb assertion of **phase D** (`breadcrumb` names the objective).
