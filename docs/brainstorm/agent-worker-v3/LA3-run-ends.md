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

Each pull request is one engine pull request into `feature/agent-v2` ([LA How each pull request ships](LA-agent-build.md#how-each-pull-request-ships)). Each one passes `pnpm run verify` in `engine` and the CI jobs `check`, `e2e` and `agent-e2e`.

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
| [L3-U6](L3-agent.md#unit-level-rules), the `usd` and first-limit cases          | `src/agent/run-budget.ts`, `src/agent/agent-contract.ts`     | `src/agent/run-budget.test.ts`, `src/agent/agent-contract.test.ts`     |
| L3-U7, the refusal bullet                                                       | `src/agent/agent-contract.ts`                                | `src/agent/agent-contract.test.ts`                                     |
| [L2 rule 1](L2-agent-cli.md#unit-level-rules), `--budget`                       | `src/apps/cli/run-agent-budget.ts`                           | `src/apps/cli/run-agent-budget.test.ts`                                |
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

## Build details

### PR 1 build

1. **`checkPreconditions` signature.** `checkPreconditions` is asynchronous. It takes `PreconditionInput { preconditions, cwd, roots, inputEnv, timeoutMs? }` and gives `Promise<StartRefusal | null>`. Each `git` command runs through `execFile`, so a check does not block the event loop of a consumer. `timeoutMs` defaults to `RUNTIME_SETUP_DEADLINE_MS`. Each `git` command gets `isolatedGitEnvironment(childEnvironment(...))`.

2. **`makeInput` git workspace.** `agent-contract.test.ts`'s `makeInput` now initializes a git workspace (one commit, `--quiet` on init and commit). Tests that called `openAgent` with the old empty directory now use a valid, clean worktree. Tests that intentionally need a dirty workspace add an uncommitted file before calling `openAgent`. The key.txt redaction test commits the file before calling `openAgent`.

3. **`import-check.test.mjs` RUNTIME_MODULES.** `src/agent/start-preconditions.ts` joins the RUNTIME_MODULES list in `scripts/import-check.test.mjs`, between `sensitive-text.ts` and `tool-table.ts`. Its import closure uses only node builtins, `src/kernel/`, and existing RUNTIME_MODULES entries.

4. **L3-AC5 variant 6.** The test writes to `.git/config` with `appendFileSync` to set `core.fsmonitor` and `core.hooksPath`. `simpleGit.raw(["config", ...])` refuses unsafe config without `allowUnsafeFsMonitor: true` in its options. Direct file append bypasses `simpleGit` and sets the config that the test must prove `isolatedGitEnvironment` overrides.

5. **Stream silence test.** The test "no runtime module writes to process.stdout or process.stderr" calls `makeInput` first, then mocks the two streams, then calls `openAgent`, `send` and `close`. Reason: the Node test runner writes its own report events to stdout while `makeInput` waits for a `git` process.

6. **`start_refused` diagnostic.** `run-agent.ts` throws a `Diagnostic` with the code `cli.run.agent.start_refused` and the `reason` row. `runCLI` prints it and exits `1`, and the `finally` block removes R. PR 1 does not change `run-agent-exit.ts`.

7. **Open output file.** A start refusal comes after step 6, so O exists with no line. L2-AC12 and L3-AC5 assert that O holds no line.

8. **Proof of L3-AC5 variant 6.** With no `isolatedGitEnvironment`, the variant fails on `$TEST/M10`. With no `--no-optional-locks`, the variant fails on the digest listing of W.

### PR 2 build

1. **`providerFailureClass` in `run-outcome.ts`.** The function takes `last: AssistantMessage` and `contextWindow: number`. It calls `isContextOverflow(last, contextWindow)` from `@earendil-works/pi-ai/utils/overflow` and `isRetryableAssistantError(last)` from `@earendil-works/pi-ai/utils/retry`. When the message is not a context overflow and is a retryable error, it returns `FailureClass.Retryable`; otherwise `FailureClass.Terminal`. `agent-contract.ts` already imported both predicates directly in `failureOf`; PR 2 moves the logic into `run-outcome.ts` and removes the imports from `agent-contract.ts`.

2. **`FailureClass` import in `agent-contract.ts`.** After removing the inline predicates, `FailureClass` was no longer used directly in `agent-contract.ts` (it is re-exported via `export { ... } from "./run-outcome.ts"`). ESLint reported it as an unused import. The fix removes `FailureClass` from the named import while keeping the re-export.

3. **Stub delayed answer and closed-connection safety.** `StubTextTurn` gains `delayMs?: number`. `llmStub` accepts `LlmStubOptions { fixedStatus? }`. For the wall-budget test, the stub delays the response 30 s via `setTimeout`. The wall fires after 5 s and closes the connection. The stub clears the timer at the `close` event of the response. The stub thus writes nothing to a closed connection, and no timer keeps the test process alive. `NO_DELAY_MS = 0` is the named constant for the no-delay default; `if (delayMs > NO_DELAY_MS)` satisfies the `no-restricted-syntax` rule.

4. **Stub fixed status.** `fixedStatus?: { status: number; body: string }` in `LlmStubOptions` overrides every request with the same HTTP error. For the 429 test, all 4 requests (3 pi retries + 1 initial) receive `429 Too Many Requests`. The turn list is empty when `fixedStatus` is set.

5. **401 test uses `http_error` turn kind.** The 401 case passes a single `StubHttpErrorTurn` with the body `{ error: { message: "Unauthorized: TEST_K" } }`. It uses the existing `http_error` turn path, not `fixedStatus`, because the test needs exactly one request and no retry. The body holds `TEST_K` to prove redaction.

6. **L2-AC10 named constants.** `ONE_LINE = 1`, `AC10_RETRY_REQUESTS = 4`, `AC10_SINGLE_REQUEST = 1`, `DURATION_BUDGET_MIN_MS = 5000`, `DURATION_BUDGET_MAX_MS = 30000` satisfy the `no-restricted-syntax` rule that prohibits numeric literals in comparisons. `CLASS_RETRYABLE`, `FAILURE_RATE_LIMITED`, `FAILURE_UNAUTHORIZED`, `BUDGET_REACHED_WALL`, `BUDGET_5S`, `PROVIDER_RETRYABLE_CODE` and `PROVIDER_FAILED_CODE` are the string constants for the new tests.

7. **Wall-budget duration assertion.** The test asserts `duration_ms >= 5000 && duration_ms < 30000`, as L2-AC10 states. The lower bound proves that the wall ended the run. The upper bound proves that the run did not wait for the answer of the stub.

8. **Wall budget during a pi retry.** A wall budget that ends during the wait of a pi retry gives the end `budget_end` and exit `4`, not exit `75`. pi removes the error message before each retry, so the last `assistant` message is no error at the abort. `docs/cli/run.md` states this in "Classes".

9. **Overflow case of L3-U5.** The error text of the overflow test matches a pattern of `isRetryableAssistantError` and a pattern of `isContextOverflow`. The test thus fails when `providerFailureClass` omits the overflow predicate.

10. **`provider_retryable` unit test.** `run-agent-exit.test.ts` holds the test of `printPostResultDiagnostic` for a retryable failure ([L2 unit-level rule 10](L2-agent-cli.md#unit-level-rules)).

### PR 3 build

1. **`UsdTracker` class.** `src/agent/run-budget.ts` gains `UsdTracker`. It holds `limit: number | null` and `reached: BudgetLimit | null`. `check(listPriceUsd, onReached)` fires `onReached` once when `listPriceUsd >= limit`. The internal `reached` guard prevents a second fire (the first-limit rule). `budgetReached()` returns the limit kind or `null`.

2. **`RunContext.usdTracker`.** `agent-contract.ts` adds `usdTracker: UsdTracker` to `RunContext`. In the `message_end` subscriber, after `addMessageTotals`, it calls `usdTracker.check(totals.listPriceUsd, ...)`. The wall timer and the tracker call one function `reach(limit)`. `reach` ignores a second limit, sets `budgetReached` and aborts the session when a `send` runs.

3. **Limit and failure in `loopEnd`.** `reach` records `failedBeforeLimit`: the last `assistant` message is a provider error at the instant of the limit. `loopEnd` gives `failed` for a provider error when no limit fired or when `failedBeforeLimit` is `true`. Else a reached limit gives `budget_end` ([L3 Budget](L3-agent.md#budget)). Each `send` clears `failedBeforeLimit` at its start. During the wait of a pi retry, pi omits the error message from `session.messages`, so a limit in that wait gives `budget_end` (PR 2 build, item 8).

4. **`ParsedBudget.usd` field.** `run-agent-budget.ts` changes `usdText: string | null` to `usd: number | null`. `parseBudget` parses the amount with `Number(value.slice(0, -USD_SUFFIX_LEN))` and rejects zero. `run-agent-digest.ts` reads `parsed.usd` directly in `budgetDigestField`. `run-agent.ts` passes `usd: parsedBudget.usd` to `RunBudget` and to `checkBudgetUnpriced`.

5. **`checkBudgetUnpriced`.** `run-agent-budget.ts` owns `checkBudgetUnpriced(usd, cost)`, and `run-agent-budget.test.ts` holds its unit tests. `cost` has the type `Model<Api>["cost"]` of pi. `run-agent.ts` calls it at step 9, after `resolveModel`. The output file open stays at step 6 ([L2 Run order](L2-agent-cli.md#run-order)).

6. **`USD_SUFFIX_LEN` and `ZERO_USD` constants.** `USD_SUFFIX_LEN = 3` names the length of the suffix in `slice`. `ZERO_USD = 0` names the zero in each comparison of an amount or a price, as the `no-restricted-syntax` rule for a literal in a comparison requires.

7. **`BudgetResultFields` interface.** `budgetResultFields` returns a named interface instead of an inline object type (`kanthord/no-inline-object-type` scope). The return now includes `usd: parsed.usd`.

8. **`USD_PATTERN` decimal limit.** The pattern changes to `/^[0-9]+(\.[0-9]{1,6})?usd$/` to enforce at most 6 decimal places, as L2 unit-level rule 9 states.

9. **L2-AC15, S and O.** S does not exist after a refusal of step 9, because the agent never opens. O exists with no line, because step 6 opens O. This is the state of O after `start_refused` (PR 1 build, item 7).

10. **L3-U6 wall-during-retry test.** `agent-contract.test.ts` adds the test "wall budget ends during a pi retry wait and the end is budget_end with wall". The scripted provider returns a retryable error. The wall deadline fires before the pi retry wait ends. The abort from the wall timer reaches the session. The test asserts `end: budget_end`, `budget_reached: wall`.

11. **Test named constants.** `ONCE = 1` in `run-budget.test.ts`; `FIVE_USD = 5`, `QUARTER_USD = 0.25` in `run-agent-budget.test.ts`; `OPTION_BUDGET = "--budget"` in `e2e-run-agent-ends.test.ts` satisfy `no-restricted-syntax`.

12. **No call after a limit.** The `finishTurn` wrap of `agent-contract.ts` returns `{ action: "end" }` when `budgetReached` is not `null`. Reason: after an abort, the pi agent loop still starts the next model call with the aborted signal when the last message holds tool calls. That call adds an aborted `assistant` entry and one count to `model_calls`.

13. **Cost limit tests with a catalog price.** `scriptedProvider` of `src/agent/test-support.ts` takes a model definition with a `cost`. It then sets `usage.cost` of each response with `calculateCost` of pi. `makeInput` of `agent-contract.test.ts` gives the `cost` of the catalog model `anthropic/claude-sonnet-4-5` with `listPrice: true`. Three tests of `agent-contract.test.ts` use it or the wall timer: the `usd` limit ends the run with one model call; a provider error before the limit gives `failed`; a provider error after the limit gives `budget_end`.

14. **`--budget` option tests.** `parseBudget` of `run-agent-budget.ts` owns each `--budget` refusal of [L2 unit-level rule 1](L2-agent-cli.md#unit-level-rules). Their tests are in `run-agent-budget.test.ts`.

### PR 4 build

1. **`finishTurn` aborted-signal guard.** The `finishTurn` override of `agent-contract.ts` checks `inputSignal.aborted` and returns `{ action: "end" }`. Reason: without this guard, after a bash tool call ends under a signal abort, pi loops and starts the next LLM request with the already-aborted signal. That request fails with an AbortError, the last assistant message gets `stopReason = "error"`, and `loopEnd` returns `end: failed`. With the guard, pi exits the loop without a second request, and `loopEnd` returns `end: stopped`. PR 3 build item 12 gives the same pattern for `budgetReached`.

2. **`OpenRunOptions` interface.** `run-agent.ts` extracts `signal`, `promptText` and `onAgentOpened` into `OpenRunOptions`. This reduces `openAndRunAgent` from 4 params to 2 and satisfies the `max-params: 3` rule.

3. **`ResultContext` and `emitRunResult`.** `run-agent.ts` extracts the 11 result fields into `ResultContext` and the result emission into `emitRunResult(ctx, turnEnd)`. This reduces the complexity of `runAgent` from 13 to 10 and satisfies the `complexity: 10` rule.

4. **LLM stub `closedRequestCount`.** `e2e-llm-stub-test-support.ts` adds `closedRequestCount` to `LlmStub`. The stub registers a `close` listener on each response. When the connection closes before `res.writableEnded`, it increments the counter. L2-AC11 Variant 2 asserts that the stub recorded one closed connection, which proves the signal fired before the stub finished writing.

5. **`spawnCliAndSignal` test support.** `e2e-run-agent-test-support.ts` adds `spawnCliAndSignal(args, env, onReady, signal)`. It waits for `onReady` to report true, then sends the given signal to the CLI process. The 4-param signature is in a `*test-support.ts` file, which is excluded from the `max-params: 3` rule.

6. **L2-AC11 named constants.** `SIGTERM_SIGNAL`, `SIGINT_SIGNAL`, `NO_TOOL_CALLS`, `NO_REQUESTS`, `ASSISTANT_ROLE`, and `NO_STDERR_LINES` satisfy the `no-restricted-syntax` rule that prohibits string literals in comparisons and in `assert.equal` arguments. `ASSISTANT_ROLE` replaces the string literal `"assistant"` in five places across `e2e-run-agent-ends.test.ts`.

7. **`StopHandlers` interface.** `run-agent-signal.ts` exports `StopHandlers { release, setForceStop, forcedWithoutResult }`. `run-agent.ts` calls `setForceStop` after `openAgent` opens and uses `forcedWithoutResult` to skip result emission on a second signal. `setForceStop` holds the call of `forceStop()` of the open run.

8. **Step 11 ignores a signal.** `StopHandlers.ignoreSignals()` stops the time limit and makes each later signal a no-op. The handlers stay installed, so the default action of the signal does not end the process. `runAgent` calls it after `send` returns, before the removal of R and the result write ([L2 Shutdown](L2-agent-cli.md#shutdown), rule 4). `release()` removes the handlers as the last step of the cleanup, after the removal of R.

9. **Signals after a forced stop.** The forced stop keeps the handlers and ignores each later signal. Reason: a third signal with no handler ends the process before the removal of R ([Credentials](#credentials), rule 3).

10. **Handlers before R.** `runAgent` installs the handlers before it makes R. Reason: a signal between step 6 and step 9 then follows rule 5, with the removal of R.

11. **Signal after a completed open.** When the signal is aborted after `openAgent` returns, `openAndRunAgent` closes the opened run and exits `2`. It makes this check before the refusal check.

12. **Carry-over S7: closed.** Two process-level tests in `e2e-run-agent-ends.test.ts` prove rule 5. A `git` script first in `PATH` writes a marker and holds the first `git` command of the start preconditions for 3 seconds. The test sends the signal after the marker exists. Pass condition: exit `2`, empty stdout, no line in O, T holds no file, no request at Stub, no `open_failed` line and no `start_refused` line. `cli.run.agent.open_failed` itself has no process-level test: no command line of L2 makes `openAgent` throw with no signal. `run-agent-exit.test.ts` and `agent-contract.test.ts` cover it.

13. **Carry-over S9: the signal wins.** A changed workspace plus an aborted signal gives exit `2` and no `cli.run.agent.start_refused` line (rule 5). The second test of item 12 proves it with a changed tracked file in W. S holds no file.

14. **Carry-over S8: the order matches L2.** At step 11, `runAgent` removes R, then writes the result, then exits. L2-AC11 asserts the line in O and an empty T.

15. **`finishTurn` unit test.** `agent-contract.test.ts` aborts the signal while a `bash` child runs. Pass condition: the end `stopped`, no failure, one model call at the scripted provider and no live child. L2-AC11 variant 1 also asserts one request at Stub.

16. **Open after the review.** (a) `main.ts` sets `process.exitCode` and waits for the event loop. After a forced stop, a handle of a hung pi can keep the process alive after the result. (b) When a provider answers the abort of a signal with an error, `loopEnd` gives `failed`, because the failure check runs before the `stopped` check. Aelita rules on both. **Resolved by PR 4b.**

### PR 4b build

1. **S7: bounded exit after a forced stop.** `run-agent-signal.ts` exports `FORCED_EXIT_BOUND_MS = 1000` and adds `exitWithinBoundAfterForcedStop(exitCode)` to `StopHandlers`. After a forced stop, it calls `setTimeout(() => process.exit(exitCode), FORCED_EXIT_BOUND_MS).unref()`. With no forced stop, it does nothing, so a normal end makes no `process.exit` call. The timer does not keep the event loop alive. `runAgent` calls it as the last statement of its `finally` block, after the removal of R, the result write and the release of the handlers. `runAgent` passes the exit code of the run: `agentExitCode` of the turn end, or `2` when the run has no turn end. Reason: a forced stop can come during the close of the run, after the turn ended with an end other than `stopped`. L2 Shutdown rule 2 and unit-level rule 11 state the bound. Test file: `src/apps/cli/run-agent-signal.test.ts`. Two of its tests start a child process: one with an open handle exits with the given exit code, and one with no open handle exits at once with its own exit code.

   The bound has no process-level check of `run agent`, and no test covers the call in `runAgent`. Reason: no input at the outside edge makes a forced stop deterministic. The abort of a model request ends at once in the client. `childExit` of `bash-process.ts` ends a tool call and destroys its pipes 100 ms after the kill. Two signals in sequence race with step 11.

2. **S8: stop before a provider failure.** `agent-contract.ts` adds `failedBeforeStop`. The `addAbortListener` callback sets it from `failedInSend()` at the instant the input signal fires. The `loopEnd` condition adds `(!inputSignal.aborted || failedBeforeStop)`: a signal abort ends `failed` only when the failure came first; otherwise it ends `stopped`. `failedBeforeLimit` of the budget path uses the same `failedInSend()`. `failedBeforeStop` resets to `false` at the start of each `send`. L3 Budget "Stop and failure" states the rule. Test file: `src/agent/agent-contract.test.ts`.

3. **A failure of an earlier `send` does not count.** Each `send` records the last `assistant` message at its start. `failedInSend()` is true only when the last `assistant` message is a provider error and is not that recorded message. Reason: after a failed `send`, a limit or a stop in the next `send` read the old error and ended `failed`. Two `regression:` tests in `agent-contract.test.ts` cover the stop and the wall limit.

4. **No test for a failure before the stop in one `send`.** With a memory session, pi runs only microtasks between the error message and the return of `send`, so no signal lands in that window. The tests cover the stop before the failure, the stop between two `send` calls and the read `failedInSend()` through the limit path (`L3-U6 first limit`).

## Decisions

1. **LA3-D1.** LA3 requires the [Entry state](#entry-state) from LA1. Constraint: LA1 ships the wall half of `run-budget.ts`, the base of `run-outcome.ts` with the class `terminal` only, and the SIGINT-only stop of today; LA1 refuses a `usd` budget.
2. **LA3-D2.** LA3 has four pull requests in the order start preconditions, class, cost budget, signal handler. Constraint: the refusal before any request ships first; each pull request keeps `main` working.
3. **LA3-D3.** The five e2e checks of LA3 live in `src/apps/cli/e2e-run-agent-ends.test.ts`, and `pnpm run verify` runs them. Constraint: they need no network namespace and no test user.
4. **LA3-D4.** Each pull request changes the sections of `docs/cli/run.md` that its behavior owns. Constraint: the start preconditions text holds the differences from a `git status` of the developer ([L3 Start preconditions](L3-agent.md#start-preconditions)).
