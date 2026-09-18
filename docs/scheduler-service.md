---
title: Scheduler Service
---

# Scheduler Service

## Scope

This document describes the Scheduler Service.
It describes the work queue and its order, the work pull and the targeted claim, the execution record and its lease.
It describes the role and the count of a claimant.
It describes the intake of platform deliveries and the observer.
It describes no mechanism of another service.

## Topology and work queue

The [architecture](architecture.md#container-diagram) defines the deployment target.
One Scheduler Service serves every project of the daemon.
It starts and stops with the daemon.
It holds a bounded pool of scheduling processors.
A scheduling processor serves a work pull or handles a wakeup after an accepted change.
It returns to the pool after that short decision.
A waiting work pull or an instance that executes a node never occupies the processor.
A node that waits for a model call, a human review or a pull request never occupies the processor.
Scheduling concurrency and instance counts solve different bottlenecks.

The work queue is a component of the Scheduler Service with a public insert and a public delete, and the Mission Service is its caller.
The [Mission Service](mission-service.md#boundary) inserts and removes the entries of every affected node, including dependency and parent effects, in the transaction that commits the fact.
The work queue never holds an entry that the Mission state of its node contradicts.
After the commit the Mission Service wakes the Scheduler, and the Scheduler coalesces wakeups.
A peek reads the first entry of the order and removes nothing.
Project configuration changes and claim changes also trigger a recheck of the affected scope.
An idle project consumes no processor turn and loses no durable obligation.
Daemon shutdown stops new claims and preserves accepted delivery and execution obligations.

The Scheduler persists the work queue in the storage of the daemon, so its order survives a restart.
The work queue holds, per project, one entry for each claimable node, subject to the wait record in Claims, roles and counts.
A node is claimable when its Mission state and the readiness condition admit a claim.
The [Mission Service](mission-service.md#state-of-a-node) owns the node states.
`Available` admits a steps claim.
`Waiting` admits an evaluation claim under the [readiness condition](mission-service.md#readiness-condition).
`External.Requested` admits an evaluation claim under the [continuation condition](mission-service.md#continuation-condition).
No other state admits a claim.
Membership is not the Mission state `Available`: a claimable `Waiting` node is not `Available`.
An entry carries the node, its admitted kind of claim, its priority and a time-ordered identity.
The identity carries the creation time of the entry.
The Mission Service inserts the entry in the transaction that makes the node claimable.
It removes the entry in the transaction that moves the node out of that claimable state.
A release with further work creates a new entry.
A priority change keeps the identity, and a held-out entry keeps the identity.

The Scheduler orders entries by priority descending, then identity ascending.
The highest priority comes first, and the oldest entry comes first inside one priority.
Inside one priority, newer work never overtakes older work.
Across priorities, a human who raises the priority of a stream of work accepts that priority 0 waits.
Priority orders and never admits.
No priority and no age makes a `Blocked`, `Paused`, `Pending` or incompatible node claimable.
A targeted claim ignores the order, because the harness names its node.

Priority is an integer with a default of 0.
The [Mission Service](mission-service.md#mission-structure-and-nodes) owns the human act through the node API, its admission, its record and the reorder of the entry.
That section states the value of an absent priority.
The entry holds a copy of the recorded priority, and the Mission Service stays its source.
The Mission Service reorders the entry in the transaction that records the priority.
The [Mission Service](mission-service.md#mission-structure-and-nodes) states that an import carries no priority.

The queue writes follow accepted changes, and selection follows work pulls.
Neither path scans every project.
A large graph change affects many nodes, and the Mission Service writes their entries in its one transaction.
A wakeup for the affected scope wakes waiting work pulls.
A stale entry suggests a node and never authorizes it; the claim operation rechecks.

The Scheduler bounds processor time per project turn for both wakeup handling and claim handling.
One busy project cannot consume the pool.
This bound specifies no ordering policy across projects.
Work-pull progress requires compatible instances that pull and sufficient counts and processing time.
Scheduling state carries a project key, and each claim and count keeps that key.
The processor that handles a project is temporary.
Two processors that select the same node compete through the single claim operation.
Only one obtains the claim.
Coordination covers a short decision and never holds a project-wide lock during an execution.

The Scheduler Service supports 1,000 active projects on one daemon.
The fairness bound survives a noisy project that competes with quiet projects.
Three properties have bounds and measurements.
Discovery lag measures the interval from the commit of an accepted change to the handling of its wakeup.
Claim latency measures the interval from a work pull to a claim when work exists.
Intake refusal is the retryable response of the intake beyond a bounded inbox depth.
This document names no value for a bound.
The pool size and the limits follow the workload and the measurements.
The [Tracking Service](architecture.md#tracking-service) holds these measurements and decides nothing.

## Intake and observation

The Scheduler Service accepts platform deliveries through the API ingress of the daemon into a durable inbox.
A success acknowledgement follows durable acceptance, never an in-memory enqueue.
Acceptance promises no execution.
The intake operates when a project has no live worker instance.
Processing occurs at least once and produces idempotent effects.
The Scheduler recognizes a duplicate by source and platform delivery identity.
It deduplicates effects per project and per external object, because one delivery can concern several subscribed projects.
The Scheduler bounds payload size, queued deliveries and processing concurrency.
It bounds intake and observer processing separately from work-pull handling.
Beyond a bounded inbox depth, the intake refuses with a retryable response.
It never acknowledges a delivery and drops it.
Stored delivery content is minimal, has bounded retention and holds no credential.
Intake completion preserves every obligation whose effect lacks durable acceptance.
The delivery disposition names acceptance as an observation, acceptance as a human act, refusal or a duplicate.
The Scheduler retries no unauthorized request.

Before durable acceptance, the intake requests the delivery verification that the [Project Service](project-service.md#authorization-and-credential-custody) owns.
That section owns the source binding, the verification secret in custody and the verification operation with no requester identity.
The observer acts under the service identity whose resolution and single permitted operation class that section defines.
The observation obligation supplies the external object for that resolution.

The observer is a component of the Scheduler Service, not a worker instance.
Nothing dispatches the observer.
The scheduling processors execute the observer on an observation obligation.
The observer presents its [service identity](project-service.vocabulary.md#service-identity) and the external object.
It reads the state of that object through the [platform gateway](worker-service.md#platform-gateway-action-performer-and-mcp-server) of the Worker Service.
The observer folds that state into the observed state.
It writes the observation record to the Mission Service.
The [Mission Service](mission-service.md#evidence) owns the external object and the observation record.
It owns the transition on the accepted observation without platform interpretation.
The observer decides the observed state and never the outcome of the node.
The [Mission Service](mission-service.md#the-enforcement) owns observation admission without a node claim.
The Scheduler Service calls the platform implementation of the Worker Service to decode a delivery into the event types of that platform.
The scheduling core consumes that decoded delivery and interprets no platform payload.

An observation obligation is a Scheduler record with a lease and a recovery path.
It is not an execution: it holds no node claim and has no claimant with a role.
Liveness defines the lease for both an observation obligation and an execution.

The observer resolves a delivery to an external object by the repository binding and the address that the object names.
It then resolves the node and the attempt of that object.
Correlation never depends on the continued existence of the originating instance.
A repository binding alone is insufficient: projects share a repository, and one binding serves several external objects.
A remote object survives an attempt boundary.
A matching pull request identifier never attaches a delivery to the newest attempt by itself.
An ambiguous or out-of-order delivery reconciles against the external objects of the node.
The [Mission Service](mission-service.md#evaluation-and-assessment) owns currency checks, and its [attempt](mission-service.md#attempt) rules remain authoritative.

External input has three kinds.

- An observation of an external object.
- A human act on an existing node through the Mission authority path under a linked human identity.
- A request for new WHAT, which the Scheduler accepts as no scheduling request and which creates no node.

The human act is an unblock, a pause, a resume, an edit or an override.
The [Mission Service](mission-service.md#validation-criteria-and-authority) owns node writes and their authority.
Its [unblock](mission-service.md#the-unblock) requires human authority.
Delivery acceptance alone creates no claim, unblocks no node and starts no execution.
An authorized human act that a delivery carries invokes the Mission operation under the linked human identity.
A pull request change request produces an observation whose observed state is not the expected end state.
The [Mission Service](mission-service.md#state-transitions) owns the resulting block, and its [unblock](mission-service.md#the-unblock) opens the next attempt.
The Scheduler serves the node after that unblock.

Receiving a delivery is inbound; requesting an external action is outbound.
The [Mission Service boundary](mission-service.md#boundary) assigns the performance of the request of a required external action and its idempotency to the Worker Service.
A platform signature grants no authority to write WHAT, execute a node or override an outcome.

## Work pulls and targeted claims

A worker instance that can take work issues a work pull with an idempotent [request identifier](mission-service.vocabulary.md#request-identifier).
The [overview](overview.vocabulary.md) defines the worker instance, the execution and the act of executing a node.
The pull carries its worker binding identity and the runtime identity of the instance.
The [Project Service](project-service.md#resource-and-binding-model) owns the worker binding identity.
The Worker Service owns the runtime identity and vouches for its association with the binding inside the daemon.
The Scheduler checks the binding against the [binding set](project-service.md#configuration-lifecycle-and-consistency) of its project.
A caller cannot widen that scope with another project's identifier.
The [Project Service](project-service.md#authorization-and-credential-custody) authorizes resource operations, and a work pull is no resource operation.
That authorization starts at the first operation under the execution identity that the claim creates.

The work pull requires a fresh instance healthcheck and fewer live executions of the binding than its instance count.
The Worker Service produces the instance healthcheck and the compatibility declarations.
The Scheduler selects the first entry of the project's work queue that the claimant admits.
The match reads the node states that the worker declares, the exact worker name and the required node format of the worker.
It reads the node revision that the attempt pins or, before the first claim, the current revision.
The [Mission Service](mission-service.md#validation-criteria-and-authority) owns that revision selection.
The worker requests work and never authorizes its own claim.
Reviewer instances pull independently of instances that execute steps.
The [Mission Service](mission-service.md#evaluation-and-assessment) owns the restriction on the executing worker's choice of reviewer and reviewer instructions.
The [Mission Service](mission-service.md#mission-structure-and-nodes) restricts scheduling to initiatives and objectives, never tasks.

An external harness holds no worker binding, worker name, node state declaration, node format declaration or worker instance, so it cannot pull.
It names a node and requests a targeted claim under one of its client identities, with an idempotent request identifier.
The targeted claim passes the same node gate, its client identity's role and its execution count.
A wait record does not gate a targeted claim, and the response carries the wait fact.
Both acquisition paths use the attempt opening, revision pinning and claim endings in Claims, roles and counts.
The external harness hosts its own executions and never writes the execution record or authorizes its own claim.
kanthord creates no worker instance for an external harness.

The Scheduler serves a work pull in three ways.
A wakeup from the Mission Service makes the Scheduler serve the waiting work pulls of the project by the order of the work queue.
An idle Scheduler with entries left serves the waiting work pulls by the same order.
An on-demand request from a service of the daemon names a node that holds an entry, and the Scheduler serves that node to the next compatible work pull ahead of the order.
The on-demand request returns when the claim exists, it holds no claim of its own, and the Scheduler bounds its wait as it bounds a waiting work pull.

When no work matches, the Scheduler returns no work or waits asynchronously for a bounded period.
Waiting holds no lock, no processor permit and no node reservation.
The Scheduler bounds waiting-request counts and timeouts separately from claim handling.
An empty work pull opens no attempt, creates no execution and counts no live execution.
A no-work result ends the request, and a later request uses a new request identifier.
An instance retries with backoff, never with tight polling.
A Mission change, an accepted delivery or an ended execution of the binding triggers a recheck for a waiting pull.
The Scheduler rechecks every admission condition before it satisfies that pull.
A disablement of the binding takes effect while a request waits.

An instance healthcheck establishes no liveness, no idleness, no operation authorization and no proof of success.
An unreachable provider creates no block condition and authorizes no model or provider substitution.

## Claims, roles and counts

The claim operation is one atomic operation for both acquisition paths.
Only a work pull or a targeted claim invokes it.
Selection and claim form one acquisition operation without an unprotected gap.
The operation rechecks the Mission state, the readiness condition, the current configuration, the role and the count of the claimant.
It rechecks the exclusion of one claim per node that the [Mission states](mission-service.md#state-of-a-node) require.
A work pull adds the instance healthcheck and compatibility match; a targeted claim adds the named node and the client identity.
The operation counts the execution against the claimant's count and records the execution.
The [Mission Service](mission-service.md#state-transitions) performs the node transition and owns the [attempt opening](mission-service.md#attempt) and [revision pin](mission-service.md#validation-criteria-and-authority).
The claim operation serializes with a block, a pause, a graph or import change and a binding change.
The [Mission Service](mission-service.md#the-enforcement) requires refusal of a blocked node on both harnesses.

The execution record holds these fields.

- The execution identity that the claim mints.
- The project.
- The claimant: the worker binding and its instance, or the client identity of the harness.
- The node and its attempt.
- The pinned node revision.
- The lease.

The claim response returns these fields.
Every execution operation presents that execution identity, and the claim precedes every execution operation on the node.
This covers evidence, task assessments, task outcomes, evaluation assessments and invoked repository actions.
A retry after a lost response returns the original accepted result and creates no second execution or count.
The [request identifier](mission-service.vocabulary.md#request-identifier) of either acquisition path is scoped to the project and the claimant.
The operation recognizes an accepted identifier before admission and returns the accepted result.
An ended claim does not change that result.
An acknowledgement of an ended claim restores no authority.
A replayed delivery revives no claim.

The [Project Service](project-service.md#execution-configuration-and-instance-count) states that a claimant holds one role for its lifetime.
The node states that a worker declares give the role of its binding: `Available` gives the executor role, and `Waiting` and `External.Requested` give the reviewer role.
A worker declares the states of one role.
The project configures the role of each permitted client identity.
The [Mission Service](mission-service.md#state-transitions) owns the states that admit a claim, and a new worker declares its states without a change to a rule of the Scheduler.
The [overview](overview.md#external-harness) defines the two client identities of an external harness.
The Scheduler admits a steps claim from an executor and an evaluation claim from a reviewer.
This enforces the claimant separation that the [Mission Service](mission-service.md#evaluation-and-assessment) owns on both harnesses.
That section states the limit of kanthord's verification of separation within an external harness.
Only the orchestrator of the external harness communicates with kanthord.
It chooses its sub-agents and their prompts.
Every assessment from that harness names the client identity and the execution identity.

The [Project Service](project-service.md#execution-configuration-and-instance-count) owns the instance count of a worker binding and the execution count of a permitted client identity.
The Scheduler admits a claim only while the live executions of the claimant are fewer than its count.
The Scheduler counts executions per claimant; the Worker Service owns how an instance hosts an execution.
An ordinary claim debits no other budget.
The [Mission Service](mission-service.md#attempt) owns the two acts that open an attempt: a first claim and a human unblock.
The Scheduler introduces no project-wide cap.

A release ends the execution.
The [Mission Service](mission-service.md#state-transitions) routes a release by its execution-end fact or further work and leaves the attempt open.
A release that waits names the accepted fact that it waits for.
That fact has two forms.

- A terminal state of a named child set.
- An observation of an external object.

A reviewer release for a required external action that awaits a prerequisite names the observation that the action follows.
The Scheduler records the fact as a wait record and marks the entry as held out.
The Mission Service releases the held-out entry in the transaction that commits that fact.
Writing the wait record reads the current accepted facts at the release.
A fact that already holds satisfies the wait at once.
The write serializes with the transactions of the Mission Service for the project, so no intervening fact disappears.
The work queue maps a child change to the wait of its parent from the graph of the Mission Service.
A graph change that changes the named set rechecks the wait.
The wait record adds no Mission state and gates no admission.
The work-pull path rechecks the wait fact at the claim.
The continuation reaches a later work pull, never a pushed assignment.
A waiting parent holds no instance while it waits.

The [Mission Service](mission-service.md#state-transitions) owns the human pause, discard and success override transitions that end a live claim.
Those transitions also determine whether the attempt closes or stays open.
Its success override from `Executing` ends a live steps claim.
Its human pause from `Evaluating` ends a live reviewer claim.
The Scheduler revokes the claim at the Mission transition through the same path as a loss declaration.
It accepts the revocation before any later operation admission reads the claim state.
The [Project Service](project-service.md#configuration-lifecycle-and-consistency) owns completion against the remote of an operation that already holds admission.
The revoked execution leaves its claimant's count at revocation.

An instance-count change stops new admissions where the new count requires it.
The Scheduler counts live executions during the drain and treats no configuration edit as a discard of a node.

## Liveness

The lease records the validity of a claim or of an observation obligation: its expiry, the renewal that its holder performs, and the loss declaration.
An execution renews the lease of its claim while it executes, and it releases durably when it finishes or must wait.
The observer renews the lease of an obligation while it processes that obligation.
Renewal, loss declaration, release and completion serialize with each other.

An execution presents its execution identity, and a service establishes liveness from the claim state of that identity in the Scheduler Service.
The [Project Service](project-service.md#authorization-and-credential-custody) owns its claim-state read and the distinction between liveness proof and operation authorization.
A write under the identity of a stale execution fails the comparison with the current claim of the node.

Four signals stay separate.

- The instance healthcheck before a claim.
- The lease of a live claim.
- The observed progress that telemetry holds.
- The readiness condition of a node.

Log silence and a provider outage are not a failed assessment.
Revocation of a lost claim takes effect at the loss declaration, never at the replacement claim.
A loss declaration is an accepted fact that the Mission Service consumes through a transition.
Loss of a claim closes no attempt.
Lease expiry is not proof that the runtime stopped.
A stopped execution never publishes afterwards.
The Mission Service refuses current effect from a submission under a revoked claim.
The Project Service refuses an operation from a revoked claimant.
The lease and the loss declaration are the whole liveness contract of this document.
This document defines no further recovery rule, retry policy or budget beyond the count.
