# 035 Operational Hardening — Supervision & Log Rotation

## Outcome

The daemon becomes a supervised service instead of a foreground process:
`kanthord service` generates and installs the launchd/systemd unit for the
SU3-decided environment (restart-on-crash, start-on-boot, correct paths and
service user), SIGTERM performs a **graceful shutdown** (dispatch stopped,
sessions torn down through the existing respawn path, stores flushed, clean
exit within a bounded window — anything harder stays the crash-recovery
path's job), and structured `pino` logs rotate by the SU3-decided mechanism
with size/age policy and bounded retention. The live "crash mid-feature
recovers unattended" claim is Epic 042's chaos check; this Epic ships the
machinery it exercises.

## Decision Anchors

- phases.md Phase 3 Deliverable 2 — "launchd/systemd supervision, structured
  log rotation (PRD §3.1)".
- PRD §3.1 — supervision: launchd/systemd restart-on-crash; structured logs
  with rotation; crash-restart handles the daemon dying (the dead-man ping —
  Epic 029 — covers silently-idle).
- Epic 031 SU3 — the operated supervisor and the rotation mechanism are
  decided there, and the **supervisor operability spike** recorded there is
  the evidence unit-file fixtures cannot provide (debate finding — fixtures
  prove serialization, not operability); this Epic's exit-code semantics code
  against those observations. The non-operated supervisor's unit stays a
  generated-but-unproven template (stated, not hidden; `--experimental` to
  install).
- PROFILE idiom — `pino`, never `console.log`; rotation extends the existing
  logger wiring, no second logging path.

## Stories

- `001-service-supervision.md` — `kanthord service install|uninstall|status`
  generates the unit for the SU3 target (binary path, env, log paths, service
  user, restart-on-crash, start-on-boot) and installs it; SIGTERM: halt
  dispatch, tear down live sessions via the Epic 006 respawn path (STATE
  checkpointed), flush stores, exit 0 inside the configured grace window; a
  second SIGTERM or window overrun exits non-zero and leaves recovery to the
  crash path.
- `002-log-rotation.md` — `pino` output rotates per the SU3 mechanism on the
  configured size/age policy; retention keeps the configured count and deletes
  older files; rotation state survives a daemon restart; log writes never
  block the daemon on rotation errors (degrade to stderr with a journal
  event).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (unit
  generation asserted on content; signal handling asserted in-process with
  injected fakes; no root/system mutation in tests — `install` targets a temp
  prefix under test).
- The generated unit for the SU3 target contains restart-on-crash,
  start-on-boot, the configured log paths, and the service user from the
  decision file (asserted against fixtures for both launchd and systemd
  templates; only the SU3 target is claimed operated).
- SIGTERM during a running fake session: the quiescence contract holds (no
  new admissions, submit-ambiguity window drained to the ledger, leases
  released, STATE written), exit 0 within the grace window — and the next
  boot matches the pre-shutdown state on the respawn-equivalence fields
  (composed with the Epic 010 restart scenario; debate finding — the
  contract is field-level, not "resumes correctly").
- SIGTERM overrun (a hung fake session) exits non-zero after the window; the
  next boot's crash-recovery path reconciles (asserted via the harness).
- Log files rotate at the configured size on the fake clock/size driver;
  retention prunes to the configured count; a rotation error degrades to
  stderr + journal event without dropping the daemon.

## Dependencies

- **Epic 031 SU3** (environment + mechanism decision — the decision file is
  this Epic's input contract).
- **Epic 009** (daemon boot/shutdown wiring), **Epic 006** (respawn path),
  **Epic 010** (restart scenarios — composed).

## Non-Goals

- No multi-daemon or remote deployment tooling (PRD §11 out).
- No log shipping/aggregation — rotation and retention only.
- No live chaos assertion — Epic 042 LP3 owns "crash mid-feature recovers
  unattended" in the real environment.

## Findings Out

- none. The unit templates and rotation policy are config + code documented in
  place.
