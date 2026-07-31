# Story 05 — graph freshness and immediate hierarchy invalidation

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decision 7)
Depends on: Story 04 and EPIC 026.4 Story 07.

## Change

- Create `ui/src/lib/graph-freshness.ts` exporting:

```ts
export interface UseGraphFreshnessOptions {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly overview: ProjectOverviewDto | undefined;
}
export function useGraphFreshness(
  options: UseGraphFreshnessOptions,
): VisibilityPollState;
```

- Use EPIC 026.2's `useVisibilityPoll`; do not create another interval. Initialize local `observedLatest` from `overview?.digest.latest ?? null`. An effect with dependencies `[projectId, overview?.digest.latest]` copies the cached Overview value into `observedLatest`; this covers the initial `undefined` → resolved query and project changes. The probe calls `fetchProjectOverview(projectId,{signal})`, stores its returned `digest.latest` in a ref, and returns that value.
- On a changed probe, first set `observedLatest` to the stored probe value, then call `queryClient.refetchQueries({queryKey:initiativeKeys.graph(initiativeId),exact:true,type:"active"})`. This baseline update prevents the same `latest` value from causing another refetch on the next tick. An unchanged value performs no graph operation. Set the poller's `resetKey` to `projectId + ":" + initiativeId`.
- Edit `ui/src/pages/initiative-graph.tsx` after its project-detail query. Add a non-gating `useQuery` with `projectKeys.overview(projectId)`, `fetchProjectOverview(projectId,{signal})`, and `staleTime:Infinity`. Pass its `data` to `useGraphFreshness`; Overview loading or failure must not replace a resolved graph. Render `overviewQuery.error ?? poll.error` in a non-destructive `<p data-testid="graph-poll-error" role="status">`; render nothing there when both are null.
- In `ui/src/lib/invalidation.ts`, use the existing `InvalidationContext.initiativeId` and append `{queryKey:initiativeKeys.graph(initiativeId),exact:true}` as the final target, in this fixed scope:
  - `initiative.rename`
  - `objective.create`
  - `objective.rename`
  - `task.create`
  - `dependency.write`
- Do not add graph targets to `project.create`, `project.rename`, or `initiative.create`; those operations do not change an existing initiative graph DTO.
- Edit these exact callers so each existing `invalidateFor` context includes the current `initiativeId`: `ui/src/components/rename-initiative.tsx` (`initiative.rename`, use the renamed ID), `ui/src/components/create-objective.tsx`, `ui/src/components/rename-objective.tsx`, `ui/src/pages/entity-task-create.tsx`, and the dependency `onWritten` callbacks in `ui/src/pages/entity-initiative.tsx`, `ui/src/pages/entity-objective.tsx`, and `ui/src/pages/entity-task.tsx`. The matrix guard throws `new Error(`invalidation ${mutation} needs ctx.initiativeId`)` when a graph-bearing row omits it.

## Constraints

- Polling refetches exactly the active graph key. It does not invalidate a key prefix or every initiative graph.
- Mutation success invalidates the graph immediately; it does not wait for a timer or `digest.latest` movement.
- The Overview query remains the signal source. Do not add a digest field to the graph DTO.

## Verify

- `npm run test --workspace ui -- src/lib/graph-freshness.test.tsx` — create this hook test with fake timers, visible document state, a real QueryClient, active observers for graph `i1`, graph `i2`, and Overview. Same `digest.latest` after one interval causes zero graph fetches. A changed value causes exactly one `i1` graph refetch and zero `i2` refetches. A second interval returning that same new value causes no second refetch. A rejection returns the same error and does not clear cached graph data.
- `npm run test --workspace ui -- src/lib/invalidation.test.ts` — update the five row expectations with the graph target last. Seed graphs for `i1` and `i2`; each row with `initiativeId:"i1"` invalidates only `i1`. Assert the three excluded rows do not invalidate either graph. Assert missing `initiativeId` throws the exact guard error for `dependency.write`.
- `npm run test --workspace ui -- src/components/rename-initiative.test.tsx` — append that success passes its own initiative ID.
- `npm run test --workspace ui -- src/components/create-objective.test.tsx` and `npm run test --workspace ui -- src/components/rename-objective.test.tsx` — append that success passes the route initiative ID.
- `npm run test --workspace ui -- src/pages/entity-task-create.test.tsx` — retain its existing `initiativeId` assertion and assert the matching graph key is invalidated before any timer advance.
- `npm run test --workspace ui -- src/pages/entity-initiative.test.tsx`, `npm run test --workspace ui -- src/pages/entity-objective.test.tsx`, and `npm run test --workspace ui -- src/pages/entity-task.test.tsx` — append that dependency success passes `initiativeId` and immediately invalidates the matching graph without a timer or visibility event.
- `npm run test --workspace ui -- src/pages/initiative-graph.test.tsx` — append that a poll error leaves `graph-canvas` mounted and renders `graph-poll-error`.
- `npm run verify` exits 0.
- Proof: no dedicated phase. The required unchanged, changed, and immediate-mutation freshness lines are delivered by the hermetic tests above.
