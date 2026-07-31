# Story 03 — initiative W2: Summary · Objectives · Dependencies

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decision 5, initiative row)
Depends on: Story 01, Story 02.

## Change

### Edit `ui/src/pages/entity-initiative.tsx`

Replace `tabs={[]}` with exactly these three tabs, in this order. No fourth tab,
no reordering, no conditional tab — a tab is fixed and only its content varies
(decision 5).

```ts
const tabs = [
  { value: "summary", label: "Summary", panel: <InitiativeSummary … /> },
  { value: "objectives", label: "Objectives", panel: <InitiativeObjectives … /> },
  { value: "dependencies", label: "Dependencies", panel: <InitiativeDependencies … /> },
];
```

The three panel components live in this same file (they are not reused
elsewhere; no separate module).

#### Summary panel

Renders a `<dl>` with these rows, in this order, from `InitiativeDetailDto`:

| label       | content                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Status`    | `<EntityStatus axis="initiative" value={initiative.status} />` (Story 01 §5)                                                                                       |
| `Paused`    | `<span data-testid="initiative-paused">{initiative.paused ? "paused" : "running"}</span>`                                                                          |
| `Branch`    | `<code data-testid="initiative-branch">{initiative.branch}</code>`                                                                                                 |
| `Workspace` | `<code data-testid="initiative-workspace">{initiative.workspace}</code>` when the key is present, else `<span data-testid="empty-workspace">Not specified.</span>` |

`workspace` is an **omitted key** (index.md F5): test `initiative.workspace === undefined`,
never `=== null`. `branch` is always present and derived (index.md F5) — render
it, do not hide it.

#### Objectives panel

Reads the objective collection the chain already fetched
(`chain.objectiveRows`, key `objectiveKeys.list(initiativeId)` — Story 01 §8).
It issues **no new request**. That query is **ungated** on this hook, so this tab
renders its own async states:

- `chain.objectivesState` is `"loading"` or `"error"` →
  `<AsyncBoundary state={chain.objectivesState} what="objectives" message={chain.objectivesMessage} />`
- resolved with `objectiveRows.length === 0` →
  `<p data-testid="empty-objectives">No objectives yet.</p>` and **no**
  `[data-testid="objective-table"]` in the DOM.
- otherwise a shadcn `Table` with `data-testid="objective-table"`, header cells
  exactly `Name`, `Status`, and one
  `<TableRow key={o.id} data-objective-id={o.id}>` per row in the order the API
  returned (no client-side sort), with:
  - `Name` → `<Link to={"/project/" + projectId + "/initiative/" + initiativeId + "/objective/" + o.id}>{o.name}</Link>`
  - `Status` → `<EntityStatus axis="initiative" value={o.status ?? "building"} />`
    (a **list row's** `status` may be absent entirely — index.md F5 — and the
    detail endpoint defaults it to `"building"`, so the row does the same.)

#### Dependencies panel

From `initiative.after` (bare ids) and `initiative.waiting`
(`{id, neverSatisfies}` — index.md F6).

- `after.length === 0 && waiting.length === 0` →
  `<p data-testid="empty-initiative-dependencies">No dependencies.</p>`
- otherwise, two sections, both rendered whenever the panel is non-empty:
  - `<section data-testid="initiative-after">` — one
    `<code data-testid="after-id">{id}</code>` per `after` entry, in API order.
    Empty `after` renders the section with
    `<p data-testid="empty-after">None.</p>` inside.
  - `<section data-testid="initiative-waiting">` — one row per `waiting` entry:
    `<code data-testid="waiting-id">{w.id}</code>` plus, when
    `w.neverSatisfies === true`,
    `<p data-testid="waiting-never">This dependency can never be satisfied.</p>`.
    Empty `waiting` renders `<p data-testid="empty-waiting">None.</p>`.

The panel's text is never blank — the Proof's phase C asserts exactly that.

## Constraints

- Three tabs, fixed, in the pinned order; `Summary` is the default (Story 01 §7
  makes the first tab the default).
- No create/rename/pause/resume/delete control anywhere on this page
  (decision 9). `InitiativeDetailDto` has no `action` field (index.md F9), so
  Story 06's inventory has nothing to render here.
- Read `chain.objectiveRows`; do not call `fetchObjectives` again and do not add
  a second query key for it.
- Do not render the initiative id in the header, breadcrumb or Summary.
- Every status render goes through `EntityStatus`, never straight into
  `StatusChip` (index.md F7).

## Verify

- New `ui/src/pages/entity-initiative.test.tsx` —
  `npm run test --workspace ui -- src/pages/entity-initiative.test.tsx`,
  rendering the real `ROUTE_TABLE` through `createMemoryRouter` at
  `/project/p1/initiative/i1` with `vi.mock("@/lib/api-client")` (index.md F14),
  driving tabs with `userEvent.click` on `screen.getByRole("tab", {name})`:
  - the tab strip is exactly `["Summary","Objectives","Dependencies"]`
    (`getAllByRole("tab").map(t => t.textContent)`), and `Summary` is the
    initially selected panel.
  - Summary: `initiative-paused` reads `paused` for `paused:true` and `running`
    for `paused:false`; `initiative-branch` reads
    `kanthord/init/i1`; with `workspace:"/w/x"` the `initiative-workspace`
    element reads `/w/x`; with the key **absent**, `empty-workspace` reads
    `Not specified.` and `initiative-workspace` is not in the DOM.
  - Objectives, empty: `fetchObjectives` resolves `[]` →
    `[data-testid="empty-objectives"]` reads `No objectives yet.` and
    `objective-table` is absent.
  - Objectives, error: `fetchObjectives` rejects with
    `new ApiError(503,"unavailable","down")` → the Objectives panel shows
    `[data-testid="async-error"]`, **and** `[data-testid="entity-header"]` is
    still present with the Summary tab intact — a failed tab never blanks the
    page.
  - Objectives, two rows: rows appear in the mocked order; the first row's link
    `href` ends with `/project/p1/initiative/i1/objective/o1`; a row whose
    `status` key is absent renders a chip with `data-value="building"`.
  - Dependencies, empty: `after: []`, `waiting: []` →
    `empty-initiative-dependencies` reads `No dependencies.`, and the panel's
    `textContent.trim()` is non-empty.
  - Dependencies, populated: `after: ["iA","iB"]`,
    `waiting: [{id:"iA", neverSatisfies:true}]` → two `after-id` elements in that
    order, one `waiting-id` reading `iA`, one `waiting-never` reading
    `This dependency can never be satisfied.`.
  - Dependencies, `after: ["iA"]` with `waiting: []` → `empty-waiting` reads
    `None.` and no `waiting-never` is present.
  - only one panel is mounted: with all three tabs' data mocked, after clicking
    `Dependencies` the `objective-table` is gone from the DOM.
  - no mutation: no accessible button or link named
    `/new|create|edit|rename|delete|pause|resume/i`, and
    `document.querySelectorAll("form")` is empty.
- `npm run verify` exits 0.
- Proof: **phase C** in full — the Objectives tab lists the seeded objective and
  the Dependencies tab renders non-blank content.
