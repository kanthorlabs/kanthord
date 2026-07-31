---
epic: .agent/plan/epics/026-ui-dev-harness.md
opened: 2026-07-31
opener: maintainer
base-ref: 90ebe4de48ee6009dfc323a482da2353c1568c9a
---

# Implementation cycle — 026-ui-dev-harness

Pulled from EPIC: `.agent/plan/epics/026-ui-dev-harness.md`.

**Not a `/work` cycle.** EPIC 026 declares itself a maintainer epic (its lines
15–18): it edits `package.json`, `tsconfig*.json`, `*.config.*` and
`scripts/lane-check.sh`, all lane-forbidden to both TDD roles. `/work` was
started for `026` and refused before dispatching, for three reasons: the epic
says so, `scripts/lane-check.sh` would abort the first engineer turn, and `ui/**`
was forbidden to both roles until S1 — the change that opens the lane — landed.
No agent can bootstrap its own lane. Executed directly by Ulrich + Aelita in one
session, per the AGENTS.md rule.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify` — after S1 that means backend typecheck + backend tests
> under the explicit `src` glob + `verify:handoff` + backend lint + UI typecheck +
> UI lint + UI tests + UI build + `db status`.
>
> Proof: `scripts/e2e/ui-shell-proof.sh` must print `026 ok: …`.

## Result

- `npm run verify` — exit 0. Backend: tests 3219, pass 3219, fail 0. UI: 2 test
  files, 14 tests passed. Both typechecks clean, `eslint .` clean, `build:ui`
  green, `db status` reports `journal_mode: wal`.
- `scripts/e2e/ui-shell-proof.sh` — prints
  `026 ok: guards workspace-aware, Vite build served from /assets/index-o3mnBGfu.js with immutable+304, /nope still 404, proxied POST /api/project 201 (Host preserved) and 403 when rewritten`.
  Phases A–E all ran. Phase D is the load-bearing one: an unauthenticated
  `POST /api/project` **through the Vite proxy** answered `201` with a `Location`
  header, and the same POST with a rewritten Host answered
  `403 origin_not_allowed` — decision 4 proved over the wire with a write, not a
  GET.
- `npm run dev` was exercised outside the Proof: proxied `GET /healthz` returned
  the CLI version and proxied `POST /api/project` returned `201`, with no
  `Authorization` header sent from the browser side.

## Stories

- **S1** — `workspaces: ["ui"]`; `test` → `node --test "src/**/*.test.ts"`; new
  `dev` / `serve` / `build:ui` / `ui:typecheck` / `ui:lint` / `ui:test` scripts;
  `lint-staged` gained `tsx` and `css`; `verify` gained the four UI steps.
  `eslint.config.js` gained the `ui/**/*.{ts,tsx}` block carrying R4, with
  `ui/vite.config.ts` and `ui/vitest.setup.ts` exempt as the Node side.
  `scripts/lane-check.sh` grants `ui/**/*.test.{ts,tsx}` to the test-engineer and
  the rest of `ui/**` to the software-engineer. `scripts/dev.mjs` runs the daemon
  and Vite together; either child exiting takes the run down.
- **S2** — the `ui/` workspace: `package.json`, one `tsconfig.json`,
  `vite.config.ts`, `components.json`, `index.html` with the R5 CSP,
  `src/index.css`, the full decision-9 dependency set, all 22 shadcn components,
  and root `playwright`. Three PWA icons and a favicon were generated (a plain
  zlib PNG/ICO writer, no image dependency) into `ui/public`.
- **S3** — `ui/src/lib/runtime.ts` and `ui/src/lib/api-client.ts` with 11 Vitest
  tests, plus the `createHashRouter` shell holding one page.
- **S4** — `ui/src/pages/health.tsx` reads `/healthz` through the client and
  renders the version in a `Card`, with three jsdom render tests.
- **S5** — `src/apps/http/static.ts` over `@koa/send` behind an injected dist
  root, with 13 unit tests against a temp dist root.
- **S6** — six static rows; `ui.ts`, `UI_SHELL_HTML` and the `ui.get` row
  deleted; `ui.test.ts` replaced with a wiring test; the `/nope` pins in
  `app.test.ts` and `router.test.ts` still green; `KANTHORD_UI_DIST` resolved in
  `composition.ts` and threaded through `CliDeps` → `serve` → `buildHttpApp`.
- **S7** — the Proof, green.

## Decisions taken at build time (none deviate silently)

1. **Six pinned versions moved, with Ulrich's explicit approval.** The repo's
   `.npmrc` sets `min-release-age=3`, so npm cannot resolve a version published
   in the last three days — six of decision 9's pins were 0.3–2.0 days old and
   resolved as `vite@undefined`. Ulrich chose "newest version at least 3 days
   old" over bypassing the supply-chain guard: `vite 8.1.5`,
   `@vitejs/plugin-react 6.0.4`, `jsdom 30.0.0`, `react-router-dom 7.18.1`,
   `lucide-react 1.27.0`, `playwright 1.62.0` (the epic's own original pin).
   `@types/react 19.2.17` and `@types/react-dom 19.2.3` likewise; the epic names
   neither. **Decision 9's version list in the epic text is therefore stale.**
   The whole root `package-lock.json` was regenerated: arborist could not add the
   workspace to the old lockfile even with `node_modules` removed.
2. **`kind: "html"` was removed from `RouteMeta`, not left unused.**
   `RouteMeta.kind` is now `"json" | "static"`. `ui.get` was the only html row,
   so the dispatcher branch became an orphan of this change. `routes.test.ts`
   asserts no row may declare `"html"`.
3. **`HEAD` now matches the `GET` row of the same path.** The Proof requires
   `HEAD /assets/:file` to agree with `GET`; the matcher answered
   `405 method_not_allowed`, because rows declare only `GET`. `router.ts` maps a
   `HEAD` request to `GET` for matching and koa suppresses the body. No row
   declares `HEAD` — that would double the table and let the two answers drift.
   This applies to every `GET` row alike, which is what HTTP requires. Three
   router tests pin it.
4. **The dev server gets a relaxed CSP; the artifact does not.** R5's strict
   policy lives in `ui/index.html` and is exactly what `build:ui` ships (Proof
   phase B asserts it). An `apply: "serve"` plugin adds `'unsafe-inline'` and
   `'unsafe-eval'` to `script-src` for `vite dev` only, because
   `@vitejs/plugin-react` injects an inline module preamble — confirmed present
   in the dev-served HTML, so the relaxation is load-bearing, not precautionary.
   R5's letter ("CSP in `ui/index.html`") is honoured.
5. **`HttpAppOptions.uiDistRoot` is optional.** The Gate requires a test proving
   `buildHttpApp` constructs and `/healthz` answers with `ui/dist` absent, and
   `ui/dist` is gitignored, so construction must not depend on a prior build. An
   absent option, an absent directory and a missing file all answer the same
   `404 unknown_route`. Making it required would also have meant editing 96 test
   call sites for no behavioural gain.
6. **The workbox runtime is inlined into `sw.js`.** Left external, workbox emits
   a second hashed file at the dist root, which would need a seventh route row —
   the matcher has no wildcard and the epic's row list is exactly six. Service
   worker registration is called from `src/main.tsx` via `virtual:pwa-register`
   (`injectRegister: null`) for the same reason: an injected inline script would
   violate R5, and a `registerSW.js` file would need its own row.
7. **Phase A3b was added to the Proof.** The Gate requires that `eslint .`
   _report_ the R4 violation in a fixture importing `node:fs`; the script only
   printed the config, which proves wiring and not enforcement. A3b writes a
   fixture inside the repo, asserts `eslint .` names it and the rule, asserts the
   tree is clean once removed, and the fixture is deleted on every exit path.
   Strengthens the Proof; weakens nothing.
8. **The six operator-role tokens were NOT added to `ui/src/index.css`.** 026
   ships one health card and no status surface, so the first epic that renders a
   status (026.1) adds them. `ui/src/index.css` is software-engineer-writable, so
   this needs no maintainer session.

## Risk carried forward

**`react-router-dom@7.18.1` matches a high-severity advisory**, GHSA-qwww-vcr4-c8h2
("React Router: RSC Mode CSRF Bypass"), affected range `>=7.12.0 <8.3.0`. The
advisory is against React Router's RSC **server** mode. This UI is a client-only
SPA using `createHashRouter`, and EPIC 026 lists "No server-side rendering" as a
non-goal, so the vulnerable code path does not exist here. The only clean fixes
are `8.3.0+` (a major step) or `7.11.0` (a downgrade below the epic's pin).
Reported to Ulrich, who accepted the pin. Revisit when React Router 8 is chosen.

## Consequence for the epics that follow

S1 opened the lane: `ui/**` now belongs to the TDD roles, and 026 installed the
whole dependency and component set for 026.1–026.8. **EPIC 026.1 onward is normal
`/work`.** Root `package.json`, `package-lock.json`, `ui/package.json`,
`ui/tsconfig*.json`, `components.json` and every `*.config.*` stay
maintainer-only, so a screen epic that needs a new package raises an `OPEN:`
blocker instead of installing one.

HUMAN_REVIEW: PASS
