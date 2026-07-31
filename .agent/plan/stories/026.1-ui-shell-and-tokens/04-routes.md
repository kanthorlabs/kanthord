# Story S4 — the hash route table, NotBuiltYet, the `#/` redirect, the missing hash

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md` decisions 4, 5, 6
Depends on: Story S3 (shells), Story S5 (`AsyncBoundary`, `useProjectSummary`)

## Change

### 1. New file `ui/src/components/not-built-yet.tsx`

```ts
export interface NotBuiltYetProps {
  /** The surface's name, e.g. "Inbox", "Project overview". */
  readonly surface: string;
  /** The epic that builds it, e.g. "026.2". */
  readonly epic: string;
}
export function NotBuiltYet({ surface, epic }: NotBuiltYetProps): ReactElement;
```

Renders one element `<div data-testid="not-built-yet" data-epic={epic}>` whose text is exactly:

`{surface} is not built yet. EPIC {epic} builds it.`

It is an honest unavailable state (decision 5): no spinner, no progress bar, no "coming soon", no link.

### 2. New file `ui/src/app/project-route.tsx`

```ts
export interface ProjectRouteProps {
  readonly children: ReactNode;
}
export function ProjectRoute({ children }: ProjectRouteProps): ReactElement;
```

Behaviour, pinned:

- `const id = useParams()["id"] ?? ""` (`useParams` from `react-router-dom`).
- `const project = useProjectSummary(id)` (S5).
- `const state = asyncStateOf(project)` (S5).
- When `state !== "resolved"`: render `<ProjectShell projectId={id} segments={[]}><AsyncBoundary state={state} what="project" message={project.error?.message} /></ProjectShell>` — the shell still renders, so the operator keeps the nav.
- When `state === "resolved"`: render `<ProjectShell projectId={id} segments={[project.data.name]}>{children}</ProjectShell>`.

### 3. New file `ui/src/app/routes.tsx`

The route table as data, so a test can assert over it:

```ts
export type RouteKind = "screen" | "not-built-yet" | "redirect" | "missing";

export interface AppRoute {
  readonly path: string;
  readonly kind: RouteKind;
  /** Present exactly when kind === "not-built-yet". */
  readonly epic?: string;
  readonly element: ReactElement;
}

export const ROUTE_TABLE: readonly AppRoute[] = [ … ];
```

Exactly these eleven entries, in this order:

| path                     | kind            | epic    | element                                                                                |
| ------------------------ | --------------- | ------- | -------------------------------------------------------------------------------------- |
| `/`                      | `redirect`      | —       | `<Navigate to="/inbox" replace />`                                                     |
| `/inbox`                 | `not-built-yet` | `026.7` | `<GlobalShell><NotBuiltYet surface="Inbox" epic="026.7" /></GlobalShell>`              |
| `/project`               | `not-built-yet` | `026.2` | `<GlobalShell><NotBuiltYet surface="Projects" epic="026.2" /></GlobalShell>`           |
| `/operations`            | `screen`        | —       | `<OperationsPage />`                                                                   |
| `/project/:id/overview`  | `not-built-yet` | `026.2` | `<ProjectRoute><NotBuiltYet surface="Project overview" epic="026.2" /></ProjectRoute>` |
| `/project/:id/graph`     | `not-built-yet` | `026.6` | `<ProjectRoute><NotBuiltYet surface="Graph" epic="026.6" /></ProjectRoute>`            |
| `/project/:id/plan`      | `not-built-yet` | `026.4` | `<ProjectRoute><NotBuiltYet surface="Plan" epic="026.4" /></ProjectRoute>`             |
| `/project/:id/resource`  | `not-built-yet` | `026.5` | `<ProjectRoute><NotBuiltYet surface="Resources" epic="026.5" /></ProjectRoute>`        |
| `/project/:id/readiness` | `not-built-yet` | `026.6` | `<ProjectRoute><NotBuiltYet surface="Readiness" epic="026.6" /></ProjectRoute>`        |
| `*`                      | `missing`       | —       | `<GlobalShell><AsyncBoundary state="missing" what="page" /></GlobalShell>`             |

`OperationsPage` is S6's `ui/src/pages/operations.tsx`. Until S6 lands, S4 may not invent it — S6 runs after S4, so **S4 registers `/operations` pointing at the existing `HealthPage` and S6 replaces that one line**. Nothing else about the table changes in S6.

There is **no** shared layout route and no `<Outlet />`: every route element renders its own shell. That is what lets `#/operations` put `FreshnessBar` in the shell header (S6) with no context and no slot machinery.

### 4. Rewrite `ui/src/app/router.tsx`

Replace all of `ui/src/app/router.tsx:1-12` with a factory over the table:

```ts
export function createAppRouter(): ReturnType<typeof createHashRouter>;
export const router = createAppRouter();
```

`createAppRouter` maps `ROUTE_TABLE` to `createHashRouter(ROUTE_TABLE.map(({ path, element }) => ({ path, element })))`. `ui/src/main.tsx` keeps importing `{ router }` unchanged.

## Constraints

- **No parameterized deep link beyond the project `:id`** (decision 4). Registering `/inbox/:itemId` is forbidden until 026.8 — queue items have no id.
- Every registered leaf renders real content or `NotBuiltYet`. There is no third option and no blank leaf (decision 5).
- `#/` must land on `#/inbox` with `replace`, so the browser's hash reads `#/inbox` after the redirect (Proof phase B asserts the hash).
- Keep the `path: "*"` entry last. React Router matches the static `/project` before the dynamic `/project/:id/…`; do not reorder to "fix" that.
- `ui/src/main.tsx` must not change.
- No API call other than `GET /api/project/:id` via `useProjectSummary` (epic non-goal).

## Verify

- New test file `ui/src/app/routes.test.tsx` (`npm run ui:test`). Conventions from `ui/src/pages/health.test.tsx:3-33`; mock `@/lib/api-client` with `vi.mock` + `apiGet: vi.fn()` and use a local `renderWithQuery` helper. To render a route, set `window.location.hash` **before** calling `createAppRouter()`, then render `<RouterProvider router={createAppRouter()} />`.
  - Table shape: `ROUTE_TABLE.map(r => r.path)` equals the eleven paths above, in that order.
  - Every entry's `kind` is one of `screen | not-built-yet | redirect | missing`; `epic` is defined for exactly the `not-built-yet` entries and undefined for all others.
  - **No forbidden deep link**: no `path` matches `/^\/inbox\//`, and no `path` other than the five `/project/:id/*` leaves contains a `:` parameter.
  - `#/` redirect: hash `#/`, render, then assert `window.location.hash === "#/inbox"` and `[data-testid="not-built-yet"]` has `data-epic="026.7"`.
  - Per-leaf render, one test per path: with `apiGet` mocked to resolve `{id:"p1", name:"alpha"}`, hash `#/project/p1/overview` renders `[data-testid="project-shell"]` and a `not-built-yet` with `data-epic="026.2"`; likewise `graph`→`026.6`, `plan`→`026.4`, `resource`→`026.5`, `readiness`→`026.6`. `#/inbox`→`026.7` and `#/project`→`026.2` render `[data-testid="global-shell"]`.
  - Unknown hash `#/definitely-not-a-route` renders `[data-testid="async-missing"]` inside `[data-testid="global-shell"]`, and `document.body.textContent.trim()` is non-empty.
  - `ProjectRoute` missing project: `apiGet` rejects with `new ApiError(404,"not_found","no project")`; hash `#/project/nope/overview` renders `[data-testid="project-shell"]` **and** `[data-testid="async-missing"]`, and `[data-testid="breadcrumb"]` text is empty.
  - `ProjectRoute` breadcrumb: resolved `{id:"p1",name:"alpha"}` → `[data-testid="breadcrumb"]` text is exactly `alpha`.
- New test file `ui/src/components/not-built-yet.test.tsx` (`npm run ui:test`): renders the exact sentence, carries `data-epic`, and contains no `<a>` and no element with `role="progressbar"`.
- `npm run verify` exits 0.
- Proof: **phase B** (`#/` → `#/inbox`), **phase D** (cold load of `#/project/<id>/overview`, leaf names `026.2`), **phase E** (unknown hash renders the missing state, body not blank).
