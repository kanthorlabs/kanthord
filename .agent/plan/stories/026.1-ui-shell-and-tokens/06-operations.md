# Story S6 — FreshnessBar and the Operations screen

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md` decisions 2 and 9, `docs/ui-design.md:321-322`
Depends on: Story S3 (`GlobalShell`), Story S5 (`healthQueryOptions`, `asyncStateOf`, `AsyncBoundary`), Story S4 (the route table)

## Change

### 1. New file `ui/src/components/freshness-bar.tsx`

```ts
export interface FreshnessBarProps {
  /** Client fetch time. `null` renders an explicit "not updated yet", never a blank. */
  readonly updatedAt: Date | null;
  readonly onRefresh: () => void;
  readonly refreshing?: boolean;
}
export function FreshnessBar({
  updatedAt,
  onRefresh,
  refreshing,
}: FreshnessBarProps): ReactElement;
```

Renders:

```tsx
<div data-testid="freshness-bar" className="flex items-center gap-2 text-xs">
  <span data-testid="freshness-updated" className="text-muted-foreground">
    {label}
  </span>
  <Button
    type="button"
    variant="outline"
    size="xs"
    data-testid="freshness-refresh"
    onClick={onRefresh}
    disabled={refreshing === true}
  >
    <RefreshCw aria-hidden="true" className="size-3.5" />
    Refresh
  </Button>
</div>
```

`label` is computed with no clock of its own — **only** from `updatedAt`:

- `updatedAt === null` → `not updated yet`
- otherwise → `` `Updated ${pad(updatedAt.getHours())}:${pad(updatedAt.getMinutes())}` `` where `pad(n)` is `String(n).padStart(2, "0")`.

Local 24-hour hours/minutes, manually padded — do not use `toLocaleTimeString`, whose output depends on the host locale and would make the test non-deterministic.

`Button` comes from `@/components/ui/button` (`size="xs"` exists). `RefreshCw` from `lucide-react`.

The component owns no `useEffect`, no `setInterval`, no `Date.now()`, and does not poll (epic non-goal — polling is 026.2's).

### 2. New file `ui/src/pages/operations.tsx`

```ts
export function OperationsPage(): ReactElement;
```

Body, pinned:

- `const health = useQuery(healthQueryOptions())` (S5).
- `const state = asyncStateOf(health)`.
- `const updatedAt = health.dataUpdatedAt === 0 ? null : new Date(health.dataUpdatedAt)`.
- Renders

```tsx
<GlobalShell
  freshness={
    <FreshnessBar
      updatedAt={updatedAt}
      onRefresh={() => {
        void health.refetch();
      }}
      refreshing={health.isFetching}
    />
  }
>
  <Card data-testid="health-card">
    <CardHeader>
      <CardTitle>Daemon</CardTitle>
      <CardDescription>
        The kanthord daemon this dashboard is served by.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <AsyncBoundary
        state={state}
        what="daemon health"
        message={health.error?.message}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">status</dt>
          <dd data-testid="health-status">{health.data?.status}</dd>
          <dt className="text-muted-foreground">version</dt>
          <dd data-testid="health-version">{health.data?.version}</dd>
        </dl>
      </AsyncBoundary>
    </CardContent>
  </Card>
</GlobalShell>
```

`Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` from `@/components/ui/card`.

### 3. `ui/src/app/routes.tsx` — one line

Change the `/operations` entry's element from `<HealthPage />` (S4's placeholder wiring) to `<OperationsPage />`, and swap the import. Nothing else in the table changes.

### 4. Delete the orphans

Delete `ui/src/pages/health.tsx` and `ui/src/pages/health.test.tsx`. Their three cases (success, pending, transport error) move into `ui/src/pages/operations.test.tsx` below. After the route change nothing imports `HealthPage`, and `noUnusedLocals` would flag a leftover import.

## Constraints

- `FreshnessBar` is prop-driven and owns no clock (decision 9). Reading `Date.now()`, `new Date()` with no argument, or a timer inside it is a defect.
- The refresh control must call react-query's `refetch()`, so a click issues a **real second** `GET /healthz` over the wire — Proof phase C2 counts at least two `/healthz` lines in the daemon log. Do not read from cache and do not debounce.
- No polling, no `refetchInterval`, no visibility listener (epic non-goal; 026.2 owns polling).
- Operations is a single card, not a workspace template (epic non-goal): no W1 table, no tabs, no stat grid.
- The only route this screen calls is `GET /healthz`, through `healthQueryOptions` → `apiGet`. Nothing here may call `fetch` directly.

## Verify

- New test file `ui/src/components/freshness-bar.test.tsx` (`npm run ui:test`), conventions from `ui/src/pages/health.test.tsx:3-33`:
  - `updatedAt={null}` → `[data-testid="freshness-updated"]` text is exactly `not updated yet`, and is non-empty.
  - `updatedAt={new Date(2026, 6, 31, 9, 5)}` → text is exactly `Updated 09:05` (zero padding on both fields).
  - `updatedAt={new Date(2026, 6, 31, 23, 59)}` → text is exactly `Updated 23:59`.
  - One click on `[data-testid="freshness-refresh"]` calls `onRefresh` exactly once (`toHaveBeenCalledTimes(1)`).
  - `refreshing` omitted → the control is enabled; `refreshing={true}` → `toBeDisabled()`, and a click does not call `onRefresh`.
- New test file `ui/src/pages/operations.test.tsx` (`npm run ui:test`). Mock `@/lib/api-client` exactly as `health.test.tsx:11-19` does, use a local `renderWithQuery`, and wrap in `MemoryRouter` (the shell renders `NavLink`s):
  - Success: `apiGet` resolves `{status:"ok", version:"27.8.1"}` → `[data-testid="health-version"]` has text `27.8.1`, `[data-testid="health-status"]` has text `ok`, and `apiGet` was called with `"/healthz"`.
  - Pending: `apiGet` returns a never-settling promise → `[data-testid="async-loading"]` is present and `[data-testid="health-version"]` is not.
  - Transport error: `apiGet` rejects with `new ApiError(503,"unavailable","daemon is not answering")` → `[data-testid="async-error"]` is present, its text contains `daemon is not answering`, and `[data-testid="health-version"]` is not in the document.
  - The bar is in the shell header: `[data-testid="header-slot"]` contains `[data-testid="freshness-bar"]`.
  - Freshness label: after the successful query settles, `[data-testid="freshness-updated"]` text starts with `Updated ` (never `not updated yet`).
  - Refresh refetches: after the first resolve, click `[data-testid="freshness-refresh"]` and assert `apiGet` was called **twice** with `"/healthz"`.
  - The screen renders inside `[data-testid="global-shell"]`.
- `ui/src/pages/health.tsx` and `ui/src/pages/health.test.tsx` no longer exist; `npm run ui:test` still collects a green suite.
- `npm run verify` exits 0.
- Proof: **phase C** (`health-version` visible with the daemon's real version, `freshness-updated` contains `Updated`, the refresh click) and **phase C2** (at least two `GET /healthz` in the daemon log).
