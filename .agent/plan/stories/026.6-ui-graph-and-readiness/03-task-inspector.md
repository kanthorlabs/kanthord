# Story 03 — the inspector using the canonical task Summary

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decision 4)
Depends on: Story 02.

## Change

- In `ui/src/pages/entity-task.tsx`, at the existing `TaskSummary` component from EPIC 026.3 Story 05, export the component and its props. Keep its markup and behavior unchanged. The exported props are the values it already consumes: `task:TaskDetailDto`, `projectId:string`, `initiativeId:string`, `objectiveId:string`, and `siblingIds:readonly string[] | undefined`.
- Create `ui/src/components/graph-inspector.tsx` exporting:

```ts
export interface GraphInspectorProps {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly siblingIds: readonly string[];
}
export function GraphInspector(props: GraphInspectorProps): ReactElement;
```

- `GraphInspector` always renders a panel root with `data-testid="graph-inspector"`. Query `taskKeys.detail(taskId)` with `fetchTask(taskId,{signal})`, `staleTime:Infinity`, and no derived graph-node detail. Pass `asyncStateOf(query)` to `AsyncBoundary what="task"`; pass `query.error.message` only when that state is `error`. This preserves the existing loading, error, and 404 missing selectors.
- In the resolved inspector, render the fetched task title, then the exported `TaskSummary` with the exact props above. Add a `Link` labelled `Open task` to `/project/${projectId}/initiative/${initiativeId}/objective/${objectiveId}/task/${taskId}`.
- Edit `ui/src/pages/initiative-graph.tsx` at the W4 workspace. Own `selectedTaskId:string|null`, set by `GraphCanvas.onSelectTask`. For the selected graph node, derive `objectiveId` from `node.groupId` and `siblingIds` from all graph nodes with that group ID, in adapter order. Render no inspector before selection; render exactly one `GraphInspector` after selection. Reset selection to `null` when `initiativeId` changes or when refreshed graph data no longer contains the selected ID.

## Constraints

- `InitiativeGraphNodeDto` is never passed to `TaskSummary` and never cast to `TaskDetailDto`.
- Do not copy Summary markup. `entity-task.tsx` and the inspector import the same exported `TaskSummary` symbol.
- Selection does not change the URL. The canonical task link is the only edit path from the inspector.

## Verify

- `npm run test --workspace ui -- src/components/graph-inspector.test.tsx` — create this file with a fresh QueryClient and mocked `fetchTask`. Assert unresolved promise → `async-loading`; `ApiError(503)` → `async-error`; `ApiError(404)` → `async-missing`; resolved DTO → fetched title, `task-downstream`, and canonical `Open task` href. Assert the query key is `taskKeys.detail("t1")` and the helper receives `t1` plus an AbortSignal.
- In the same file, mock `@/pages/entity-task` with a spy component exporting `TaskSummary`; assert `GraphInspector` renders that exact export once with the fetched `TaskDetailDto`, not the graph node fixture.
- `npm run test --workspace ui -- src/pages/entity-task.test.tsx` — keep all canonical task Summary tests green after the export; add no second Summary implementation.
- `npm run test --workspace ui -- src/pages/initiative-graph.test.tsx` — append: no inspector initially; clicking `t1` issues `GET /api/task/t1`, opens one inspector, passes `o1` and only `o1` sibling IDs, and selection disappears when refreshed data removes `t1`.
- `npm run verify` exits 0.
- Proof: phase E clicks a graph node, observes successful `GET /api/task/:id`, sees `graph-inspector`, and matches the fetched task title.
