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
  - Add the worker-only port `dependencies.read` and make `inputs.read(dependencies)` a `FoundryStep`. Replace the context key `env` with `input.env`. C4 deletes the port.
- [x] A6. Capabilities and guards (D32 layer 5). Implementer: Fable 5.2. Reviewer: Opus 5.5 and `/security-review`.
  - Build D27: `checkoutConfinement` with the `locations` rule in each `re@1` session, with the D27 test.
- [x] A7. CLI host and `worker tasks run` (D32 layer 6). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`. Two pull requests, one after the other. Ruled 2026-11-18 by Aelita as owner.
  - [x] A7a. Live mode: the seed, `tasks_prepare` and `runPhase`, the CLI ports and capabilities, `--credential-stdin` and the frozen store, `--tree`, `--pass-env`, the output folder, the end mapping, SIGINT. Tests 1, 3, 7, 8, 9, 11, 12 and 15 of design section 5.7.
  - [x] A7b. Replay: the capture of `turns.jsonl`, the replay provider, the replay rule of open-world tools, `--verify` checks 1 to 8. Tests 4, 5, 13 and 16 of design section 5.7.
- [x] A8. `worker tasks seed` and `worker tasks compare` (D31). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`.
- [x] A9. Pages `agent.impl.md` and `engine/docs/cli/worker.md`. Writer: Sonnet 5.5. Check: `crucible`.

### A1 deviations

The chain runner of A1 keeps the behavior of today. These points differ from section 2 of the design. A later step removes each one.

- The `implement` chain passes the mutable `StepsState` of today through one resource key `state`. The read-before-write check does not cover the steps that use it. C1 and C2 replace it with value keys.
- Three steps hold more than one catalogue step: `base.refresh` holds the merge, the `Conflict` turn and gate G. `unit.turn` holds the turn and gate G. `release.verify` holds the release trees, the setup, `verify.all`, `affected.run` and the give of the trees. A2 to A5 and C1 split them.
- The steps `state.open`, `budget.check`, `unit.leave` and `unit.runner` have no catalogue entry. `done_record.put` becomes `unit_record.put` in C2.
- `runChain` throws the stop, and `executionBoundary` releases it. The budget-end mapping stays inside each step that has it today. The runner has no `stopMapped`.
- The `examine` chain holds `[PAR] prepare.inputs` (`inputs.read(revision, dependencies)` and `workspace.review(base)`) in `prepare`. A budget end in these reads releases with `further_work: true` and the stop `budget_end/wall_time` (C4).
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
- `inputs.read(dependencies)` of `evaluation` and `examine` stays a host `Step` with `io.run` inside `tasks`. `inputs.read(dependencies)` runs in `prepare` as part of `inputs.read` (C4). The port `dependencies.read` is deleted.
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
- The ports add `releaseTrees.giveBase`, `claim.check` (C3 deletes it). The implement host phase gets `agent.open`. `foundryImplement` does not.
- The module test forbids the directories `src/custody/`, `src/gateway/`, `src/apps/` and `src/repository/` (except `contract.ts`), a list of host modules, the secret-handling modules `src/kernel/hpke.ts`, `src/kernel/handover.ts` and `src/kernel/key-derivation.ts`, the package `@hpke/core`, and the names `RepositoryTransport`, `MethodClients`, `ExecutionRun`, `hostToolsOf`, `hkdf`, `hkdfSync`, `createCipheriv`, `createDecipheriv` and `createPrivateKey`. It follows the imports of each `contract.ts`, and it fails on a relative import that does not resolve.
- To keep secret handling out of the Foundry closure, the credential shapes moved from `src/custody/contract.ts` to `src/kernel/credential-shapes.ts`, the sealed object shape from `hpke.ts` to `src/kernel/sealed-object.ts`, the handover envelope shape from `handover.ts` to `src/kernel/handover-envelope.ts`, and `deriveKey` from `json.ts` to `src/kernel/key-derivation.ts`. Ruled 2026-11-17 by Aelita as owner, under the credential rule of Ulrich.
- The host steps `report.coder`, `evidence.head` and `env.setup(live)` have no `ports` field, so the golden file prints no `port:` mark for them. Phase C moves them into `tasks`.
- A timeout of the leftover give inside the first `takeBase` maps to `operation_failed`, as the take does.
- `BaseHead.giveBack` gives only the trees that it took. Leftover trees under `base/` stay until the next first `takeBase`, which gives them with the address check.

### A6 deviations

- The `AgentSession` of the Foundry stays `NativeAgent`, with `close(): Promise<void>` in place of `dispose()`. Phase C moves it to `turn` and `close` when no step reads `prompt`, `instruct`, `abort` or `budget` of the session.
- `ChainIo.capabilities` is optional, because `runEvaluation`, `runStepsExamine` and the test harnesses pass none. A7 makes it required.
- A6 builds no MCP capability, because the engine has no pi MCP package. The MCP rules and tests of section 5.5 come with the first MCP capability.
- `agent-port.test.ts` and `tool-table.test.ts` stay in `src/worker/unit/`, because they use the worker test support.

### A7a deviations

- `ChainIo.capabilities` is required.
- The bash tool of `src/agent/tool-table.ts` takes the session `env` through `childEnvironment`, with the `PATH` of pi, not `process.env`. The worker passes the `process.env` of its thread, so the worker result is the same. The serve path no longer passes `PI_OFFLINE` and `PI_CODING_AGENT_DIR` to bash.
- `tasks_prepare` runs `[PAR] workspace.static`, then `state.open`, then `[PAR] start.inputs`. It uses `IMPLEMENT_HOST_PORTS`. The test harness `prepareStepsWorkspace` runs no live setup.
- `claim.check` of the CLI host answered ok. C3 deleted the port.
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

### A7b deviations

- `FoundryHost.steps` and `ChainIo.steps` are optional `StepWatch` fields. `walkStep` of `chain-runner.ts` calls the watch. The worker host passes none, so the worker result is the same.
- `TasksCommandIo.capabilities` exists, so that a test registers a capability with `openWorldHint: true`. Production passes the default capabilities.
- A replay also writes its own `turns.jsonl`.
- In live mode, the cache-warming requests of pi do not pass the stream function, so `turns.jsonl` does not record them.
- Only a marked answer stops a replay with `redacted_record`. A marked tool line replays its redacted result.
- When an open-world tool result holds a known secret, the tool line holds `[redacted]` and the recorded request holds a session marker. The replay stops at the next request with `request_differs`. A later fix gives the tool line the session marker form.
- Check 8 sets `allowUnsafeGpgProgram` of simple-git for its one `git log` call, because simple-git refuses the key `gpg.program` without it.
- No test asserts the step of an agent tool call inside a `tasks_prepare` session.
- The MCP part of the replay rule is not built. It comes with the first MCP capability.

### A8 deviations

- The seed export also answers for an ended execution of an open node. Its setup reflects the current bindings, policies and placement, and its heads hold the final pushed head.
- The server stores no attempt base commit, so the last heads source is the current base head, read through the server SSH access.
- `compare` reads `context.json` and the checkouts in addition to `result.json` and `metrics.json`. It prints one JSON line `{ seed_digest, differences: [{ section, a, b }] }`.
- `seedClaimSchema` checks `trace_id` and `root_span_id` as non-empty strings, because the worker contract may not import the scheduler contract.
- `eslint.config.js` lets the worker contract import the mission contract, and lets the server tests import `src/apps/cli/worker-tasks.ts` and `tasks-test-support.ts`.
- `seedDependencies` of `src/worker/execution-seed.ts` is exported for its direct test.

### A9 deviations

- The page `engine/docs/cli/worker.md` stated that `--pass-env` refuses each ambient credential variable, but the code accepted `AWS_PROFILE`. A9 fixes the code: `passEnvRefused` also refuses each name of `AMBIENT_CREDENTIAL_NAMES`.
- The bash timeout cap is 599 s, not 600 s. The page states 599 s.

## Phase B: eval set baseline

- [x] B1. Select 8 to 12 seeds: open nodes for `worker tasks seed`, or new executions with the capture hook on. Ulrich selects. Aelita proposes candidates from the traces.
- [x] B2. Export the seeds.
- [x] B3. Live record run of each seed.
- [x] B4. Baseline report.
- [x] B5. Replay of each seed against its own record.

### B1 and B2 deviations

- The seeds come from the capture hook, not from `worker tasks seed`. The source is the todoapp end-to-end run `b1-seeds-3` on a local server at `engine` `65f8664d`, with `KANTHORD_CAPTURE_TASKS=1`.
- The set holds 11 coder seeds of 6 plan files: first runs, rework runs after a review, and restarts after an unblock. The capture hook serves the `implement` chain only, so the set holds no reviewer seed.
- The set does not cover one unit, a merge conflict, a setup failure, a release gate failure or a budget end. Each seed has 2 units. Add a seed for each missing case when a run produces it.
- `affectedTests` is empty in each seed.
- `make e2e-start` sent no `resource_kind` for the poll inbound, and the server refused it. kanthord #433 sends `resource_kind: "repository"`.
- The run stops at `External.Requested` until a human merges each pull request of the coder. A local loop merged them.
- The eval set lives in `~/kanthord-evalset/worker-v2` with mode `0700`. `index.md` holds the execution id, the case and the `seed.json` digest of each seed.

### B3 and B4 deviations

- Each seed runs against its own source tree. The tree holds the base branch at its head of the seed claim time, and the node branch at the seed head. `bases.tsv` of the eval set lists each base head. The run clones only branch refs, so a seed head on a remote-tracking ref only fails with `cli.worker.tasks.tree_invalid`.
- The credential is an Anthropic subscription login of Ulrich in a separate pi folder of the eval set. The run reads it on standard input.
- The baseline is `baseline.md` of the eval set: 11 runs `completed`, checks 3, 5 and 6 pass, 338 turns, 584 k output tokens, 81.9 tasks minutes.
- Two seeds end `completed` with no commit: `XHDK27G1` and `YE4JXRX0`.
- The first B5 run failed: each replay stopped with `request_differs` at turn 2 to 6, on bash output that changes over time. The drift rule fixes it.
- B5 with the drift rule: 10 of 11 replays end `completed` with check 8 passed, with 2 to 13 drift entries each. `T8TWV9P5` stops at turn 11 with `redacted_record`, see the open items of the session redaction.

## Phase C: behavior layers

- [x] C1. Gate G and restore reduction (D21 layer 1). Replay plus live run.

### C1 deviations

- Git processes per checkout per turn: unchanged 14 to 1, changed 17 or 18 to 5 or 6, agent committed 18 or 19 to 8 or 9. The restore after a live verification: 9 to 4.
- The replay of the 10 replay seeds on engine `049a22f2` ends `completed` with checks 3, 5, 6 and 8 passed.
- A `.git` that is not a directory resolves `gitPaths` again for that call, so the gate keeps its code, commit and push. A staged gitlink of a submodule with `ignore = all` passes invariant I. The `branch_changed` detail names full refs.
- The live run of the 11 seeds on engine `049a22f2` (`runs-c1/` of the eval set) ends `completed` with checks 3, 5 and 6 passed: 262 turns, $0.98, 63.3 tasks minutes, against 338 turns, $1.98 and 82.4 minutes of the baseline. The C0 redaction rule gives most of the cut, in `T8TWV9P5`. The other seeds vary in both directions with the model output.
- [x] C2. Unit record and trailer removal (D21 layer 2). Replay.

### C2 deviations

- The table `worker_unit_record` goes into the existing worker migration, by the migration rule of `AGENTS.md`. C2 needs a new operational store. A store that ran the old worker migration has no unit record table.
- A node branch with `Kanthord-Done` trailers runs each pending unit once more. The release notes state both points.
- The replay of the 10 replay seeds ends `completed` with checks 3, 5 and 6 passed. Check 8 fails by design: each commit holds the recorded tree and message without the trailer, and the outbox adds only `worker.execution.unit_record.put`.
- Each eval seed holds a `plan`, so a local run reads no `unit_records` and no trailer. The engine tests cover the planning from unit records.
- Phase C replays after C2 compare with the C2 live baseline in `runs-c2/` of the eval set, not with the phase B records.
- [x] C3. `ClaimWatch` and push fence (D21 layer 3). Replay.

### C3 deviations

- The per-turn claim read is gone. A 3-turn run with 60 s per turn reads the claim 4 times: 3 watch reads and 1 fence read.
- The proof hook is new. Before C3, only the two agent tools reacted to an execution-end answer, and the run did not end as `revoked`.
- The first signal of D4 comes in C3b.
- The replay of the 10 replay seeds against the phase B records equals the C2 replay: the same commit trees and messages, and the same outbox apart from times and commit ids.
- The C2 live baseline on engine `90d2293d` (`runs-c2/` of the eval set) ends `completed` for all 11 seeds with checks 3, 5 and 6 passed.
- The C3 replay against `runs-c2/` equals the baseline on 8 seeds: the same commit trees and messages, and the same outbox apart from times and commit ids. `EPQQ3DAR`, `T8TWV9P5` and `W70FZ7AJ` stop with `redacted_record` at turns 5, 24 and 25, because the live answer holds a fixture value. The C2 engine stops at the same turns. Later phase C replays compare these 8 seeds.
- [x] C3b. Stop order delivery (D4 first signal). Approved 2026-11-20 by Ulrich.

### C3b deviations

- `endLiveClaim` queues `revoked` for every revoke except the assessment of the execution itself. The first order wins.
- A pause or an archive of a pool-run instance holds the claim until the unit stops or the hold deadline passes. A human act never sends `revoked` as the first order to a pool-run node. Only the restart recovery and the hold deadline send it.
- `worker_instance.archive_actor` goes into the existing worker migration, by the migration rule of `AGENTS.md`. The stop orders stay in memory.
- After a revoke, the fence answers false and the stop release sends no release, also after a requested stop.
- [x] C4. Parallel groups and fail-early order (D21 layer 5). Replay.

### C4 deviations

- The runner had no parallel group before C4, so C4 builds it. The first end that is not `next` cancels the siblings that still run. The first stop in time wins. A budget end merges the writes of each branch that ended with `next`.
- `SpanRecorder` keeps the open span in an `AsyncLocalStorage`, so a step span of a branch has the span that is open at the group start as its parent.
- A streamed reviewer asset that a deadline or a stop cuts deletes its partial file and keeps the stop code of the context.
- The replay against `runs-c2/` equals the baseline on the 8 replay seeds: the same commit trees and messages, and the same outbox apart from times and commit ids.
- `workspace.node` takes its trees serially under the pool lock. Only `gitPaths` and the restore run in parallel. Owner: a later step.
- `units.plan` plans the checkouts serially. Owner: a later step.
- The release tree verification, `markers.check`, the coder report per unit, the split of the release gate steps and `conflict.revisions` belong to C6 or later steps.
- A sibling cancel does not reach `workspace.node`, `units.plan` and `run.call`, because they use `operationContext` or `state.cancel`. The group waits for them. Owner: a later step.
- The first failed download starts no new download, but the running downloads go on until they end or the deadline passes. Owner: a later step.
- [x] C5. Checkpoint merge, telemetry and stop detail (D21 layer 6). Replay.

### C5 deviations

- `base.refresh` runs the marker check of a budget end. No separate `markers.check` step exists, and the D23 loop is not built.
- At a budget end, a merge is resolved only when each conflicted file held a marker right after the merge and holds none now. A modify/delete or a binary conflict is aborted.
- `SecretPort.redact` takes a length limit, so the redaction runs before the cut.
- A final step writes a zero-length `worker.step` span. The CLI host opens the tasks phase span of `worker tasks run`.
- `setup.entries(examine)` and `env.setup(examine)` run in the `workspace` branch of `prepare`. The golden file matches section 4 for `examine`.
- The replay against `runs-c2/` equals the baseline on the 8 replay seeds: the same commit trees and messages, and the same outbox apart from times and commit ids. `turns.jsonl` differs only in drift text of `bash` results.
- [x] C6. The `Conflict` prompt (D22). Replay plus live run. Approved 2026-11-20 by Ulrich.

### C6 deviations

- One `base.refresh` step can run several conflict turns, so the record is a `worker.conflict` span, not the step span.
- `worker tasks run` has no `base.refresh(claim)`, so a local run meets a conflict only at the release gate.
- The eval set gets 5 conflict variants: `conflicts.tsv` and `conflicts.md` of the eval set, trees in `.dev/v2-c6-trees/`. The other 6 seeds have a node head equal to the base, so no conflict is possible there.
- The replay against `runs-c2/` equals the baseline on the 8 replay seeds. One replay of `J6A4H8NA` stopped at turn 9 with `request_differs`: a recorded `read` error became file content. Two later replays and a C5 control replay pass.
- Live comparison on engine `05f02e21` (`runs-c6-shipped/` and `runs-c6-candidate/` of the eval set), one run per seed and variant:
  - Shipped: 3 of 5 correct. `MYD0WTSC` keeps the old intro line that the base replaced. `XHDK27G1` leaves markers and stops with `worker.merge.markers_left`. Conflict model turns 5, 4, 7, 2, 8; 84 model requests.
  - Candidate: 5 of 5 correct, every judge of `conflicts.md` passes. Conflict model turns 5, 5, 5, 3, 9; 82 model requests.
  - The release gate flag is `false` in every run that reached the release gate.

## Open items

- [x] S1, closed. Ruled 2026-11-19 by Aelita as owner: the seed export serves only a node that is not closed, as `worker-service.impl.md` § The seed export states. An eval seed is the start state of a node, not a copy of a past execution. A closed node has no start state: its branch holds the finished work and may be deleted. Phase B takes its seeds from open nodes through `worker tasks seed`, and from new executions through the capture hook `KANTHORD_CAPTURE_TASKS`.
- [ ] Open, outside Worker V2. The case `footprint.measure.run` of `src/apps/server/adapter-conformance.test.ts` fails on the local machine of Ulrich at `engine` `ea454eab`, and passes in CI. The direct adapter answers the alert state `pending` and the HTTP adapter answers `firing`. A local gate of Worker V2 accepts this one failure.

- [ ] Open, before a CLI command for `evaluation`. The `BaseHead` of `evaluation` clones base trees with `cloneLocal` inside `foundryEvaluation`. Add `releaseTrees.takeBase` and `releaseTrees.giveBase` to `EvaluationPorts`, so that the Foundry constructs no tree (rule 1). Ruled 2026-11-17 by Aelita as owner.

- [x] Closed. Tool output that changes over time diverged in a replay. Ruled 2026-11-19 by Ulrich: a difference only in the content text of a tool result is a drift. The replay continues and records the drift in `result.json`. The rule covers only the text of pi built-in tool results. The request structure stays strict.

- [ ] Open, in C1. Each phase C replay reads `drift` of `result.json`. Name the reader before C1 ends: a `--verify` check or a `tasks compare` section. With no reader, delete the field.

- [x] Closed. The session redaction hook replaced test fixture values in the model request, for example `password: '<redacted:quoted_assignment>'`. The model saw the marker in its own earlier tool call and wrote it into the file. Seed `T8TWV9P5` spent turns 71 to 100 of 113 in this loop. Ruled 2026-11-20 by Ulrich: the `content` of an assistant message gets rule 0 only, with no pattern rule and no table value. `agent.impl.md` § Sensitive text redaction records the rule. Two paths still show a marker of a model value, by the same ruling: a tool result that reads back a file of the model, and the compaction summary. The live record on engine `cd52d454` shows neither path in a loop.

- [x] Closed. The `turns.jsonl` writer applies rule 0 and rules 1 to 17, so an answer with a fixture value stays marked, and its replay stops with `redacted_record`. Ruled 2026-11-20 by Aelita as owner: `T8TWV9P5` is a live seed only. The phase C replays use the other 10 seeds. The live record on engine `cd52d454` (`runs-c0/` of the eval set) ends `completed` with checks 3, 5 and 6 passed: 72 turns against 113, $0.53 against $1.09, 18.0 against 35.1 tasks minutes. It has no shell refusal of a marker, and no model text about a marker. Its answer of turn 62 holds a fixture value, so its replay stops at turn 62 with `redacted_record`.

- [ ] Open, in phase B. Each request line of `turns.jsonl` holds the full transcript, so the file grows with the square of the turn count, and `readTurns` loads the whole file with no size cap. Measure one real run in B3 and decide. B3 measures 59.7 MB for 113 turns and 11.1 MB for 42 turns.

- [ ] Open, after phase C. `worker.execution.unit_record.put` refuses an intent other than `implement`, but an evaluation execution of an `implement` node passes the check, because the server stores no claim kind. A row from it can skip a unit in a later execution. Close it with a check of the node state through a Mission Service read port. The change touches the Worker Service and the Mission Service, so Ulrich rules it.

- [x] Closed by C3b. Stop order delivery: the slot and the container frame carry the stop orders, and `endLiveClaim` queues `revoked`.

- [ ] Open, later cleanup. A held override, discard or evidence delete links no execution trace: `holdForStop` passes `null`. Pass the trace of `keptExecution` as the held pause does. The act field `revoked` of `actedOn` also carries the trace of a kept execution; rename it to `linked`.

- [ ] Open, Mission Service. The pending closes of a held override, discard or evidence delete stay in memory. After a server restart, the node stays `Paused` and the human repeats the act. Make them durable only when a reader needs it.

- [ ] Open, server tests. E09.15c of `src/apps/server/e2e-worker-host.test.ts` failed twice under the load of a full verify and passed each time alone. The likely cause is a failed checkpoint push of `branchPushStop` under load. Add a wait on the remote ref, or find the cause.

- [ ] Open, with the first open-world capability. The open-world tool record keys by `call_id` only, and a live run records a doubled `call_id` that the reader refuses. Key by the turn position plus the call id.

- [ ] Open, at each pi upgrade. `src/agent/hooks/checkout-confinement.ts` holds a copy of the path rules of pi (`normalizePath`, `resolvePath` and the `read` spelling variants of pi 1.1.0). Compare the copy with the new pi version before the upgrade lands.

- [ ] Open, Worker Service. `execution.release(stop)` runs in `executionBoundary` outside the walker, so it writes no `worker.step` span. Open the span there. Owner: C6 or later.

- [ ] Open, Worker Service. An `examine` release on `onExit` after a budget end sends no stop, although design section 2 rule 5 names `budget_end/<limit>`. This gap existed before C5. Owner: a later step.

- [ ] Open, Worker Service. A conflict turn in normal conflict mode that ends with no action passes the marker check for a modify/delete or a binary conflict, so gate G commits the "ours" side. Record the conflicted files with no marker at the merge, and refuse them until the agent acts. Owner: C6 (D22) or D23.

- [ ] Open, Worker Service, credential rule. A failed gate G writes the git error text on the `worker.gate` span (`gateFailure`). The text predates C5. Rule whether to redact it with `secrets.redact` or to drop it.

- [ ] Open, owner ruling. Make the candidate `Conflict` template the default: move `{{base_changes}}` into `static/prompt/template/conflict.md`. Evidence: C6 deviations. A default change changes the prompt of every conflict turn.

- [ ] Open, before D24. The owner read of a conflict takes the unit id from the commit body. D24 removes that id; move the read to the unit records or the commit attribution span.

- [ ] Open, Worker Service. The patch diffs `diffText` and `changePatch` of `local-git.ts` run `git diff` with no `--no-ext-diff --no-textconv`, so the checkout config can change their output.

- [ ] Open, eval set. A replay can stop with `request_differs` when a recorded built-in tool error becomes a result: the drift rule covers only the text, not `isError`. Seen once in `J6A4H8NA` turn 9.

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
| A7b  | `engine`   | [#641](https://github.com/kanthorlabs/kanthord-engine/pull/641) | `64f943cd`   |
| A8   | `engine`   | [#643](https://github.com/kanthorlabs/kanthord-engine/pull/643) | `c8d4292d`   |
| A9   | `engine`   | [#644](https://github.com/kanthorlabs/kanthord-engine/pull/644) | `65f8664d`   |
| B1   | `kanthord` | [#433](https://github.com/kanthorlabs/kanthord/pull/433)        | `9872b3cb`   |
| B5   | `engine`   | [#646](https://github.com/kanthorlabs/kanthord-engine/pull/646) | `66b45da5`   |
| C0   | `engine`   | [#650](https://github.com/kanthorlabs/kanthord-engine/pull/650) | `cd52d454`   |
| C1   | `engine`   | [#653](https://github.com/kanthorlabs/kanthord-engine/pull/653) | `049a22f2`   |
| C2   | `engine`   | [#655](https://github.com/kanthorlabs/kanthord-engine/pull/655) | `90d2293d`   |
| C3   | `engine`   | [#660](https://github.com/kanthorlabs/kanthord-engine/pull/660) | `382ecb07`   |
| C3b  | `engine`   | [#664](https://github.com/kanthorlabs/kanthord-engine/pull/664) | `87989394`   |
| C4   | `engine`   | [#665](https://github.com/kanthorlabs/kanthord-engine/pull/665) | `c4cff043`   |
| C5   | `engine`   | [#666](https://github.com/kanthorlabs/kanthord-engine/pull/666) | `2c1d71af`   |
| C6   | `engine`   | [#669](https://github.com/kanthorlabs/kanthord-engine/pull/669) | `44c581a9`   |
