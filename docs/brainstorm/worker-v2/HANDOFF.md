# Worker V2 HANDOFF

This page holds the status of each step of the [build plan](plan.md). Remove this folder before `feature/worker-v2` merges into `main`.

Update a step when its state changes. Record the pull request of each step.

## Phase A: build

- [x] A1. Chain runner (D21 layer 4). Implementer: Fable 5.2. Reviewer: Opus 5.5.
- [x] A2. Implement ports in the worker (D32 layer 1). Implementer: Opus 5.5. Reviewer: Fable 5.2.
- [x] A3. Evaluation and examine ports (D32 layer 2). Implementer: Opus 5.5. Reviewer: Fable 5.2.
- [x] A4. Stops as values (D32 layer 3). Implementer: Fable 5.2. Reviewer: Opus 5.5.
  - Add an optional stop detail to the `failed` variant of `PortResult`. Remove the `run.stopOf` call from the worker ports. The step builds its stop from the answer. Ruled 2026-11-17 by Aelita as owner.
  - Give a budget end of a port call its own answer. The worker `agent.open` and the step then decide the budget end once, not twice.
- [ ] A5. Boundary of the Foundry (D32 layer 4). Implementer: Opus 5.5. Reviewer: Fable 5.2.
  - Add the worker-only port `dependencies.read` and make `inputs.read(dependencies)` a `FoundryStep`. Replace the context key `env` with `input.env`.
- [ ] A6. Capabilities and guards (D32 layer 5). Implementer: Fable 5.2. Reviewer: Opus 5.5 and `/security-review`.
  - Build D27: `checkoutConfinement` with the `locations` rule in each `re@1` session, with the D27 test.
- [ ] A7. CLI host and `worker tasks run` (D32 layer 6). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`.
- [ ] A8. `worker tasks seed` and `worker tasks compare` (D31). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`.
- [ ] A9. Pages `agent.impl.md` and `engine/docs/cli/worker.md`. Writer: Sonnet 5.5. Check: `crucible`.

### A1 deviations

The chain runner of A1 keeps the behavior of today. These points differ from section 2 of the design. A later step removes each one.

- The `implement` chain passes the mutable `StepsState` of today through one resource key `state`. The read-before-write check does not cover the steps that use it. C1 and C2 replace it with value keys.
- Three steps hold more than one catalogue step: `base.refresh` holds the merge, the `Conflict` turn and gate G. `unit.turn` holds the turn and gate G. `release.verify` holds the release trees, the setup, `verify.all`, `affected.run` and the give of the trees. A2 to A5 and C1 split them.
- The steps `state.open`, `budget.check`, `unit.leave` and `unit.runner` have no catalogue entry. `done_record.put` becomes `unit_record.put` in C2.
- `runChain` throws the stop, and `executionBoundary` releases it. The budget-end mapping stays inside each step that has it today. The runner has no `stopMapped`.
- The `examine` chain holds only `workspace.review(base)` in `prepare`, so that each later budget end releases with `further_work: true`, as today.
- The phase spans of `implement` are one-frame loops. The runner opens no `worker.step` span. C5 adds it.
- Accepted change: the dispose stack releases the node workspace after a failed give of the base tree. The stop keeps the code of the first error.

### A2 deviations

- A worker port turns a thrown error into a stored stop with `run.stopOf`, then answers `failed`. The stored stop keeps the git output and the cause of today. A4 removes this.
- The release tree port cleans the release directory before the first take and removes it after the last give. It counts the trees that it holds.
- On a failed take, a half-built tree goes back to the pool before the trees that were already taken.
- The give of the release trees stays in the `finally` of `verifyInReleaseClones`, not at the frame end of `release_gate`.
- `evidence.submit` of the worker ignores its context argument, because `run.call` uses `operationContext`.
- `giveLeftoverTrees` and `giveBack` of `BaseHead` call the pool directly. A5 moves them to the port.
- The `evaluation` chain and the `examine` chain get the port set of `implement`. A3 gives them their own port sets.
- The `port:` marks of the golden file are notes of the step. A5 adds the `ports` field of a step.
- A port halts inside the call. When a take fails and the later give also fails, the stop names the first error, not the last.
- `BaseHead` computes the base tree directory itself, and the port computes it again. A `give` of a base tree with no release tree removes the release directory. A5 makes `BaseHead` read each path from the port answer and gives base trees their own give.
- The modules `step-base-fetch.ts`, `base-refresh.ts`, `steps-implement.ts` and `chain-implement.ts` import each other in a cycle. A test that imports `step-base-fetch.ts` first fails with a `ReferenceError`. A5 moves `repositoryOf` and `mergedBranchesOf` to a leaf module.

### A3 deviations

- `AgentSession` is `NativeAgent`. The steps call `instruct`, `lastText` and `budget.exhausted()`, and the host closes the session. A6 moves the session to `turn` and `close`.
- The worker `agent.open` reads the budget. It answers a budget end during the open as `failed` with no code and no halt. The step tells a budget end from a stop by `operationContext`. A4 gives the budget end its own answer.
- The worker `agent.open` ignores its context argument and reads only `reviewWorkspace.directory` of the request. It refuses a request with no review workspace.
- The `implement` chain opens its agent through `StepHost.openAgent`, not through the port. A5 moves it.
- `Chain` and `ChainIo.ports` have the type `CommonPorts`. `hostedChainOf` pairs each chain with its port set. A5 types the pair.
- D27, the checkout confinement of the judgement session, moves to A6. Ruled 2026-11-17 by Aelita as owner, because it changes behavior.

### A4 deviations

- `ImplementPorts` holds a worker-only port `claim.check` over `run.checkClaim()`. `unit.turn` calls it at the place of today. C3 deletes it with the claim check.
- `env` is a context key that the runner seeds from the host. A5 replaces it with `input.env`.
- `inputs.read(dependencies)` of `evaluation` and `examine` stays a host `Step` with `io.run` inside `tasks`. A5 adds a worker-only port `dependencies.read`, so that the step becomes a `FoundryStep`. C4 deletes the port when the read moves to `prepare`. Ruled 2026-11-17 by Aelita as owner.
- The host stores a stop of `tasks` when the walk ends, before the dispose of the resources. In `evaluation` and `examine`, today's code stored a thrown stop after the dispose. The release body, the spans and the server calls are the same.
- The walker returns `cancelled` when a step ends normally under an `operationContext` that a stored stop or a requested stop aborted. Under any other abort, the walk goes on as today.
- A worker port maps each caught error to `failed`. An unstored `ExecutionStop` with another reason inside a port becomes `operation_failed`. No port has such a throw today.
- Only `agent.open` answers `budget_end`.
- The test helper `stoppingRunner` of `steps-implement-release.test.ts` throws an `ExecutionStop` in place of `state.run.stop`, because `StepsState` holds no `run`. The stop-reason cases now test a stop that the step returns.

## Phase B: eval set baseline

- [ ] B1. Select 8 to 12 executions. Ulrich selects. Aelita proposes candidates from the traces.
- [ ] B2. Export the seeds.
- [ ] B3. Live record run of each seed.
- [ ] B4. Baseline report.
- [ ] B5. Replay of each seed against its own record.

## Phase C: behavior layers

- [ ] C1. Gate G and restore reduction (D21 layer 1). Replay plus live run.
- [ ] C2. Unit record and trailer removal (D21 layer 2). Replay.
- [ ] C3. `ClaimWatch` and push fence (D21 layer 3). Replay.
- [ ] C4. Parallel groups and fail-early order (D21 layer 5). Replay.
- [ ] C5. Checkpoint merge, telemetry and stop detail (D21 layer 6). Replay.
- [ ] C6. The `Conflict` prompt (D22). Replay plus live run.

## Open items

- [ ] S1, open, before A8. Let the seed export serve an execution of a closed node, so that a past execution becomes an eval seed. A close deletes the unit records of the node, and `setup` holds them. The route answers the latest confirmed heads, not the heads at the claim. Design a closed-node seed with the heads at the claim and a rule for a node with no unit records.
- [ ] Open, outside Worker V2. The case `footprint.measure.run` of `src/apps/server/adapter-conformance.test.ts` fails on the local machine of Ulrich at `engine` `ea454eab`, and passes in CI. The direct adapter answers the alert state `pending` and the HTTP adapter answers `firing`. A local gate of Worker V2 accepts this one failure.

## Pull requests

| Step | Repository | Pull request                                                    | Merge commit |
| ---- | ---------- | --------------------------------------------------------------- | ------------ |
| A1   | `engine`   | [#623](https://github.com/kanthorlabs/kanthord-engine/pull/623) | `03531d79`   |
| A2   | `engine`   | [#624](https://github.com/kanthorlabs/kanthord-engine/pull/624) | `2e4295aa`   |
| A3   | `engine`   | [#625](https://github.com/kanthorlabs/kanthord-engine/pull/625) | `fcf92d88`   |
| A4   | `engine`   | [#626](https://github.com/kanthorlabs/kanthord-engine/pull/626) | `03dd90de`   |
