# EPIC 026.1 — UI shell + token system — stories

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md`
Prereq: EPIC 026 (sequence order) — the `ui/` Vite workspace, hash router, `api-client.ts`, the 24 vendored shadcn components, `build:ui`, and the served-build static rows already exist.

After this epic both shells render for real, hash routing carries the whole scope, the six operator roles exist once as CSS custom properties and once as an exhaustive TypeScript mapping, the five shared parts exist, and `#/operations` proves query → `api-client` → AsyncBoundary → FreshnessBar → shell in a real browser.

## Dispatch order

`S1 → S2 → S3 → S5 → S4 → S6 → S7 → S8`

**S5 runs before S4** — the only deviation from the epic's bullet order. S4's route table needs `AsyncBoundary` (unknown hash → `missing`) and `useProjectSummary` (the breadcrumb's real project name), both of which S5 creates. Everything else follows the epic order.

S3 and S4 are a coupled pair: S3's shells are prop-only and S4 is their sole composer.

## Stories

- S1 — six role custom properties + `status-role.ts` exhaustive over seven axes → `01-tokens.md`
- S2 — `StatusChip` over S1's maps, label + icon per domain value → `02-status-chip.md`
- S3 — `GlobalShell`, `ProjectShell`, mobile Sheet with pending indicator, breadcrumb → `03-shells.md`
- S4 — the hash route table, `NotBuiltYet`, `#/` → `#/inbox`, unknown-hash missing state → `04-routes.md`
- S5 — query option factories + `AsyncBoundary` + the query→state adapter → `05-query-and-async-boundary.md`
- S6 — `FreshnessBar` + the Operations screen as a real query → `06-operations.md`
- S7 — `CommandHandoff` + `DangerConfirm`, minimal contracts, no consumer → `07-handoff-and-danger.md`
- S8 — make `scripts/e2e/ui-system-proof.sh` print `026.1 ok: …` → `08-proof.md`

## Facts (needed for implementation)

Workspace shape (all measured 2026-07-31):

- `ui/package.json` — every version is exact-pinned, no `^`. Already installed and usable: `@tanstack/react-query@5.101.4`, `react-router-dom@7.18.1` (its own nested `react-router@7.18.1`), `lucide-react@1.27.0`, `class-variance-authority@0.7.1`, `radix-ui@1.6.7`, `@xyflow/react@12.11.2`, `vitest@4.1.10`, `@testing-library/react@16.3.2`, `@testing-library/user-event@14.6.1`, `jsdom@30.0.0`, `tailwindcss@4.3.3`. Root `package.json:43` has `playwright@1.62.0`. **Install nothing** (EPIC 026 decision 9); a gap raises an `OPEN:` blocker.
- `ui/vite.config.ts:149-154` — the vitest block: `environment: "jsdom"`, **`globals: false`**, `setupFiles: ["./vitest.setup.ts"]`, `include: ["src/**/*.test.{ts,tsx}"]`. Every test file must import `describe`/`test`/`expect`/`vi` from `"vitest"`.
- `ui/vitest.setup.ts` — only `import "@testing-library/jest-dom/vitest";`. No auto-cleanup; each test file calls `cleanup()` in its own `afterEach`.
- `ui/tsconfig.json` — `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (type-only imports **must** use `import type`), `jsx: "react-jsx"`, alias `@/* → ./src/*`.
- `eslint.config.js:103-153` — the only rule over `ui/**/*.{ts,tsx}` is `no-restricted-imports`: no Node built-in (bare or `node:*`) and no `electron`, **including in test files**. `eslint.config.js:18` ignores `ui/src/components/ui/**`, so every file this epic writes IS linted.
- Prettier (husky + lint-staged) rewrites staged files at commit time — expected.

Existing test conventions to copy exactly:

- Component test: `ui/src/pages/health.test.tsx:3-33` — `import { afterEach, describe, expect, test, vi } from "vitest";`, `import { cleanup, render, screen, waitFor } from "@testing-library/react";`, `test(` not `it(`, SUT imported by **relative** path, libs by `@/` alias, `vi.mock("@/lib/api-client", …)` with `vi.importActual` + `apiGet: vi.fn()`, a local `renderWithQuery(ui)` helper building a fresh `new QueryClient({defaultOptions:{queries:{retry:false}}})`, and `afterEach(() => { cleanup(); vi.clearAllMocks(); })`.
- Module test: `ui/src/lib/api-client.test.ts:13-50` — `vi.spyOn(globalThis, "fetch").mockImplementation(...)` returning a real `Response`, with an explicit `restore()`.

Wire facts the stories depend on:

- **`GET /healthz` IS enveloped**: `{"data":{"status":"ok","version":"<x.y.z>"}}` — `src/apps/http/routes.ts:266-276` + `src/apps/http/app.ts:287-300`. `apiGet<T>` already unwraps `.data` (`ui/src/lib/api-client.ts:79`). `version` is `packageVersion` from the repo's own `package.json` (`src/apps/version.ts:8-12`), currently `27.8.1`.
- `GET /api/project/:id` → `{"data":{"id","name"}}`, exactly two fields (`src/apps/http/views/project.ts:21-23`, route at `routes.ts:318-328`). A missing id answers the standard error envelope; `ApiError.status === 404`.
- **`POST /api/project` → `201` with `{"data":{"id":"<ulid>"}}`** (`routes.ts:548-559`, `views/shared.ts:129-132`). Every JSON route is enveloped; only `kind: "static"` and `204` rows bypass it (`src/apps/http/app.ts:266-300`).
- There is **no SPA fallback**: `index.html` is served for exactly `GET /` (`routes.ts:280-303`), so every in-app route must be a hash route. `GET /nope` → `404 unknown_route` (`app.ts:215-220`).
- Basic auth protects **every** path with no exemption, `/healthz` included (`app.ts:170-178`). The Proof's browser context supplies it via `httpCredentials`; no `ui/` module may ever set `Authorization` (rule R3).
- The epic's `routes.ts` line anchors were ~30 lines low and were corrected on 2026-07-31; the epic and this index now agree.

Design-document anchors (binding, cite these):

- Six roles `neutral · active · attention · blocked · danger · success` — `docs/ui-design.md:281-282`; "Defined once as CSS custom properties in the Tailwind v4 theme block", "the **label and icon** carry the domain specificity" — `docs/ui-design.md:284-286`; "A new state must be added to the token mapping file before any component may render it" — `docs/ui-design.md:298-299`.
- Publication is a label, not a token value; `published@<oid>` — `docs/ui-design.md:294-296`.
- GlobalShell / ProjectShell nav, header slots, mobile Sheet with the pending indicator — `docs/ui-design.md:198-205`.
- AsyncBoundary keeps states distinct; a missing deep-linked item "renders an explicit state and never dumps the operator back to the list" — `docs/ui-design.md:258-261`.
- CommandHandoff is copyable and "say plainly when an action must leave the browser" — `docs/ui-design.md:262-265`.
- Destructive actions take `AlertDialog` weight and "are never a visual sibling of 'keep working'" — `docs/ui-design.md:245-249`.
- `Updated HH:MM` plus a refresh control, "from `FreshnessBar` in the shell header" — `docs/ui-design.md:321-322`.

Gotchas:

- `docs/ui-design.md` supplies **no** props for `StatusChip`, `FreshnessBar` or `DangerConfirm`, and names no per-role meaning. Every prop, role assignment, label, icon and test id these stories need is pinned in the story files below. Do not invent a variant, an option or a prop that is not written there.
- **Tailwind v4 scans source text for class candidates.** Role classes must appear as complete literal strings in `ROLE_CLASS` (S1). Never build a class name by interpolation — `` `text-role-${role}` `` produces no CSS and Proof phase F's siblings will silently lose colour.
- `ui/src/index.css:3-10` already carries a comment reserving the six role tokens for this epic. Replace that comment when S1 adds them.
- `ui/src/components/ui/card.tsx` renders `CardTitle`/`CardDescription` as `<div>`, not headings — `getByRole("heading")` will not match.
- `ui/src/components/ui/sheet.tsx` exports no `SheetPortal`/`SheetOverlay`; `SheetContent` renders its own portal and an accessible "Close" button.
- Playwright's default viewport is 1280×720, so the desktop sidebar (`md:` and up) is what the Proof measures.
