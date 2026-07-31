# Story 07 — register the Inbox and the two conflict routes

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decisions 1, 8)
Depends on: Stories 02, 04, 05, 06.

## Change

Two files: `ui/src/app/routes.tsx` and `ui/src/app/routes.test.tsx`.

### `ROUTE_TABLE`

- Change the `/inbox` row from
  `{ path: "/inbox", kind: "not-built-yet", epic: "026.7" }` to
  `{ path: "/inbox", kind: "screen" }`. The `epic` key must be **removed**, not
  emptied — `routes.test.tsx` asserts `epic` is present if and only if
  `kind === "not-built-yet"`.
- Insert these two rows immediately before the `{ path: "*", kind: "missing" }`
  row, in this order:

```ts
{ path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId/conflict", kind: "screen" },
{ path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/conflict", kind: "screen" },
```

The param spelling is `:projectId` / `:initiativeId` / `:objectiveId` /
`:taskId`, matching EPIC 026.3's canonical chain. No `epic` key.

### `createAppRouter()`

- Remove `/inbox` from the `GlobalShellLayout` children array. `InboxPage` renders
  its own `GlobalShell` because it owns the header `FreshnessBar`, exactly as
  `OperationsPage` does. The layout keeps `/project` and `*`.
- Add three **top-level** route objects, siblings of `/operations` and of EPIC
  026.3's four entity routes — not children of `ProjectRoute`, whose hardcoded
  `segments` cannot express a conflict breadcrumb:

| path                                                                                        | element                     |
| ------------------------------------------------------------------------------------------- | --------------------------- |
| `/inbox`                                                                                    | `<InboxPage />`             |
| `/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId/conflict` | `<TaskConflictPage />`      |
| `/project/:projectId/initiative/:initiativeId/objective/:objectiveId/conflict`              | `<ObjectiveConflictPage />` |

- No `loader` on any of the three. The Inbox is manual refresh (decision 6) and a
  prefetch loader would issue a second window fetch.
- `ui/src/main.tsx` does not change.

### `ui/src/app/routes.test.tsx`

- Update the pinned exact path list and order to include the three changes above.
- Keep the assertion that `epic` is present exactly when
  `kind === "not-built-yet"`; `/inbox` must now fail that test if an `epic` key is
  left behind.
- Keep EPIC 026.3's assertion that **no** `ROUTE_TABLE` path matches
  `/^\/inbox\//`. It is now decision 1's guard: queue items have no id, so
  `#/inbox/:itemId` stays unregistered until EPIC 026.8.
- Add three hash-navigation cases in the existing style (`window.location.hash =
…` before render, then `waitFor`): `#/inbox` renders `inbox-table` (or
  `async-loading`) and **not** `not-built-yet`; the task conflict hash renders
  `conflict-shell`; the objective conflict hash renders `conflict-shell`.
- Add a case asserting `#/` still redirects to `#/inbox` and that exactly one
  `global-shell` is in the document there.

## Constraints

- Exactly one `global-shell` must be mounted at `#/inbox`.
  `scripts/e2e/ui-system-proof.sh:121-126` asserts `global-shell` count `1`, three
  `global-nav` links, the `#/` → `#/inbox` redirect, and zero console errors at
  that URL. Leaving `/inbox` inside `GlobalShellLayout` **and** rendering a
  `GlobalShell` in `InboxPage` would mount two and break that proof. Do not edit
  `ui-system-proof.sh`.
- `scripts/e2e/ui-system-proof.sh:146-147` asserts the unbuilt-leaf placeholder
  names `026.2`, on `#/project/:id/overview` — not on `/inbox`. It needs no change.
- Register no `/inbox/:itemId`, no `?filter=`, no `?kind=` and no query-string
  route state.
- Do not convert any other `not-built-yet` row. `/project/:id/plan` stays
  `026.8`'s.
- Do not add a redirect from the old conflict-less entity route, and do not make a
  conflict route an index route.

## Verify

- `npm test --workspace ui -- src/app/routes.test.tsx` — all cases above pass,
  including the unchanged `/^\/inbox\//` guard and the `epic`-iff-`not-built-yet`
  invariant.
- `npm run verify` exits 0.
- `scripts/e2e/ui-system-proof.sh` exits 0 unchanged — confirm with
  `git diff --stat scripts/e2e/ui-system-proof.sh` producing no output.
- Proof: phase C (`#/inbox` cold-loads and renders `inbox-table`) and phase F
  (the task conflict hash cold-loads and resolves the whole route from the URL).
