# SU7 Decision — Web Dashboard Toolchain (Epic 020 SU7)

Status: **DECIDED (option b) — bootstrap demo PENDING; SU7 Verify is NOT yet
passed.** Epic 027's stories are authored (see Amendment 2026-07-03) but no
web story may **dispatch** until the hello-world run below is green.

## Decision

Ulrich decided **option (b)**: add a `web` variant to `.agent/tdd/PROFILE.md`
so the dashboard SPA runs through the same four-role TDD pipeline as Core
(decided 2026-07-02; overrides the authoring recommendation of a separate SPA
pipeline). The design was run through the adversarial debate engine before
landing; accepted critiques are merged into PROFILE.md as "(debate finding)"
notes.

## What was decided (now in PROFILE.md)

- **Location:** the SPA lives in-repo under `clients/web/` (source `clients/web/src/**`,
  component tests co-located, E2E under `clients/web/e2e/**`).
- **Stack:** Vite + TypeScript + React; `@connectrpc/connect-web` over a
  maintainer-generated, committed client; Vitest + Testing Library
  (jsdom; unit/component, hermetic against a fake of the generated client);
  Playwright (chromium-only, thin, story-gated E2E). The stack choice is an authoring
  proposal validated by the bootstrap demo — a failed demo re-opens it via a
  decision record here.
- **Lanes:** TE gets web test paths; SE gets web production paths **including
  the locator registry `clients/web/src/locators.ts`** (debate finding); all web
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

1. Scaffold `clients/web/` (Vite + React + TS), add deps to the web package config,
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

- ~~Epic 027's second authoring pass (its six story slices with `clients/web/`-lane Task
  Inputs) starts only after item 6.~~ **Superseded — see Amendment 2026-07-03.**
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

## Amendment 2026-07-03 — authoring order changed (review B3/B4)

A plan review flagged two blockers: **B3** — the Phase-2 gate's critical path
(Epic 030 LP1/LP2 are dashboard-exclusive) was not executable while Epic 027
had zero story files; **B4** — a cross-epic contradiction: phases.md D9 +
Epic 030 LP3 make the per-feature summary gate-critical in the web client,
while the 027 draft demoted Epic 029 to "optional — NOT a dependency".

Resolution: the **second authoring pass ran before the bootstrap demo**
(the demo needs the Epic 026 schema and a running daemon, which exist only at
2B build time — waiting would leave the plan gap open for the whole phase).
Rationale: the Task Inputs come from the PROFILE web-variant lane spec, which
is already frozen and debate-hardened; the bootstrap demo **validates** that
spec, it does not design it. The bootstrap gate is unchanged as the hard
dispatch precondition (no web story dispatches before item 6), and a failed
demo re-opens the authored stories via a decision record here — locked story
files are not silently mutated. B4 is resolved in the authored epic: Story 007
(`007-per-feature-summary-view`) adds the summary surface, and Epic 029
Story 002 is its named dependency; "degraded render" is narrowed to absent
data (explicit empty summary), never an absent/failing API method.

## Amendment 2026-07-03 — design system (shadcn/ui + DESIGN.md)

Ulrich directed a design-system pass: base the dashboard UI on **shadcn/ui**
(ref: https://ui.shadcn.com/llms.txt) with a repo-root **`DESIGN.md`** acting
as the coding-agent runbook. Both the DESIGN.md content and this wiring were
run through the adversarial debate engine (two passes); accepted findings are
tagged in the files.

What changed:

- **`DESIGN.md` authored** — the design implementation contract for the web
  variant: ownership tiers (vendored `ui/**` primitives / SE composites /
  feature surfaces), semantic-token rules, status vocabulary split (shared
  tones + per-domain badge composites), the surface→primitive usage map with
  a small bootstrap **foundation set**, AppShell/page templates, UI state
  patterns, locator placement, and the §P procedures (new-surface checklist,
  §P2 missing-primitive escalation, §P3 reviewer blockers).
- **PROFILE.md web slots updated** — DESIGN.md named in the web context and
  gotcha reading list; token/tier/badge idioms added; `DESIGN.md`,
  `clients/web/src/styles/globals.css`, and `clients/web/src/components/ui/**` added to the
  forbidden-to-both lane list; a "Design conformance" review dimension added.
  render.py re-render is already bootstrap item 5 — no new step.
- **Bootstrap item 1 extended** (design foundation, separable): Tailwind v4 +
  shadcn init, `globals.css` tokens, the DESIGN §5 foundation component set;
  item 6's hello-world must render a vendored primitive styled by a semantic
  token (the design-system path is part of what the demo proves). A failure
  in the design-foundation item is isolatable from the rest of the bootstrap
  (debate finding).
- **Epic 027 + stories wired** — the epic cites DESIGN.md and gains a
  design-conformance gate line; each story gains one DESIGN.md constraint
  bullet (cite once, no rule restating — debate finding); Task Inputs name
  the **specific** design-system composite files a task introduces (e.g.
  `FeatureStatusBadge`, `ConfirmActionDialog`, page templates) with their
  test files — NOT blanket `clients/web/src/components/**` grants (debate finding —
  the riskiest wiring option was broad shared-directory Inputs).
- **Story 000 authored as DRAFT (pending HD)** —
  `000-app-shell-and-design-foundation.md`: slim shell + tone vocabulary +
  state components. Not dispatchable until Ulrich confirms; if rejected, the
  shell work folds into Story 001 via an authoring update.

**Pending HD (human decisions), with recommendations:**

1. **HD-A — `ui/**` edit gate.** Recommended: hard lane deny, changes via
   DESIGN §P2 maintainer escalation (debate #2). Alternative: Task-Input gate
   (debate #1 — avoids maintainer bottleneck). The deny is live in PROFILE.md
   pending the call.
2. **HD-B — Tailwind v4 vs v3.** Recommended: v4 (shadcn's current Vite
   default), validated by the bootstrap demo; risk — agents may hallucinate
   v3 patterns (gotcha seeded). Alternative: v3 for a battle-tested surface,
   at the cost of fighting the current shadcn CLI.
3. **HD-C — dark-mode scope.** Recommended: token-discipline only (both
   themes must not break; light canonical, E2E light-only). Alternative:
   fully tested dual theme (adds test surface to every story).
4. **HD-D — Story 000 vs no Story 000.** Recommended: keep the slim DRAFT
   Story 000 (shell built once, seven stories mount into it). Alternative
   (debate #1 counter-position): fold the shell into Story 001 and let
   composites emerge story-by-story.

**All four DECIDED 2026-07-03 by Ulrich, each as recommended:** HD-A hard
lane deny for `ui/**` (changes via DESIGN §P2 only); HD-B Tailwind v4; HD-C
token-discipline-only dark mode (light canonical, E2E light-only); HD-D
Story 000 kept — its DRAFT status is lifted. Dispatch stays bootstrap-gated
for the whole epic; Story 000 dispatches first so Stories 001–007 mount into
the shell.

**Responsive decided 2026-07-03 (same day, follow-up):** a **must-have**, not
an assumption — Ulrich uses the console from iPad/iPhone away from the desk;
a dedicated mobile app may come later, responsive is the bridge. This
supersedes the authored desktop-first/1024px assumption. DESIGN §6 is
rewritten (phone-and-up, template-owned responsive layout, tables scroll
inside their container, touch-size rule), §P3 gains a responsive blocker,
the Epic 027 gate run repeats its surface spot-check at the phone viewport,
and Story 000 proves the mobile shell behavior hermetically. Follow-up
(Ulrich, same day): **iPhone 13 is the standard phone device** — 390×844
CSS px is the §6 supported floor and the gate spot-check viewport
(Playwright's `iPhone 13` device profile in the gate run).
