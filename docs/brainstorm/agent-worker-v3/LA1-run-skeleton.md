# LA1. The run skeleton

Status: `draft`. Base: engine `c864130e`. Parent: [LA](LA-agent-build.md#sub-layers).

## Goal

LA1 ships `kanthord run agent` on the agent contract of [L3](L3-agent.md#input-and-output-contract). A human runs one profile on one workspace with one `--auth` entry. The run writes a `0600` session file at the caller path and reports one result. The session file holds no known secret in an input entry. LLM output stays unchanged, and the result text holds the redaction marker in the place of a known secret. LA1 ends when the fourteen end-to-end checks of [LA1 checks](#end-to-end-checks) pass in `pnpm run verify`.

### Entry state

- The engine is `c864130e`. The only local agent run is `kanthord worker tasks run`. It reads the credential from standard input (`credentialOf` in `src/worker/unit/tasks-credential.ts`) and keeps an in-memory session.
- `run` is no root name. `TOP_LEVEL_NAMES` of `src/apps/cli/completeness.test.ts:109` does not hold it.
- `src/agent/hooks/sensitive-text-redaction.ts` redacts LLM output and LLM input in one module.
- `AGENT_DECLARATIONS` (`src/agent/catalog.ts:88`) holds `swe@1`, `re@1` and `env@1`. The agent runtime imports `src/worker/contract.ts`.

### Exit state

- A human runs `kanthord run agent <profile> --model <provider>/<model>:<level> --workspace <dir> --session <path> --prompt <text-or-path>`, with an optional `--auth`, `--system-prompt`, `--budget` and `--output`.
- The run applies the `--auth` file checks and entry checks of [L2](L2-agent-cli.md#the---auth-file), the session path checks, the pi directory checks, the output file checks, the run directory R, the ambient removal with the eight proxy names, the refusal `cli.run.agent.env_proxy` and the child environment of L2.
- The agent contract applies the guard order, the redaction of L3 and the wall budget. It checks no start precondition.
- `--budget` takes the wall form only, with the default `2h`. A `usd` value is refused with `cli.run.agent.option_invalid`, `option: --budget`.
- Each end that is no completion has the class `terminal`. `run agent` exits `0`, `2`, `4` or `5`, as `TasksExit` of today does (`src/worker/unit/tasks-run.ts:105-111`).
- One SIGINT during the turn aborts the session with no time limit, as `stopOnSignal` of today does (`src/apps/cli/worker-tasks.ts:287-292`). The run writes the result with the end `stopped`, removes R and exits `2`.
- `worker tasks run` still works. [LA4](LA-agent-build.md#sub-layers) deletes it.
- These parts come later: the Linux test job with L2-AC2 and L2-AC6 ([LA2](LA2-credential-boundary.md)); the start preconditions, the class `retryable` with exit `75`, the cost budget, SIGTERM, the time limit of the shutdown, the forced stop and the second signal ([LA3](LA3-run-ends.md#entry-state)).

### Exit gate

LA1 ends when both steps pass:

1. The checks of [End-to-end checks](#end-to-end-checks) pass in `pnpm run verify` and in the CI job `check`.
2. Gate step 4.2, [the real-credential run](LA-agent-build.md#gate-step-42-the-real-credential-run), passes on the build of PR11. Ulrich gives the entry. The final agent gate runs step 4.2 again on the build of LA5.

## Scope

### Files

| Kind             | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added            | `src/agent/known-secrets.ts`; `src/agent/redaction.ts`; `src/agent/hooks/marker-restore.ts`, `input-redaction.ts`, `output-finding.ts`, `assistant-redaction.ts`; `src/agent/declarations.ts`; `src/agent/prompt-chain.ts`; `src/agent/run-budget.ts` with the wall limit only; `src/agent/run-outcome.ts` with the class `terminal` only; `src/agent/agent-contract.ts`; the modules of [Module files](LA-agent-build.md#module-files-of-the-l2-rules), `src/apps/cli/run-agent-environment.ts` and `src/apps/cli/run-agent.ts`; `static/prompt/coding.md`, `static/prompt/role/swe@1.md`, `static/prompt/role/re@1.md`; `engine/docs/cli/run.md`; a test file next to each module |
| Added, test only | `src/agent/hooks/home-relative-cwd.test.ts`, `pinned-layers.test.ts`, `tool-approval.test.ts`, `tool-allowlist.test.ts`; `src/apps/cli/e2e-llm-stub-test-support.ts`; `src/apps/cli/e2e-run-agent-test-support.ts`; `src/apps/cli/e2e-run-agent.test.ts`; `src/apps/cli/e2e-run-agent-contract.test.ts`; `src/apps/cli/e2e-run-agent-boundary.test.ts`; the rule test of `kanthord/no-inline-object-type`                                                                                                                                                                                                                                                                           |
| Changed          | `eslint.config.js`; `package.json` (the gate check of L1 U8); `src/agent/agent-session.ts`; `src/agent/catalog.ts`; `src/agent/prompt-assets.ts`; `src/agent/prompt-render.ts`; `src/agent/tool-table.ts`; `src/agent/pinned-layers.ts`; `src/agent/pi-tools.ts`; `src/worker/contract.ts`; `src/workbench/service.ts`; `src/apps/cli/index.ts`; `src/apps/cli/completeness.test.ts`; `engine/docs/cli/other.md`; `engine/docs/cli/README.md`; `engine/docs/cli/project.md`; each importer of a moved declaration                                                                                                                                                                   |
| Moved            | `credentialSecrets` and `mergedSecrets` from `src/agent/hooks/sensitive-text-redaction.ts` to `src/agent/known-secrets.ts`; `src/agent/agent-port.ts`, `session-directory.ts`, `review-roots.ts` and `capabilities/*.ts` to `src/worker/unit/`; `HOST_TOOL_PARAMETERS`, `EVIDENCE_UPLOAD_PARAMETERS`, `LINK_UPDATE_LIST_PARAMETERS` to `src/worker/contract.ts`; `src/worker/unit/pinned-layers.test.ts` to `src/agent/pinned-layers.test.ts`                                                                                                                                                                                                                                       |
| Deleted          | `src/agent/hooks/sensitive-text-redaction.ts` and its test, after the split                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

LA1 copies `credentialValues`, `SHELL_NAMES`, `shellOf`, `FIXED_GIT_ENV`, `PI_AUTH_FILE` and `DURATION_PATTERN` into the modules of `run agent`. The body of `withoutAmbientCredentials` goes to `src/apps/cli/run-agent-environment.ts`, with the eight proxy names added. The files of `tasks run` keep their copies until LA4 deletes them ([LA1-D4](#decisions)).

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

Each pull request is one engine pull request into `feature/agent-v2` ([LA How each pull request ships](LA-agent-build.md#how-each-pull-request-ships)). Each one passes `pnpm run verify` in `engine`. The verify command of each row is `pnpm run verify`, plus the named test files with `pnpm --silent run test:files <file>` for a fast check.

1. **PR1. The lint rule**. Ships with PR2.
   - Files: `eslint.config.js` with the rule, its four selectors, the file list `["src/agent/known-secrets.ts"]` and the test-file ignores of `kanthord/no-inline-param-type`; the rule test `scripts/no-inline-object-type.test.mjs`, in the script lists of `package.json` and in the test step of `.github/workflows/ci.yml`.
   - Rules: the rule test.
   - `main` works: the rule applies to `src/agent/known-secrets.ts` only.
2. **PR2. The LLM moves**. Ships with PR1.
   - Files: `credentialSecrets` and `mergedSecrets` to `src/agent/known-secrets.ts`; each importer. The agent import list of `worker-unit` and `apps-worker` in `eslint.config.js` gets the entry `known-secrets`. `ProviderFailure` stays in `src/scheduler/contract.ts` ([LA1-D8](#decisions)).
   - Rules: the moved tests of today.
   - `main` works: each importer reads the new place, and no behavior changes.
3. **PR3. The worker-layer moves**.
   - Files: the moves to `src/worker/unit/` and `src/worker/contract.ts`; `WorkerErrorCode.StartToolMissing` to `src/agent/pi-tools.ts` with the value `worker.start.tool_missing`; the lint glob `src/agent/capabilities/**/*.ts` (`eslint.config.js:1007`) to `src/worker/unit/capabilities/**/*.ts`; the import list of `worker-unit` and `apps-worker` (`eslint.config.js:518-548`).
   - Rules: [L1 U11](L1-model.md#unit-level-rules).
   - `main` works: the worker reads each moved file at its new place.
4. **PR4. The redaction split and the hook tests**.
   - Files: `src/agent/redaction.ts` and the four hook modules of [L3 Extension modules](L3-agent.md#extension-modules); the known-secret block of a tool input ([L3-D11](L3-agent.md#decisions)); `assistantRedaction` on `openSession` and `openSessionRuntime`; the rotate warning; `sessionParts` of `src/agent/agent-session.ts` with the named members of `SessionRedactionInput`; the test files `home-relative-cwd.test.ts`, `pinned-layers.test.ts`, `tool-approval.test.ts` and `tool-allowlist.test.ts` in `src/agent/hooks/`; the `toolApproval` tests of `sensitive-text-redaction.test.ts` move to `tool-approval.test.ts`; the gate check of L1 U8 in `pnpm run verify`.
   - Rules: [L1 U2, U6, U8, U10](L1-model.md#unit-level-rules); [L3-U8](L3-agent.md#unit-level-rules); the three hook test files of [L3-U9](L3-agent.md#unit-level-rules); [L3-U10, L3-U12, L3-U13](L3-agent.md#unit-level-rules).
   - `main` works: both open paths of today keep the three redactions of LLM output of today (L3-U12, L3-U13). Each module of `src/agent/hooks/` has a test file next to it, so the gate check passes.
5. **PR5. The catalog split and the prompt files**.
   - Files: `src/agent/catalog.ts` with the profiles and `AgentTools`; `src/agent/declarations.ts`; `src/agent/prompt-assets.ts`; `static/prompt/coding.md`, `static/prompt/role/swe@1.md`, `static/prompt/role/re@1.md`.
   - Rules: [L3-U2, L3-U3](L3-agent.md#unit-level-rules).
   - `main` works: the worker path keeps `static/prompt/swe@1.md` and `re@1.md` until LB.
6. **PR6. The prompt chain**.
   - Files: `src/agent/prompt-chain.ts` with `composeSystemPrompt`, `profilePrompt` and `systemPromptDigest`; `finalPrompt` of `src/agent/prompt-render.ts` calls `composeSystemPrompt`; `systemPrompt` leaves; the call in `src/workbench/service.ts:375`.
   - Rules: [L3-U1](L3-agent.md#unit-level-rules).
   - `main` works: L3-U1 proves the byte-equal composed text of each consumer of today.
7. **PR7. The wall budget and the base outcome** ([LA3 Entry state](LA3-run-ends.md#entry-state) items 2 and 4).
   - Files: `src/agent/run-budget.ts` with the wall limit only: a timer at `deadline` aborts the session, and the end is `budget_end` with `budgetReached` `wall`. `src/agent/run-outcome.ts` with the ends `completed`, `budget_end`, `stopped` and `failed`, the totals, the failure kind of `providerFailureOf` and the class `terminal` for each end that is no completion.
   - Note: `run-outcome.ts` calls `providerFailureOf` from `src/llm/provider-failure.ts`. That file imports `ProviderFailure` from `src/scheduler/contract.ts`, which is outside the import-rule allowed set. PR7 decides the exact mechanism to stay within the boundary.
   - Rules: the wall case of [L3-U6](L3-agent.md#unit-level-rules); the end, failure kind, `internal` and totals cases of [L3-U5](L3-agent.md#unit-level-rules). LA3 adds the `usd`, first-limit and class cases. LA4 adds the `endAfterTurn` cases.
   - `main` works: no consumer calls the new modules.
8. **PR8. The agent contract and the import check**.
   - Files: `src/agent/tool-table.ts`; `setWork(work: WorkPin | null)` in `src/agent/pinned-layers.ts`; the move of `pinned-layers.test.ts` onto Faux; `src/agent/agent-contract.ts` with `openAgent`, which takes `RunBudget { deadline, usd }` and checks no start precondition; the import check of [L3 Import rule](L3-agent.md#import-rule). Close the two HANDOFF items of [L3 To HANDOFF.md](L3-agent.md#to-handoffmd).
   - Rules: [L1 U3, U15](L1-model.md#unit-level-rules); [L3-U7](L3-agent.md#unit-level-rules) less the refusal bullet; the cases of `src/agent/pinned-layers.test.ts` of [L3-U9](L3-agent.md#unit-level-rules); [L3-U11](L3-agent.md#unit-level-rules); the case of [L3-U6](L3-agent.md#unit-level-rules) for the command limit with a `null` deadline.
   - `main` works: no shipped command calls `openAgent`. The import check passes from this pull request. The catalog split of PR5 and `setWork(WorkPin)` of this pull request remove the last imports outside the allowed set of [L3 Import rule](L3-agent.md#import-rule).
9. **PR9. The input modules of `run agent`**.
   - Files: `run-agent-options.ts`, `run-agent-input.ts`, `run-agent-auth.ts`, `run-agent-model.ts`, `run-agent-session.ts`, `run-agent-output.ts`, `run-agent-pi.ts`, `run-agent-start.ts`, `run-agent-environment.ts`, `run-agent-budget.ts` and `run-agent-digest.ts` in `src/apps/cli/`, each with its test file. `run-agent-auth.ts` holds the file checks, the entry checks 1 to 6 and the [routing metadata mapping](L2-agent-cli.md#routing-metadata-mapping). `run-agent-pi.ts` holds rules 1 to 5 of [The pi directory](L2-agent-cli.md#the-pi-directory), with the `auth.json` check before the pi tool install.
   - `run-agent-start.ts` holds the [proxy settings](L2-agent-cli.md#proxy-settings): it refuses `NODE_USE_ENV_PROXY`, the token `--use-env-proxy` in `NODE_OPTIONS` and `--use-env-proxy` in `process.execArgv` with `cli.run.agent.env_proxy`.
   - `run-agent-environment.ts` removes the names of `AMBIENT_CREDENTIAL_NAMES` (`src/worker/unit/tasks-seed.ts:393`) and `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` in upper and lower case. Its test asserts that its list equals `AMBIENT_CREDENTIAL_NAMES` plus the eight proxy names. LA4 PR 2 changes the test to a literal list when it deletes the original.
   - `run-agent-budget.ts` parses the wall form with `DURATION_PATTERN`, gives the default `2h`, and refuses each `usd` value with `cli.run.agent.option_invalid`, `option: --budget`.
   - Rules: L2 unit-level rules 1 to 8 and 12 ([L2](L2-agent-cli.md#unit-level-rules)), less the cost cases of rule 1; the wall and default cases of rule 9; [L1 U1, U4, U5, U14](L1-model.md#unit-level-rules); the name list of the ambient removal.
   - `main` works: no command calls the modules.
10. **PR10. `kanthord run agent`**.
    - Files:
      - `src/apps/cli/run-agent.ts`: step 1 of the [run order](L2-agent-cli.md#run-order), the `--token` refusal and then the proxy checks of `run-agent-start.ts`; steps 2 to 11;
      - the run directory R with rules 1, 2, 4, 5, 6 and 7 of [The run directory](L2-agent-cli.md#the-run-directory);
      - `src/apps/cli/run-agent-exit.ts` with its test: the exits `0`, `2`, `4` and `5`, `cli.run.agent.open_failed`, and the diagnostics `cli.run.agent.provider_failed` and `cli.run.agent.internal_error` after the result;
      - `src/apps/cli/run-agent-signal.ts` with the behavior of `stopOnSignal` of today: one SIGINT aborts the session through `input.signal`, with no time limit;
      - `CommandName.Run` and the group `run` in `createProgram` of `src/apps/cli/index.ts`; `run` in `TOP_LEVEL_NAMES`, `PAGE_INVENTORIES` and `PAGE_COUNTS`; `DOCUMENTED_COUNT` 239 and `IMPLEMENTED_COUNT` 234 in `src/apps/cli/completeness.test.ts`;
      - `engine/docs/cli/run.md` with each rule that LA1 ships; the root names, the root help list and the exits `2`, `4` and `5` in `docs/cli/other.md`; the link list of `docs/cli/README.md`; the root name count in `docs/cli/other.md:1155`, `docs/cli/README.md:71` and `docs/cli/project.md:36`;
      - the test support and the three end-to-end test files; the test-support pattern `*test-support.ts` in the import allowance of the `apps-cli` test files (`eslint.config.js:490`).
    - Rules: the terminal cases and the `open_failed` case of L2 unit-level rule 10 in `run-agent-exit.test.ts`; [L1 U9](L1-model.md#unit-level-rules); the thirteen checks of [End-to-end checks](#end-to-end-checks).
    - `main` works: `run agent` is a new command, and `worker tasks run` keeps its behavior.

11. **PR11. The play setup**.
    - Files: `scripts/play-run-agent.mjs` and `scripts/play-run-agent.test.mjs` ([L2 Play setup](L2-agent-cli.md#play-setup)); the script `play:agent` and both files in `test`, `format`, `lint` and `format:check` of `package.json`; the section "Try it" of `engine/docs/cli/run.md`, with the setup and the command of `run.sh`.
    - Rules: [L2-AC16](L2-agent-cli.md#checks).
    - `main` works: the script is a new file that no command calls.

## End-to-end checks

(LA1 ends when these pass)

### Harness

- **Process.** Each check starts the built CLI as a child process: `process.execPath` with `bin/kanthord.mjs` and the arguments of the check ([LA-D10](LA-agent-build.md#decisions)). The harness fails at once when `dist/main.js` is absent. `pnpm run verify` runs `build` before `test` (`package.json:35`), and the CI job `check` runs `pnpm run build` before the tests. The child gets only the environment that the check names, plus `PATH` of the test process for the pi tools. The process uses the real file system, real git and the real pi runtime.
- **Stub.** `src/apps/cli/e2e-llm-stub-test-support.ts` holds the LLM stub of the [L2 fixtures](L2-agent-cli.md#l2-fixtures). It is an `node:http` server on `127.0.0.1` with a free port. It serves `POST /v1/responses` with server-sent events, in the event shape of `compatibleServer` (`src/llm/model-check.test.ts:248`). It takes a list of scripted turns: a text, tool calls, usage, an HTTP status with a body, or a delay. It records each request with its headers and body, and each connection. It is the only stub. [LA3](LA3-run-ends.md#scope) adds a delayed answer, a fixed HTTP status with a body, and the record of a closed connection.
- **Fixtures.** `src/apps/cli/e2e-run-agent-test-support.ts` builds Auth, W, H, X, T, D, S and O of the [L1 shared fixtures](L1-model.md#shared-fixtures) and the [L2 fixtures](L2-agent-cli.md#l2-fixtures) in a new temporary directory per check. K is a string of 40 ASCII letters. W is a new git repository with one commit. The harness expands `$TEST` in each scripted text.
- **Run.** `src/apps/cli/e2e-run-agent-test-support.ts` starts the command line of the L2 fixture Run, with the changes of each check, and returns the exit code, stdout, stderr and the stub record.
- **Place.** The checks run in `pnpm run verify` on macOS and in the CI job `check`. They need no network namespace and no test user ([LA1-D3](#decisions)). Each test has a timeout of 120 seconds.

### Checks

Each check keeps the fixture, the command and the pass condition of its source text. The pass condition is the full assertion list of the source.

| Check                                                                                                              | Test file                                     | Stub turns                                          |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| [L2-AC1](L2-agent-cli.md#checks): a run does its work, records it and reports it                                   | `src/apps/cli/e2e-run-agent.test.ts`          | `write`, `bash`, text `done-1`, each usage 10 and 2 |
| [L2-AC3](L2-agent-cli.md#checks): a refused session path starts nothing                                            | `src/apps/cli/e2e-run-agent.test.ts`          | none; the request log stays empty                   |
| [L2-AC4](L2-agent-cli.md#checks): LLM output unchanged, result redacted, rotate warning                            | `src/apps/cli/e2e-run-agent.test.ts`          | one text that holds K                               |
| [L2-AC5](L2-agent-cli.md#checks): a refused `--auth` file starts nothing                                           | `src/apps/cli/e2e-run-agent-boundary.test.ts` | none; the request log stays empty                   |
| [L2-AC7](L2-agent-cli.md#checks): the pi directory holds only shipped files, and the run loads nothing from a path | `src/apps/cli/e2e-run-agent-boundary.test.ts` | variant 1: none; variant 2: text `ok`               |
| [L2-AC8](L2-agent-cli.md#checks): one input under two profiles                                                     | `src/apps/cli/e2e-run-agent.test.ts`          | text `ok` per run                                   |
| [L2-AC9](L2-agent-cli.md#checks): a prompt value is text or a file                                                 | `src/apps/cli/e2e-run-agent.test.ts`          | text `ok`                                           |
| [L2-AC13](L2-agent-cli.md#checks): the model selection reaches the request                                         | `src/apps/cli/e2e-run-agent.test.ts`          | text `ok`                                           |
| [L2-AC14](L2-agent-cli.md#checks): a confined profile reads nothing outside its root                               | `src/apps/cli/e2e-run-agent-boundary.test.ts` | four blocked calls, one `read` of F, then a text    |
| [L2-AC16](L2-agent-cli.md#checks): the play setup gives a workspace, a placeholder prompt and a run that works     | `scripts/play-run-agent.test.mjs`             | text `ok`                                           |
| [L3-AC1](L3-agent.md#acceptance-checks): no input entry holds a known secret                                       | `src/apps/cli/e2e-run-agent-contract.test.ts` | run 1: `read`, text `done`; run 2: HTTP 400 with K  |
| [L3-AC2](L3-agent.md#acceptance-checks): each profile composes the prompt chain                                    | `src/apps/cli/e2e-run-agent-contract.test.ts` | text `ok` per profile                               |
| [L3-AC3](L3-agent.md#acceptance-checks): the full tool set, and an absent declared tool                            | `src/apps/cli/e2e-run-agent-contract.test.ts` | one scripted call per profile, text `done`          |
| [L3-AC4](L3-agent.md#acceptance-checks): a known secret in a tool input blocks the call                            | `src/apps/cli/e2e-run-agent-contract.test.ts` | one message with `bash` and `write`, text `done`    |

Build details that the source texts leave open:

1. **L2-AC1, variant 2.** The test compares stdout with the [text layout](L2-agent-cli.md#--output-stdout) line by line. The `duration` row matches `^  duration   \d+\.\d s$`. Each other row is exact.
2. **L2-AC8.** The stub serves the three runs in order. The test reads `input_digest` and `system_prompt_digest` from the three lines of O.
3. **L2-AC9.** The child process starts with the current directory C1.
4. **L3-AC1, run 2.** The stub answers each request with HTTP 400, so pi makes no retry: `isRetryableAssistantError` accepts no status 400 text. The test asserts exit `5` and one request.
5. **L3-AC2.** The test reads each expected file from `static/prompt/` of the engine at test time, so a prompt change needs no test change.
6. **"T holds no file".** The test lists T with `readdir` after the exit and expects an empty list.
7. **L2-AC5.** `<marker>` is a path in `$TEST`. The test reads it with `lstat` and expects `ENOENT`.
8. **L2-AC7, variant 2.** The commit of W holds `.pi/extensions/x.ts` and `AGENTS.md` before the run. M7 and M9 are paths in `$TEST`.
9. **L2-AC14.** The marker file lies in `$TEST`, outside W. A block result is a `toolResult` entry of S with `isError` `true`.
10. **L2-AC16.** The test sets `XDG_STATE_HOME` of the script to X and starts the stub of `e2e-llm-stub-test-support.ts`. It fails at once when `dist/main.js` is absent.

## Unit-level rules

Each rule has its test file next to the owning module.

| Rule                                                                                             | Owning module                                                               |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| L1 U1: session path refusals                                                                     | `src/apps/cli/run-agent-session.ts`                                         |
| L1 U2: input redaction of `custom` and steering messages                                         | `src/agent/hooks/input-redaction.ts`                                        |
| L1 U3: no K in a text of the contract                                                            | `src/agent/agent-contract.ts`                                               |
| L1 U4: the `--auth` refusals                                                                     | `src/apps/cli/run-agent-auth.ts`                                            |
| L1 U5: `--token` first                                                                           | `src/apps/cli/run-agent-options.ts`                                         |
| L1 U6: the allowlist block                                                                       | `src/agent/hooks/tool-allowlist.ts`, PR4                                    |
| L1 U8: a hook module with no test fails the gate                                                 | `package.json`, script of the gate check                                    |
| L1 U9: `run` in the root set and the help                                                        | `src/apps/cli/completeness.test.ts`, `src/apps/cli/index.ts`                |
| L1 U10: one finding and one warning per message                                                  | `src/agent/hooks/output-finding.ts`                                         |
| L1 U11: the lint glob of capabilities                                                            | `eslint.config.js`                                                          |
| L1 U14: the proxy settings                                                                       | `src/apps/cli/run-agent-start.ts`                                           |
| L1 U15: the import closure of the runtime                                                        | the import check of PR8                                                     |
| L3-U1 to L3-U3, L3-U8 to L3-U13; L3-U7 less the refusal bullet; the LA1 cases of L3-U5 and L3-U6 | the modules that [L3 Unit-level rules](L3-agent.md#unit-level-rules) names  |
| L2 rules 1 to 8 and 12; the LA1 cases of rules 9 and 10                                          | the files of [Module files](LA-agent-build.md#module-files-of-the-l2-rules) |
| The name list of the ambient removal                                                             | `src/apps/cli/run-agent-environment.ts`                                     |

These rules or cases belong to LA3:

- L3-U4;
- the refusal bullet of L3-U7;
- the class cases of L3-U5;
- the `usd` and first-limit cases of L3-U6;
- the cost cases of L2 rules 1 and 9;
- the `retryable` case and the signal-during-open case of L2 rule 10;
- L2 rule 11.

The `endAfterTurn` cases of L3-U6 belong to LA4. PR10 tests the SIGINT stop of today in `src/apps/cli/run-agent-signal.test.ts`.

## Credential statement

Each row names a credential rule that LA1 touches. "Today" is `worker tasks run` at `c864130e`. No row is weaker than today, except the two rows that Ulrich ruled.

| Rule                               | Today                                                                                                         | After LA1                                                                                                                                                             | Strength                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Credential input                   | Standard input with the `isatty(0)` check and a zeroed buffer (`stdinOf`, `src/apps/cli/worker-tasks.ts:121`) | The `--auth` file only, with the file checks and entry checks of L2. `run agent` reads no standard input                                                              | Ruled (Q8, L1-D22)                  |
| Provider, metadata schema, expiry  | `credentialOf` and `routingMetadataOf` (`src/worker/unit/tasks-credential.ts`)                                | The entry checks 1 to 6 of L2: schema, `!`, `$`, secret shape, metadata schema, expiry                                                                                | Ruled (Q8); stricter on the shape   |
| Frozen store                       | `frozenStore` (`src/llm/refresh-watch.ts`)                                                                    | The same store                                                                                                                                                        | Same                                |
| Known secrets                      | `credentialValues` joins the key, or `access` and `refresh`                                                   | The same values join the known secrets of the session                                                                                                                 | Same                                |
| Ambient removal                    | `withoutAmbientCredentials` with `AMBIENT_CREDENTIAL_NAMES` (`src/worker/unit/tasks-seed.ts:393`)             | `run-agent-environment.ts` removes the same names and the eight proxy names on the process environment, with `HOME` set to `R/home`. Proof: the name-list test of PR9 | Stricter                            |
| Proxy names and Node proxy setting | Kept; no refusal                                                                                              | Removed; `NODE_USE_ENV_PROXY` and `--use-env-proxy` give `cli.run.agent.env_proxy` ([L2-D19](L2-agent-cli.md#decisions)). Proof: L2 rule 8, L1 U14                    | Stricter                            |
| Child environment                  | `PATH`, `LANG`, `TMPDIR` of the shell, `FIXED_GIT_ENV`, passed variables                                      | `PATH`, `LANG`, `TMPDIR=R/tmp`, `HOME=R/home`, `FIXED_GIT_ENV`; no passed variable                                                                                    | Stricter                            |
| pi directory credential file       | `bindPiDirectory` checks `auth.json` after the tool install (`src/worker/unit/tasks-run.ts:693-698`)          | The check comes before the install, with the owner and link checks of L2. Proof: L2 rule 7, L2-AC7                                                                    | Stricter                            |
| pi directory of the process        | `bindPiDirectory` refuses a pi directory other than its own (`src/worker/unit/tasks-run.ts:696-697`)          | `run agent` sets the pi directory to P and ignores `PI_CODING_AGENT_DIR` of the parent. Proof: L2 rule 7, L2-AC7; L2-AC6 in LA2                                       | Same                                |
| Session record                     | In-memory session; `turns.jsonl` with the writer redaction                                                    | A `0600` session file at a checked caller path; no input entry holds a known secret; a tool input with a known secret is blocked                                      | Replaced (R2-A); stricter on inputs |
| LLM output                         | Redacted with rule 0                                                                                          | Unchanged in the record; a finding gives the rotate warning; the result and each `reason` pass the exit redaction. The open paths of today keep the redaction         | Ruled (R2-H)                        |
| Allowlist and confinement          | Only in sessions that `agentPort` opens                                                                       | In each `openAgent` session, by profile. Proof: L1 U6, L2-AC14                                                                                                        | Stricter                            |
| KanthorD credential                | `tasks run` declares no `--token`                                                                             | `run agent` refuses `--token` before each other check                                                                                                                 | Same                                |
| Stop on a signal                   | `stopOnSignal` handles SIGINT (`src/apps/cli/worker-tasks.ts:287-292`)                                        | One SIGINT aborts the session; the run removes R and writes the result                                                                                                | Same; LA3 makes it stricter         |
| Play setup                         | No play setup                                                                                                 | `play-run-agent.mjs` passes the `--auth` path only; it reads, copies and prints no credential. Proof: L2-AC16                                                         | Same                                |
| Run bound                          | The wall time of the seed (`wallDeadlineOfPlan`)                                                              | The wall budget, default `2h`; a `usd` value is refused                                                                                                               | Same                                |

Proof: each row of "Stricter" or "Same" has a unit rule of [Unit-level rules](#unit-level-rules) or a check of [End-to-end checks](#end-to-end-checks) in LA1. LA2 adds the end-to-end proof of the rules that need the network namespace or the test user: L2-AC2 and L2-AC6.

## Handoffs

### To LA2

- The Linux job `agent-e2e`, the script `test:agent-e2e`, the network namespace N and the test user ([LA2 PR 1](LA2-credential-boundary.md#pr-1-the-linux-test-job)).
- The checks L2-AC2 and L2-AC6 against the modules that LA1 ships: `run-agent-auth.ts`, `run-agent-environment.ts`, `run-agent-pi.ts` and R.

### To LA3

- The [Entry state of LA3](LA3-run-ends.md#entry-state) is the exit state of LA1.
- The start preconditions (`src/agent/start-preconditions.ts`, called from `run-agent.ts` at run-order step 9, L3-U4); the class `retryable` and exit `75`; the cost budget; SIGTERM and [Shutdown](L2-agent-cli.md#shutdown) rules 1 to 5.
- The checks L2-AC10, AC11, AC12 and L3-AC5, with the stub of `src/apps/cli/e2e-llm-stub-test-support.ts`.

## Decisions

1. **LA1-D1.** LA1 builds the `--auth` reader, R, the pi directory checks, the ambient removal with the proxy names, the `env_proxy` refusal, the wall half of `run-budget.ts`, the base of `run-outcome.ts` and the SIGINT stop of today. Constraint: LA1 checks no start precondition and refuses a `usd` budget; LA2 adds the Linux job with L2-AC2 and L2-AC6; LA3 extends the budget, the outcome and the signal handler.
2. **LA1-D2.** LA1 has eleven pull requests. PR9 holds the input modules with no caller, PR10 connects the command, and PR11 adds the play setup. Constraint: the end-to-end checks of the command land in PR10 and L2-AC16 lands in PR11; PR1 to PR9 pass with unit tests and the end-to-end tests of today.
3. **LA1-D3.** The LA1 checks run in `pnpm run verify` on macOS and in the CI job `check`. Constraint: no LA1 check needs a network namespace or a test user.
4. **LA1-D4.** `run agent` holds its own copy of each check that it takes over from `tasks run`. Constraint: LA1 changes no file of `tasks run`; LA4 deletes the old copies.
5. **LA1-D5.** The harness starts the built `bin/kanthord.mjs` ([LA-D10](LA-agent-build.md#decisions)). Constraint: the harness fails at once when `dist/main.js` is absent.
6. **LA1-D6.** The e2e support has two files: the LLM stub `src/apps/cli/e2e-llm-stub-test-support.ts` and the harness `src/apps/cli/e2e-run-agent-test-support.ts`. The test files are `src/apps/cli/e2e-run-agent.test.ts`, `src/apps/cli/e2e-run-agent-contract.test.ts` and `src/apps/cli/e2e-run-agent-boundary.test.ts`. Constraint: LA2, LA3 and LA5 use the same stub and harness; the build excludes `*test-support.ts` from `dist` (`tsconfig.build.json`).
7. **LA1-D7.** The first real-LLM run is gate step 4.2 at the end of LA1, on the play setup of PR11 (Ulrich, 2026-11-23). Constraint: no automated check calls a real model; the CI holds no model credential.
8. **LA1-D8.** PR1 and PR2 ship as one pull request. `credentialSecrets` and `mergedSecrets` move to `src/agent/known-secrets.ts` (not `src/llm/`). The type `KnownSecrets` stays in the runtime module `src/agent/hooks/sensitive-text-redaction.ts`, and `known-secrets.ts` imports it. `ProviderFailure` stays in `src/scheduler/contract.ts`. Constraint: no runtime module imports `known-secrets.ts`, because that file imports `src/custody/contract.ts`. Reason: `eslint` refuses an empty `files` array, so the lint rule ships with the file `src/agent/known-secrets.ts` already in scope; the boundary rule forbids `agent` and `worker-unit` to import the `llm` component; a `contract.ts` file may import only contract files.
9. **LA1-D9.** PR3 rulings.
   - The code of the pi tool install is the module constant `START_TOOL_MISSING` of `src/agent/pi-tools.ts`, with the value `worker.start.tool_missing`. `WorkerErrorCode` holds no `StartToolMissing`. Constraint: `pi-tools.ts` exports no code set and imports no `contract.ts`.
   - `src/agent/catalog.ts` exports no parameter schema. Each reader of `HOST_TOOL_PARAMETERS`, `EVIDENCE_UPLOAD_PARAMETERS` and `LINK_UPDATE_LIST_PARAMETERS` imports `src/worker/contract.ts`. The catalog keeps its import of `HostTool` until the catalog split of PR5.
   - The agent import list of `worker-unit` and `apps-worker` gets `hooks/checkout-confinement` and `hooks/tool-allowlist`, because `agentPort` reads both hooks from the worker layer. The list loses the six moved entries.
   - The lint entry of `src/worker/unit/capabilities/**/*.ts` stands after the `no-restricted-syntax` entry of the worker files and repeats its `ImportExpression` selector. Reason: a later flat-config entry replaces the options of the same rule. Constraint: a capability file keeps each restriction of a worker unit file.
   - `src/worker/contract.ts` joins the files of `kanthord/no-inline-object-type`, and each site gets a named type or a named value set. Its suppression count of `kanthord/no-inline-param-type` falls from 6 to 5.
   - `FORBIDDEN_DIRECTORIES` and `FORBIDDEN_MODULES` of `src/worker/unit/foundry-boundary.test.ts` name `src/worker/unit/capabilities/` and `src/worker/unit/agent-port.ts`. Constraint: a move of a forbidden module changes its path in that test in the same pull request.
10. **LA1-D10.** PR4 rulings.
    - The type `KnownSecrets` lives in the runtime module `src/agent/redaction.ts`, and `known-secrets.ts` imports it. The constraint of LA1-D8 stands: no runtime module imports `known-secrets.ts`.
    - `createRedaction(known, sessionId)` of `src/agent/redaction.ts` gives the state `SessionRedaction`. Constraint: a hook module calls only methods of the state and holds no marker table, no matcher and no count.
    - `inputRedaction` holds the `context` redaction of a `custom` message and the `errorMessage` redaction of an `assistant` message. `assistantRedaction` holds only the three redactions of LLM output. Constraint: the contract path loses no input redaction when the interim module leaves.
    - The known-secret block of `markerRestore` reads each string of the tool input, also under a structural key such as `id` or `type` and in the `data` of an image block. Constraint: a failed scan blocks the call with the unkept reason.
    - `outputFinding` reads each string of `content`, the thinking signature included, and counts a failed scan as `scan_failed`. PR4 adds it to no session. PR8 adds it on the contract path.
    - `redactionSummary` keeps its seven fields of today. PR8 adds the contract summary with `output_found_count` and `output_found_rules`. Constraint: the worker span keeps its seven redaction attributes until L6.
    - `src/agent/redaction-test-support.ts` holds the harness of the redaction tests. It runs the `message_end` and `context` handlers as a chain, as pi does. Each test of `sensitive-text-redaction.test.ts` lies in the test file of the module that owns the behavior.
    - The cases of L3-U13 lie in `src/worker/unit/agent-session.test.ts`, the test file of `agent-session.ts` of today.
    - The gate check of L1 U8 is `scripts/hooks-gate.test.mjs`. It is a file of `always_run` in `.kanthord/suite-pass.json`, because it reads a directory and its import closure holds no hook module.
    - `src/agent/agent-session.ts`, `src/agent/redaction.ts` and the four hook modules join the files of `kanthord/no-inline-object-type`. `eslint-suppressions.json` loses the entry of the deleted file `src/agent/hooks/sensitive-text-redaction.ts`. The agent import list of `worker-unit` and `apps-worker` gets `redaction` in place of `hooks/sensitive-text-redaction`, and no hook module of the split.
11. **LA1-D11.** PR5 rulings.
    - `WorkerTool` is a const object in `src/agent/catalog.ts` with values `evidence-upload` and `link_update_list`. It replaces the `HostTool` import from `src/worker/contract.ts`. Constraint: `catalog.ts` imports no worker module after PR5.
    - `AgentDeclaration` in `src/agent/declarations.ts` has no `tools` or `host_tools` fields. All consumers that need the tool set use `getProfile` from `catalog.ts`. Constraint: `declarations.ts` imports no worker module.
    - The agent import list of `worker-unit` and `apps-worker` does not change. `src/worker/unit/pinned-layers.test.ts` composes its system prompt from a marker text, not from `swe@1.md`. Constraint: no worker file reads `prompt-assets.ts`.
    - `src/project/environment-agent.ts` declares `getProfile("env@1").tools.builtin` and `.tools.environment` as the allowlist of the `env@1` session. Constraint: the field `environment` has its reader.
    - `Profile.prompt` is `ProfilePromptFiles`: `coding` holds the text of `coding.md`, or `null` for `env@1`; `role` holds the Role text. `profilePrompt` of PR6 is its reader.
    - `src/agent/catalog.ts`, `src/agent/declarations.ts` and `src/agent/prompt-assets.ts` join the files of `kanthord/no-inline-object-type`.
    - `src/agent/prompt-assets.test.ts` is the test file for L3-U3. It derives each new file from `swe@1.md` or `re@1.md`: the named sections byte-equal, the protocol text of [L3 Prompt files](L3-agent.md#prompt-files) removed, and one final newline. It asserts that each new file equals its derived text.
12. **LA1-D12.** PR6 rulings.
    - `finalPrompt` passes the parts of layer 1 before the first part of another layer as the profile list, and the rest, the framing included, as the instruction list. Constraint: the composed text stays byte-equal to the join of today for each part order.
    - `composeSystemPrompt` asserts only that the profile list is not empty. An empty text renders as is. Reason: an empty instruction file or agent-directory file resolves with an empty text today. Constraint: the server consumers never throw on such a file.
    - `systemPromptDigest` calls `createHash("sha256")` of `node:crypto` on the UTF-8 text. Constraint: `prompt-chain.ts` imports no `prompt-composer.ts`, a module of the server part ([L3 Import rule](L3-agent.md#import-rule)).
    - `framingPartFromTemplates(templates, consumer)` of `prompt-render.ts` gives the framing part from `PromptTemplates`, with `PromptOrigin.Binary` and no path. The Workbench Service and the Project Service call it in place of `systemPrompt`. Constraint: only `finalPrompt` reads that part, and no span records it. The Project Service stops its call in LA4 PR 1, and the Workbench stops its call at the Workbench rebase. The last of them deletes `framingPartFromTemplates`.
    - `src/project/environment-agent.ts`, `src/worker/execution-setup.test.ts` and `src/agent/prompt-resolve.test.ts` change with PR6. Reason: `environment-agent.ts` is the second caller of `systemPrompt`, and the two test files import it. Constraint: `execution-setup.test.ts` asserts the final text against a join that the test writes.
    - The cases of L3-U1 for `finalPrompt` lie in `src/agent/prompt-render.test.ts`, the test file of the module that owns `finalPrompt`.
    - `src/workbench/service.ts` and `src/agent/prompt-render.ts` join the `kanthord/no-inline-object-type` file list. `service.ts` gains `WorkbenchAgentPrompt` and `WorkbenchAgentConfiguration` named interfaces. `prompt-render.ts` gains `InstructionFileResolved`, `InstructionFileUnresolved` and `RepositoryPromptsContent`.
13. **LA1-D13.** `providerFailureOf` moves from `src/llm/provider-failure.ts` to `src/scheduler/contract.ts`, next to `ProviderFailure`. `src/llm/provider-failure.ts` becomes a re-export of `providerFailureOf` from `../scheduler/contract.ts`. The three direct importers (`src/llm/model-check.ts`, `src/worker/unit/native-agent.ts`, `src/worker/unit/agent-telemetry.ts`) update to import from `src/scheduler/contract.ts`. `run-outcome.ts` imports `providerFailureOf` and `ProviderFailure` from `../scheduler/contract.ts`. Constraint: no boundary rule changes; `scheduler/contract.ts` is a service contract and is in the allowed set of `agent`, `llm`, `worker-unit` and `apps-worker`. The entry `src/llm/provider-failure.ts` in the [L3 Import rule](L3-agent.md#import-rule) allowed set is superseded: `scheduler/contract.ts` is covered by the service contract allowance. Reason: the ESLint boundaries forbid `agent` from importing `llm`; moving the function to a service contract that all three components already import satisfies the boundary with no copy and no widened allowlist.
