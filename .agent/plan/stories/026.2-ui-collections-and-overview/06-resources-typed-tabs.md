# Story 06 — Resources collection: four URL-addressable typed tabs

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md` (decisions 1, 2, 3, 8, 9)
Depends on: Story 02, Story 03 (`CollectionToolbar`, `DetailPane`,
`useDebouncedValue`), EPIC 026.1.

## Change

### Edit `ui/src/app/router.tsx`

Under the ProjectShell branch, replace the `…/resource` leaf (026.1's
`NotBuiltYet`) with:

- `#/project/:id/resource` → `<Navigate to="repository" replace />`
  (react-router `Navigate`, relative), so the URL becomes
  `#/project/<id>/resource/repository`.
- `#/project/:id/resource/:type` → `<ProjectResourcesPage />`.

Register no third segment — `#/project/:projectId/resource/:type/:resourceId`
is EPIC 026.3's (`.agent/plan/epics/026.3-ui-entity-workspaces.md:58`).

### New file `ui/src/pages/project-resources.tsx`

```tsx
export function ProjectResourcesPage(): ReactElement;
```

- Read `:type` from `useParams()`. When `isResourceType(type)` is `false`,
  render AsyncBoundary `missing` (`[data-testid="async-missing"]`, 026.1) and
  issue **no** request. Never fall back to the first tab (decision 1).
- Tabs are links, not Radix `Tabs` — the Proof clicks
  `[data-testid="resource-tabs"] a`. Render
  `<nav data-testid="resource-tabs" aria-label="Resource types">` holding four
  `NavLink`s in this fixed order and with these exact labels:

  | type           | label           | href                                   |
  | -------------- | --------------- | -------------------------------------- |
  | `repository`   | `Repositories`  | `#/project/<id>/resource/repository`   |
  | `credential`   | `Credentials`   | `#/project/<id>/resource/credential`   |
  | `notification` | `Notifications` | `#/project/<id>/resource/notification` |
  | `filesystem`   | `Filesystems`   | `#/project/<id>/resource/filesystem`   |

  The active link carries `aria-current="page"`. The tab list renders for a
  known type; for an unknown type only the `missing` state renders.

- One query, for the active type only (decision 2):

  ```ts
  useQuery({
    queryKey: projectKeys.resources(projectId, type, term || undefined),
    queryFn: ({ signal }) =>
      fetchResources(projectId, type, term || undefined, { signal }),
    staleTime: Infinity,
  });
  ```

  `staleTime: Infinity` is what keeps a cached tab from refetching when the
  operator returns to it. No `refetchInterval`, no `useVisibilityPoll` here.

- Search: `CollectionToolbar` with
  `placeholder={"search " + label.toLowerCase()}` (e.g. `search repositories`),
  the same `useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS)` as Story 03.
  The term goes into the active type's query only; no other type's query is
  created and no row is filtered in the browser (decision 3).
- Table `Table` with `data-testid="resource-table"`, one
  `<TableRow data-resource-id={r.id} onClick={…}>` per row, and per-type
  columns exactly:

  | type           | header cells                                              | body cells                                                                                                                   |
  | -------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | `repository`   | `Name`, `Branch`, `Remote`, `Path`, `Auth`, `Publication` | `name`; `branch` in `<TableCell data-testid="resource-col-branch">`; `remoteUrl`; `path`; `auth.kind`; the publication label |
  | `credential`   | `Name`, `Provider`                                        | `name`, `provider`                                                                                                           |
  | `notification` | `Name`, `Provider`, `Destination`                         | `name`, `provider`, `destination`                                                                                            |
  | `filesystem`   | `Name`, `Path`                                            | `name`, `path`                                                                                                               |

  `data-testid="resource-col-branch"` sits on the **body** cell only, never on
  the header — the Proof counts exactly one for one seeded repository.
  Publication label: `publication === null ? "—" : publicationLabel(publication)`,
  where `publicationLabel` is EPIC 026.1's helper (index.md F6). A list row
  always has `publication: null` (index.md F5), so `—` is the normal list value
  and the label only appears in the detail pane.

- Empty result → AsyncBoundary `empty` (`No <label.toLowerCase()>`), with no
  `[data-testid="resource-table"]` in the DOM. Pending → `loading`. An
  `ApiError` → `error`.
- Row click opens `DetailPane` (Story 03) titled with the row name. It shows the
  row's own fields, plus a second query
  `useQuery({ queryKey: resourceKeys.detail(r.id), queryFn: ({signal}) =>
fetchResource(r.id, { signal }), staleTime: Infinity })` whose extra fields
  render inside the pane — for a repository that is where a real `publication`
  appears (decision 9). The pane captures no `ETag` and offers no edit control.
- A credential row and pane render `name` and `provider` only; there is no
  `value` on the wire and none may be rendered.
- No create, rename, delete, rotate or reclone control (decision 8).

## Constraints

- The tab is identity: it comes from the URL, never from component state. A
  reload of `#/project/<id>/resource/repository` shows the repository tab.
- A hidden tab is never mounted, so it is never fetched and never polled.
- No merged cross-type table and no cross-type search — the four collections
  stay separate (epic verified facts).

## Verify

- `npm run test --workspace ui -- src/pages/project-resources.test.tsx`,
  rendering the real route table through `createMemoryRouter` with
  `initialEntries`, and `vi.mock("@/lib/api-client")`:
  - `[data-testid="resource-tabs"] a` is exactly 4, with the labels and hrefs of
    the table above, and the active one carries `aria-current="page"`.
  - each type renders its own header cells exactly as listed (assert the header
    text array).
  - a repository row renders `[data-testid="resource-col-branch"]` once with the
    branch text; a credential tab renders it zero times.
  - the detail pane for a repository whose `GET /api/resource/:id` answers
    `publication: {state:"published", remoteOID:"abc123"}` renders
    `published@abc123`; `{state:"unpublished", remoteOID:null}` renders
    `unpublished`; a list row with `publication: null` renders `—`.
  - an unknown `:type` (`#/project/p1/resource/not-a-type`) renders
    `[data-testid="async-missing"]`, renders no tab table, and calls
    `fetchResources` zero times.
  - `#/project/p1/resource` lands on `#/project/p1/resource/repository`.
  - switching credential → repository → credential calls `fetchResources` once
    per type: the return to the cached credential tab issues no new call.
  - no polling: after `vi.advanceTimersByTime(3 * POLL_INTERVAL_MS)` on a
    mounted tab, `fetchResources` has still been called once.
  - typing `k1` on the credential tab calls
    `fetchResources("p1","credential","k1", …)` after the debounce and never
    with another type; when the mock answers with two unfiltered rows, both
    render (no client-side filter).
  - a credential fixture carrying an extra `value: "s3cr3t"` key renders nothing
    containing `s3cr3t`.
  - decision 8: no button or link named `/new|create|rename|delete|rotate|reclone/i`.
- `npm run verify` exits 0.
- Proof: phase E of `scripts/e2e/ui-collections-proof.sh` — a cold-loaded
  credential tab, four tabs, the switch to repository changing the URL and
  showing the branch column, a reload keeping the tab, an unknown type showing
  the missing state.
