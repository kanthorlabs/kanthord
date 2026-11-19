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
- [x] A5. Boundary of the Foundry (D32 layer 4). Implementer: Opus 5.5. Reviewer: Fable 5.2.
  - Add the worker-only port `dependencies.read` and make `inputs.read(dependencies)` a `FoundryStep`. Replace the context key `env` with `input.env`.
- [x] A6. Capabilities and guards (D32 layer 5). Implementer: Fable 5.2. Reviewer: Opus 5.5 and `/security-review`.
  - Build D27: `checkoutConfinement` with the `locations` rule in each `re@1` session, with the D27 test.
- [ ] A7. CLI host and `worker tasks run` (D32 layer 6). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`. Two pull requests, one after the other. Ruled 2026-11-18 by Aelita as owner.
  - [x] A7a. Live mode: the seed, `tasks_prepare` and `runPhase`, the CLI ports and capabilities, `--credential-stdin` and the frozen store, `--tree`, `--pass-env`, the output folder, the end mapping, SIGINT. Tests 1, 3, 7, 8, 9, 11, 12 and 15 of design section 5.7.
  - [ ] A7b. Replay: the capture of `turns.jsonl`, the replay provider, the replay rule of open-world tools, `--verify` checks 1 to 8. Tests 4, 5, 13 and 16 of design section 5.7.
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

### A5 deviations

- `ImplementInput` adds `root` and `workspaceKey` and has no `gitPaths`. `ImplementResult` holds `completedUnits` as a set of unit ids, adds `reports` and has no `openMerge`. C6 adds `openMerge` with D23.
- `EvaluationInput` holds the context keys that the steps read today: `reviewWorkspace`, `testedInput`, `baseHead`, `setupFailure`, `placed` and `reviewRound`. `EvaluationResult` holds the three evidence keys and `dependencies`, not `evidenceIds`.
- `ExamineResult` holds `nodeVerification`. `ExamineInput` has no `dependencies`, because the step reads them in `tasks`.
- A result holds each key that the walk reached. The host merges it before it maps the end.
- The ports add `releaseTrees.giveBase`, `claim.check` (C3 deletes it) and `dependencies.read` (C4 deletes it). The implement host phase gets `agent.open`. `foundryImplement` does not.
- The module test forbids the directories `src/custody/`, `src/gateway/`, `src/apps/` and `src/repository/` (except `contract.ts`), a list of host modules, the secret-handling modules `src/kernel/hpke.ts`, `src/kernel/handover.ts` and `src/kernel/key-derivation.ts`, the package `@hpke/core`, and the names `RepositoryTransport`, `MethodClients`, `ExecutionRun`, `hostToolsOf`, `hkdf`, `hkdfSync`, `createCipheriv`, `createDecipheriv` and `createPrivateKey`. It follows the imports of each `contract.ts`, and it fails on a relative import that does not resolve.
- To keep secret handling out of the Foundry closure, the credential shapes moved from `src/custody/contract.ts` to `src/kernel/credential-shapes.ts`, the sealed object shape from `hpke.ts` to `src/kernel/sealed-object.ts`, the handover envelope shape from `handover.ts` to `src/kernel/handover-envelope.ts`, and `deriveKey` from `json.ts` to `src/kernel/key-derivation.ts`. Ruled 2026-11-17 by Aelita as owner, under the credential rule of Ulrich.
- The host steps `report.coder`, `evidence.head` and `env.setup(live)` have no `ports` field, so the golden file prints no `port:` mark for them. Phase C moves them into `tasks`.
- A timeout of the leftover give inside the first `takeBase` maps to `operation_failed`, as the take does.
- `BaseHead.giveBack` gives only the trees that it took. Leftover trees under `base/` stay until the next first `takeBase`, which gives them with the address check.
- `inputs.read(dependencies)` of `evaluation` maps a `budget_end` answer of `dependencies.read` to a budget end. Today `readDependencies` never answers it.

### A6 deviations

- The `AgentSession` of the Foundry stays `NativeAgent`, with `close(): Promise<void>` in place of `dispose()`. Phase C moves it to `turn` and `close` when no step reads `prompt`, `instruct`, `abort` or `budget` of the session.
- `ChainIo.capabilities` is optional, because `runEvaluation`, `runStepsExamine` and the test harnesses pass none. A7 makes it required.
- A6 builds no MCP capability, because the engine has no pi MCP package. The MCP rules and tests of section 5.5 come with the first MCP capability.
- `agent-port.test.ts` and `tool-table.test.ts` stay in `src/worker/unit/`, because they use the worker test support.

### A7a deviations

- `ChainIo.capabilities` is required.
- The bash tool of `src/agent/tool-table.ts` takes the session `env` through `childEnvironment`, with the `PATH` of pi, not `process.env`. The worker passes the `process.env` of its thread, so the worker result is the same. The serve path no longer passes `PI_OFFLINE` and `PI_CODING_AGENT_DIR` to bash.
- `tasks_prepare` runs its steps in sequence and includes `state.open`, because the runner has no parallel group before C4. It uses `IMPLEMENT_HOST_PORTS`.
- `claim.check` of the CLI host answers ok. C3 deletes the port.
- The seed plan node has `judged: []`.
- A budget end in `tasks_prepare` becomes the stop `budget_end/wall_time`.
- A SIGINT during the tree preparation gives the stop `worker_stopped`, not `tree_invalid`.
- `--pass-env` refuses a name that `childEnvironment` removes, with the new code `cli.worker.tasks.option_invalid`.
- `progress.json` holds no `UnitCtx` of each unit, and `metrics.json` holds no step run time. Section 5.7 states both. A7b adds them.
- An outbox entry has `step: null`, because a port does not know its step. A7b gives the step id to the ports.
- `--verify` builds checks 3, 5, 6 and 7. Check 8 comes with A7b. Checks 1, 2 and 4 come with C2: no `unit_record.put` port and no `kanthord.git.commit` span attribute exist, and `report.coder` runs in `finish`.
- The outbox records the `evidence.submit` draft with no redaction of base64 asset content. No step of the `tasks` phase calls `evidence.submit` today. A7b redacts the decoded content before the record.
- `eslint.config.js` lets the `src/apps/cli/` tests and `tasks-test-support.ts` import the worker test support and `src/agent/{pi,pi-tools}.ts`. It lets `src/worker/unit/` and `src/apps/worker/` import `src/llm/refresh-watch.ts`.
- `--unit` is checked after `tasks_prepare`, so `unit_unknown` comes after `env.setup`.

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

- [ ] Open, before a CLI command for `evaluation`. The `BaseHead` of `evaluation` clones base trees with `cloneLocal` inside `foundryEvaluation`. Add `releaseTrees.takeBase` and `releaseTrees.giveBase` to `EvaluationPorts`, so that the Foundry constructs no tree (rule 1). Ruled 2026-11-17 by Aelita as owner.

- [ ] Open, at each pi upgrade. `src/agent/hooks/checkout-confinement.ts` holds a copy of the path rules of pi (`normalizePath`, `resolvePath` and the `read` spelling variants of pi 1.1.0). Compare the copy with the new pi version before the upgrade lands.

## Pull requests

| Step | Repository | Pull request                                                    | Merge commit |
| ---- | ---------- | --------------------------------------------------------------- | ------------ |
| A1   | `engine`   | [#623](https://github.com/kanthorlabs/kanthord-engine/pull/623) | `03531d79`   |
| A2   | `engine`   | [#624](https://github.com/kanthorlabs/kanthord-engine/pull/624) | `2e4295aa`   |
| A3   | `engine`   | [#625](https://github.com/kanthorlabs/kanthord-engine/pull/625) | `fcf92d88`   |
| A4   | `engine`   | [#626](https://github.com/kanthorlabs/kanthord-engine/pull/626) | `03dd90de`   |
| A5   | `engine`   | [#627](https://github.com/kanthorlabs/kanthord-engine/pull/627) | `cd6397e7`   |
| A6   | `engine`   | [#628](https://github.com/kanthorlabs/kanthord-engine/pull/628) | `caffd816`   |
| A7a  | `engine`   | [#639](https://github.com/kanthorlabs/kanthord-engine/pull/639) | `ec48ca0b`   |
