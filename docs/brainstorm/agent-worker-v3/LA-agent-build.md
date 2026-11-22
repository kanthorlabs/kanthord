# The agent build plan

Status: `draft`. Base: engine `c864130e`.

## Goals

1. **G1.** An ordered list of build steps takes the engine from the code of today to [L1](L1-model.md), [L2](L2-agent-cli.md), [L3](L3-agent.md) and [L4](L4-agent-evaluation.md). After each step, `main` works (R7).
2. **G2.** Each step names the acceptance checks and the unit-level rules of L1 to L4 that it makes pass. Each check and each rule of L1 to L4 that LA owns has one step (R7).
3. **G3.** Each handoff of L1 to L4 to LA maps to one step, or to no step with a reason (R7).
4. **G4.** Each step keeps each credential rule of today at its strength or makes it stricter (R6).
5. **G5.** The evaluation set of L4 has a builder for each item, and the held-out set stays unread by the author of the prompt changes (R9).
6. **G6.** The agent gate has exact commands and a pass condition for each step, and it names each action that only Ulrich can do (R1, R9).

LA is a build plan. It holds no acceptance check of its own ([index](index.md#reading-order)).

## Start point

(G1)

- The engine of today is `c864130e`, the merge of `feature/worker-v2` (pull request #673, 2026-11-20). `git -C engine log -1 origin/main` gives `c864130e` on 2026-11-22.
- The design pages cite the engine at that commit through `.dev/v3-engine-ref`.
- Step 1 starts from that commit. When `origin/main` moves before step 1, the step rebases and checks each cited line again.

## How each step ships

(G1, G4)

1. Each step is one pull request in the engine submodule and one root pull request that moves the submodule pointer. The root pull request uses the subject `chore: point to the engine with <step>`, as the root history does.
2. A pull request uses the account `kanthorlabs`: `GH_TOKEN=$(gh auth token --user kanthorlabs) gh pr create ...`.
3. Each step passes `pnpm run verify` in `engine`, with the corepack pnpm `11.24.0`. From step 9, each step also passes `pnpm run test:agent-e2e` in the Linux job of the engine CI.
4. The root pointer moves only after the engine pull request merges.
5. A step that changes a page of `engine/docs/cli/` changes it in the same engine pull request.
6. **Lint scope.** Each step lists the files in the scope of [L3-D39](L3-agent.md#decisions) and adds them to the file list of `kanthord/no-inline-object-type`. The step fixes each site of the rule in those files. The counts below are union members, property object types and string literal property types at `c864130e`.

## Sub-layers

(G1, G2)

A sub-layer is a group of build steps that ends with acceptance checks. Each check of a sub-layer is an end-to-end test. Build the sub-layers in this order. Do not start a sub-layer before the checks of the sub-layer above it pass.

| Sub-layer                                             | Steps                                                                                                         | End-to-end checks                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [LA1 Run skeleton](LA1-run-skeleton.md)               | 1 to 6, 8, the base of 7 and the core of 10, with the `--auth` reader, the run directory and the pi directory | L2-AC1, AC3, AC4, AC8, AC9, AC13; L3-AC1, AC2, AC3, AC4 |
| [LA2 Credential boundary](LA2-credential-boundary.md) | 9, the proxy-name removal and the `env_proxy` refusal                                                         | L2-AC2, AC5, AC6, AC7, AC14                             |
| [LA3 Run ends](LA3-run-ends.md)                       | the rest of 7 and the end part of 10                                                                          | L2-AC10, AC11, AC12; L3-AC5                             |
| [LA4 Consumer migration](LA4-consumer-migration.md)   | 11, 12                                                                                                        | L1 AC20; the refusal of the deleted command             |
| [LA5 Evaluation runner](LA5-evaluation-runner.md)     | 13                                                                                                            | L4-AC1 to AC10                                          |

- LA1 ships `run agent` with the credential checks of `tasks run` at their strength of today or stricter. LA2 adds the Linux job, the proxy-name removal and the `env_proxy` refusal, and owns the credential checks over the code of LA1.
- A step with no end-to-end check of its own belongs to the first sub-layer that needs it.
- The evaluation set build and the agent gate follow LA5.

## Inputs

(G3)

Each handoff to LA, its source and its step. "No step" gives the reason.

| Source                                                                         | Handoff                                                                                                        | Step                                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [L3 To LA](L3-agent.md#to-la), item 10                                         | The lint rule `kanthord/no-inline-object-type` in the first step, and the scope of each step                   | 1, and each step                                                                            |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), `ProviderFailure`     | Move `ProviderFailure` to `src/llm/`                                                                           | 2                                                                                           |
| [L3 Import rule](L3-agent.md#import-rule), ruling 2                            | `credentialSecrets` and `mergedSecrets` to `src/llm/known-secrets.ts`                                          | 2                                                                                           |
| [L3 To LA](L3-agent.md#to-la), item 1                                          | The import moves, the lint globs and the import list                                                           | 3                                                                                           |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), import check              | The import check of L1-D5                                                                                      | 3                                                                                           |
| [L3 To LA](L3-agent.md#to-la), item 2                                          | The split of `sensitive-text-redaction.ts`, the build change of Redaction and the known-secret block           | 4                                                                                           |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), extension rule            | One factory per module, the missing tests and the gate check                                                   | 4                                                                                           |
| [L3 To LA](L3-agent.md#to-la), item 8                                          | The gate check of L1 U8                                                                                        | 4                                                                                           |
| [L1 Session file](L1-model.md#session-file), "Order"                           | The build change and its check before `run agent` writes a session file                                        | 4, before 10                                                                                |
| [L3 To LA](L3-agent.md#to-la), item 3                                          | The catalog split and the prompt files                                                                         | 5                                                                                           |
| [L3 To LA](L3-agent.md#to-la), item 4                                          | `prompt-chain.ts`, and `finalPrompt` on `composeSystemPrompt`                                                  | 6                                                                                           |
| [L3 To LA](L3-agent.md#to-la), item 5                                          | `start-preconditions.ts`, `run-budget.ts`, `run-outcome.ts`, `tool-table.ts`, `agent-contract.ts`              | 7 and 8                                                                                     |
| [L3 Pinned layers](L3-agent.md#pinned-layers)                                  | The move of `pinned-layers.test.ts` to `src/agent/`                                                            | 8                                                                                           |
| [L3 To HANDOFF.md](L3-agent.md#to-handoffmd)                                   | Close the HANDOFF items `RunBudget` and `AgentInput`                                                           | 8                                                                                           |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), test container        | The Linux test container: the network namespace of L2-AC2 and the user database entry of L2-AC6                | 9                                                                                           |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), container      | The L4 checks in the container where the user database gives the home of the test user                         | 9 and 13                                                                                    |
| [L3 To LA](L3-agent.md#to-la), item 6                                          | `run agent` of L2 on the contract                                                                              | 10                                                                                          |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), program               | `CommandName.Run`, the group `run`, the completeness counts and the pages of `docs/cli/`                       | 10                                                                                          |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), moved checks          | The checks of `tasks run` that `run agent` takes over, with the changes of L2                                  | 10                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), moved checks              | `credentialOf`, `withoutAmbientCredentials`, `SHELL_NAMES`, `FIXED_GIT_ENV`, `PI_AUTH_FILE`, `bindPiDirectory` | 10                                                                                          |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), exits                 | The exits of `run agent` in `docs/cli/other.md`, and the text that names three root names                      | 10                                                                                          |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), module files          | The file of each unit-level rule of L2                                                                         | 10 ([Module files](#module-files-of-the-l2-rules))                                          |
| [L2 Rules with no check](L2-agent-cli.md#acceptance-checks), `docs/cli/run.md` | The review of the page text                                                                                    | 10                                                                                          |
| [L3 To LA](L3-agent.md#to-la), item 9                                          | `docs/cli/run.md`: the start preconditions and the differences from a `git status` of the developer            | 10                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), deletion                  | Delete `tasks run`, its files, its tests and the section "Local tasks runs"                                    | 11                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), leftovers                 | Delete the `tasks-*` modules that the deletion leaves with no reader                                           | 11                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), seed capture              | Delete `KANTHORD_CAPTURE_TASKS`                                                                                | 11                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), seed operation            | Remove `worker.execution.seed.get` (L1-D23)                                                                    | 11                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), Foundry fields            | Remove `FoundryHost.capabilities`, `foundryEvaluation` and `foundryExamine`                                    | 11                                                                                          |
| [L3 To LA](L3-agent.md#to-la), item 7                                          | The Project Service on the contract                                                                            | 12                                                                                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), consumers                 | The Project Service opens each session through the agent contract                                              | 12                                                                                          |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), runner         | `run.sh`, `report.sh`, `evaluation.mjs`, `evaluation.test.mjs`, `judge.md`, `judge-task.md`, the scripts       | 13                                                                                          |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), timeout        | A timeout above 60 seconds for the L4 test file                                                                | 13                                                                                          |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), judge          | `judge.md` governs items 1 to 3 of `## Judgement` of `re@1`                                                    | 13                                                                                          |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), set            | The evaluation set under `<data>/evaluation/agent/`                                                            | [Evaluation set build](#evaluation-set-build)                                               |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), Workbench                 | The Workbench Service on the contract                                                                          | No step. It waits for the rebase of `feature/workbench-v2` (L3-D41)                         |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), Worker V2 eval set        | The eval set `~/kanthord-evalset/worker-v2/` loses its runner                                                  | No step. Step 11 deletes the runner, L4 replaces it, and L7 owns its worker-level successor |
| [L1 Mapping of today](L1-model.md#mapping-of-today)                            | LA and LB plan the build of each mapped item                                                                   | No step of its own. Each agent item has a step above; each worker item goes to LB           |
| [L3 Open paths](L3-agent.md#open-paths-until-l6-and-the-workbench-change)      | The three open paths after LA                                                                                  | No step. Step 8 gives that state                                                            |

## Build steps

(G1, G2, G4)

### Step 1. The lint rule `kanthord/no-inline-object-type`

- Files: `eslint.config.js` (the rule, its four selectors of [L3-D39](L3-agent.md#decisions) and an empty file list), the rule test of the `kanthord` plugin.
- Lint scope: no file.
- Makes pass: the rule test. No check of L1 to L4.
- `main` works: the rule applies to no file yet.

### Step 2. The LLM moves

- Files: move `ProviderFailure` from `src/scheduler/contract.ts:67-73` to `src/llm/provider-failure.ts`. Move `credentialSecrets` and `mergedSecrets` from `src/agent/hooks/sensitive-text-redaction.ts` to the new `src/llm/known-secrets.ts`. Update each importer.
- Lint scope: `src/llm/known-secrets.ts` (new), `src/llm/provider-failure.ts` (0, 0, 0). `src/scheduler/contract.ts` and `sensitive-text-redaction.ts` only lose a declaration, so they stay out.
- Makes pass: the moved tests of today.
- `main` works: each importer reads the new place.

### Step 3. The worker-layer moves and the import check

- Files:
  - move `agent-port.ts`, `session-directory.ts`, `review-roots.ts` and `capabilities/*.ts` from `src/agent/` to `src/worker/unit/`, with their tests;
  - move `HOST_TOOL_PARAMETERS`, `EVIDENCE_UPLOAD_PARAMETERS` and `LINK_UPDATE_LIST_PARAMETERS` to `src/worker/contract.ts`;
  - move the code constant of `WorkerErrorCode.StartToolMissing` to `src/agent/pi-tools.ts`, with the value `worker.start.tool_missing`;
  - move the lint glob of `src/agent/capabilities/**/*.ts` (`eslint.config.js:1007`) to `src/worker/unit/capabilities/**/*.ts`, and update the import list of `worker-unit` and `apps-worker` (`eslint.config.js:518-548`);
  - add the import check of [L3 Import rule](L3-agent.md#import-rule).
- Lint scope: `src/worker/contract.ts` (20, 5, 8), `src/agent/pi-tools.ts` (0, 0, 0). The moved files move with no other change, so they stay out.
- Makes pass: [L1 U11](L1-model.md#unit-level-rules), [L1 U15](L1-model.md#unit-level-rules).
- `main` works: the worker reads each moved file at its new place.

### Step 4. The redaction split and the build change of the session file

- Files:
  - split `src/agent/hooks/sensitive-text-redaction.ts` into `src/agent/redaction.ts` and the hook modules `markerRestore`, `inputRedaction`, `outputFinding` and the interim `assistantRedaction` ([L3 Extension modules](L3-agent.md#extension-modules)), each with its test file next to it;
  - add the known-secret block of a tool input ([L3-D11](L3-agent.md#decisions));
  - keep `assistantRedaction` on `openSession` and `openSessionRuntime`;
  - add the rotate warning and the check that no input entry of a session file holds a known secret;
  - change `sessionParts` of `src/agent/agent-session.ts`, with the named members of `SessionRedactionInput`;
  - add the gate check of L1 U8 to `pnpm run verify`.
- Lint scope: `redaction.ts` and the hook modules (new), `src/agent/agent-session.ts` (2, 0, 0).
- Makes pass: [L1 U2, U8 and U10](L1-model.md#unit-level-rules); [L3-U8, L3-U10, L3-U12 and L3-U13](L3-agent.md#unit-level-rules).
- `main` works: both open paths of today keep the three redactions of LLM output of today.

### Step 5. The catalog split and the prompt files

- Files: `src/agent/catalog.ts` with the profiles and `AgentTools`; the new `src/agent/declarations.ts`; `src/agent/prompt-assets.ts`; `static/prompt/coding.md`, `static/prompt/role/swe@1.md` and `static/prompt/role/re@1.md` ([L3 Prompt files](L3-agent.md#prompt-files)). The server readers of `getAgentDeclaration` import it from `declarations.ts`.
- Lint scope: `catalog.ts` (0, 0, 0), `declarations.ts` and `prompt-assets.ts` (new or 0). A server reader that only changes its import path stays out.
- Makes pass: [L3-U2, L3-U3](L3-agent.md#unit-level-rules).
- `main` works: the old `swe@1.md` and `re@1.md` stay for the worker path until LB.

### Step 6. The prompt chain

- Files: the new `src/agent/prompt-chain.ts` (`composeSystemPrompt`, `profilePrompt`, `systemPromptDigest`); `finalPrompt` of `src/agent/prompt-render.ts` calls `composeSystemPrompt`; `systemPrompt` leaves; the call of `finalPrompt` in `src/workbench/service.ts`.
- Lint scope: `prompt-chain.ts` (new), `src/agent/prompt-render.ts` (2, 1, 0), `src/workbench/service.ts` (0, 2, 0).
- Makes pass: [L3-U1](L3-agent.md#unit-level-rules).
- `main` works: L3-U1 proves the byte-equal composed text of each consumer of today.

### Step 7. The start preconditions, the budget and the outcome

- Files: the new `src/agent/start-preconditions.ts`, `src/agent/run-budget.ts` and `src/agent/run-outcome.ts`, with their tests.
- Lint scope: the three new files.
- Makes pass: [L3-U4, L3-U5, L3-U6](L3-agent.md#unit-level-rules).
- `main` works: no consumer calls the new modules yet.

### Step 8. The agent contract

- Files: the changes of `src/agent/tool-table.ts` ([L3 Child processes](L3-agent.md#child-processes)); `setWork(work: WorkPin | null)` in `src/agent/pinned-layers.ts`; the move of `src/worker/unit/pinned-layers.test.ts` to `src/agent/pinned-layers.test.ts`, on Faux and the [L1 shared fixtures](L1-model.md#shared-fixtures); the new `src/agent/agent-contract.ts`. Close the two HANDOFF items of [L3 To HANDOFF.md](L3-agent.md#to-handoffmd).
- Lint scope: `agent-contract.ts` (new), `tool-table.ts` (0, 0, 0), `pinned-layers.ts` (0, 0, 0).
- Makes pass: [L1 U3, U6](L1-model.md#unit-level-rules); [L3-U7, L3-U9, L3-U11](L3-agent.md#unit-level-rules).
- `main` works: the open paths of today stay, and no shipped command calls `openAgent` yet.

### Step 9. The Linux test job

- Files: the script `test:agent-e2e` of `engine/package.json`; a job of `engine/.github/workflows/ci.yml` on `ubuntu-latest` that runs it; the test support that starts the LLM stub on loopback, makes the network namespace N with `unshare`, and makes the test user with the home H ([L2 fixtures](L2-agent-cli.md#acceptance-checks)).
- Lint scope: the new test support files are test files, so they stay out.
- Makes pass: the self-test of the job: the stub answers a scripted request in N, and `os.userInfo().homedir` of the test user is H.
- `main` works: the job runs no check of L1 to L4 yet.

### Step 10. `kanthord run agent`

- Files:
  - the modules of [Module files](#module-files-of-the-l2-rules), on `openAgent`;
  - the checks of `tasks run` that `run agent` takes over, with the changes of L2: `credentialOf` with `readStoredCredential`, `routingMetadataOf` with the mapping, `withoutAmbientCredentials` on R and the proxy names, the child `TMPDIR` `R/tmp`, `SHELL_NAMES`, `FIXED_GIT_ENV`, `PI_AUTH_FILE` and `bindPiDirectory`;
  - `DURATION_PATTERN` from `src/worker/unit/tasks-seed.ts` and `shellOf` from `src/apps/cli/worker-tasks.ts` move into the modules of `run agent`;
  - `CommandName.Run` and the group `run` in `createProgram` (`src/apps/cli/index.ts`); `run` in `TOP_LEVEL_NAMES`, `PAGE_INVENTORIES` and `PAGE_COUNTS`; `DOCUMENTED_COUNT` and `IMPLEMENTED_COUNT` of `src/apps/cli/completeness.test.ts`;
  - `engine/docs/cli/run.md`, with the start preconditions and the differences from a `git status` of the developer; the root names, the root help list and the exits `2`, `4`, `5` and `75` in `docs/cli/other.md`; the link list of `docs/cli/README.md`; the text that names three root names: `docs/cli/other.md:1155`, `docs/cli/README.md:71` and `docs/cli/project.md:36`.
- Lint scope: each new module of `run agent`, `src/apps/cli/index.ts` (0, 0, 0).
- Makes pass:
  - [L2-AC1 to L2-AC14](L2-agent-cli.md#checks), and with them L1 AC1, AC2, AC3, AC4, AC6, AC7, AC8, AC10, AC21, AC22, AC23, AC24, AC26 and AC27;
  - [L3-AC1 to L3-AC5](L3-agent.md#acceptance-checks);
  - [L1 U1, U4, U5, U9, U14](L1-model.md#unit-level-rules);
  - the unit-level rules 1 to 12 of [L2](L2-agent-cli.md#unit-level-rules).
- `main` works: `tasks run` stays until step 11. This is the first step that makes `run agent` write a session file, and step 4 comes before it.

#### Module files of the L2 rules

| L2 unit-level rule         | File                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| 1. The option parser       | `src/apps/cli/run-agent-options.ts`                                |
| 2. The text-or-path reader | `src/apps/cli/run-agent-input.ts`                                  |
| 3. The `--auth` reader     | `src/apps/cli/run-agent-auth.ts`                                   |
| 4. The model selection     | `src/apps/cli/run-agent-model.ts`                                  |
| 5. The session path checks | `src/apps/cli/run-agent-session.ts`                                |
| 6. The output writer       | `src/apps/cli/run-agent-output.ts`                                 |
| 7. The pi directory checks | `src/apps/cli/run-agent-pi.ts`                                     |
| 8. The start checks        | `src/apps/cli/run-agent-start.ts`                                  |
| 9. The budget              | `src/apps/cli/run-agent-budget.ts`, with `src/agent/run-budget.ts` |
| 10. The class mapping      | `src/agent/run-outcome.ts`                                         |
| 11. The signal handler     | `src/apps/cli/run-agent-signal.ts`                                 |
| 12. The input digest       | `src/apps/cli/run-agent-digest.ts`                                 |

Each file has its test file next to it. The command entry is `src/apps/cli/run-agent.ts`.

### Step 11. The deletion of `tasks run`

- Files:
  - delete `src/worker/unit/tasks-run.ts`, `src/apps/cli/worker-tasks.ts`, `src/apps/worker/tasks-host-tools.ts` and their tests;
  - delete the modules with no reader: `chain-tasks-prepare.ts`, `tasks-capture.ts`, `tasks-compare.ts`, `tasks-open-world.ts`, `tasks-output.ts`, `tasks-seed.ts`, `tasks-seed-file.ts`, `tasks-steps.ts`, `tasks-trees.ts`, `tasks-turns.ts`, `tasks-turns-file.ts` and `tasks-verify.ts` of `src/worker/unit/`; `worker-tasks-seed.ts`, `worker-tasks-compare.ts` and `tasks-test-support.ts` of `src/apps/cli/`;
  - delete `KANTHORD_CAPTURE_TASKS` in `chain-runner.ts`, `native-method.ts`, `src/apps/server/thread-driver.ts` and `src/apps/server/container-runtime.ts`;
  - remove the server operation `worker.execution.seed.get` ([L1-D23](L1-model.md#decisions));
  - remove `FoundryHost.capabilities` (`src/worker/unit/foundry.ts:36`) and its three arguments, the exports `foundryEvaluation` and `foundryExamine`, and update `chain-golden.txt` and the two `name` strings;
  - delete the section "Local tasks runs" and `tasks seed` of `engine/docs/cli/worker.md`.
- Lint scope: `chain-runner.ts` (3, 0, 0), `native-method.ts` (0, 1, 0), `foundry.ts`, `thread-driver.ts`, `container-runtime.ts`, `chain-evaluation.ts` and `chain-examine.ts` (0, 0, 0).
- Makes pass: the tests of today less the deleted ones; [L1 U7](L1-model.md#unit-level-rules) on the line.
- `main` works: `run agent` holds each check that it takes over since step 10. The removal of `worker.execution.seed.get` is the breaking change that Ulrich accepted (L1-D23).

### Step 12. The Project Service on the contract

- Files: `src/project/environment-agent.ts` opens `env@1` through `openAgent`, with `deadline: null`, `work: null` and `endAfterTurn` ([L3 Project Service](L3-agent.md#project-service)). `src/project/onboarding.ts` changes only where the call shape needs it.
- Lint scope: `environment-agent.ts` (0, 0, 0). When the step edits a declaration of `onboarding.ts`, it adds that file (3, 1, 0).
- Makes pass: [L1 AC20](L1-model.md#checks).
- `main` works: the Project Service keeps the end mapping of today ([L3 Project Service](L3-agent.md#project-service)). The Workbench keeps `openSession` with the interim redaction (L3-D41).

### Step 13. The evaluation runner

- Files: `scripts/evaluation/agent/run.sh`, `report.sh`, `evaluation.mjs`, `evaluation.test.mjs`, `judge.md` and `judge-task.md`. Add the test file to the scripts `test`, `format`, `lint` and `format:check` of `package.json`, and `evaluation.mjs` to `format`, `lint` and `format:check`. Give the test file a timeout above 60 seconds. Run the L4 checks in the Linux job of step 9.
- `judge.md` holds the question of each goal aspect and the output form of [L4 Diagnosis](L4-agent-evaluation.md#diagnosis). It governs items 1 to 3 of `## Judgement` of `re@1`, names missing process evidence as an A5 finding, and allows a quote of the transcript.
- Lint scope: the rule covers `.ts` files only, so no file.
- Makes pass: [L4-AC1 to L4-AC10](L4-agent-evaluation.md#checks); the unit-level rules 1 to 20 of [L4](L4-agent-evaluation.md#unit-level-rules).
- `main` works: the runner is a script of the repository, and no shipped command calls it.

## Evaluation set build

(G5)

The set lies in `<data>/evaluation/agent/`, outside the engine repository ([L4 Location](L4-agent-evaluation.md#location)).

| Item                                                                                                        | Builder                         | Done when                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| The set repository, `.gitignore` with `config.json`, the pre-commit hook `node evaluation.mjs scan`         | Aelita                          | A commit with a secret pattern fails the hook                                            |
| 10 dev cases (5 `backend`, 5 `frontend`), each with `check/reference.patch`                                 | A sub-agent, reviewed by Aelita | `node evaluation.mjs validate <case>` exits `0` for each case                            |
| 6 held-out cases (3 and 3), each with `check/reference.patch`                                               | A separate sub-agent            | `validate` exits `0`; Aelita reads only the `validate` output                            |
| `binding/backend.md` and `binding/frontend.md`: the repository prompt of each fixture, conventions included | The sub-agent of the dev cases  | Each text names the conventions that `check.sh conventions` checks                       |
| `config.json` with `cap_usd` 15, `gate_share` 0.6, `judge_usd` `0.1usd` and `base_model`                    | Aelita                          | The configuration rules of [L4 Configuration](L4-agent-evaluation.md#configuration) pass |
| The `anthropic` entry in `<home>/.config/kanthord/auth.json`                                                | Ulrich                          | [L4 Credential](L4-agent-evaluation.md#credential), rule 7                               |

- The set build starts after step 13, because `validate` and `scan` are commands of `evaluation.mjs`.
- The backend cases come from the task texts of the Worker V2 seeds, and the frontend cases from the synthetic React and Tailwind fixture ([L4 Evaluation set](L4-agent-evaluation.md#evaluation-set)).

## Agent gate

(G6)

The gate runs on the engine `main` after step 13 and the set build. `kanthord` is the build of that commit: `pnpm run build` in `engine`.

### Gate step 4.1. The checks

1. Command: `pnpm run verify` in `engine` on macOS, and the CI job of the engine pull request of step 13 on Linux.
2. Pass: both exit `0`, and the Linux job reports each check of L2, L3 and L4 by id with no skip.

### Gate step 4.2. The real-credential run

1. Ulrich gives the pi provider id, the model id and the level of an entry in his pi `auth.json`.
2. Aelita runs the commands of [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) with those values.
3. Pass: the six conditions of that procedure.

### Gate step 4.3. The agent evaluation

1. Ulrich provisions the `anthropic` entry ([L4 Credential](L4-agent-evaluation.md#credential), rule 7).
2. **A/A baseline of stage 1.**
   - `run.sh --evaluation s1-b1 --stage 1 --set dev`
   - `run.sh --evaluation s1-b2 --stage 1 --set dev --replicate s1-b1`
   - `report.sh --evaluation s1-b2`
   - Pass: `report.sh` exits `0`, and the report holds the A/A line. Ulrich sets the threshold of the noise rule from it ([L4 A/A measure](L4-agent-evaluation.md#aa-measure)).
3. **Iterations of stage 1.** For each iteration n:
   - Aelita commits one change to `static/prompt/role/swe@1.md` and its copy `static/prompt/swe@1.md` on the engine branch `eval/swe-1`, and builds the engine.
   - `run.sh --evaluation s1-i<n> --stage 1 --set dev --parent <last kept id> --aspect <A1..A7> --hypothesis "<text>"`
   - `report.sh --evaluation s1-i<n>`
   - Pass of one iteration: the verdict `keep`. A `revert` iteration leaves the engine branch with `git revert`.
4. **Stage gate of stage 1.**
   - `run.sh --evaluation s1-g<k> --stage 1 --set held-out`
   - `report.sh --evaluation s1-g<k>`
   - Pass: the gate line shows the pass share of `backend` and of `frontend` at or above `gate_share`, and no A9 breach. A failed gate returns to item 3. After a gate with no verdict, Ulrich decides the next step.
5. **Stage 2.** Items 2 to 4 with `--stage 2` and the ids `s2-*`.
6. **Merge.** Each kept change of `eval/swe-1` merges into the engine `main` through one pull request, with a root pointer pull request.

Only Ulrich can do these actions: give the entry of step 4.2; provision the `anthropic` entry; set the noise threshold after each A/A line; raise `cap_usd`; decide after a gate with no verdict.

## Handoffs to LB

(G3)

- [L1 AC18](L1-model.md#checks): the worker session holds the exit redaction and the allowlist.
- Each item of [L3 To L6](L3-agent.md#to-l6): the port `agent.open`, `extensions`, `RunBudget.turns`, the session kind `directory`, `TurnEnd.complete`, `observe` and the events, `appendCustom`, the telemetry and the worker path on the prompt chain.
- The deletion of the old `static/prompt/swe@1.md` and `re@1.md` after the worker path reads the Role files.
- The other sites of the lint rule of [HANDOFF.md](../HANDOFF.md#architecture), Architecture, for each file that an LB step edits.

### Items that wait for the Workbench rebase

- The Workbench Service on the contract, and [L1 AC19](L1-model.md#checks).
- The move of `hooks/tool-approval.ts` to `src/workbench/tool-approval.ts`.
- The deletion of `openSession`, `assistantRedaction` and `SessionRedactionInput`, when no consumer reads them ([L3 Constraints on the Workbench branch at rebase](L3-agent.md#constraints-on-the-workbench-branch-at-rebase)).

## Decisions

1. **LA-D1.** LA has 13 engine steps, the evaluation set build and the agent gate. Constraint: each engine step is one engine pull request and one root pointer pull request; `main` works after each step.
2. **LA-D2.** The lint rule comes in step 1 with an empty file list. Constraint: each later step adds its in-scope files to the list and fixes their sites; no step adds an entry to `eslint-suppressions.json`.
3. **LA-D3.** L3-AC1 runs in step 10, the first step that makes `run agent` write a session file. Constraint: step 4 makes the redaction rules pass before step 10.
4. **LA-D4.** The Project Service moves to the contract in LA, in step 12. Constraint: it needs no worker change; it gives the Project Service the exit redaction before the worker round; the Workbench keeps `openSession` until the rebase.
5. **LA-D5.** `DURATION_PATTERN` and `shellOf` move into the modules of `run agent` in step 10. Constraint: step 11 deletes their files of today.
6. **LA-D6.** The checks that need the network namespace or a test user run in the engine CI job `test:agent-e2e` on `ubuntu-latest`: L2-AC2, L2-AC6 and the L4 checks that need them. Each other end-to-end check runs in `pnpm run verify`. Constraint: the job makes the network namespace and the test user.
7. **LA-D7.** The unit-level rules of L2 have the files of [Module files](#module-files-of-the-l2-rules).
8. **LA-D8.** A separate sub-agent writes the held-out cases. Constraint: Aelita writes the prompt changes of the iterations and reads only the `validate` output and the gate lines of the held-out set.
9. **LA-D9.** The iterations commit on the engine branch `eval/swe-1`. Constraint: a `revert` iteration leaves the branch; each kept change merges into `main` through a pull request.
10. **LA-D10. Applied to L1 and L3.** L1 AC20 has the owner L3, with step 12 of LA. L1 hands the Project Service move to LA. L3 places the Project Service move in LA, and L3-AC1 in the first step that makes `run agent` write a session file.

## Open questions for Ulrich

None.
