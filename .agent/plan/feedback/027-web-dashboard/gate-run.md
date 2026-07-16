# Epic 027 Verification Gate Runs

## 2026-07-15

Verdict: **FAIL - Epic 027 remains open.** The automated gate is green, but
the binding manual gate found maintainer-owned API gaps that prevent all
required surfaces from mounting with live data.

### Automated Gate

- `npm run typecheck:web`: PASS.
- `npm run test:web`: PASS, 37 files / 400 tests.
- `npm run e2e:web`: PASS, 14/14 Playwright tests across desktop Chromium and
  iPhone 13 (390x844). The command built the production Vite bundle, booted an
  isolated live daemon/store through `scripts/web-e2e-preflight.mjs`, served
  the SPA and Epic 026 API on one ephemeral TLS origin, and cleaned up.
- Supporting core verification for the live inbox mapping: `npm run
  typecheck` PASS and `npm test` PASS, 1190/1190 tests.

### Live Data Spot-Check

- Features: `feat-001`, `Golden feature`, `in_progress`, `coding`, `1/3 tasks
  satisfied`.
- Drill-down: three task rows, DAG `1/3` nodes and `1/1` edges, live
  `deploy_service` operation, Golden STATE and JOURNAL content.
- Inbox: four escalation fixtures and two parked `github.merge` approval
  fixtures with attached evidence/context.
- Broker and registry: live in-flight/pending groups; `deploy_service` auto and
  `github.merge` approval-required entries.
- Slots: `/repos/kanthord`, worktree strategy, held lease and active session.
- Budgets: task spend `$11`, ceiling `$20`, breaker `closed`.
- Daemon ops: no-ping state; verify mutation returned `pass` with the seeded
  report.
- Feature summary: `4 human interactions, $11`; approval 2, clarification 1,
  correction 1; excluded 1.
- Plan flows: FAIL. Sign-off, halt, and re-plan controls each had zero mounted
  elements on the live feature drill-down.

### Network Inspection

- PASS for the mounted surfaces after the authenticated-runner header fix.
- Every browser API response was same-origin TLS under
  `/kanthord.v1.DaemonService/*`, authenticated, and HTTP 200.
- No API call targeted another origin. Static navigation and Vite assets came
  from the same TLS origin.
- The explicit unauthenticated browser context rendered `auth-required` and no
  feature surface.

### Read-Only And Design Checks

- PASS: STATE/JOURNAL and broker registry showed no input, textarea,
  content-editable, Edit, or Save affordance.
- PASS: mounted feature, inbox, broker, slot, budget, ops, approval, and summary
  surfaces use the shared AppShell and domain status badge vocabulary.
- FAIL: no YAML configuration read surface exists, so its required read-only
  state cannot be checked.
- FAIL: Story 002 plan-flow surfaces are not mounted in AppShell.
- FAIL: the required template data-freshness pattern (`Updated HH:MM` plus
  manual refresh) is absent from the mounted page templates.

### Responsive Spot-Check

- PASS at 390x844 for Features, Inbox, Broker, Slots, Budgets, and Ops.
- Mobile toggle and off-canvas navigation links were reachable.
- No route had page-body horizontal scroll (`scrollWidth == clientWidth ==
  390`).
- Wide feature, inbox, slot, and budget tables exceeded their 358px containers
  and scrolled in an `overflow-x: auto` ancestor. Broker remained within its
  container for this fixture.

### Blockers

- <B1> - action:NO - NEEDS-HUMAN: live re-plan proposal seam - Story 002's
  `ReplanApproval` needs the authored diff, base generation, and edits, but the
  maintainer-owned Epic 026 proto exposes only the approval write. A maintainer
  must define the proposal read model and actor source before sign-off, halt,
  and re-plan controls can be mounted correctly.
- <B2> - action:NO - NEEDS-HUMAN: YAML configuration read seam - The binding gate
  requires a visibly read-only YAML config surface, but the maintainer-owned
  API has no safe config read method and the SPA has no route. A maintainer
  must define which configuration is safe to expose.
- <B3> - action:YES - data freshness pattern - `ListPage`, `DetailPage`, and
  `OpsPage` do not provide DESIGN sections 6/7 `Updated HH:MM` and manual
  refresh affordances.

Epic 027 must not be marked closed until B1 and B2 have maintainer decisions,
their regenerated clients and live implementations land, and this gate is
rerun cleanly.

## 2026-07-15 Rerun

Verdict: **PASS - Epic 027 verification gate is green.** The three prior
blockers are closed and the expanded live E2E suite covers their production
paths on desktop Chromium and iPhone 13.

### Automated Gate

- `npm run typecheck`: PASS.
- `npm test`: PASS, 1200/1200 core tests.
- `npm run typecheck:web`: PASS.
- `npm run test:web`: PASS, 39 files / 427 tests.
- `npm run build:web`: PASS; Vite production bundle built successfully.
- `npm run e2e:web`: PASS, 31 passed and one intentional desktop skip for the
  iPhone-only overflow assertion. The command built the production bundle,
  booted an isolated real daemon/store, served the SPA and Connect API on one
  authenticated TLS origin, ran both Playwright projects, and cleaned up.

### Closed Blockers

- Durable re-plan proposals are stored in SQLite and read through the generated
  Connect client. Approval consumes only server-stored edits, applies them once,
  returns the re-opened task IDs, and removes the proposal from pending reads
  only after success.
- The feature Controls tab mounts live sign-off, confirmed halt, and re-plan
  approval flows. Isolated desktop/mobile fixtures execute all three flows and
  verify generation, actor, conflict-safe approval, and re-opened task output.
- Configuration is loaded from the git-owned public policy YAML and checked-in
  broker verb declarations. The API projects only typed allowlisted fields;
  the Ops card renders normalized read-only YAML with no edit affordance.
- `ListPage`, `DetailPage`, and `OpsPage` own `Updated HH:MM` plus manual
  refresh. Refresh retains current content, shows an inline pending spinner,
  records refresh errors, and never polls. Successful controls refetch the
  affected feature view.

### Live And Network Checks

- Features, feature detail, summary, inbox response, ring-1 escalation,
  approval-required merge, broker operations/registry, slots, budgets, daemon
  health, verify report, configuration, and all plan controls rendered live
  golden data.
- Connect requests were inspected in-browser: every observed RPC used the same
  TLS origin, carried the configured authorization header, and returned HTTP
  200. The unauthenticated context rendered only the auth-required surface.
- Plan STATE/JOURNAL, broker registry, and public configuration remained
  non-form read-only surfaces with no input, textarea, content-editable,
  Edit, Save, or Upload affordance.
- At 390x844 the mobile navigation remained reachable, the page body had no
  horizontal overflow, and the wide budget table scrolled inside its own
  `overflow-x: auto` container.

### Review

- Final read-only review verdict: PASS, no blockers.
- S1 - action:NO - residual crash-atomicity gap - Authored-file writes and the
  SQLite proposal lifecycle cannot be one atomic transaction. A crash between
  those effects still needs a later architecture decision; this does not block
  Epic 027's normal success/conflict acceptance criteria.
