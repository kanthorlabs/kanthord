# SU7 Decision — Web Dashboard Toolchain (Epic 020 SU7)

Status: **DECIDED (option b) — bootstrap COMPLETE; SU7 Verify PASSED 2026-07-14.**
Epic 027 web stories are now dispatch-unblocked. See "SU7 bootstrap — PASSED"
below for the run record.

## SU7 bootstrap — PASSED (2026-07-14)

All six bootstrap items landed on `main` and the hello-world flowed through the
full four-role pipeline:

1. **Scaffold** `clients/web/` — standalone Vite 8 / React 19 / TS / Tailwind v4
   pkg (NOT a root workspace, so the core Podman image never installs the web
   toolchain), shadcn token `globals.css` (light+dark), `cn()`, configs — commit
   `61fee18`.
2. **Connect-Web client** generated into `clients/web/src/gen/` (buf.gen.yaml 2nd
   output; protobuf-es v2 descriptors consumed directly by connect-web) —
   `a48e3e2`.
3. **lane-check.sh** web predicates + generated dir declared forbidden — `5f9a87e`.
4. **`scripts/web-e2e-preflight.mjs`** (serves the bundle over the SU5 TLS cert) +
   seeded `.agent/tdd/memory/web-gotchas.md` (Tailwind v4-vs-v3, shadcn, connect-web) — `5f9a87e`.
5. **render.py re-render** → `.claude/` + `.opencode/` role agents carry the web
   variant — `5f9a87e`.
6. **Hello-world through the pipeline:**
   - `HelloBanner` + Vitest test + **Playwright E2E over TLS** (desktop + iPhone 13
     gate viewport, chromium — HD-C), all green — `6e87763`. Proves browser-over-
     TLS + the design path (vendored primitive styled by a semantic token).
   - `PipelinePing` driven **RED→GREEN→reviewer via `/work --variant web`** in an
     isolated worktree (TE t0 → SE t1 → TE t2 confirm+gate → reviewer PASS 0
     blockers → `HUMAN_REVIEW: PASS`) — `a26c6e4`. Proves the four-role lane
     enforcement + gate commands end to end. Discussion record:
     `.agent/tdd/history/2026-07-14-020.1-web-bootstrap-helloworld-web.md`.

Foundation shadcn primitives (DESIGN §5 set) vendored via the CLI — `b953c89`.
Both variants green on `main`: web 4/4 tests + `typecheck:web`; core 1094/1094.

Browser-consumability of the **Epic 026 API over TLS** is proven at the transport
+ type level (generated client compiles; browser loads over TLS same-origin); a
live method call awaits Epic 026 handlers (no handlers exist yet — SU6 added only
the schema).

---

_(Original decision record follows.)_

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

## §P4 pass 2026-07-15 — daily-usage Inputs 6 & 8 (owed before Story 000)

Recorded by Aelita during the Epic 027 web build (Ulrich directed: build the UI
first in a worktree, raise API needs at the end, since Epic 026 is in progress
in a sibling worktree — no live daemon yet, so E2E stays deferred). The epic's
Dependencies section made a DESIGN.md §P4 pass a hard precondition for Story 000
dispatch; it had not been done. This pass closes it.

**Motivation** (`daily-usage-operator-loop.md`):
- **Input 6** — the Inbox nav item needs an open-items count badge, and the
  collapsed mobile shell needs an indicator on the menu toggle (a badge inside
  off-canvas nav is invisible exactly when mobile needs it).
- **Input 8** — no surface owns data freshness today; phone tabs re-open hours
  stale. One template-owned pattern: `Updated HH:MM` (client fetch time) + a
  refresh affordance, plus the rule that a successful mutation refetches the
  affected view. No polling/push in MVP.

**DESIGN.md changes** (§0 authority; recorded here per §P4):
- §6 — added the **nav count-badge slot** bullet (Input 6) and the
  template-owned **data-freshness slot** bullet (Input 8).
- §7 — added the **data-freshness** state-pattern row (Input 8).
- §11 changelog — dated entry appended.

**Router dependency:** `react-router-dom@^6` added to `clients/web/package.json`
(maintainer/config lane, not an engineer edit). Input 5's stable deep-link URLs
+ auth-redirect preservation require real URL routing, and the six-area nav is a
route switch; hand-rolling a router to dodge the import would re-derive a solved
problem (Principle 6). v6 is stable and React 19-compatible.

## Fold-in pass 2026-07-15 — pending story fold-ins applied at authoring time

The feedback files required these to be folded into the story ACs "at authoring
time — not improvised mid-task"; they had not been. Applied now, before the
build, by Aelita (authoring lane), each story's `PENDING FOLD-IN` banner
replaced with a `FOLDED IN (2026-07-15)` note:
- **Story 000** — Inputs 5 (route foundation + auth-redirect preservation) and
  6 (Inbox nav count badge + collapsed-shell indicator).
- **Story 003** — `honest-classification-and-diff-policy.md` + `daily-usage`
  Inputs 1–5 (low-friction classification confirm, scannable type-badge inbox
  with distinct `unclassified-artifact-change`, diff-pane evidence, "Next open
  item" flow, stable per-item deep links).
- **Story 006** — Input 7 (dead-man health card shows "N tasks processed
  today"; the proto already exposes `DeadManPing.tasks_processed`).

Where a fold-in needs a new file/Task not in the original story, it is added as a
Task under the same story with hermetic Verify, consistent with the story's
existing lane spec.
