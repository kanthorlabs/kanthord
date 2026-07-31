# Story 04 — manual refresh, all five behaviours

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decision 6)
Depends on: Story 03.

## Change

In `ui/src/pages/inbox.tsx` only.

- Put a `FreshnessBar` in the shell header slot, the same way
  `ui/src/pages/operations.tsx:33` does:

```tsx
<GlobalShell
  freshness={
    <FreshnessBar
      updatedAt={queue.dataUpdatedAt === 0 ? null : new Date(queue.dataUpdatedAt)}
      refreshing={queue.isFetching}
      onRefresh={() => void queue.refetch()}
    />
  }
>
```

The five behaviours this pins, each of which the tests below assert:

1. **Disabled while in flight** — `refreshing={queue.isFetching}` is the only
   source; `FreshnessBar` already disables its button on that prop
   (`ui/src/components/freshness-bar.tsx:19`).
2. **A failed refresh keeps the current rows** — the body branches on
   `queue.data === undefined`, never on `queue.isError`. With data present and the
   latest fetch rejected, the table stays and a notice appears:
   `<p data-testid="inbox-refresh-error" role="status" data-role="danger">` with
   the exact text
   `` `The last refresh failed: ${message} The rows below are the last good fetch.` ``
   where `message` is `queue.error instanceof Error ? queue.error.message : "unknown error"`.
   Render it directly above the table, below the warnings.
3. **`FreshnessBar` advances only on success** — the timestamp comes from
   `queue.dataUpdatedAt`, which React Query advances on a successful fetch only.
   Never pass `Date.now()`, never pass `errorUpdatedAt`.
4. **No refetch on focus** — Story 02's query already sets
   `refetchOnWindowFocus: false` explicitly, and this file adds no
   `refetchInterval`, no `useVisibilityPoll`, no `visibilitychange` listener and
   no `focus` listener.
5. **A changed total is announced** — render
   `<p data-testid="inbox-total" role="status" aria-live="polite">` with the exact
   text `` `${String(queue.data.counts.total)} items need a decision.` ``,
   immediately after the toolbar and before the warnings. It is the live region;
   no other element in this file sets `aria-live`.

- Selection across a refresh: because Story 03 resolves `selected` by looking
  `selectedKey` up in the **current** `queue.data.items`, a row that survives the
  refresh keeps its pane open and a row that disappears closes it with no error.
  Add nothing to make this happen; assert it.

## Constraints

- Exactly one `useQuery` and one refresh path in this file. No second query, no
  `queryClient.invalidateQueries`, no `refetchQueries`.
- Do not add a `refetchInterval`, a countdown, an auto-retry, or a "live" badge.
  `/api/queue` returns no change signal (`docs/ui-design.md:319-320`).
- Do not use `useVisibilityPoll` (EPIC 026.2) or `useGraphFreshness` (EPIC 026.6).
- Do not clear `selectedKey` on refresh, and do not store the selected item
  object.
- Keep the `AsyncBoundary` branch keyed on `queue.data === undefined`; do not
  reintroduce an `isError` gate that would blank the table.

## Verify

- `npm test --workspace ui -- src/pages/inbox.test.tsx` — extend the file.
  Drive Story 02's `globalThis.fetch` stub with a per-call queue of responses
  (first call resolves, second returns `status: 500`, and so on) and
  `fireEvent.click` on `freshness-refresh`. Do **not** mock `@/lib/api-client`:
  `fetchQueue` calls `apiGet` through its own module-local binding and cannot be
  intercepted that way. Assert:
  - `freshness-refresh` is disabled while a fetch is in flight (first resolve
    held open with `new Promise(() => {})`) and enabled again after it settles;
  - clicking `freshness-refresh` issues exactly one more recorded `fetch` request;
  - after a refresh that rejects with `ApiError(500,…)`: `inbox-table` is still in
    the document with the original row count, `inbox-refresh-error` is present and
    carries the error message, and `async-error` is **absent**;
  - a subsequent successful refresh removes `inbox-refresh-error`;
  - `freshness-updated` text does not change across the failed refresh and does
    change after the successful one (compare the two `Updated HH:MM` strings using
    two distinct fake `dataUpdatedAt` values via `vi.useFakeTimers()` /
    `vi.setSystemTime()`);
  - dispatching `window.dispatchEvent(new Event("focus"))` and a
    `document` `visibilitychange` triggers **no** additional recorded `fetch` request;
  - `inbox-total` has `role="status"`, `aria-live="polite"`, and its text follows
    `counts.total` — not `items.length` — across a refresh that changes the total
    from 3 to 9;
  - selection survival: select a row, refresh with a payload that still contains
    that `rowKey` → `inbox-pane` is still open; refresh with a payload that drops
    it → `inbox-pane` is gone and no `async-error` appears.
- `npm run verify` exits 0.
- Proof: none directly — the Proof loads the Inbox once. Phase C and phase G stay
  green because this story adds no request and no header.
