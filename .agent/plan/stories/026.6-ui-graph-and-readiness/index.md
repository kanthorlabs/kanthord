# EPIC 026.6 — the initiative graph, the task inspector, export and readiness — stories

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md`
Prereq: EPIC 026.5 (sequence order).

The operator gets a read-only initiative graph with a real task inspector, freshness, readiness, export, and an honest unavailable Plan state.

## Dispatch order

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08`.

- **01 + 02 are a coupled pair.** 01 fixes the graph model; 02 renders that model.
- **03 + 04 edit the graph workspace and canvas sequentially.** 03 adds selection; 04 adds graph controls.
- **05 depends on 02 and EPIC 026.4.** It adds polling to the graph page and graph targets to the existing invalidation matrix.
- **06 + 07 edit `ui/src/app/routes.tsx` sequentially.** 06 installs Readiness; 07 installs both graph routes and Plan.
- **08 runs only after 01–07 and edits no file.**

## Stories

- 01 — the graph adapter and repository-name resolution → `01-graph-adapter.md`
- 02 — the read-only lane canvas and deterministic layout → `02-graph-canvas.md`
- 03 — the inspector using the canonical task Summary → `03-task-inspector.md`
- 04 — lifecycle counts and the critical-path toggle → `04-counts-critical-path.md`
- 05 — graph freshness and immediate hierarchy invalidation → `05-graph-freshness.md`
- 06 — the project readiness page → `06-readiness-page.md`
- 07 — export, graph routing, initiative picker, and Plan unavailable → `07-export-picker-plan.md`
- 08 — the locked browser Proof → `08-proof.md`

## Facts (needed for implementation)

- `src/apps/http/views/initiative.ts:67-155` is the graph wire contract. The API preserves `groups[]` order; `edges[]` point dependency `from` to dependent `to`.
- `src/app/initiative/get-initiative-graph.ts:235-249` returns sorted repository resource IDs, not names. Resolve them against `GET /api/project/:id/repository` by `id`.
- `src/domain/graph.ts:242-313` defines `criticalPath.nodeIds`: dependency-first, node-count metric, lexical tie-break.
- `ui/src/lib/status-role.ts:1-102` owns all role mapping. Components use literal `ROLE_CLASS` entries and add no colour.
- EPIC 026.2 provides `projectKeys`, `fetchProjectOverview`, `fetchResources`, and `useVisibilityPoll`. EPIC 026.3 provides entity keys, `fetchTask`, and `TaskSummary`. EPIC 026.4 provides `invalidateFor` and its matrix.
- `ui/src/lib/api-client.ts` remains the only `fetch` caller. No browser request sets `Authorization`.
- `ui/src/app/routes.tsx` owns both `ROUTE_TABLE` and `createAppRouter()`. Canonical entity routes are top-level and render their own `ProjectShell`.
- `scripts/e2e/ui-graph-proof.sh:49-277` already contains phases A–H and the sole `026.6 ok: …` line. Story 08 must not edit it or `ui-browser.mjs`.
- Vitest uses jsdom and explicit imports. Component tests use a fresh `QueryClient`, `retry:false`, `vi.mock("@/lib/api-client", …)`, and local cleanup.
- No import, graph edit, live HTTP probe, browser package edit, inbox, or conflict work belongs to this epic.
