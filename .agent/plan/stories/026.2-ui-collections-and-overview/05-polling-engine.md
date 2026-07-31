# Story 05 — the polling engine

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md` (decisions 10, 11)
Depends on: Story 04 (this story edits `ui/src/pages/project-overview.tsx`).

## Change

### New file `ui/src/lib/polling.ts`

```ts
export const POLL_INTERVAL_MS = 15_000;

export interface UseVisibilityPollOptions {
  /** The signal value the screen currently shows — `digest.latest`. */
  readonly signal: string | null;
  /** Fetches the current signal value. Must forward the AbortSignal. */
  readonly probe: (abort: AbortSignal) => Promise<string | null>;
  /** Called once per probe whose result differs from `signal`. */
  readonly onChange: () => void;
  /** Aborts the in-flight probe and restarts the engine when it changes. */
  readonly resetKey: string;
  readonly intervalMs?: number;
}

export interface VisibilityPollState {
  readonly probing: boolean;
  readonly error: Error | null;
}

export function useVisibilityPoll(
  options: UseVisibilityPollOptions,
): VisibilityPollState;
```

Pinned behaviour — all nine bullets of decision 10:

1. A tick runs only while `document.visibilityState === "visible"`. On
   `visibilitychange` to `hidden` the interval is cleared; no probe starts.
2. On `visibilitychange` back to `visible` the hook probes **immediately**, then
   restarts the interval from that moment.
3. No overlap: a probe in flight makes the next tick a no-op. The tick does not
   queue.
4. On unmount and on a `resetKey` change: clear the interval, remove the
   listener, and `abort()` the in-flight probe's controller. An `AbortError`
   rejection is swallowed — it sets no error and calls no `onChange`.
   A `hidden` transition does **not** abort an in-flight probe.
5. Change detection compares the probe result with `options.signal` read at
   probe-completion time (keep `signal`, `probe` and `onChange` in refs updated
   every render, so a re-render never restarts the engine). `null → "<ulid>"`
   counts as a change. An equal value calls nothing.
6. A rejected probe sets `error` and leaves `onChange` uncalled; the interval
   keeps running and the next tick probes again. The hook writes nothing that
   the FreshnessBar reads, so `Updated HH:MM` is untouched by a failed poll.
7. `probing` is `true` while a probe is in flight.
8. The effect depends on `[resetKey, intervalMs]` only.
9. `intervalMs` defaults to `POLL_INTERVAL_MS`. That constant is the single
   interval definition in the codebase.

The hook performs no invalidation itself — decision 11 keeps that at the call
site.

### Edit `ui/src/pages/project-overview.tsx`

Add, after the existing `useQuery`:

```ts
const queryClient = useQueryClient();
const poll = useVisibilityPoll({
  signal: query.data?.digest.latest ?? null,
  probe: (abort) =>
    fetchProjectOverview(projectId, { signal: abort }).then(
      (o) => o.digest.latest,
    ),
  onChange: () => {
    void invalidateOverview(queryClient, projectId);
  },
  resetKey: projectId,
});
```

Render `poll.error` in a dedicated slot `<p data-testid="poll-error" role="status">`
holding the message, shown only when `poll.error !== null`. It must not replace
the page body and must not clear the sections (decision 10). The FreshnessBar
props stay exactly as Story 04 set them, so a failed poll cannot change
`Updated HH:MM`, and the refresh control is never disabled by polling.

## Constraints

- Only the Overview consumes the hook in this epic. No resource collection and
  no Projects page polls (decision 11 — a task event cannot affect them).
- `invalidateOverview` is the only invalidation call; it is `exact: true`.
- `POLL_INTERVAL_MS` is exported from `ui/src/lib/polling.ts` and imported
  where needed — no second literal `15000` anywhere.
- The module imports nothing from Node (R4) and calls no `fetch` (R3 — the
  probe is passed in).

## Verify

- `npm run test --workspace ui -- src/lib/polling.test.ts` — new file, using
  `renderHook` from `@testing-library/react`, `vi.useFakeTimers()`, and a
  stubbed visibility state installed with
  `Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })`
  plus `document.dispatchEvent(new Event("visibilitychange"))`. Assertions, one
  test each:
  1. hidden at mount: after `advanceTimersByTime(3 * POLL_INTERVAL_MS)` the
     probe was never called.
  2. visible: the probe is called once per `POLL_INTERVAL_MS`, three ticks → 3
     calls.
  3. hidden → visible: the probe is called immediately on the visibility event,
     before any timer advance.
  4. no overlap: a probe returning a never-settling promise is called once even
     after three intervals.
  5. unmount: the `AbortSignal` handed to the in-flight probe has
     `aborted === true` after `unmount()`, and no state update warns.
  6. `resetKey` change: the previous probe's signal is aborted and the next tick
     probes with a fresh signal.
  7. probe resolves the same value as `options.signal` → `onChange` not called.
  8. probe resolves a different value (`signal: null`, probe `"01J…"`) →
     `onChange` called exactly once.
  9. probe rejects → `onChange` not called, `result.current.error` is that
     error, and the following tick probes again.
- `npm run test --workspace ui -- src/pages/project-overview.test.tsx` — add:
  - a probe answering a **new** `digest.latest` invalidates exactly
    `projectKeys.overview(projectId)`: with a real `QueryClient` also holding
    data at `projectKeys.resources(projectId,"repository")`,
    `projectKeys.list()` and `resourceKeys.detail("r1")`, only the overview
    query state has `isInvalidated === true` after the tick.
  - a probe answering the **same** `digest.latest` invalidates nothing.
  - a failed poll leaves `[data-testid="freshness-updated"]` at its previous
    text and renders `[data-testid="poll-error"]`, with all three Overview
    sections still in the DOM.
  - clicking `[data-testid="freshness-refresh"]` while a probe is in flight
    still calls `fetchProjectOverview` — polling never disables manual refresh.
- `npm run verify` exits 0.
- Proof: phase F of `scripts/e2e/ui-collections-proof.sh` — a task created
  through the API raises the card's pending count on an untouched page within
  two intervals, with zero console errors.
