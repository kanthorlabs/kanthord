---
title: Scheduler Service Implementation
---

# Scheduler Service Implementation

This file holds the implementation rulings for the mechanisms that realize [scheduler-service.md](scheduler-service.md).
This file is not a design document, and `scheduler-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.

## The identities of the Scheduler Service

The identities follow the identity convention of [architecture.impl.md](architecture.impl.md#the-identity-and-the-time).

- An execution uses `execution_<ulid>`. The claim operation mints it.
- A job uses `job_<ulid>`. The public insert of the work queue mints it inside the transaction of the Mission Service that inserts the first job of a node, and the ULID carries the creation time that the [work queue](scheduler-service.md#topology-and-work-queue) requires.
- The table `scheduler_queue_place` holds the identity of the first job of each node. Each later job of that node keeps that identity and thus the queue place of the node.
- A claim takes no identity of its own: the execution record is the record of the claim, and it holds the fixed deadline.
- The trace identity and the root span identity of an execution are protocol-defined identities of the Tracking Service, and no entity identity of the Scheduler Service.

## Operation contracts

- Every Scheduler route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging), the [default 30 s timeout](gateway-service.impl.md#cancellation) and the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits) unless a row below says otherwise.
- `scheduler.work.pull` at `POST /api/scheduler/work/pull` is a `client` mutation of `wait` lifetime. Its route timeout is 120 s and its wait window is 90 s. Cancellation ends the wait and no accepted claim.
  - The handler runs the full claim in a [probe transaction](architecture.impl.md#the-operation-and-its-two-entry-adapters) at the start and after each wait. The probe and the commit that follows it use one `now` value.
  - A probe or a commit that reaches admission takes its own instance healthcheck.
  - The handler commits after a probe that finds a `running` execution, a new claim, a failed healthcheck or a loss settlement, and at the end of the wait window.
  - The commit runs the full claim again. After quiescence starts, the commit settles losses and claims nothing.
- `scheduler.execution.release` at `POST /api/scheduler/execution/:execution_id/release` is a `client` mutation of `unary` lifetime.
- `scheduler.claim.get` at `GET /api/scheduler/claim/:execution_id` is a `client` read of `unary` lifetime with no body.
- `scheduler.queue.list`, `scheduler.queue.peek`, `scheduler.execution.list` and `scheduler.execution.get` are `human` reads of `unary` lifetime with no body, at the routes that the [CLI page](../../engine/docs/cli/scheduler.md#command-inventory-and-operation-mapping) lists.
- `scheduler.eligibility.get` at `GET /api/scheduler/project/:project_id/eligibility/:node_id` is a `human` read of `unary` lifetime with no body, under [The eligibility report](#the-eligibility-report).
- `scheduler.execution.get` and `scheduler.claim.get` answer 404 `scheduler.execution.not_found` for an execution identity that no row holds.
- A field bound of a schema is declared with that schema, and the body limit bounds nothing at the field level.

Every timestamp composes the shared millisecond scalar, every identity composes its prefix schema, every object is closed, and `null` is valid only where a field says so.

- `Job` holds `job_id`, `project_id`, `node_id`, `priority` and `queued_at`.
  - `priority` is the signed safe integer that the job copies from the Mission Service.
  - `queued_at` is the time of the insert of the job. Each later job of a node holds the time of its own insert.
- `ExecutionRecord` holds `execution_id`, `project_id`, `node_id`, `claimant`, `attempt`, `pinned_revision`, `node_branch`, `credentials`, `agent_selections`, `claim_state`, `expired_at`, `created_at`, `ended_at`, `stop`, `trace_id` and `root_span_id`.
  - `claimant` holds `worker_binding_id`, `resource_identity` and `runtime_identity`, and for a registered instance also `client_id` as `client_identity_<ulid>` and `name` as the display name of 1 to 64 nonblank characters, which the Scheduler reads from the registration of `runtime_identity` through the Worker Service.
  - `worker_binding_id` is the latest row of the group `(project_id, resource_identity)` at the claim. The claim reads it through the Project Service in its transaction, and every use of the execution reads the configuration of that row.
  - `attempt` and `pinned_revision` are positive safe integers.
  - `node_branch` is the node branch of the attempt. The Scheduler stores no node branch. It derives the value from the attempts of the Mission Service through the `MissionBranches` port, as [the attempt](mission-service.impl.md#the-attempt) states. `nodeBranchesOf(tx, keys)` answers one branch for each `{ node_id, attempt }` key, in key order. The execution record, the claim answer and `ExecutionClaim` carry the derived value, and a list derives the branches of one page with one call.
  - `credentials` is the list of the credential row identities that the execution pins, `[]` at the claim.
  - The Scheduler Service offers `pinCredential(tx, executionId, credentialId)` and `liveExecutionsPinning(tx, credentialId)` to custody through its `contract.ts`. The first appends one identity to a live execution, and the second reads the live execution rows alone.
  - `agent_selections` is the list of the selections of the execution, one for each native agent of the worker. The claim health check refuses a claim when any agent configuration is invalid, so every native agent of a claimed execution holds a pin. It is `[]` for a worker with no native agent. A null column reads as `[]`.
  - The column stores pins, `{ agent_name, enablement_id, position }`. `enablement_id` is the identity of the enablement revision that the claim selected, and `position` is the chain position.
  - The Scheduler rebuilds each selection from two immutable rows: the worker binding row that `worker_binding_id` pins and the enablement revision that the pin names. The `AgentChains` port does the rebuild. Every read of the execution answers the same selections.
  - A selection holds `agent_name`, `position`, `level`, `agent_provider`, `provider`, `credential`, `model_identifier` and `reasoning_effort`. `level` is `enablement | binding`.
  - `claim_state` is `running | lost | finished`, derived under [Liveness](scheduler-service.md#liveness).
  - `expired_at` is the fixed deadline under [Configuration](#configuration).
  - `created_at` is the claim acceptance time, and `ended_at` is the end time or `null` before a terminal write.
    A null `ended_at` alone establishes no liveness.
  - `stop` is `null`, or the `stop` of the release that ended the execution.
  - `trace_id` and `root_span_id` hold the protocol-defined values of the Tracking Service: 32 and 16 lower-case hexadecimal characters under the [trace model](tracking-service.impl.md#trace-model). Before the tracer of the Tracking Service exists, the Scheduler mints both values at the claim through the `TraceIdentity` dependency that its `contract.ts` declares, and the composition root injects that stand-in.
- `WorkPull` is the input of `scheduler.work.pull`: `resource_identity` and `runtime_identity`. The resource identity equals the resource identity of the machine identity, and the runtime identity equals the live registration of that client identity. A mismatch of either field answers 403 `scheduler.work.claimant_mismatch`.
- The answer of `scheduler.work.pull` is `{ kind: "claimed", execution: ExecutionRecord }` or `{ kind: "no-work" }`, each with HTTP 200.
- `ExecutionRelease` is the input of `scheduler.execution.release`: `further_work` as a boolean, and `stop` as `null` or `{ reason, code, detail? }`. `detail` is a string of 1 to 2048 characters. The worker cuts a redacted cause text to 300 characters.
  `false` states that the execution of the attempt requires no further work.
  `stop.reason` is `operation_failed | judgement_invalid | report_absent | action_unsettled | assessment_absent | budget_end | provider_failed | no_progress | environment_failed`.
  For a failure, `stop.code` is the error code of the failed operation or `null`. For `budget_end`, it is `turns | wall_time`.
  For `provider_failed`, it is `rate_limited | quota_exhausted | unauthorized | bad_request | unavailable`. For `no_progress`, it is `null`. For `environment_failed`, it is `setup_failed | command_absent`.
  A `provider_failed` stop with `rate_limited`, `quota_exhausted` or `unavailable` advances the [fallback chain](agent.md#advance).
  A `stop` requires `further_work: true`, and a `stop` with `further_work: false` answers 400 `gateway.request.validation_failed`.
  The Mission Service reads both fields for routing in the release transaction. The execution row stores `stop`, and nothing stores `further_work`.
  The answer is `{ execution_id, ended_at }`.
- Every list answers the shared page of [architecture.impl.md](architecture.impl.md#pagination).
- `scheduler.execution.list` accepts the optional query field `node_id`. With it, the list holds the executions of that node only. A `node_id` that the project does not hold answers an empty page.
- `scheduler.execution.list` accepts the optional query field `attempt`, a positive integer, only with `node_id`. `attempt` without `node_id` answers HTTP 400 `gateway.request.validation_failed`. With both, the list holds the executions of that attempt only. An attempt that the node does not hold answers an empty page.
- Every mode of `scheduler.execution.list` orders by `execution_id` descending under the shared pagination rule.
- `scheduler.queue.list` orders by the order of the [work queue](scheduler-service.md#topology-and-work-queue): `priority` descending, then `job_id` ascending. This order replaces the primary-key order of the shared pagination rule.
  The cursor encodes `priority` and `job_id` of the last job of a page, and the next page reads the jobs after that pair in the same order.
  The server defines the order across all pages, and a client never re-sorts a page.

## The eligibility report

The eligibility report states whether the Mission state and the work queue admit a claim of one node.
It answers only the admission checks that need no claimant.
It predicts no claim, because a work pull rechecks every admission condition at the claim.

- `EligibilityReport` holds `project_id`, `node_id`, `state`, `claimable` and `checks`.
  - `state` is the Mission state of the node at the read.
  - `checks` holds five `EligibilityCheck` objects in this order: `project-pause`, `node-state`, `mission-condition`, `queue-job` and `no-live-claim`.
  - `claimable` is true exactly when no check holds `failed`.
- `EligibilityCheck` holds `name`, `result` and `condition`.
  - `result` is `passed`, `failed` or `not-applicable`.
  - `condition` is `continuation` or `null`. Only the `mission-condition` check holds a value other than `null`.
- `project-pause` passes when the project is not [paused](project-service.md#project-pause). The handler first resolves the project and the node, and it reads `projectPaused` only for a found node. An absent project therefore keeps 404 `scheduler.eligibility.node_not_found`.
- `node-state` passes when the node is not retired and holds `Available`, `Waiting` or `External.Requested`.
- `mission-condition` reads the Mission condition of that state.
  - `External.Requested` reads the [continuation condition](mission-service.md#continuation-condition) as `continuation`.
  - `Available` and `Waiting` read no condition, and the check holds `not-applicable` with `condition: null`.
  - The [readiness condition](mission-service.md#readiness-condition) always holds at `Waiting` and at `External.Requested`. A dependency edit on a dependent in those states answers `mission.node.state_conflict`. A dependency addition on a `Paused` dependent that resumes into an external state, and a forced retirement that removes a dependency of such a dependent, answer the same code. `Completed` is terminal.
  - When `node-state` fails, the check holds `not-applicable` with `condition: null`.
- `queue-job` passes when the work queue of the project holds a job of the node, and that job holds no `available_at` after the clock reading.
- `no-live-claim` passes when no execution of the node holds the claim state `running`.
- The handler reads the project pause through the `projectPaused` collaboration, the node state and the Mission condition through the Mission collaboration, and the job and the executions of the node from its own tables, in one read transaction.
  It writes nothing, and it moves no job.

The report never answers a check that needs a selected claimant:

- the availability of a worker binding and its instance count;
- the declared node states of a worker;
- the count of a claimant;
- the instance healthcheck;
- the [match](scheduler-service.md#match) of the declared intents and the tags.

The report takes no instance healthcheck and reads no registration.
It names no worker binding, no instance and no claimant.
The instance healthcheck stays out of every human inspection command under [worker-service.impl.md](worker-service.impl.md#inspection-operations).

- An absent project, an absent node or a node of another project answers 404 `scheduler.eligibility.node_not_found`.
- A path identity that is no canonical prefixed identity answers 400 `gateway.request.validation_failed`.

## Durable requests

- A work pull is idempotent by the runtime identity.
  Before admission, the claim transaction applies [loss settlement](#loss-settlement), then reads the `running` execution of the pulling runtime identity.
  When one exists, the pull answers `{ kind: "claimed", execution }` with the current row and selects nothing.
  The rule that a registration holds at most one outstanding pull and an instance holds at most one live execution refuses no such pull.
  Two concurrent pulls of one runtime identity serialize in the claim transaction, and the second answers the execution of the first.
  After the execution ends, a pull selects new work.
  A worker restart recovers its live registration, and a server restart ends no registration.
  Neither moves the deadline of an execution.
- A release carries no request identifier and stores no release receipt.
  An execution releases at most once.
  A release retry after the end meets the refusal of the proof.
  After a lost release answer and a refused retry, the worker reads `claim get`, which shows `finished`.
- `scheduler.execution.release` requires a live execution, and the invocation chain proves it before the handler, as for every other execution operation.
  The handler repeats the full proof in its write transaction under [Liveness](scheduler-service.md#liveness).
  A failed transactional check answers 409 `scheduler.execution.not_running`.
  Only the winning terminal write routes the Mission Service.
- `scheduler.claim.get` requires no live execution, because it reports an ended execution.
  Its handler checks the claimant against the worker binding of the machine identity and the runtime identity of its live registration.
  A mismatch answers 403 `scheduler.execution.not_owner`.

## The claim selection

- The claim transaction asks the Agent component for the [selection](agent.impl.md#the-claim-selection) of each native agent of the worker.
- The column `scheduler_execution.agent_selections` is `TEXT`. It holds the JSON list of the pins, which the claim writes once.
- The execution row inserts the pins with the row. Nothing updates them later.
- A pull that finds a `running` execution of its runtime identity returns that row and selects nothing.
- After the claim commits a new execution, the work pull calls `AgentChains.selected` with the selections and the execution identity. A running execution and a probe call nothing.
- The Scheduler Service declares the collaboration `projectPaused(tx, projectId)` in its `contract.ts` as the dependency `projects`. The Project Service implements it, and `apps/server/index.ts` wires it.
- After that read, the claim reads `projectPaused`. A paused project answers `{ kind: "no-work" }` before the instance healthcheck, and the claim inserts no execution and changes no node.
- When one agent has no chain entry whose credential is free, the pull answers `{ kind: "no-work" }`. The claim inserts no execution and changes no node.
- `claimOnce` of `src/scheduler/claim.ts` holds the instance guard next to `countRunningOfGroup`, inside the claim transaction.
  The Scheduler Service declares the collaboration `registrationsOfInstance(tx, runtimeIdentity)` in its `contract.ts` as a dependency. The Worker Service implements it.
  It answers the runtime identities of the other live registrations of the instance of `runtimeIdentity`. It answers an empty list for a registration with a null `instance_id`.
  The guard counts the executions of those runtime identities whose `ended_at` is null and whose `expired_at` is later than now, the predicate of `countRunningOfGroup`.
  A count above zero answers `{ kind: "no-work" }`, and the claim inserts no execution and changes no node.
  The claim transactions of the server serialize, so a second claim of one instance never commits, also when a pull abort arrives late.
  An expired, unsettled execution blocks no other registration of its instance.
  Tests cover two pulls of one instance on two bindings that commit one claim. They also cover an expired execution that blocks nothing and a registration with no instance.
- The queue order of an instance gives a free slot to the registration that waited longest.
  `InstanceQueue` of `src/scheduler/instance-queue.ts` holds the order in memory. It records the runtime identities that wait, in the order in which each started to wait. A server restart clears the order.
  - A registration starts to wait when the guard refuses its pull, or when another registration of its instance commits a claim. A registration that already waits keeps its place.
  - After the guard finds no live execution, `claimOnce` asks `turn`. A registration has its turn when no other live registration of its instance waits before it. A registration that does not wait has its turn only when no other registration of its instance waits.
  - A refusal by the guard or by the queue order has the outcome `queued`. The pull answers `{ kind: "no-work" }` as before. The claim inserts no execution and changes no node, and a work pull parks until a wakeup or the end of its window.
  - A committed claim removes the claimant from the order.
  - Every pull with no claim and no `queued` outcome removes its registration from the order. Examples are no job, a cooldown, a project pause and a failed healthcheck.
  - That removal wakes the parked pulls of the other waiting registrations of the instance.
  - The loss sweep removes each waiting registration whose healthcheck fails, for example an ended registration.
  - A release wakes the parked pulls of the other registrations of the instance of the released execution, and the parked pulls of the project of the execution.
  - With no other waiting registration, a pull claims at once, so one binding keeps its speed.
  - The worker unit starts no pull during an execution. A claim aborts the pulls of the other bindings, sometimes before their probe.
  - The order therefore records every other registration of the instance at the claim.
  - At the end of the execution, the releasing registration pulls first and gets `queued`. The other registration then claims, or passes its turn.
  - The order assumes that each live registration of an instance pulls again after an execution ends. The worker unit does this.
  - A registration that waits and never pulls holds the slot until its registration ends or its healthcheck fails.
  - Tests cover these cases:
    - two bindings on one instance that alternate their claims;
    - a parked pull that a release wakes;
    - a turn without work that passes the slot;
    - one binding that keeps its speed, alone and next to a sibling with no work;
    - one live execution for each instance;
    - a pruned registration that holds no place.
- `scheduler.execution.get` and `scheduler.claim.get` answer `agent_selections`, the pinned selections rebuilt from the pins.
- The release transaction calls the Agent component with the pinned selection and the `stop`, as [the release write](agent.impl.md#the-release-write) states.
- Custody and the execution setup of the Worker Service read the pinned selection and never the live chain.
- A disabled or removed current enablement still stops the authorization and the setup with 400 `agent.enablement.unavailable`, as [agent.md](agent.md#selection) states.

## The match

The Scheduler Service implements the [match](scheduler-service.md#match) in `match.ts`.

```ts
function admits(claimant: Claimant, facts: ClaimFacts): boolean {
  return (
    claimant.declared_intents.includes(facts.intent) &&
    facts.tags.every((tag) => claimant.tags.includes(tag)) &&
    (claimant.environment === null ||
      facts.repositories.includes(claimant.environment))
  );
}

function covered(
  claimants: readonly Claimant[],
  facts: ClaimFacts,
  state: NodeState,
): boolean {
  return claimants.some(
    (claimant) =>
      claimant.declared_node_states.includes(state) && admits(claimant, facts),
  );
}
```

- A `Claimant` holds `declared_node_states` and `declared_intents` from the worker declaration, and `tags` from the worker binding row that the claim pins.
- `ClaimFacts` holds `intent`, `tags` and `repositories` at the node revision that the claim pins. `repositories` holds the resource identity of each repository binding of the node.
- A `Claimant` also holds `environment`: the resource identity of the repository binding that the `environment` key of a worker binding at the `container` placement names, or null. A worker binding with an environment claims only the nodes that name that repository binding. Tags do not route environments.
- The claim walk calls `claimFacts` for each job, applies `admits`, then calls `transitions.claim` of the Mission Service. The on-demand path applies the same `admits`.
- `declarationOf` answers `null` for a worker name with no declaration. The claim then has no claimant and answers `{ kind: "no-work" }`. It asserts nothing.
- `unmatchedClaims` computes `covered` for each pair of a node and a claimable state. It reads `claimFactsOf` and `workerBindingsOf`, and it ignores `instance_count`.
- `claim` of a pair is its claimable state: `Available`, `Waiting` or `External.Requested`. `claims` of `claimFactsOf` lists the claimable states of the node.

The collaborations of the match are below.

| Owner     | Signature                                                                                  | Invariant                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission   | `claimFacts(tx, nodeId): { intent, tags, repositories } \| null`                           | It reads the node revision that the claim pins. It writes nothing.                                                                                                                                        |
| Mission   | `claimFactsOf(tx, projectId): { node_id, revision, intent, tags, repositories, claims }[]` | It answers each node that is not terminal and not retired, at its current revision and at the revision of its open attempt.                                                                               |
| Project   | `workerBindingsOf(tx, projectId): { binding_id, worker_name, tags, environment }[]`        | It answers the current worker bindings that are no tombstone. `workerBindingOf` also answers `tags`.                                                                                                      |
| Worker    | `declarationOf(workerName)`                                                                | It answers `declared_node_states` and `declared_intents`, or `null` for an unknown worker.                                                                                                                |
| Scheduler | `unmatchedClaims(tx, projectId): { node_id, revision, claim }[]`                           | A node write or a binding-set write never adds an unmatched pair. The caller reads it before and after its write in one `BEGIN IMMEDIATE` transaction under [architecture.impl.md](architecture.impl.md). |

## The environment gate

- The stop reason `environment_failed` ends an execution whose environment fails, under [the environment classification](worker-service.impl.md#the-environment-classification). Its `stop.code` is `setup_failed` or `command_absent`, the closed set `EnvironmentFailure` of `src/scheduler/contract.ts`.
- DECIDED 2026-10-23 by Aelita, pending Ulrich: the first layer, before the Onboarding component exists, gives consecutive `environment_failed` releases of a node the growing stop backoff, and the node moves to `Paused` at `mission.consecutive_failure_limit`. The code of the first layer holds this rule.
- The Onboarding component replaces that rule with the gate below. From then on, an `environment_failed` stop neither counts nor ends the count of [the loss settlement](#loss-settlement), and it sets no `available_at`. The node returns to `Available` or `Waiting`.
- After the commit of an `environment_failed` release, the release calls `environmentFailed(input)` of the [Onboarding component](project-service.impl.md#the-failure-of-an-execution) with the resource identities of the repository bindings of the node. The environment of each binding is then `failed`.
- DECIDED 2026-10-23 by Aelita, pending Ulrich: the claim selection skips a job whose node names a repository binding with an environment that is not claimable. The proposal kept the Scheduler without a gate, but a thread slot of the `server` placement serves every repository of the project, so only the claim can hold back one repository. `environmentsClaimable(projectId, resourceIdentities)` of the Project Service answers it from process memory inside the claim transaction. The node and the job stay unchanged.
- An environment is claimable when its status is `none` or `ready`. The gate holds at every placement, because a thread slot of the `server` placement serves every repository of the project.
- The Onboarding component calls `wake(projectId)` when an environment of the project becomes `none` or `ready`, so the parked work pulls claim at once.
- `unmatchedClaims` reads no environment status, because a status is temporary and a write never refuses for it.

## Configuration

The Scheduler Service owns the section `scheduler` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.

- `scheduler.release_reserve` holds the reserve after the effective worker wall time, in seconds.
  It is a positive safe integer and defaults to `600`.
- The claim sets `expired_at = created_at + wall_time_ms + 1000 × scheduler.release_reserve` once.
  It reads the effective `wall_time_ms` of the worker binding row that `worker_binding_id` pins.
  Nothing moves that deadline, including a resume of a worker registration.
  A later configuration change affects only later claims.
- `scheduler.stop_backoff` holds the hold of a job after the first consecutive failure of its node, in seconds.
  It is a positive safe integer and defaults to `30`. Each further consecutive failure doubles the hold.

## Loss settlement

Every 30 s, the Scheduler settles every execution row whose `ended_at` is null and whose `expired_at` is reached or passed.
This write is the loss declaration.
It sets `ended_at` to the clock reading at the start of its transaction.
The loss declaration counts the lost rows and the stopped rows of the attempt after its latest finished row with no `stop` or with a `budget_end` stop, and it hands the count to the Mission Service.
A `budget_end` row is no stopped row, and the count excludes it.
A release with a `stop` other than `budget_end` counts the same rows, itself included, in the release transaction.
A row with an advancing `provider_failed` stop is neutral. It neither counts nor ends the count.
The Mission Service consumes the loss or the stop in that transaction.
Below `mission.consecutive_failure_limit`, it moves `Executing` to `Available` and `Evaluating` to `Waiting`.
It inserts a job only when the node is claimable.
At the limit, it moves the node to `Paused`, and no job exists.
After the Mission Service consumes the failure, the transaction sets `available_at` of the job of the node to `now + 1000 × scheduler.stop_backoff × 2^(n − 1)`, where `n` is the count. A count of 0 sets no `available_at`.
A job that the Mission Service inserts later holds `available_at = null`.
The claim selects only jobs with `available_at` null or at most the clock reading. It skips a node whose loss it settles in its own walk.
A parked work pull waits at most until the earliest `available_at` of its project that lies after the clock reading.
The attempt stays open.
The operations that [Liveness](scheduler-service.md#liveness) names apply this same settlement before their own precondition checks in the same transaction.

## The execution trace

The Scheduler Service writes the root span `scheduler.execution` and the transition span `scheduler.transition` of each execution.
It writes both with the producer `scheduler`, through [the server spans](tracking-service.impl.md#server-spans).
Each write follows the commit of the transaction that changes the execution row.

- The root start holds `kanthord.execution.kind`: `steps` for a claim that moves the node to `Executing`, and `evaluation` for a claim that moves it to `Evaluating`.
- The root start holds `kanthord.worker.name`, the worker name of the claiming worker binding. The trace row takes its `worker_name` from it.
- The root start holds `kanthord.queue.wait_ms`: the claim time minus `queued_at` of the claimed job. The wait includes a backoff of `available_at`.
- A job keeps the identity of the first job of its node. The time of that identity is not the time of the enqueue.
- A new claim writes the root start. A work pull that answers an existing claim writes no root start.
- The Scheduler ends the root span of every execution that it ends. `kanthord.execution.end` holds one of three values:
  - `finished` for a release;
  - `lost` for a loss declaration of the sweep or of an inline settlement;
  - `revoked` for a revocation at a Mission transition.
- A revocation holds `kanthord.revoke.cause`: `assessment` when the assessment of that execution settles the node, and `human` for a human act.
- The root span ends with `Ok` for a release with no stop and for a revocation with the cause `assessment`.
- The root span ends with `Error` for a stop, a loss and a revocation with the cause `human`.
- A release, a loss and a revocation with the cause `assessment` each write one `scheduler.transition` span. It is a child of the root span, with the record identity `<root_span_id>:transition`.
- A revocation with the cause `human` writes the root end only. The [act trace](mission-service.impl.md#the-act-trace) of the Mission Service holds that transition.
- The start and the end of a transition span are the time of the transition, and its status is `Ok`.
- The transition span holds `kanthord.node.state.from`, the node state before the transaction, and `kanthord.node.state.to`, the node state at the commit.
- The Mission Service hands both states to the release, to the loss and to the revocation by an assessment.
- The transition span holds `kanthord.transition.rule`, with one of four values:
  - `failure_limit` when the count of consecutive failures moves the node to `Paused`;
  - `further_work_limit` when the count of stalled releases moves the node to `Paused`;
  - `rework_limit` when a `criterion-not-met` assessment at `mission.rework_limit` moves the node to `Blocked`;
  - `none` otherwise.
- With a rule other than `none`, the transition span holds `kanthord.transition.count` and `kanthord.transition.limit`.
- A transition span of a node that keeps its state holds the same state in both attributes.
- No service reads these spans to decide, and a lost span changes no node state.

## Retention

- The Scheduler Service exposes no delete of an execution record, so under [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) it keeps every execution record, and no sweep deletes one.
- `execution list` and `execution get` therefore return every execution of the project, live and ended.
- The work queue holds current jobs only. The Mission Service inserts and removes a job with the claimable state of its node, so `queue list` and `queue peek` read a live view and no history.
- A `scheduler_queue_place` row stays for the life of the node, because no service deletes a node.

## Tests

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that a claim exposes no identity of its own.
- Tests assert that a release with a stop and a loss declaration hold the job for `scheduler.stop_backoff` seconds, that the hold doubles with the count, and that a count of 0 holds nothing.
- Tests assert that the claim skips a held job until `available_at` and does not claim a node whose loss it settles.
- Tests assert that a parked work pull claims a held job when its hold ends.
- A test parses every input and output of the Scheduler operations through the direct adapter and the HTTP adapter and rejects an unknown field, a `null` outside its permitted fields and a bare ULID.
- A test loses an accepted pull answer and repeats the pull from the same runtime identity, once with the same key and once with a new key, and asserts the same execution and no second execution or count.
- A test pulls from another runtime identity of the same binding while an execution is live and asserts that it never receives that execution.
- A test ends the execution, repeats the pull from the same runtime identity and asserts a fresh admission.
- Tests submit two concurrent releases with equal `further_work` values and with different values.
  They assert one winner, one 409 `scheduler.execution.not_running` from the transactional check, and one Mission routing.
- Tests race a release against the sweep, an assessment end and a human revocation.
  They assert one terminal write and one Mission routing.
  A release that passes the invocation-chain proof but loses the transaction check answers 409 `scheduler.execution.not_running`.
- A test admits an invocation before expiry and starts its write transaction exactly at `expired_at`.
  It asserts 409 `scheduler.execution.not_running` and the `lost` claim state.
  Another test starts the write transaction before expiry and commits after expiry.
  It asserts acceptance and, for a terminal write, `ended_at` equal to the start reading and `claim_state` equal to `finished`.
- Tests meet an expired unsettled row through a claim of its node and a work pull of its instance.
  They assert loss settlement before admission and no return of the lost execution.
  A registration resume meets the same row and asserts settlement before its precondition check.
  A human act also checks its precondition against the settled state.
- Tests sweep expired steps and evaluation claims below and at `mission.consecutive_failure_limit`.
- Tests assert that a claim pins the first chain entry whose credential is free.
- Tests assert that a later cooldown leaves the pin unchanged and that a pull answers no work when every entry cools down.
- Tests assert that the record rebuilds the selection from the pinned worker binding row and enablement revision.
- Tests assert that an advancing `provider_failed` stop neither counts nor ends the count, and that `bad_request` and `unauthorized` count.
- Tests release steps and evaluation claims with a `stop` below and at `mission.consecutive_failure_limit`, mix lost and stopped rows in one count, and assert that `execution get` answers the `stop`. A test refuses a `stop` with `further_work: false`.
  They assert one loss increment, the specified node state and a job only when claimable.
- A test computes the deadline from a binding override of `wall_time_ms` and the configured reserve, including the default `600` seconds.
  A registration resume and later configuration changes leave that deadline unchanged; a later claim uses the changed configuration.
- A test revokes a claim before expiry and asserts `finished`, no loss increment and the transaction reading as `ended_at`.
- Tests cover all three derived claim states before, at and after the deadline, with and without `ended_at`.
- Tests assert an abort on the first refused call for an execution at each placement.
- A test calls `claim get` from another worker binding or runtime identity and asserts 403 `scheduler.execution.not_owner`.
  Through both adapters, it calls the release of an ended claim and asserts the 403 of the execution proof before the handler.
  After a lost release answer and a refused retry, the owner reads `finished` through `claim get`.
  No stored release receipt exists.
- A test checks the shared error envelope, the timeout, the lifetime and the body limit of every Scheduler route.
- A test asserts that no sweep deletes an execution record, and that an ended execution stays readable through `execution get` after a restart.
- A test asserts that `queue list` returns no job of a node that left the claimable state.
- A test pages `queue list` with a limit of 1 over jobs of several priorities and asserts the order of the work queue across the pages.
- A test claims an older node, inserts a job of a newer node, and inserts the job of the older node again. It asserts the claim of the older node.
- A test pauses a project with a claimable node and a waiting pull. It asserts `{ kind: "no-work" }` at the end of the wait window, no execution, and an unchanged node and job. After the resume, it asserts the claim of the waiting pull before the end of its window.
- A test pauses a project during a live execution. It asserts that the execution stays `running`, that its release routes the node, and that no pull claims the node before the resume.
- Tests read the eligibility report of a node in each of the twelve states, under each Mission condition that holds and that fails, with and without a job, with an active and a paused project, and with a `running`, a `lost` and a `finished` execution. They assert each check result, `claimable` and no write.
- Tests assert 404 `scheduler.eligibility.node_not_found` for an absent project, an absent node and a node of another project.
- A test asserts that the eligibility report takes no instance healthcheck and holds no binding, instance or claimant field.
- Tests admit a claimant only when its worker declares the intent of the node and its binding tags include every tag of the node, at the node revision and the binding row that the claim pins.
- Tests skip a job that the claimant does not admit and claim the next admitted job, and they apply the same match to an on-demand request.
- A test pulls with a worker name that has no declaration and asserts `{ kind: "no-work" }` and no assertion failure.
- Tests answer the unmatched pairs of `Available`, `Waiting` and, for a node that requires an external action, `External.Requested`. They ignore `instance_count`.

## Execution CLI validation

The claim and execution CLI commands refuse invalid arguments locally with the following codes.
These declarations match the error table of `engine/docs/cli/scheduler.md`.

| HTTP  | Code                                                   | Condition                                                                     |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| local | `cli.scheduler.claim.get.invalid_execution_id`         | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
| local | `cli.scheduler.execution.get.invalid_execution_id`     | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
| local | `cli.scheduler.execution.release.invalid_execution_id` | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
| local | `cli.scheduler.execution.list.invalid_project_id`      | The `<project-id>` argument is not a canonical `project_<ulid>` identity.     |
| local | `cli.scheduler.execution.list.invalid_node_id`         | The `--node` value is not a canonical `node_<ulid>` identity.                 |
| local | `cli.scheduler.execution.list.invalid_attempt`         | The `--attempt` value is not a positive safe integer.                         |
