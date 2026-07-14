# web-gotchas — kanthord Web variant (clients/web)

Shared pitfalls for the `web` TDD variant. Append as you hit new ones.
Seeded at the Epic 020 SU7 bootstrap.

## Tailwind v4 (NOT v3 — the big one, HD-B)

- **CSS-first config.** There is **no `tailwind.config.js`** and no
  `content: [...]` array. Theme lives in `clients/web/src/styles/globals.css`
  via `@import "tailwindcss";` + `@theme` / CSS variables. Do **not** create a
  `tailwind.config.js` or a `postcss.config.js` — the `@tailwindcss/vite` plugin
  handles it (adding those files is a lane-forbidden config change anyway).
- **No `@tailwind base/components/utilities;`** directives (that's v3). It's a
  single `@import "tailwindcss";`.
- Dark mode is a **`.dark` class flip** via `@custom-variant dark (&:is(.dark *))`
  already defined in globals.css — do not add a `darkMode` config key.
- Colours are **oklch** semantic tokens. Style with semantic utilities only
  (`bg-background`, `text-muted-foreground`, `border-border`, `bg-destructive`).
  Raw palette classes (`bg-red-500`), hex/rgb literals, `style={{color:…}}`, and
  `bg-[#…]` arbitrary colours are **review blockers** (DESIGN §3).

## shadcn / primitives

- `clients/web/src/components/ui/**` is **vendored + lane-forbidden** (HD-A). Need
  a new primitive or a token/variant change? That's DESIGN §P2 (maintainer runs
  the shadcn CLI) — never hand-roll a clone, never edit a `ui/` file in a story.
- **The vendored file is the API reference** — read the actual props from
  `clients/web/src/components/ui/<x>.tsx`, do not guess a shadcn prop from memory.
- Variants use `cva` + `cn()` from `@/lib/utils`. No ad-hoc `className` string
  concatenation.
- The sidebar's mobile behavior is built in (off-canvas via `sheet`) — never
  hand-roll a drawer (DESIGN §6). `AppShell` wraps children; `TooltipProvider`
  and `SidebarProvider` must wrap the tree that uses those primitives.

## Connect-Web client

- Import the generated service from `@/gen/kanthord/v1/daemon_pb.ts` — that dir is
  **generated + lane-forbidden**; the maintainer re-gens via `npm run
  generate:proto` on a schema change, never edit it by hand.
- protobuf-es v2: `createClient(DaemonService, transport)` from
  `@connectrpc/connect`; transport from `@connectrpc/connect-web`
  (`createConnectTransport`). Use `@/lib/client.ts`'s `createDaemonClient`.
- **int64 fields are `bigint`** on the wire (e.g. `uptime_seconds`,
  `generation`). Render with `String(x)` / `Number(x)`; never assume `number`.
- Unit/component tests are **hermetic**: fake the client (a plain object typed as
  the `DaemonClient`), never hit a real daemon or the network.

## Vitest / Testing Library

- Component tests: `*.test.tsx` under `clients/web/src/**`; run `npm run test:web`
  (never `node --test` — that's the core variant). jsdom env + `@testing-library`
  are wired in `vitest.setup.ts` (auto-cleanup between tests).
- Query by the **locator registry** (`clients/web/src/locators.ts`, SE-owned) —
  put `data-testid`/roles there, don't scatter raw strings across tests (DESIGN §8).

## E2E (Playwright)

- Story-gated only (`npm run e2e:web`), chromium, **light theme only** (HD-C),
  desktop + the **iPhone 13 (390×844)** gate viewport (DESIGN §6).
- The TLS origin is served by `scripts/web-e2e-preflight.mjs` (self-signed SU5
  cert) — Playwright needs `ignoreHTTPSErrors`. A preflight failure is an
  ENVIRONMENT failure, never a story failure.
