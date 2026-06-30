# 004 Event Bus

## Outcome
Provide an in-process publish/subscribe bus with write-before-deliver durable JSONL history for durable event types.

## Decision Anchors
- §1 Event-driven.
- §3 Event Bus: eventemitter3 / Emittery.
- D5: no external broker.

## Stories
- `.agent/plan/stories/004-event-bus/001-in-process-durable-events.md` - ordered delivery, subscriber isolation, unsubscribe, durable write-before-deliver history.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.

## Dependencies
- Epic 001.
- Epic 002 for jsonl append durable history.

## Non-Goals
- No external broker.
- No durable replay onto the bus in v1.
- No agent lifecycle event vocabulary yet.

## Findings Out
- none
