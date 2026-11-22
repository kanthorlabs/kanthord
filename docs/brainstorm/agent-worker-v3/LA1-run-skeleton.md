# LA1. The run skeleton

Status: `draft`. Base: engine `c864130e`. Parent: [LA](LA-agent-build.md#sub-layers).

## Goal

LA1 ships `kanthord run agent` on the agent contract of [L3](L3-agent.md#input-and-output-contract). A human runs one profile on one workspace with one `--auth` entry. The run writes a `0600` session file at the caller path and reports one result. The session file holds no known secret in an input entry. LLM output stays unchanged, and the result text holds the redaction marker in the place of a known secret. LA1 ends when the ten end-to-end checks of [LA1 checks](#end-to-end-checks) pass in `pnpm run verify`.

### Entry state

- The engine is `c864130e`. The only local agent run is `kanthord worker tasks run`. It reads the credential from standard input (`credentialOf` in `src/worker/unit/tasks-credential.ts`) and keeps an in-memory session.
- `run` is no root name. `TOP_LEVEL_NAMES` of `src/apps/cli/completeness.test.ts:109` does not hold it.
- `src/agent/hooks/sensitive-text-redaction.ts` redacts LLM output and LLM input in one module.
- `AGENT_DECLARATIONS` (`src/agent/catalog.ts:88`) holds `swe@1`, `re@1` and `env@1`. The agent runtime imports `src/worker/contract.ts`.

### Exit state

- A human runs `kanthord run agent <profile> --model <provider>/<model>:<level> --workspace <dir> --session <path> --prompt <text-or-path>`, with an optional `--auth`, `--system-prompt`, `--budget` and `--output`.
- The run applies the `--auth` file checks and entry checks of [L2](L2-agent-cli.md#the---auth-file), the session path checks, the pi directory checks, the output file checks, the run directory R, the ambient removal of today and the child environment of L2.
- The agent contract applies the guard order, the redaction of L3 and the wall budget. It checks no start precondition.
- `--budget` takes the wall form only, with the default `2h`. A `usd` value is refused with `cli.run.agent.option_invalid`, `option: --budget`.
- Each end that is no completion has the class `terminal`. `run agent` exits `0`, `2`, `4` or `5`, as `TasksExit` of today does (`src/worker/unit/tasks-run.ts:105-111`).
- One SIGINT during the turn aborts the session with no time limit, as `stopOnSignal` of today does (`src/apps/cli/worker-tasks.ts:287-292`). The run writes the result with the end `stopped`, removes R and exits `2`.
- `worker tasks run` still works. [LA4](LA-agent-build.md#sub-layers) deletes it.
- These parts come later: the Linux test job, the removal of the proxy names, the refusal of a Node proxy setting ([LA2](LA-agent-build.md#sub-layers)); the start preconditions, the class `retryable` with exit `75`, the cost budget, SIGTERM, the time limit of the shutdown, the forced stop and the second signal ([LA3](LA3-run-ends.md#entry-state)).

## Scope

(LA steps 1, 2, 3, 4, 5, 6, 8, the base of 7 and the core of 10)

### Files

| Kind             | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added            | `src/llm/provider-failure.ts` gains `ProviderFailure`; `src/llm/known-secrets.ts`; `src/agent/redaction.ts`; `src/agent/hooks/marker-restore.ts`, `input-redaction.ts`, `output-finding.ts`, `assistant-redaction.ts`; `src/agent/declarations.ts`; `src/agent/prompt-chain.ts`; `src/agent/run-budget.ts` with the wall limit only; `src/agent/run-outcome.ts` with the class `terminal` only; `src/agent/agent-contract.ts`; the modules of [Module files](LA-agent-build.md#module-files-of-the-l2-rules) less `run-agent-start.ts`, and `src/apps/cli/run-agent.ts`; `static/prompt/coding.md`, `static/prompt/role/swe@1.md`, `static/prompt/role/re@1.md`; `engine/docs/cli/run.md`; a test file next to each module |
| Added, test only | `src/apps/cli/e2e-llm-stub-test-support.ts`; `src/apps/cli/e2e-run-agent-test-support.ts`; `src/apps/cli/e2e-run-agent.test.ts`; `src/apps/cli/e2e-run-agent-contract.test.ts`; the rule test of `kanthord/no-inline-object-type`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Changed          | `eslint.config.js`; `package.json` (the gate check of L1 U8); `src/agent/agent-session.ts`; `src/agent/catalog.ts`; `src/agent/prompt-assets.ts`; `src/agent/prompt-render.ts`; `src/agent/tool-table.ts`; `src/agent/pinned-layers.ts`; `src/agent/pi-tools.ts`; `src/worker/contract.ts`; `src/workbench/service.ts`; `src/apps/cli/index.ts`; `src/apps/cli/completeness.test.ts`; `engine/docs/cli/other.md`; `engine/docs/cli/README.md`; `engine/docs/cli/project.md`; each importer of a moved declaration                                                                                                                                                                                                          |
| Moved            | `ProviderFailure` from `src/scheduler/contract.ts:67-73`; `credentialSecrets` and `mergedSecrets` from `src/agent/hooks/sensitive-text-redaction.ts`; `src/agent/agent-port.ts`, `session-directory.ts`, `review-roots.ts` and `capabilities/*.ts` to `src/worker/unit/`; `HOST_TOOL_PARAMETERS`, `EVIDENCE_UPLOAD_PARAMETERS`, `LINK_UPDATE_LIST_PARAMETERS` to `src/worker/contract.ts`; `src/worker/unit/pinned-layers.test.ts` to `src/agent/pinned-layers.test.ts`                                                                                                                                                                                                                                                    |
| Deleted          | `src/agent/hooks/sensitive-text-redaction.ts` and its test, after the split                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

LA1 copies `withoutAmbientCredentials`, `credentialValues`, `SHELL_NAMES`, `shellOf`, `FIXED_GIT_ENV`, `PI_AUTH_FILE` and `DURATION_PATTERN` into the modules of `run agent`. The files of `tasks run` keep their copies until LA4 deletes them ([LA1-D4](#decisions)).

### Lint scope

The rule `kanthord/no-inline-object-type` of [L3-D39](L3-agent.md#decisions) covers each added file and each file where a pull request adds or edits a declaration. Counts at `c864130e` are union members, property object types and string literal property types. Aelita counted them with the four selectors of L3-D39 over `src/`, test files excluded.

| File                         | Sites    | Reason                                            |
| ---------------------------- | -------- | ------------------------------------------------- |
| Each added file              | 0        | New code                                          |
| `src/worker/contract.ts`     | 20, 5, 8 | Receives `HOST_TOOL_PARAMETERS` and two schemas   |
| `src/agent/agent-session.ts` | 2, 0, 0  | `SessionRedactionInput` gets named members        |
| `src/agent/prompt-render.ts` | 2, 1, 0  | `finalPrompt` calls `composeSystemPrompt`         |
| `src/workbench/service.ts`   | 0, 2, 0  | The call of `finalPrompt` and the catalog reads   |
| `src/agent/catalog.ts`       | 0, 0, 0  | The profiles and `AgentTools`                     |
| `src/agent/tool-table.ts`    | 0, 0, 0  | [L3 Child processes](L3-agent.md#child-processes) |
| `src/agent/pinned-layers.ts` | 0, 0, 0  | `setWork(work: WorkPin \| null)`                  |
| `src/agent/pi-tools.ts`      | 0, 0, 0  | Receives `WorkerErrorCode.StartToolMissing`       |
| `src/agent/prompt-assets.ts` | 0, 0, 0  | The Role files                                    |
| `src/apps/cli/index.ts`      | 0, 0, 0  | `CommandName.Run` and the group `run`             |

Total sites that LA1 fixes: 24 union members, 8 property object types and 8 string literal property types. A file that only loses a declaration or only changes an import path stays out.

## Pull requests

Each pull request is one engine pull request and one root pull request that moves the submodule pointer ([LA How each step ships](LA-agent-build.md#how-each-step-ships)). Each one passes `pnpm run verify` in `engine`. The verify command of each row is `pnpm run verify`, plus the named test files with `pnpm --silent run test:files <file>` for a fast check.

1. **PR1. The lint rule** (LA step 1).
   - Files: `eslint.config.js` with the rule, its four selectors and an empty file list; the rule test.
   - Rules: the rule test.
   - `main` works: the rule applies to no file.
2. **PR2. The LLM moves** (LA step 2).
   - Files: `ProviderFailure` to `src/llm/provider-failure.ts`; `credentialSecrets` and `mergedSecrets` to `src/llm/known-secrets.ts`; each importer.
   - Rules: the moved tests of today.
   - `main` works: each importer reads the new place, and no behavior changes.
3. **PR3. The worker-layer moves and the import check** (LA step 3).
   - Files: the moves to `src/worker/unit/` and `src/worker/contract.ts`; `WorkerErrorCode.StartToolMissing` to `src/agent/pi-tools.ts` with the value `worker.start.tool_missing`; the lint glob `src/agent/capabilities/**/*.ts` (`eslint.config.js:1007`) to `src/worker/unit/capabilities/**/*.ts`; the import list of `worker-unit` and `apps-worker` (`eslint.config.js:518-548`); the import check of [L3 Import rule](L3-agent.md#import-rule).
   - Rules: [L1 U11, U15](L1-model.md#unit-level-rules).
   - `main` works: the worker reads each moved file at its new place.
4. **PR4. The redaction split** (LA step 4).
   - Files: `src/agent/redaction.ts` and the four hook modules of [L3 Extension modules](L3-agent.md#extension-modules); the known-secret block of a tool input ([L3-D11](L3-agent.md#decisions)); `assistantRedaction` on `openSession` and `openSessionRuntime`; the rotate warning; `sessionParts` of `src/agent/agent-session.ts` with the named members of `SessionRedactionInput`; the gate check of L1 U8 in `pnpm run verify`.
   - Rules: [L1 U2, U8, U10](L1-model.md#unit-level-rules); [L3-U8, L3-U10, L3-U12, L3-U13](L3-agent.md#unit-level-rules).
   - `main` works: both open paths of today keep the three redactions of LLM output of today (L3-U12, L3-U13).
5. **PR5. The catalog split and the prompt files** (LA step 5).
   - Files: `src/agent/catalog.ts` with the profiles and `AgentTools`; `src/agent/declarations.ts`; `src/agent/prompt-assets.ts`; `static/prompt/coding.md`, `static/prompt/role/swe@1.md`, `static/prompt/role/re@1.md`.
   - Rules: [L3-U2, L3-U3](L3-agent.md#unit-level-rules).
   - `main` works: the worker path keeps `static/prompt/swe@1.md` and `re@1.md` until LB.
6. **PR6. The prompt chain** (LA step 6).
   - Files: `src/agent/prompt-chain.ts` with `composeSystemPrompt`, `profilePrompt` and `systemPromptDigest`; `finalPrompt` of `src/agent/prompt-render.ts` calls `composeSystemPrompt`; `systemPrompt` leaves; the call in `src/workbench/service.ts:375`.
   - Rules: [L3-U1](L3-agent.md#unit-level-rules).
   - `main` works: L3-U1 proves the byte-equal composed text of each consumer of today.
7. **PR7. The wall budget and the base outcome** (the base of LA step 7, [LA3 Entry state](LA3-run-ends.md#entry-state) items 2 and 4).
   - Files: `src/agent/run-budget.ts` with the wall limit only: a timer at `deadline` aborts the session, and the end is `budget_end` with `budgetReached` `wall`; `endAfterTurn`. `src/agent/run-outcome.ts` with the ends `completed`, `budget_end`, `stopped` and `failed`, the totals, the failure kind of `providerFailureOf` and the class `terminal` for each end that is no completion.
   - Rules: the wall, first-limit and `endAfterTurn` cases of [L3-U6](L3-agent.md#unit-level-rules); the end, failure kind, `internal` and totals cases of [L3-U5](L3-agent.md#unit-level-rules). LA3 adds the `usd` cases and the class cases.
   - `main` works: no consumer calls the new modules.
8. **PR8. The agent contract** (LA step 8).
   - Files: `src/agent/tool-table.ts`; `setWork(work: WorkPin | null)` in `src/agent/pinned-layers.ts`; the move of `pinned-layers.test.ts` onto Faux; `src/agent/agent-contract.ts` with `openAgent`, which takes `RunBudget { deadline, usd }` and checks no start precondition. Close the two HANDOFF items of [L3 To HANDOFF.md](L3-agent.md#to-handoffmd).
   - Rules: [L1 U3, U6](L1-model.md#unit-level-rules); [L3-U7, L3-U9, L3-U11](L3-agent.md#unit-level-rules).
   - `main` works: no shipped command calls `openAgent`.
9. **PR9. The input modules of `run agent`** (core of LA step 10).
   - Files: `run-agent-options.ts`, `run-agent-input.ts`, `run-agent-auth.ts`, `run-agent-model.ts`, `run-agent-session.ts`, `run-agent-output.ts`, `run-agent-pi.ts`, `run-agent-budget.ts` and `run-agent-digest.ts` in `src/apps/cli/`, each with its test file. `run-agent-auth.ts` holds the file checks, the entry checks 1 to 6 and the [routing metadata mapping](L2-agent-cli.md#routing-metadata-mapping). `run-agent-pi.ts` holds rules 1 to 5 of [The pi directory](L2-agent-cli.md#the-pi-directory), with the `auth.json` check before the pi tool install.
   - `run-agent-budget.ts` parses the wall form with `DURATION_PATTERN`, gives the default `2h`, and refuses each `usd` value with `cli.run.agent.option_invalid`, `option: --budget`.
   - Rules: L2 unit-level rules 1 to 7 and 12 ([L2](L2-agent-cli.md#unit-level-rules)) less the `env_proxy` part of rule 1 and the cost cases of rule 1; the wall and default cases of rule 9; [L1 U1, U4, U5](L1-model.md#unit-level-rules).
   - `main` works: no command calls the modules.
10. **PR10. `kanthord run agent`** (core of LA step 10).
    - Files:
      - `src/apps/cli/run-agent.ts`: steps 2 to 11 of the [run order](L2-agent-cli.md#run-order), and the `--token` refusal of step 1;
      - the run directory R with rules 1, 2, 4, 5, 6 and 7 of [The run directory](L2-agent-cli.md#the-run-directory);
      - the exits `0`, `2`, `4` and `5`, and the diagnostics `cli.run.agent.provider_failed` and `cli.run.agent.internal_error` after the result;
      - `src/apps/cli/run-agent-signal.ts` with the behavior of `stopOnSignal` of today: one SIGINT aborts the session through `input.signal`, with no time limit;
      - `CommandName.Run` and the group `run` in `createProgram` of `src/apps/cli/index.ts`; `run` in `TOP_LEVEL_NAMES`, `PAGE_INVENTORIES` and `PAGE_COUNTS`; `DOCUMENTED_COUNT` 239 and `IMPLEMENTED_COUNT` 234 in `src/apps/cli/completeness.test.ts`;
      - `engine/docs/cli/run.md` with each rule that LA1 ships; the root names, the root help list and the exits `2`, `4`, `5` and `75` in `docs/cli/other.md`; the link list of `docs/cli/README.md`; the root name count in `docs/cli/other.md:1155`, `docs/cli/README.md:71` and `docs/cli/project.md:36`;
      - the test support and the two end-to-end test files.
    - Rules: the terminal cases and the `open_failed` case of L2 unit-level rule 10; [L1 U9](L1-model.md#unit-level-rules); the ten checks of [End-to-end checks](#end-to-end-checks).
    - `main` works: `run agent` is a new command, and `worker tasks run` keeps its behavior.

## End-to-end checks

(LA1 ends when these pass)

### Harness

- **Process.** Each check starts the CLI as a child process: `process.execPath` with the CLI entry `src/main.ts` and the arguments of the check, as `spawnTasksRun` does today (`src/apps/cli/worker-tasks.test.ts:192`). The child gets only the environment that the check names, plus `PATH` of the test process for the pi tools. The process uses the real file system, real git and the real pi runtime.
- **Stub.** `src/apps/cli/e2e-llm-stub-test-support.ts` holds the LLM stub of the [L2 fixtures](L2-agent-cli.md#l2-fixtures). It is an `node:http` server on `127.0.0.1` with a free port. It serves `POST /v1/responses` with server-sent events, in the event shape of `compatibleServer` (`src/llm/model-check.test.ts:248`). It takes a list of scripted turns: a text, tool calls, usage, an HTTP status with a body, or a delay. It records each request with its headers and body, and each connection. It is the only stub. [LA3](LA3-run-ends.md#scope) adds a delayed answer, a fixed HTTP status with a body, and the record of a closed connection.
- **Fixtures.** `src/apps/cli/e2e-run-agent-test-support.ts` builds Auth, W, H, X, T, D, S and O of the [L1 shared fixtures](L1-model.md#shared-fixtures) and the [L2 fixtures](L2-agent-cli.md#l2-fixtures) in a new temporary directory per check. K is a string of 40 ASCII letters. W is a new git repository with one commit. The harness expands `$TEST` in each scripted text.
- **Run.** `src/apps/cli/e2e-run-agent-test-support.ts` starts the command line of the L2 fixture Run, with the changes of each check, and returns the exit code, stdout, stderr and the stub record.
- **Place.** The checks run in `pnpm run verify` on macOS and on the Linux job of the engine CI. They need no network namespace and no test user ([LA1-D3](#decisions)). Each test has a timeout of 120 seconds.

### Checks

Each check keeps the fixture, the command and the pass condition of its source text. The pass condition is the full assertion list of the source.

| Check                                                                                   | Test file                                     | Stub turns                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| [L2-AC1](L2-agent-cli.md#checks): a run does its work, records it and reports it        | `src/apps/cli/e2e-run-agent.test.ts`          | `write`, `bash`, text `done-1`, each usage 10 and 2 |
| [L2-AC3](L2-agent-cli.md#checks): a refused session path starts nothing                 | `src/apps/cli/e2e-run-agent.test.ts`          | none; the request log stays empty                   |
| [L2-AC4](L2-agent-cli.md#checks): LLM output unchanged, result redacted, rotate warning | `src/apps/cli/e2e-run-agent.test.ts`          | one text that holds K                               |
| [L2-AC8](L2-agent-cli.md#checks): one input under two profiles                          | `src/apps/cli/e2e-run-agent.test.ts`          | text `ok` per run                                   |
| [L2-AC9](L2-agent-cli.md#checks): a prompt value is text or a file                      | `src/apps/cli/e2e-run-agent.test.ts`          | text `ok`                                           |
| [L2-AC13](L2-agent-cli.md#checks): the model selection reaches the request              | `src/apps/cli/e2e-run-agent.test.ts`          | text `ok`                                           |
| [L3-AC1](L3-agent.md#acceptance-checks): no input entry holds a known secret            | `src/apps/cli/e2e-run-agent-contract.test.ts` | run 1: `read`, text `done`; run 2: HTTP 400 with K  |
| [L3-AC2](L3-agent.md#acceptance-checks): each profile composes the prompt chain         | `src/apps/cli/e2e-run-agent-contract.test.ts` | text `ok` per profile                               |
| [L3-AC3](L3-agent.md#acceptance-checks): the full tool set, and an absent declared tool | `src/apps/cli/e2e-run-agent-contract.test.ts` | one scripted call per profile, text `done`          |
| [L3-AC4](L3-agent.md#acceptance-checks): a known secret in a tool input blocks the call | `src/apps/cli/e2e-run-agent-contract.test.ts` | one message with `bash` and `write`, text `done`    |

Build details that the source texts leave open:

1. **L2-AC1, variant 2.** The test compares stdout with the [text layout](L2-agent-cli.md#--output-stdout) line by line. The `duration` row matches `^  duration   \d+\.\d s$`. Each other row is exact.
2. **L2-AC8.** The stub serves the three runs in order. The test reads `input_digest` and `system_prompt_digest` from the three lines of O.
3. **L2-AC9.** The child process starts with the current directory C1.
4. **L3-AC1, run 2.** The stub answers each request with HTTP 400, so pi makes no retry: `isRetryableAssistantError` accepts no status 400 text. The test asserts exit `5` and one request.
5. **L3-AC2.** The test reads each expected file from `static/prompt/` of the engine at test time, so a prompt change needs no test change.
6. **"T holds no file".** The test lists T with `readdir` after the exit and expects an empty list.

## Unit-level rules

Each rule has its test file next to the owning module.

| Rule                                                              | Owning module                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| L1 U1: session path refusals                                      | `src/apps/cli/run-agent-session.ts`                                         |
| L1 U2: input redaction of `custom` and steering messages          | `src/agent/hooks/input-redaction.ts`                                        |
| L1 U3: no K in a text of the contract                             | `src/agent/agent-contract.ts`                                               |
| L1 U4: the `--auth` refusals                                      | `src/apps/cli/run-agent-auth.ts`                                            |
| L1 U5: `--token` first                                            | `src/apps/cli/run-agent-options.ts`                                         |
| L1 U6: the allowlist block                                        | `src/agent/hooks/tool-allowlist.ts`                                         |
| L1 U8: a hook module with no test fails the gate                  | `package.json`, script of the gate check                                    |
| L1 U9: `run` in the root set and the help                         | `src/apps/cli/completeness.test.ts`, `src/apps/cli/index.ts`                |
| L1 U10: one finding and one warning per message                   | `src/agent/hooks/output-finding.ts`                                         |
| L1 U11: the lint glob of capabilities                             | `eslint.config.js`                                                          |
| L1 U15: the import closure of the runtime                         | the import check of PR3                                                     |
| L3-U1 to L3-U3, L3-U7 to L3-U13; the LA1 cases of L3-U5 and L3-U6 | the modules that [L3 Unit-level rules](L3-agent.md#unit-level-rules) names  |
| L2 rules 1 to 7 and 12; the LA1 cases of rules 9 and 10           | the files of [Module files](LA-agent-build.md#module-files-of-the-l2-rules) |

L2 rule 8, the `env_proxy` part of rule 1 and L1 U14 belong to LA2. L3-U4, the `usd` and class cases of L3-U5, L3-U6, L2 rules 9 and 10, and L2 rule 11 belong to LA3. PR10 tests the SIGINT stop of today in `src/apps/cli/run-agent-signal.test.ts`.

## Credential statement

Each row names a credential rule that LA1 touches. "Today" is `worker tasks run` at `c864130e`. No row is weaker than today, except the two rows that Ulrich ruled.

| Rule                               | Today                                                                                                         | After LA1                                                                                                                                                     | Strength                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Credential input                   | Standard input with the `isatty(0)` check and a zeroed buffer (`stdinOf`, `src/apps/cli/worker-tasks.ts:121`) | The `--auth` file only, with the file checks and entry checks of L2. `run agent` reads no standard input                                                      | Ruled (Q8, L1-D22)                  |
| Provider, metadata schema, expiry  | `credentialOf` and `routingMetadataOf` (`src/worker/unit/tasks-credential.ts`)                                | The entry checks 1 to 6 of L2: schema, `!`, `$`, secret shape, metadata schema, expiry                                                                        | Ruled (Q8); stricter on the shape   |
| Frozen store                       | `frozenStore` (`src/llm/refresh-watch.ts`)                                                                    | The same store                                                                                                                                                | Same                                |
| Known secrets                      | `credentialValues` joins the key, or `access` and `refresh`                                                   | The same values join the known secrets of the session                                                                                                         | Same                                |
| Ambient removal                    | `withoutAmbientCredentials` with `AMBIENT_CREDENTIAL_NAMES` (`src/worker/unit/tasks-seed.ts:393`)             | The same function body on the process environment, with `HOME` set to `R/home`                                                                                | Same; LA2 makes it stricter         |
| Proxy names and Node proxy setting | Kept; no refusal                                                                                              | Kept; no refusal                                                                                                                                              | Same; LA2 makes it stricter         |
| Child environment                  | `PATH`, `LANG`, `TMPDIR` of the shell, `FIXED_GIT_ENV`, passed variables                                      | `PATH`, `LANG`, `TMPDIR=R/tmp`, `HOME=R/home`, `FIXED_GIT_ENV`; no passed variable                                                                            | Stricter                            |
| pi directory credential file       | `bindPiDirectory` checks `auth.json` after the tool install (`src/worker/unit/tasks-run.ts:693`)              | The check comes before the install, with the owner and link checks of L2                                                                                      | Stricter                            |
| Session record                     | In-memory session; `turns.jsonl` with the writer redaction                                                    | A `0600` session file at a checked caller path; no input entry holds a known secret; a tool input with a known secret is blocked                              | Replaced (R2-A); stricter on inputs |
| LLM output                         | Redacted with rule 0                                                                                          | Unchanged in the record; a finding gives the rotate warning; the result and each `reason` pass the exit redaction. The open paths of today keep the redaction | Ruled (R2-H)                        |
| Allowlist and confinement          | Only in sessions that `agentPort` opens                                                                       | In each `openAgent` session, by profile                                                                                                                       | Stricter                            |
| KanthorD credential                | `tasks run` declares no `--token`                                                                             | `run agent` refuses `--token` before each other check                                                                                                         | Same                                |
| Stop on a signal                   | `stopOnSignal` handles SIGINT (`src/apps/cli/worker-tasks.ts:287-292`)                                        | One SIGINT aborts the session; the run removes R and writes the result                                                                                        | Same; LA3 makes it stricter         |
| Run bound                          | The wall time of the seed (`wallDeadlineOfPlan`)                                                              | The wall budget, default `2h`; a `usd` value is refused                                                                                                       | Same                                |

Proof: each row of "Stricter" or "Same" has a unit rule of [Unit-level rules](#unit-level-rules) or a check of [End-to-end checks](#end-to-end-checks). The end-to-end proof of the credential boundary is LA2.

## Handoffs

### To LA2

- The Linux job `test:agent-e2e` with the network namespace N and the test user ([LA step 9](LA-agent-build.md#step-9-the-linux-test-job)).
- The removal of the proxy names (rule 3 of [The run directory](L2-agent-cli.md#the-run-directory)), the refusal `cli.run.agent.env_proxy` and L2 unit-level rule 8; L1 U14.
- The checks L2-AC2, AC5, AC6, AC7 and AC14 against the modules that LA1 ships: `run-agent-auth.ts`, `run-agent-pi.ts`, R and the confinement guard of `openAgent`.

### To LA3

- The [Entry state of LA3](LA3-run-ends.md#entry-state) is the exit state of LA1.
- The start preconditions (`src/agent/start-preconditions.ts`, called from `run-agent.ts` at run-order step 9, L3-U4); the class `retryable` and exit `75`; the cost budget; SIGTERM and [Shutdown](L2-agent-cli.md#shutdown) rules 1 to 5.
- The checks L2-AC10, AC11, AC12 and L3-AC5, with the stub of `src/apps/cli/e2e-llm-stub-test-support.ts`.

### Items that the split puts in the wrong sub-layer

The LA1 checks cannot run without these items, so LA1 builds them. The [sub-layer table](LA-agent-build.md#sub-layers) needs the same change.

- The `--auth` reader. The split puts it in LA2. Each LA1 check runs with `--auth` (the L2 fixture Run), and L1-D22 removes standard input.
- The run directory R, the child `TMPDIR` and the pi directory checks. The split puts them in LA2. L2-AC1 asserts that T holds no file, and the pi tool install of each run needs the pi directory.
- The base of LA step 7. The split puts step 7 in LA3. `openAgent` of step 8 takes `RunBudget`, L2-AC1 asserts the field `budget`, L2-AC8 passes `--budget 10m`, and L3-AC1 asserts the end `failed` with exit `5`. [LA3-D1](LA3-run-ends.md#decisions) states the same base.

## Decisions

1. **LA1-D1.** LA1 builds the `--auth` reader, R, the pi directory checks, the wall half of `run-budget.ts`, the base of `run-outcome.ts` and the SIGINT stop of today. Constraint: LA1 checks no start precondition and refuses a `usd` budget; LA2 adds the Linux job, the proxy rules and the credential checks; LA3 extends the budget, the outcome and the signal handler.
2. **LA1-D2.** LA1 has ten pull requests. PR9 holds the input modules with no caller, and PR10 wires the command. Constraint: the end-to-end checks land in PR10; PR1 to PR9 pass with unit tests only.
3. **LA1-D3.** The LA1 checks run in `pnpm run verify`, on macOS and on the Linux job of the engine CI. Constraint: no LA1 check needs a network namespace, a test user or a container.
4. **LA1-D4.** `run agent` holds its own copy of each check that it takes over from `tasks run`. Constraint: LA1 changes no file of `tasks run`; LA4 deletes the old copies.
5. **LA1-D5.** The test process starts the CLI entry `src/main.ts`, as the `tasks run` tests do. Constraint: the gate step 4.1 of LA runs the packed `bin/kanthord.mjs`.
6. **LA1-D6.** The e2e support has two files: the LLM stub `src/apps/cli/e2e-llm-stub-test-support.ts` and the harness `src/apps/cli/e2e-run-agent-test-support.ts`. The test files are `src/apps/cli/e2e-run-agent.test.ts` and `src/apps/cli/e2e-run-agent-contract.test.ts`. Constraint: LA2, LA3 and LA5 use the same stub and harness; the build excludes `*test-support.ts` from `dist` (`tsconfig.build.json`).
