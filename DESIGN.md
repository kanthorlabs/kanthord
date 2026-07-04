# DESIGN.md — kanthord Web Dashboard Design System (agent runbook)

Status: authored 2026-07-03, debate-hardened. Applies to the `web` variant
only (Epic 027 control-plane dashboard). Like Epic 027 itself, this runbook is
**bootstrap-gated**: the SU7 bootstrap demo validates the stack named here; a
failed demo re-opens choices via a decision record in
`.agent/plan/feedback/027-web-dashboard/toolchain-decision.md` — it does not
silently mutate this file. The four human decisions (HD-A..D) were decided
2026-07-03 by Ulrich; the tags below record which HD settled each rule.

## §0 Authority & precedence

- **Audience:** the four pipeline roles (test-engineer, software-engineer,
  reviewer-engineer, orchestrator) and the maintainer. Read the section named
  by your task before editing; sections are citable as `DESIGN §n`.
- **What this file is:** a **design implementation contract** (debate finding
  — not a second product spec). Story Acceptance Criteria own **which**
  surfaces, values, and states exist. `.agent/tdd/PROFILE.md` owns process:
  lanes, commands, test discipline. DESIGN.md owns **how things render**:
  which component, which token, which pattern.
- **Precedence on conflict:** Story AC > PROFILE.md > DESIGN.md > shadcn/
  Tailwind defaults. Anything DESIGN.md does not specify falls to the shadcn
  default — do not invent local conventions.
- **Edit policy:** maintainer/authoring only. An engineer diff touching
  DESIGN.md is a review BLOCKER. Changes follow §P4.

## §1 Stack contract

Base framework: **shadcn/ui** (https://ui.shadcn.com/llms.txt) — vendored
component source, NOT an npm component dependency. On top of the frozen
PROFILE web stack (Vite + TypeScript + React, Connect-Web client, Vitest +
Testing Library, Playwright):

| Piece | Choice | Note |
|---|---|---|
| Component source | shadcn/ui CLI output, vendored under `clients/web/src/components/ui/` | CLI is **maintainer-only** (it touches configs) |
| Styling | Tailwind CSS **v4** (CSS-first `@theme`, no `tailwind.config.js`) | decided 2026-07-03 (HD-B); risk: agents may hallucinate v3-era config patterns — `web-gotchas.md` carries the v4-vs-v3 pitfalls (debate finding) |
| Behavior primitives | Radix UI (inside the vendored components) | never re-implement a Radix behavior by hand |
| Variants | `class-variance-authority` (cva), `cn()` from `clients/web/src/lib/utils.ts` | the shadcn idiom; no ad-hoc classname concatenation |
| Icons | `lucide-react` | only icon source |
| Toasts | `sonner` | the only toast mechanism |

Versions are pinned at bootstrap in `clients/web/package.json` (maintainer-owned,
lane-forbidden). **The vendored source under `clients/web/src/components/ui/` is the
API reference** — agents read the actual props from the vendored file, never
guess a shadcn API from memory.

## §2 File & ownership tiers

| Path | What | Owner / edit rule |
|---|---|---|
| `clients/web/src/components/ui/**` | Vendored shadcn primitives | **Maintainer-only (recommended default)**: lane-denied like generated code; every change routes through §P2. The two debate passes split here — #1: a permanent ban risks a maintainer bottleneck (favors a Task-Input gate); #2: a Task-Input escape hatch invites "just tweak the primitive" (favors the hard deny). The hard deny is adopted as the safer default — easy to relax later. Decided 2026-07-03 (HD-A: hard deny). |
| `clients/web/src/components/**` (excl. `ui/`) | App composites — the reusable design system (e.g. `AppShell`, `PageHeader`, `StatusBadge` family, `ConfirmActionDialog`, `DataStates`) | SE lane, TDD-covered. Composites are the executable examples: prefer extending one over writing prose rules |
| `clients/web/src/features/**` | Story surfaces | SE lane. Compose from tier-2 composites first, tier-1 primitives second; a raw HTML element where an equivalent primitive exists is a review blocker |
| `clients/web/src/design/**` | Shared visual vocabulary (`status.ts` tones, §4) | SE lane, unit-tested |
| `clients/web/src/styles/globals.css` | Token definitions (`@theme` + shadcn CSS variables) | Maintainer-owned (toolchain-adjacent); token additions via §P2 |
| `clients/web/src/locators.ts` | Locator registry | SE lane per PROFILE; naming per §8 |

## §3 Tokens & styling rules

The theme is the shadcn semantic CSS-variable set (`--background`,
`--foreground`, `--card`, `--muted`, `--accent`, `--destructive`, `--border`,
`--ring`, `--radius`, `--chart-1..5`, `--sidebar-*`), defined once in
`clients/web/src/styles/globals.css`.

- **MUST** style with semantic utility classes only: `bg-background`,
  `text-muted-foreground`, `border-border`, `bg-destructive`, …
- **BLOCKERS:** raw palette classes (`bg-red-500`), hex/rgb/hsl literals in
  TSX or CSS-in-JS, `style={{ color: … }}`, arbitrary color values
  (`bg-[#…]`), ad-hoc border radii or shadows where a token exists.
- Spacing/sizing uses the default Tailwind scale; an arbitrary value
  (`w-[123px]`) needs a code comment stating why no scale step fits.
- **Dark mode:** theming is a `.dark` class flip. Both themes must not break —
  free if the token rules hold. Light is canonical; E2E runs light only
  (decided 2026-07-03, HD-C).

## §4 Status & severity vocabulary

Two layers (debate finding — one global status file becomes a cross-domain
dumping ground):

1. `clients/web/src/design/status.ts` — the **visual vocabulary** only: a `Tone`
   union (`neutral | info | success | warning | danger`) and its mapping to
   Badge/Alert variants and token classes. No domain knowledge.
2. **Domain mappings live beside their composite**: `FeatureStatusBadge`,
   `TaskStatusBadge`, `EscalationSeverityBadge`, `BreakerStateBadge`,
   `ApprovalStateBadge` — each a tier-2 composite mapping its domain states
   (from the generated API types) to a `Tone`, unit-tested with the exact
   state values the Story names.

**Rule:** a feature file NEVER maps a domain state to a color/variant inline.
If a new domain state appears, extend (or add) the domain badge composite.

## §5 Component usage map

Which primitives serve which Epic 027 surface. **Bootstrap vendors only the
foundation set** (marked ●); the rest are vendored on demand via §P2 when
their story dispatches (debate finding — a big up-front inventory front-loads
API misunderstandings and dead surface).

| Surface (story) | Primitives |
|---|---|
| App shell (all) | ● `sidebar`, ● `separator`, ● `tooltip`, `breadcrumb` |
| Features list (001) | ● `table`, ● `badge`, ● `card`, ● `empty`, ● `skeleton` |
| Feature drill-down (001) | `tabs`, ● `table`, ● `card`, `scroll-area` (STATE/JOURNAL read-only panes) |
| Plan flows: sign-off / halt / re-planning diff (002) | ● `button`, ● `alert`, `alert-dialog`, diff pane = `card` + `scroll-area` + `<pre>` |
| Inbox + responses (003) | ● `table`, ● `badge`, `sheet` (evidence), `alert-dialog` (typed-category confirm), `select`/`input` + `label` |
| Approval-tier verbs (004) | ● `button`, `alert-dialog`, ● `alert` (expired state), ● `badge` |
| Broker & slots (005) | ● `table`, ● `badge`, ● `card` |
| Budgets & daemon ops (006) | ● `card`, `progress`, ● `alert` (breaker), `dialog` + `input`/`label` (override w/ required reason), ● `button`, `sheet` (verify report) |
| Per-feature summary (007) | ● `card` (stat blocks), ● `table` (by-type breakdown), ● `empty` |
| Feedback (all) | `sonner`, ● `skeleton`, ● `alert` |

Foundation set at bootstrap: `button, badge, card, table, alert, skeleton,
empty, input, label, separator, sidebar, tooltip` + `globals.css` tokens +
`lib/utils.ts`. Anything not vendored yet: §P2, never a hand-rolled clone.

## §6 Layout — AppShell & page templates

- **One `AppShell`** (tier-2): shadcn `sidebar` with the nav list — Features,
  Inbox, Broker, Slots, Budgets, Ops — plus a header region (page title /
  breadcrumb + connection/auth state) and the content region. Every story
  surface mounts inside `AppShell`; no bespoke page scaffolding per story.
- **Page templates** (tier-2): `ListPage` (title + toolbar + table + the §7
  state slots), `DetailPage` (breadcrumb + tabs), `OpsPage` (card grid). Use
  a template; extend the template if it lacks a slot (that is design-system
  work, visible in the diff).
- **Responsive is a must-have** (Ulrich, 2026-07-03 — the console is used
  from iPad/iPhone away from the desk; a dedicated mobile app may come
  later, responsive is the bridge until then). Reference phone device:
  **iPhone 13 — 390×844 CSS px** (Ulrich, 2026-07-03). Supported range:
  **390px up to desktop**; Tailwind's default breakpoints only
  (`sm`/`md`/`lg`) — no custom breakpoints.
- **Templates own responsive layout**: `ListPage`/`DetailPage`/`OpsPage`
  handle stacking, spacing, and toolbar wrapping per breakpoint so story
  surfaces never write their own layout switches; the shell uses the shadcn
  sidebar's built-in mobile (off-canvas) behavior — never a hand-rolled
  drawer.
- **Tables stay tables**: on narrow viewports a wide table scrolls
  horizontally inside its own container — no per-surface card-collapse
  layouts in MVP (smallest consistent rule; revisit only via §P4).
- **Touch**: never shrink an interactive element below the primitive's
  default size; icon-only actions keep their full hit area on touch
  viewports.
- **Overflow rules** (debate finding): wide tables scroll horizontally inside
  their own container — the page body never scrolls horizontally; long
  ids/paths/hashes truncate middle with `title` attr; long evidence/report
  text goes in `scroll-area` panes with a fixed max height; costs/counters
  never wrap.
- Read-only-by-design surfaces (plan files, registries, yaml) render in
  non-form elements only — no input, no contentEditable, no save affordance.

## §7 UI state patterns

Stories own **which** states a surface has; DESIGN.md owns how each renders
(debate finding — "exactly four states" was too absolute; the baseline is
"the applicable ones", stories add domain states like expired, conflict,
breaker-open).

| State | Rendering |
|---|---|
| Loading | `skeleton` blocks matching the final layout — never a lone spinner for page data |
| Empty | `empty` component; wording from the Story AC |
| Error | `alert` variant `destructive`; retry affordance only where the AC allows |
| Auth-required | the dedicated auth-required screen (Story 001 baseline) — never a cached surface |
| Mutation pending | trigger `button` disabled with inline spinner |
| Mutation result | `sonner` toast, unless the AC demands inline rendering |
| Destructive / irreversible verbs (halt, override, `github.merge`, …) | ALWAYS `alert-dialog`; when the Epic 017 contract requires a typed category, the dialog carries the `select`/`input` and disables confirm until valid |
| Domain states (expired item, conflict, breaker open, …) | per Story AC, composed from `badge`/`alert` + the §4 domain vocabulary |

## §8 Locator placement & naming

Extends the PROFILE locator contract (`clients/web/src/locators.ts`, SE-owned,
registry-only selection). Naming: dot-path `area.surface.element[.action]` —
e.g. `features.list.row`, `features.list.empty`, `inbox.item.respond`,
`budgets.override.reason`, `ops.verify.trigger`.

Placement for composed primitives (debate finding — "root + interactive
element" is not precise enough with Radix portals):

| Composition | testid goes on |
|---|---|
| Dialog / AlertDialog / Sheet | the trigger, the portal content root, and each action button (confirm/cancel separately) |
| Table | the table root, each semantic row, and each row action |
| Tabs | each tab trigger and each tab panel (not the list wrapper) |
| Select / dropdown / command | the trigger and each item |
| Toast | not asserted via testid — assert the visible text via a toast-region locator |
| Form fields | the input itself, plus the field error message node |

## §9 Accessibility

- Never strip Radix-provided roles/labels/keyboard behavior when composing.
- Every icon-only button carries an `aria-label` (wording from the AC, or the
  action name).
- Form inputs pair with `label`; errors are announced by the field error node.
- Focus stays managed by the primitives — no manual focus hacks without a
  DESIGN.md change.

## §P Procedures

### P1 — Building a new surface (SE/TE checklist)

1. Read the Story AC + this file's §5 row for the surface; read
   `web-gotchas.md` (PROFILE).
2. Mount inside `AppShell` via the matching page template (§6).
3. Compose tier-2 composites first, vendored primitives second (§2).
4. Map domain states through the §4 domain badge composites.
5. Render every state the AC names, using the §7 pattern for each.
6. Register locators per §8 before the component lands.
7. Component tests hermetic against the fake client; selection registry-only
   (PROFILE).

### P2 — Missing primitive / token / variant (escalation)

1. STOP — do not hand-roll a lookalike, do not edit `ui/**` or
   `globals.css` in-lane.
2. Record the need (component, driving AC) in the story's feedback file under
   `.agent/plan/feedback/027-web-dashboard/`.
3. Maintainer vendors the primitive via the shadcn CLI (or adds the token),
   commits, and appends it to the §11 ledger — the same protocol as a schema
   regen.
4. Resume the task against the vendored source.

### P3 — Reviewer checklist (web stories, additive to PROFILE dimensions)

Each is a BLOCKER, cite `DESIGN §n`:

- raw palette class / hex / inline color / arbitrary color value (§3);
- edited `clients/web/src/components/ui/**` file not named by the Task Input (§2);
- domain state mapped to color/variant inline in a feature file (§4);
- surface not mounted in `AppShell` / bespoke page scaffolding (§6);
- an AC-named state missing its §7 rendering pattern;
- raw HTML element where an equivalent vendored primitive exists (§2);
- locator absent from the §8 placement points, or off-convention name;
- story-surface-local breakpoint/layout switching where a template owns it,
  or page-body horizontal scroll at any supported width (§6);
- edit affordance on a read-only-by-design surface (§6);
- DESIGN.md itself modified (§0).

### P4 — Changing DESIGN.md

Maintainer/authoring work only, never mid-story: record the motivation as a
decision (or debate finding) in
`.agent/plan/feedback/027-web-dashboard/toolchain-decision.md`, update this
file, and bump the §11 changelog. Locked stories are not edited to match —
mismatches route through the decision-record protocol.

## §11 Ledger & changelog

**Vendored inventory** (maintainer appends on every §P2 vendoring):

| Date | Component(s) | Driven by |
|---|---|---|
| — (bootstrap pending) | foundation set (§5) | SU7 bootstrap |

**Changelog:**

- 2026-07-03 — initial authoring; debate-hardened (two adversarial engine
  passes — one on this file, one on the plan wiring; accepted findings tagged
  inline). §2 `ui/**` rule updated after the second pass: hard lane deny as
  the recommended default. Pending HD items: `ui/**` edit-gate mechanism,
  Tailwind v4, dark-mode scope, Story 000 vs bootstrap shell.
- 2026-07-03 — HD-A..D decided by Ulrich, each as recommended: `ui/**` hard
  lane deny (§P2 only), Tailwind v4, token-discipline dark mode, Story 000
  kept (DRAFT lifted). Recorded in toolchain-decision.md.
- 2026-07-03 — responsive decided a **must-have** by Ulrich (iPad/iPhone
  use): §6 rewritten from desktop-first/1024px to phone-and-up with
  template-owned responsive layout; §P3 gains the responsive blocker; the
  Epic 027 gate spot-checks a phone-width viewport. Follow-up same day:
  **iPhone 13 (390×844) fixed as the standard phone device** — the §6 floor
  and the gate viewport.
