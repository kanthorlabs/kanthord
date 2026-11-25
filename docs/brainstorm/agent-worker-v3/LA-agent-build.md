# The agent build plan

Status: `draft`. Base: engine `c864130e`.

## Goals

1. **G1.** Five sub-layers of ordered pull requests take the engine from the code of today to [L1](L1-model.md), [L2](L2-agent-cli.md), [L3](L3-agent.md) and [L4](L4-agent-evaluation.md). After each pull request, `main` works (R7).
2. **G2.** Each pull request names the acceptance checks and the unit-level rules of L1 to L4 that it makes pass. Each check and each rule of L1 to L4 that LA owns has one pull request (R7).
3. **G3.** Each handoff of L1 to L4 to LA maps to one pull request, or to no pull request with a reason (R7).
4. **G4.** Each pull request keeps each credential rule of today at its strength or makes it stricter (R6).
5. **G5.** The evaluation set of L4 has a builder for each item, and the held-out set stays unread by the author of the prompt changes (R9).
6. **G6.** The agent gate has exact commands and a pass condition for each step, and it names each action that only Ulrich can do (R1, R9).

LA is a build plan. It holds no acceptance check of its own ([index](index.md#reading-order)).

## Start point

(G1)

- The engine of today is `c864130e`, the merge of `feature/worker-v2` (pull request #673, 2026-11-20). `git -C engine log -1 origin/main` gives `c864130e` on 2026-11-22.
- The design pages cite the engine at that commit through `.dev/v3-engine-ref`.
- LA1 PR1 starts from that commit. When `origin/main` moves before LA1 PR1, the pull request rebases and checks each cited line again.

## How each pull request ships

(G1, G4)

1. Each pull request is one engine pull request with the base branch `feature/agent-v2`. The engine `feature/agent-v2` starts from `c864130e`.
2. One implementation sub-agent writes the pull request. Then one review sub-agent reviews the diff and applies each finding with `action:YES`.
3. Aelita opens the pull request. When CI is green, Aelita merges it into `feature/agent-v2` with a squash merge. When CI fails, a new sub-agent fixes the failure, and CI runs again.
4. The root branch `feature/agent-v2` holds the design pages. It keeps the submodule pointer at `c864130e` until the engine `feature/agent-v2` merges into the engine `main`. Then it moves the pointer once, with the subject `chore: point to the engine main with Agent V2`. Constraint: the root pre-commit hook (`.githooks/pre-commit`) accepts a submodule pointer only when the submodule is on `main`.
5. After the agent gate, each `feature/agent-v2` merges into its `main` through one pull request. The root merge comes after the engine merge.
6. A pull request uses the account `kanthorlabs`: `GH_TOKEN=$(gh auth token --user kanthorlabs) gh pr create ...`.
7. Each pull request passes `pnpm run verify` in `engine`, with the corepack pnpm `11.24.0`, and the CI jobs `check` and `e2e`. From LA2 PR 1, each pull request also passes the CI job `agent-e2e`.
8. A pull request that changes a page of `engine/docs/cli/` changes it in the same engine pull request.
9. **Lint scope.** Each pull request lists the files in the scope of [L3-D39](L3-agent.md#decisions) and adds them to the file list of `kanthord/no-inline-object-type`. The pull request fixes each site of the rule in those files. The sub-layer pages give the counts at `c864130e` as union members, property object types and string literal property types.
10. **Watchdog.** Each sub-agent brief names the functions that change. A sub-agent commits a step with green tests at least every 60 minutes. It stops and reports after 30 minutes on one problem, after 15 test runs with no progress, or when the change spreads beyond the named functions. Aelita checks each running sub-agent every 20 minutes ([LA-D14](#decisions)) and stops one that passes a limit.

## Sub-layers

(G1, G2)

A sub-layer is a group of pull requests that ends with acceptance checks. Each check of a sub-layer is an end-to-end test. The pull request lists of the sub-layer pages are the one build order. Build the sub-layers in this order. Do not start a sub-layer before the checks of the sub-layer above it pass.

| Sub-layer                                             | Pull requests | End-to-end checks                                                                            | Where the checks run                         |
| ----------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [LA1 Run skeleton](LA1-run-skeleton.md)               | PR1 to PR11   | L2-AC1, AC3, AC4, AC5, AC7, AC8, AC9, AC13, AC14, AC16; L3-AC1, AC2, AC3, AC4; gate step 4.2 | `pnpm run verify`, CI job `check`            |
| [LA2 Credential boundary](LA2-credential-boundary.md) | PR 1, PR 2    | L2-AC2, AC6                                                                                  | CI job `agent-e2e`                           |
| [LA3 Run ends](LA3-run-ends.md)                       | PR 1 to PR 4  | L2-AC10, AC11, AC12, AC15; L3-AC5                                                            | `pnpm run verify`, CI job `check`            |
| [LA5 Evaluation runner](LA5-evaluation-runner.md)     | PR 1 to PR 5  | L4-AC1 to AC10                                                                               | CI job `agent-e2e`                           |
| [LA4 Consumer migration](LA4-consumer-migration.md)   | PR 1 to PR 3  | L1 AC20, AC28, AC29                                                                          | `pnpm run verify`, CI jobs `check` and `e2e` |

- LA1 ships `run agent` with each credential rule of L2 that needs no Linux job: the `--auth` reader, the run directory, the pi directory, the ambient removal with the proxy names, the `env_proxy` refusal and the confinement. LA1 also holds the end-to-end checks of these rules.
- LA2 adds the Linux job `agent-e2e` and the two checks that need the network namespace or the test user.
- LA5 follows LA3. The evaluation set build and the agent evaluation of [gate step 4.3](#gate-step-43-the-agent-evaluation) follow LA5 and run before LA4 ([LA-D11](#decisions)).
- LA4 follows the agent evaluation. Gate steps 4.1 and 4.2 run after LA4 PR 3.

## Inputs

(G3)

Each handoff to LA, its source and its pull request. "No pull request" gives the reason.

| Source                                                                         | Handoff                                                                                                                                                                   | Pull request                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [L3 To LA](L3-agent.md#to-la), item 10                                         | The lint rule `kanthord/no-inline-object-type` first, and the scope of each pull request                                                                                  | LA1 PR1, and each pull request                                                                       |
| [L3 Import rule](L3-agent.md#import-rule), ruling 2                            | `credentialSecrets` and `mergedSecrets` to `src/agent/known-secrets.ts`; `ProviderFailure` stays in `src/scheduler/contract.ts` ([LA1-D8](LA1-run-skeleton.md#decisions)) | LA1 PR1 + PR2                                                                                        |
| [L3 To LA](L3-agent.md#to-la), item 1                                          | The import moves, the lint globs and the import list                                                                                                                      | LA1 PR3                                                                                              |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), import check              | The import check of L1-D5                                                                                                                                                 | LA1 PR8                                                                                              |
| [L3 To LA](L3-agent.md#to-la), item 2                                          | The split of `sensitive-text-redaction.ts`, the build change of Redaction and the known-secret block                                                                      | LA1 PR4                                                                                              |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), extension rule            | One factory per module, the missing tests and the gate check                                                                                                              | LA1 PR4                                                                                              |
| [L3 To LA](L3-agent.md#to-la), item 8                                          | The gate check of L1 U8                                                                                                                                                   | LA1 PR4                                                                                              |
| [L1 Session file](L1-model.md#session-file), "Order"                           | The build change and its check before `run agent` writes a session file                                                                                                   | LA1 PR4, before LA1 PR10                                                                             |
| [L3 To LA](L3-agent.md#to-la), item 3                                          | The catalog split and the prompt files                                                                                                                                    | LA1 PR5                                                                                              |
| [L3 To LA](L3-agent.md#to-la), item 4                                          | `prompt-chain.ts`, and `finalPrompt` on `composeSystemPrompt`                                                                                                             | LA1 PR6                                                                                              |
| [L3 To LA](L3-agent.md#to-la), item 5                                          | `start-preconditions.ts`, `run-budget.ts`, `run-outcome.ts`, `tool-table.ts`, `agent-contract.ts`                                                                         | LA1 PR7 and PR8; LA3 PR 1 to PR 3                                                                    |
| [L3 Pinned layers](L3-agent.md#pinned-layers)                                  | The move of `pinned-layers.test.ts` to `src/agent/`                                                                                                                       | LA1 PR8                                                                                              |
| [L3 To HANDOFF.md](L3-agent.md#to-handoffmd)                                   | Close the HANDOFF items `RunBudget` and `AgentInput`                                                                                                                      | LA1 PR8                                                                                              |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), test user             | The Linux job: the network namespace of L2-AC2 and the user database entry of L2-AC6                                                                                      | LA2 PR 1                                                                                             |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), test user      | The L4 checks as the test user of the Linux job                                                                                                                           | LA5 PR 1                                                                                             |
| [L3 To LA](L3-agent.md#to-la), item 6                                          | `run agent` of L2 on the contract                                                                                                                                         | LA1 PR9 and PR10; LA3                                                                                |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), program               | `CommandName.Run`, the group `run`, the completeness counts and the pages of `docs/cli/`                                                                                  | LA1 PR10                                                                                             |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), moved checks          | The checks of `tasks run` that `run agent` takes over, with the changes of L2                                                                                             | LA1 PR9 and PR10                                                                                     |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), moved checks              | `credentialOf`, `withoutAmbientCredentials`, `SHELL_NAMES`, `FIXED_GIT_ENV`, `PI_AUTH_FILE`, `bindPiDirectory`                                                            | LA1 PR9 and PR10                                                                                     |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), exits                 | The exits of `run agent` in `docs/cli/other.md`, and the text that names three root names                                                                                 | LA1 PR10 (`2`, `4`, `5`); LA3 PR 2 (`75`)                                                            |
| [L2 handoffs](L2-agent-cli.md#handoffs-to-later-layers), module files          | The file of each unit-level rule of L2                                                                                                                                    | [Module files](#module-files-of-the-l2-rules)                                                        |
| [L2 Rules with no check](L2-agent-cli.md#acceptance-checks), `docs/cli/run.md` | The review of the page text                                                                                                                                               | LA1 PR10 and each LA3 pull request                                                                   |
| [L3 To LA](L3-agent.md#to-la), item 9                                          | `docs/cli/run.md`: the start preconditions and the differences from a `git status` of the developer                                                                       | LA3 PR 1                                                                                             |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), deletion                  | Delete `tasks run`, its files, its tests and the section "Local tasks runs"                                                                                               | LA4 PR 2                                                                                             |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), leftovers                 | Delete the `tasks-*` modules that the deletion leaves with no reader                                                                                                      | LA4 PR 2                                                                                             |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), seed capture              | Delete `KANTHORD_CAPTURE_TASKS`                                                                                                                                           | LA4 PR 2                                                                                             |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), seed operation            | Remove `worker.execution.seed.get` (L1-D23)                                                                                                                               | LA4 PR 2                                                                                             |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), Foundry fields            | Remove `FoundryHost.capabilities`, `foundryEvaluation` and `foundryExamine`                                                                                               | LA4 PR 3                                                                                             |
| [L3 To LA](L3-agent.md#to-la), item 7                                          | The Project Service on the contract                                                                                                                                       | LA4 PR 1                                                                                             |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), consumers                 | The Project Service opens each session through the agent contract                                                                                                         | LA4 PR 1                                                                                             |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), runner         | `run.sh`, `report.sh`, `evaluation.mjs`, `evaluation.test.mjs`, `judge.md`, `judge-task.md`, the scripts                                                                  | LA5 PR 1 to PR 5                                                                                     |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), timeout        | A timeout above 60 seconds for the L4 test file                                                                                                                           | LA5 PR 1                                                                                             |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), judge          | `judge.md` governs items 1 to 3 of `## Judgement` of `re@1`                                                                                                               | LA5 PR 2                                                                                             |
| [L4 handoffs](L4-agent-evaluation.md#handoffs-to-later-layers), set            | The evaluation set under `<data>/evaluation/agent/`                                                                                                                       | [Evaluation set build](#evaluation-set-build)                                                        |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), Workbench                 | The Workbench Service on the contract                                                                                                                                     | No pull request. It waits for the rebase of `feature/workbench-v2` (L3-D41)                          |
| [L1 handoffs](L1-model.md#handoffs-to-later-layers), Worker V2 eval set        | The eval set `~/kanthord-evalset/worker-v2/` loses its runner                                                                                                             | No pull request. LA4 PR 2 deletes the runner, L4 replaces it, and L7 owns its worker-level successor |
| [L1 Mapping of today](L1-model.md#mapping-of-today)                            | LA and LB plan the build of each mapped item                                                                                                                              | No pull request of its own. Each agent item has a pull request above; each worker item goes to LB    |
| [L3 Open paths](L3-agent.md#open-paths-until-l6-and-the-workbench-change)      | The three open paths after LA                                                                                                                                             | No pull request. LA1 PR8 gives that state                                                            |

## Module files of the L2 rules

(G2)

| L2 unit-level rule         | File                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The option parser       | `src/apps/cli/run-agent-options.ts`                                                                                                                                                     |
| 2. The text-or-path reader | `src/apps/cli/run-agent-input.ts`                                                                                                                                                       |
| 3. The `--auth` reader     | `src/apps/cli/run-agent-auth.ts`                                                                                                                                                        |
| 4. The model selection     | `src/apps/cli/run-agent-model.ts`                                                                                                                                                       |
| 5. The session path checks | `src/apps/cli/run-agent-session.ts`                                                                                                                                                     |
| 6. The output writer       | `src/apps/cli/run-agent-output.ts`                                                                                                                                                      |
| 7. The pi directory checks | `src/apps/cli/run-agent-pi.ts`                                                                                                                                                          |
| 8. The start checks        | `src/apps/cli/run-agent-start.ts`                                                                                                                                                       |
| 9. The budget              | `src/apps/cli/run-agent-budget.ts`, with `src/agent/run-budget.ts`                                                                                                                      |
| 10. The class mapping      | `src/agent/run-outcome.ts` for the class and the failure kind; `src/apps/cli/run-agent-exit.ts` for the exit code of each end, `cli.run.agent.open_failed` and a signal during the open |
| 11. The signal handler     | `src/apps/cli/run-agent-signal.ts`                                                                                                                                                      |
| 12. The input digest       | `src/apps/cli/run-agent-digest.ts`                                                                                                                                                      |

Each file has its test file next to it. The command entry is `src/apps/cli/run-agent.ts`. The ambient removal of [The run directory](L2-agent-cli.md#the-run-directory), rule 3, is `src/apps/cli/run-agent-environment.ts`.

## Evaluation set build

(G5)

The set lies in `<data>/evaluation/agent/`, outside the engine repository ([L4 Location](L4-agent-evaluation.md#location)).

| Item                                                                                                        | Builder                         | Done when                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| The set repository, `.gitignore` with `config.json` and `shared/*/node_modules/`, the pre-commit hook `node evaluation.mjs scan`, `shared.sha256` at mode `0600` written by `node evaluation.mjs manifest` | Aelita | A commit with a secret pattern fails the hook; `node evaluation.mjs validate <case>` reports no manifest difference |
| 10 dev cases (5 `backend`, 5 `frontend`), each with `check/reference.patch`                                 | A sub-agent, reviewed by Aelita | `node evaluation.mjs validate <case>` exits `0` for each case                            |
| 20 held-out cases (10 and 10), each with `check/reference.patch`; the `backend` cases are new todoapp tasks | A separate sub-agent            | `validate` exits `0`; Aelita reads only the `validate` output                            |
| `binding/backend.md` and `binding/frontend.md`: the repository prompt of each fixture, conventions included | The sub-agent of the dev cases  | Each text names the conventions that `check.sh conventions` checks                       |
| `config.json` with `cap_usd` 15, `gate_share` 0.6, `judge_usd` `0.1usd` and `base_model`                    | Aelita                          | The configuration rules of [L4 Configuration](L4-agent-evaluation.md#configuration) pass |
| The `anthropic` entry in `<home>/.config/kanthord/auth.json`                                                | Ulrich                          | [L4 Credential](L4-agent-evaluation.md#credential), rule 7                               |

- The case authors start during LA5 PR 4 ([LA-D12](#decisions)). The set repository gets its first commit after LA5 PR 5 merges, when the hook `scan` and the command `validate` exist.
- The backend dev cases come from the task texts of the Worker V2 seeds, the backend held-out cases are new todoapp tasks, and the frontend cases come from the synthetic React and Tailwind fixture ([L4 Evaluation set](L4-agent-evaluation.md#evaluation-set)).
- The pre-commit hook of the set runs `node <engine worktree>/scripts/evaluation/agent/evaluation.mjs scan` with no file, so it reads the staged content. The engine worktree holds a current `pnpm run build`.
- `scan` reads no object inside `repo.bundle`. So before each set commit, the set author runs `scan` over `git log --all -p --binary` of each bundle. No match is allowed.
- Each commit of a case repository has the author and the committer `Kanthor Eval <eval@kanthorlabs.invalid>`, also for a base commit of a seed chain. A rewrite of a commit keeps its tree, its message and its dates, and `case.json` names the new commit.
- `config.json` holds the start values of [L4 Configuration](L4-agent-evaluation.md#configuration), mode `0600`.

## Agent gate

(G6)

Step 4.3 runs on the engine `feature/agent-v2` after LA5 PR 5 and the set build, before LA4. Steps 4.1 and 4.2 run after LA4 PR 3. `kanthord` is the build of the engine commit of each step: `pnpm run build` in `engine`.

### Gate step 4.1. The checks

1. Command: `pnpm run verify` in `engine` on macOS. Then read the scheduled CI run of the engine `main` after LA4 PR 3. The schedule event passes `--full` to `scripts/suite-pass.mjs`, so the jobs `check` and `e2e` skip no recorded pass.
2. Pass: `pnpm run verify` exits `0`. The jobs `check`, `e2e` and `agent-e2e` of that run pass. The name of each end-to-end test starts with its check id. The test log of the three jobs lists each of these ids as passed, and none as skipped: L1 AC20, AC28 and AC29; L2-AC1 to AC16; L3-AC1 to AC5; L4-AC1 to AC10.

### Gate step 4.2. The real-credential run

1. Ulrich gives the pi provider id, the model id and the level of an entry in his pi `auth.json`.
2. Aelita runs the commands of [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) with those values.
3. Pass: the six conditions of that procedure.
4. Step 4.2 runs twice: first at the end of [LA1](LA1-run-skeleton.md#exit-gate), then again in the final gate on the build of LA4 PR 3.

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
6. **Merge.** Each kept change of `eval/swe-1` merges into the engine `feature/agent-v2` through one pull request.

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

1. **LA-D1.** LA has five sub-layers with 25 engine pull requests, then the evaluation set build and the agent gate. Constraint: each pull request is one engine pull request into `feature/agent-v2`; `main` works after each pull request; the pull request lists of the sub-layer pages are the one build order.
2. **LA-D2.** The lint rule comes in LA1 PR1 (shipped with PR2) with the file list `["src/agent/known-secrets.ts"]`. Constraint: each later pull request adds its in-scope files to the list and fixes their sites; no pull request adds an entry to `eslint-suppressions.json`.
3. **LA-D3.** L3-AC1 runs in LA1 PR10, the first pull request that makes `run agent` write a session file. Constraint: LA1 PR4 makes the redaction rules pass before LA1 PR10.
4. **LA-D4.** The Project Service moves to the contract in LA4 PR 1. Constraint: it needs no worker change; it gives the Project Service the exit redaction before the worker round; the Workbench keeps `openSession` until the rebase.
5. **LA-D5.** `DURATION_PATTERN` and `shellOf` move into the modules of `run agent` in LA1 PR9. Constraint: LA4 PR 2 deletes their files of today.
6. **LA-D6.** A check that needs the network namespace or a test user lives in a `src/**/*.linux-test.ts` file, and only the CI job `agent-e2e` runs it, through the script `test:agent-e2e`: L2-AC2, L2-AC6 and L4-AC1 to AC10. Each other end-to-end check lives in a `src/**/*.test.ts` file. `pnpm run verify` runs it on macOS. The CI job `e2e` runs the files that call `startTestSshd`, and the CI job `check` runs the other files. Constraint: on macOS, `pnpm run verify` runs the L4 unit-level rules only.
7. **LA-D7.** The unit-level rules of L2 have the files of [Module files](#module-files-of-the-l2-rules).
8. **LA-D8.** A separate sub-agent writes the held-out cases. Constraint: Aelita writes the prompt changes of the iterations and reads only the `validate` output and the gate lines of the held-out set.
9. **LA-D9.** The iterations commit on the engine branch `eval/swe-1`, made from `feature/agent-v2`. Constraint: a `revert` iteration leaves the branch; each kept change merges into `feature/agent-v2` through a pull request.
10. **LA-D10.** Each end-to-end check starts the built CLI `bin/kanthord.mjs`. Constraint: the harness fails at once when `dist/main.js` is absent; `pnpm run verify` and each CI job that runs an end-to-end check run `pnpm run build` before the tests.
11. **LA-D11.** LA5 comes before LA4 (Ulrich, 2026-11-24). The agent evaluation of gate step 4.3 measures the new agent before the consumers move to it. Constraint: LA5 starts after LA3 PR 4; the evaluation set build and step 4.3 run on `feature/agent-v2` before LA4 PR 1; `worker tasks run` exists during LA5, and the runner never calls it.
12. **LA-D12.** The case authors of the evaluation set start during LA5 PR 4 (Ulrich, 2026-11-25). Constraint: the set repository holds no commit before LA5 PR 5 merges; the first commit runs through the pre-commit hook `node evaluation.mjs scan`; `validate` exits `0` for each case before that commit; the dev author and the held-out author are separate sub-agents, and the held-out author reads no dev case.
13. **LA-D13.** The one-line titles of the 20 held-out cases are known to Aelita and Ulrich (Ulrich, 2026-11-25). The set keeps these cases. Constraint: each prompt change cites a finding of a dev diagnosis; no agent that changes a prompt receives a held-out task title, task text, check output or session; a held-out author report names no task content.
14. **LA-D14.** An outside watchdog limits each build sub-agent (2026-11-25). Constraint: the watchdog reads the sub-agent transcript and reports a stop for the total time (implementer 150, reviewer 120, fix 60 minutes), no commit (75, 75, 45 minutes), too many test runs since the last commit, probe or bisect calls, or 20 idle minutes. At the first stop, Aelita asks for a report within 10 minutes. At the second stop, Aelita stops the sub-agent, keeps its diff on a local `wip/` branch, and gives a smaller pull request or the diagnosis to a new sub-agent.
15. **LA-D15.** Each case of the evaluation set passes a specification audit against L4 content rules 9 and 13 before a baseline (2026-11-26). Constraint: the audit of the dev cases reads only dev cases; a separate author audits the held-out cases and reports no held-out content; a fix states the contract in `task.md` or adds a test cleanup, and never loosens an assertion or widens `allowed` beyond content rule 11; each set change gets a new evaluation id for each baseline.

## Open questions for Ulrich

None.
