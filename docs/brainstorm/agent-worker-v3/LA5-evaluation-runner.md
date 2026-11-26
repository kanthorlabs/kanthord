# LA5. The evaluation runner

Status: `draft`. Base: engine `c864130e`. Parent: [LA](LA-agent-build.md#sub-layers).

## Goal

LA5 adds the runner of [L4](L4-agent-evaluation.md#runner) to the engine: `run.sh`, `report.sh`, `evaluation.mjs`, `judge.md` and `judge-task.md` in `scripts/evaluation/agent/`. The runner runs `swe@1` through the built `kanthord run agent` on each case of a set, grades each diff in a new clone with the hidden tests, runs the `re@1` diagnosis on the dev set, applies the breach rules, and writes the report with the iteration verdict, the A/A line or the gate verdict. LA5 ends when the ten checks [L4-AC1 to L4-AC10](L4-agent-evaluation.md#checks) pass in the CI job `agent-e2e`, and the unit-level rules 1 to 20 of [L4](L4-agent-evaluation.md#unit-level-rules) pass in `pnpm run verify`.

### Entry state

- LA1 to LA3 are done ([LA-D11](LA-agent-build.md#decisions)). `kanthord run agent` applies each rule of L2 and L3: the `--auth` file checks, the pi directory checks, R, the ambient removal, the proxy refusal, the start preconditions, the wall and cost budgets, the classes `terminal` and `retryable`, the exits `0`, `1`, `2`, `4`, `5` and `75`, and the signal handler.
- `worker tasks run`, `tasks seed` and `tasks compare` still exist. LA4 PR 2 deletes them. The runner calls only `kanthord run agent`.
- The Linux job `agent-e2e` runs `src/**/*.linux-test.ts` in the network namespace `kanthord-n` with the test user `kanthord-e2e` and its home `/home/kanthord-e2e` ([LA2 PR 1](LA2-credential-boundary.md#pr-1-the-linux-test-job), [LA2-D2 and LA2-D4](LA2-credential-boundary.md#decisions)).
- The LLM stub `src/apps/cli/e2e-llm-stub-test-support.ts` serves a list of scripted turns in order ([LA1 Harness](LA1-run-skeleton.md#harness), [LA3](LA3-run-ends.md#scope)).
- `scripts/evaluation/` does not exist.

### Exit state

- An operator runs `run.sh --evaluation <id> --stage <1|2> --set <dev|held-out>` with the options of [`run.sh`](L4-agent-evaluation.md#runsh), and then `report.sh --evaluation <id>`.
- The set author runs `node scripts/evaluation/agent/evaluation.mjs validate <case folder>` for each case and installs `node scripts/evaluation/agent/evaluation.mjs scan` as the pre-commit hook of the evaluation set.
- The [evaluation set build](LA-agent-build.md#evaluation-set-build) and the [agent gate](LA-agent-build.md#agent-gate) can start.

## Scope

### Files added

| File                                           | Content                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/evaluation/agent/run.sh`              | `ulimit -c 0`, then `exec node "$(dirname "$0")/evaluation.mjs" run "$@"`                                                                                                  |
| `scripts/evaluation/agent/report.sh`           | `exec node "$(dirname "$0")/evaluation.mjs" report "$@"`                                                                                                                   |
| `scripts/evaluation/agent/evaluation.mjs`      | The subcommands `run`, `report`, `scan` and `validate`, and each rule of L4 that [Unit-level rules](#unit-level-rules) lists                                               |
| `scripts/evaluation/agent/evaluation.test.mjs` | The unit tests of the unit-level rules 1 to 20 of L4                                                                                                                       |
| `scripts/evaluation/agent/judge.md`            | The question of each goal aspect of [L4 Goal aspects](L4-agent-evaluation.md#goal-aspects) and the output form of [L4 Diagnosis](L4-agent-evaluation.md#diagnosis), rule 5 |
| `scripts/evaluation/agent/judge-task.md`       | The task text of one diagnosis: the list of the files of `j` and the instruction to write the JSON object of rule 5                                                        |
| `src/apps/cli/e2e-evaluation-test-support.ts`  | The builder of the evaluation set E of the [L4 fixtures](L4-agent-evaluation.md#l4-fixtures), as the test user                                                             |
| `src/apps/cli/e2e-evaluation.linux-test.ts`    | The checks L4-AC1 to L4-AC10                                                                                                                                               |

### Files changed

| File                                        | Change                                                                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/apps/cli/e2e-llm-stub-test-support.ts` | Add a responder: a function of the request body that returns the scripted turns of that request. The responder of the L4 fixtures selects the answer by the Role heading of the system prompt and by the task text of the request |
| `package.json`                              | `test` gets `scripts/evaluation/agent/evaluation.test.mjs`. `format`, `lint` and `format:check` get `scripts/evaluation/agent/evaluation.mjs` and `scripts/evaluation/agent/evaluation.test.mjs`                                  |
| `.github/workflows/ci.yml`                  | The job `agent-e2e` gives the checkout root and its `.git` directory to the test user, with an access entry that keeps the write of the job user ([LA5-D6](#decisions))                                                           |

- `eslint.config.js` needs no change. The block of `scripts/**/*.mjs` (`eslint.config.js:285`) covers the two new `.mjs` files, and the test-file blocks cover `src/**/*.linux-test.ts` since LA2.

### Lint scope

[L3-D39](L3-agent.md#decisions) covers `.ts` files. The two new `.ts` files and the changed stub file are test files and test support files. So LA5 adds no file to the file list of `kanthord/no-inline-object-type`.

## Pull requests

Each pull request is one engine pull request into `feature/agent-v2` ([LA How each pull request ships](LA-agent-build.md#how-each-pull-request-ships)). Each PR passes `pnpm run verify` in `engine` and the CI jobs `check`, `e2e` and `agent-e2e`.

### PR 1. One held-out evaluation with the credential rules

- Files: `run.sh`, `report.sh`, `evaluation.mjs` with the subcommands `run` and `report`, `evaluation.test.mjs`, `e2e-evaluation-test-support.ts`, `e2e-evaluation.linux-test.ts`, the responder of the stub, `package.json`, `ci.yml`.
- `evaluation.mjs` builds:
  - the start checks: the configuration refusals, the option rules of `run.sh`, the refusal of `NODE_USE_ENV_PROXY` and of `--use-env-proxy` in `NODE_OPTIONS`, the dirty engine tree, the `set_commit` check, the fixed `gate_share`, the line of `calls.jsonl`;
  - the price read with an in-memory credential store, the price ratio, the scaled budget and the cap start gate;
  - `iteration.json` at the first call;
  - the run of [L4 One evaluation run](L4-agent-evaluation.md#one-evaluation-run), steps 1 to 7 and 9: the clone steps, `setup.sh`, the refresh, the `run agent` call, the credential state and the credential count after each call, the diff steps, breach rule 5, the grading, the scope rules, the frontend rules and the check line;
  - the run action of [L4 Exit codes of a run](L4-agent-evaluation.md#exit-codes-of-a-run) for the exits `0`, `4` and `5`, and the stop for each other exit, `75` included;
  - `report.sh` with the key checks of the `swe@1` lines, the goal table, the cost block and the gate line.
- `run.sh --set dev` exits `1`, and stderr names `--set`. PR 2 removes this refusal.
- Makes pass: L4 unit-level rules 1 to 4, 8, 10, 14 to 16 and 20; rule 9 less the `judge_usd` reserve; rule 13 less the rules of `--parent`, `--aspect`, `--hypothesis` and `--replicate`; rule 5 for `credential` and `auth_file`; rule 11 for the keys of the `swe@1` lines and the held-out report; rule 12 for the exits `0`, `1`, `2`, `4` and `5`.
- Makes pass: [L4-AC4](L4-agent-evaluation.md#checks).
- Verify: `pnpm run verify` on macOS; the job `agent-e2e` on the PR.
- `main` works: the runner is a script of the repository, and no shipped command calls it. Each credential rule that a run needs holds from this PR, because this PR is the first that calls `run agent` from the runner.

### PR 2. The diagnosis and the dev evaluation

- Files: `evaluation.mjs`, `evaluation.test.mjs`, `judge.md`, `judge-task.md`, `e2e-evaluation.linux-test.ts`, `e2e-llm-stub-test-support.ts`.
- The stub records the selected role and task of each request ([Harness](#harness)).
- `evaluation.mjs` builds step 8 of the run: the judge workspace `j` in the grading root, `transcript.md`, the `re@1` call, the credential rules of the diagnosis run, the parse, `diagnoses.jsonl`, the attempt number `judge-<n>.jsonl`, the reserve `judge_usd` of the cap. `report.sh` gets the dev lines: the line for each case, the set-difficulty line, the count of invalid diagnoses, the findings for each aspect and severity, and the verdict `complete`. Stage 2 passes the kind prompt with `--system-prompt`.
- `run.sh --set dev` runs.
- Makes pass: L4 unit-level rules 6 and 19; the `judge_usd` reserve of rule 9; rule 11 for the `re@1` keys and the set-difficulty line; rule 12 for the join of the last `re@1` line.
- Makes pass: [L4-AC1, L4-AC2, L4-AC3 and L4-AC9](L4-agent-evaluation.md#checks).
- Verify: as PR 1.
- `main` works: the dev evaluation adds the diagnosis, and the held-out evaluation of PR 1 is unchanged.

### PR 3. The breach rules

- Files: `evaluation.mjs`, `evaluation.test.mjs`, `e2e-evaluation.linux-test.ts`.
- `evaluation.mjs` builds breach rules 3 and 4, `protected_path` and `set_change`, and the order of rules 1 to 4 after each run.
- Makes pass: L4 unit-level rule 5 in full.
- Makes pass: [L4-AC5](L4-agent-evaluation.md#checks), variants 1 to 5.
- Verify: as PR 1.
- `main` works: a breach stops the evaluation, and each run with no breach is graded as in PR 2.

### PR 4. Stop, resume, attempts and the cap

- Files: `evaluation.mjs`, `evaluation.test.mjs`, `e2e-evaluation.linux-test.ts`.
- `evaluation.mjs` builds the resume by the key case and repeat, the next free attempt number, the restart at exit `75` with a new session file and a new workspace, the stop at the third exit `75` of one run in one call, the stop at `cli.run.agent.prompt_text_path` in stderr, the resume of a missing diagnosis, the stop at a failed `setup.sh`, the report at each stop, the verdict `no verdict` and the unstarted runs of the cost block.
- Makes pass: L4 unit-level rule 12 in full.
- Makes pass: [L4-AC6 and L4-AC7](L4-agent-evaluation.md#checks).
- Verify: as PR 1.
- `main` works: an evaluation with no stop runs as in PR 3.

### PR 5. The iteration, the A/A pair and the set tools

- Files: `evaluation.mjs`, `evaluation.test.mjs`, `e2e-evaluation.linux-test.ts`.
- `evaluation.mjs` builds `--parent`, `--aspect`, `--hypothesis` and `--replicate`; the comparability check and the one-change check of [L4 Iteration](L4-agent-evaluation.md#iteration), rules 1 and 4; the parent `re@1` digest check; the noise rule; the iteration line; the A/A line; the pass shares of the last passed stage 1 gate in the gate line of stage 2 ([LA5-D12](#decisions)); the subcommands `scan` and `validate`, with the import of `findPatternText` ([LA5-D7](#decisions)).
- Makes pass: L4 unit-level rules 7, 17 and 18; rule 11 in full; the rules of `--parent`, `--aspect`, `--hypothesis` and `--replicate` of rule 13.
- Makes pass: [L4-AC8 and L4-AC10](L4-agent-evaluation.md#checks).
- Verify: as PR 1.
- `main` works: an evaluation with no parent and no replicate runs as in PR 4.

### PR 6. The manifest of the shared fixture folder

- Files: `evaluation.mjs`, `evaluation.test.mjs`, `e2e-evaluation-test-support.ts`, `e2e-evaluation.linux-test.ts`.
- `evaluation.mjs` adds: `writeManifest`, `checkManifestDiff` and `manifestPath`; the `manifest` subcommand; the manifest start check in `buildPlan`; the manifest diff check in `checkSetChangeBreach` and `validateCaseFolder`; the tree read `scanShared` and the manifest read `readManifest` ([LA5-D30](#decisions)).
- Makes pass: L4 unit-level rule 21; L4-AC5 variant 6.
- The breach `set_change` now also fires when the tree under `shared/` differs from `shared.sha256`. Constraint: the manifest check runs after the git status check inside `checkSetChangeBreach`, so a dirty git tree still fires `set_change` without a manifest read. The comparison never throws: each read failure is a difference.
- Verify: as PR 1.
- `main` works: the same as PR 5.

### PR 7. The script time limit

- Files: `evaluation.mjs`, `evaluation.test.mjs`.
- `evaluation.mjs` adds `runCaseScript`; applies it to `runCheckMode`, `runSetup` and the `validate` path (`validatedBaseError`, `validatedReferenceError`); exports `validateCaseFolder` ([LA5-D31](#decisions)).
- Makes pass: L4 unit-level rule 22.
- Verify: as PR 1.
- `main` works: the same as PR 6.

### PR 8. Close the two breach-detection gaps

- Files: `evaluation.mjs`, `evaluation.test.mjs`.
- `evaluation.mjs` replaces `git status` in `checkSetChangeBreach` with an index-free comparison ([LA5-D32](#decisions)): `setChangeFromTree` walks the set directory, hashes each file with `git hash-object --no-filters --stdin-paths` (batch) and each symlink target with `git hash-object --stdin`, and compares path, mode and blob against `git ls-tree -r -z <set_commit>`.
- `evaluation.mjs` adds `osDenyWrapper`: on macOS it wraps each agent call with `sandbox-exec`; on Linux with `bwrap`. `runPlan` detects the wrapper, runs the start probe, and stops with exit `1` when the mechanism is absent or the probe fails. `runAgentProcess` copies `--prompt` and `--system-prompt` file args to a temp directory before the wrapped call ([LA5-D32](#decisions)).
- Baseline test count: 302. PR 8 adds 4 set-change tests (1 retarget + 4 new) and 3 OS-deny tests.
- Verify: as PR 1. CI: add `apt-get install -y --no-install-recommends bubblewrap` to the `check` job.
- `main` works: the same as PR 7.

## End-to-end checks

(LA5 ends when these pass)

### Harness

- **Place.** The checks live in `src/apps/cli/e2e-evaluation.linux-test.ts`. Only `test:agent-e2e` runs them, in the job `agent-e2e` ([LA2-D2](LA2-credential-boundary.md#decisions)). Each check writes and reads the `auth.json` file at the default `--auth` path. `run agent` and the refresh take that path from the home that the user database gives. On the machine of a developer, that path holds the real credential.
- **Process.** The test starts `scripts/evaluation/agent/run.sh` and `report.sh` as the test user, with `sudo -n -u kanthord-e2e` and an explicit environment: `PATH`, `XDG_DATA_HOME="$XD"` and `XDG_STATE_HOME="$XS"`. The runner calls the built CLI `bin/kanthord.mjs` of the same checkout ([LA5-D3](#decisions)). The job runs `pnpm run build` before the tests.
- **Stub.** The stub of LA1 with the responder of the [L4 fixtures](L4-agent-evaluation.md#l4-fixtures): the Role heading of `swe@1` or `re@1` in the system prompt, and the text `task d1`, `task d2` or `task h1` in the user message, select the scripted turns. Each turn reports a `usage` of 1000 input and 100 output tokens. The stub records each request with the selected role and task.
- **Set.** `src/apps/cli/e2e-evaluation-test-support.ts` builds E, `config.json`, the binding prompts and the cases `d1`, `d2` and `h1` of the L4 fixtures. It runs each command as the test user, so E, `$XD` and `$XS` belong to that user. They lie under the home of the test user, and the test reads each file as the test user ([LA5-D13](#decisions)). It makes `repo.bundle` with `git bundle create` of C only, with the author of [L4 content rule 2](L4-agent-evaluation.md#content-rules).
- **Auth.** The harness writes `/home/kanthord-e2e/.config/kanthord/auth.json` with mode `0600` as the test user, with K, the `openai-compatible` entry of the [L2 fixtures](L2-agent-cli.md#l2-fixtures) and `OPENAI_COMPATIBLE_MODELS` with `stub-1`. Each check removes the file at its end.
- **Own paths.** Each check and each variant gets its own `$XD`, `$XS` and E, except L4-AC3, which reuses the paths of L4-AC1.
- **Timeout.** Each test has a timeout of 300 seconds. Reason: variant 1 of L4-AC6 waits for three attempts with three pi retries each, about 42 seconds ([L4 Handoffs](L4-agent-evaluation.md#handoffs-to-later-layers)).

### Checks

Each check keeps the fixture, the command and the pass condition of its source text in [L4 Checks](L4-agent-evaluation.md#checks). The pass condition is the full assertion list of the source.

| Check                                                                                                      | PR  | Stub responder change                                 |
| ---------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------- |
| L4-AC1: a dev evaluation grades each run in a new clone, and the diagnosis reads each run                  | 2   | none                                                  |
| L4-AC2: the hidden tests replace the agent files of the same name, and a change outside the scope fails A3 | 2   | `task d2`: `write` `test/new.sh` with `exit 0`        |
| L4-AC3: stage 2 gives the kind prompt of the case kind                                                     | 2   | none                                                  |
| L4-AC4: the held-out evaluation gives the gate verdict with no diagnosis                                   | 1   | none                                                  |
| L4-AC5: a breach stops the evaluation                                                                      | 3   | one responder for each variant, as the source states  |
| L4-AC6: a stop leaves no verdict, and a resume completes the evaluation                                    | 4   | variant 1: HTTP 429 to each request in the first pair |
| L4-AC7: the cap stops the evaluation before a run                                                          | 4   | none                                                  |
| L4-AC8: `report.sh` refuses an iteration with no prompt change                                             | 5   | none                                                  |
| L4-AC9: an invalid diagnosis changes no pass                                                               | 2   | `re@1`: the text `no findings`                        |
| L4-AC10: an A/A pair gives the A/A line                                                                    | 5   | none                                                  |

Build details of the checks:

1. **L4-AC1.** "No workspace root remains" reads `$XS/kanthord/evaluation/work/` after `run.sh` exits. The check of "no `swe@1` request holds `fixture`" reads the request log of the stub, filtered by the role `swe@1`.
2. **L4-AC3.** The test runs L4-AC1 first in the same test, then `e3` in the same `$XD`, `$XS` and E.
3. **L4-AC5, variant 2.** The test asserts the absence of K with a byte search over each listed file and over each file of E. stdout holds the count `1` in the line that the runner prints for the breach.
4. **L4-AC5, variants 1, 4 and 5.** The harness writes the absolute paths of E, `$H` and `$XD` into the scripted turns before the stub serves them, as the harness of LA1 does for `$TEST`.
5. **L4-AC6, variant 4.** The test makes the new commit of E as the test user between the two calls.
6. **L4-AC8.** Both evaluations run on one engine commit. `git diff --name-only` of two equal commits lists no path, so the one-change check passes, and the comparability check refuses the equal `system_prompt_digest`.
7. **Stub receives no request.** The request log of the stub is empty for the call of the check.

## Unit-level rules

The owning module of each rule is `scripts/evaluation/agent/evaluation.mjs`, with its tests in `scripts/evaluation/agent/evaluation.test.mjs` ([L4-D15](L4-agent-evaluation.md#decisions), [LA5-D2](#decisions)). The tests run in `pnpm run verify` on macOS and on Linux.

| L4 unit-level rule                        | PR         |
| ----------------------------------------- | ---------- |
| 1. The case schema                        | 1          |
| 2. The configuration                      | 1          |
| 3. The pass rule and the grading steps    | 1          |
| 4. The scope rules and the frontend rules | 1          |
| 5. The breach rules                       | 1 and 3    |
| 6. The diagnosis parse                    | 2          |
| 7. The noise rule and the A/A line        | 5          |
| 8. The stage gate                         | 1          |
| 9. The cap                                | 1 and 2    |
| 10. The price ratio                       | 1          |
| 11. The report keys                       | 1, 2 and 5 |
| 12. The run action                        | 1, 2 and 4 |
| 13. The start checks                      | 1 and 5    |
| 14. The credential state                  | 1          |
| 15. The refresh                           | 1          |
| 16. The price read                        | 1          |
| 17. The secret scan                       | 5          |
| 18. The case validation                   | 5          |
| 19. The transcript                        | 2          |
| 20. The diff steps                        | 1          |

- `evaluation.mjs` imports the engine modules from the build: `findPatternText` from `dist/agent/sensitive-text.js`, `isolatedGitEnvironment` from `dist/kernel/git-environment.js` and `directories` from `dist/kernel/xdg.js` ([L4 Runner](L4-agent-evaluation.md#runner)). `pnpm run verify` runs `build` before `test`, so the unit tests read the same build. `evaluation.test.mjs` fails at once when `dist/` is absent.
- Unit-level rule 15 uses an `oauth` entry that expires far in the future, so `getAuth` sends no request.

## Credential statement

Each credential rule of [L4 Credential](L4-agent-evaluation.md#credential) is new. No rule of today covers the runner. Each rule below holds at its L4 strength from the PR that first needs it, and no later PR changes it.

- **Price read with no credential file** (L4-D18). PR 1. `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`. `ModelRuntime` is an export of `@earendil-works/pi-coding-agent` (`dist/index.d.ts:15`), and `InMemoryCredentialStore` is an export of `@earendil-works/pi-ai` (`dist/index.d.ts:16`, `dist/auth/credential-store.d.ts`). Unit-level rule 16 proves that the read creates no entry in `<home>/.config/kanthord`.
- **OAuth refresh** (L4-D17). PR 1, before each `run agent` call; PR 2 adds the diagnosis call, with the provider of `judge_model` and the wall budget `15m`. `ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })` and `getAuth(provider, { minOAuthValidityMs })` (`dist/core/model-runtime.d.ts:56,89`). `authPath` comes from `os.userInfo().homedir`. A thrown error or an `undefined` result stops the evaluation with no error text of pi. Unit-level rule 15.
- **No proxy.** PR 1. The start checks refuse `NODE_USE_ENV_PROXY`, and `--use-env-proxy` in `NODE_OPTIONS` and in `process.execArgv`, before the refresh ([LA5-D9](#decisions)). `evaluation.mjs` sets no global dispatcher. Unit-level rule 13.
- **No core dump.** PR 1. `run.sh` runs `ulimit -c 0` before it starts Node. The review of `run.sh` checks the line ([L4 Rules with no check](L4-agent-evaluation.md#rules-with-no-check-and-the-reason)).
- **Credential state of `auth.json`.** PR 1. The SHA-256 digest and the mode `0600` after the refresh and after each `run agent` call, and no new entry in `<home>/.config/kanthord` since the start of the call ([LA5-D9](#decisions)). A change is the breach `auth_file`. Unit-level rule 14, L4-AC5 variant 2.
- **Credential counts.** PR 1 for the session file, `diff.patch` and `check.txt`; PR 2 for the diagnosis session file and for each file of `j` before the diagnosis call ([LA5-D14](#decisions)). stdout holds only the count. A count other than `0` is the breach `credential`, and the runner removes `diff.patch` and `check.txt`. Unit-level rule 5, L4-AC5 variants 2 and 4.
- **Clones with no remote and no reflog** (L4-D19). PR 1. The four clone steps, and the copy of `.git/config` in memory ([LA5-D8](#decisions)). L4-AC5 variant 3 proves that a session sees no path of E.
- **Isolated git environment.** PR 1. Each `git` command of the runner, on a case clone, on E and on the engine checkout, runs with `isolatedGitEnvironment`. The diff steps restore `.git/config`, remove `.git/info/attributes` and use `--no-renames --no-ext-diff --no-textconv --no-color`. Unit-level rule 20.
- **Grading root.** PR 1. The runner makes the grading root after the `run agent` call ends, with a new name of 16 random lowercase letters. So the session cannot name it. L4-AC1 proves that no root remains.
- **No credential in a record.** PR 1 and PR 2. No line of `results.jsonl`, `checks.jsonl`, `diagnoses.jsonl` or `calls.jsonl`, no `iteration.json`, no file of `j` and no report holds a credential value. The report holds no session text, no `check.txt` text and no finding evidence. L4-AC5 variant 2 asserts it over each record.
- **The `auth.json` file of the job.** The checks write K into the home of the test user `kanthord-e2e`, never into the home of the job user or of a developer ([LA5-D1](#decisions)).

## Handoffs

### To the evaluation set build

- The set author uses `validate` and `scan` of PR 5. The first set commit comes after PR 5 merges ([LA Evaluation set build](LA-agent-build.md#evaluation-set-build)).
- `judge.md` and `judge-task.md` ship in PR 2. Iterations do not change them ([L4 Diagnosis](L4-agent-evaluation.md#diagnosis), rule 7).

### To the agent gate

- Gate step 4.1 reads the job `agent-e2e` of the scheduled CI run of `main` after PR 5, with each check L4-AC1 to L4-AC10 by id ([LA Agent gate](LA-agent-build.md#agent-gate)).
- Gate step 4.3 runs `run.sh` and `report.sh` from the engine checkout after `pnpm run build`.

## Build details

### PR 1 build

Branch: `feature/agent-v2-la5-held-out`.

1. **Imports.** `evaluation.mjs` imports `isolatedGitEnvironment` and `directories` from `dist/` ([LA5-D7](#decisions)).
2. **Run steps.** `evaluateRun` does the steps 1 to 7 and 9 of one run. It takes the refresh and the `run agent` call as functions. The unit tests pass a function that writes the session file, the result line and the workspace change.
3. **Start checks.** `startRun` returns the refusal text or the plan of the call. It writes `iteration.json` and the call line only after each check passes ([LA5-D10](#decisions)).
4. **Run directory.** Each run uses the run directory `<case-id>/<repeat>-1`. PR 4 adds the next free attempt number.
5. **Report.** `buildReport` gives the text and the verdict. `run.sh` writes the report with no key check. `report.sh` checks the keys first and writes no report at a refusal.
6. **Check result.** The result of each mode is the exit code of its `check.sh` call. The runner never reads a result from `check.txt` ([LA5-D11](#decisions)).
7. **L4-AC4.** Only the job `agent-e2e` runs the check. A machine of a developer has no network namespace and no test user.

### PR 2 build

Branch: `feature/agent-v2-la5-diagnosis`.

1. **Guarded call.** `guardedAgentCall` makes each `run agent` call, for the run of `swe@1` and for the diagnosis run. It does the refresh, the credential state after the refresh, the read of the credential values, the count in the input files of the call, the call, the count in the session file, the credential state after the call and the run action ([LA5-D14](#decisions)).
2. **Grading root.** `evaluateInRoots` makes the grading root after the `run agent` call ends, also when the diff steps fail. `g` and `j` lie in it.
3. **Judge workspace.** `writeJudgeWorkspace` writes `transcript.md`, `diff.patch` and `check.txt` when the run directory holds them, `check.json`, `task.md` and, in stage 2, the kind prompt as `<kind>.md`. The input files of the diagnosis call are the files of `j`.
4. **Transcript.** Each `message` entry of the session file gives one section: the line `## <entry id>`, the line `Role: <role>` and the text ([LA5-D15](#decisions)). Each other entry gives no section.
5. **Parse.** `parseDiagnosis` reads the whole `text` of the `re@1` result line as one JSON object ([LA5-D16](#decisions)).
6. **Attempt number.** The attempt number of a diagnosis is the first `n` with no `judge-<n>.jsonl` and no `judge-<n>-stderr.txt` in the run directory.
7. **Cap.** `runDiagnosis` applies the start gate with the reserve `judge_usd` before it makes `j`. `baseCostSum` divides a `re@1` line by the `r` of `judge_model` and each other line by the `r` of `model`.
8. **Report.** `buildReport` reads the last check line of each run and the diagnosis of each run ([LA5-D17](#decisions)). The dev block holds one line for each case, the set-difficulty line and the line `verdict complete` or `verdict no verdict`.
9. **Stub.** A responder returns its turn with `selectedRole` and `selectedTask`. The stub writes a key into the request record only when the responder gives it, so a record of a test with no selection keeps its two keys.
10. **L4-AC3.** The test runs `e1` and then `e3` in one fixture. It reads only the requests that the stub got after `e1`.
11. **L4-AC9.** The test compares each check line with the fixed values of L4-AC1: `d1` passes each aspect, and `d2` fails A1 only.

### PR 3 build

Branch: `feature/agent-v2-la5-breach`.

1. **Search input.** `hasProtectedPath(sessionText, pathStrings)` searches the text of the session file and each string of each JSON line of that file ([LA5-D19](#decisions)).
2. **Search strings.** `protectedPathStrings` gives the path of the set, of the results directory and of the case folder, and the three path parts. The file names and the prefix `judge-` are constants of `evaluation.mjs`.
3. **One call function.** `guardedAgentCall` applies rules 1 to 4 in the L4 order after each `run agent` call. The call object holds `protectedPathSearch`: `true` for the `swe@1` call and `false` for the diagnosis call ([LA5-D20](#decisions)).
4. **Set change.** `checkSetChangeBreach(evalSetDir, setCommit)` reads the HEAD and the status of the set ([LA5-D21](#decisions)). The run object holds `setCommit` of the plan.
5. **Stub variables.** `LlmStubOptions` has the optional `variables`: a map of a placeholder to its text. The stub replaces each placeholder in a text turn and in each string argument of a tool call. A test with no `variables` gets the same turns as before.
6. **Late fixture path.** The test passes one object as `variables` and sets the fixture path after `buildEvaluationSet` returns. The stub reads the object for each request.
7. **`answeredTurns`.** `L4ResponderChange` has the optional `answeredTurns`: the `swe@1` turn after the first tool result, for each task. L4-AC5 variant 2 uses it for the answer text with K.
8. **L4-AC5 turns.** `READ_CHECK_TURN`, `GIT_INSPECT_TURN`, `COPY_AUTH_TURN` and `TOUCH_SET_TURN` of `e2e-evaluation-test-support.ts` are the tool call turns of variants 1, 3, 4 and 5.
9. **L4-AC5 asserts.** Variant 2 compares the SHA-256 digest and the mode of `auth.json` before and after `run.sh`. Variant 3 asserts 4 check lines and 4 session files. Each variant reads each file as the test user ([LA5-D13](#decisions)).

### PR 4 build

Branch: `feature/agent-v2-la5-resume`.

1. **Run action.** Exit `75` gives the restart. `cli.run.agent.prompt_text_path` in stderr gives the stop, also with exit `75` ([LA5-D24](#decisions)).
2. **Attempt directory.** The run directory is `<case-id>/<repeat>-<n>`. `nextRunAttempt` gives `n` ([LA5-D22](#decisions)).
3. **Restart.** A restart of a `swe@1` run makes a new workspace root and a new run directory. A restart of a diagnosis keeps `j` and takes the next `judge-<n>` number. The grading and the diagnosis use the run directory of the last attempt.
4. **Start gate.** `startGateOpen` applies the start gate before each attempt, with the `usd` of the case or with `judge_usd` ([LA5-D24](#decisions)).
5. **Resume.** `pendingRuns` reads `checks.jsonl` and `diagnoses.jsonl` with the two functions of the report, `lastCheckLines` and `diagnosisOf` ([LA5-D23](#decisions)).
6. **Missing session file.** The protected-path search reads a missing session file as an empty text ([LA5-D25](#decisions)).
7. **Report.** `runPlan` writes the report at each end of a call that passes its start checks: the complete end, a stop, a breach and the cap. A start refusal writes no report.
8. **L4-AC6, variant 1.** The test uses two stubs. The first stub answers HTTP 429 to each request. After the first pair, the test writes `auth.json` again with the URL of the second stub.
9. **L4-AC6, variant 3, and L4-AC7.** The test commits its change of E as the test user before the call. So E has no uncommitted change, as the [L4 fixtures](L4-agent-evaluation.md#l4-fixtures) state.
10. **L4-AC6, variant 2.** The test writes an `auth.json` file with no entry.

### PR 5 build

Branch: `feature/agent-v2-la5-iteration`.

1. **Pair read.** `readPair` of `report.sh` reads `iteration.json`, `results.jsonl`, `checks.jsonl` and `diagnoses.jsonl` of the parent, or of the first baseline of an A/A pair. `run.sh` reads no pair, so its report holds no iteration line and no A/A line.
2. **Pair checks.** `pairError` runs `comparabilityError`, then `reDigestError`, then, for an iteration, `oneChangeError` ([LA5-D26](#decisions)). `oneChangeError` runs `git diff --name-only` on the engine checkout and accepts two equal commits.
3. **Good count.** `goodOnRunNoise` reads the check line for A1 to A4 and the diagnosis for A5 to A7. An invalid diagnosis is good in the parent and not good in the new evaluation.
4. **Noise rule.** `iterationCounts` gives the six numbers of the iteration line. `noiseRuleVerdict` gives the verdict in the order of [LA5-D26](#decisions).
5. **Report.** The head of an iteration report holds the lines `parent`, `target aspect` and `hypothesis`. The section `## Iteration` holds the iteration line and the line `diff` with good(new, a) − good(parent, a) for A1 to A7. The section `## A/A` holds the A/A line. Both sections come before the cost block. The dev block of an iteration report holds no verdict line.
6. **Gate line.** `lastPassedStageOneShares` reads the held-out evaluations of stage 1, the newest first, and gives the shares of the first gate that passes. The gate line of stage 2 holds `stage 1 pass share <kind> <share>` for each kind, before the verdict.
7. **`scan`.** `scanCommand` reads the listed files, or the staged content with no file ([LA5-D27](#decisions)).
8. **`validate`.** `validateCaseFolder` runs rules 6 and 7 on one clone and rule 8 with `gradeRun` ([LA5-D28](#decisions)).
9. **Refused report.** `reportEvaluation` removes `report.md` at a refusal of a key check or of a pair check ([LA5-D29](#decisions)).
10. **L4-AC8.** The two evaluations run on one engine commit, so the comparability check refuses the equal `system_prompt_digest`. `report.sh` exits `1`, stderr names `system_prompt_digest`, and the results directory of `e8b` holds no `report.md`.
11. **L4-AC10.** `e10b` replicates `e10`. `report.sh` exits `0`. `report.md` holds the A/A line with `A1 2 2 diff 0 flips 0` and `passes 2 2 diff 0`.

## Decisions

1. **LA5-D1.** The L4 checks run only in the Linux job `agent-e2e`, in `src/apps/cli/e2e-evaluation.linux-test.ts`, as the test user `kanthord-e2e`. Constraint: no L4 check writes into the home of the user that starts the tests.
2. **LA5-D2.** `evaluation.mjs` owns each unit-level rule of L4 in one module, as L4-D15 states. Constraint: the tests of the twenty rules live in `evaluation.test.mjs`; `pnpm test` runs it.
3. **LA5-D3.** The runner calls `process.execPath` with `bin/kanthord.mjs` of the checkout that holds the runner. Constraint: the runner and the CLI come from one engine commit, the `engine_commit` of `iteration.json`; the operator runs `pnpm run build` first.
4. **LA5-D4.** `evaluation.mjs` imports `findPatternText`, `isolatedGitEnvironment` and `directories` from `dist/`. Constraint: the runner adds no second copy of the secret patterns, the git isolation or the XDG rule; `evaluation.test.mjs` fails at once when `dist/` is absent.
5. **LA5-D5.** LA5 has 5 PRs in this order: the held-out evaluation with the credential rules, the diagnosis, the breach rules, stop and resume with the cap, the iteration with the set tools. Constraint: PR 1 holds each credential rule of a `swe@1` run; PR 1 refuses `--set dev` until PR 2.
6. **LA5-D6.** The job `agent-e2e` makes the test user the owner of the checkout root and of its `.git` directory, with no recursion, and gives the job user an access entry with write. Constraint: the runner keeps `isolatedGitEnvironment` on the engine checkout, with no `safe.directory` entry; Git accepts the engine checkout for the test user.
7. **LA5-D7.** PR 1 imports `isolatedGitEnvironment` and `directories`. PR 5 adds the import of `findPatternText` with the subcommand `scan`. Constraint: the credential count of PR 1 searches the exact values of the `auth.json` entries and holds no secret pattern.
8. **LA5-D8.** The runner holds the copy of `.git/config` in memory, and replaces the entry at `.git/config` before the restore. Constraint: no file of the workspace root holds the copy, because the session can write each file of that root; the restore never writes through a symbolic link.
9. **LA5-D9.** The credential rules of the runner are these. Constraint: the runner refuses `--use-env-proxy` in `process.execArgv` also, as `run agent` does; after each refresh the mode is `0600` and the configuration directory holds the entries of the call start, and only the digest can differ; the digest, the mode and the entries after the `run agent` call equal the state after the refresh; the runner reads the credential values again after each refresh and counts each value that it read in the call; the breach `credential` comes before the breach `auth_file`.
10. **LA5-D10.** The start checks run in this order: the proxy settings, the options, the engine tree, the configuration with the base price, the set commit, each `case.json` of the set, the options of `iteration.json`, the fixed `gate_share`, and the `auth.json` file. Constraint: a call with a case that breaks the schema, or with no regular `auth.json` file, starts no run and writes no call line; the base model has an `input`, an `output` and a `cacheRead` price above 0; `usd` and `judge_usd` have at most 2 fraction digits.
11. **LA5-D11.** The grading is strict where the diff or the check output comes from the session. Constraint: A3 fails a `diff --git` header that does not have the form `a/<path> b/<path>` with one path, so no path of `allowed` holds a character that Git quotes; `allowed` globs match with `path.matchesGlob` of Node; the copy of the hidden tests replaces each path part that is no directory, also a symbolic link; a failed copy fails A1 and A2; the frontend rule for a CSS file reads the `new file mode` line; a class helper gives only its string arguments with no `${`.
12. **LA5-D12.** The gate line holds the pass share of each kind that has a planned run. An earlier held-out evaluation is a held-out evaluation of the same stage whose `iteration.json` is older. Constraint: a set with no case of a kind gives no share for that kind; PR 5 adds the pass shares of the last passed stage 1 gate to the gate line of stage 2.
13. **LA5-D13.** The L4 fixtures of the checks lie under `/home/kanthord-e2e/l4-<time>/`, and the test reads each file as the test user. Constraint: no L4 path lies in the temporary directory of the job user, because the test user cannot enter it; each check removes its folder and `/home/kanthord-e2e/.config` at its end.
14. **LA5-D14.** One function of the runner makes each `run agent` call, for `swe@1` and for `re@1`. Constraint: the diagnosis run has each credential rule of LA5-D9 from the same code; after the refresh of the diagnosis run, the runner counts each credential value in each file of `j`, and a count other than `0` is the breach `credential` before the call; a breach of a diagnosis run appends a check line with the breach for its run, and the report reads the last check line of each case and repeat.
15. **LA5-D15.** The text of an assistant entry in `transcript.md` holds each tool call as one line with the tool name and the arguments as JSON. Constraint: the judge reads the commands of the session for A5 and A9; a thinking part and an image part give no text; only a tool result is cut to 4,000 characters.
16. **LA5-D16.** A diagnosis is valid only when the whole `text` of the `re@1` result line parses as one JSON object of [L4 Diagnosis](L4-agent-evaluation.md#diagnosis), rule 5. Constraint: a sentence, a code fence or a second object around the object gives `valid` `false`; `judge.md` states this form; an evidence text can quote a brace.
17. **LA5-D17.** The dev report counts by run. Constraint: the diagnosis of a run is the last line of `diagnoses.jsonl` whose `session` lies in the run directory; the findings of a valid diagnosis count for each aspect A1 to A9 and each severity, and the report holds no evidence; a ceiling case and a floor case have a check line for each planned run; the verdict `complete` needs a check line and a diagnosis for each planned run.
18. **LA5-D18.** `checkResultKeys` checks `system_prompt_digest` per kind, not across all `swe@1` lines. Constraint: stage 2 gives each kind a different binding prompt, so lines of two kinds have two digests by design; the check still refuses two digests within one kind; `checkResultKeys` takes a `kindOf` map of case id to kind; the caller at `report.sh` builds it from `cases.cases`; with no map, all lines fall in one group and the check holds as before.
19. **LA5-D19.** The protected-path search reads the text of the session file and each string of each JSON line. Constraint: a file name matches at each place of a text, not only at the first; a whitespace character that a JSON line escapes is a boundary; a quote is `"`, `'` or a backtick; a whitespace character is each character that `String.prototype.trim` removes; the search refuses no less than [L4 Breach rules](L4-agent-evaluation.md#breach-rules).
20. **LA5-D20.** Breach rules 1, 2 and 4 apply to the diagnosis run. Rule 3 does not apply to it. Constraint: the judge reads `transcript.md`, `check.txt` and `check.json` and quotes the names of the run files, so the search matches each honest diagnosis; a `set_change` of a diagnosis run appends a check line with the breach for its run ([LA5-D14](#decisions)).
21. **LA5-D21.** The breach `set_change` holds when a Git command on the set fails, when the HEAD of the set differs from `set_commit`, or when the tree of the set differs from the tree of `set_commit`. The comparison uses `git ls-tree -r -z <set_commit>` and walks the set directory; it uses no git index and no exclude rule. Constraint: the walk skips `.git/` at root, `config.json` at root and `shared/*/node_modules/`; each regular file is hashed in a batch with `git hash-object --no-filters --stdin-paths`; each symlink target string is hashed with `git hash-object --stdin`; the mode of a regular file is `100755` when the executable bit (`0o100`) is set and `100644` otherwise; the mode of a symlink is `120000`; an extra, missing, mode-different or blob-different entry is `set_change`; a walk error or a git failure is `set_change` (fail-closed); the manifest check (`checkManifestDiff`) runs after the tree check and reports `set_change` for a `shared/` tree that differs from `shared.sha256`. Before PR 8: the status ran with `--no-optional-locks` and `--untracked-files=all`, so a pattern in `.git/info/exclude` or `git update-index --assume-unchanged` / `--skip-worktree` could hide a change.
22. **LA5-D22.** The attempt number of a run is the first `n` from `1` with no directory `<results directory>/<case-id>/<repeat>-<n>`. Constraint: a resumed run and a restart at exit `75` take a new run directory; the runner writes no file into the run directory of an earlier attempt; an attempt that stops before its `run agent` call makes no run directory and uses no number.
23. **LA5-D23.** The resume reads the records as the report does ([LA5-D17](#decisions)). A run is done when its case and repeat have a line in `checks.jsonl`, also a line with a breach. A dev run with a check line and no diagnosis gets only its diagnosis. Constraint: a run directory with no check line is not done; the resumed diagnosis uses the run directory of the last check line, passes the start gate with the reserve `judge_usd` and has each credential rule of [LA5-D14](#decisions); it reserves no `usd` of the case; a resume appends no check line with `breach` `null` for a run that has a breach line, so the breach stays in the report.
24. **LA5-D24.** Each `swe@1` run and each diagnosis run counts its own exits `75` in one call of `run.sh`. The third exit `75` stops the evaluation with exit `1` and no new check line. Constraint: each attempt makes its own refresh and its own credential state; each breach rule runs on each attempt before the run action; `cli.run.agent.prompt_text_path` in stderr stops the evaluation also at exit `75`; each attempt passes the start gate with the reserve of its run, and the sum holds the cost of each earlier attempt; a new call of `run.sh` counts from 0.
25. **LA5-D25.** A `run agent` call that ends before it makes its session file has no protected-path match and the credential count `0`. Constraint: the exit of that call decides the run action, so the evaluation stops and writes the report; the breach rules `auth_file` and `set_change` still run on that call.
26. **LA5-D26.** The pair checks and the noise rule of `report.sh` follow [L4 Iteration](L4-agent-evaluation.md#iteration) with these readings. Constraint: the comparability check compares the stage, `set_commit` and, for each case, each common key of L2 over each `swe@1` line of the two evaluations; an iteration and its parent share no `system_prompt_digest` in a case; the two evaluations of an A/A pair have one `system_prompt_digest` in each case; each `re@1` line of the two evaluations has one `system_prompt_digest`; noise(a) is max(2, flips(parent, a)), and noise is max(2, flips(parent)); the verdict order is a breach in the new evaluation (`revert`), then a planned run or a planned diagnosis with no line in one of the two evaluations (`no verdict`), then a target A5 to A7 with `re@1` lines that differ in `provider`, `model` or `reasoning_effort` (`no verdict`), then `keep` when the gain is at least noise(target) and the pass loss is less than noise, else `revert`; the A/A line counts an invalid diagnosis as not good in both evaluations; the verdict and the exit of `report.sh` for an iteration come from the iteration verdict.
27. **LA5-D27.** `scan <file>...` reads each listed file. `scan` with no file reads the staged content of each added, copied or changed file, from the index of the repository of the current directory. Constraint: the pre-commit hook of the set is the line `exec node <engine>/scripts/evaluation/agent/evaluation.mjs scan`; the staged read runs `git diff --cached --raw -z --no-renames --diff-filter=ACM` and `git cat-file blob` with `isolatedGitEnvironment` and the `GIT_INDEX_FILE` of the hook, so `git commit -a` and `git commit <path>` scan the content of the commit; a staged deletion and a submodule entry get no read; each output line is `<file>:<line>:<rule>` on stdout and holds no part of the matched value; the exit is `1` at a match, at a file with no read, at a text above the scan limit of the engine and at a Git failure, else `0`; `scan` is the only caller of `findPatternText` in the runner, and the runner holds no second copy of the secret patterns; the scan reads the bytes of `repo.bundle` and not the files of its commits.
28. **LA5-D28.** `validate <case folder>` checks content rules 6, 7 and 8 of L4 in temporary clones and stops at the first failure. Constraint: the case folder lies at `cases/<set>/<case-id>/` of a set, and the kind prompt is `binding/<kind>.md` of that set; the command refuses a case with no `repo.bundle`, `setup.sh`, `task.md`, `check/check.sh`, `check/tests`, `check/reference.patch` or kind prompt; rule 6 reads `task.md`, the kind prompt, each path of a clone after `setup.sh` with a leading `/`, and the target of each symbolic link of that clone; the protected strings are the path of the set, the path of the case folder, the three path parts and the file names of the protected-path search; rule 7 runs on the same clone after the copy of `check/tests/`: `fail_to_pass` exits other than `0`, then `pass_to_pass` and `conventions` exit `0`; rule 8 checks the scope rules, then runs the grading of a run (`gradeRun`) three times in sequence, each in a new clone, and A1 to A4 pass each time, the frontend rules included; each clone uses the clone steps and `isolatedGitEnvironment`; the temporary root lies in the temporary directory of the OS with mode `0700`, and the `finally` block removes it; the command writes no file into the case folder or the set; stderr holds one line `evaluation: validate: <rule>: <reason>` with no output of `setup.sh` or `check.sh`; the exit is `0` when each rule passes, else `1`.
29. **LA5-D29.** A refused `report.sh` call leaves no `report.md`. Constraint: `run.sh` writes its report with no key check, so `report.sh` removes that `report.md` when a key check or a pair check refuses the evaluation; a refusal before the key checks (no `iteration.json`, a configuration refusal, a case that breaks the schema) removes no file.
30. **LA5-D30.** [L4 Manifest of the shared folder](L4-agent-evaluation.md#manifest-of-the-shared-folder) holds the manifest contract. Constraint: `writeManifest` and `checkManifestDiff` read the tree with one function, `scanShared`, so the writer and the comparison refuse the same entries; `checkManifestDiff` returns the first path that differs or null, returns `shared.sha256` for an invalid manifest, and throws no error; each set has a manifest, and a set with no `shared/` folder has an empty one; a directory has a `D` line, so an added or removed empty directory is a difference; the link rule refuses `..` after another segment, because a link in the path can move such a target out of the folder; a file open uses `O_NOFOLLOW` and `O_NONBLOCK` and a check of the open handle, so a file that becomes a link or a FIFO after the listing cannot block or redirect the read; the writer renames `shared.sha256.tmp`, so no reader sees a part of a manifest; `scan` has no exemption and reads `shared.sha256` as each other committed file; the comparison does not check the mode of `shared.sha256`, as for each other file of the set; the comparison runs after each agent call, so it reads each file as a stream with at most 64 open files.

32. **LA5-D32.** Each agent call runs under an OS rule that denies file read and file write under the real path of the evaluation set. On macOS, `osDenyWrapper` uses `sandbox-exec -p '(version 1)(allow default)(deny file-read* file-write* (subpath "<set realpath>"))' <node> <bin> ...`. On Linux, it uses `bwrap --dev-bind / / --tmpfs <set realpath> --die-with-parent <node> <bin> ...`. Constraint: `runPlan` calls `osDenyWrapper(realpathSync(evalSetDir))` before the first agent call; when the wrapper is null (no mechanism) or the probe fails, `runPlan` writes a reason to stderr and returns exit `1`; the probe runs `node -e '<script>'` under the same rule, checks that reading a set file fails and that reading `/dev/null` succeeds; `runAgentProcess` copies each `--prompt` and `--system-prompt` file argument to a temp directory before the wrapped call, so the agent reads those files from outside the denied path; the temp directory is removed in a `finally` block; `deps.makeWrapper` overrides `osDenyWrapper` in tests; the `fakeAgent` default wrapper has a no-op `run` and a probe that always passes.

31. **LA5-D31.** Each case script runs in its own process group, and the runner kills the group after each call ([L4 Grading](L4-agent-evaluation.md#grading), time limit bullet). Constraint: `runCaseScript` owns the `spawnSync` call and the group kill, and the runner stays synchronous; `detached: true` starts the script as the leader of a new group; with `timeout: limitMs` and `killSignal: "SIGKILL"`, Node kills the group leader at the limit; `process.kill(-pid, "SIGKILL")` kills the remaining members after each call, so a background process of `check.sh` or `setup.sh` does not survive; the group kill ignores `ESRCH` and `EPERM` and throws each other error; macOS returns `EPERM` for a group that holds only ended processes that wait for their parent; a process that leaves the group, for example with `setsid`, survives; the output of `check.sh` goes to the file `check.txt.<mode>.tmp` with mode `0600` in the run folder, and the output of `setup.sh` goes to `/dev/null`, so a background process that holds the output does not block `spawnSync`; the runner copies at most the first 64 MiB of that file into `check.txt` and removes the file in a `finally` block; a `check.sh` timeout writes `exit timeout` for the mode in `check.txt` and fails the mode; a `setup.sh` timeout returns false, and the existing stop path uses the existing exit code; the limit is the constant `SCRIPT_LIMIT_MS`; a test gives a small limit through `plan.limitMs`, which `planRun` copies to `run.limitMs` and `gradeDiff` copies to `grade.limitMs`; `validatedBaseError` and `validatedReferenceError` take an options object with `root` and `limitMs`; `validateCaseFolder` is exported and accepts a `limitMs` argument, so the test of unit-level rule 22 runs the validate path with a small limit.
