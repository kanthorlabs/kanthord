# 027 Web Dashboard — Control-Plane UI

> **Second authoring pass (review B3/B4, 2026-07-03).** SU7 is decided —
> option (b), the `web` variant in `.agent/tdd/PROFILE.md` — so this epic is
> now finalized with real story files and authoritative Task Inputs taken from
> the PROFILE web-variant lane spec. The pass ran **before** the SU7 bootstrap
> demo (the demo needs the Epic 026 schema and a running daemon, which exist
> only at 2B build time); that ordering change is decision-recorded in
> `.agent/plan/feedback/027-web-dashboard/toolchain-decision.md`. The
> **bootstrap gate stays the hard dispatch precondition**: `/work` must not
> dispatch any story here until the PROFILE web bootstrap (scaffold +
> generated client + lane predicates + pre-flight script + hello-world through
> the full pipeline) has passed; a failed demo re-opens these stories via a
> decision record, it does not silently mutate them. The Task Inputs are
> **interface hypotheses** pinned to the frozen PROFILE lane spec and the
> Epic 020 SU6 descriptor — the same posture every 2B epic takes toward
> not-yet-built seams; a bootstrap or schema mismatch routes through the
> decision-record protocol, never an ad-hoc story edit (debate finding —
> authored-before-validated must stay visible, not presented as settled).

## Outcome

The MVP UI: one dashboard over the Epic 026 API where the human sees and
controls everything the daemon owns — features (list, drill-down, sign-off,
halt, re-planning diff approval), the escalation/approval inbox with evidence
and approval-tier verb buttons, broker operations and the verb registry
(read-only), repo slots, budgets with breaker state and the recorded override,
daemon ops (health, dead-man status, trigger verify + view its report), and
the **per-feature metrics summary** ("4 human interactions, $11" — phases.md
2B Deliverable 9 says it is readable **in the web client**, and Epic 030 LP3
gates it dashboard-exclusively; review B4). The dashboard **invokes only the
authenticated Epic 026 API operations, which enforce the three rings
server-side** — the client-side claim is scoped to "nothing else is called",
and the gate must demonstrate the enforcement is real from the UI (at least
one ring-1-blocked action and one approval-required action driven from the
dashboard; debate finding — the UI cannot itself provide enforcement, so the
gate proves it observes it). Plan files and registries render read-only by
design.

## Decision Anchors

- phases.md Phase 2B Deliverable 6 — the surface list, "no privileged bypass",
  read-only plan/registry views, Basic auth over TLS on the VPN interface, and
  the requirement that the 2A approval flow is **re-validated through this
  dashboard**; Deliverable 9 — the per-feature summary readable in the web
  client (review B4 — this surface is gate-critical via Epic 030 LP3, not
  optional).
- PRD §3 Layer 3 — web client first; all clients connect to the daemon.
- PRD §7.5 — re-planning diff approval is a human flow the UI must carry.
- Epic 020 SU7 decision (b) + `.agent/tdd/PROFILE.md` web variant — pipeline,
  lanes (`clients/web/src/**` SE incl. `clients/web/src/locators.ts`; tests TE; toolchain
  forbidden to both), stack (Vite + React + TS, Connect-Web generated client,
  Vitest + Testing Library, story-gated Playwright), gates (`web typecheck`,
  `web unit`, story-gated `web e2e`).
- Epic 026 — the complete API; the dashboard adds no server logic.
- `DESIGN.md` (repo root) + the 2026-07-03 design-system amendment in
  `.agent/plan/feedback/027-web-dashboard/toolchain-decision.md` — shadcn/ui
  vendored primitives on semantic tokens; DESIGN.md is the design
  implementation contract every story's Constraints cite (stories own WHICH
  states/values exist; DESIGN.md owns HOW they render).

## Stories

- `000-app-shell-and-design-foundation.md` — the AppShell + nav, the
  ListPage template with its state slots, the status tone vocabulary, and
  the shared state components; Stories 001–007 mount inside it (HD-D decided
  2026-07-03 — Story 000 kept; dispatches first, after the bootstrap gate).
- `001-features-list-and-drilldown.md` — features list; per-feature drill-down
  (live task status, DAG progress, in-flight ops, STATE/JOURNAL views); the
  authenticated-client baseline (unauthenticated session renders no surface).
- `002-plan-flows.md` — sign-off; halt; re-planning diff approval (each with
  its error/conflict states rendered).
- `003-inbox-and-responses.md` — the escalation/approval inbox with evidence
  rendering and typed-category confirmation (accept/override — the Epic 017
  contract); carries the 2A approval-flow re-validation E2E.
- `004-approval-tier-verbs.md` — approval-tier verb buttons (`github.merge`),
  including the expired-item state; carries the enforcement-observed E2E
  (ring-1 block + approval-required parking, driven from the UI).
- `005-broker-and-slots-views.md` — broker ops + verb registry (read-only),
  repo slots.
- `006-budgets-and-daemon-ops.md` — budgets + the override flow (reason
  required), daemon ops with verify trigger + report view.
- `007-per-feature-summary-view.md` — the per-feature metrics summary surface
  (headline, by-type breakdown, excluded count, cost) rendering the Epic 029
  Story 002 read method (review B4), with its own thin story-gated E2E
  (debate finding — the LP3-critical surface must not first meet the live
  daemon at the epic gate run).

## Verification Gate

Execution mode is fixed by SU7 decision (b): an **E2E suite**, not a
maintainer checklist — the epic gate run is `npm run typecheck:web` +
`npm run test:web` + the full `npm run e2e:web` against the pre-flight daemon
seeded with the golden fixture (PROFILE — `web e2e` runs in the Epic 027 gate
run; per-story it runs only where a Story's Verify names it).

- Every phases.md 2B dashboard surface **including the per-feature summary**
  renders correct data against a daemon seeded with the golden fixture
  (surface-by-surface, values spot-checked against the API — the same list
  Epic 026 gates method-by-method).
- The **2A approval flow re-validation**: the LP1-style approval/escalation
  loop is driven end-to-end from the dashboard (list → evidence → respond with
  a required category), matching phases.md's explicit requirement (Story 003
  E2E).
- Enforcement observed from the UI: one ring-1-blocked action surfaces as a
  blocked escalation, and one approval-required verb (`github.merge`) parks
  until approved — both driven from the dashboard (Story 004 E2E).
- Auth behavior from the client: an unauthenticated session cannot reach any
  surface; the connection is TLS on the Epic 026 bind (the server-side gate
  owns bind policy; the dashboard gate confirms the client path uses it)
  (Story 001 E2E).
- All dashboard traffic is the authenticated Epic 026 API (network inspection
  in the gate run: no other origin, no unauthenticated call).
- Plan files, registries, and yaml config are visibly read-only (no edit
  affordance exists).
- Design conformance holds across surfaces: every story review ran the
  DESIGN.md §P3 checklist clean, and the gate run spot-checks cross-surface
  consistency — one status vocabulary, the §7 state patterns, every surface
  mounted in the AppShell (design-system amendment 2026-07-03).
- Responsive holds (must-have — Ulrich 2026-07-03, iPad/iPhone use): the
  gate run repeats the surface spot-check at the standard phone viewport
  (iPhone 13 — 390×844, DESIGN §6) — nav reachable via the mobile shell, no
  page-body horizontal scroll, wide tables scrolling inside their
  containers.
- The build artifact is the Vite production bundle served per the SU7/PROFILE
  pre-flight arrangement; the gate-run notes record the run.

## Dependencies

- **SU7 bootstrap gate** (HARD dispatch precondition — the PROFILE web
  bootstrap incl. the hello-world pipeline run; Epic 020 SU7 Verify). Per the
  design-system amendment the bootstrap includes the design foundation
  (Tailwind + shadcn init, tokens, the DESIGN.md §5 foundation set).
- **Epic 026** (the full API + auth — the dashboard's only backend; the
  maintainer-generated Connect-Web client is the sole coupling point).
- `.agent/plan/feedback/027-web-dashboard/honest-classification-and-diff-policy.md`
  (2026-07-10 agentic-system review) — MUST fold in before `/work`:
  classification confirm/override as a first-class UI step on every respond
  action; diff-escalation policy read from config, not a literal.
- **Epic 029 Story 002** is a **dependency of Story 007** (review B4 — the
  summary surface is gate-critical: phases.md D9 puts it in the web client and
  Epic 030 LP3 is dashboard-exclusive). The earlier "optional/degraded render"
  note is narrowed to data, not API: a feature with **no data** renders the
  explicit empty summary; a missing/failing summary **method** is a defect,
  not a degraded render. Stories 001–006 do not depend on 029.
- **Dispatch ordering is explicitly partial** (debate finding — "001–006 don't
  depend on 029" must not read as "the epic can close without it"): Stories
  001–006 are dispatchable once the bootstrap gate, Epic 026, and Story 000
  hold (the shell they mount into — HD-D); Story 007 additionally waits on
  Epic 029 Story 002; the epic Verification Gate needs **all eight** stories
  (000–007), so Epic 027 as a whole closes only after Epic 029 Story 002 —
  that ordering is stated here, not left to the scheduler to infer.

## Non-Goals

- No plan authoring/editing, no registry/config editing (planning is external —
  PRD §1; yaml under git discipline; phases.md "out by design").
- No macOS/iOS/terminal clients, no UDS fast-path (PRD §11 out).
- No server-side logic of any kind — a pure client of Epic 026.
- No metrics portfolio/trend views (Phase 3 grows the dashboard; PRD §2).

## Findings Out

- Gate-run notes (E2E run record, network-inspection result) appended to
  `.agent/plan/feedback/027-web-dashboard/gate-run.md`.
- Any bootstrap-demo learnings that force a story change land as a decision
  record in `.agent/plan/feedback/027-web-dashboard/toolchain-decision.md`
  first — locked story files are not edited during implementation
  (`.agent/authoring.md`).
