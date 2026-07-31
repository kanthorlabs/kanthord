# Story S3 — the two shells

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md:163-164`, `docs/ui-design.md:198-205`

## Change

One new file `ui/src/components/shell.tsx` exporting `GlobalShell` and `ProjectShell` plus a module-private `ShellFrame`. Both shells are **prop-only**: no query, no `fetch`, no `useParams`.

### Nav tables (module constants, exact labels and order)

```ts
const GLOBAL_NAV = [
  { label: "Inbox", to: "/inbox" },
  { label: "Projects", to: "/project" },
  { label: "Operations", to: "/operations" },
] as const;

const PROJECT_NAV = [
  { label: "Overview", leaf: "overview" },
  { label: "Graph", leaf: "graph" },
  { label: "Plan", leaf: "plan" },
  { label: "Resources", leaf: "resource" },
  { label: "Readiness", leaf: "readiness" },
] as const;
```

`Resources` is the label; `resource` is the route segment (epic decision 4). Do not "fix" either.

### `ShellFrame` (module-private)

```ts
interface ShellFrameProps {
  readonly navTestId: string; // "global-nav" | "project-nav"
  readonly items: readonly { readonly label: string; readonly to: string }[];
  readonly shellTestId: string; // "global-shell" | "project-shell"
  readonly header: ReactNode; // breadcrumb or freshness slot content
  readonly pendingCount: number;
  readonly children: ReactNode;
}
```

Renders:

- root `<div data-testid={shellTestId} className="min-h-svh md:grid md:grid-cols-[16rem_1fr]">`
- a desktop sidebar `<aside className="hidden md:block …">` containing `<nav data-testid={navTestId}>` with one `NavLink` per item (`react-router-dom`, renders an `<a>`), `end` not set, active styling via the `isActive` callback.
- a mobile `Sheet` (`@/components/ui/sheet`): `SheetTrigger` wraps a `Button variant="outline" size="icon"` with `data-testid="nav-toggle"`, `aria-label="Open navigation"`, containing `<Menu aria-hidden="true" className="size-4" />` from `lucide-react`, and — **only when `pendingCount > 0`** — a `<span data-testid="nav-pending">{pendingCount}</span>`. `SheetContent side="left"` contains a `SheetTitle` "Navigation" and a **second** nav with `data-testid={`${navTestId}-mobile`}` holding the same items.
- a header `<header data-testid="shell-header">` containing `<div data-testid="header-slot">{header}</div>` and the mobile trigger.
- `<main data-testid="shell-main">{children}</main>`

### `GlobalShell`

```ts
export interface GlobalShellProps {
  readonly freshness?: ReactNode;
  readonly pendingCount?: number; // default 0
  readonly children: ReactNode;
}
```

Passes `navTestId="global-nav"`, `shellTestId="global-shell"`, `items=GLOBAL_NAV`, `header={freshness ?? null}`.

### `ProjectShell`

```ts
export interface ProjectShellProps {
  readonly projectId: string;
  readonly segments: readonly string[];
  readonly pendingCount?: number; // default 0
  readonly children: ReactNode;
}
```

Passes `navTestId="project-nav"`, `shellTestId="project-shell"`, and `items` built as `PROJECT_NAV.map(i => ({label: i.label, to: `/project/${projectId}/${i.leaf}`}))`.

`header` is the breadcrumb, built from `@/components/ui/breadcrumb`:
`<Breadcrumb data-testid="breadcrumb">` → `<BreadcrumbList>` → for each segment a `<BreadcrumbItem><BreadcrumbPage>{segment}</BreadcrumbPage></BreadcrumbItem>`, with a `<BreadcrumbSeparator/>` between items only. It renders the segments it is given and **nothing else** — no id, no "Project" prefix, no fallback text when `segments` is empty (an empty array renders an empty list).

## Constraints

- `[data-testid="global-nav"]` and `[data-testid="project-nav"]` must each contain **exactly** the nav links of that shell — 3 and 5 `<a>` elements. The Sheet's copy uses the `-mobile` suffix so the Proof's `count()` is unaffected. Never render a link, a logo link or a "skip to content" link inside those two elements.
- The desktop sidebar is visible from `md:` (768px) upward. Playwright's default viewport is 1280×720, so Proof phases B and D read the desktop nav via `innerText` — a nav hidden at that width returns an empty string and fails the label check.
- No shell may call `fetch`, `useQuery`, `useParams` or `useLocation`-derived data fetching. Scope arrives as props only.
- Do not add a `⌘K` palette or a palette slot (epic non-goal).
- Do not modify `ui/src/components/ui/**` (vendored, lint-ignored).

## Verify

- New test file `ui/src/components/shell.test.tsx`, run with `npm run ui:test`. Conventions from `ui/src/pages/health.test.tsx:3-33`. Every render must be wrapped in a router — use `MemoryRouter` from `react-router-dom` (a `NavLink` outside a router throws). Assertions:
  - `GlobalShell` renders `[data-testid="global-shell"]`, and `[data-testid="global-nav"] a` has length exactly 3 with text content `Inbox`, `Projects`, `Operations` in that order, and `href` ending `/inbox`, `/project`, `/operations`.
  - `ProjectShell projectId="p1"` renders `[data-testid="project-shell"]`, and `[data-testid="project-nav"] a` has length exactly 5 with labels `Overview`, `Graph`, `Plan`, `Resources`, `Readiness` in that order and `href`s ending `/project/p1/overview`, `/graph`, `/plan`, `/resource`, `/readiness`.
  - `pendingCount` default: `[data-testid="nav-pending"]` is **not** in the document; with `pendingCount={4}` it is present on `[data-testid="nav-toggle"]`'s subtree and has text `4`.
  - `[data-testid="nav-toggle"]` exists in both shells and has the accessible name `Open navigation`.
  - Breadcrumb: `ProjectShell segments={["alpha"]}` → `[data-testid="breadcrumb"]` text content is exactly `alpha`; `segments={["alpha","init-1"]}` → its text contains both, and contains no `p1` (the project id) and no literal `Project`.
  - `GlobalShell freshness={<span data-testid="probe" />}` renders that node inside `[data-testid="header-slot"]`; with `freshness` omitted, `[data-testid="header-slot"]` is present and empty.
  - `children` render inside `[data-testid="shell-main"]`.
- `npm run ui:typecheck`, `npm run ui:lint` exit 0.
- `npm run verify` exits 0.
- Proof: **phase B** (`global-shell` mounted, `global-nav a` = 3, the three labels) and **phase D** (`project-shell` mounted, `project-nav a` = 5, the five labels, `breadcrumb` carries the real project name).
