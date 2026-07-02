# 027 Web Dashboard — Control-Plane UI (BLOCKED DRAFT — not a finalized epic)

> **STATUS: BLOCKED DRAFT (debate finding — a TDD epic with no dispatchable
> stories must not present as finalized).** PROFILE.md defines a single `core`
> variant and states the Web SPA "ships from separate bakes," so this work
> **cannot be dispatched through the current TDD pipeline**; `/work` must not
> pick it up. Epic 020 SU7 records Ulrich's decision (separate SPA pipeline /
> new `web` variant in PROFILE.md / maintainer-built outside the loop) and must
> demonstrate the chosen path executable. This file freezes the
> decision-independent requirements — the deliverable, surfaces, invariants,
> and provisional gate — so the second authoring pass (after SU7) has bounded
> discretion. It graduates to a finalized epic only when real story files with
> authoritative Task Inputs exist per `.agent/authoring.md`.

## Outcome

The MVP UI: one dashboard over the Epic 026 API where the human sees and
controls everything the daemon owns — features (list, drill-down, sign-off,
halt, re-planning diff approval), the escalation/approval inbox with evidence
and approval-tier verb buttons, broker operations and the verb registry
(read-only), repo slots, budgets with breaker state and the recorded override,
and daemon ops (health, dead-man status, trigger verify + view its report).
The dashboard **invokes only the authenticated Epic 026 API operations, which
enforce the three rings server-side** — the client-side claim is scoped to
"nothing else is called", and the gate must demonstrate the enforcement is
real from the UI (at least one ring-1-blocked action and one approval-required
action driven from the dashboard; debate finding — the UI cannot itself
provide enforcement, so the gate proves it observes it). Plan files and
registries render read-only by design.

## Decision Anchors

- phases.md Phase 2B Deliverable 6 — the surface list, "no privileged bypass",
  read-only plan/registry views, Basic auth over TLS on the VPN interface, and
  the requirement that the 2A approval flow is **re-validated through this
  dashboard**.
- PRD §3 Layer 3 — web client first; all clients connect to the daemon.
- PRD §7.5 — re-planning diff approval is a human flow the UI must carry.
- Epic 020 SU7 — the toolchain/pipeline decision this Epic is blocked on.
- Epic 026 — the complete API; the dashboard adds no server logic.

## Stories

> Story files are authored when SU7 resolves (their Task `Input` lanes depend on
> the chosen pipeline). The behavior slices below are deliberately **small**
> (debate finding — broad slices would give the second authoring pass too much
> discretion):

- `001-features-list-and-drilldown` — features list; per-feature drill-down
  (live task status, DAG progress, in-flight ops, STATE/JOURNAL views).
- `002-plan-flows` — sign-off; halt; re-planning diff approval (each with its
  error/conflict states rendered).
- `003-inbox-and-responses` — the escalation/approval inbox with evidence
  rendering and typed-category confirmation (accept/override — the Epic 017
  contract).
- `004-approval-tier-verbs` — approval-tier verb buttons (`github.merge`),
  including the expired-item state.
- `005-broker-and-slots-views` — broker ops + verb registry (read-only), repo
  slots.
- `006-budgets-and-daemon-ops` — budgets + the override flow (reason required),
  daemon ops with verify trigger + report view.

## Verification Gate

> Provisional until SU7 fixes the execution mode (E2E suite vs maintainer
> checklist); the criteria themselves are fixed (debate finding — tightened
> from "reachable and functional"):

- Every phases.md 2B dashboard surface renders correct data against a daemon
  seeded with the golden fixture (surface-by-surface, values spot-checked
  against the API — the same list Epic 026 gates method-by-method).
- The **2A approval flow re-validation**: the LP1-style approval/escalation
  loop is driven end-to-end from the dashboard (list → evidence → respond with
  a required category), matching phases.md's explicit requirement.
- Enforcement observed from the UI: one ring-1-blocked action surfaces as a
  blocked escalation, and one approval-required verb (`github.merge`) parks
  until approved — both driven from the dashboard.
- Auth behavior from the client: an unauthenticated session cannot reach any
  surface; the connection is TLS on the Epic 026 bind (the server-side gate
  owns bind policy; the dashboard gate confirms the client path uses it).
- All dashboard traffic is the authenticated Epic 026 API (network inspection
  in the gate run: no other origin, no unauthenticated call).
- Plan files, registries, and yaml config are visibly read-only (no edit
  affordance exists).
- The build artifact is served/deployed per the SU7 decision; the execution
  mode is recorded in the gate run notes.

## Dependencies

- **Epic 020 SU7** (HARD BLOCKER — pipeline/toolchain decision, demonstrated
  executable).
- **Epic 026** (the full API + auth — the dashboard's only backend).
- Epic 029's per-feature summary is **optional/degraded render** (an absent
  summary renders an empty state) — NOT a dependency, so 029 is off this
  epic's critical path (debate finding).

## Non-Goals

- No plan authoring/editing, no registry/config editing (planning is external —
  PRD §1; yaml under git discipline; phases.md "out by design").
- No macOS/iOS/terminal clients, no UDS fast-path (PRD §11 out).
- No server-side logic of any kind — a pure client of Epic 026.
- No metrics portfolio/trend views (Phase 3 grows the dashboard; PRD §2).

## Findings Out (open items — debate finding: "none" hid known risks)

- The SU7 decision file (pipeline, location, gate mechanics, executability
  demo) — governs the second authoring pass.
- Open at draft time: no story files exist; the gate execution mode (E2E vs
  checklist) is unfixed; the client-side security verification depends on the
  chosen toolchain. Each is resolved by the second authoring pass and recorded
  there.
