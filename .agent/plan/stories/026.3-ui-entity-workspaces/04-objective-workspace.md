# Story 04 — objective W2: Summary · Tasks · Integration

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decision 5, objective row)
Depends on: Story 00 (`conflictCause` on the wire), Story 01, Story 02.

## Change

### Edit `ui/src/pages/entity-objective.tsx`

Replace `tabs={[]}` with exactly these three tabs, in this order:

```ts
const tabs = [
  { value: "summary", label: "Summary", panel: <ObjectiveSummary … /> },
  { value: "tasks", label: "Tasks", panel: <ObjectiveTasks … /> },
  { value: "integration", label: "Integration", panel: <ObjectiveIntegration … /> },
];
```

The three panel components live in this same file.

#### Summary panel

A `<dl>` with these rows, in this order, from `ObjectiveDetailDto`:

| label              | content                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Status`           | `<EntityStatus axis="initiative" value={objective.status} />` — objective status shares the `building`/`landed`/`discarded` vocabulary, and `EntityStatus` falls back to `status-raw` for anything else (Story 01 §5) |
| `Candidate commit` | `<code data-testid="objective-commit-oid">{objective.commitOid}</code>` when the key is present, else `<span data-testid="empty-commit-oid">Not specified.</span>`                                                    |
| `Parent commit`    | `<code data-testid="objective-parent-oid">{objective.parentOid}</code>` when the key is present, else `<span data-testid="empty-parent-oid">Not specified.</span>`                                                    |
| `Note`             | `<p data-testid="objective-note">{objective.note}</p>` when `note !== null`, else `<span data-testid="empty-note">Not specified.</span>`                                                                              |
| `Conflict`         | both conflict fields — see below                                                                                                                                                                                      |

`commitOid`/`parentOid` are **omitted keys** while `note`/`conflictReason` are
**always present and nullable** (index.md F5) — use the matching test for each.

The `Conflict` row renders **both** conflict fields, because decision 5 says
"conflict fields", plural:

- `conflictCause !== null` →
  `<p data-testid="objective-conflict-cause">{objective.conflictCause}</p>`
  — the ref-update cause, on the wire from Story 00.
- `conflictReason !== null` →
  `<p data-testid="objective-conflict-reason">{objective.conflictReason}</p>`
  — the gate-failure reason.
- both `null` → `<span data-testid="empty-conflict">No conflict recorded.</span>`

The two fields are independent: either can be set without the other, so render
each on its own test and never gate one behind the other. Both are
**always-present nullable** keys (index.md F5) — use `=== null`, never
`undefined`. Do **not** fetch `GET /api/objective/:id/conflict` for the richer
payload: the epic's non-goals fence conflict work to 026.7.

#### Tasks panel

One query, mounted with the panel:

```ts
useQuery({
  queryKey: taskKeys.list(initiativeId, objectiveId),
  queryFn: ({ signal }) => fetchTasks(initiativeId, objectiveId, { signal }),
  staleTime: Infinity,
});
```

- `asyncStateOf(query)` is `"loading"` or `"error"` →
  `<AsyncBoundary state={state} what="tasks" message={…} />`. Pass **no**
  `isEmpty` predicate: the empty state below is this tab's own, not
  `async-empty`.
- resolved with `length === 0` →
  `<p data-testid="empty-tasks">No tasks yet.</p>` and **no**
  `[data-testid="task-table"]` in the DOM.
- resolved, non-empty → a shadcn `Table` with `data-testid="task-table"`, header
  cells exactly `Title`, `Status`, `State`, and one
  `<TableRow key={t.id} data-task-id={t.id}>` per row in API order, with:
  - `Title` → `<Link to={"/project/" + projectId + "/initiative/" + initiativeId + "/objective/" + objectiveId + "/task/" + t.id}>{t.title}</Link>`
  - `Status` → `<EntityStatus axis="task" value={t.status} />`
  - `State` → `<span data-testid="task-row-state">{t.state}</span>` (plain text —
    the execution-state vocabulary is not pinned by this epic)

The route is the initiative-scoped list with `?objective=`; there is no
objective-scoped route (index.md F3). An unknown objective id answers `200 []`,
so a wrong-chain URL never reaches this tab: Story 01's gate stops it first.

#### Integration panel

From `objective.integrations` (index.md F8: at most one element,
`{repository, state}`, `repository` is a resource **id**).

- `integrations.length === 0` →
  `<p data-testid="empty-integration">Not integrated yet.</p>` and **no**
  `[data-testid="integration-table"]`.
- otherwise a `Table` with `data-testid="integration-table"`, header cells
  exactly `Repository`, `State`, and one row per element:
  - `Repository` → the resource's **real name as the link text, with the id kept
    beside it** — decision 6's rule applies here too: the readable form never
    replaces the exact fact.

    ```tsx
    <Link data-testid="integration-repository" to={"/project/" + projectId + "/resource/repository/" + i.repository}>
      {name ?? i.repository}
    </Link>
    <code data-testid="integration-repository-id">{i.repository}</code>
    ```

    `name` comes from one query per integration element, mounted with this panel
    (Radix unmounts the hidden tab, so it never runs until the operator opens
    Integration — index.md F13). Reuse EPIC 026.2's key and helper; add neither:

    ```ts
    useQuery({
      queryKey: resourceKeys.detail(i.repository),
      queryFn: ({ signal }) => fetchResource(i.repository, { signal }),
      staleTime: Infinity,
    });
    ```

    This query is **ungated and non-blocking**: while it is pending or failed the
    link text falls back to the id and the row still renders. `integrations[]`
    holds at most one element (index.md F8), so this is at most one request.

  - `State` → `<EntityStatus axis="initiative" value={i.state} />`

## Constraints

- Three tabs, fixed, in the pinned order; `Summary` is the default.
- No approve/reject/retry control and no edit form (decision 9).
  `ObjectiveDetailDto` has no `action` field (index.md F9).
- The integration name query is ungated: a failed or pending resource read shows
  the id and never blanks the tab or the page.
- Do not use `AsyncBoundary` `state="empty"` for the Tasks or Integration empty
  state: each tab owns its named `empty-*` element (decision 5).
- Every status render goes through `EntityStatus` (index.md F7).

## Verify

- New `ui/src/pages/entity-objective.test.tsx` —
  `npm run test --workspace ui -- src/pages/entity-objective.test.tsx`,
  rendering the real `ROUTE_TABLE` at
  `/project/p1/initiative/i1/objective/o1` with `vi.mock("@/lib/api-client")`:
  - the tab strip is exactly `["Summary","Tasks","Integration"]` and `Summary`
    is initially selected.
  - Summary, populated: `commitOid:"c1"`, `parentOid:"c0"`, `note:"take care"`,
    `conflictReason:"gate failed"` → the four elements render those exact
    strings and no `empty-*` element is present.
  - Summary, bare: `commitOid`/`parentOid` keys **absent**, `note: null`,
    `conflictCause: null`, `conflictReason: null` → `empty-commit-oid`,
    `empty-parent-oid` and `empty-note` all read `Not specified.`,
    `empty-conflict` reads `No conflict recorded.`, and neither
    `objective-conflict-reason` nor `objective-conflict-cause` is in the DOM.
  - Summary, cause only: `conflictCause: "cas-mismatch", conflictReason: null` →
    `objective-conflict-cause` reads `cas-mismatch`, `empty-conflict` is absent,
    and `objective-conflict-reason` is absent.
  - Summary, reason only: `conflictCause: null, conflictReason: "gate failed"` →
    `objective-conflict-reason` reads `gate failed` and
    `objective-conflict-cause` is absent.
  - Summary, both set → both elements render and `empty-conflict` is absent.
  - Tasks, empty: `fetchTasks` resolves `[]` → `empty-tasks` reads
    `No tasks yet.` and `task-table` is absent.
  - Tasks, two rows: both render in the mocked order; `fetchTasks` was called
    exactly once with `("i1", "o1", expect.anything())`; the first row's link
    `href` ends with `/project/p1/initiative/i1/objective/o1/task/t1`.
  - Tasks, error: `fetchTasks` rejects with `new ApiError(503,"unavailable","down")`
    → `[data-testid="async-error"]` and no `empty-tasks`.
  - Tasks, `async-empty` is never used: with `fetchTasks` resolving `[]`,
    `[data-testid="async-empty"]` is absent.
  - Integration, empty: `integrations: []` → `empty-integration` reads
    `Not integrated yet.` and `integration-table` is absent.
  - Integration, one element `{repository:"r1", state:"landed"}` with
    `fetchResource("r1")` resolving `{type:"repository",id:"r1",name:"repo-1",…}`
    → `integration-repository` link text is `repo-1`, its `href` ends with
    `/project/p1/resource/repository/r1`, `integration-repository-id` reads
    `r1`, and a chip with `data-value="landed"` renders.
  - Integration, name unresolved: `fetchResource` left pending → the link text is
    `r1` and the row still renders; `fetchResource` rejecting with
    `new ApiError(503,"unavailable","down")` → same, and the panel shows no
    `async-error` (the query is ungated).
  - Integration, request budget: `fetchResource` is called exactly **once**, and
    **zero** times while the Summary tab is the active one.
  - Integration with a `state` outside the union (`state:"weird"`) →
    `[data-testid="status-raw"]` reads `weird` and nothing throws.
  - only one panel is mounted: after clicking `Integration`, `task-table` is
    gone; clicking back to `Tasks` does **not** call `fetchTasks` a second time
    (`staleTime: Infinity`).
  - no mutation: no accessible button or link named
    `/new|create|edit|rename|delete|approve|reject|retry/i`, and
    `document.querySelectorAll("form")` is empty.
- `npm run verify` exits 0.
- Proof: **phase D** in full — the Tasks tab lists both seeded tasks and the
  Integration tab renders non-blank content.
