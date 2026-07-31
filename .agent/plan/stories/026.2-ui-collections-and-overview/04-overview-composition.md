# Story 04 — the project Overview composition

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md` (decisions 4, 5, 6, 8, 9)
Depends on: Story 02, EPIC 026.1 (StatusChip, AsyncBoundary, FreshnessBar,
CommandHandoff, ProjectShell, the route table).

## Change

### New file `ui/src/pages/project-overview.tsx`

```tsx
export function ProjectOverviewPage(): ReactElement;
```

- Project id from `useParams()`, using the param spelling declared in
  `ui/src/app/routes.tsx` (index.md F6) — 026.1 delivered it as `:id`.
- `useQuery({ queryKey: projectKeys.overview(projectId),
queryFn: ({ signal }) => fetchProjectOverview(projectId, { signal }) })`.
- `FreshnessBar` fed exactly:
  `updatedAt={query.dataUpdatedAt === 0 ? null : new Date(query.dataUpdatedAt)}`,
  `onRefresh={() => { void query.refetch(); }}`,
  `refreshing={query.isFetching}`. The page owns no clock (026.1 decision 9).
- Body order is **fixed** and unconditional — the three sections always render,
  in this order (decision 4). Emptiness is shown inside a section, never by
  dropping it:

  1. `<section aria-label="Initiatives">` — one
     `<article data-testid="overview-initiative-card" data-initiative-id={i.id}>`
     per `data.initiatives`, in the server's order. Each card renders:
     - `i.name` as its heading;
     - `StatusChip` for `i.status` (026.1's mapping);
     - the text `paused` when `i.paused`;
     - the text `needs human` when `i.needsHuman`;
     - a `<dl>` of the six counts. Each value element is
       `<dd data-testid={"count-" + key}>{count}</dd>` with the keys
       `count-pending`, `count-running`, `count-completed`, `count-failed`,
       `count-awaiting-confirmation`, `count-discarded`. The element's text is
       the number and nothing else (index.md F11);
     - the label is in the sibling `<dt>`, never inside the value element.

     When `data.initiatives` is empty, the section renders AsyncBoundary `empty`
     with the text `No initiatives yet` — not an error.

     After the cards the section renders one link to `#/project/<id>/graph`
     labelled `Lanes are on the graph`. **`data.lanes` is not rendered here**
     (decision 4).

  2. `<section data-testid="overview-decisions">` — heading `Decisions`. When
     `data.decisions` is empty it renders AsyncBoundary `empty` with
     `Nothing waiting on you`. Otherwise one row per decision, in the server's
     order (already sorted, `src/app/project/get-project-overview.ts:323`),
     each rendering:
     - `d.action.kind`;
     - `downstream <n>` from `d.downstream`;
     - `d.actionableSince === null ? "—" : new Date(d.actionableSince).toISOString()`;
     - a `<Link>` to the entity href built by the F7 rule in index.md, labelled
       with the entity kind and id (`task <id>` / `objective <id>` /
       `initiative <id>`);
     - `CommandHandoff` with `d.action.command` when that key is present;
       nothing when it is absent.
     - **no act control**: no approve, reject, retry or any other button.

  3. `<section data-testid="overview-digest">` — heading `Activity`. Renders
     `data.digest.totalCount` and one row per `data.digest.events` (`e.id` and
     `e.type`). When `data.digest.hasMore` is `true` it also renders
     `<div data-testid="digest-truncated">` wrapping AsyncBoundary's
     `truncated` state, whose text says this is the head window and that paging
     arrives with EPIC 026.8 (decision 5). When `hasMore` is `false` that
     element must not exist.

- Query states: pending → AsyncBoundary `loading` for the whole body; a 404
  `ApiError` → `missing`; any other error → `error`. A resolved project with no
  data of its own is never an error (decision 4 / the gate).
- No write control on this page (decision 8).

### Edit `createAppRouter()` in `ui/src/app/routes.tsx`

026.1 delivered the table and the router factory in one file
(`ui/src/app/routes.tsx`); `ui/src/app/router.tsx` no longer exists. Replace the
`#/project/:id/overview` child (026.1's `NotBuiltYet`) with
`<ProjectOverviewPage />`. Change nothing else.

The page is a **child of `ProjectRoute`**, which already renders
`<ProjectShell projectId segments={[project.name]}>`: `ProjectOverviewPage` must
**not** render a shell of its own, and it does not own the breadcrumb.
**`OPEN:` — where the `FreshnessBar` goes.** `docs/ui-design.md:301-324` is
binding: "Every page shows `Updated HH:MM` plus a refresh control, from
`FreshnessBar` **in the shell header**." `ProjectShell`
(`ui/src/components/shell.tsx:124`) has **no `freshness` slot** — only
`GlobalShell` does. This story cannot satisfy the binding rule as the shell
stands. Resolve before dispatch, do not improvise: either add
`freshness?: ReactNode` to `ProjectShellProps`, mirroring `GlobalShell`, or the
human amends the freshness rule for project surfaces.

## Constraints

- The three sections keep their DOM order in every state, including loading and
  empty — the Proof compares their `getBoundingClientRect().top`.
- Lanes stay unrendered; the graph link is the visible admission (decision 4).
- No `ETag` is read or stored anywhere on this page (decision 9).
- No polling in this story — Story 05 adds it to this file.

## Verify

- `npm run test --workspace ui -- src/pages/project-overview.test.tsx`, with
  `vi.mock("@/lib/api-client")` and a fixture built from index.md F4:
  - two initiatives → two `[data-testid="overview-initiative-card"]`, each with
    its `data-initiative-id`, its name, and its six counts; a card whose
    `taskCounts.pending` is 2 renders `2` in `[data-testid="count-pending"]`.
  - DOM order: the first card, `[data-testid="overview-decisions"]` and
    `[data-testid="overview-digest"]` appear in that order — assert with
    `Node.compareDocumentPosition` (`DOCUMENT_POSITION_FOLLOWING`), not with
    layout.
  - `digest.hasMore === true` renders `[data-testid="digest-truncated"]` and its
    text names EPIC 026.8; `hasMore === false` renders no such element.
  - a decision with `taskId` links to
    `#/project/p1/initiative/i1/objective/o1/task/t1`; one with only
    `objectiveId` links to `#/project/p1/initiative/i1/objective/o1`; one with
    neither links to `#/project/p1/initiative/i1`.
  - a decision whose `action.command` is present renders CommandHandoff with
    that exact string; one without renders none.
  - no act control: `queryAllByRole("button", { name: /approve|reject|retry|resume|halt/i })`
    is empty.
  - `initiatives: []` with a resolved response renders the `empty` state and
    **not** the error state; the decisions and digest sections still render.
  - lanes are not rendered: with `lanes: [{repositoryId:"r1",…}]` the DOM
    contains no `r1` text, and a link to `#/project/p1/graph` exists.
  - FreshnessBar: before the first success `[data-testid="freshness-updated"]`
    shows 026.1's "not updated yet" text; after success it shows
    `Updated HH:MM`; clicking `[data-testid="freshness-refresh"]` calls the
    mocked `fetchProjectOverview` a second time.
  - decision 8: no create/rename/delete control.
- `npm run verify` exits 0.
- Proof: phase D of `scripts/e2e/ui-collections-proof.sh` — one card per
  initiative with the real names, the six counts, the decisions and digest
  sections, in that order.
