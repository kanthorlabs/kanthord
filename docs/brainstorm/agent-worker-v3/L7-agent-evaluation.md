# L7: The agent evaluation

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model, [L2](L2-agent-cli.md) is the agent CLI that this page uses and [L3](L3-agent.md) is the agent that it measures. Each KanthorD path starts at `engine/`. Each pi model fact comes from `@earendil-works/pi-ai` `1.1.0`, `dist/providers/data/<provider>.json`. The code of today is engine `c864130e`.

## Goals

1. **G1.** The evaluation gives each role profile `bee@1`, `fee@1` and `te@1` a verdict against `swe@1`: keep or leave ([L1-D16](L1-model.md#decisions), [L1-D20](L1-model.md#decisions)).
2. **G2.** The exit rule is fixed before the first run. The same results always give the same verdict.
3. **G3.** The eval model is a setting that calibration adjusts, so that the results separate the profiles.
4. **G4.** Scripted hidden checks decide pass or fail. No LLM decides a pass.
5. **G5.** The evaluation uses only `kanthord run agent` and the result file of L2. It adds no engine command and no server call.
6. **G6.** Each credential rule of L2 holds for each run. No credential value enters a case, a result, a check record or a report.
7. **G7.** Each public behavior of L7 is an end-to-end acceptance check or a unit-level rule with its owning module ([index](index.md#layer-files)).

## Evaluation of the direction

(G3, G4)

### R2. An eval model with low intelligence, Haiku (high) by default (fits, with a fit rule)

- **Direction.** Ulrich, 2026-11-22: "Evaluation is hard, we should use model that has low intelligent that allow us evaluation correctly. We need to define an evaluation set, use Haiku (high) to run it by default."
- **Verdict.** Fits. The model is the model that runs the agent under test, not a judge.
- **Evidence.** A strong model compensates for a weak prompt, so a ceiling hides the difference between two profiles. The profiles differ little: `bee@1` and `te@1` differ from `swe@1` only in the Role ([L3 Profile prompts](L3-agent.md#profile-prompts)). Haiku 5.5 at `medium` passed checks 3, 5 and 6 of each of the 11 Worker V2 seeds (`~/kanthord-evalset/worker-v2/baseline.md`), so a ceiling is a real risk.
- **Fit rule.**
  1. The eval model lies in the band where the results separate the profiles. [Calibration](#calibration) measures the band before the comparison.
  2. Scripted checks decide each pass. A weak model is no judge.
  3. A [confirming check](#confirming-check) on the production model repeats the comparison for each role profile that wins.

## Placement in the round

(G1, G5)

- L7 is a consumer of L2. It is no CLI layer and no core layer.
- Ulrich ruled on 2026-11-22: L7 is designed right after L3, before L6 part A.
- The evaluation runs at step 4.3 of the [agent gate](index.md#round-order), against the agent that L6 part A builds. Calibration runs first, because it needs a built `run agent` and a real credential.
- [L8](L8-worker-evaluation.md), the worker evaluation, owns the worker-level checks, the review cases and the successor of `~/kanthord-evalset/worker-v2/`.

## Models

(G3)

### Eval model

| Use               | `--model`                                      | Catalog entry                                          | Levels that pi accepts                  | List price per MTok (input, output)            | Entry in `auth.json`    |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------- |
| Default           | `anthropic/claude-haiku-5-5:high`              | `anthropic.json`, `chat:claude-haiku-5-5`              | `low`, `medium`, `high`, `xhigh`, `max` | 0.10, 0.50; above 100k input tokens 0.50, 2.50 | `anthropic`, `oauth`    |
| Second eval model | `openrouter/deepseek/deepseek-v4.1-flash:high` | `openrouter.json`, `chat:deepseek/deepseek-v4.1-flash` | `off`, `low`, `high`, `max`             | 0.30, 1.20                                     | `openrouter`, `api_key` |
| Later option      | `openai-codex/gpt-6-luna:max`                  | `openai-codex.json`, `chat:gpt-6-luna`                 | each of the seven levels                | 0.10, 0.50; above 272k input tokens 0.20, 0.75 | `openai-codex`, `oauth` |

- The catalog name of the second eval model is "DeepSeek: DeepSeek V4.1 Flash". It refuses `medium`, so `run agent` refuses `:medium` with `cli.run.agent.level_unsupported` ([L2 Model selection](L2-agent-cli.md#model-selection), rule 6).
- The evaluation uses no `~`-alias id, for example `openrouter/~deepseek/deepseek-flash-latest`. Reason: an alias moves to another model, so two runs of one id can use two models.
- One evaluation uses one eval model and one level for each comparison run. A change of the eval model or the level starts a new evaluation.

### Calibration

Calibration finds the level of the eval model before the comparison.

1. `swe@1` runs each of the 15 cases once on the eval model at its start level. The start level is `high`.
2. The pass share is the count of passed runs divided by the count of counted runs ([Pass rule](#pass-rule)).
3. **In the band.** A pass share from 30% to 80%, both included, fixes the level. The calibration runs then count as repeat 1 of `swe@1`, because the common keys of [L2-D15](L2-agent-cli.md#decisions) are equal.
4. **Above the band.** The level goes one step down, and calibration runs again.
5. **Below the band.** The level goes one step up, and calibration runs again.
6. The steps of the default eval model are `low`, `medium`, `high`, `xhigh` and `max`. The steps of the second eval model are `low`, `high` and `max`.
7. **No level in the band.** When the pass share is above the band at the lowest step or below it at the highest step, the evaluation gives no verdict. The case author then changes the cases, and the set gets a new version.
8. The runs of a calibration that does not fix the level count toward the cost cap, but not toward the comparison.

### Confirming check

Ulrich ruled on 2026-11-22: the production model is `anthropic/claude-sonnet-5-5:high`. The catalog entry is `anthropic.json`, `chat:claude-sonnet-5-5`, "Claude Sonnet 5.5", with each level from `low` to `max` and the list price 2 and 10 per MTok.

1. Each role profile R that passes rules 1 and 2 of the [Exit rule](#exit-rule) runs once on each case of its category on the production model. `swe@1` runs once on the same cases.
2. R passes the confirming check when it passes no fewer runs than `swe@1`.
3. The confirming check uses the task budget of each case ([Run budget](#run-budget), rule 1).

## Evaluation set

(G4, G6)

### Location

Ulrich ruled on 2026-11-22: the evaluation uses the KanthorD XDG directories. `directories(env)` of `src/kernel/xdg.ts` gives each directory, with the same rule as L2.

| Content                       | Path                                               | Mode   |
| ----------------------------- | -------------------------------------------------- | ------ |
| The evaluation set            | `<data>/evaluation/agent/`, a local git repository | `0700` |
| One case                      | `<data>/evaluation/agent/cases/<case-id>/`         | `0700` |
| The results of one evaluation | `<state>/evaluation/runs/<run-id>/`                | `0700` |

- `<data>` is `directories(env).data`, for example `~/.local/share/kanthord`. `<state>` is `directories(env).state`, for example `~/.local/state/kanthord`.
- The results directory lies outside the pi directory `<state>/pi` ([L2 The pi directory](L2-agent-cli.md#the-pi-directory)), so L2 accepts each session path and output path in it.
- `<run-id>` is the UTC time of the start in the form `YYYYMMDDTHHMMSSZ`, then `-`, then the eval model id with each `/` and `:` replaced by `_`.
- No results directory is committed. The evaluation set repository has no remote.

### Case folder

| File            | Content                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `case.json`     | `id`, `category`, `profile`, `commit`, `wall`, `usd`, `allowed` and `tests`. [Unit-level rules](#unit-level-rules), rule 1, holds the schema |
| `repo.bundle`   | A git bundle of the case repository, with no remote. It holds the commit C of `commit`                                                       |
| `setup.sh`      | The dependency install for one workspace. It reads only the case folder and uses no network                                                  |
| `task.md`       | The task text, the `--prompt` value                                                                                                          |
| `repository.md` | The Repository prompt of the case: a heading, one blank line and the text                                                                    |
| `binding.md`    | The Binding prompt of `swe@1` for the case, in the same form                                                                                 |
| `check/`        | The hidden checks: `check.sh`, the hidden tests and, for the category `test`, the mutants                                                    |

- `category` is `backend`, `frontend` or `test`. `profile` is the role profile of the category: `bee@1`, `fee@1` or `te@1`.
- `wall` is the wall budget of the case, for example `30m`. `usd` is the cost budget of the case, for example `0.5usd`. `allowed` is the list of path globs that the run can change. `tests` is the list of path globs of the test files of the case repository.
- `setup.sh` installs each dependency into a path that the `.gitignore` of the case repository names. So the start precondition `git_clean` of [L3](L3-agent.md#start-preconditions) still passes.
- No file of the case folder lies in a workspace before the hidden checks run.

### Categories

| Category   | Role profile | Count | Source                                                                                                                | Check of the category                                                                                                            |
| ---------- | ------------ | ----- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `backend`  | `bee@1`      | 5     | The task texts of the todoapp seeds of Worker V2, the tree at the base of the claim (`.dev/v2-b3/trees`, `bases.tsv`) | The hidden tests of the reference node head pass                                                                                 |
| `frontend` | `fee@1`      | 5     | A synthetic React and Tailwind fixture with design tokens and components of its own (Ulrich, 2026-11-22)              | The build and the hidden tests pass. The diff adds no arbitrary Tailwind value and no CSS file, and imports the named components |
| `test`     | `te@1`       | 5     | A synthetic module with 2 or 3 mutants for each case                                                                  | The new tests pass on the reference code and fail on each mutant                                                                 |

- The `frontend` fixture reproduces the dogfood finding of [E1](L1-model.md#e1-role-profiles-bee1-fee1-te1-fits-with-a-fit-rule): a session that does not follow the existing interface fails the case.
- The arbitrary-value check of `frontend` searches the added lines of the diff for `-[#` and for `-[` followed by a digit.
- The evaluation set holds no review case. [L8](L8-worker-evaluation.md) owns the review cases.

### Content rules

1. Each case is synthetic or owned by kanthorlabs. No case holds customer code, a `seed.json` of Worker V2 or a `.env` file. Reason: `seed.json` holds `effective_configuration.credential`, `ssh_public_key` and `known_hosts`.
2. Each commit of a case repository has the author `Kanthor Eval <eval@kanthorlabs.invalid>`.
3. Before each commit of the evaluation set, the case author runs the secret patterns of the engine over the staged files (`findPatternText` of `src/agent/sensitive-text.ts`). A match stops the commit.

## One evaluation run

(G5)

This section holds the procedure that [L2](L2-agent-cli.md#one-evaluation-run) gave before. The runner does each step.

1. **Workspace.** Make a new directory `<run-dir>/<case-id>/<agent>-<n>` with mode `0700`. Add a new worktree of C at `w` in it: `git -C <case-repo> worktree add --detach "$DIR/w" "$C"`. `<case-repo>` is a clone of `repo.bundle` in the results directory. No two runs share one workspace.
2. **Setup.** Run `setup.sh` with `w` as the current directory.
3. **Credential refresh.** For an `oauth` entry, refresh the entry ([Credential](#credential)).
4. **Run.** Call `run agent` with the same task, context, model selection and budget for each profile. Only the profile, the workspace and the session file change.

   ```sh
   kanthord run agent "$AGENT" --model "$PROVIDER/$MODEL:$LEVEL" \
     --budget "$WALL" --budget "$USD" \
     --system-prompt "$CASE/repository.md" --system-prompt "$CASE/binding.md" \
     --workspace "$DIR/w" --session "$DIR/session.jsonl" \
     --output "$RUN_DIR/results.jsonl" --prompt "$CASE/task.md" 2> "$DIR/stderr.txt"
   ```

5. **Hidden checks.** Run `check/check.sh` with `w` as its argument. Append one line to `<run-dir>/checks.jsonl` ([Check record](#check-record)).
6. **Record.** Write `git -C w add -A && git -C w diff --cached "$C"` to `$DIR/diff.patch`. Remove the worktree. The session file, `stderr.txt` and `diff.patch` stay.

- The pi session file is the record of the work. The line in `results.jsonl` holds the identity, the end, the class and the totals of the run ([L2 The result](L2-agent-cli.md#the-result)).
- The runner passes no `--auth`, so `run agent` reads the default `--auth` file ([Credential](#credential)).
- The runs go in sequence. Reason: a pi refresh writes the `auth.json` file, and a subscription has a rate limit.

## Run budget

(G2, G6)

1. **Task budget.** Ulrich ruled on 2026-11-22: each case sets its task budget in `case.json`, a wall budget `wall` and a cost budget `usd`. Each run of the case gets `--budget <wall> --budget <usd>`, on the eval model and on the production model. For reference, the largest Worker V2 execution had a list price of 1.09 usd for 3 units in 35 minutes, on Haiku 5.5 (`baseline.md`, execution `T8TWV9P5`).
2. **No turn limit.** The evaluation run has no turn limit. The wall budget and the cost budget of the case bound each run ([L2 Budget](L2-agent-cli.md#budget), rule 8).
3. **No price.** The runner passes no cost budget when the provider is `openai-compatible`. Reason: an `openai-compatible` model has no price, so `run agent` refuses a cost budget for it with `cli.run.agent.budget_unpriced` ([L2 Budget](L2-agent-cli.md#budget), rule 6). Another model with no price gets the cost budget, so `run agent` refuses it and the evaluation stops.
4. **Total cap.** Ulrich ruled on 2026-11-22: the total cap of one evaluation is 15 usd list price. The sum is the sum of `list_price_usd` of each line of `results.jsonl` of the evaluation, calibration included.
5. **Phase cap.** Calibration and the comparison stop at 10 usd. The confirming check uses the rest, up to 15 usd.
6. **Stop at the cap.** The runner starts a run only when the sum plus the cost budget of that run is less than the cap of the phase. Else it stops, writes the report and exits `2`. An evaluation that stops at the cap gives no verdict.
7. A subscription entry pays no list price, but the cap applies to the list price ([L2 Budget](L2-agent-cli.md#budget), rule 5).
8. Ulrich approves the cap before the first live run.

## Pass rule

(G4)

### Passed run

A run passes when both conditions hold:

1. The line in `results.jsonl` has `end` `completed`.
2. `check.sh` exits `0`. It checks in this order: the build of the case passes; the hidden tests pass; each changed path matches `allowed`; no changed path matches `tests`, except for the category `test`; no changed file holds a conflict marker. For the category `test`, the new tests also fail on each mutant.

### Counted run

A run does not count when one condition holds:

1. `stderr.txt` holds a line with `cli.run.agent.prompt_text_path` ([L2 Text or path](L2-agent-cli.md#text-or-path)). Reason: a prompt file did not reach the run.
2. The session file names the case folder, the `check/` folder or another run directory of the evaluation. The check record has `contaminated` `true`. Reason: `swe@1` is not confined, so it can read each file of the OS user ([L1 Reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session)).

### Exit codes of a run

| Exit of `run agent` | Runner action                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `0`                 | The hidden checks decide the pass                                                                                     |
| `1`                 | The evaluation stops, writes the report and exits `1`. Reason: a refusal is a fault of the setup                      |
| `2`, `4`, `5`       | The run fails. Its checks still run, so the check record exists                                                       |
| `75`                | The run starts again with a new session file and a new worktree, at most 2 times. The third exit `75` is a failed run |

Each line of `results.jsonl` stays, the lines of a retried run included ([L2 Comparison rule](L2-agent-cli.md#comparison-rule)).

### Check record

Each line of `checks.jsonl` holds `case`, `agent`, `repeat`, `session`, `pass`, `checks` and `contaminated`. `session` is the key that joins the line to its line in `results.jsonl`. `checks` holds `build`, `tests`, `diff` and, for the category `test`, `mutants`, each `true` or `false`.

## Exit rule

(G1, G2)

Ulrich ruled on 2026-11-22: the exit rule is fixed before the first run, and the evaluation has 2 repeats. Each profile thus has 10 runs for each category: 5 cases and 2 repeats. The rule applies to each role profile R on its own category. A run that does not count and a run that never ran each count as a failed run.

1. **Margin.** passes(R) − passes(`swe@1`) is 2 or more.
2. **Case wins.** R passes more runs than `swe@1` on more cases than the cases where `swe@1` passes more runs than R.
3. **Confirming check.** R passes the [confirming check](#confirming-check).

- R stays in the catalog when rules 1, 2 and 3 hold. Else R leaves the catalog ([L1-D16](L1-model.md#decisions)).
- Reason for the failed count: a lost run does not help R or `swe@1`.
- With 10 runs on each side, the set shows only a large difference. The rule thus keeps a profile only for a large gain.

## Runner

(G5)

The runner is a set of scripts in the engine repository: `scripts/evaluation/agent/` ([Handoffs](#handoffs-to-later-layers)). It calls only the built `kanthord run agent`, git, the case scripts and Node. It adds no engine command.

### `run.sh`

```text
run.sh --set <path> --model <provider>/<model>:<level> --run-id <id> --cap-usd <N> [--calibrate | --confirm]
```

| Option        | Question it answers                     | Rule                                                                                                                         |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--set`       | Which evaluation set runs?              | Required. The path of the evaluation set repository                                                                          |
| `--model`     | Which model runs the agents?            | Required. The form of [L2 Model selection](L2-agent-cli.md#model-selection)                                                  |
| `--run-id`    | Which evaluation do the results join?   | Required. The name of the results directory                                                                                  |
| `--cap-usd`   | What can the phase spend?               | Required. The cap of [Run budget](#run-budget), rules 4 to 6                                                                 |
| `--calibrate` | Does the call measure the level?        | Optional. Only `swe@1` runs, once on each case                                                                               |
| `--confirm`   | Does the call run the confirming check? | Optional. Only the role profiles that pass rules 1 and 2 of the exit rule and `swe@1` run, once on each case of the category |

- With no `--calibrate` and no `--confirm`, the call runs repeat 2 of `swe@1` and repeats 1 and 2 of each role profile on its category.
- The run order is fixed: the cases in byte order of `id`; for each case `swe@1`, then the role profile of the case; then the repeats.
- A call with no `--calibrate` exits `1` and starts no run when the last calibration of the evaluation has no band verdict `in`.
- The runner exits `0` when each run of the call ends, `1` when a run exits `1` or a check of [Credential](#credential) fails, and `2` at the cap.

### `report.sh`

```text
report.sh --run-id <id>
```

1. It reads `results.jsonl` and `checks.jsonl` of the evaluation.
2. It refuses the file when two lines of one model differ in a common key of [L2-D15](L2-agent-cli.md#decisions), or when two lines of one profile and one model differ in `system_prompt_digest`. It exits `1` and names the first two lines.
3. It writes `report.md` in the results directory:
   - one calibration line: the level, the pass share and the band verdict `in`, `above` or `below`;
   - one table for each category, with the columns profile, counted runs, passes, pass rate, passes for each case, count of `budget_end`, count of `failed`, count of contaminated runs, median `duration_ms`, median `tool_calls` and sum of `list_price_usd`;
   - one verdict line for each role profile: `keep` or `leave`, with the number of each exit rule that fails;
   - one total line: the sum of `list_price_usd` and the cap.
4. The report holds no text of a session file and no credential value.

## Credential

(G6)

1. The credential is the KanthorD `auth.json` file, the default `--auth` path of `run agent`: `<home>/.config/kanthord/auth.json` ([L2-D10](L2-agent-cli.md#decisions)). It holds the `anthropic` entry for the default eval model and the production model, and the `openrouter` entry for the second eval model.
2. No credential value enters a case, a line of `results.jsonl` or `checks.jsonl`, a diff or a report.
3. **Refresh.** Before each run with an `oauth` entry, the runner refreshes the entry with pi and discards the token:

   ```sh
   PI_CODING_AGENT_DIR="$HOME/.config/kanthord" pi auth print-bearer-token --provider anthropic --min-expiry 40m > /dev/null
   ```

   `40m` covers the largest `wall` of a case, `30m`, the refresh window of 5 minutes and a margin. `$HOME` is the home directory of the OS user. An `api_key` entry needs no refresh.

4. **Configuration directory.** The runner lists `<home>/.config/kanthord` before and after each refresh. A new entry stops the evaluation with exit `1`. Reason: pi writes into the directory that `PI_CODING_AGENT_DIR` names.
5. **No write by the run.** The runner records the SHA-256 digest and the mode of the `auth.json` file after the refresh and after the run. Both are equal, and the mode is `0600`. Else the evaluation stops with exit `1`.
6. **No credential in a session file.** After the last run of each call, the runner counts the credential values of the entry in each session file of the call. It prints only the count, as step 3 of the [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) does. A count other than `0` stops the evaluation with exit `1`.

## Acceptance checks

(G7)

Each check is an end-to-end test ([index](index.md#layer-files)). It runs the shipped `run.sh` or `report.sh` as a process. Each run calls the built `kanthord run agent`, with a real file system, real git and the real pi runtime. The only stub is the LLM stub of [L2](L2-agent-cli.md#l2-fixtures) on loopback.

### L7 fixtures

L7 adds these details to the [L2 fixtures](L2-agent-cli.md#l2-fixtures).

- **Set.** An evaluation set repository E under `$XD/kanthord/evaluation/agent/`, where `XDG_DATA_HOME` is `$XD`. E holds two cases with the category `backend`, the profile `bee@1`, `wall` `10m` and `usd` `0.5usd`. The `check.sh` of case `b1` exits `0` when `w/ok.txt` holds `ok`, and else `1`. The `check.sh` of case `b2` exits `0` when `w/b2.txt` holds `ok`, and else `1`. The `allowed` of each case is `["ok.txt", "b2.txt"]`.
- **Stub.** The scripted answers depend on the Role in the system prompt. For `swe@1`: call `write` with `ok.txt` and the text `ok`, then answer `done`. For `bee@1`: answer `done` with no tool call.
- **Auth.** The `--auth` file of L2 at `$H/.config/kanthord/auth.json`, the default path, with K. The user database gives H as the home of the OS user.
- **Model.** `openai-compatible/stub-1:off`. The runner passes no cost budget for it ([Run budget](#run-budget), rule 3).
- **R.** The results directory `$XS/kanthord/evaluation/runs/<run-id>/`, where `XDG_STATE_HOME` is `$XS`.

### Checks

1. **L7-AC1. A comparison gives a verdict from the hidden checks.**
   - Fixture: Set, Stub, Auth, Model.
   - Command: `run.sh --set E --model openai-compatible/stub-1:off --run-id r1 --cap-usd 10 --calibrate`, then the same command with no `--calibrate`, then `report.sh --run-id r1`.
   - Assert: each command exits `0`. `R/results.jsonl` holds 8 lines: 4 of `swe@1` and 4 of `bee@1`. The lines of one case have one `input_digest`. `R/checks.jsonl` holds 8 lines, one for each `session` of `results.jsonl`. The 2 lines of `swe@1` on `b1` have `pass` `true`. Each other line has `pass` `false`. `R/report.md` holds the calibration line with the pass share 50% and the band verdict `in`, and the verdict line `bee@1 leave` with the failed rules 1 and 2. Each run directory holds `session.jsonl`, `stderr.txt` and `diff.patch`, and no `w`. `git -C E status --porcelain` prints nothing.

2. **L7-AC2. A retryable end runs again, and a refusal stops the evaluation.**
   - Fixture: Set, Auth, Model. Variant 1: Stub answers HTTP 429 to each request. Variant 2: Stub as usual, and Auth has mode `0644`.
   - Command: `run.sh --set E --model openai-compatible/stub-1:off --run-id r2 --cap-usd 10 --calibrate`.
   - Assert: variant 1 exits `0`. `R/results.jsonl` holds 6 lines of `swe@1`, 3 for each case, each with `class` `retryable`, and each with its own `session` and `workspace`. `R/checks.jsonl` holds 2 lines, each with `pass` `false`. Variant 2 exits `1`. `R/results.jsonl` holds no line, and `R/report.md` exists.

3. **L7-AC3. A contaminated run does not count.**
   - Fixture: Set, Auth, Model. Stub for `swe@1`: call `read` with the absolute path of `E/cases/b1/check/check.sh`, then call `write` with `ok.txt` and the text `ok`, then answer `done`.
   - Command: `run.sh --set E --model openai-compatible/stub-1:off --run-id r3 --cap-usd 10 --calibrate`, then `report.sh --run-id r3`.
   - Assert: each command exits `0`. Each of the 2 lines of `R/checks.jsonl` has `contaminated` `true`. `R/report.md` shows 0 counted runs and 2 contaminated runs for `swe@1`, and the band verdict of no counted run: `none`.

4. **L7-AC4. The cap stops the evaluation before a run.**
   - Fixture: Set, Stub, Auth, Model.
   - Command: `run.sh --set E --model openai-compatible/stub-1:off --run-id r4 --cap-usd 0 --calibrate`.
   - Assert: exit `2`. Stub receives no request. `R/results.jsonl` holds no line. `R/report.md` holds the total line with `0.000000` and the cap `0`, and no verdict line.

5. **L7-AC5. No credential leaves the `auth.json` file.**
   - Fixture: Set, Stub, Auth, Model. Stub for `swe@1`: the answer text holds K once, after the `write` call.
   - Command: `run.sh --set E --model openai-compatible/stub-1:off --run-id r5 --cap-usd 10 --calibrate`, then `report.sh --run-id r5`.
   - Assert: each command exits `0`. `R/results.jsonl`, `R/checks.jsonl`, `R/report.md`, each `diff.patch` and each `stderr.txt` hold K zero times. The `text` of the line in `results.jsonl` holds the redaction marker. Auth has the same SHA-256 digest and mode `0600` before and after. `E` holds K zero times.

### Unit-level rules

These rules hold with no process and no LLM stub, so their tests are unit tests ([index](index.md#layer-files)). The owning module is `scripts/evaluation/agent/evaluation.mjs` of the engine, with its test file `evaluation.test.mjs`. [L6](L6-migration.md) assigns the exact file.

1. **The case schema.** `case.json` holds exactly `id`, `category`, `profile`, `commit`, `wall`, `usd`, `allowed` and `tests`. `category` and `profile` match a row of [Categories](#categories). `commit` is a full hexadecimal commit id. `wall` is a wall budget of [L2 Budget](L2-agent-cli.md#budget), rule 1, and `usd` is a cost budget of rule 2. Each other value is refused.
2. **The calibration band.** A pass share of 30% and of 80% is `in`. 29.9% is `below`. 80.1% is `above`. No counted run is `none`. The next level follows the steps of [Calibration](#calibration), rule 6, and the lowest and the highest step give no level.
3. **The exit rule.** Each rule of [Exit rule](#exit-rule): a margin of 1 and of 2, an equal count of case wins and losses, a run that does not count and a run that never ran as a failed run, and a failed confirming check.
4. **The counted run.** Each condition of [Counted run](#counted-run), and the join of a check line to its result line by `session`.
5. **The cap.** [Run budget](#run-budget) rule 6: the sum plus the cost budget of the next run equal to the cap stops the call. A run with no cost budget adds 0.
6. **The report keys.** [`report.sh`](#reportsh) rule 2: a line with another `budget`, another `engine_version` or another `system_prompt_digest` of one profile is refused.

### Rules with no check, and the reason

- **The live evaluation.** It needs the credential of Ulrich and the cost of real runs. It runs at step 4.3 of the agent gate.
- **The refresh of an `oauth` entry.** The stub provider uses an `api_key` entry. The live evaluation runs the refresh.
- **The case content rules.** They are rules for the case author. The secret pattern run before each commit of the evaluation set enforces rule 3.

## Handoffs to later layers

- [L6](L6-migration.md): add `scripts/evaluation/agent/run.sh`, `report.sh`, `evaluation.mjs` and `evaluation.test.mjs` to the engine, after the step that ships `run agent`. Run the L7 checks in the step that adds them.
- [L6](L6-migration.md): build the evaluation set: 15 cases under `<data>/evaluation/agent/`, with the content rules. The set is no part of the engine repository.
- [L8](L8-worker-evaluation.md): the worker-level checks against a local KanthorD server, the review cases of `reviewer@1` and `re@1`, and the successor of `~/kanthord-evalset/worker-v2/`.

## Decisions

1. **L7-D1.** The agent evaluation is the layer L7, a consumer of L2 (Ulrich, 2026-11-22). Constraint: L7 is designed after L3 and before L6 part A; it runs at gate step 4.3 against the built agent; the worker evaluation is L8.
2. **L7-D2.** The default eval model is `anthropic/claude-haiku-5-5:high`, and the second eval model is `openrouter/deepseek/deepseek-v4.1-flash:high` (Ulrich, 2026-11-22). Constraint: calibration fixes the level; one evaluation uses one eval model and one level; no `~`-alias id.
3. **L7-D3.** Calibration runs `swe@1` once on each case and fixes the level when the pass share is from 30% to 80%. Constraint: the calibration runs at the fixed level count as repeat 1 of `swe@1`; no level in the band gives no verdict.
4. **L7-D4.** The evaluation set has 15 cases: 5 `backend`, 5 `frontend` and 5 `test`. Constraint: scripted hidden checks decide each pass; no LLM decides a pass; the set holds no review case.
5. **L7-D5.** The `frontend` cases use a synthetic React and Tailwind fixture (Ulrich, 2026-11-22). Constraint: the fixture reproduces the dogfood finding of E1.
6. **L7-D6.** A run passes when it ends `completed` and `check.sh` exits `0`. A run with the notice `cli.run.agent.prompt_text_path` or a contaminated session does not count. Constraint: in the exit rule, a run that does not count and a run that never ran each count as a failed run.
7. **L7-D7.** Each profile runs each case 2 times. A role profile stays when it passes at least 2 more of its 10 runs than `swe@1`, wins more cases than it loses and passes the confirming check (Ulrich, 2026-11-22). Constraint: the rule is fixed before the first run.
8. **L7-D8.** The confirming check runs on `anthropic/claude-sonnet-5-5:high`, one run of each case of the category (Ulrich, 2026-11-22). Constraint: R passes no fewer runs than `swe@1`.
9. **L7-D9.** The evaluation run has no turn limit. The wall budget and the cost budget of each case, fixed in `case.json`, bound each run (Ulrich, 2026-11-22). Constraint: each run of a case gets `--budget <wall> --budget <usd>`; the runner passes no cost budget for `openai-compatible`.
10. **L7-D10.** The total cap of one evaluation is 15 usd list price, and calibration and the comparison stop at 10 usd (Ulrich, 2026-11-22). Constraint: the runner starts a run only below the cap; a stop at the cap gives no verdict; Ulrich approves the cap before the first live run.
11. **L7-D11.** The evaluation set lies in `<data>/evaluation/agent/`, and the results lie in `<state>/evaluation/runs/<run-id>/` of the KanthorD XDG directories (Ulrich, 2026-11-22). Constraint: each directory has mode `0700`; the set has no remote; no result is committed.
12. **L7-D12.** The runner is `run.sh` and `report.sh` in `scripts/evaluation/agent/` of the engine. Constraint: it calls only the built `kanthord run agent`, git, the case scripts and Node; the runs go in sequence.
13. **L7-D13.** The credential is the KanthorD `auth.json` file at the default `--auth` path. Constraint: no credential value enters a case, a result, a check record or a report; the runner checks the digest and the mode of the file around each run, and counts the credential values in each session file.

## Open questions for Ulrich

L7 holds no open question for Ulrich.
