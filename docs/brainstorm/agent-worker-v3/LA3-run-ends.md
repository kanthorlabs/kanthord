# LA3. Run ends

Status: `draft`. Parent: [LA](LA-agent-build.md). Base: engine `c864130e`.

## Goal

LA3 gives `kanthord run agent` each end of [L2](L2-agent-cli.md) with its exit code and class. A failed start precondition refuses the start before any model request. A provider error that pi retries ends with exit `75`, and each other provider error ends with exit `5`. A cost budget is a list-price limit. A SIGINT or a SIGTERM stops the run with the full record, within 10 seconds. Each acceptance check of LA3 runs the shipped `kanthord` process against the LLM stub.

## Entry state

LA3 starts after [LA1](LA1-run-skeleton.md) and [LA2](LA2-credential-boundary.md). LA3 requires this end behavior from LA1. The behavior keeps the strength of `tasks run` of today (`TasksExit` in `src/worker/unit/tasks-run.ts:105-111`; `stopOnSignal` in `src/apps/cli/worker-tasks.ts:287-292`).

1. **Contract.** `openAgent` of `src/agent/agent-contract.ts` takes `RunBudget { deadline, usd }`. It checks no start precondition. `forceStop`, `close` and `ToolProcesses.killAll` exist ([LA1 PR8](LA1-run-skeleton.md#pull-requests)).
2. **Wall budget.** `src/agent/run-budget.ts` holds the wall limit only. A timer at `deadline` aborts the session, and the end is `budget_end` with `budgetReached` `wall`. `run agent` parses the wall form of `--budget` with `DURATION_PATTERN` and passes the default `2h` ([L2 Budget](L2-agent-cli.md#budget), rules 1 and 7). Reason: no run of `main` is unbounded, and the `budget` field of the result is true.
3. **Cost budget.** `run agent` refuses each `usd` value of `--budget` with `cli.run.agent.option_invalid`, `option: --budget`, and passes `usd` `null`.
4. **Outcome.** `src/agent/run-outcome.ts` gives the ends `completed`, `budget_end`, `stopped` and `failed`, the totals and the failure kind of `providerFailureOf`. Each failure has the class `terminal`. `src/apps/cli/run-agent-exit.ts` maps each end to the exit `0`, `4`, `2` or `5`, and the end `failed` writes `cli.run.agent.provider_failed` or `cli.run.agent.internal_error`.
5. **Signal.** `src/apps/cli/run-agent-signal.ts` holds the behavior of `stopOnSignal` of today: one SIGINT aborts the session through `input.signal`, with no time limit. The run writes the result with the end `stopped` and the class `terminal`, removes R and exits `2`.
6. **Harness.** The e2e support of LA1 starts the built `bin/kanthord.mjs` ([LA-D10](LA-agent-build.md#decisions)), starts the LLM stub on loopback and builds the [L2 fixtures](L2-agent-cli.md#l2-fixtures).

## Exit state

After LA3, a user can run each command line of [L2 Run order](L2-agent-cli.md#run-order) and get each exit of [L2 Exit codes](L2-agent-cli.md#exit-codes): `0`, `1`, `2`, `4`, `5` and `75`. A workspace with an uncommitted change, a subdirectory of a worktree or a directory that is no worktree gives `cli.run.agent.start_refused`. `--budget 0.5usd` limits the list price of a priced model and refuses a model with no price. SIGINT and SIGTERM give the end `stopped`.

## Scope

| Change  | File                                            | Content                                                                                                        |
| ------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Added   | `src/agent/start-preconditions.ts` and its test | The checks of [L3 Start preconditions](L3-agent.md#start-preconditions)                                        |
| Changed | `src/agent/agent-contract.ts`                   | Open step 2 calls the preconditions and returns `AgentRefused`                                                 |
| Changed | `src/agent/run-outcome.ts`                      | The class from `isContextOverflow` and `isRetryableAssistantError`                                             |
| Changed | `src/apps/cli/run-agent-exit.ts`                | Exit `75` for the class `retryable`; exit `2` and no `open_failed` line for a signal during the open           |
| Changed | `src/agent/run-budget.ts`                       | The `usd` limit at `message_end` and the first-limit rule                                                      |
| Changed | `src/apps/cli/run-agent-budget.ts`              | The `usd` form, the refusal `cli.run.agent.budget_unpriced` at step 9                                          |
| Changed | `src/apps/cli/run-agent-signal.ts`              | SIGTERM, the 10-second limit, the forced stop, the second signal, step 11 and a signal before step 10          |
| Changed | `src/apps/cli/run-agent.ts`                     | `cli.run.agent.start_refused`, `cli.run.agent.provider_retryable`, exit `75`, the removal of R at each refusal |
| Added   | `src/apps/cli/e2e-run-agent-ends.test.ts`       | The five e2e checks of [Acceptance checks](#acceptance-checks)                                                 |
| Changed | The LLM stub of the LA1 e2e support             | A delayed answer, a fixed HTTP status with a body, and the record of a closed connection                       |
| Changed | `engine/docs/cli/run.md`                        | Start preconditions, the differences from a `git status` of the developer, Budget, Classes, Shutdown           |
| Changed | `engine/docs/cli/other.md`                      | The exit `75` row of the root exit list                                                                        |
| Moved   | none                                            |                                                                                                                |
| Deleted | none                                            |                                                                                                                |

**Lint scope** ([L3-D39](L3-agent.md#decisions)). `start-preconditions.ts` is new and joins the file list of `kanthord/no-inline-object-type` with 0, 0 and 0 sites. Each changed source file is a new file of LA1, so it is in the list with 0, 0 and 0 sites. The test files and the e2e support stay out.

## Pull requests

Each pull request is one engine pull request and one root pull request that moves the submodule pointer ([LA How each pull request ships](LA-agent-build.md#how-each-pull-request-ships)). Each one passes `pnpm run verify` in `engine` and the CI jobs `check`, `e2e` and `agent-e2e`.

### PR 1. Start preconditions

- Files: `start-preconditions.ts` and its test; open step 2 in `agent-contract.ts`; the refusal of step 9 in `run-agent.ts`, with the removal of R; the section "Start preconditions" of `docs/cli/run.md`; `e2e-run-agent-ends.test.ts` with L2-AC12 and L3-AC5.
- Makes pass: [L3-U4](L3-agent.md#unit-level-rules); the refusal bullet of [L3-U7](L3-agent.md#unit-level-rules); [L2-AC12](L2-agent-cli.md#checks); [L3-AC5](L3-agent.md#acceptance-checks).
- `main` works: each check of LA1 and LA2 uses a W with one commit and no uncommitted change, at the top level of the worktree. `re@1` declares only `workspace_directory`.

### PR 2. Class and the retryable exit

- Files: the class in `run-outcome.ts`; exit `75` in `run-agent-exit.ts`; `cli.run.agent.provider_retryable` in `run-agent.ts`; the delayed answer and the fixed status of the stub; the section "Classes" of `docs/cli/run.md`; the exit `75` row of `docs/cli/other.md`; L2-AC10 in `e2e-run-agent-ends.test.ts`.
- Makes pass: the class cases of [L3-U5](L3-agent.md#unit-level-rules); the class and `retryable` cases of [L2 unit-level rule 10](L2-agent-cli.md#unit-level-rules); [L2-AC10](L2-agent-cli.md#checks).
- `main` works: a terminal failure keeps exit `5`. Only a failure that pi retries changes from exit `5` to exit `75`.

### PR 3. Cost budget

- Files: the `usd` limit and the first-limit rule in `run-budget.ts`; the `usd` form and `cli.run.agent.budget_unpriced` in `run-agent-budget.ts`; the section "Budget" of `docs/cli/run.md`.
- Makes pass: the `usd` and first-limit cases of [L3-U6](L3-agent.md#unit-level-rules); [L2 unit-level rule 9](L2-agent-cli.md#unit-level-rules); the `--budget` rows of [L2 unit-level rule 1](L2-agent-cli.md#unit-level-rules); [L2-AC15](L2-agent-cli.md#checks). L2-AC10 case 1 stays green.
- `main` works: the refusal of a `usd` value becomes an accepted limit. A run with no cost budget does not change.

### PR 4. Signal handler

- Files: `run-agent-signal.ts`; the signal during the open in `run-agent-exit.ts`; the record of a closed connection in the stub; the section "Shutdown" of `docs/cli/run.md`; L2-AC11 in `e2e-run-agent-ends.test.ts`.
- Makes pass: [L2 unit-level rule 11](L2-agent-cli.md#unit-level-rules); the signal-during-open part of [L2 unit-level rule 10](L2-agent-cli.md#unit-level-rules); [L2-AC11](L2-agent-cli.md#checks).
- `main` works: one SIGINT keeps the end `stopped` and exit `2`. SIGTERM gets the same handling.

## Acceptance checks

Each check runs the built `kanthord run agent` as a process, with a real file system, real git and the real pi runtime. The only stub is the LLM stub on loopback. The test file is `src/apps/cli/e2e-run-agent-ends.test.ts`. It needs no network namespace and no test user, so `pnpm run verify` runs it on macOS, and the CI job `check` runs it on Linux.

| Check                                   | PR  | Fixture and command                                                                     | Stub at the edge                                                                                                         | Pass condition      |
| --------------------------------------- | --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| [L2-AC12](L2-agent-cli.md#checks)       | 1   | Two W variants: a changed tracked file; an empty directory. Run once per variant        | Scripted text `ok`; it must receive no request                                                                           | The text of L2-AC12 |
| [L3-AC5](L3-agent.md#acceptance-checks) | 1   | Six variants of `swe@1` and `re@1`, with the scripts `$TEST/fsmonitor` and `$TEST/hook` | Scripted text `ok`                                                                                                       | The text of L3-AC5  |
| [L2-AC10](L2-agent-cli.md#checks)       | 2   | Run with `--budget 5s` against A; Run against B; Run against C                          | A: answer after 30 s. B: HTTP 429 to each request. C: HTTP 401 with a body that holds K, K of ASCII letters only         | The text of L2-AC10 |
| [L2-AC15](L2-agent-cli.md#checks)       | 3   | Run with `--budget 1usd`                                                                | It must receive no request                                                                                               | The text of L2-AC15 |
| [L2-AC11](L2-agent-cli.md#checks)       | 4   | Variant 1: SIGTERM after `$TEST/pid` exists. Variant 2: SIGINT after the first request  | Variant 1: a `bash` call of `echo $$ > "$TEST/pid"; exec sleep 600`. Variant 2: answer after 30 s, with the close record | The text of L2-AC11 |

- **Refusal.** A refusal is exit `1`, no result, and a first stderr line that is no JSON line and starts with the code ([L2 Acceptance checks](L2-agent-cli.md#acceptance-checks)).
- **Timing.** L2-AC10 case 2 waits for the 3 retries of pi, with a base delay of 2 seconds ([L2 Classes](L2-agent-cli.md#classes), rule 5). The test file uses the default test timeout of 60 seconds of `test:files`.
- **Clean exit.** Each check asserts that T holds no file after the exit, which proves the removal of R at each end.

## Unit-level rules

| Rule                                                                            | Module                                                       | Test file                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [L3-U4](L3-agent.md#unit-level-rules) Start preconditions                       | `src/agent/start-preconditions.ts`                           | `src/agent/start-preconditions.test.ts`                                |
| [L3-U5](L3-agent.md#unit-level-rules), the class cases                          | `src/agent/run-outcome.ts`                                   | `src/agent/run-outcome.test.ts`                                        |
| [L3-U6](L3-agent.md#unit-level-rules), the `usd` and first-limit cases          | `src/agent/run-budget.ts`                                    | `src/agent/run-budget.test.ts`                                         |
| L3-U7, the refusal bullet                                                       | `src/agent/agent-contract.ts`                                | `src/agent/agent-contract.test.ts`                                     |
| [L2 rule 1](L2-agent-cli.md#unit-level-rules), `--budget`                       | `src/apps/cli/run-agent-options.ts`                          | `src/apps/cli/run-agent-options.test.ts`                               |
| [L2 rule 9](L2-agent-cli.md#unit-level-rules) Budget                            | `src/apps/cli/run-agent-budget.ts`                           | `src/apps/cli/run-agent-budget.test.ts`                                |
| [L2 rule 10](L2-agent-cli.md#unit-level-rules), the class and `retryable` cases | `src/agent/run-outcome.ts`, `src/apps/cli/run-agent-exit.ts` | `src/agent/run-outcome.test.ts`, `src/apps/cli/run-agent-exit.test.ts` |
| [L2 rule 10](L2-agent-cli.md#unit-level-rules), a signal during the open        | `src/apps/cli/run-agent-exit.ts`                             | `src/apps/cli/run-agent-exit.test.ts`                                  |
| [L2 rule 11](L2-agent-cli.md#unit-level-rules) Signal                           | `src/apps/cli/run-agent-signal.ts`                           | `src/apps/cli/run-agent-signal.test.ts`                                |

The forced stop has no e2e check ([L3 Rules with no check](L3-agent.md#rules-with-no-check-and-the-reason)). The cost limit has no e2e check, because the stub provider has no price. L2-AC15 proves the refusal of a cost budget on that provider ([L2 Rules with no check](L2-agent-cli.md#rules-with-no-check-and-the-reason)).

## Credentials

Each rule below stays at the strength of LA1 and LA2 or becomes stricter.

1. **Exit redaction of the failure reason.** The `reason` row of `provider_retryable` and `provider_failed` and the `failure` of the result pass `exitText` ([L3 Exit redaction](L3-agent.md#exit-redaction)). PR 2 changes the class only, not the text path. L2-AC10 case 3 proves that stderr, O and S hold K zero times when the provider error body holds K.
2. **Session record at a stop.** The input redaction runs before pi persists each entry, at each end. A stop adds the aborted entry through the same path. The forced stop can omit the aborted entry, and it adds no entry ([L2 Shutdown](L2-agent-cli.md#shutdown), rule 2).
3. **Removal of R.** The run removes R at each refusal of step 9, at each end of step 10, at a signal before step 10 and at a second signal. Before LA3, a second signal ends the process with no removal. PR 4 is thus stricter.
4. **Child processes.** At the forced stop, `killAll` ends each child process tree at once. No child process outlives the run, also with a hung pi.
5. **Precondition commands.** Each `git` command of PR 1 gets `isolatedGitEnvironment(childEnvironment(...))` (`src/kernel/git-environment.ts:46`). No name of the runtime process other than `PATH` reaches it, so it holds no credential. No hook and no fsmonitor command runs. A repository filter driver can run with the child environment, which is the environment that the agent `bash` tool gives each child anyway.
6. **Diagnostic rows.** The `reason` row of `start_refused` holds `<id>: <reason text>` and no path. The `option` row of `budget_unpriced` holds the option name only.
7. **No retry of the CLI.** The class `retryable` makes no new request. pi keeps its 3 retries inside the session. The credential thus reaches the provider the same count of times as before LA3.

## Handoffs

- **To LA4.** `endAfterTurn`, its `finishTurn` wrap and the `endAfterTurn` cases of L3-U6, and `deadline: null` for the Project Service ([L3 Project Service](L3-agent.md#project-service)). The start preconditions of `env@1` (`workspace_directory` only) hold for the Project Service when it opens through `openAgent`.
- **To LA5.** The runner of L4 reads the exits `0`, `2`, `4`, `5` and `75`, the `end`, `class` and `budget_reached` fields, and passes `--budget <usd>usd` with a priced model.

## Decisions

1. **LA3-D1.** LA3 requires the [Entry state](#entry-state) from LA1. Constraint: LA1 ships the wall half of `run-budget.ts`, the base of `run-outcome.ts` with the class `terminal` only, and the SIGINT-only stop of today; LA1 refuses a `usd` budget.
2. **LA3-D2.** LA3 has four pull requests in the order start preconditions, class, cost budget, signal handler. Constraint: the refusal before any request ships first; each pull request keeps `main` working.
3. **LA3-D3.** The five e2e checks of LA3 live in `src/apps/cli/e2e-run-agent-ends.test.ts`, and `pnpm run verify` runs them. Constraint: they need no network namespace and no test user.
4. **LA3-D4.** Each pull request changes the sections of `docs/cli/run.md` that its behavior owns. Constraint: the start preconditions text holds the differences from a `git status` of the developer ([L3 Start preconditions](L3-agent.md#start-preconditions)).
