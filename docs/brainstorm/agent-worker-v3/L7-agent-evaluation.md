# L7: The agent evaluation

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model, [L2](L2-agent-cli.md) is the agent CLI that this page uses and [L3](L3-agent.md) is the agent that it measures. Each KanthorD path starts at `engine/`. Each pi model fact comes from `@earendil-works/pi-ai` `1.1.0`, `dist/providers/data/<provider>.json`. Each other pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`). The code of today is engine `c864130e`.

## Goals

1. **G1.** The evaluation gives each role profile `bee@1`, `fee@1` and `te@1` a verdict against `swe@1`: keep or leave ([L1-D16](L1-model.md#decisions), [L1-D20](L1-model.md#decisions)).
2. **G2.** The exit rule is fixed before the first run. The same results always give the same verdict.
3. **G3.** The eval model is a setting that calibration adjusts, so that the results separate the profiles.
4. **G4.** Scripted hidden checks decide pass or fail. No LLM decides a pass.
5. **G5.** The evaluation uses only `kanthord run agent` and the result file of L2. It adds no engine command and no server call.
6. **G6.** Each credential rule of L2 holds for each run. No credential value enters a case, a result, a check record or a report.
7. **G7.** Each public behavior of L7 is an end-to-end acceptance check or a unit-level rule with its owning module ([index](index.md#reading-order)).

## Evaluation of the direction

(G3, G4)

### Direction: an eval model with low intelligence, Haiku (high) by default (fits, with a fit rule)

- **Direction.** Ulrich, 2026-11-22: "Evaluation is hard, we should use model that has low intelligent that allow us evaluation correctly. We need to define an evaluation set, use Haiku (high) to run it by default."
- **Verdict.** Fits. The model is the model that runs the agent under test, not a judge.
- **Evidence.** A strong model compensates for a weak prompt, so a ceiling hides the difference between two profiles. The profiles differ little: `bee@1` and `te@1` differ from `swe@1` only in the Role ([L3 Profile prompts](L3-agent.md#profile-prompts)). Haiku 5.5 at `medium` passed checks 3, 5 and 6 of each of the 11 Worker V2 seeds (`~/kanthord-evalset/worker-v2/baseline.md`). So a ceiling is a real risk.
- **Fit rule.**
  1. The eval model lies in the band where the results separate the profiles. [Calibration](#calibration) measures the band before the comparison.
  2. Scripted checks decide each pass. A weak model is no judge.
  3. A [confirming check](#confirming-check) on the production model repeats the comparison for each role profile that wins.

## Placement in the round

(G1, G5)

- L7 is a caller of the agent CLI. It is no CLI layer and no core layer.
- Ulrich ruled on 2026-11-22: L7 is designed right after L3, before L6 part A.
- The evaluation runs at step 4.3 of the [agent gate](index.md#round-order), against the agent that L6 part A builds. Calibration runs first, because it needs a built `run agent` and a real credential.
- An evaluation with no verdict fails gate step 4.3. Ulrich then decides the next step.
- [L8](L8-worker-evaluation.md), the worker evaluation, owns the worker-level checks, the review cases and the successor of `~/kanthord-evalset/worker-v2/`.

## Models

(G3)

### Eval model

| Use               | `--model`                                      | Catalog entry                                          | Levels that pi accepts                  | List price per MTok (input, output)            | Entry in `auth.json`    |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------- |
| Default           | `anthropic/claude-haiku-5-5:high`              | `anthropic.json`, `chat:claude-haiku-5-5`              | `low`, `medium`, `high`, `xhigh`, `max` | 0.10, 0.50; above 100k input tokens 0.50, 2.50 | `anthropic`, `oauth`    |
| Second eval model | `openrouter/deepseek/deepseek-v4.1-flash:high` | `openrouter.json`, `chat:deepseek/deepseek-v4.1-flash` | `off`, `low`, `high`, `max`             | 0.30, 1.20                                     | `openrouter`, `api_key` |

- The catalog name of the second eval model is "DeepSeek: DeepSeek V4.1 Flash". It refuses `medium`, so `run agent` refuses `:medium` with `cli.run.agent.level_unsupported` ([L2 Model selection](L2-agent-cli.md#model-selection), rule 6).
- The evaluation uses no `~`-alias id, for example `openrouter/~deepseek/deepseek-flash-latest`. Reason: an alias moves to another model, so two runs of one id can use two models.
- One evaluation uses one eval model. The comparison uses one level, the level that calibration fixes.

### Calibration

Calibration finds the level of the eval model before the comparison.

1. `swe@1` runs each of the 15 cases once on the eval model at its start level. The start level is `high`.
2. The pass share is the count of passed runs divided by the count of counted runs ([Pass rule](#pass-rule)).
3. **In the band.** A pass share from 30% to 80%, both included, fixes the level. The calibration runs then count as repeat 1 of `swe@1`, because the common keys of [L2-D15](L2-agent-cli.md#decisions) are equal.
4. **Above the band.** The next level is one step down. Calibration runs again at that level.
5. **Below the band.** The next level is one step up. Calibration runs again at that level.
6. The steps of the default eval model are `low`, `medium`, `high`, `xhigh` and `max`. The steps of the second eval model are `off`, `low`, `high` and `max`.
7. **No verdict.** Calibration ends with no verdict in each of these cases:
   - the pass share is above the band at the lowest step, or below the band at the highest step;
   - the next level is a level that the evaluation measured before;
   - no run counts (the band verdict `none`).
8. The calibration line of the report names the next level, or "no verdict".
9. The runs of a calibration that does not fix the level count toward the cost cap, but not toward the comparison.

### Confirming check

Ulrich ruled on 2026-11-22: the production model is `anthropic/claude-sonnet-5-5:high`. The catalog entry is `anthropic.json`, `chat:claude-sonnet-5-5`, "Claude Sonnet 5.5". It accepts each level from `low` to `max`, and its list price is 2 and 10 per MTok.

1. Each role profile R that passes rules 1 and 2 of the [Exit rule](#exit-rule) runs on the production model. It runs once on each case of its category. `swe@1` runs once on the same cases.
2. R passes the confirming check when it passes no fewer runs than `swe@1`.
3. **Void check.** The confirming check gives no verdict when `swe@1` passes 0 runs, or when a run of the check ends `budget_end`. Reason: with no pass of `swe@1`, or with a run that the budget cut, the comparison shows nothing.
4. The cost cap and the task budget of the confirming check wait for Ulrich ([Open questions](#open-questions-for-ulrich), question 1).

## Evaluation set

(G4, G6)

### Location

Ulrich ruled on 2026-11-22: the evaluation uses the KanthorD XDG directories. `directories(env)` of `src/kernel/xdg.ts` gives each directory, with the same rule as L2.

| Content                                 | Path                                                        | Mode   |
| --------------------------------------- | ----------------------------------------------------------- | ------ |
| The evaluation set                      | `<data>/evaluation/agent/`, a local git repository          | `0700` |
| One case                                | `<data>/evaluation/agent/cases/<case-id>/`                  | `0700` |
| The shared fixture folder of the set    | `<data>/evaluation/agent/shared/`                           | `0700` |
| The results directory of one evaluation | `<state>/evaluation/runs/<evaluation-id>/`                  | `0700` |
| The run directory of one run            | `<results directory>/<case-id>/<agent>-<repeat>-<attempt>/` | `0700` |
| The workspace root of one run           | `<state>/evaluation/work/<random>/`                         | `0700` |

- `<data>` is `directories(env).data`, for example `~/.local/share/kanthord`. `<state>` is `directories(env).state`, for example `~/.local/state/kanthord`.
- The results directory and the workspace root lie outside the pi directory `<state>/pi` ([L2 The pi directory](L2-agent-cli.md#the-pi-directory)). So L2 accepts each session path and output path in them.
- `<evaluation-id>` is a name that the operator gives: letters, digits, `-` and `_`. One evaluation id names one evaluation of one eval model.
- `<repeat>` is `1` or `2`. `<attempt>` is `1`, `2` or `3` ([Exit codes of a run](#exit-codes-of-a-run)).
- `<random>` is 16 random lowercase letters. The workspace path names no case, no profile and no evaluation.
- Nobody commits a results directory. The evaluation set repository has no remote.

### Case folder

| File            | Content                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `case.json`     | `category`, `commit`, `wall`, `usd`, `allowed` and `tests`. [Unit-level rules](#unit-level-rules), rule 1, holds the schema     |
| `repo.bundle`   | A git bundle of the case repository, with no remote. It holds only the commit C of `commit` and its ancestors, and no other ref |
| `setup.sh`      | The dependency install for one workspace. It reads only the case folder and the shared fixture folder, and it uses no network   |
| `task.md`       | The task text, the `--prompt` value                                                                                             |
| `repository.md` | The Repository prompt of the case: a heading, one blank line and the text                                                       |
| `binding.md`    | The Binding prompt of `swe@1` for the case, in the same form                                                                    |
| `check/`        | The hidden checks: `check.sh`, the hidden tests and, for the category `test`, the mutants                                       |

- The case id is the name of the case folder.
- `category` is `backend`, `frontend` or `test`. The category gives the role profile of the case ([Categories](#categories)).
- `wall` is the wall budget of the case, for example `30m`. `usd` is the cost budget of the case, for example `0.5usd`. `allowed` is the list of path globs that the run can change. `tests` is the list of path globs of the test files of the case repository.
- `setup.sh` installs each dependency into a path that the `.gitignore` of the case repository names. So the start precondition `git_clean` of [L3](L3-agent.md#start-preconditions) still passes.
- No file of `check/` lies in a workspace before the hidden checks run.

### Categories

| Category   | Role profile | Count | Source                                                                                                                                             | Check of the category                                                                                                            |
| ---------- | ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `backend`  | `bee@1`      | 5     | The task texts of the todoapp seeds of Worker V2, the tree at the base of the claim (`.dev/v2-b3/trees`, `~/kanthord-evalset/worker-v2/bases.tsv`) | The hidden tests of the reference node head pass                                                                                 |
| `frontend` | `fee@1`      | 5     | A synthetic React and Tailwind fixture with design tokens and components of its own (Ulrich, 2026-11-22)                                           | The build and the hidden tests pass. The diff adds no arbitrary Tailwind value and no CSS file, and imports the named components |
| `test`     | `te@1`       | 5     | A synthetic module with 2 or 3 mutants for each case                                                                                               | The new tests pass on the reference code and fail on each mutant                                                                 |

- The `frontend` fixture reproduces the dogfood finding of [E1](L1-model.md#e1-role-profiles-bee1-fee1-te1-fits-with-a-fit-rule): a session that does not follow the existing interface fails the case.
- The arbitrary-value rule of `frontend` finds each Tailwind class with a bracket value in the added lines of the diff, for example `w-[calc(100%-1rem)]`, `text-[var(--x)]` and `bg-[#fff]`. `evaluation.mjs` owns the rule ([Unit-level rules](#unit-level-rules), rule 7).
- The evaluation set holds no review case. [L8](L8-worker-evaluation.md) owns the review cases.

### Content rules

1. Each case is synthetic or owned by kanthorlabs. No case holds customer code, a `seed.json` of Worker V2 or a `.env` file. Reason: `seed.json` holds `effective_configuration.credential`, `ssh_public_key` and `known_hosts`.
2. Each commit of a case repository has the author `Kanthor Eval <eval@kanthorlabs.invalid>`.
3. `repo.bundle` holds no commit after C. Reason: a node branch of `.dev/v2-b3/trees` holds the reference solution, and a later commit in the object store defeats the hidden checks.
4. Before each commit of the evaluation set, the case author runs the secret patterns of the engine over the staged files (`findPatternText` of `src/agent/sensitive-text.ts`). A match stops the commit.

## One evaluation run

(G5)

This section holds the procedure that [L2](L2-agent-cli.md#one-evaluation-run) gave before. The runner does each step.

1. **Workspace.** Make the run directory and a new workspace root. Add a new worktree of C at `<workspace root>/w`: `git -C <case-repo> worktree add --detach "$ROOT/w" "$C"`. `<case-repo>` is a clone of `repo.bundle` in the results directory. No two runs share one workspace.
2. **Setup.** Run `setup.sh` with `w` as the current directory.
3. **Credential refresh.** For an `oauth` entry, refresh the entry ([Credential](#credential), rule 3).
4. **Run.** Call `run agent` with the same task, context, model selection and budget for each profile. Only the profile, the workspace and the session file change. `$RUN` is the run directory, and `$RESULTS` is the results directory.

   ```sh
   kanthord run agent "$AGENT" --model "$PROVIDER/$MODEL:$LEVEL" \
     --budget "$WALL" --budget "$USD" \
     --system-prompt "$CASE/repository.md" --system-prompt "$CASE/binding.md" \
     --workspace "$ROOT/w" --session "$RUN/session.jsonl" \
     --output "$RESULTS/results.jsonl" --prompt "$CASE/task.md" 2> "$RUN/stderr.txt"
   ```

5. **Credential count.** Count the credential values in the session file of the run ([Credential](#credential), rule 6).
6. **Diff rules.** `evaluation.mjs` reads `git -C w add -A` and `git -C w diff --cached "$C"` and applies the diff rules of [Passed run](#passed-run). No diff file stays.
7. **Hidden checks.** Run `check/check.sh` with `w` as its argument. Append one line to `<results directory>/checks.jsonl` ([Check record](#check-record)).
8. **Removal.** Remove the worktree and the workspace root. The session file and `stderr.txt` stay in the run directory.

- The pi session file is the record of the work. The line in `results.jsonl` holds the identity, the end, the class and the totals of the run ([L2 The result](L2-agent-cli.md#the-result)).
- The runner passes no `--auth`, so `run agent` reads the default `--auth` file ([Credential](#credential)).
- The runs go in sequence. Reason: a pi refresh writes the `auth.json` file, and a subscription has a rate limit.

## Run budget

(G2, G6)

1. **Task budget.** Ulrich ruled on 2026-11-22: each case sets its task budget in `case.json`, a wall budget `wall` and a cost budget `usd`. Each run of the case on the eval model gets `--budget <wall> --budget <usd>`. For reference, the largest Worker V2 execution had a list price of 1.09 usd for 3 units in 35 minutes, on Haiku 5.5 (`baseline.md`, execution `T8TWV9P5`).
2. **No turn limit.** The evaluation run has no turn limit. The wall budget and the cost budget of the case bound each run ([L2 Budget](L2-agent-cli.md#budget), rule 8).
3. **No price.** The runner passes no cost budget when the provider is `openai-compatible`. Reason: an `openai-compatible` model has no price, so `run agent` refuses a cost budget for it with `cli.run.agent.budget_unpriced` ([L2 Budget](L2-agent-cli.md#budget), rule 6). Another model with no price gets the cost budget, so `run agent` refuses it and the evaluation stops.
4. **Wall limit.** `wall` is at most `2h`, the default wall budget of `run agent`.
5. **Total cap.** Ulrich ruled on 2026-11-22: the total cap of one evaluation is 15 usd list price. The sum is the sum of `list_price_usd` of each line of `results.jsonl` of the evaluation, calibration included.
6. **Phase cap.** Calibration and the comparison stop at 10 usd. The confirming check uses the rest.
7. **Stop at the cap.** Each run reserves the `usd` of its case, also when the runner passes no cost budget (rule 3). The runner starts a run only when the sum plus that reserve is less than the cap of the phase. Else it stops, writes the report and exits `4`. An evaluation that stops at the cap gives no verdict.
8. A subscription entry pays no list price, but the cap applies to the list price ([L2 Budget](L2-agent-cli.md#budget), rule 5).
9. Ulrich approves the cap before the first live run.

### Cost arithmetic

These numbers use the Worker V2 baseline of Haiku 5.5 at `medium`: 1.98 usd for 19 units, a mean of 0.104 usd for each unit (`baseline.md`). One run of one case counts as one unit.

| Phase                    | Runs                                                        | List price            |
| ------------------------ | ----------------------------------------------------------- | --------------------- |
| Calibration at one level | 15 runs of `swe@1`                                          | about 1.6 usd         |
| Comparison               | 15 runs of `swe@1` (repeat 2), 30 runs of the role profiles | about 4.7 usd         |
| Each further calibration | 15 runs of `swe@1`                                          | about 1.6 usd         |
| Confirming check, one R  | 5 runs of R and 5 runs of `swe@1` on Sonnet 5.5             | about 4 usd to 21 usd |

- The list price of Sonnet 5.5 is 20 times that of Haiku 5.5 below 100k input tokens, and 4 times above. So one Sonnet run costs about 0.4 usd to 2.1 usd.
- The phase cap keeps at least 5 usd for the confirming check. That covers one R only at the low end. The task budget `usd` of a case fits Haiku 5.5, so a Sonnet run can end `budget_end` at that budget.

## Pass rule

(G4)

### Passed run

A run passes when both conditions hold:

1. The line in `results.jsonl` has `end` `completed`.
2. The diff rules pass, and `check.sh` exits `0`.
   - The diff rules: each changed path matches `allowed`; no changed path matches `tests`, except for the category `test`; no changed file holds a conflict marker; for the category `frontend`, the [arbitrary-value rule](#categories) and the CSS file rule pass.
   - `check.sh` checks in this order: the build of the case passes; the hidden tests pass. For the category `test`, the new tests also fail on each mutant.

### Counted run

A run does not count when the session file names a protected path. The check record then has `contaminated` `true`. Reason: the profiles of the evaluation are not confined. So a session can read each file of the OS user ([L1 Reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session)).

The rule is a heuristic. pi records the tool call arguments as the model wrote them and the tool result text. It records no path that a tool resolved. `evaluation.mjs` searches the whole session file for each of these strings:

- the absolute path of the evaluation set, of the results directory and of the case folder;
- the path parts `evaluation/agent`, `evaluation/runs` and `/check/`;
- the file names `check.sh`, `checks.jsonl`, `results.jsonl`, `session.jsonl` and `stderr.txt`.

A path that a shell builds from parts, a glob or a cut output can pass the search.

### Lost runs

A lost run is a run that does not count, or a run that never ran.

1. A lost run of a role profile counts as a failed run.
2. A lost run of `swe@1` counts as a passed run.

Reason: a lost run then never helps the role profile. The rule keeps a profile only on evidence.

### Exit codes of a run

| Exit of `run agent`                           | Runner action                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `0`                                           | The diff rules and the hidden checks decide the pass                                                                           |
| `4`, `5`                                      | The run fails. Its checks still run, so the check record exists                                                                |
| `75`                                          | The run starts again with a new session file and a new worktree, as the next attempt. The third exit `75` stops the evaluation |
| `1`, `2`                                      | The evaluation stops                                                                                                           |
| stderr holds `cli.run.agent.prompt_text_path` | The evaluation stops. Reason: a prompt file did not reach the run ([L2 Text or path](L2-agent-cli.md#text-or-path))            |

- Each line of `results.jsonl` stays, the lines of a retried run included ([L2 Comparison rule](L2-agent-cli.md#comparison-rule)).
- **Stop.** A stopped evaluation writes the report and gives no verdict. The runner exits `1`. A later call with the same evaluation id resumes it: the runner skips each run that has a line in `checks.jsonl`.

### Check record

Each line of `checks.jsonl` holds `case`, `repeat`, `session`, `pass` and `contaminated`.

| Field          | Reader                                                                             |
| -------------- | ---------------------------------------------------------------------------------- |
| `case`         | The report: the passes for each case and the case wins of the exit rule            |
| `repeat`       | The resume of a stopped evaluation                                                 |
| `session`      | The join of the line to its line in `results.jsonl`, which gives `agent` and `end` |
| `pass`         | The report and the exit rule                                                       |
| `contaminated` | The report and the lost-run rule                                                   |

## Exit rule

(G1, G2)

Ulrich ruled on 2026-11-22: the exit rule is fixed before the first run, and the evaluation has 2 repeats. Each profile thus has 10 runs for each category: 5 cases and 2 repeats. The rule applies to each role profile R on its own category. [Lost runs](#lost-runs) apply.

1. **Margin.** passes(R) − passes(`swe@1`) is 2 or more.
2. **Case wins.** R passes more runs than `swe@1` on more cases than the cases where `swe@1` passes more runs than R.
3. **Confirming check.** R passes the [confirming check](#confirming-check).

- R stays in the catalog when rules 1, 2 and 3 hold. Else R leaves the catalog ([L1-D16](L1-model.md#decisions)).
- A void confirming check gives no verdict for R.
- **False keep.** A simulation with two equal profiles gives the share of evaluations where rules 1 and 2 hold. Each run passes with one probability p from 0.3 to 0.8, and the runs are independent.

  | Margin | Share where rules 1 and 2 hold |
  | ------ | ------------------------------ |
  | 2      | 20% to 25%                     |
  | 3      | 8% to 13%                      |
  | 4      | 2% to 6%                       |

  The margin waits for Ulrich ([Open questions](#open-questions-for-ulrich), question 2).

## Runner

(G5)

The runner is a set of scripts in the engine repository: `scripts/evaluation/agent/` ([Handoffs](#handoffs-to-later-layers)). It calls only the built `kanthord run agent`, git, the case scripts and Node. `evaluation.mjs` calls the exported pi API for the refresh. The runner adds no engine command.

### `run.sh`

```text
run.sh --model <provider>/<model>:<level> --evaluation <id> [--calibrate | --confirm]
```

| Option         | Question it answers                     | Rule                                                                                                                         |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--model`      | Which model runs the agents?            | Required. The form of [L2 Model selection](L2-agent-cli.md#model-selection)                                                  |
| `--evaluation` | Which evaluation do the results join?   | Required. The evaluation id                                                                                                  |
| `--calibrate`  | Does the call measure the level?        | Optional. Only `swe@1` runs, once on each case                                                                               |
| `--confirm`    | Does the call run the confirming check? | Optional. Only the role profiles that pass rules 1 and 2 of the exit rule and `swe@1` run, once on each case of the category |

- The evaluation set is the fixed path of [Location](#location). The cap of the call follows from its phase ([Run budget](#run-budget), rules 5 to 7).
- With no `--calibrate` and no `--confirm`, the call runs repeat 2 of `swe@1` and repeats 1 and 2 of each role profile on its category.
- The run order is fixed: the cases in byte order of the case id; for each case `swe@1`, then the role profile of the case; then the repeats.
- A comparison call exits `1` and starts no run when the last calibration of the evaluation has no band verdict `in`.
- The runner exits `0` when each run of the call ends, `1` at a stop, and `4` at the cap.

### `report.sh`

```text
report.sh --evaluation <id>
```

1. It reads `results.jsonl` and `checks.jsonl` of the evaluation.
2. It checks the keys of [L2-D15](L2-agent-cli.md#decisions):
   - each line of the file has one `engine_version`, `provider` and `model`;
   - for each case and each level, the lines have one `input_digest` and one `budget`;
   - for each case, each level and each profile, the lines have one `system_prompt_digest`.

   It refuses a file that breaks a check. It exits `1` and names the first two lines.

3. It compares only the lines at the level that calibration fixes. The lines of a calibration at another level stay in the file.
4. It writes `report.md` in the results directory:
   - one calibration line for each level: the level, the pass share, the band verdict `in`, `above`, `below` or `none`, and the next level or "no verdict";
   - one table for each category, with the columns profile, counted runs, passes, pass rate, passes for each case, count of `budget_end`, count of `failed`, count of contaminated runs, median `duration_ms`, median `tool_calls` and sum of `list_price_usd`;
   - one verdict line for each role profile: `keep`, `leave` with the number of each exit rule that fails, or "no verdict";
   - one total line: the sum of `list_price_usd` and the cap.
5. The report holds no text of a session file and no credential value.

## Credential

(G6)

1. The credential is the KanthorD `auth.json` file, the default `--auth` path of `run agent`: `<home>/.config/kanthord/auth.json` ([L2-D10](L2-agent-cli.md#decisions)). It holds the `anthropic` entry for the default eval model and the production model, and the `openrouter` entry for the second eval model.
2. No credential value enters a case, a line of `results.jsonl` or `checks.jsonl`, a report or the evaluation set.
3. **Refresh.** Before each run with an `oauth` entry, `evaluation.mjs` refreshes the entry with the exported pi API and discards the result:
   - `ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })` (`dist/core/model-runtime.d.ts`);
   - `getAuth("anthropic", { minOAuthValidityMs })`.
   - `authPath` is `<home>/.config/kanthord/auth.json`, and `<home>` is `homedir` of `os.userInfo()`. No environment variable selects the file.
   - `minOAuthValidityMs` is the `wall` of the run plus 10 minutes.
   - The refresh writes nothing to stdout or stderr. An `api_key` entry needs no refresh.
4. **No proxy.** The refresh request uses no proxy of the environment. The runner refuses `NODE_USE_ENV_PROXY` and `--use-env-proxy`, as `run agent` does ([L2 Proxy settings](L2-agent-cli.md#proxy-settings)). `evaluation.mjs` sets no global dispatcher.
5. **No write by the run.** The runner records the SHA-256 digest and the mode of the `auth.json` file after the refresh and after the run. Both are equal, and the mode is `0600`. The configuration directory `<home>/.config/kanthord` gets no new entry. Else the evaluation stops.
6. **No credential in a session file.** After each run, the runner counts the credential values of the entry in the session file of the run. It counts before the next refresh. It prints only the count, as step 3 of the [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) does. A count other than `0` stops the evaluation.
7. **Provisioning.** Ulrich logs in once with pi into the KanthorD `auth.json` file for each provider of the evaluation. Nobody copies an `oauth` entry from another file. Reason: two files with one refresh token break each other at the first refresh.

## Acceptance checks

(G7)

Each check is an end-to-end test ([index](index.md#reading-order)). It runs the `run.sh` or `report.sh` of the engine repository as a process. Each run calls the built `kanthord run agent`, with a real file system, real git and the real pi runtime. The only stub is the LLM stub of [L2](L2-agent-cli.md#l2-fixtures) on loopback.

### L7 fixtures

L7 adds these details to the [L2 fixtures](L2-agent-cli.md#l2-fixtures).

- **Set.** An evaluation set repository E under `$XD/kanthord/evaluation/agent/`, where `XDG_DATA_HOME` is `$XD`. E holds two cases `b1` and `b2` with the category `backend`, `wall` `10m` and `usd` `0.5usd`. The `check.sh` of `b1` exits `0` when `w/ok.txt` holds `ok`, and else `1`. The `check.sh` of `b2` exits `0` when `w/b2.txt` holds `ok`, and else `1`. The `allowed` of each case is `["ok.txt", "b2.txt"]`.
- **Stub.** The scripted answers depend on the Role in the system prompt. For `swe@1`: call `write` with `ok.txt` and the text `ok`, then answer `done`. For `bee@1`: answer `done` with no tool call.
- **Stub2.** A second LLM stub on loopback, for `openai-compatible/stub-2:off`. The `task.md` of `b1` holds `task b1`, and the `task.md` of `b2` holds `task b2`. For `bee@1`: call `write` with `ok.txt` and with `b2.txt`, each with the text `ok`, then answer `done`. For `swe@1` with the task `task b1`: call `write` with `ok.txt` and the text `ok`, then answer `done`. For `swe@1` with the task `task b2`: answer `done` with no tool call.
- **Auth.** The `--auth` file of L2 at `$H/.config/kanthord/auth.json`, the default path, with K. The user database gives H as the home of the OS user.
- **Model.** `openai-compatible/stub-1:off`. The runner passes no cost budget for it ([Run budget](#run-budget), rule 3).
- **R.** The results directory `$XS/kanthord/evaluation/runs/<evaluation-id>/`, where `XDG_STATE_HOME` is `$XS`.

### Checks

1. **L7-AC1. A comparison gives a verdict from the hidden checks.**
   - Fixture: Set, Stub, Auth, Model.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation r1 --calibrate`, then the same command with no `--calibrate`, then `report.sh --evaluation r1`.
   - Assert: each command exits `0`. `R/results.jsonl` holds 8 lines: 4 of `swe@1` and 4 of `bee@1`. The lines of one case have one `input_digest`. `R/checks.jsonl` holds 8 lines, one for each `session` of `results.jsonl`. The 2 lines of `swe@1` on `b1` have `pass` `true`. Each other line has `pass` `false`. `R/report.md` holds the calibration line with the pass share 50% and the band verdict `in`, and the verdict line `bee@1 leave` with the failed rules 1 and 2. Each run directory holds `session.jsonl` and `stderr.txt`, and no other file. No workspace root remains under `$XS/kanthord/evaluation/work/`. `git -C E status --porcelain` prints nothing.

2. **L7-AC2. A third retryable end and a refusal each stop the evaluation.**
   - Fixture: Set, Auth, Model. Variant 1: Stub answers HTTP 429 to each request. Variant 2: Stub as usual, and Auth has mode `0644`.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation r2 --calibrate`, then `report.sh --evaluation r2`.
   - Assert: variant 1: `run.sh` exits `1`. `R/results.jsonl` holds 3 lines of `swe@1` on `b1`, each with `class` `retryable` and each with its own `session` and `workspace`. `R/checks.jsonl` holds no line. `R/report.md` holds the calibration line "no verdict". Variant 2: `run.sh` exits `1`. `R/results.jsonl` holds no line, and `R/report.md` exists.

3. **L7-AC3. A contaminated run does not count.**
   - Fixture: Set, Auth, Model. Variant 1: Stub for `swe@1` calls `read` with the absolute path of `E/cases/b1/check/check.sh`, then calls `write` with `ok.txt` and the text `ok`, then answers `done`. Variant 2: the same, with `bash` and the command `cat ../../../runs/r3/b1/swe@1-1-1/stderr.txt` in place of the `read`.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation r3 --calibrate`, then `report.sh --evaluation r3`.
   - Assert: each command exits `0`. Each of the 2 lines of `R/checks.jsonl` has `contaminated` `true`. `R/report.md` shows 0 counted runs and 2 contaminated runs for `swe@1`, and the band verdict `none` with "no verdict".

4. **L7-AC4. The cap stops the evaluation before a run.**
   - Fixture: Set, Stub, Auth, Model. The `usd` of each case is `11usd`.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation r4 --calibrate`.
   - Assert: exit `4`. Stub receives no request. `R/results.jsonl` holds no line. `R/report.md` holds the total line with `0.000000` and the cap `10`, and no verdict line.

5. **L7-AC5. A credential value in a session file stops the evaluation.**
   - Fixture: Set, Stub, Auth, Model. Stub for `swe@1`: the answer text holds K once, after the `write` call.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation r5 --calibrate`, then `report.sh --evaluation r5`.
   - Assert: `run.sh` exits `1` after the first run. Its stdout holds the count `1` and no other part of K. `R/results.jsonl`, `R/checks.jsonl`, `R/report.md` and each `stderr.txt` hold K zero times. Auth has the same SHA-256 digest and mode `0600` before and after. `E` holds K zero times.

6. **L7-AC6. A role profile that wins on both models is kept.**
   - Fixture: Set, Stub2, Auth, the model `openai-compatible/stub-2:off`.
   - Command: `run.sh --model openai-compatible/stub-2:off --evaluation r6 --calibrate`, then the same with no `--calibrate`, then the same with `--confirm`, then `report.sh --evaluation r6`.
   - Assert: each command exits `0`. The calibration of `swe@1` passes 1 of 2 runs, the band verdict `in`. In the comparison, `swe@1` passes 2 of 4 runs and `bee@1` passes 4 of 4 runs. The `--confirm` call runs `bee@1` and `swe@1` once on each case. `R/report.md` holds the verdict line `bee@1 keep`. The check uses the margin of L7-D7.
   - The `--confirm` call runs on the model of `--model`. The live evaluation passes the production model.

### Unit-level rules

These rules hold with no process and no LLM stub, so their tests are unit tests ([index](index.md#reading-order)). The owning module is `scripts/evaluation/agent/evaluation.mjs` of the engine, with its test file `evaluation.test.mjs`. [L6](L6-migration.md) assigns the exact file.

1. **The case schema.** `case.json` holds exactly `category`, `commit`, `wall`, `usd`, `allowed` and `tests`. `category` matches a row of [Categories](#categories). `commit` is a full hexadecimal commit id. `wall` is a wall budget of [L2 Budget](L2-agent-cli.md#budget), rule 1, of at most `2h`. `usd` is a cost budget of rule 2. The schema refuses each other value.
2. **The calibration band.** A pass share of 30% and of 80% is `in`. 29.9% is `below`. 80.1% is `above`. No counted run is `none`. The next level follows the steps of [Calibration](#calibration), rule 6. Each case of rule 7 gives no verdict.
3. **The exit rule.** Each rule of [Exit rule](#exit-rule): a margin of 1 and of 2, an equal count of case wins and losses, each case of [Lost runs](#lost-runs), and a failed and a void confirming check.
4. **The counted run.** Each string of [Counted run](#counted-run), and the join of a check line to its result line by `session`.
5. **The cap.** [Run budget](#run-budget) rule 7: the sum plus the reserve of the next run equal to the cap stops the call. A run with no cost budget reserves the `usd` of its case.
6. **The report keys.** [`report.sh`](#reportsh) rule 2: the report refuses each break of each check. It accepts two cases with two budgets.
7. **The diff rules.** Each rule of [Passed run](#passed-run), the arbitrary-value forms of [Categories](#categories) included.
8. **The refresh.** With an `oauth` entry that expires far in the future, the refresh writes no file, keeps the digest of `auth.json` and writes nothing to stdout.

### Rules with no check, and the reason

- **The live evaluation.** It needs the credential of Ulrich and the cost of real runs. It runs at step 4.3 of the agent gate.
- **A live refresh of an `oauth` entry.** It needs a real login. Unit-level rule 8 covers the refresh with no network request.
- **The case content rules.** They are rules for the case author. The secret pattern run before each commit of the evaluation set enforces rule 4.

## Handoffs to later layers

- [L6](L6-migration.md) part A: add `scripts/evaluation/agent/run.sh`, `report.sh`, `evaluation.mjs` and `evaluation.test.mjs` to the engine, after the step that ships `run agent`. Run the L7 checks in the step that adds them.
- [L6](L6-migration.md) part A: run the L7 checks in a container where the user database gives the home of the test user, as for L2-AC6. Add the new test file to the scripts `test`, `format`, `lint` and `format:check` of `package.json`.
- [L6](L6-migration.md) part A: build the evaluation set: 15 cases under `<data>/evaluation/agent/`, with the content rules. The set is no part of the engine repository.
- [L6](L6-migration.md) part B: remove each role profile with the verdict `leave` from the runtime catalog, after the agent gate.
- [L8](L8-worker-evaluation.md): the worker-level checks against a local KanthorD server, the review cases of `reviewer@1` and `re@1`, and the successor of `~/kanthord-evalset/worker-v2/`.
- [HANDOFF.md](../HANDOFF.md#agent-component), Agent component: the later eval model `openai-codex/gpt-6-luna:max`.

## Decisions

1. **L7-D1.** The agent evaluation is the layer L7, a caller of the agent CLI (Ulrich, 2026-11-22). Constraint: L7 is designed after L3 and before L6 part A; it runs at gate step 4.3 against the built agent; an evaluation with no verdict fails gate step 4.3; the worker evaluation is L8.
2. **L7-D2.** The default eval model is `anthropic/claude-haiku-5-5:high`, and the second eval model is `openrouter/deepseek/deepseek-v4.1-flash:high` (Ulrich, 2026-11-22). Constraint: calibration fixes the level; one evaluation uses one eval model; no `~`-alias id.
3. **L7-D3.** Calibration runs `swe@1` once on each case and fixes the level when the pass share is from 30% to 80%. Constraint: the calibration runs at the fixed level count as repeat 1 of `swe@1`; a level measured before, an edge step or no counted run ends calibration with no verdict.
4. **L7-D4.** The evaluation set has 15 cases: 5 `backend`, 5 `frontend` and 5 `test`. Constraint: scripted hidden checks decide each pass; no LLM decides a pass; the set holds no review case; `repo.bundle` holds no commit after C.
5. **L7-D5.** The `frontend` cases use a synthetic React and Tailwind fixture (Ulrich, 2026-11-22). Constraint: the fixture reproduces the dogfood finding of E1.
6. **L7-D6.** A run passes when it ends `completed`, the diff rules pass and `check.sh` exits `0`. A run with a contaminated session does not count. Constraint: a lost run of a role profile counts as failed, and a lost run of `swe@1` counts as passed. The contamination search is a heuristic.
7. **L7-D7.** Each profile runs each case 2 times (Ulrich, 2026-11-22). Aelita decision: a role profile stays when it passes at least 2 more of its 10 runs than `swe@1`, wins more cases than it loses and passes the confirming check. Constraint: the rule is fixed before the first run.
8. **L7-D8.** The confirming check runs on `anthropic/claude-sonnet-5-5:high`, one run of each case of the category (Ulrich, 2026-11-22). Constraint: R passes no fewer runs than `swe@1`. Aelita decision: the check is void when `swe@1` passes 0 runs or a run ends `budget_end`.
9. **L7-D9.** The evaluation run has no turn limit. The wall budget and the cost budget of each case, fixed in `case.json`, bound each run (Ulrich, 2026-11-22). Constraint: each run of a case gets `--budget <wall> --budget <usd>`; `wall` is at most `2h`; the runner passes no cost budget for `openai-compatible`.
10. **L7-D10.** The total cap of one evaluation is 15 usd list price (Ulrich, 2026-11-22). Aelita decision: calibration and the comparison stop at 10 usd. Constraint: the runner starts a run only below the cap of its phase; a stop at the cap gives no verdict; Ulrich approves the cap before the first live run.
11. **L7-D11.** The evaluation set lies in `<data>/evaluation/agent/`, and the results lie in `<state>/evaluation/runs/<evaluation-id>/` of the KanthorD XDG directories (Ulrich, 2026-11-22). Constraint: each directory has mode `0700`; each workspace lies in a random root under `<state>/evaluation/work/`; the set has no remote; no result is committed.
12. **L7-D12.** The runner is `run.sh`, `report.sh` and `evaluation.mjs` in `scripts/evaluation/agent/` of the engine. Constraint: it calls only the built `kanthord run agent`, git, the case scripts, Node and the exported pi API; the runs go in sequence; a stop gives no verdict, and the same evaluation id resumes it.
13. **L7-D13.** The credential is the KanthorD `auth.json` file at the default `--auth` path. Constraint: no credential value enters a case, a result, a check record or a report; the runner checks the digest and the mode of the file around each run, and counts the credential values after each run.
14. **L7-D14.** The refresh of an `oauth` entry uses `ModelRuntime.create` and `getAuth` of pi with an explicit `authPath` from the user database. Constraint: no pi CLI, no environment variable that selects the file, no proxy of the environment, and no output of the token.
15. **L7-D15. Applied to L1, L2 and the hub.** The L2 comparison rule names the verdict inputs of L7. L1 "Rules with no check" points L1-D16 to L7 unit-level rule 3. The hub gate step 4.1 holds the L7 checks, step 4.3 states that no verdict fails the step, L6 part A holds the runner and the set, and the glossary holds the terms of L7.

## Open questions for Ulrich

1. **Cost of the confirming check.** Aelita recommends a separate cap of 25 usd list price for the confirming check, and a production cost budget for each case in `case.json`. Reason: one Sonnet 5.5 run costs about 0.4 usd to 2.1 usd, so one R costs about 4 usd to 21 usd. The 5 usd that the 15 usd cap leaves covers one R only at the low end. The task budget of Haiku 5.5 also cuts a Sonnet run with `budget_end`.
   - Alternative: confirm on fewer cases, for example 3 of 5. It costs less and gives less evidence.
   - Alternative: keep the 15 usd cap. The check is then void for most R.
2. **Margin of the exit rule.** Aelita recommends a margin of 4 of 10 runs. Reason: take two equal profiles. A margin of 2 keeps a profile after rules 1 and 2 in 20% to 25% of evaluations. A margin of 4 keeps it in 2% to 6%.
   - Alternative: a margin of 3. It keeps a profile in 8% to 13% of evaluations.
   - Alternative: keep a margin of 2. It finds a smaller gain, and about one evaluation in four keeps a profile with no gain.
