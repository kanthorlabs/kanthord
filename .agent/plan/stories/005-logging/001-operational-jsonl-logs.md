# Story 001 - Operational JSONL Logs

Epic: `.agent/plan/epics/005-logging.md`

## Goal
Core writes structured operational logs to rotating JSONL files under `logs/`, while audit/events/state records stay under `database/` via their owners.

## Acceptance Criteria
- Operational logs are structured jsonl with at least level, timestamp, and message.
- Operational logs are written under `logs/`.
- Operational log files rotate by size and/or age.
- Default retention keeps the last 7 rotated files and is config-overridable.
- Operational records land only in `logs/`.
- Audit/events/state records land only in `database/` via their owners.
- A test writing one operational record and one audit/event/state record proves they do not cross directories.
- Operational log level is set from config.
- Invalid log level is caught by config validation.

## Constraints
- Use pino for operational logging (§3).
- pino has no write path into `database/` (B6).
- Rotation is file-based, in-process, and under `logs/` (D5).
- pino and rotation dependencies must be pure JS with no native `.node` (D2).
- Operational logs are best-effort; crash-durable flush is not required.

## Verification Gate
- `npm run typecheck`
- `npm test`
- native guard passes.

### Task 005-SPIKE - Pino and rotation dependency check

**Input:** spike note under `.agent/tdd/`.

**Action - RED:** none - spike.

**Action - GREEN:** Confirm pino and the chosen rotation path are pure JS and that rotation works on the Podman `.data/logs` mount, reusing Epic 002 findings when sufficient.

**Action - REFACTOR:** none.

**Verify:** Spike note records the dependency and mount behavior.

### Task 005-RED - Operational logging tests

**Input:** `packages/core/src/**/*.test.ts` or the logging package test home.

**Action - RED:** Add `node:test` coverage for jsonl shape, rotation/retention, config log level, and `logs/` vs `database/` destination split.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because operational logging is missing.

### Task 005-GREEN - Operational logger

**Input:** `package.json`, `package-lock.json`, `packages/core/src/**` or the logging package source home.

**Action - RED:** none - opened by Task `005-RED`.

**Action - GREEN:** Implement the pino operational logger, file rotation, retention, and config-level integration.

**Action - REFACTOR:** Keep audit/events/state writes out of the operational logger API.

**Verify:** `npm run typecheck && npm test` exits 0.
