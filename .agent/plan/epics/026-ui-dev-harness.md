# EPIC 026 — UI dev harness: shadcn + Vite workspace, served build, dual-mode prep

> Authored 2026-07-30. Design went through the debate engine (`pi`, read-only);
> six findings changed the shape and are marked **[debate]** inline. The four
> conflicts the debate surfaced were put to Ulrich and are settled in
> "Decisions" below — do not re-open them at build time.
>
> **Order changed 2026-07-30 (Ulrich):** the earlier call "API prerequisites
> first, harness after" is reversed. Execution order is 026 → 026.1 → 026.2 →
> 026.3 → … → 026.7: this harness, then the screen epics, then **EPIC 026.8**,
> which adds the missing API routes and wires them into the screens.
> Number order is execution order. See `docs/ui-design.md` § "Consequence: what
> the first UI product is".
>
> This is a **maintainer epic** by the AGENTS.md rule: it edits `package.json`,
> `tsconfig*.json`, `*.config.*` and `scripts/lane-check.sh`, all lane-forbidden
> to both TDD roles. Story S1 exists precisely so that every LATER dashboard
> epic is normal `/work`.

## Goal

A React + shadcn/ui + Tailwind v4 dashboard workspace lives at `ui/`, outside
the Node-only `src/` tree. `npm run dev` starts the daemon and the Vite dev
server together; the Vite proxy forwards `/api`, `/healthz` and `/events` to the
daemon with the `Authorization` header injected server-side, so writes work and
the API key never reaches browser code. `npm run build:ui` produces `ui/dist`,
and `kanthord serve` serves that build — index, hashed assets, service worker,
manifest and icons — through the existing route table, with unknown paths still
answering `404 unknown_route`. The UI is written under six rules that make the
two later deployment modes (web app in a container, Electron desktop) packaging
work rather than redesign.

## Verified facts (measured on this tree, 2026-07-30 — do not re-litigate)

- Root `tsconfig.json` is Node-only: `include: ["src/**/*.ts"]`,
  `lib: ["esnext"]`, `types: ["node"]`, `module: nodenext`,
  `verbatimModuleSyntax: true`. No DOM lib, no JSX.
- **Bare `node --test` discovers tests outside `src/`.** Measured in a scratch
  tree on Node v24.17.0: a file at `ui/src/components/x.test.ts` was executed.
  `node --test "src/**/*.test.ts"` ran the `src` tests (including
  `src/apps/http/deep.test.ts`) and did NOT run the `ui` one. `--test-glob=` is
  not a valid Node flag; `node --test src/` errors. **[debate]**
- `eslint.config.js` has one typed block, `files: ["src/**/*.ts"]`. Nothing
  configures `ui/**/*.tsx`, so under flat config those files are simply not
  linted. **[debate]**
- `lint-staged` covers `ts,js,mjs,json,md,yml,yaml` — **not** `tsx` or `css`.
- `scripts/lane-check.sh` allows `src/*.ts` (software-engineer), `src/*.test.ts`
  (test-engineer) and `scripts/*`. **`ui/**` is forbidden to both roles.**
  **[debate]**
- `src/apps/http/server.ts:20` binds `127.0.0.1` unconditionally.
- `src/apps/http/app.ts:161` rejects any `Host` whose hostname is neither
  `127.0.0.1` nor `localhost` → `403 host_not_allowed`.
- `src/apps/http/app.ts:186` is the CSRF gate:
  `serverOrigin = ${ctx.protocol}://${ctx.host}` — derived from the **Host
  header** — and an unsafe method with a mismatching `Origin` is
  `403 origin_not_allowed`. This is what pins decision 4. **[debate]**
- `src/apps/http/ui.test.ts:16` asserts `!UI_SHELL_HTML.includes("<script src")`.
  A Vite build emits exactly that tag, so this test MUST be replaced, not
  worked around. **[debate]**
- `src/apps/http/app.test.ts:179` and `router.test.ts:50` pin
  `GET /nope` → `404 unknown_route`. **[debate]**
- `router.ts` `matchSegments` requires equal segment counts and supports literal
  and `:param` segments only. No wildcard. Vite's default output is a single
  level (`dist/assets/<name>-<hash>.js`), so `/assets/:file` is sufficient.
- Registry versions (`npm view`, 2026-07-30): `vite@8.2.0`,
  `@vitejs/plugin-react@6.0.5` (peer `vite ^8`), `tailwindcss@4.3.3` +
  `@tailwindcss/vite@4.3.3` (peer allows `^8`), `vite-plugin-pwa@1.3.0` (peer
  allows `^8`), `@koa/send@6.0.0` (ships its own `.d.ts`, 2 deps,
  published 2024-10-12). `@koa/static` does not exist; `koa-static@5.0.0` is
  stale (2023) and untyped.
- shadcn/ui's official Vite path: Tailwind v4 via `@tailwindcss/vite`, `@/*`
  alias in tsconfig + `resolve.alias`, `shadcn init`, `shadcn add`. Components
  are **copied into the repo** — they are source, not a dependency.

## Decisions (binding; settled with Ulrich 2026-07-30)

1. **`ui/` is an npm workspace outside `src/`.** Root `package.json` gains
   `"workspaces": ["ui"]`. Rationale, stated honestly after the debate: this is
   a **source and compiler boundary, not isolation**. Dependencies still hoist,
   the lockfile is still shared, and root test/lint/format still traverse `ui/`
   until S1 makes them workspace-aware. **[debate]**
2. **The daemon serves the build with `@koa/send`**, called from our own route
   rows. This is a maintainer decision that **supersedes EPIC 019 decision 1's
   `koa-static` ban** for this one package. `@koa/send` is a function
   (`send(ctx, path, opts)`), not a routing middleware, so `ROUTES` stays the
   single routing authority — the debate's "two routing authorities" objection
   does not apply. `@koa/send` owns MIME, `ETag`/`304`, `HEAD`, ranges and
   traversal rejection; we own which paths exist, the cache policy and the 404
   policy.
3. **Hash routing.** `createHashRouter`. The server therefore needs no SPA
   fallback and no wildcard in the matcher, and `GET /nope` keeps its pinned
   `404 unknown_route`. Accepted cost: a permanent `/#/` in every URL.
4. **The dev proxy must NOT rewrite `Host`.** `changeOrigin: false` (Vite's
   default) and no Host override. Then `Host` stays `localhost:<vitePort>`,
   which passes the Host allowlist, and `serverOrigin` equals the browser's
   `Origin`, which passes the CSRF gate. `changeOrigin: true` breaks every
   POST/PATCH/DELETE with `403 origin_not_allowed`. Proved over the wire in
   Proof phase D, with a **write**, not a GET. **[debate]**
5. **Real PWA, and Basic auth stays on every path** — Ulrich's explicit call
   after Aelita flagged the collision. Consequences accepted and recorded, not
   designed around: the service worker is fetched under the Basic challenge so
   the browser MAY refuse to register it or refuse the install prompt; a cached
   shell cannot re-authenticate; the native dialog is the login UX. The Proof
   **records the observed behaviour of `/sw.js` and `/manifest.webmanifest`
   under auth** instead of asserting a registration that curl cannot see.
   A login form and token auth are a separate, later epic.
6. **Electron reaches the daemon at the daemon's own origin.**
   `win.loadURL("http://127.0.0.1:<port>")`, served by the same rows as web
   mode. Same-origin, so no CORS change, no CSRF change, no custom protocol, no
   `connect-src` juggling. **The renderer never receives the API key**: the main
   process injects `Authorization` via
   `session.defaultSession.webRequest.onBeforeSendHeaders`. An `app://` origin
   was rejected because it fails both the CORS allowlist and the CSRF gate at
   `app.ts:186`. **[debate]** Packaging itself is a later epic; only the six
   rules below land here.
7. **`npm run verify` runs the full UI pipeline** — typecheck, lint, test and
   build — Ulrich's call over the cheaper no-build option.
8. **`ui/**` becomes TDD-role territory.** `lane-check.sh` grants
   `ui/**/*.test.{ts,tsx}` to the test-engineer and the rest of `ui/**` to the
   software-engineer, while root `package.json`, the lockfile and `*.config.*`
   stay maintainer-only. Without this, every future screen would be
   maintainer-only forever. **[debate]**
9. **This epic installs the WHOLE UI dependency set, for every epic through
   026.8** — Ulrich, 2026-07-30, after the 026.1 debate found the hole. The
   lockfile is maintainer-only under decision 8, so a normal `/work` screen
   epic cannot add a package. Installing here is what makes 026.1–026.8 run
   unattended. Versions measured on the registry 2026-07-30:
   - runtime: `react@19.2.8`, `react-dom@19.2.8`, `react-router-dom@7.18.2`,
     `@tanstack/react-query@5.101.4`, `@xyflow/react@12.11.2`,
     `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`,
     `lucide-react@1.28.0`
   - build: `vite@8.2.0`, `@vitejs/plugin-react@6.0.5`, `tailwindcss@4.3.3`,
     `@tailwindcss/vite@4.3.3`, `vite-plugin-pwa@1.3.0`
   - test: `vitest@4.1.10` (peer allows `vite ^8`), `jsdom@30.0.1`,
     `@testing-library/react@16.3.2` (peer allows React 19),
     `@testing-library/user-event@14.6.1`, `@testing-library/jest-dom@7.0.0`
   - root devDependency for the Proofs: `playwright@1.62.0` (decision 10)

   **`shadcn add` also runs here for the full component set**, because it
   installs Radix packages: `button`, `card`, `table`, `tabs`, `sheet`,
   `dialog`, `alert-dialog`, `dropdown-menu`, `breadcrumb`, `badge`, `input`,
   `label`, `select`, `separator`, `skeleton`, `tooltip`, `command`,
   `popover`, `scroll-area`, `textarea`, `checkbox`, `sonner`. A later epic
   that needs a component or package not on these lists raises an `OPEN:`
   blocker; it never installs. Accepted cost, stated plainly: 026 ships
   dependencies and copied component source before their first consumer exists.

10. **The UI program Proof is a real browser** — Ulrich, 2026-07-30, over a
    jsdom loader and over a relaxed definition of "program proof". The debate
    proved the jsdom option cannot work: jsdom does not execute
    `<script type="module">`, and a Vite build emits exactly that, so a jsdom
    proof would load the served page, run nothing, and assert against an empty
    `#root`. From 026.1 on, a UI Proof starts the real daemon, opens the real
    served build in Playwright's pinned Chromium, drives hash routes and asserts
    rendered DOM. **The Proof itself makes no network request beyond loopback**:
    the browser is installed at environment setup, and a proof that cannot find
    it fails with the exact install command. 026 installs the `playwright`
    package and documents the browser install; the shared browser helper under
    `scripts/e2e/` lands in 026.1, its first consumer. **[debate]**

### The six Electron/dual-mode rules (binding on all `ui/` code)

- **R1 `base: "./"`** in `vite.config.ts` — relative asset URLs. Note this does
  NOT solve the API base; that is R3's job. **[debate]**
- **R2 Hash routing** (decision 3), so no mode needs server rewrites.
- **R3 One transport seam.** `ui/src/lib/runtime.ts` exports `apiBaseUrl`,
  resolved as `globalThis.kanthord?.apiBaseUrl ?? ""` (empty = same origin).
  `ui/src/lib/api-client.ts` is the ONLY module that calls `fetch`. No auth
  header ever appears in `ui/` source in any mode.
- **R4 No Node or Electron imports in `ui/`** — enforced by an
  `no-restricted-imports` rule covering `electron`, `electron/*`, `node:*` and
  the bare built-in names, in the new `ui` eslint block (prose alone was the
  debate's objection). **[debate]**
- **R5 CSP** in `ui/index.html`: `default-src 'self'`, and `connect-src 'self'`
  only — decision 6 makes the API same-origin, so no host list is needed.
- **R6 Runtime config is initialized before any API call**; no browser global is
  read at module scope in `ui/src/lib/*`. Narrowed from the original blanket
  rule after the debate. **[debate]**

### Contract with the Proof (binding names)

The Proof script is already written and already failing, so these names are
fixed — the implementation must use exactly these, not equivalents:

- **`KANTHORD_UI_DIST`** — absolute path to the built UI directory, read by
  `composition.ts` and injected into the static adapter. It defaults to
  `<packageRoot>/ui/dist` and is NEVER resolved from `process.cwd()`, because
  `serve` runs from an isolated working directory in every proof. An absent or
  unbuilt directory must not fail app construction (see the Gate).
- **`KANTHORD_API_TARGET`** — the daemon origin the Vite proxy forwards to, read
  in `ui/vite.config.ts` (Node side only). `API_KEY` is read there too, and in
  that file only: never in `define`, never in `import.meta.env`, never in any
  module that ships to the browser.
- The service worker must be emitted as **`/sw.js`** at the dist root, and the
  manifest as **`/manifest.webmanifest`**, so their route rows are literal
  segments and the SW scope covers the whole app.

## Verification Gate

Gates: `npm run verify` — after S1 that means backend typecheck + backend tests
under the explicit `src` glob + `verify:handoff` + backend lint + UI typecheck +
UI lint + UI tests + UI build + `db status`.

Hermetic coverage required beyond the Proof:

- **`src/apps/http/static.ts`** unit tests with a temp dist root: a hashed asset
  gets `Cache-Control: public, max-age=31536000, immutable`; `index.html`,
  `sw.js` and `manifest.webmanifest` get `no-cache`; `HEAD` returns the headers
  with no body; a conditional request with the returned `ETag` is `304`; a
  missing file is `404 unknown_route` (never a 500, never a stack trace);
  `../` and `%2e%2e%2f` in `:file` are rejected; the served MIME types for
  `.js`, `.css`, `.html`, `.webmanifest`, `.svg`, `.png`, `.woff2` are asserted.
- **The dist root is injected**, not discovered at import time. A test proves
  `buildHttpApp` constructs and `/healthz` answers **with `ui/dist` absent** —
  `dist` is gitignored, so every backend test run would otherwise depend on a
  prior UI build. **[debate]**
- **`src/apps/http/ui.test.ts` is replaced, not deleted silently:** the new
  tests assert the served document IS the built `index.html` from the injected
  root, and the old `UI_SHELL_HTML` constant and its `no <script src>`
  assertion are gone along with the `ui.get` inline row.
- **The 404 policy is re-pinned:** `app.test.ts`'s `/nope` → `404
unknown_route` and `router.test.ts`'s `not_found` both still pass **unchanged**
  after static serving lands. Decision 3 is what makes that possible; a
  regression here means someone added a fallback.
- **Route-policy tests still pass** over the new rows: no verb in any path, no
  plural segment (`assets`, `icons` go in `NOT_PLURAL`), and the
  `cli-coverage.test.ts` inventory is unchanged (UI rows claim no CLI leaf).
- **UI workspace tests** (`ui/`, Vitest + jsdom): `api-client.ts` builds request
  URLs from `runtime.apiBaseUrl` for both `""` and an injected base, and sets no
  `Authorization` header in either case (R3); the health card renders the
  version string from a stubbed client, which is the DOM proof curl cannot give.
- **Guard tests are self-proving:** S1 is verified by running the commands, not
  by reading them — `npm test` must not execute a deliberately added
  `ui/**/*.test.ts`, and `eslint .` must report the R4 violation in a fixture
  file that imports `node:fs`.

Proof: `scripts/e2e/ui-shell-proof.sh` — deterministic, no model, no outbound
network (loopback only), no server and no dev server left running. Run from the
repo root:

```bash
scripts/e2e/ui-shell-proof.sh
```

It must print `026 ok: …`. Phases:

- **A** — guards: `npm test` does not run a UI test file; the `src` glob does run
  a nested backend one; `eslint .` covers `ui/**/*.tsx`.
- **B** — `npm run build:ui` produces `ui/dist/index.html` with a
  `<script type="module" src=...>` tag and a hashed asset under `dist/assets/`.
- **C** — the daemon serves that build: authenticated `GET /` returns the built
  index; the asset URL is **extracted from the served HTML**, never guessed, and
  returns `200` with the immutable cache header; `HEAD` on it agrees; a bogus
  `ETag` gets `200` and the real one gets `304`; `/sw.js` and
  `/manifest.webmanifest` are served `no-cache`; `GET /nope` is still
  `404 unknown_route`; traversal is rejected; no `Authorization`-free request
  succeeds and the key appears in no body and no log line.
- **D** — the dev loop, the load-bearing phase: the Vite dev server starts on a
  fixed free port, an unauthenticated `POST /api/project` **through the proxy**
  returns `201` with a `Location` header, and `GET /healthz` through the proxy
  returns the CLI's version. This is what proves decision 4; the same POST with
  a `changeOrigin`-style rewritten Host is asserted to be
  `403 origin_not_allowed` so the failure mode is pinned, not folklore.
- **E** — recorded, not asserted: the observed status and headers of `/sw.js`,
  `/manifest.webmanifest` and the install icons under Basic auth, printed for
  the record per decision 5.

Ran against the CURRENT tree (2026-07-30, commit `3db820d`): see the "expected
failure" note at the top of the script — it exits `1` in phase A, because `ui/`
does not exist and `npm run build:ui` is not a script yet.

## Stories

- **S1 — guard rewiring (maintainer, no UI code yet).** Root `package.json`:
  `workspaces: ["ui"]`, `test` → `node --test "src/**/*.test.ts"`, new
  `dev` / `serve` / `build:ui` / `ui:*` scripts, `lint-staged` gains `tsx` and
  `css`, `verify` gains the four UI steps (decision 7). `eslint.config.js` gains
  a `ui/**/*.{ts,tsx}` block carrying R4. `lane-check.sh` gains decision 8.
  Verified by running the commands, per the Gate.
- **S2 — the `ui/` workspace.** `ui/package.json`, `ui/tsconfig*.json` with the
  `@/*` alias, `ui/vite.config.ts` (React + Tailwind v4 + `base: "./"` + the
  proxy of decision 4 + `vite-plugin-pwa` with a root-scope `sw.js`),
  `components.json`, `ui/index.html` with R5's CSP, Tailwind entry CSS, **the
  full dependency set and the full shadcn component set of decision 9**, and
  root `playwright` per decision 10. No screens.
- **S3 — the transport seam.** `ui/src/lib/runtime.ts` and
  `ui/src/lib/api-client.ts` (R3, R6) with their Vitest tests, plus the hash
  router shell (R2) holding one page.
- **S4 — the health card.** One page that reads `/healthz` through the client
  and renders the version in a `Card`, replacing what `UI_SHELL_HTML` did, with
  the jsdom render test.
- **S5 — `src/apps/http/static.ts`.** `@koa/send` behind an injected dist root,
  the cache-policy split, and the unit tests named in the Gate.
- **S6 — route rows + retirement of the inline shell.** Rows for `/`,
  `/assets/:file`, `/sw.js`, `/manifest.webmanifest`, `/icons/:file`,
  `/favicon.ico`; delete `ui.ts`, `UI_SHELL_HTML` and the `ui.get` row; replace
  `ui.test.ts`; keep the `/nope` pins green; wire the dist root through
  `composition.ts`.
- **S7 — the Proof.** `scripts/e2e/ui-shell-proof.sh` (already written, already
  failing for the right reason) must print `026 ok: …`.

## Non-goals

- **No dashboard screens.** No Control Center, no inbox, no queue, no review.
  This epic ends at one health card. The screens are epics 026.1–026.7, and they
  are normal `/work` because S1 opened the lane.
- **No new API routes.** Every gap the screens hit is EPIC 026.8's scope. A
  screen epic ships the blocked control disabled; it never adds a route.
- **No Electron packaging.** No `electron/` directory, no Forge, no installer.
  Only the six rules land. Decision 6 fixes the approach so the later epic is
  packaging work.
- **No container or VPS deployment.** Deliberately excluded and NOT a packaging
  detail: the hard `127.0.0.1` bind at `server.ts:20`, the Host allowlist at
  `app.ts:161`, forwarded proto/host handling, a trusted-proxy policy and a
  public-origin policy for the CSRF gate are four real backend changes. They get
  their own epic. **[debate]**
- **No token auth or login form.** Decision 5 keeps Basic auth everywhere and
  accepts the PWA consequences; JWT stays deferred.
- **No `koa-static`, no wildcard in the matcher, no SPA fallback.**
- **No server-side rendering**, so R6 stays the narrow rule it is.
