# Story 006 - Budgets & Daemon Ops

Epic: `.agent/plan/epics/027-web-dashboard.md`

> **FOLDED IN (2026-07-15):**
> `.agent/plan/feedback/027-web-dashboard/daily-usage-operator-loop.md`
> Input 7 (dead-man health card renders "N tasks processed today" beside the
> last ping, as one glanceable card) is folded into the ACs and T2 below. The
> proto already exposes the count (`DeadManPing.tasks_processed`,
> `present==false until Epic 029 populates it`); until it is populated the UI
> renders the not-yet-available state. See `toolchain-decision.md`.

## Goal

The budgets surface (per-task ledger, circuit-breaker state, the recorded
override flow with a required reason) and daemon ops (health, dead-man ping
status, trigger `kanthord verify` + view its report).

## Acceptance Criteria

- The budgets view renders the per-task ledger and breaker state from the
  fixture; a recorded override is visible with actor, amount, and reason
  (phases.md 2B D6 — budgets surface; PRD §4 — override recorded).
- The override flow demands a reason string before submit (client-side block
  **and** the API's typed rejection rendered if bypassed); a rate-limited
  rejection renders as its typed error (Epic 026 — scoped override contract).
- Daemon ops renders health, last dead-man ping time + outcome (the Epic 029
  field via Epic 026), and a verify trigger; triggering verify invokes the
  `daemon.verify` method and renders the returned report (divergence list or
  clean).
- **Dead-man health card (Input 7):** the last dead-man ping renders as one
  compact glanceable health card showing the last ping time + outcome **and
  the processed count "N tasks processed today"** (`DeadManPing.tasks_processed`)
  — not a bare table row (a table row is not glanceable at 390px). The
  N==0-with-everything-up case (silent-idle, §6.3.1) is the dangerous line the
  count exists to surface; the count sits beside the ping so it is read
  together. When `present==false` (Epic 029 has not yet populated the count),
  the card renders the count as not-yet-available, distinct from a real "0".
- Empty/unknown states are explicit (e.g. no ping yet recorded renders "no
  ping recorded", not a blank).

## Constraints

- Pure client of Epic 026; component tests hermetic against the fake
  generated client (PROFILE web variant). The override's rate limit and
  scoping are server-owned; the UI renders outcomes only.
- Selection only via `clients/web/src/locators.ts` (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants). The override confirm consumes the
  `ConfirmActionDialog` composite Story 002 introduces.
- No E2E in this story — covered live by the epic gate run (PROFILE).

## Verification Gate

- `npm run test:web` green for `clients/web/src/budgets/**` and `clients/web/src/daemon-ops/**`.

### Task T1 - Budgets view + override flow

**Input:** `clients/web/src/budgets/Budgets.tsx`, `clients/web/src/budgets/Budgets.test.tsx`,
`clients/web/src/locators.ts`, `clients/web/src/components/status/BreakerStateBadge.tsx`,
`clients/web/src/components/status/BreakerStateBadge.test.tsx` (the DESIGN §4 domain
badge this surface introduces)

**Action - RED:** Component tests: ledger + breaker fixture renders; the
override form blocks submit without a reason; a successful override invokes
the method with reason and renders the recorded interaction; rate-limit
rejection fixture renders the typed error.

**Action - GREEN:** Implement the budgets view + override flow.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Daemon-ops view + verify trigger

**Input:** `clients/web/src/daemon-ops/DaemonOps.tsx`,
`clients/web/src/daemon-ops/DaemonOps.test.tsx`, `clients/web/src/locators.ts`,
`clients/web/src/components/templates/OpsPage.tsx`,
`clients/web/src/components/templates/OpsPage.test.tsx` (the DESIGN §6 template this
surface introduces)

**Action - RED:** Component tests: health + last-ping fixture renders as the
glanceable dead-man health card (and the no-ping-yet explicit state); the card
renders the processed count "N tasks processed today" from
`DeadManPing.tasks_processed` beside the ping, renders a real "0" distinctly
from the not-yet-available state (`present==false`), and the verify trigger
invokes `daemon.verify` and renders the report fixture (both a clean and a
divergence-list case).

**Action - GREEN:** Implement the daemon-ops view.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
