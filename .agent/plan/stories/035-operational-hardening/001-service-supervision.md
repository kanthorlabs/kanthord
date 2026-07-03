# Story 001 - Service Supervision

Epic: `.agent/plan/epics/035-operational-hardening.md`

## Goal

`kanthord service` turns the daemon into a supervised service for the
SU3-decided environment, and SIGTERM shuts the daemon down gracefully inside a
bounded window — anything harder stays crash-recovery's job.

## Acceptance Criteria

- `kanthord service install` writes the unit for the SU3 target (launchd
  plist or systemd unit) containing: the daemon binary invocation, working
  dir, environment, log paths from config, the service user, restart-on-crash,
  and start-on-boot — content asserted against fixtures for **both** templates,
  with only the SU3 target claimed operated (the other is a generated
  template, stated in its header comment).
- `install` into an existing installation refuses without `--force`;
  installing the non-SU3 template requires an explicit `--experimental` flag
  (debate finding — an unproven template must not install by accident);
  `uninstall` removes exactly what install wrote; `status` reports
  **installation state** (installed/not-installed and the unit path) and says
  so — live supervisor state is explicitly out of its claim (debate finding —
  honest naming; operability evidence lives in the SU3 spike record) — each
  asserted against a temp prefix.
- On SIGTERM the **quiescence contract** holds (debate finding — "dispatch
  stopped" needs a state model, not a verb): no new task dispatch and no new
  broker submits are admitted; a submit already past its `submit_started`
  marker (Epic 032 Story 003) completes its ledger write before exit — the
  daemon never exits 0 inside the submit-ambiguity window; in-flight ops stay
  `in_flight` durably (polling resumes next boot); live sessions tear down
  through the Epic 006 respawn path (STATE checkpointed, tasks re-marked
  pending, **leases released** — debate finding: a clean stop must not rely
  on lease expiry); stores flush; exit 0 within the configured grace window.
- After a graceful shutdown, the next boot's state matches the pre-shutdown
  state on the PRD §7.7 respawn-equivalence fields — pending-task set, lease
  ownership, phase, injected STATE, op ledger — asserted field-by-field
  (debate finding — "resumes correctly" hid the contract), with no lost tasks
  and no duplicate ops (composed with the Epic 010 restart scenario).
- **Exit-code / restart-policy alignment** (debate finding — a non-zero stop
  exit must not fight the supervisor): a clean stop exits 0 and the generated
  unit's restart policy does **not** restart on it (restart on non-zero/crash
  only — asserted in both templates); a hung teardown (fake session that
  never completes) overruns the window and exits non-zero — deliberately
  crash-classified so the supervisor restarts and the crash path reconciles;
  a second SIGTERM during shutdown forces the same non-zero path. Exit-code
  semantics follow the SU3 operability-spike observations.

## Constraints

- Unit shape and paths per the SU3 decision file
  (`.agent/plan/feedback/035-operational-hardening/supervision-environment.md`)
  — the templates code against it, not against guesses.
- Tests never touch real launchd/systemd: `install` targets an injected
  prefix; signal handling is asserted in-process with injected fakes (Epic
  035 gate).
- Graceful teardown reuses the Epic 006 respawn/checkpoint path — no second
  teardown implementation (PRD §3.2 — one code path).

## Verification Gate

- `npm test` green for `src/ops/service.test.ts` and
  `src/daemon/shutdown.test.ts`; `npm run typecheck` exits 0.

### Task T1 - Unit generation + install/uninstall/status

**Input:** `src/ops/service.ts`, `src/cli/service.ts`,
`src/ops/service.test.ts`

**Action - RED:** Write tests: (a) generated launchd + systemd unit content
vs fixtures (restart-on-crash, start-on-boot, log paths, service user,
non-operated header marker); (b) install/refuse/force/uninstall/status against
a temp prefix.

**Action - GREEN:** Implement template generation and the service CLI against
an injected prefix.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Graceful shutdown

**Input:** `src/daemon/shutdown.ts`, `src/daemon/boot.ts`,
`src/scheduler/dispatch.ts`, `src/broker/submit.ts`,
`src/session/respawn.ts`, `src/daemon/shutdown.test.ts` (debate finding —
the quiescence contract touches admission, submit, and session owners; Input
is authoritative)

**Action - RED:** Write tests: (a) SIGTERM ⇒ quiescence contract holds (no
new admissions; a submit past `submit_started` reaches its ledger write
before exit; leases released; STATE written; stores flushed), exit 0 within
the window; (b) post-shutdown boot matches pre-shutdown state on the
respawn-equivalence fields (harness restart composition); (c) hung teardown
⇒ non-zero after window, next boot reconciles; (d) second SIGTERM ⇒
immediate non-zero path; (e) generated units restart on non-zero exit only,
never on a clean stop.

**Action - GREEN:** Implement the shutdown sequence over the existing boot
wiring and respawn path.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
