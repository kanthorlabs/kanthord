# LA5. The evaluation runner

Status: `draft`. Base: engine `c864130e`. Parent: [LA](LA-agent-build.md#sub-layers).

## Goal

LA5 adds the runner of [L4](L4-agent-evaluation.md#runner) to the engine: `run.sh`, `report.sh`, `evaluation.mjs`, `judge.md` and `judge-task.md` in `scripts/evaluation/agent/`. The runner runs `swe@1` through the built `kanthord run agent` on each case of a set, grades each diff in a new clone with the hidden tests, runs the `re@1` diagnosis on the dev set, applies the breach rules, and writes the report with the iteration verdict, the A/A line or the gate verdict. LA5 ends when the ten checks [L4-AC1 to L4-AC10](L4-agent-evaluation.md#checks) pass in the CI job `agent-e2e`, and the unit-level rules 1 to 20 of [L4](L4-agent-evaluation.md#unit-level-rules) pass in `pnpm run verify`.

### Entry state

- LA1 to LA4 are done. `kanthord run agent` applies each rule of L2 and L3: the `--auth` file checks, the pi directory checks, R, the ambient removal, the proxy refusal, the start preconditions, the wall and cost budgets, the classes `terminal` and `retryable`, the exits `0`, `1`, `2`, `4`, `5` and `75`, and the signal handler.
- `worker tasks run`, `tasks seed` and `tasks compare` are deleted ([LA4](LA-agent-build.md#sub-layers)). So the runner of the Worker V2 evaluation set has no command to call.
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

- Files: `evaluation.mjs`, `evaluation.test.mjs`, `judge.md`, `judge-task.md`, `e2e-evaluation.linux-test.ts`.
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
- `evaluation.mjs` builds `--parent`, `--aspect`, `--hypothesis` and `--replicate`; the comparability check and the one-change check of [L4 Iteration](L4-agent-evaluation.md#iteration), rules 1 and 4; the parent `re@1` digest check; the noise rule; the iteration line; the A/A line; the subcommands `scan` and `validate`.
- Makes pass: L4 unit-level rules 7, 17 and 18; rule 11 in full; the rules of `--parent`, `--aspect`, `--hypothesis` and `--replicate` of rule 13.
- Makes pass: [L4-AC8 and L4-AC10](L4-agent-evaluation.md#checks).
- Verify: as PR 1.
- `main` works: an evaluation with no parent and no replicate runs as in PR 4.

## End-to-end checks

(LA5 ends when these pass)

### Harness

- **Place.** The checks live in `src/apps/cli/e2e-evaluation.linux-test.ts`. Only `test:agent-e2e` runs them, in the job `agent-e2e` ([LA2-D2](LA2-credential-boundary.md#decisions)). Each check writes and reads the `auth.json` file at the default `--auth` path. `run agent` and the refresh take that path from the home that the user database gives. On the machine of a developer, that path holds the real credential.
- **Process.** The test starts `scripts/evaluation/agent/run.sh` and `report.sh` as the test user, with `sudo -n -u kanthord-e2e` and an explicit environment: `PATH`, `XDG_DATA_HOME="$XD"` and `XDG_STATE_HOME="$XS"`. The runner calls the built CLI `bin/kanthord.mjs` of the same checkout ([LA5-D3](#decisions)). The job runs `pnpm run build` before the tests.
- **Stub.** The stub of LA1 with the responder of the [L4 fixtures](L4-agent-evaluation.md#l4-fixtures): the Role heading of `swe@1` or `re@1` in the system prompt, and the text `task d1`, `task d2` or `task h1` in the user message, select the scripted turns. Each turn reports a `usage` of 1000 input and 100 output tokens. The stub records each request with the selected role and task.
- **Set.** `src/apps/cli/e2e-evaluation-test-support.ts` builds E, `config.json`, the binding prompts and the cases `d1`, `d2` and `h1` of the L4 fixtures. It runs each command as the test user, so E, `$XD` and `$XS` belong to that user. It makes `repo.bundle` with `git bundle create` of C only, with the author of [L4 content rule 2](L4-agent-evaluation.md#content-rules).
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
- **OAuth refresh** (L4-D17). PR 1, before each `run agent` call; PR 2 adds the diagnosis call. `ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })` and `getAuth(provider, { minOAuthValidityMs })` (`dist/core/model-runtime.d.ts:56,89`). `authPath` comes from `os.userInfo().homedir`. A thrown error or an `undefined` result stops the evaluation with no error text of pi. Unit-level rule 15.
- **No proxy.** PR 1. The start checks refuse `NODE_USE_ENV_PROXY` and `--use-env-proxy` in `NODE_OPTIONS`, before the refresh. `evaluation.mjs` sets no global dispatcher. Unit-level rule 13.
- **No core dump.** PR 1. `run.sh` runs `ulimit -c 0` before it starts Node. The review of `run.sh` checks the line ([L4 Rules with no check](L4-agent-evaluation.md#rules-with-no-check-and-the-reason)).
- **Credential state of `auth.json`.** PR 1. The SHA-256 digest and the mode `0600` after the refresh and after each `run agent` call, and no new entry in `<home>/.config/kanthord`. A change is the breach `auth_file`. Unit-level rule 14, L4-AC5 variant 2.
- **Credential counts.** PR 1 for the session file, `diff.patch` and `check.txt`; PR 2 for the diagnosis session file and before the copy into `j`. stdout holds only the count. A count other than `0` is the breach `credential`, and the runner removes `diff.patch` and `check.txt`. Unit-level rule 5, L4-AC5 variants 2 and 4.
- **Clones with no remote and no reflog** (L4-D19). PR 1. The four clone steps, and the copy of `.git/config` outside the clone. L4-AC5 variant 3 proves that a session sees no path of E.
- **Isolated git environment.** PR 1. Each `git` command of the runner, on a case clone, on E and on the engine checkout, runs with `isolatedGitEnvironment`. The diff steps restore `.git/config`, remove `.git/info/attributes` and use `--no-renames --no-ext-diff --no-textconv --no-color`. Unit-level rule 20.
- **Grading root.** PR 1. The runner makes the grading root after the `run agent` call ends, with a new name of 16 random lowercase letters. So the session cannot name it. L4-AC1 proves that no root remains.
- **No credential in a record.** PR 1 and PR 2. No line of `results.jsonl`, `checks.jsonl`, `diagnoses.jsonl` or `calls.jsonl`, no `iteration.json`, no file of `j` and no report holds a credential value. The report holds no session text, no `check.txt` text and no finding evidence. L4-AC5 variant 2 asserts it over each record.
- **The `auth.json` file of the job.** The checks write K into the home of the test user `kanthord-e2e`, never into the home of the job user or of a developer ([LA5-D1](#decisions)).

## Handoffs

### To the evaluation set build

- The set author uses `validate` and `scan` of PR 5. The set build starts after PR 5 merges ([LA Evaluation set build](LA-agent-build.md#evaluation-set-build)).
- `judge.md` and `judge-task.md` ship in PR 2. Iterations do not change them ([L4 Diagnosis](L4-agent-evaluation.md#diagnosis), rule 7).

### To the agent gate

- Gate step 4.1 reads the job `agent-e2e` of the scheduled CI run of `main` after PR 5, with each check L4-AC1 to L4-AC10 by id ([LA Agent gate](LA-agent-build.md#agent-gate)).
- Gate step 4.3 runs `run.sh` and `report.sh` from the engine checkout after `pnpm run build`.

## Decisions

1. **LA5-D1.** The L4 checks run only in the Linux job `agent-e2e`, in `src/apps/cli/e2e-evaluation.linux-test.ts`, as the test user `kanthord-e2e`. Constraint: no L4 check writes into the home of the user that starts the tests.
2. **LA5-D2.** `evaluation.mjs` owns each unit-level rule of L4 in one module, as L4-D15 states. Constraint: the tests of the twenty rules live in `evaluation.test.mjs`; `pnpm test` runs it.
3. **LA5-D3.** The runner calls `process.execPath` with `bin/kanthord.mjs` of the checkout that holds the runner. Constraint: the runner and the CLI come from one engine commit, the `engine_commit` of `iteration.json`; the operator runs `pnpm run build` first.
4. **LA5-D4.** `evaluation.mjs` imports `findPatternText`, `isolatedGitEnvironment` and `directories` from `dist/`. Constraint: the runner adds no second copy of the secret patterns, the git isolation or the XDG rule; `evaluation.test.mjs` fails at once when `dist/` is absent.
5. **LA5-D5.** LA5 has 5 PRs in this order: the held-out evaluation with the credential rules, the diagnosis, the breach rules, stop and resume with the cap, the iteration with the set tools. Constraint: PR 1 holds each credential rule of a `swe@1` run; PR 1 refuses `--set dev` until PR 2.
6. **LA5-D6.** The job `agent-e2e` makes the test user the owner of the checkout root and of its `.git` directory, with no recursion, and gives the job user an access entry with write. Constraint: the runner keeps `isolatedGitEnvironment` on the engine checkout, with no `safe.directory` entry; Git accepts the engine checkout for the test user.
