# LA4. Consumer migration

Status: `draft`. Parent: [LA](LA-agent-build.md). Base: engine `c864130e`.

## Goal

LA4 moves the last agent consumers of `main` onto the result of LA1 to LA3. The Project Service opens each `env@1` session through `openAgent`, with `endAfterTurn` and the exit redaction ([L3 Project Service](L3-agent.md#project-service)). Then `kanthord worker tasks run`, `tasks seed` and `tasks compare` leave, with their modules, the seed capture and the server operation `worker.execution.seed.get` ([L1-D23](L1-model.md#decisions)). Then the unread field `FoundryHost.capabilities` and the unread exports `foundryEvaluation` and `foundryExamine` leave. Each acceptance check of LA4 runs the shipped `kanthord` server or command line as a process.

## Entry state

LA4 starts after [LA1](LA1-run-skeleton.md), [LA2](LA2-credential-boundary.md), [LA3](LA3-run-ends.md), [LA5](LA5-evaluation-runner.md) and the agent evaluation of [gate step 4.3](LA-agent-build.md#gate-step-43-the-agent-evaluation) ([LA-D11](LA-agent-build.md#decisions)). Each of their checks passes.

1. **Contract.** `openAgent` of `src/agent/agent-contract.ts` takes `RunBudget { deadline, usd }`, checks the start preconditions of the profile and gives each end with its class. `deadline` `null` gives no wall timer, and the command limit of `bash` is `COMMAND_LIMIT_MS` ([L3 Budget](L3-agent.md#budget)).
2. **No `endAfterTurn`.** The run handle has no `endAfterTurn`, and the contract does not wrap `finishTurn`. Reason: the Project Service is the only reader, and it arrives in PR 1.
3. **`run agent`.** It holds its own copy of each check that it takes over from `tasks run`, at the strength of [L2](L2-agent-cli.md) ([LA1-D4](LA1-run-skeleton.md#decisions)). The files of `tasks run` keep their copies.
4. **Open paths of today.** The Project Service opens `env@1` with `openSession` (`src/project/environment-agent.ts:283`) and patches `finishTurn` (`src/project/environment-agent.ts:314-316`). The Workbench opens with `openSession` (`src/workbench/service.ts:397`). The worker opens with `openSessionRuntime` through `agentPort` in `src/worker/unit/agent-port.ts`.
5. **Harness.** The LLM stub `src/apps/cli/e2e-llm-stub-test-support.ts` of LA1 ([LA1-D6](LA1-run-skeleton.md#decisions)). Each end-to-end check starts the built `bin/kanthord.mjs` ([LA-D10](LA-agent-build.md#decisions)).

## Exit state

- The Project Service opens each `env@1` session through `openAgent`. Each text that it gives out passes the exit redaction ([L1 AC20](L1-model.md#checks)).
- `openSession` has one caller, the Workbench Service, until the rebase of `feature/workbench-v2` ([L3-D41](L3-agent.md#decisions)). `openSessionRuntime` has one caller, `agentPort`, until L6.
- `kanthord worker tasks run`, `tasks seed` and `tasks compare` exit `1` with `error: unknown command 'tasks'`. `GET /api/worker/execution/:execution_id/seed` answers `404`.
- The worker writes no seed capture. `KANTHORD_CAPTURE_TASKS` has no reader.
- `kanthord run agent` is the only local agent run.

## Scope

| Change  | File                                                                                                                                                                                                                                                                                                                                                                                  | Content                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changed | `src/agent/agent-contract.ts`                                                                                                                                                                                                                                                                                                                                                         | `endAfterTurn` of the run handle; each `send` clears the flag at its start                                                                                                                              |
| Changed | `src/agent/run-budget.ts`                                                                                                                                                                                                                                                                                                                                                             | The wrap of `finishTurn` ([L3 Budget](L3-agent.md#budget))                                                                                                                                              |
| Changed | `src/project/environment-agent.ts`                                                                                                                                                                                                                                                                                                                                                    | `openAgent` in place of `openSession` and the `finishTurn` patch; `TurnEnd.failure.reason` in place of `session.state.errorMessage`                                                                     |
| Added   | `src/apps/server/e2e-environment-agent.test.ts`, `src/apps/server/e2e-environment-agent-test-support.ts`                                                                                                                                                                                                                                                                              | L1 AC20, with the server as a process                                                                                                                                                                   |
| Added   | `src/apps/server/e2e-worker-tasks-removed.test.ts`                                                                                                                                                                                                                                                                                                                                    | L1 AC28 and L1 AC29                                                                                                                                                                                     |
| Deleted | `src/worker/unit/`: `tasks-run.ts`, `chain-tasks-prepare.ts`, `tasks-capture.ts`, `tasks-compare.ts`, `tasks-credential.ts`, `tasks-open-world.ts`, `tasks-output.ts`, `tasks-seed.ts`, `tasks-seed-file.ts`, `tasks-steps.ts`, `tasks-trees.ts`, `tasks-turns.ts`, `tasks-turns-file.ts`, `tasks-verify.ts`, `tasks-ports.test.ts`, `tasks-verify.test.ts` and the test file of each | The local tasks run, its seed, its capture and its comparison                                                                                                                                           |
| Deleted | `src/apps/cli/`: `worker-tasks.ts`, `worker-tasks-seed.ts`, `worker-tasks-compare.ts`, `tasks-test-support.ts`, `worker-tasks.test.ts`, `worker-tasks-seed.test.ts`, `worker-tasks-compare.test.ts`, `worker-tasks-canary.test.ts`, `worker-tasks-replay.test.ts`, `worker-tasks-replay-checks.test.ts`                                                                               | The commands `tasks run`, `tasks seed`, `tasks compare` and their tests                                                                                                                                 |
| Deleted | `src/apps/worker/tasks-host-tools.ts`, `src/apps/worker/tasks-host-tools.test.ts`                                                                                                                                                                                                                                                                                                     | The host tools of the local run                                                                                                                                                                         |
| Deleted | `src/worker/execution-seed.ts`, `src/worker/execution-seed.test.ts`, `static/openapi/worker/execution.seed.get.yaml`                                                                                                                                                                                                                                                                  | The seed read of the server                                                                                                                                                                             |
| Changed | `src/worker/contract.ts`                                                                                                                                                                                                                                                                                                                                                              | Remove `"execution.seed.get"` (`:2024`), `executionSeedSchema` (`:1395`) and `ExecutionSeedUnavailable` (`:1057`)                                                                                       |
| Changed | `src/worker/service.ts`                                                                                                                                                                                                                                                                                                                                                               | Remove the registration of `execution.seed.get` (`:1617-1624`)                                                                                                                                          |
| Changed | `src/worker/unit/index.ts`, `src/apps/worker/index.ts`                                                                                                                                                                                                                                                                                                                                | Remove the exports of the deleted modules (`src/worker/unit/index.ts:47-86`)                                                                                                                            |
| Changed | `src/worker/unit/chain-runner.ts`, `src/worker/unit/native-method.ts`, `src/apps/worker/unit.ts`                                                                                                                                                                                                                                                                                      | Remove `capture?: TasksCapture` (`chain-runner.ts:68`, `native-method.ts:77`), `captureStart` (`chain-runner.ts:370`) and `captureOf` (`unit.ts:42`, `:729`)                                            |
| Changed | `src/apps/server/thread-driver.ts`, `src/apps/server/container-runtime.ts`                                                                                                                                                                                                                                                                                                            | Remove `"KANTHORD_CAPTURE_TASKS"` from the passed names (`thread-driver.ts:40`, `container-runtime.ts:45`)                                                                                              |
| Changed | `src/apps/cli/worker.ts`                                                                                                                                                                                                                                                                                                                                                              | Remove the import of `addWorkerTasksCommands` (`:11`) and its call (`:456`)                                                                                                                             |
| Changed | `src/apps/cli/completeness.test.ts`                                                                                                                                                                                                                                                                                                                                                   | `DOCUMENTED_COUNT` (`:129`) and `IMPLEMENTED_COUNT` (`:133`) less the removed leaves; `OPERATION_COUNT` (`:134`) and the `worker` count (`:172`) less `worker.execution.seed.get`                       |
| Changed | `src/apps/server/openapi-integration.test.ts`, `src/apps/server/handover-integration.test.ts`, `src/apps/server/e2e-native-methods.test.ts`, `src/apps/server/worker-pool.test.ts`, `src/apps/server/container-runtime.test.ts`, `src/worker/unit/foundry-boundary.test.ts`                                                                                                           | Remove the cases and the names of the deleted parts (see [PR 2](#pr-2-the-deletion-of-tasks-run))                                                                                                       |
| Changed | `src/worker/unit/foundry.ts`, `src/worker/unit/chain-implement.ts`, `src/worker/unit/chain-runner.ts`, `src/worker/unit/foundry-evaluation.ts`, `src/worker/unit/foundry-examine.ts`, `src/worker/unit/chain-evaluation.ts`, `src/worker/unit/chain-examine.ts`, `src/worker/unit/chain-golden.txt`                                                                                   | Remove `FoundryHost.capabilities` and the exports `foundryEvaluation` and `foundryExamine`                                                                                                              |
| Changed | `src/worker/unit/chain-golden.test.ts`, `src/worker/unit/chain-golden.txt`, `src/worker/unit/chain-runner.test.ts`                                                                                                                                                                                                                                                                    | Remove `tasksPrepareChain` (`chain-golden.test.ts:8`, `:15`), the line `chain tasks_prepare` (`chain-golden.txt:99`), and the capture case and `CAPTURE_FAILED` (`chain-runner.test.ts:84`, `:498-520`) |
| Changed | `static/openapi.yaml`                                                                                                                                                                                                                                                                                                                                                                 | Remove the path `/api/worker/execution/{execution_id}/seed` and its reference to the deleted fragment (`:433-434`)                                                                                      |
| Changed | `eslint.config.js`                                                                                                                                                                                                                                                                                                                                                                    | Remove `worker-tasks` and `tasks-test-support` from the import rules (`:429`, `:490`); add `*test-support.ts` to the `apps-server` test-file pattern (`:412`) for the support of L1 AC20                |
| Changed | `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                                                                                                            | The job `e2e` runs `pnpm run build` before the tests ([LA-D10](LA-agent-build.md#decisions))                                                                                                            |
| Changed | `engine/docs/cli/other.md`                                                                                                                                                                                                                                                                                                                                                            | Remove the capture text (`:765`)                                                                                                                                                                        |
| Changed | `engine/docs/cli/worker.md`                                                                                                                                                                                                                                                                                                                                                           | Remove the section "Local tasks runs", the rows of `tasks run`, `tasks seed` and `tasks compare`, and `worker.execution.seed.get` with its error rows                                                   |

**Lint scope** ([L3-D39](L3-agent.md#decisions)). The counts are union members, property object types and string literal property types at `c864130e`.

- PR 1: `src/project/environment-agent.ts` (0, 0, 0). `agent-contract.ts` and `run-budget.ts` are new files of LA1 and are in the list already. `src/project/onboarding.ts` (3, 1, 0) joins only when PR 1 edits one of its declarations.
- PR 2: `src/worker/unit/chain-runner.ts` (3, 0, 0) and `src/worker/unit/native-method.ts` (0, 1, 0) lose a property of a declaration. `src/apps/server/thread-driver.ts` and `src/apps/server/container-runtime.ts` (0, 0, 0) change a constant. `src/worker/contract.ts` is in the list since LA1. `src/worker/unit/index.ts`, `src/apps/worker/index.ts`, `src/apps/worker/unit.ts`, `src/apps/cli/worker.ts` and `src/worker/service.ts` change no declaration, so they stay out.
- PR 3: `src/worker/unit/foundry.ts`, `src/worker/unit/chain-evaluation.ts` and `src/worker/unit/chain-examine.ts` (0, 0, 0).
- The test files and the e2e support stay out.

## Pull requests

Each pull request is one engine pull request into `feature/agent-v2` ([LA How each pull request ships](LA-agent-build.md#how-each-pull-request-ships)). Each one passes `pnpm run verify` in `engine` and the CI jobs `check`, `e2e` and `agent-e2e`. The Project Service move comes before the deletion ([LA4-D1](#decisions)).

### PR 1. The Project Service on the contract

- Files:
  - `endAfterTurn` of the run handle in `agent-contract.ts`, and the wrap of `finishTurn` in `run-budget.ts`. The wrap returns `{ action: "end" }` after `endAfterTurn`, else it calls the `finishTurn` that pi installs. Each `send` clears the flag at its start.
  - `src/project/environment-agent.ts` opens `env@1` with the inputs of [L3 Project Service](L3-agent.md#project-service): `deadline` `null`, `usd` `null`, `session` `memory`, `work` `null`, `consumerTools` `probe` and `environment_write`, `childEnvironment` `{}`, `knownSecrets` from `credentialSecrets`. The `end` callback calls `run.endAfterTurn()`. The patch of `finishTurn`, `withDeadline` and `OpenedSession` leave.
  - `run` returns `Aborted` when the context signal aborts, throws `TurnEnd.failure.reason` for `failed`, and returns `Ended` for each other end. A refused open throws. It logs `redactionSummary()` as today.
  - `src/project/onboarding.ts` keeps its call (`src/project/onboarding.ts:1517-1532`) and its five `end()` cases (`:1555-1640`).
  - `e2e-environment-agent.test.ts` and its support, with L1 AC20; the `apps-server` test-file pattern of `eslint.config.js:412`; the build step of the CI job `e2e`.
- Makes pass: the `endAfterTurn` cases of [L3-U6](L3-agent.md#unit-level-rules); the Project Service half of [L1 U13](L1-model.md#unit-level-rules); [L1 AC20](L1-model.md#checks).
- `main` works: the Project Service keeps the end of today after the tool batch of each of the five cases. The tests of [Checks that keep passing](#checks-that-keep-passing) hold.

### PR 2. The deletion of `tasks run`

- Files:
  - Delete each file of the rows "Deleted" of [Scope](#scope).
  - Remove the server operation `worker.execution.seed.get`: the entry, the schema and the error code in `src/worker/contract.ts`, the registration in `src/worker/service.ts`, the OpenAPI file, `EXECUTION_SEED_FRAGMENT_EXCEPTION` and the access row of `src/apps/server/openapi-integration.test.ts:128-129` and `:312`.
  - Remove the seed capture: `TasksCapture`, `captureStart` and `CAPTURE_FAILED` of `chain-runner.ts`; `CAPTURE_FAILED` and the capture case of `chain-runner.test.ts`; `capture` of `native-method.ts`, `captureOf` of `src/apps/worker/unit.ts`, and `KANTHORD_CAPTURE_TASKS` of `thread-driver.ts` and `container-runtime.ts`.
  - Remove the test cases of the deleted parts: `handover-integration.test.ts` at `:1825` (the seed read) and `:2067` (`worker tasks seed` then `worker tasks run`); `e2e-native-methods.test.ts:925` (the capture); the capture names of `worker-pool.test.ts:427` and `:437` and `container-runtime.test.ts:65` and `:139`; the `tasks-*` paths of `foundry-boundary.test.ts:34-43`.
  - Update the counts of `completeness.test.ts`: `DOCUMENTED_COUNT`, `IMPLEMENTED_COUNT`, `OPERATION_COUNT` and the `worker` count.
  - Remove `tasksPrepareChain` and the line `chain tasks_prepare` of the chain golden test, the capture case of `chain-runner.test.ts`, the seed path of `static/openapi.yaml`, the names `worker-tasks` and `tasks-test-support` of `eslint.config.js`, and the capture text of `docs/cli/other.md`.
  - Change the test of `run-agent-environment.ts` to a literal name list, because `AMBIENT_CREDENTIAL_NAMES` leaves with `tasks-seed.ts`.
  - Change `engine/docs/cli/worker.md`.
  - `e2e-worker-tasks-removed.test.ts` with L1 AC28 and L1 AC29.
- Makes pass: [L1 U7](L1-model.md#unit-level-rules); [L1 AC28 and AC29](L1-model.md#checks).
- `main` works: `run agent` holds each check that `tasks run` held, since LA1 and LA2 ([Credentials](#credentials)). No script of `engine/scripts`, `engine/.github` or the root `scripts` calls a `tasks` command. The breaking change is the one that Ulrich accepted (L1-D23).

### PR 3. The unread Foundry fields

- Files: remove `FoundryHost.capabilities` (`src/worker/unit/foundry.ts:36`) and its two remaining arguments (`src/worker/unit/chain-implement.ts:182`, `src/worker/unit/chain-runner.ts:308`); remove the exports `foundryEvaluation` (`src/worker/unit/foundry-evaluation.ts:90`) and `foundryExamine` (`src/worker/unit/foundry-examine.ts:42`); update `chain-golden.txt` (`:61`, `:85`) and the `name` strings (`chain-evaluation.ts:42`, `chain-examine.ts:26`).
- Makes pass: the golden test of the chain and the tests of today.
- `main` works: `runTasks` reads only `host.ports` and `host.steps` (`src/worker/unit/foundry.ts:169-170`). The worker gives its capabilities to the agent through `native-method.ts:109-114`, not through `FoundryHost`.

## Acceptance checks

Each check runs a shipped process with a real file system and real git. The stubs are at the outside edge only. L1 AC28 and L1 AC29 have one stub, the LLM stub. L1 AC20 also has the test `sshd` on loopback for the repository and a fake `podman` executable on `PATH` for the container runtime ([L1-D25](L1-model.md#decisions)).

1. **[L1 AC20](L1-model.md#checks). A Project Service session of `env@1` holds the exit redaction.**
   - Test file: `src/apps/server/e2e-environment-agent.test.ts`. The test file calls `startTestSshd` (`src/repository/sshd-test-support.ts:130`), so `pnpm run verify` runs it on macOS and the CI job `e2e` runs it on Linux.
   - Fixture:
     - `e2e-environment-agent-test-support.ts` starts `kanthord serve` from `bin/kanthord.mjs` as a child process, as `src/apps/server/e2e-gateway-server.test.ts:511-527` does with the CLI entry.
     - The test sshd serves a bare repository from `createBareRepository` (`src/repository/sshd-test-support.ts:192`).
     - The support writes an executable `podman` into `$TEST/bin`, and `PATH` starts with `$TEST/bin`. That executable answers the runtime checks of `src/apps/server/container-runtime.ts` with the version `PODMAN_MIN_VERSION` (`:30`). It answers each command of the devcontainer build with success. It exits `1` at each proof command with the tail `node: command not found`. It appends each argument list to a log file L.
     - The devcontainer CLI is the npm install of the engine, which `devcontainerCliPath` resolves (`src/apps/server/environment-image.ts:238`). The build calls it with the `podman` of `PATH` (`:840`).
     - The binding holds the `environment` document `{"image":"<base>","customizations":{"kanthord":{"checks":["tool_a --version"]}}}`, the shape of `documentOf` (`src/apps/server/environment-agent-gate.test.ts:91-96`).
     - The server agent credential is K, for `openai-compatible`, routed to the LLM stub. K is a value of ASCII letters only.
   - Command: the support provisions the server with the shipped `kanthord` command line, in the order of `gateFixture` (`src/apps/server/environment-test-support.ts:146-174`), and enables `env@1`. A repository binding apply starts the environment run, and the failed proof starts one `env@1` session. The read is `kanthord project environment list <project-id>`, until `repairing` is `false`.
   - Variant 1, assistant text: the stub answers the first request with a text that holds K and no tool call.
   - Variant 2, provider error: the stub answers each request with HTTP 400 and a body that holds K. The status gives no pi retry.
   - Variant 3, tool input: the stub answers with one `probe` call whose `command` holds K, then with the text `done`.
   - Pass:
     - The stdout and stderr of the server, each output of `environment list` and each output of `kanthord project environment show` hold K zero times.
     - Variant 1: the server log holds one line `sensitive text redacted` with the session id of the run.
     - Variant 2: the server log holds one line `project.onboarding.session_failed`, and its `err` text holds K zero times.
     - Variant 3: L holds K zero times, and L holds no probe command of the session.
     - After each variant, `<state>/environment/` holds no directory `run-env_session*`.
2. **[L1 AC28](L1-model.md#checks). The local tasks commands are unknown.**
   - Test file: `src/apps/server/e2e-worker-tasks-removed.test.ts`. `pnpm run verify` runs it on macOS and the CI job `check` runs it on Linux.
   - Fixture: an empty directory T as the working directory and as `XDG_CONFIG_HOME`. A seed folder S, which is an empty directory.
   - Command: the built `kanthord` with each of `worker tasks run S --credential-stdin --tree a=T`, `worker tasks seed exe_1 --output T/out` and `worker tasks compare T/a T/b`. Standard input is a pipe that holds the text `K`.
   - Pass: each process exits `1`. The first stderr line is `error: unknown command 'tasks'`. Stdout is empty. T holds no new entry. The process reads no byte of standard input.
3. **[L1 AC29](L1-model.md#checks). The seed route is absent.**
   - Test file: `src/apps/server/e2e-worker-tasks-removed.test.ts`.
   - Fixture: `kanthord serve` from `bin/kanthord.mjs` as a child process, with a human token.
   - Command: `GET /api/worker/execution/exe_1/seed` with the human token.
   - Pass: the status is `404` and the error code is `gateway.routing.not_found` (`src/gateway/service.ts:634-645`).

Constraint: L1 AC28 and L1 AC29 are checks of L1-D23 ([LA4-D4](#decisions)).

### Checks that keep passing

- The checks of [LA1](LA1-run-skeleton.md#end-to-end-checks), LA2 and [LA3](LA3-run-ends.md#acceptance-checks).
- `src/apps/server/environment-agent-gate.test.ts`: the four cases at `:391`, `:488`, `:540` and `:602`. The case at `:488` proves the end after the tool batch of case 5 of the five `end()` cases.
- `src/project/environment-agent.test.ts` and `src/project/onboarding.test.ts`, changed only where the open path changes.
- `src/apps/server/e2e-workbench.test.ts`, which proves that the Workbench keeps `openSession`.
- `src/apps/server/e2e-native-methods.test.ts`, `src/apps/server/handover-integration.test.ts` and the `e2e-worker-*.test.ts` files, less the removed cases.
- `src/apps/server/e2e-project-service.test.ts`.

## Unit-level rules

| Rule                                                                                                                                                           | Module                             | Test file                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------- |
| [L3-U6](L3-agent.md#unit-level-rules), the `endAfterTurn` cases: the end after the current batch, a mixed batch, and no carry of the flag into the next `send` | `src/agent/run-budget.ts`          | `src/agent/run-budget.test.ts`          |
| [L1 U13](L1-model.md#unit-level-rules), the Project Service half: a consumer tool that `env@1` does not declare makes the open throw `agent.tool_undeclared`   | `src/project/environment-agent.ts` | `src/project/environment-agent.test.ts` |
| [L1 U7](L1-model.md#unit-level-rules)                                                                                                                          | as L1 U7 names                     | as L1 U7 names                          |

## Credentials

Each rule below stays at its strength or becomes stricter.

1. **No check of `tasks run` is lost.** Each row of the [LA1 Credential statement](LA1-run-skeleton.md#credential-statement) names the check of `tasks run` and its copy in `run agent`. PR 2 starts only when each copy ships and each check of LA1 and LA2 passes. PR 2 then deletes the old copy, which has no other reader.
2. **Standard input.** PR 2 removes `--credential-stdin`, the last command that reads an LLM credential from standard input. This is stricter ([L1-D22](L1-model.md#decisions)).
3. **Seed capture.** PR 2 removes the write of a seed file by the worker and the name `KANTHORD_CAPTURE_TASKS` from the environment that the server gives a worker. This removes one write path and one passed name. This is stricter.
4. **Seed read.** PR 2 removes `worker.execution.seed.get`. Its answer held no credential, but it gave a human caller the setup of an execution. This removes one read path. This is stricter.
5. **Project Service output.** Today the Project Service redacts assistant text in the session and throws `session.state.errorMessage` (`src/project/environment-agent.ts:331`). After PR 1, each text that it gives out passes the exit redaction, and its failure text is `TurnEnd.failure.reason` after `exitText`. L1 AC20 proves it. The session is `memory`, so no session file holds LLM output. This follows the model of [L1 Session file](L1-model.md#session-file), which Ulrich accepted.
6. **Known secrets.** The set stays `credentialSecrets` of the server agent store for the provider of the session (`src/project/environment-agent.ts:308-311`). The tool-input block of [L3-D11](L3-agent.md#decisions) holds for `probe` and `environment_write`. Variant 3 of L1 AC20 proves it at the edge.
7. **Allowlist.** Today the allowlist is the declared tools and the names of the custom tools (`src/project/environment-agent.ts:300-303`). After PR 1, the tool set is the `env@1` profile, and an undeclared consumer tool refuses the open. This is stricter.
8. **Confinement.** Today `checkoutConfinement({ cwd: checkout, roots: [checkout] })` (`src/project/environment-agent.ts:306`). After PR 1, the profile `env@1` is confined, with `roots: [checkout]`. This is the same.
9. **Child environment.** `env@1` declares no `bash`, and `childEnvironment` is `{}`. No credential reaches a child process.

## Handoffs

- **To LA5.** None. The runner of L4 calls only `kanthord run agent`.
- **To LB.** The worker still opens with `openSessionRuntime` through `agentPort` ([L3 Open paths](L3-agent.md#open-paths-until-l6-and-the-workbench-change)). The Worker V2 evaluation set has no runner after PR 2; L7 owns its successor.
- **To the Workbench rebase.** `openSession`, `assistantRedaction` and `SessionRedactionInput` keep one reader, the Workbench Service ([L3-D41](L3-agent.md#decisions)).
- **To the root pages.** These pages name the removed commands or the capture: `docs/explanation/architecture.html`, `docs/brainstorm/architecture.impl.md`, `docs/brainstorm/custody.impl.md`, `docs/brainstorm/worker-service.vocabulary.md`, `docs/brainstorm/worker-service.impl.md`, `docs/brainstorm/worker-execution-refactor/design.md` and `docs/brainstorm/HANDOFF.md`. The root branch `feature/agent-v2` changes them with PR 2.

## Decisions

1. **LA4-D1.** The Project Service move ships before the deletion of `tasks run`. Constraint: the deletion is the last behavior change of LA4 and can revert alone.
2. **LA4-D2.** `endAfterTurn` and its wrap of `finishTurn` ship in PR 1, with their only reader. Constraint: no consumer patches `finishTurn` after PR 1 ([L3-D20](L3-agent.md#decisions)).
3. **LA4-D3.** The deletion of the commands, the seed operation and the seed capture is one pull request. Constraint: each deleted part has its only reader in another deleted part, so a split leaves an item with no reader.
4. **LA4-D4.** The refusal of the deleted commands and the absence of the seed route are the end-to-end checks L1 AC28 and L1 AC29 of L1-D23.
5. **LA4-D5.** L1 AC20 runs the server as a process, with a fake `podman` executable on `PATH` and the test `sshd` as the edges. Constraint: the test file calls `startTestSshd`, so `pnpm run verify` and the CI job `e2e` run it; the CI job `e2e` runs `pnpm run build` before the tests.
6. **LA4-D6.** The removal of `FoundryHost.capabilities`, `foundryEvaluation` and `foundryExamine` is a separate pull request after the deletion. Constraint: it changes no behavior, and the golden test of the chain proves it.
