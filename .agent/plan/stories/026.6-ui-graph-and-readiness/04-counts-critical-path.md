# Story 04 — lifecycle counts and the critical-path toggle

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decisions 5–6)
Depends on: Story 03.

## Change

- Create `ui/src/components/graph-summary.tsx` exporting `GraphSummary({counts}:{readonly counts:InitiativeGraphDto["counts"]})`. Render exactly two sibling groups:
  - `data-testid="counts-lifecycle"`: `pending`, `running`, `completed`, `failed`, `awaiting_confirmation`, `discarded`, in that order.
  - `data-testid="counts-operational"`: `blocked`, `blockedForever`, `actionable`, in that order under the visible heading `Operational`.
- Each count is one `<dl>` row whose `<dt>` is the exact key and `<dd>` is only the decimal number. Do not total or compare the operational predicates with lifecycle totals.
- Edit `ui/src/pages/initiative-graph.tsx` before `GraphCanvas`. Render `GraphSummary`. Add a controlled button with `data-testid="critical-path-toggle"`, `aria-pressed`, and visible label `Critical path: longest remaining chain, by task count`. Initial state is `false`; reset it to `false` when `initiativeId` changes.
- Extend `GraphCanvasProps` in `ui/src/components/graph-canvas.tsx` with `criticalPathEnabled:boolean` and `criticalPathNodeIds:readonly string[]`.
- At the existing `GraphCanvas` call in `ui/src/pages/initiative-graph.tsx`, pass the controlled toggle state as `criticalPathEnabled` and `graph.criticalPath.nodeIds` unchanged as `criticalPathNodeIds`.
- When disabled, render no `data-critical` attribute on any node or edge. When enabled, put `data-critical="true"` only on nodes whose ID is in `criticalPathNodeIds`.
- Build the critical edge set only from consecutive ordered pairs in `criticalPathNodeIds`: for `a,b,c`, the set is `a->b,b->c`. Put `data-critical="true"` only on graph edges whose adapter ID is in that set. A graph edge between two non-consecutive path nodes is not critical. An absent consecutive edge is not invented.
- Apply the existing `active` role classes to critical nodes and paths in addition to their normal semantic role; add no colour literal.

## Constraints

- The label names node count, not duration or effort. It is the operator wording
  for the API value `metric: "remaining-node-count"` (`src/domain/graph.ts:221`),
  the only metric the API sends today.
- The API path order is authoritative. Do not recompute a critical path in the UI.
- Counts remain two groups even when every value is zero.

## Verify

- `npm run test --workspace ui -- src/components/graph-summary.test.tsx` — create this file. Supply distinct values `1..9`; assert two group selectors, exact key order, six versus three rows, digits-only values, and no common parent row containing all nine definitions.
- `npm run test --workspace ui -- src/components/graph-canvas.test.tsx` — append a graph with edges `a->b`, `b->c`, `a->c`, `x->c` and path `a,b,c`. Read edge identity from `data-edge-from` and `data-edge-to`. Assert disabled has zero `data-critical`; enabled marks exactly nodes `a,b,c` and edges `a->b,b->c`, not `a->c` or `x->c`.
- `npm run test --workspace ui -- src/pages/initiative-graph.test.tsx` — append that the toggle starts `aria-pressed="false"`, the exact metric label is visible, one click enables it, and an initiative-ID change resets it. In the same file, assert the fixture's `criticalPath.metric` is exactly `remaining-node-count`, so a new API metric value fails this test instead of shipping a wrong label.
- `npm run verify` exits 0.
- Proof: phase F toggles `critical-path-toggle` and finds exactly every API critical node and consecutive critical edge, with no unrelated marked element. Count groups remain hermetic coverage.
