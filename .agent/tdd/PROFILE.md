# Project Profile — kanthord (TDD pipeline)

Filled from the skeleton at `../../dotagents/tdd`. Renders the four-role TDD
pipeline for **kanthord**: two variants — `core` (the Node 24 / TypeScript
daemon) and `web` (the control-plane dashboard SPA, Epic 027; added per Epic
020 SU7 decision (b), debate-hardened 2026-07-02). The `web` variant is
**bootstrap-gated**: no web story may dispatch until the SU7 maintainer
bootstrap (scaffold + hello-world through the full pipeline) has passed.

> render.py constraint honored throughout: slot bodies use `####` sub-headings
> only and contain no `---` rule lines (a bare `---` or `## `/`### ` line ends a
> slot body early). The token table below is strictly two columns.

## 1. Path & constant tokens

| Token | Value |
|---|---|
| `{{REPO_NAME}}` | `kanthord` |
| `{{PLAN_EPICS_DIR}}` | `.agent/plan/epics/` |
| `{{PLAN_STORIES_DIR}}` | `.agent/plan/stories/` |
| `{{PLAN_FEEDBACK_DIR}}` | `.agent/plan/feedback/` |
| `{{DISCUSSION_DIR}}` | `.agent/tdd/history/` |
| `{{DRAFT_DIR}}` | `.agent/tdd/` |
| `{{MEMORY_DIR}}` | `.agent/tdd/memory/` |
| `{{AGENT_DIR}}` | `.claude/agents/` |
| `{{DEFAULT_TURN_CAP}}` | `128` |
| `{{ATTEMPT_LIMIT}}` | `3` |
| `{{LOCATOR_DEFN_LABEL}}` | `UI locators (web variant: the SE-owned locator registry clients/web/src/locators.ts)` |
| `{{ENV_HANDOFF_LABEL}}` | `Pre-flight resource` |

## 2. Slots

### `{{> VARIANT_VALUES}}`
core, web

### `{{> GATE_LABEL_EXAMPLES}}`
`core typecheck` (npm run typecheck) and `core unit` (npm test); `web typecheck` (npm run typecheck:web) and `web unit` (npm run test:web) — each exit 0. `web e2e` (npm run e2e:web) is story-gated: it runs only when a Story's Verify names it, and in the Epic 027 gate run — never as a default join gate (debate finding: full E2E on every join would make the shared pipeline too slow to use).

### `{{> JOIN_GATE_TARGETS}}`
Both variants, cheap gates only: `core` (npm run typecheck, npm test) then `web` (npm run typecheck:web, npm run test:web). Variant path sets are disjoint at the source level (`src/` vs `clients/web/`), so --join merges worktrees without a shared-file policy; the one shared input — the proto schema and its generated clients (server + web) — is maintainer-regenerated, lane-forbidden, and committed, so it can never appear in an engineer's diff (debate finding: the generated client is the non-disjoint edge, owned explicitly).

### `{{> TE_FRONTMATTER}}`
description: "TDD test-engineer for kanthord (core + web) — writes the failing test (node:test for core, Vitest/Playwright for web) (RED), confirms GREEN, signals ready. Never touches production code."
model: sonnet

### `{{> SE_FRONTMATTER}}`
description: "TDD software-engineer for kanthord (core + web) — makes the failing test pass (GREEN) plus the named REFACTOR. Never writes or runs tests."
model: sonnet

### `{{> RV_FRONTMATTER}}`
description: "TDD reviewer-engineer for kanthord (core + web) — read-only review against cited sources, blocker/suggestion verdict. Never edits or runs anything."
model: opus
tools: Read, Grep, Glob

### `{{> PROJECT_CONTEXT}}`
**kanthord Core** (`core`) is one long-running daemon written in **Node.js
24+ / TypeScript** (ES modules, `"type": "module"`, engines `node >= 24`).
Core tests run on the built-in **`node:test`** runner with `node:assert` — no
test framework dependency in core.

**kanthord Web** (`web`) is the control-plane dashboard SPA (Epic 027) under
`clients/web/` — a pure client of the Epic 026 Connect API with **no server logic**.
Stack (SU7 decision, validated by the bootstrap hello-world; a failed demo
re-opens the choice via decision record): Vite + TypeScript + React,
`@connectrpc/connect-web` over the maintainer-generated client, **Vitest** +
Testing Library for unit/component tests, **Playwright** for the thin E2E
suite. UI composition uses **shadcn/ui** — vendored primitives on Tailwind v4
semantic tokens — governed by the repo-root **`DESIGN.md`**, the design
implementation contract for every web surface (design-system amendment
2026-07-03 in the SU7 decision record). The two variants deliberately use
different test runners; every lane rule and command below is variant-scoped.

### `{{> VARIANTS_AND_SCOPES}}`
**Two variants: `core` and `web`.** The macOS/iOS Swift app and the CLI remain
pure visualization over the same gRPC schema and still ship from separate
bakes (the Swift app is a different language and gets its own pipeline later);
the Web SPA joined this pipeline per the Epic 020 SU7 decision.

- **`core`** — owns `src/`. Build target: the TypeScript program type-checked
  by `tsc` and exercised by `node --test`. No dependency on any other variant.
- **`web`** — owns `clients/web/` (source `clients/web/src/**`, unit/component tests
  `clients/web/src/**/*.test.ts` and `*.test.tsx`, E2E `clients/web/e2e/**`). Build target: the
  Vite production bundle, type-checked by `tsc` and exercised by Vitest (+
  Playwright where a Story names it). Depends on core **only** through the
  maintainer-generated Connect-Web client (committed generated code; when the
  Epic 026 schema changes, the maintainer re-generates — the client is never an
  engineer edit).

Source path sets are disjoint (`src/` vs `clients/web/`); `--variant web` runs in an
isolated worktree; `--join` runs both variants' cheap gates (typecheck + unit)
and needs no shared-file merge policy — the only shared inputs (proto schema,
generated clients, root package config) are lane-forbidden to every engineer
role.

**Web bootstrap gate (hard precondition, debate finding):** before the first
web story dispatches, the maintainer bootstrap must have landed and passed:
`clients/web/` scaffold + toolchain deps + configs, the generated Connect-Web client,
the design foundation (Tailwind v4 + shadcn init, `clients/web/src/styles/globals.css`
tokens, the DESIGN.md §5 foundation component set — kept a separable item so a
styling-toolchain failure is isolatable from the rest of the bootstrap; debate
finding), the E2E pre-flight script, the seeded `web-gotchas.md`, and one
hello-world component + one hello-world E2E driven through the full four-role
pipeline — the hello-world component renders a vendored primitive styled by a
semantic token, proving the design-system path end to end.
The SU7 decision record links the passing run. Browser-consumability of the
Epic 026 API (auth over TLS from the browser, same-origin serving or dev
proxy — no CORS surprises) is part of what the hello-world must prove.

### `{{> SOURCE_AND_TEST_LAYOUT}}`
#### core
- **Production source:** `src/**/*.ts` (excluding test files). ES modules;
  relative imports use explicit `.ts` extensions (Node 24 runs TypeScript
  directly via type stripping).
- **Unit tests:** co-located beside the unit under test as
  `src/**/*.test.ts`, using `node:test` + `node:assert/strict`.
- **No UI/E2E tests** — Core has no visual surface.
- **New-file naming:** a production module `src/foo/bar.ts` is tested by
  `src/foo/bar.test.ts` in the same directory.
- **Module/imports:** import a sibling production module by its `.ts` path
  (e.g. `import { greet } from "./greeting.ts"`).

#### web
- **Production source:** `clients/web/src/**/*.ts` / `*.tsx` (excluding test files),
  bundled by Vite (imports follow the Vite/tsconfig resolution, not core's
  `.ts`-extension rule).
- **Unit/component tests:** co-located as `clients/web/src/**/*.test.ts(x)` on Vitest
  + Testing Library; select elements only via the locator registry.
- **E2E tests:** `clients/web/e2e/**/*.spec.ts` on Playwright against the pre-flight
  daemon + served bundle; story-gated (a Story's Verify must name the e2e run).
- **Generated client:** committed under the maintainer-declared generated dir;
  read-only for every role.

### `{{> LANE_OWNERSHIP}}`
Tests are **co-located** with source (`bar.ts` + `bar.test.ts` in one dir), so a
prefix table cannot separate the lanes — this project uses a **predicate
script**: `scripts/lane-check.sh <role> <scope> <path>` (exit 0 = in-lane).

- **test-engineer** lane: `src/**/*.test.ts`, `src/**/*.spec.ts` (core);
  `clients/web/src/**/*.test.ts`, `clients/web/src/**/*.test.tsx`, `clients/web/e2e/**` (web); plus its
  draft files under `.agent/tdd/` and its journal under
  `.agent/tdd/memory/test-engineer/`.
- **software-engineer** lane: `src/**/*.ts` that is NOT a `*.test.ts` /
  `*.spec.ts` (core); `clients/web/src/**` that is NOT a test file (web) — this
  **includes the locator registry `clients/web/src/locators.ts`**: it is production
  code the SE owns; the TE consumes it and, when a test needs a missing
  locator, the Story's GREEN action adds it (debate finding — a TE-owned
  production-consumed module would break the lanes); plus its draft files and
  journal as for core.
- **Always forbidden to BOTH** (the lane script denies these for every role):
  the locked plan tree `.agent/plan/**`; the pipeline files `.claude/**`;
  toolchain/config `package.json`, `package-lock.json`, `tsconfig*.json`,
  `*.config.*`, `scripts/**`, `clients/web/package.json`, `clients/web/tsconfig*.json`,
  `clients/web/vite.config.*`, `clients/web/playwright.config.*`, `clients/web/vitest.config.*`;
  container/build files `Containerfile`, `compose.yaml`, `Makefile`; any
  generated proto/client output (server or web); the design contract
  `DESIGN.md`, the token file `clients/web/src/styles/globals.css`, and the vendored
  shadcn primitives `clients/web/src/components/ui/**` (changes route through
  DESIGN.md §P2; HD-A decided 2026-07-03 — hard deny). The
  reviewer-engineer edits nothing at all.

The scope argument is `core`, `web`, or `all` (the serial alias running both);
lane rules are variant-scoped as listed above.

### `{{> BUILD_AND_TEST_COMMANDS}}`
All commands run from the repo root; each is variant-scoped and role-owned
(debate finding — which role runs what, and the exact PASS/FAIL artifact, is
part of the contract).

#### core
- **Produce the handoff artifact** — software-engineer, before every handoff:
  `npm run typecheck` (`tsc --noEmit`); the artifact is a clean type-check.
- **Run unit tests** — test-engineer only: `npm test` (`node --test`).
- **Verify the handoff artifact** — test-engineer re-runs
  `npm run verify:handoff` → `VERIFY: PASS` exit 0 / `VERIFY: FAIL` non-zero
  (`scripts/verify-handoff.mjs`).

#### web
- **Produce the handoff artifact** — software-engineer, before every handoff:
  `npm run typecheck:web` (`tsc --noEmit -p web`) **and** `npm run build:web`
  (`vite build`); the artifact is a clean type-check plus a successful bundle.
- **Run unit/component tests** — test-engineer only: `npm run test:web`
  (`vitest run`).
- **Run E2E tests** — test-engineer only, and only when the Story's Verify
  names it: `npm run e2e:web` (Playwright against the pre-flight resources).
- **Verify the handoff artifact** — test-engineer re-runs
  `npm run verify:handoff:web` → same `VERIFY: PASS`/`VERIFY: FAIL` contract
  (script wraps typecheck:web + build:web).

Two variants → per-worktree build caches; the pre-flight script allocates
ports per worktree via environment so parallel `--variant` runs cannot
collide.

### `{{> ENV_PREFLIGHT}}`
#### core
None. Tests and typecheck run in-process with no emulator, database, browser,
or booted resource. The orchestrator skips Step 4 and passes `n/a` for core
dispatches.

#### web
Unit/component tests need nothing (`n/a`). **E2E dispatches only:** the
orchestrator runs the maintainer-owned pre-flight script
(`scripts/web-e2e-preflight.mjs`, lane-forbidden): boots the daemon in
dev/test mode (loopback bind, test TLS certs, golden fixture store — the
script owns fixture seeding), serves the built SPA, waits on both readiness
probes, and exports the allocated ports via env. A pre-flight failure is an
environment failure, never a story failure (debate finding — ownership,
seeding, auth material, and port allocation are the script's, not the
engineers').

### `{{> GOTCHA_FILES}}`
Read the relevant file **before** working in that area — not upfront.

- `.agent/tdd/memory/ts-gotchas.md` — before any TypeScript/ESM edit in
  `src/`: explicit `.ts` import extensions under type stripping,
  `verbatimModuleSyntax` `import type` rules, `node:` builtin imports,
  top-level await.
- `.agent/tdd/memory/web-gotchas.md` — before any `clients/web/` edit: Vite resolution
  vs core's `.ts`-extension rule, Testing Library query discipline, Playwright
  wait/locator pitfalls, Connect-Web client usage, Tailwind v4-vs-v3 config
  pitfalls (seeded by the SU7 bootstrap).
- `DESIGN.md` (repo root) — before any `clients/web/src` component or feature edit:
  the design implementation contract (ownership tiers, token rules, state
  patterns, locator placement); read the `DESIGN §n` sections the task's area
  touches.

This file is seeded as a living checklist; engineers append pitfalls as they
hit them (the test-engineer/software-engineer journals are separate, under
`.agent/tdd/memory/<role>/`).

### `{{> IDIOM_CHECKLIST}}`
Apply on every edit:

- **ESM idioms (core)** — `"type": "module"`; relative imports carry the `.ts`
  extension; use `import type` for type-only imports (`verbatimModuleSyntax`).
- **Logging (core)** — `pino`, never `console.log` in production paths. No
  silently swallowed errors.
- **DI seam style** — inject collaborators through constructor/factory
  parameters typed by a small interface the consumer defines, so tests fake at
  that seam (no module-level singletons that tests cannot replace).
- **Web idioms (web)** — all API access through the generated Connect-Web
  client (never hand-rolled fetch against the daemon); every interactive
  element carries a locator-registry `data-testid`; no server logic in the
  SPA; style with semantic token classes only (no raw palette/hex —
  DESIGN.md §3); compose from the design-system tiers — composites first,
  vendored primitives second, no raw HTML element where a primitive exists
  (DESIGN.md §2); domain states map to visuals only via the domain badge
  composites (DESIGN.md §4).
- **Surgical diffs** — smallest change that satisfies the failing assertion plus
  the named refactor; no speculative abstraction.

### `{{> TEST_CONVENTIONS}}`
#### shared discipline (both variants)
- **Fake vs Mock:** a **Fake** returns generic safe defaults; a **Mock** returns
  the deterministic value the Story names. When a Story specifies a value, wire a
  Mock. Build fakes/mocks as small hand-written objects implementing the
  consumer's interface (no mocking library).
- **RED discipline:** a RED test must fail for the right reason now and pass once
  the named seam exists. Pin the observable mechanism (return value, thrown
  error, rendered element, file written), not a private symbol.

#### core
- **Runner:** built-in `node:test`. Import `test` (and `describe`/`it` if
  grouping) from `node:test`; assert with `node:assert/strict`. No external test
  dependency in core.
- **File layout:** one `*.test.ts` beside the module it covers; the suite name
  is the module path; test names describe the user-observable behavior.
- **Imports:** a test imports the production seam by its `.ts` path. A test may
  import only the public surface of the module under test plus `node:` builtins
  and other test helpers under `src/**` — never reach into another module's
  internals.
- **Launch/setup:** none required — tests are hermetic and in-process. A test
  that touches the file store must use a temp dir it creates and removes.

#### web
- **Runner:** Vitest + Testing Library for unit/component (hermetic — the API
  is a hand-written fake of the generated client interface, no daemon);
  Playwright for E2E (pre-flight daemon + served bundle, story-gated).
- **File layout:** component tests co-located as `*.test.tsx`; E2E specs under
  `clients/web/e2e/` named for the story slice they cover.
- **Selection:** components and E2E select **only** via the locator registry's
  `data-testid` constants; a raw CSS/text selector in a test is a review
  blocker.
- **Launch/setup:** unit/component tests need nothing; E2E consumes the
  pre-flight env (ports via environment) and must not boot resources itself.

### `{{> UI_LOCATOR_CONTRACT}}`
Core has no UI — core dispatches omit the locator section. For **web**: the
locator registry is `clients/web/src/locators.ts`, a production module of exported
`data-testid` string constants **owned by the software-engineer lane** (debate
finding — TE ownership of production-consumed code would break the lanes).
Components attach ids only from the registry; tests (component + E2E) select
only via the registry; when a RED test needs a locator that does not exist
yet, the test imports the constant it expects and the Story's GREEN action
adds it — the missing constant is part of the failing state, the SE supplies
it with the component.

### `{{> COPY_SOURCING}}`
No locked copy in either variant — any user-visible string a test asserts
(core diagnostics, web UI text) comes from the Story's acceptance criteria

### `{{> REVIEW_DIMENSIONS}}`
Each finding cites a source (per the methodology table) and is classified
BLOCKER vs SUGGESTION with an `action:` tag.

- **Error handling & safety.** No swallowed errors; `pino` for logs; errors
  surfaced or wrapped with context. Cite the construct + why the property fails.
- **API/seam design.** A seam the tests/import depend on is shaped for its
  consumer; name the consumer hurt by a bad shape.
- **Simplicity.** Smallest correct change; no speculative abstraction; give the
  simpler equivalent when flagging.
- **AC coverage.** Every Story acceptance criterion is covered by a test or a
  cited proof. A gap is a BLOCKER (`action:YES` when the fix is mechanical).
- **Web discipline (web stories only).** All API access goes through the
  generated client (no raw fetch to the daemon); every selection uses the
  locator registry; no server logic in the SPA. Each violation is a BLOCKER.
- **Design conformance (web stories only).** The DESIGN.md §P3 checklist —
  semantic tokens only, tier composition, §7 state patterns, §8 locator
  placement, frozen `ui/**` and read-only-by-design surfaces. Each violation
  is a BLOCKER citing `DESIGN §n`.

There is no sketch phase, so no dimension is ever skipped.

### `{{> SKETCH_MODE}}`
Not applicable — this project has no sketch phase; all work is test-gated and the --sketch flag must error (there is no Phase A and no artifact-only review)

## 3. Optional capability flags

| Capability | Value |
|---|---|
| Multi-variant parallelism | yes — `core` and `web` have disjoint source paths; `--variant web` runs in an isolated worktree |
| Sketch phase | no — `--sketch` errors |
| UI/E2E tests | yes — web only (Vitest component + story-gated Playwright E2E); core has none |
| Locked copy | no |
