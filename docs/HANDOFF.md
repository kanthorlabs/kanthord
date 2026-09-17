# Handoff

Open work as of 2026-09-17.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Next session

- [ ] Write the Worker Service document: scope with Ulrich, then `/debate`, then `/pi`, then `/debate` review. Then the Tracking Service document. B9 is the last section, and only Ulrich opens it.

## Project Service

- [ ] Define the source-binding configuration for inbound provider deliveries, including webhook subscriptions and a Slack source with human identity mapping.
- [ ] State what a configured action follows: the passing assessment, or the expected end state of another configured action of the node. State how a policy on a binding of another kind, for example a channel, decides when a node requires its configured action, the repository strategy being the first such policy. Both wait for the notification policy design, because a notification lives on a channel binding that no page defines yet.

## Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and inbox depth in the implementation epics, against the 1,000-project workload.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Scheduler, Project and Mission: how a delivery is classified, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort.
- [ ] Add the skills and extensions that support external-harness integration.

## Worker Service

- [ ] Write the Worker Service document.
- [ ] Define runtime instance identity and whether instance records persist.
- [ ] Define how an instance hosts executions within its worker binding's instance count.
- [ ] Decide whether memory belongs to the worker template, the worker instance or the execution.
- [ ] Specify external-request idempotency and external-object reuse and correlation across node attempts.
- [ ] State that a configured action takes its operands from the records of the attempt, the evidence snapshot and the external object, never from the worker.

## Tracking Service

- [ ] Write the Tracking Service document after the Worker Service document.

## B9, failure and recovery

Deferred cross-service work across Mission, Scheduler, Worker and Project.

### Policy and budgets

- [ ] Decide which failures permit automatic continuation and what authorizes a further node attempt.
- [ ] **SC3 / SC4:** Define resumption charging, exactly one debit per loss under repeated notices, whether a clean release avoids a charge, and budget reset authority, including whether a fresh evaluation identity resets its allowance.
- [ ] **A7 / B3:** Decide whether exhaustion of a resumption or evaluation-retry budget closes the attempt, publishes an outcome and gives that outcome current effect.
- [ ] Define the publisher and meaning of an outcome when an evaluation produces no assessment.

### Mission Service

- [ ] Specify the reviewer-loss transition out of `Evaluating` that permits a bounded retry.
- [ ] **B2:** Define recovery and its budget when the currency check rejects a completed assessment as stale.
- [ ] **B4 / B5:** Settle exhaustion-notice precedence after an accepted assessment and during a human override that asserts failure.
- [ ] **C3:** Define the deduplication key for an observation of an unchanged external state.
- [ ] **C5:** Decide how to handle a platform state that reverses after an accepted observation.
- [ ] **C6:** Decide how to handle an external request for which no end state ever arrives.
- [ ] **D1:** Specify recovery of an interrupted attempt closure that wrote only some owed outcomes, including idempotency, resumption and the recovery owner.
- [ ] **E2:** Confirm precedence when a non-success human override is followed by a successful machine outcome.
- [ ] **E3:** Settle human pause or discard races with completion.

### Scheduler Service

- [ ] **C1:** Specify recovery of an observation obligation when the observer is lost before recording the observation.
- [ ] **SC5:** Define physical-stop enforcement and safe resource and capacity reuse when a runtime returns after a loss declaration.

### Worker and Project Services

- [ ] **A3 / W1 / W4 / PR2:** Specify reconciliation of repository actions with uncertain results, including remote effects that complete after revocation, and what happens when reconciliation cannot establish the result.
- [ ] **W2:** Specify how a worker records a durable action identity before performing a repository action.
- [ ] **W3:** Specify how a worker retrieves the acknowledgement of a write whose response it lost.
- [ ] **W5:** Specify worker stop behaviour after claim revocation, including repository operations and release of runtime resources.
- [ ] **W7:** Specify how a reviewer resumes an incomplete evaluation without repeating node execution or a repository action.
