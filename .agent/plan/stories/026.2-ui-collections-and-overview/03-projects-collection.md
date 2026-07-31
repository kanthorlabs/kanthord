# Story 03 — Projects collection (W1)

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md` (decisions 3, 8, 9)
Depends on: Story 02, Story 01 (its search is only useful with substring
matching), EPIC 026.1 (AsyncBoundary, the route table).

## Change

### New file `ui/src/lib/use-debounced-value.ts`

```ts
export const SEARCH_DEBOUNCE_MS = 200;
export function useDebouncedValue<T>(value: T, delayMs: number): T;
```

`useState` + `useEffect` with `setTimeout(delayMs)`, clearing the timer on
change and on unmount. 200 ms is well under the Proof's `networkidle` window
(index.md F11).

### New file `ui/src/components/collection-toolbar.tsx`

```tsx
export function CollectionToolbar(props: {
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}): ReactElement;
```

Renders one `Input` from `@/components/ui/input` carrying
`data-testid="collection-search"`, `placeholder={props.placeholder}`,
`aria-label={props.placeholder}`, `value`, and `onChange`. Nothing else — no
sort control, no filter chips, no create button (decision 8).

### New file `ui/src/components/detail-pane.tsx`

```tsx
export interface DetailRow {
  readonly label: string;
  readonly value: ReactNode;
}
export function DetailPane(props: {
  readonly title: string;
  readonly rows: readonly DetailRow[];
  readonly onClose: () => void;
  readonly children?: ReactNode;
}): ReactElement;
```

Renders `<aside data-testid="detail-pane" aria-label={props.title}>` with the
title, a `<dl>` of the rows (`<dt>` label, `<dd>` value), `props.children` after
the list, and a close `Button` labelled `Close`. Read-only: no input, no submit,
no destructive control (decision 9).

### New file `ui/src/pages/projects.tsx`

```tsx
export function ProjectsPage(): ReactElement;
```

Behaviour, pinned:

- `const [search, setSearch] = useState("")`;
  `const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS)`.
- `useQuery({ queryKey: projectKeys.list(term || undefined),
queryFn: ({ signal }) => fetchProjects(term || undefined, { signal }) })`.
  No `placeholderData`, no `select`, no client-side filtering of the result
  (decision 3).
- Layout order inside `<main>`: `<h1>Projects</h1>`, then
  `<CollectionToolbar placeholder="search projects" …>`, then the async body,
  then the pane when a row is selected.
- Async body via EPIC 026.1's AsyncBoundary adapter (index.md F6):
  pending → `loading`; error → `error` showing `error.message`;
  `data.length === 0` → `empty` with the text `No projects`; otherwise
  `resolved` rendering the table. The table element must not exist in the
  `empty` state, so `[data-testid="project-table"] tbody tr` counts 0 rows.
- Table: `Table` from `@/components/ui/table` with `data-testid="project-table"`,
  header cells `Name` and `Id`, and one
  `<TableRow data-project-id={p.id} onClick={() => setSelected(p)}>` per project
  with cells `p.name` and `p.id`.
- Selecting a row renders `DetailPane` with `title={p.name}` and rows
  `Name`/`Id` taken from the row DTO. It issues **no** request: `GET
/api/project/:id` returns the same two fields (index.md F3).
- No create, rename or delete control anywhere on the page (decision 8) — the
  routes exist but are EPIC 026.4's, and an unbuilt control is omitted, not
  disabled.

### Edit `ui/src/app/router.tsx`

Replace the `#/project` leaf element (026.1 registered it with `NotBuiltYet`)
with `<ProjectsPage />`. Change nothing else in the route table.

## Constraints

- The query key comes from `projectKeys.list` — never an inline array.
- The search term is sent to the server only; the component never filters
  `data` (the hermetic test proves it by returning unfiltered rows for a
  non-empty term).
- No polling on this page (decision 10 wires polling to Overview only).

## Verify

- `npm run test --workspace ui -- src/lib/use-debounced-value.test.ts`:
  the value updates only after `delayMs` under `vi.useFakeTimers()`; a change
  inside the window restarts the timer; unmount clears it.
- `npm run test --workspace ui -- src/pages/projects.test.tsx`, with
  `vi.mock("@/lib/api-client")` per index.md F8:
  - two projects → `[data-testid="project-table"] tbody tr` has 2 rows and
    `tr[data-project-id="p1"]` exists once.
  - typing `alp` into `[data-testid="collection-search"]` calls the mocked
    `fetchProjects` a second time with `"alp"` after
    `SEARCH_DEBOUNCE_MS`, and not before it.
  - **no client-side filter**: the mock answers the `"alp"` call with both
    projects; the table still renders 2 rows.
  - an empty array renders the `empty` state, and
    `queryByTestId("project-table")` is `null`.
  - a rejected `ApiError` renders the error state with its message, and
    `queryByTestId("project-table")` is `null`.
  - clicking a row renders `[data-testid="detail-pane"]` containing the row's
    name and id, and `fetchProject` is never called.
  - decision 8: `screen.queryAllByRole("button", { name: /new|create|rename|delete/i })`
    is empty, and so is the same query for `"link"`.
- `npm run verify` exits 0.
- Proof: phase C of `scripts/e2e/ui-collections-proof.sh` — both seeded projects
  listed, the search request carries `?name=`, the table narrows to one row.
