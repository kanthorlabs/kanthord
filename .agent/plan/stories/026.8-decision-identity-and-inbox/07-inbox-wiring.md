# Story 7 — Inbox wiring: real titles, kind filter, `#/inbox/:decisionId`

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Story 4, Story 5, Story 6, and **EPIC 026.7's Inbox page**
(`ui/src/pages/inbox.tsx`, `[data-testid="inbox-table"]`,
`[data-testid="inbox-order"]`, `[data-testid="inbox-truncated"]`,
`[data-testid="inbox-warning"]`, `[data-testid="inbox-pane"]`,
`[data-testid="verdict"]`). If that page does not exist under that path when
this story starts, stop and report — do not create a second Inbox.

## Change

1. **Queries** — `ui/src/lib/queries.ts`, following the existing
   `<thing>QueryOptions` + `use<Thing>` convention (`:19-39`):

```ts
export interface DecisionQueueItem {
  /* readonly mirror of DecisionItemView:
  id, kind, kindLabel, state, projectId, projectName, initiativeId,
  initiativeName?, objectiveId?, objectiveName?, taskId?, taskTitle?,
  downstream, actionableSince, verdicts, evidence, cause?, expectedCommit? */
}
export interface DecisionQueue {
  readonly items: readonly DecisionQueueItem[];
  readonly counts: {
    readonly total: number;
    readonly byKind: Readonly<Record<string, number>>;
  };
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}
export interface DecisionDetail {
  /* readonly mirror of DecisionView (Story 5) */
}

export function decisionQueueQueryOptions(filter?: { kind?: string });
export function useDecisionQueue(filter?: { kind?: string });
export function decisionQueryOptions(id: string);
export function useDecision(id: string);
```

Pinned:

- `decisionQueueQueryOptions` → `queryKey: ["queue", filter?.kind ?? null] as const`,
  `queryFn` → `apiGet<DecisionQueue>(path, { signal })` where `path` is
  `/api/queue` with no filter and `` `/api/queue?kind=${encodeURIComponent(kind)}` ``
  with one. **No client-side filtering anywhere.**
- `decisionQueryOptions(id)` → `queryKey: ["decision", id] as const`,
  `queryFn` → `apiGet<DecisionDetail>(\`/api/queue/${encodeURIComponent(id)}\`, { signal })`.
- Both `queryFn`s take `(ctx?: { readonly signal?: AbortSignal })` and forward
  `ctx?.signal`, like `:19-33`.
- No `Authorization` header, ever (rule R3 — `ui/src/lib/api-client.ts:1-8`).

2. **Role token** — `ui/src/lib/status-role.ts`, appended in the file's existing
   shape (a type + a `Record<…, Role>` map, complete literal classes only):

```ts
export type DecisionState = "open" | "resolved" | "expired";
export const DECISION_STATE_ROLE = {
  open: "attention",
  resolved: "success",
  expired: "neutral",
} satisfies Record<DecisionState, Role>;
```

and `ui/src/components/status-chip.tsx:141-153` gains the variant
`{ axis: "decisionState"; value: DecisionState }`. A decision state may not be
coloured inside a page (`docs/ui-design.md:279-299`).

3. **Route** — `ui/src/app/routes.tsx`:
   `ROUTE_TABLE` gains `{ path: "/inbox/:decisionId", kind: "screen" }`
   immediately after the `/inbox` row (`:32`), and the router gains the matching
   child inside the `GlobalShellLayout` branch (`:78-84`) rendering
   `<DecisionPage />`.

4. **Decision page** — new `ui/src/pages/decision.tsx`:

```ts
export function DecisionPage(): ReactElement;
```

- reads `useParams()`'s `decisionId`, calls `useDecision(id)` and
  `asyncStateOf(...)`; renders `<AsyncBoundary state={state} what="decision" />`
  for every non-resolved state — a `404` therefore renders
  `[data-testid="async-missing"]` through the existing mapping
  (`ui/src/lib/async-state.ts:29-45`); **`missing` for a 404 only.**
- when resolved, renders:
  - `[data-testid="decision-state"]` — the literal `open` / `resolved` /
    `expired`, plus a `StatusChip axis="decisionState"`;
  - `[data-testid="decision-historical"]`, rendered **only** when
    `historical === true`, saying the names are as **last observed while the
    decision was open** (Story 5 pins why "at the moment it closed" would be a
    false claim);
  - the snapshot names (`taskTitle` / `objectiveName` / `initiativeName` /
    `projectName`), the `closedReason` when present, and the subject type + id.
  - a "Back to inbox" link. **Never auto-navigate** (`docs/ui-design.md:242-252`).
- issues exactly one request: `/api/queue/<id>`. No entity fan-out.

5. **Inbox page edits** — `ui/src/pages/inbox.tsx`:

- each row renders `[data-testid="inbox-row-title"]` = `taskTitle ??
objectiveName ?? initiativeName ?? projectName` — the first present value, no
  fabricated text, no shortened id;
- the row title links to `#/inbox/<item.id>`;
- a native `<select data-testid="inbox-filter-kind">` whose options are `""`
  (label "all kinds") plus the five machine kinds as `value`, defaulting to
  `""`; changing it changes the query key, which issues a new
  `/api/queue?kind=…` request. Playwright drives it with `selectOption`, so it
  must be a real `<select>`;
- `[data-testid="inbox-counts-global"]` — states that `counts.total` and
  `counts.byKind` are the global totals, not the filtered view;
- "Next open item" moves to the next row **in the currently loaded, filtered
  order**, and its label says so; it is absent when the loaded window holds no
  next row (`docs/ui-design.md:242-252`, epic decision 9);
- 026.7's order statement, truncation banner, warnings and no-fan-out rule are
  unchanged.

## Constraints

- Cold load must work: `#/inbox/:decisionId` resolves entirely from the URL
  (`scripts/e2e/ui-browser.mjs:95-102` always does a full `page.goto`).
- The unfiltered queue is what loads on a cold `#/inbox` — 026.7's Proof asserts
  `rows === items.length` from an unfiltered `GET /api/queue`.
- No new dependency in `ui/package.json` (lane-forbidden anyway).

## Verify

- `npm run test --workspace ui` (Vitest + jsdom, `apiGet` mocked at the module
  seam as in `ui/src/pages/operations.test.tsx:12-20`):
  - `ui/src/lib/queries.test.ts` — `["queue", null]` / `["queue",
"task-review"]` / `["decision", "<id>"]` query keys; the filtered options
    request `/api/queue?kind=task-review`; both `queryFn`s forward the signal; no
    request carries an `Authorization` header.
  - `ui/src/lib/status-role.test.ts` — the three `DecisionState` members map to
    `attention` / `success` / `neutral`.
  - `ui/src/components/status-chip.test.tsx` — `axis="decisionState"` renders
    `data-axis="decisionState"`, `data-value` and the mapped `data-role`.
  - `ui/src/app/routes.test.tsx` — `EXPECTED_PATHS` (`:43-58`) gains
    `/inbox/:decisionId` in position; the forbidden-deep-link test (`:84-93`)
    is rewritten to allow exactly `/inbox/:decisionId` and still reject any
    other `:param` outside `/project/:id/`; the "epic is defined for exactly the
    not-built-yet entries" test (`:73-82`) still passes.
  - `ui/src/pages/decision.test.tsx` — resolved-open renders
    `decision-state` = `open` and **no** `decision-historical`; a resolved and an
    expired occurrence each render their state and `decision-historical`; an
    `ApiError` with status `404` renders `async-missing`; a `500` renders
    `async-error`, not `async-missing`; exactly one `apiGet` call, to
    `/api/queue/<id>`.
  - `ui/src/pages/inbox.test.tsx` — a row renders `inbox-row-title` with the
    DTO's `taskTitle` (and falls back in the pinned order); changing
    `inbox-filter-kind` triggers a second `apiGet` whose path contains
    `kind=`, and the test fails if the component filters an unchanged result set
    client-side; `inbox-counts-global` renders `counts.total`; a filtered result
    still shows the global total; "Next open item" is absent with a single row.
- `npm run verify` exits 0.
- Proof: phases G and H (`the row shows the entity's real title`, `the kind
filter did not reach the server`, `the global counts are labelled as global`,
  `the decision cold-loads`, `an unknown decision is the missing state`, `no
console error`, no `Authorization` header).
