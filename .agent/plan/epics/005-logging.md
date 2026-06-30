# 005 Logging

## Outcome
Add structured operational logging via pino to rotating JSONL files, strictly separate from audit/events/state records.

## Decision Anchors
- §3 Logging: pino structured operational logs.
- B6: operational logs split from audit/events/state.
- D5: file-based, in-process.
- D2: no native modules.
- §5: `logs/` dir.

## Stories
- `.agent/plan/stories/005-logging/001-operational-jsonl-logs.md` - pino operational JSONL, rotation, retention, config level, and destination split.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- Native guard remains green.

## Dependencies
- Epic 001.
- Epic 003 for log level from config.
- Epics 002/004 for audit/events/state destination split reference.

## Non-Goals
- No external shipper or cron.
- No crash-durable operational logging guarantee.
- Secret redaction lands in Epic 008 when secrets exist.

## Findings Out
- none
