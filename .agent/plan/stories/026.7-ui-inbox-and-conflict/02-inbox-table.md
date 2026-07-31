# Story 02 — the Inbox W1: row grammar, order disclosure, truncation, warnings

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decisions 2, 3, 4)
Depends on: Story 01.

## Change

- Create `ui/src/pages/inbox.tsx` exporting `export function InboxPage(): ReactElement`.
- One query, one fetch, one window:

```ts
const queue = useQuery({
  queryKey: queueKeys.list(QUEUE_LIMIT),
  queryFn: ({ signal }) => fetchQueue(QUEUE_LIMIT, { signal }),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
});
```

- The page renders its **own** `GlobalShell` (not the `GlobalShellLayout` parent),
  exactly as `ui/src/pages/operations.tsx:22` does, so Story 04 can put a
  `FreshnessBar` in the header slot. In this story pass no `freshness` prop.
- Body order inside `<main>`, fixed: `<h1>Inbox</h1>`, then the toolbar, then the
  warning list, then the truncation banner, then the async body.
- **Toolbar** — one element and nothing else:
  `<p data-testid="inbox-order">{ORDER_STATEMENT}</p>` followed, in the same
  element, by the literal sentence
  `` `At most ${String(QUEUE_LIMIT)} items are fetched at a time.` ``.
  No search input, no sort control, no filter chip, no create button, no kind
  selector. `CollectionToolbar` (EPIC 026.2) is **not** used — it renders a search
  box the queue route cannot serve.
- **Warnings** (decision 4): when `queue.data.warnings.length > 0`, render
  `<ul data-testid="inbox-warnings">` with one
  `<li data-testid="inbox-warning" data-role="attention">` per warning, in server
  order, each carrying the warning string verbatim. Style with
  `ROLE_CLASS.attention` and `break-words` so a long path or exception text wraps
  instead of widening the page. Warnings render above the body in **every** body
  state, including empty and error, because a warning can be the reason the queue
  looks the way it does.
- **Truncation** (decision 4): when `queue.data.truncated` is `true`, render
  `<p data-testid="inbox-truncated" data-role="attention">` with the exact text
  `` `Showing ${String(queue.data.items.length)} of ${String(queue.data.counts.total)} items.` ``.
  The table still renders. Never replace the table, and never pass
  `state="truncated"` to `AsyncBoundary`.
- **Async body.** Compute
  `const state = asyncStateOf(queue, { isEmpty: (d) => d.items.length === 0 });`
  and render:
  - `queue.data === undefined` → `<AsyncBoundary state={state} what="queue" message={queue.error instanceof Error ? queue.error.message : undefined} />` and no table.
  - `queue.data !== undefined && state === "empty"` → `<AsyncBoundary state="empty" what="queue" />` and no table.
  - otherwise → the table.
- **The table.** `Table` from `@/components/ui/table`, root
  `data-testid="inbox-table"`. Header cells in this exact order:
  `Kind`, `Project`, `Target`, `Downstream`, `Age`. One `TableRow` per item in
  server order, keyed by `rowKey(item)`, carrying
  `data-row-key={rowKey(item)}`, `data-target-type={rowTarget(item).type}`,
  `data-target-id={rowTarget(item).id}`, `tabIndex={0}`, and `role="button"`.
  Cells, in order:
  1. `kindLabel` verbatim, in `<td data-testid="inbox-cell-kind">`.
  2. `projectName` verbatim, in `<td data-testid="inbox-cell-project">`.
  3. `` `${target.type} …${target.id.slice(-8)}` `` in
     `<td data-testid="inbox-cell-target" title={target.id}>` — the full id lives
     in `data-target-id` and `title`, never in the visible cell.
  4. `String(item.downstream)` and nothing else, in
     `<td data-testid="inbox-cell-downstream">`.
  5. `relativeAge(ageNow, item.actionableSince)` in
     `<td data-testid="inbox-cell-age">`, where
     `const ageNow = queue.dataUpdatedAt === 0 ? Date.now() : queue.dataUpdatedAt;`
     is computed once per render, so every row ages against the same fetch time.
- The row renders these five DTO fields and no sixth. It renders no entity name,
  no title, no status chip, no icon, and no per-type section header.

## Constraints

- **No per-row fetch** (decision 2). This file calls exactly one `useQuery` and
  exactly one fetch helper. It must not import `fetchTask`, `fetchObjective`,
  `fetchInitiative`, `fetchProject`, `useTaskChain` or any `*Keys.detail`, and it
  must not call `useQueries`.
- The words `impact` and `priority` appear nowhere in this file, in any case.
- No client sort, filter, group or search. `items` renders in the order received.
- No polling: do not import `useVisibilityPoll` or `useGraphFreshness`, and add no
  `refetchInterval`.
- Do not register a route here — Story 07 owns `ROUTE_TABLE` and `createAppRouter`.
- Do not use the testids `inbox-row-title`, `inbox-filter-kind` or
  `inbox-counts-global`: `scripts/e2e/ui-decision-identity-proof.sh:181-187`
  reserves them for EPIC 026.8.

## Verify

- `npm test --workspace ui -- src/pages/inbox.test.tsx` — create this file.
  **Stub `globalThis.fetch`, do not mock `@/lib/api-client`.** `fetchQueue` lives
  in `api-client.ts` and calls `apiGet` through its own lexical binding, so
  `vi.mock("@/lib/api-client", { …actual, apiGet: vi.fn() })` — the convention
  `operations.test.tsx:12-20` uses for `queries.ts` — cannot intercept it. Use the
  `vi.spyOn(globalThis, "fetch")` convention from `ui/src/lib/api-client.test.ts:19`
  and `ui/src/lib/queries.test.ts:10-42`: one local `stubFetch(handler)` helper
  returning `new Response(JSON.stringify({ data: dto }), { status, headers: {
"content-type": "application/json" } })`, plus a recorded array of requested
  URLs. This also makes the no-fan-out assertion real instead of mock-shaped, and
  keeps the epic's Gate rule that **no test may stub a per-row entity fetch**.
  Otherwise the established conventions: a fresh `QueryClient` with
  `retry: false` per test, `MemoryRouter`,
  `afterEach(() => { cleanup(); vi.restoreAllMocks(); })`.
  Assert:
  - one `tbody tr` per DTO item and the rows in DTO order (read
    `data-row-key` in order);
  - each of the five cells carries exactly the field named above — in particular
    `inbox-cell-downstream` has text content equal to the number and nothing
    else, and `inbox-cell-target` shows the last 8 characters with `…` while
    `data-target-id` and `title` carry the full id;
  - `rowTarget` precedence end to end: a task item, an objective-only item and an
    initiative-only item render `data-target-type` `task`, `objective`,
    `initiative`;
  - **no per-row fetch**: with three items whose `taskId`, `objectiveId` and
    `initiativeId` all differ, the recorded request list has **length 1** and its
    only entry ends `/api/queue?limit=500`. Assert no recorded URL matches
    `/\/api\/(task|objective|initiative|project)\/[^/?]+$/` — the same predicate
    the Proof's phase C uses. Stub no entity helper.
  - `inbox-order` text equals `ORDER_STATEMENT` plus the limit sentence, and,
    lower-cased, contains neither `impact` nor `priority`;
  - `truncated: true` with 500 items and `counts.total = 637` renders
    `inbox-truncated` with the exact text `Showing 500 of 637 items.` **and**
    `inbox-table` is still in the document. Keep the fixture inside the server
    invariant `items.length <= counts.total`
    (`get-decision-queue.ts:364-373`) — a total below the row count is a state
    the daemon cannot produce and must not be normalised by a test;
  - `truncated: false` renders no `inbox-truncated`;
  - three warnings, one of them 400 characters long with a path and an exception
    string, render three `inbox-warning` elements with verbatim text, above the
    table, with the table still present;
  - an empty `items` with `counts.total: 0` renders `async-empty` with
    `what="queue"`, renders no `inbox-table`, and still renders any warnings;
  - a pending query renders `async-loading`; an `ApiError(500,…)` with
    `data === undefined` renders `async-error` carrying the message; an
    `ApiError(404,…)` renders `async-missing`;
  - the age column: with `actionableSince: null` the cell reads
    `no actionable time`; with a fixed `dataUpdatedAt` and a since 2 hours older
    the cell reads `2h`; two rows with different `actionableSince` age against the
    same `dataUpdatedAt`.
- `npm run verify` exits 0.
- Proof: phase C (one row per queue item; `kindLabel`, `projectName` and the
  API's exact `downstream` present; no per-row entity request) and phase D (the
  order statement rendered, free of `impact` and `priority`).
