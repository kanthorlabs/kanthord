# Story 001 - In-Process Durable Events

Epic: `.agent/plan/epics/004-event-bus.md`

## Goal
Subsystems can publish and subscribe to events in process, while durable event types are appended to JSONL history before delivery.

## Acceptance Criteria
- A subscriber receives subscribed events in publish order.
- A throwing subscriber does not stop delivery to other subscribers and does not crash the publisher.
- Unsubscribe stops further delivery to that subscriber.
- An event type is declared durable or non-durable.
- Publishing a durable event appends it to JSONL history before the event is acked/delivered.
- If the durable write fails, publish fails and the event is not delivered unrecorded.
- A throwing subscriber never fails publish.
- After restart, the durable history file is readable and contains previously published durable events.
- Publishing a new event name works without changing the bus package.

## Constraints
- In-process bus only; no Redis or external broker (D5).
- eventemitter3 / Emittery is an implementation detail behind a thin seam.
- Durable history reuses Epic 002 jsonl append.
- Durability marking is typed/open event-name contract, not plugin registry machinery.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 004-SPIKE - Event library semantics

**Input:** spike note under `.agent/tdd/` or a findings note in the Story discussion.

**Action - RED:** none - spike.

**Action - GREEN:** Read the chosen library source and record sync vs async dispatch, ordering, and throw propagation.

**Action - REFACTOR:** none.

**Verify:** The spike note cites the source and names the chosen library semantics.

### Task 004-RED - Event bus tests

**Input:** `packages/core/src/**/*.test.ts` or the events package test home.

**Action - RED:** Add `node:test` coverage for publish order, throwing-subscriber isolation, unsubscribe, durable write-before-deliver, durable write failure, and reopen/readback of durable history.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because the event bus is missing.

### Task 004-GREEN - Event bus implementation

**Input:** `package.json`, `package-lock.json`, `packages/core/src/**` or the events package source home.

**Action - RED:** none - opened by Task `004-RED`.

**Action - GREEN:** Implement the event bus seam and durable history behavior so the Story ACs pass.

**Action - REFACTOR:** Keep durable persistence delegated to the Epic 002 jsonl append primitive.

**Verify:** `npm run typecheck && npm test` exits 0.
