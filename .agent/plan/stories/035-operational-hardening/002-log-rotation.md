# Story 002 - Log Rotation

Epic: `.agent/plan/epics/035-operational-hardening.md`

## Goal

Structured logs rotate and are retained by policy, and a rotation problem can
never take the daemon down.

## Acceptance Criteria

- `pino` output rotates per the SU3-decided mechanism when the configured
  size or age threshold is crossed; the active file is always the configured
  path; rotated files follow the documented naming (asserted on a temp log
  dir with a driven size/clock).
- Retention keeps the configured number of rotated files and deletes older
  ones (asserted across multiple rotations).
- Rotation state survives a daemon restart: a restart mid-window neither
  restarts the age window from zero nor re-rotates an already-rotated file
  (asserted).
- The degraded mode is precise (debate finding — "degrade to stderr" needs a
  recovery model): on a rotation/open error, `pino` writes to stderr only;
  reopening the configured path is retried on an interval; **one journal
  event per failure episode** (entering degraded), one on recovery — not one
  per write; if the journal write itself fails on the same filesystem fault,
  stderr carries the event alone — the daemon continues serving (asserted
  with an injected failure + recovery).
- Structured log records parse as records before and after a rotation
  (debate finding — rotation must not corrupt the structured stream).
- Rotation state derives from the rotated files' names/timestamps — no
  separate metadata store that could disagree with the files (debate
  finding on atomicity).
- Log config (path, size/age thresholds, retention count) validates at load
  against the concrete bounds named in the SU3 decision file; out-of-range
  values are a config load error naming the field and the bound (tests use
  concrete accepted/rejected values from that file — debate finding).

## Constraints

- The SU3 mechanism decision governs the implementation (pinned rotation
  transport vs reopen-signal support); the story codes against the decision
  file, and the non-chosen mechanism is not half-built.
- Extends the existing `pino` wiring — one logger, no parallel logging path
  (PROFILE idiom; Epic 035 anchor).

## Verification Gate

- `npm test` green for `src/ops/log-rotation.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Rotation + retention + resilience

**Input:** `src/ops/log-rotation.ts`, `src/daemon/boot.ts`,
`src/foundations/registry.ts` (config schema entries only),
`src/ops/log-rotation.test.ts`

**Action - RED:** Write tests: (a) size- and age-triggered rotation with the
documented naming on a temp dir; (b) retention pruning across rotations;
(c) restart preserves rotation state derived from file names/timestamps
(both no-restart-of-window and no-double-rotate); (d) injected rotation
failure ⇒ stderr-only degrade, one episode journal event, recovery reopens
and journals once, daemon serving throughout; (e) records parse before and
after rotation; (f) config validation errors name field + bound with
concrete SU3 values.

**Action - GREEN:** Implement rotation/retention per the SU3 mechanism over
the existing logger wiring.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
