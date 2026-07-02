# SU7 Decision — Web Dashboard Toolchain (Epic 020 SU7)

Status: **DECIDED (option b) — bootstrap demo PENDING; SU7 Verify is NOT yet
passed.** Epic 027 stays a BLOCKED DRAFT until the hello-world run below is
green.

## Decision

Ulrich decided **option (b)**: add a `web` variant to `.agent/tdd/PROFILE.md`
so the dashboard SPA runs through the same four-role TDD pipeline as Core
(decided 2026-07-02; overrides the authoring recommendation of a separate SPA
pipeline). The design was run through the adversarial debate engine before
landing; accepted critiques are merged into PROFILE.md as "(debate finding)"
notes.

## What was decided (now in PROFILE.md)

- **Location:** the SPA lives in-repo under `web/` (source `web/src/**`,
  component tests co-located, E2E under `web/e2e/**`).
- **Stack:** Vite + TypeScript + React; `@connectrpc/connect-web` over a
  maintainer-generated, committed client; Vitest + Testing Library
  (unit/component, hermetic against a fake of the generated client);
  Playwright (thin, story-gated E2E). The stack choice is an authoring
  proposal validated by the bootstrap demo — a failed demo re-opens it via a
  decision record here.
- **Lanes:** TE gets web test paths; SE gets web production paths **including
  the locator registry `web/src/locators.ts`** (debate finding); all web
  toolchain/config files and every generated client are forbidden to both.
- **Gates:** `web typecheck` + `web unit` join the cheap gate set (`--join`
  runs them always); `web e2e` runs only when a Story's Verify names it and in
  the Epic 027 gate run (debate finding — no full E2E on every join).
- **Pre-flight (E2E only):** the maintainer-owned
  `scripts/web-e2e-preflight.mjs` boots the daemon in dev/test mode on golden
  fixtures with test TLS, serves the bundle, exports ports per worktree; its
  failure is an environment failure, never a story failure.

## Bootstrap gate — what must happen before any web story (SU7 Verify)

Maintainer-executed, in order; the SU7 Verify passes only when item 6 is green:

1. Scaffold `web/` (Vite + React + TS), add deps to the web package config,
   commit configs.
2. Generate + commit the Connect-Web client from the Epic 026 schema; declare
   the generated dir in the lane-check.
3. Extend `scripts/lane-check.sh` with the web predicates from PROFILE.md.
4. Write `scripts/web-e2e-preflight.mjs` and seed
   `.agent/tdd/memory/web-gotchas.md`.
5. Re-run `render.py` against the updated PROFILE.md so the four role agents
   re-render with the web slots.
6. **Hello-world demo through the full pipeline:** one component + one
   Playwright spec, driven RED → GREEN → review via `/work --variant web` —
   proving lanes, commands, pre-flight, and **browser consumability of the
   Epic 026 API** (auth over TLS from the browser; same-origin serving or dev
   proxy so no CORS surprises — debate finding). Link the passing run here.

## Consequences for the plan

- Epic 027's second authoring pass (its six story slices with `web/`-lane Task
  Inputs) starts only after item 6.
- Epic 020 SU7's Verify ("demonstrated executable") maps to item 6.
- When the Epic 026 schema changes, the maintainer re-generates the web client
  (same protocol as Epic 020 SU6 re-gens; recorded there).

## Debate notes (set aside, recorded)

- The engine's counter-position — land only a minimal variant contract first,
  lock the stack after the demo — is honored in spirit: the stack is named in
  PROFILE.md (concrete commands need it) but explicitly demo-validated and
  re-openable here.
- A smaller framework (Lit/Svelte/frameworkless) remains possible if the demo
  or first stories argue for it; switching before story authoring costs only a
  bootstrap redo.
