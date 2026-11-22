# L7: The agent evaluation

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model, [L2](L2-agent-cli.md) is the agent CLI that this page uses and [L3](L3-agent.md) is the agent that it measures. Each KanthorD path starts at `engine/`. Each pi model fact comes from `@earendil-works/pi-ai` `1.1.0`, `dist/providers/data/<provider>.json`. Each other pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`). The code of today is engine `c864130e`.

## Goals

1. **G1.** The evaluation gives each role profile `bee@1`, `fee@1` and `te@1` a verdict against `swe@1`: keep or leave ([L1-D16](L1-model.md#decisions), [L1-D20](L1-model.md#decisions)).
2. **G2.** The exit rule is fixed before the first run. The same files always give the same verdict.
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
- Ulrich ruled on 2026-11-22: the design of L7 comes right after L3, before L6 part A.
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
4. **Above the band.** The next level is one step down. Calibration runs again at that level, in the same evaluation.
5. **Below the band.** The next level is one step up. Calibration runs again at that level, in the same evaluation.
6. The steps of the default eval model are `low`, `medium`, `high`, `xhigh` and `max`. The steps of the second eval model are `off`, `low`, `high` and `max`.
7. **No verdict.** Calibration ends with no verdict in each of these conditions:
   - the pass share is above the band at the lowest step, or below the band at the highest step;
   - the next level is a level that the evaluation measured before;
   - no run counts (the band verdict `none`);
   - a planned run of the level has no line in `checks.jsonl`.
8. **Fixed level.** The fixed level is the level of the last calibration call with the band verdict `in`.
9. The calibration line of the report names the fixed level for `in`, the next level for `above` or `below`, or "no verdict".
10. The runs of a calibration that does not fix the level count toward the cap, but not toward the comparison.

### Confirming check

Ulrich ruled on 2026-11-22: the production model is `anthropic/claude-sonnet-5-5:high`. The catalog entry is `anthropic.json`, `chat:claude-sonnet-5-5`, "Claude Sonnet 5.5". It accepts each level from `low` to `max`, and its list price is 2 and 10 per MTok.

1. Each role profile R that passes rules 1 and 2 of the [Exit rule](#exit-rule) runs on the production model. It runs once on each case of its group. `swe@1` runs once on the same cases.
2. R passes the confirming check when it passes no fewer runs than `swe@1`.
3. **Void check.** The confirming check gives no verdict when `swe@1` passes 0 runs, or when a run of the check ends `budget_end`. Reason: with no pass of `swe@1`, or with a run that the budget cut, the comparison shows nothing.
4. The [cap](#run-budget) of the evaluation covers the confirming check. Each run gets the case budget of its case, scaled to the production model ([Price ratio](#price-ratio)).
5. **Start.** The `--confirm` call exits `1` and starts no run when a planned run of the comparison has no line in `checks.jsonl`. It exits `0` and starts no run when no R passes rules 1 and 2.

## Evaluation set

(G4, G6)

### Location

Ulrich ruled on 2026-11-22: the evaluation uses the KanthorD XDG directories. `directories(env)` of `src/kernel/xdg.ts` gives each directory, with the same rule as L2.

| Content                                 | Path                                                                        | Mode   |
| --------------------------------------- | --------------------------------------------------------------------------- | ------ |
| The evaluation set                      | `<data>/evaluation/agent/`, a local git repository                          | `0700` |
| The configuration of the evaluation     | `<data>/evaluation/agent/config.json`                                       | `0600` |
| One case                                | `<data>/evaluation/agent/cases/<case-id>/`                                  | `0700` |
| The shared fixture folder of the set    | `<data>/evaluation/agent/shared/`                                           | `0700` |
| The results directory of one evaluation | `<state>/evaluation/runs/<evaluation-id>/`                                  | `0700` |
| The run directory of one run            | `<results directory>/<phase>-<level>/<case-id>/<agent>-<repeat>-<attempt>/` | `0700` |
| The workspace root of one run           | `<state>/evaluation/work/<random>/`                                         | `0700` |

- `<data>` is `directories(env).data`, for example `~/.local/share/kanthord`. `<state>` is `directories(env).state`, for example `~/.local/state/kanthord`.
- The results directory and the workspace root lie outside the pi directory `<state>/pi` ([L2 The pi directory](L2-agent-cli.md#the-pi-directory)). So L2 accepts each session path and output path in them.
- `<evaluation-id>` is a name that the operator gives: letters, digits, `-` and `_`. One evaluation id names one evaluation of one eval model. It holds each phase and each calibration level of that evaluation.
- `<phase>` is `calibrate`, `compare` or `confirm`. `<level>` is the level of the model of the call.
- `<repeat>` is `1` or `2`. `<attempt>` starts at `1`. A new attempt takes the next free number ([Exit codes of a run](#exit-codes-of-a-run)).
- `<random>` is 16 random lowercase letters. The workspace path names no case, no profile and no evaluation.
- Nobody commits a results directory. The evaluation set repository has no remote.

### Configuration

Ulrich ruled on 2026-11-22: the cap is a value that Ulrich can change. `config.json` holds exactly two keys.

| Key          | Value                                                                                      | Question it answers                  |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| `cap_usd`    | A number above 0. The start value is `15`                                                  | How much can one evaluation spend?   |
| `base_model` | `<provider>/<model>` with no level. The value is `openrouter/deepseek/deepseek-v4.1-flash` | Which price list measures the spend? |

- `cap_usd` is a hypothesis. Ulrich sets it again from the measured costs of the report ([`report.sh`](#reportsh), the cost block).
- `run.sh` and `report.sh` read the file at the start of each call. A resumed evaluation reads the value of that time.
- **Price read.** `evaluation.mjs` reads each price with the exported pi API and no credential file:
  - `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`. `ModelRuntime` is an export of `@earendil-works/pi-coding-agent`, and `InMemoryCredentialStore` is an export of `@earendil-works/pi-ai`.
  - `getModel(provider, id)` gives the model. The price is its `cost`: `input`, `output`, `cacheRead`, `cacheWrite` and `tiers`.
  - The same read gives the price of `base_model` and of the `--model` of the call.
- **Refusals.** `run.sh` and `report.sh` exit `1` at the start of the call in each of these conditions:
  - the file is absent, or is no JSON object;
  - the file holds another key;
  - `cap_usd` is not a number above 0;
  - pi gives no model for `base_model`;
  - the base model has no `input`, `output` or `cacheRead` price.

  stderr names the file and the key. A refused call writes no line to `calls.jsonl`.

### Case folder

| File            | Content                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `case.json`     | `group`, `commit`, `wall`, `usd`, `allowed` and `tests`. [Unit-level rules](#unit-level-rules), rule 1, holds the schema        |
| `repo.bundle`   | A git bundle of the case repository, with no remote. It holds only the commit C of `commit` and its ancestors, and no other ref |
| `setup.sh`      | The dependency install for one workspace. It reads only the case folder and the shared fixture folder, and it uses no network   |
| `task.md`       | The case text, the `--prompt` value                                                                                             |
| `repository.md` | The Repository prompt of the case: a heading, one blank line and the text                                                       |
| `binding.md`    | The Binding prompt of `swe@1` for the case, in the same form                                                                    |
| `check/`        | The hidden checks: `check.sh`, the hidden tests and, for the group `test`, the mutants                                          |

- The case id is the name of the case folder.
- `group` is `backend`, `frontend` or `test`. The group gives the role profile of the case ([Groups](#groups)).
- `wall` is the wall budget of the case, for example `30m`. `usd` is the cost budget of the case in base dollars, for example `0.5usd` ([Price ratio](#price-ratio)). `allowed` is the list of path globs that the run can change. `tests` is the list of path globs of the test files of the case repository.
- `setup.sh` installs each dependency into a path that the `.gitignore` of the case repository names. So the start precondition `git_clean` of [L3](L3-agent.md#start-preconditions) still passes.
- No file of `check/` lies in a workspace before the hidden checks run.

### Groups

| Group      | Role profile | Count | Source                                                                                                                                             | Check of the group                                                                                                                                             |
| ---------- | ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend`  | `bee@1`      | 5     | The task texts of the todoapp seeds of Worker V2, the tree at the base of the claim (`.dev/v2-b3/trees`, `~/kanthord-evalset/worker-v2/bases.tsv`) | The hidden tests of the reference node head pass                                                                                                               |
| `frontend` | `fee@1`      | 5     | A synthetic React and Tailwind fixture with design tokens and components of its own (Ulrich, 2026-11-22)                                           | The build and the hidden tests pass. The hidden tests check that the page uses the named components. The diff adds no arbitrary Tailwind value and no CSS file |
| `test`     | `te@1`       | 5     | A synthetic module with 2 or 3 mutants for each case                                                                                               | The new tests pass on the reference code and fail on each mutant                                                                                               |

- The `frontend` fixture reproduces the dogfood finding of [E1](L1-model.md#e1-role-profiles-bee1-fee1-te1-fits-with-a-fit-rule): a session that does not follow the existing interface fails the case.
- **Arbitrary-value rule.** The rule reads each added line of a file that ends in `.tsx`, `.jsx` or `.html`.
  - A class token is a token between spaces inside a string literal or a template literal of the line. A token outside a literal is no class token.
  - The rule splits each class token at each `:` outside brackets. The last part is the utility. The rule fails when a utility holds `[`.
  - Fail: `w-[calc(100%-1rem)]`, `text-[var(--x)]`, `bg-[#fff]`, `[mask-type:luminance]`.
  - Pass: `data-[state=open]:p-2`, `[&>*]:p-2`, `group-[.is-open]:hidden`. The bracket lies in a variant, not in the utility.
  - Pass: `items[0]` and `useState<string[]>([])` outside a literal.
  - `evaluation.mjs` owns the rule ([Unit-level rules](#unit-level-rules), rule 7).
- The evaluation set holds no review case. [L8](L8-worker-evaluation.md) owns the review cases.

### Content rules

1. Each case is synthetic or owned by kanthorlabs. No case holds customer code, a `seed.json` of Worker V2 or a `.env` file. Reason: `seed.json` holds `effective_configuration.credential`, `ssh_public_key` and `known_hosts`.
2. Each commit of a case repository has the author `Kanthor Eval <eval@kanthorlabs.invalid>`.
3. `repo.bundle` holds no commit after C. Reason: a node branch of `.dev/v2-b3/trees` holds the reference solution, and a later commit in the object store defeats the hidden checks.
4. Before each commit of the evaluation set, the case author runs the secret patterns of the engine over the staged files (`findPatternText` of `src/agent/sensitive-text.ts`). A match stops the commit.
5. `setup.sh` copies each file that it takes from the shared fixture folder. It makes no symbolic link into the evaluation set. Reason: a link puts the path of the set into a stack trace, and the [contamination search](#counted-run) then matches an honest run.
6. No path of a case repository holds a string of the [Counted run](#counted-run) list. Reason: the same false match.

## One evaluation run

(G5)

The runner does each step.

1. **Workspace.** Make the run directory and a new workspace root. No two runs share one clone. Run these commands:
   - `git clone --no-hardlinks "$CASE/repo.bundle" "$ROOT/w"`;
   - `git -C "$ROOT/w" checkout --detach "$C"`;
   - `git -C "$ROOT/w" remote remove origin`;
   - `git -C "$ROOT/w" reflog expire --expire=now --all`.

   Reason: the clone writes the absolute path of the bundle into the remote and the reflog. After the last two commands, the workspace holds no path of the case folder.

2. **Setup.** Run `setup.sh` with `w` as the current directory. An exit other than `0` stops the evaluation.
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
8. **Removal.** Remove the workspace root, the clone included. The session file and `stderr.txt` stay in the run directory. The runner also removes the workspace root when the evaluation stops at any step.

- The pi session file is the record of the work. The line in `results.jsonl` holds the identity, the end, the class and the totals of the run ([L2 The result](L2-agent-cli.md#the-result)).
- The runner passes no `--auth`, so `run agent` reads the default `--auth` file ([Credential](#credential)).
- The runs go in sequence. Reason: a pi refresh writes the `auth.json` file, and a subscription has a rate limit.

## Run budget

(G2, G6)

1. **Case budget.** Ulrich ruled on 2026-11-22: each case sets its case budget in `case.json`, a wall budget `wall` and a cost budget `usd`. For reference, the largest Worker V2 execution had a list price of 1.09 usd for 3 units in 35 minutes, on Haiku 5.5 (`baseline.md`, execution `T8TWV9P5`).
2. **No turn limit.** The evaluation run has no turn limit. The wall budget and the cost budget of the case bound each run ([L2 Budget](L2-agent-cli.md#budget), rule 8).
3. **Scaled cost budget.** `usd` is in base dollars. A run of the model m gets `--budget <usd × r(m)>usd` ([Price ratio](#price-ratio)).
4. **No price.** The runner passes no cost budget when the model has no `input` price, for example an `openai-compatible` model. Reason: `run agent` refuses a cost budget for a model with no price, with `cli.run.agent.budget_unpriced` ([L2 Budget](L2-agent-cli.md#budget), rule 6). Such a run has the base cost `0`.
5. **Wall limit.** `wall` is at most `2h`, the default wall budget of `run agent`.
6. **Base cost.** The base cost of a run of the model m is its `list_price_usd` divided by `r(m)`. So a model with a higher price spends more real dollars than its base cost.
7. **One cap.** Ulrich ruled on 2026-11-22: one cap `cap_usd` of [Configuration](#configuration) covers calibration, the comparison and the confirming check. The sum is the base cost of each line of `results.jsonl` of the evaluation, each calibration and each attempt included.
8. **Start gate.** Each run reserves the `usd` of its case, also when the runner passes no cost budget (rule 4). The runner starts a run only when the sum plus that reserve is at or below `cap_usd`. Else it writes the report and exits `4`. The cap is a start gate: the last run can pass the cap. A stop at the cap leaves a planned run with no check line, and the [Exit rule](#exit-rule) decides the verdict.
9. A subscription entry pays no list price, but the cap applies to the base cost ([L2 Budget](L2-agent-cli.md#budget), rule 5).
10. Ulrich approves `cap_usd` before the first live run.

### Price ratio

Ulrich ruled on 2026-11-22: one price ratio converts between the base model and the run model. The ratio assumes a cache-read hit of 80%.

1. **Blended price.** For a model m, in USD per million input-side tokens:

   ```text
   blend(m) = 0.8 × cacheRead(m) + 0.2 × input(m) + 0.02 × output(m)
   ```

   - 0.8 and 0.2: the assumption of Ulrich, 80% cache-read hits on the input side.
   - 0.02: the output tokens for each input-side token in the Worker V2 baseline. The baseline holds 584,888 output tokens against 30.31M input-side tokens, which is 1.9%.
   - For a model with price tiers, each price is the price of the highest tier. Reason: an agent session passes the tier threshold.

2. **Ratio.** `r(m) = blend(m) / blend(base_model)`. `r` is the exact quotient, with no rounding.
3. **Scaled budget.** The runner passes `--budget <usd × r(m)>usd`. An exact multiple of 0.01 stays. Else the value rounds up to the next 0.01. The runner computes the product in cents with integer arithmetic, so `0.3usd` at `r` 1 stays `0.3usd`.
4. The three constants are part of this rule. `config.json` does not hold them.

| Model                            | `cacheRead` | `input` | `output` | `blend` | `r`   |
| -------------------------------- | ----------- | ------- | -------- | ------- | ----- |
| DeepSeek V4.1 Flash, OpenRouter  | 0.006       | 0.30    | 1.20     | 0.0888  | 1     |
| Haiku 5.5, tier above 100k input | 0.05        | 0.50    | 2.50     | 0.19    | ~2.14 |
| Sonnet 5.5                       | 0.20        | 2.00    | 10.00    | 0.76    | ~8.56 |

- The prices are the pi `1.1.0` catalog prices per MTok.
- Check: the baseline Haiku list price, 1.98 usd, divided by the exact base price of its tokens, 0.879 usd, is 2.25. That is near 2.14.

### Cost arithmetic

These estimates use the Worker V2 baseline of Haiku 5.5 at `medium`: 1.98 usd list price for 21 units (`baseline.md`). One run of one case counts as one unit. The baseline tokens are 718 input, 584,888 output, 29,466,368 cache read and 842,513 cache write.

- One Haiku run: about 0.094 usd list price, and 0.094 / 2.14 = about 0.044 base dollars.
- One Sonnet run with the same tokens: 13.85 usd for the 21 units at the Sonnet price, so about 0.66 usd list price, and 0.66 / 8.56 = about 0.077 base dollars.

| Phase                    | Runs                                                        | Base cost  | List price |
| ------------------------ | ----------------------------------------------------------- | ---------- | ---------- |
| Calibration at one level | 15 runs of `swe@1`                                          | about 0.66 | about 1.41 |
| Comparison               | 15 runs of `swe@1` (repeat 2), 30 runs of the role profiles | about 1.98 | about 4.24 |
| Confirming check, one R  | 5 runs of R and 5 runs of `swe@1` on Sonnet 5.5             | about 0.77 | about 6.6  |
| Full plan, three R       | 90 runs                                                     | about 4.96 | about 25.4 |

- `cap_usd` 15 thus holds the full plan in base cost. The report shows the base cost and the list price of each phase.

## Pass rule

(G4)

### Passed run

A run passes when both conditions hold:

1. The line in `results.jsonl` has `end` `completed`.
2. The diff rules pass, and `check.sh` exits `0`.

The diff rules:

- each changed path matches `allowed`;
- no changed path matches `tests`, except for the group `test`;
- no changed file holds a conflict marker;
- for the group `frontend`, the [arbitrary-value rule](#groups) passes, and the diff adds no CSS file.

`check.sh` checks in this order:

1. The build of the case passes.
2. The hidden tests pass.
3. For the group `test`, the new tests also fail on each mutant.

### Counted run

A run does not count when the session file names a protected path. The check record then has `contaminated` `true`. Reason: the profiles of the evaluation are not confined. So a session can read each file of the OS user ([L1 Reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session)).

The rule is a heuristic. pi records the tool call arguments as the model wrote them and the tool result text. It records no path that a tool resolved. `evaluation.mjs` searches the whole session file for each of these strings:

- the absolute path of the evaluation set, of the results directory and of the case folder;
- the path parts `evaluation/agent`, `evaluation/runs` and `/check/`;
- the file names `check.sh`, `checks.jsonl`, `results.jsonl`, `calls.jsonl`, `report.md`, `config.json`, `session.jsonl` and `stderr.txt`.

A path that a shell builds from parts, a glob or a cut output can pass the search.

### Lost runs

A lost run is a run that does not count.

1. A lost run of a role profile counts as a failed run.
2. A lost run of `swe@1` counts as a passed run.

Reason: a lost run then never helps the role profile. The rule keeps a profile only on evidence.

### Exit codes of a run

| Exit of `run agent`                           | Runner action                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`                                           | The diff rules and the hidden checks decide the pass                                                                                                   |
| `4`, `5`                                      | The run fails. Its checks still run, so the check record exists                                                                                        |
| `75`                                          | The run starts again with a new session file and a new workspace, as the next attempt. The third exit `75` of one run in one call stops the evaluation |
| `1`, `2`                                      | The evaluation stops                                                                                                                                   |
| stderr holds `cli.run.agent.prompt_text_path` | The evaluation stops. Reason: a prompt file did not reach the run ([L2 Text or path](L2-agent-cli.md#text-or-path))                                    |

- Each line of `results.jsonl` stays, the lines of a retried run included ([L2 Comparison rule](L2-agent-cli.md#comparison-rule)).
- **Stop.** A stopped evaluation writes the report. The runner exits `1`. A stop leaves a planned run with no check line, and the [Exit rule](#exit-rule) decides the verdict.
- **Resume.** A later call with the same evaluation id and phase resumes the evaluation. The resume key of a run is the phase, the level, the case, the agent and the repeat. The runner skips each run whose key has a line in `checks.jsonl`. A run that starts again takes the next free attempt number, so no run uses a session file twice.
- **Planned runs.** The planned runs of a call are the runs that its phase names in [`run.sh`](#runsh). The planned runs of R are its `compare` runs, the `swe@1` runs of the comparison on the group of R, and, when R passes rules 1 and 2 of the [Exit rule](#exit-rule), the `confirm` runs of R and of `swe@1`.

### Check record

Each line of `checks.jsonl` holds `phase`, `case`, `repeat`, `session`, `pass` and `contaminated`.

| Field          | Reader                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `phase`        | The report: the set of each line. The resume key                                                       |
| `case`         | The report: the passes for each case and the case wins of the exit rule. The resume key                |
| `repeat`       | The resume key                                                                                         |
| `session`      | The join of the line to its line in `results.jsonl`, which gives `agent`, `reasoning_effort` and `end` |
| `pass`         | The report and the exit rule                                                                           |
| `contaminated` | The report and the lost-run rule                                                                       |

### Call record

Each call of `run.sh` that passes its start checks appends one line to `<results directory>/calls.jsonl` at its end. The line holds `phase`, `cap_usd`, `exit` and `unstarted`. A call that a start check or a configuration refusal ends writes no line.

| Field       | Reader                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| `phase`     | The report: the cost block of each phase                                                  |
| `cap_usd`   | The report: the cap that each phase ran under                                             |
| `exit`      | The report: it selects the calls with exit `4`                                            |
| `unstarted` | The report: the count of planned runs that the cap did not start, from the last such call |

## Exit rule

(G1, G2)

Ulrich ruled on 2026-11-22: the exit rule is fixed before the first run, and the evaluation has 2 repeats. Each profile thus has 10 runs for each group: 5 cases and 2 repeats. The rule applies to each role profile R on its own group. [Lost runs](#lost-runs) apply.

1. **Margin.** passes(R) − passes(`swe@1`) is 4 or more (Ulrich, 2026-11-22). Reason: take two equal profiles with independent runs. A margin of 4 then keeps a profile after rules 1 and 2 in 2% to 6% of evaluations.
2. **Case wins.** R passes more runs than `swe@1` on more cases than the cases where `swe@1` passes more runs than R.
3. **Confirming check.** R passes the [confirming check](#confirming-check).

- R stays in the catalog when rules 1, 2 and 3 hold. Else R leaves the catalog ([L1-D16](L1-model.md#decisions)).
- **No verdict.** `report.sh` gives no verdict for R in each of these conditions. This list is the only no-verdict rule of a role profile.
  - a planned run of R has no line in `checks.jsonl` ([Planned runs](#exit-codes-of-a-run));
  - the confirming check of R is void.

## Runner

(G5)

The runner is a set of scripts in the engine repository: `scripts/evaluation/agent/` ([Handoffs](#handoffs-to-later-layers)). It calls only the built `kanthord run agent`, git, the case scripts and Node. `evaluation.mjs` calls the exported pi API for the refresh and the price of `base_model`. The runner adds no engine command.

### `run.sh`

```text
run.sh --model <provider>/<model>:<level> --evaluation <id> [--calibrate | --confirm]
```

| Option         | Question it answers                     | Rule                                                                                                                                              |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model`      | Which model runs the agents?            | Required. The form of [L2 Model selection](L2-agent-cli.md#model-selection)                                                                       |
| `--evaluation` | Which evaluation do the results join?   | Required. The evaluation id                                                                                                                       |
| `--calibrate`  | Does the call measure the level?        | Optional. Only `swe@1` runs, once on each case. The phase is `calibrate`                                                                          |
| `--confirm`    | Does the call run the confirming check? | Optional. Only the role profiles that pass rules 1 and 2 of the exit rule and `swe@1` run, once on each case of the group. The phase is `confirm` |

- The evaluation set and its configuration are the fixed paths of [Location](#location).
- With no `--calibrate` and no `--confirm`, the phase is `compare`. The call runs repeat 2 of `swe@1` and repeats 1 and 2 of each role profile on its group.
- The run order is fixed: the cases in byte order of the case id; for each case `swe@1`, then the role profile of the case; then the repeats.
- A comparison call exits `1` and starts no run in each of these conditions:
  - the last calibration of the evaluation has no band verdict `in`;
  - `--model` is not the model and the level of that calibration.
- A `--confirm` call follows the start rule of [Confirming check](#confirming-check), rule 5.
- The runner refuses `NODE_USE_ENV_PROXY` in its environment and `--use-env-proxy` in `NODE_OPTIONS` with exit `1` ([Credential](#credential), rule 4).
- The runner exits `0` when each run of the call ends, `1` at a stop, and `4` at the cap.

### `report.sh`

```text
report.sh --evaluation <id>
```

1. It reads `results.jsonl`, `checks.jsonl` and `calls.jsonl` of the evaluation, and `config.json`.
2. It joins each check line to its result line by `session`. It forms two sets:
   - the comparison set: the calibration lines at the fixed level and the `compare` lines;
   - the confirm set: the `confirm` lines.
3. It checks the keys of [L2-D15](L2-agent-cli.md#decisions):
   - each line of the file has one `engine_version`;
   - each set, and each calibration level, has one `provider`, `model` and `reasoning_effort`;
   - inside one set, the lines of one case have one `input_digest` and one `budget`;
   - inside one set, the lines of one case and one profile have one `system_prompt_digest`.

   It refuses a file that breaks a check. It exits `1` and names the first two lines.

4. It writes `report.md` in the results directory:
   - one calibration line for each level: the level, the pass share, the band verdict `in`, `above`, `below` or `none`, and the text of [Calibration](#calibration), rule 9;
   - one table for each group that has a case, from the comparison set, with these columns: profile, counted runs, passes, pass rate and passes for each case; then the count of `budget_end`, of `failed` and of contaminated runs; then the median `duration_ms`, the median `tool_calls` and the sum of the base cost;
   - one verdict line for each role profile of a group that has a case: `keep`, `leave` with the number of each exit rule that fails, or `no verdict`;
   - the cost block.
   - The pass share shows one fraction digit, for example `33.3%`. The band compares the exact fraction.
5. **Cost block.** For each phase and each model, the block holds:
   - the sum of `list_price_usd`, the `r` of the model and the sum of the base cost;
   - the mean and the maximum base cost of one run, over the result lines that have a check line;
   - the `cap_usd` of each call of the phase, from `calls.jsonl`;
   - the `unstarted` of the last call of the phase with exit `4`, else `0`.

   One total line follows: the projected base cost of the full plan, and the current `cap_usd`.
   - The full plan follows the case count N of the set and the case count of each group: N calibration runs, 3N comparison runs, and 2 runs for each case of the group of each role profile in the confirming check.
   - The projection is the count of planned runs times the mean base cost of one run.
   - With no line, each sum is `0`, the mean and the maximum are `none`, and the projection is `none`.

6. The report holds no text of a session file and no credential value.

## Credential

(G6)

1. The credential is the KanthorD `auth.json` file, the default `--auth` path of `run agent`: `<home>/.config/kanthord/auth.json` ([L2-D10](L2-agent-cli.md#decisions)). It holds the `anthropic` entry for the default eval model and the production model, and the `openrouter` entry for the second eval model.
2. No credential value enters a case, a line of `results.jsonl`, `checks.jsonl` or `calls.jsonl`, a report or the evaluation set.
3. **Refresh.** Before each run with an `oauth` entry, `evaluation.mjs` refreshes the entry with the exported pi API and discards the result:
   - `ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })` (`dist/core/model-runtime.d.ts`);
   - `getAuth("anthropic", { minOAuthValidityMs })`.
   - `authPath` is `<home>/.config/kanthord/auth.json`, and `<home>` is `homedir` of `os.userInfo()`. No environment variable selects the file.
   - `minOAuthValidityMs` is the `wall` of the run plus 10 minutes. pi stores the expiry of a new token 5 minutes before the expiry that the provider gives. So the refresh succeeds only when `wall` plus 15 minutes is less than the token lifetime of the provider.
   - A thrown error or an `undefined` result stops the evaluation with exit `1`. The runner prints no error text of pi. Reason: the error text of a refresh can hold the response body.
   - The refresh writes nothing to stdout or stderr. An `api_key` entry needs no refresh.
4. **No proxy.** The refresh request uses no proxy of the environment. The runner refuses `NODE_USE_ENV_PROXY` and `--use-env-proxy`, as `run agent` does ([L2 Proxy settings](L2-agent-cli.md#proxy-settings)). `evaluation.mjs` sets no global dispatcher.
5. **No write by the run.** The runner records the SHA-256 digest and the mode of the `auth.json` file after the refresh and after the run. The two digests are equal, and the mode is `0600` at both times. The configuration directory `<home>/.config/kanthord` gets no new entry. Else the evaluation stops.
6. **No credential in a session file.** After each run, the runner counts the credential values of the entry in the session file of the run. It counts before the next refresh. It prints only the count, as step 3 of the [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) does. A count other than `0` stops the evaluation.
7. **Provisioning.** Ulrich provisions each provider of the evaluation once, with these steps:
   1. Make a private temporary directory with mode `0700`.
   2. Log in with pi with `PI_CODING_AGENT_DIR` set to that directory.
   3. Move its `auth.json` to `<home>/.config/kanthord/auth.json`, with mode `0600`. For a second provider, add its entry to that file.
   4. Remove the temporary directory.

   Nobody copies an `oauth` entry from another file. Reason: two files with one refresh token break each other at the first refresh. The pi login writes other pi files, so it never runs in `<home>/.config/kanthord`.

## Acceptance checks

(G7)

Each check is an end-to-end test ([index](index.md#reading-order)). It runs the `run.sh` or `report.sh` of the engine repository as a process. Each run calls the built `kanthord run agent`, with a real file system, real git and the real pi runtime. The only stub is the LLM stub of [L2](L2-agent-cli.md#l2-fixtures) on loopback.

### L7 fixtures

L7 adds these details to the [L2 fixtures](L2-agent-cli.md#l2-fixtures).

- **Set.** An evaluation set repository E under `$XD/kanthord/evaluation/agent/`, where `XDG_DATA_HOME` is `$XD`.
  - E holds three cases `b1`, `b2` and `b3` with the group `backend`, `wall` `10m` and `usd` `0.5usd`. The `allowed` of each case is `["ok.txt", "b2.txt", "b3.txt"]`, and its `tests` is `["test/**"]`.
  - The `repo.bundle` of each case holds one commit C with the file `README.md` (text `case`) and a `.gitignore` with the line `node_modules/`. The author is the author of content rule 2. `commit` is the id of C.
  - The `setup.sh` of each case exits `0` and writes no file.
  - The `repository.md` of each case holds `# Repository` and the text `fixture`. The `binding.md` holds `# Binding` and the text `fixture`.
  - The `check.sh` of `b1` exits `0` when `w/ok.txt` holds `ok`. The `check.sh` of `b2` exits `0` when `w/b2.txt` holds `ok`. The `check.sh` of `b3` exits `0` when `w/b3.txt` holds `ok`. Else each exits `1`.
  - The `task.md` of each case holds `task b1`, `task b2` or `task b3`.
  - `config.json` holds `cap_usd` `15` and `base_model` `openrouter/deepseek/deepseek-v4.1-flash`.
- **Stub.** The scripted answers depend on the model id and on the Role in the system prompt. Each answer reports a `usage` of 1000 input and 100 output tokens.
  - Model `stub-1`, `swe@1`: call `write` with `ok.txt` and the text `ok`, then answer `done`.
  - Model `stub-1`, `bee@1`: answer `done` with no tool call.
  - Models `stub-2` and `stub-3`, `bee@1`: call `write` with `ok.txt`, `b2.txt` and `b3.txt`, each with the text `ok`, then answer `done`.
  - Models `stub-2` and `stub-3`, `swe@1` with the task `task b1`: call `write` with `ok.txt` and the text `ok`, then answer `done`.
  - Models `stub-2` and `stub-3`, `swe@1` with the task `task b2` or `task b3`: answer `done` with no tool call.
- **Auth.** The `--auth` file of L2 at `$H/.config/kanthord/auth.json`, the default path, with K. The user database gives H as the home of the OS user. Its `OPENAI_COMPATIBLE_MODELS` lists `stub-1`, `stub-2` with `reasoning_levels` `["off", "high"]`, and `stub-3` (`approvedModelSchema` in `src/llm/platforms.ts`).
- **Model.** `openai-compatible/stub-1:off`. The runner passes no cost budget for it ([Run budget](#run-budget), rule 4).
- **R.** The results directory `$XS/kanthord/evaluation/runs/<evaluation-id>/`, where `XDG_STATE_HOME` is `$XS`.
- **Own paths.** Each check and each variant has its own `$XD`, `$XS` and E, unless the check states otherwise. The two pairs of variant 1 of L7-AC2 share them.

### Checks

1. **L7-AC1. A comparison gives a verdict from the hidden checks.**
   - Fixture: Set, Stub, Auth, Model.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation e1 --calibrate`, then the same command with no `--calibrate`, then `report.sh --evaluation e1`.
   - Assert: each command exits `0`.
     - `R/results.jsonl` holds 12 lines: 6 of `swe@1` and 6 of `bee@1`. The lines of one case have one `input_digest`.
     - `R/checks.jsonl` holds 12 lines, one for each `session` of `results.jsonl`. The 2 lines of `swe@1` on `b1` have `pass` `true`. Each other line has `pass` `false`.
     - `R/report.md` holds the calibration line with the pass share `33.3%`, the band verdict `in` and the fixed level `off`, and the verdict line `bee@1 leave` with the failed rules 1 and 2.
     - The cost block holds, for `calibrate` and for `compare`, the list price `0`, the `r` `none` and the base cost `0`. Reason: the stub model has no price ([Run budget](#run-budget), rule 4). It holds the cap `15` for each phase, and the projection `0`.
     - Each run directory under `R/calibrate-off/` and `R/compare-off/` holds `session.jsonl` and `stderr.txt`, and no other file.
     - No workspace root remains under `$XS/kanthord/evaluation/work/`. `git -C E status --porcelain` prints nothing.

2. **L7-AC2. A stop gives no verdict, and a resume completes the call.**
   - Fixture: Set, Auth, Model.
   - Variant 1: Stub answers HTTP 429 to each request. Command: `run.sh --model openai-compatible/stub-1:off --evaluation e2 --calibrate`, then `report.sh --evaluation e2`. Then Stub answers as usual, and the same two commands run again.
     - Assert, first pair: `run.sh` exits `1`. `R/results.jsonl` holds 3 lines of `swe@1` on `b1`, each with `class` `retryable` and each with its own `session` and `workspace`. `R/checks.jsonl` holds no line. `R/report.md` holds the calibration line "no verdict".
     - Assert, second pair: `run.sh` exits `0`. The run of `swe@1` on `b1` uses the run directory `swe@1-1-4`. `R/checks.jsonl` holds 3 lines. `R/report.md` holds the band verdict `in`.
   - Variant 2: Stub as usual. Auth has no entry for `openai-compatible`. Command: as in variant 1.
     - Assert: `run.sh` exits `1`. `R/results.jsonl` holds no line. The `stderr.txt` of the run starts with `cli.run.agent.auth_entry_missing`. `R/report.md` exists.
   - Variant 3: Stub as usual. The `setup.sh` of `b1` exits `1`. Command: as in variant 1.
     - Assert: `run.sh` exits `1`. Stub receives no request. No workspace root remains.
   - Variant 4: Stub as usual. Command: `run.sh --model openai-compatible/stub-1:off --evaluation e2b` with no calibration before it.
     - Assert: exit `1`. Stub receives no request.

3. **L7-AC3. A contaminated run does not count.**
   - Fixture: Set, Auth, Model. Variant 1: Stub for `swe@1` calls `read` with the absolute path of `E/cases/b1/check/check.sh`, then calls `write` with `ok.txt` and the text `ok`, then answers `done`. Variant 2: the same, with `bash` and the command `cat ../../../runs/e3/calibrate-off/b1/swe@1-1-1/stderr.txt` in place of the `read`.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation e3 --calibrate`, then `report.sh --evaluation e3`.
   - Assert: each command exits `0`. Each of the 3 lines of `R/checks.jsonl` has `contaminated` `true`. `R/report.md` shows 0 counted runs and 3 contaminated runs for `swe@1`, and the band verdict `none` with "no verdict".
   - Variant 3: Stub for `swe@1` calls `bash` with the command `git remote -v; git reflog; cat .git/config`, then calls `write` with `ok.txt` and the text `ok`, then answers `done`. Command: as above, with the evaluation id `e3c`.
     - Assert: each command exits `0`. Each of the 3 lines of `R/checks.jsonl` has `contaminated` `false`. The 3 session files hold no path of E.

4. **L7-AC4. The cap stops the evaluation before a run.**
   - Fixture: Set, Stub, Auth, Model. The `usd` of each case is `16usd`.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation e4 --calibrate`, then `report.sh --evaluation e4`.
   - Assert: `run.sh` exits `4`. Stub receives no request. `R/results.jsonl` holds no line. `R/calls.jsonl` holds one line with `phase` `calibrate`, `cap_usd` `15`, `exit` `4` and `unstarted` `3`.
     - `R/report.md` holds the calibration line of `off` with the band verdict `none` and "no verdict", and the line `bee@1 no verdict`.
     - Its cost block holds the base cost `0`, the mean `none`, the cap `15`, the `unstarted` `3` and the projection `none`.

5. **L7-AC5. A credential value in a session file stops the evaluation.**
   - Fixture: Set, Stub, Auth, Model. Stub for `swe@1`: the answer text holds K once, after the `write` call.
   - Command: `run.sh --model openai-compatible/stub-1:off --evaluation e5 --calibrate`, then `report.sh --evaluation e5`.
   - Assert: `run.sh` exits `1` after the first run. Its stdout holds the count `1` and no other part of K. `R/results.jsonl`, `R/checks.jsonl`, `R/calls.jsonl`, `R/report.md` and each `stderr.txt` hold K zero times. Auth has the same SHA-256 digest and mode `0600` before and after. `E` holds K zero times.

6. **L7-AC6. A role profile that wins on both models stays.**
   - Fixture: Set, Stub, Auth.
   - Command: `run.sh --model openai-compatible/stub-2:off --evaluation e6 --calibrate`, then the same with no `--calibrate`, then `run.sh --model openai-compatible/stub-3:off --evaluation e6 --confirm`, then `report.sh --evaluation e6`.
   - Assert: each command exits `0`.
     - The calibration of `swe@1` passes 1 of 3 runs, the band verdict `in`.
     - In the comparison set, `swe@1` passes 2 of 6 runs and `bee@1` passes 6 of 6 runs: the margin 4. `bee@1` wins on `b2` and `b3`, and no case is a loss.
     - The `--confirm` call runs `bee@1` and `swe@1` once on each case, under `R/confirm-off/`. `bee@1` passes 3 runs and `swe@1` passes 1 run.
     - The confirm lines have the model `stub-3`, and `report.sh` accepts the file.
     - `R/report.md` holds the verdict line `bee@1 keep`.

7. **L7-AC7. A second calibration level joins the same evaluation.**
   - Fixture: Set, Stub, Auth.
   - Command: `run.sh --model openai-compatible/stub-2:off --evaluation e7 --calibrate`, then `run.sh --model openai-compatible/stub-2:high --evaluation e7 --calibrate`, then `report.sh --evaluation e7`.
   - Assert: each command exits `0`.
     - The run directories are `R/calibrate-off/b1/swe@1-1-1`, `R/calibrate-off/b2/swe@1-1-1`, `R/calibrate-off/b3/swe@1-1-1` and the same three under `R/calibrate-high/`.
     - `R/checks.jsonl` holds 6 lines.
     - `R/report.md` holds two calibration lines. Each has the pass share `33.3%` and the band verdict `in`. The line of `high` names the fixed level `high`.

### Unit-level rules

These rules hold with no process and no LLM stub, so their tests are unit tests ([index](index.md#reading-order)). The owning module is `scripts/evaluation/agent/evaluation.mjs` of the engine, with its test file `evaluation.test.mjs`. [L6](L6-migration.md) assigns the exact file.

1. **The case schema.** `case.json` holds exactly `group`, `commit`, `wall`, `usd`, `allowed` and `tests`. `group` matches a row of [Groups](#groups). `commit` is a full hexadecimal commit id. `wall` is a wall budget of [L2 Budget](L2-agent-cli.md#budget), rule 1, of at most `2h`. `usd` is a cost budget of rule 2. The schema refuses each other value.
2. **The calibration band.** A pass share of 30% and of 80% is `in`. 29.9% is `below`. 80.1% is `above`. No counted run is `none`. The band compares the exact fraction, so 1 of 3 is `in`, and the report shows `33.3%`. The next level follows the steps of [Calibration](#calibration), rule 6. Each condition of rule 7 gives no verdict. The fixed level is the level of the last call with `in`.
3. **The exit rule.** Each rule of [Exit rule](#exit-rule): a margin of 3 and of 4, an equal count of case wins and losses, each case of [Lost runs](#lost-runs), a planned run with no check line, and a failed and a void confirming check. The planned runs of R include its confirm runs when R passes rules 1 and 2.
4. **The counted run.** Each string of [Counted run](#counted-run), and the join of a check line to its result line by `session`.
5. **The cap.** [Run budget](#run-budget), rules 6 to 8: the base cost is `list_price_usd / r`; a model with no price has the base cost `0`; the sum plus the reserve equal to `cap_usd` starts the run; one cent above stops the call. A run with no cost budget reserves the `usd` of its case.
6. **The price ratio.** Each rule of [Price ratio](#price-ratio): `blend` of the three models of its table; the highest tier of a model with tiers; `r` 1 for the base model, so `0.3usd` stays `0.3usd`; an exact multiple of 0.01 stays, and another product rounds up to the next 0.01.
7. **The diff rules.** Each rule of [Passed run](#passed-run), with each fail form and each pass form of the arbitrary-value rule of [Groups](#groups).
8. **The configuration.** Each refusal of [Configuration](#configuration).
9. **The report keys.** [`report.sh`](#reportsh), rule 3: the report refuses each break of each check. It accepts two cases with two budgets, and a confirm set with another model.
10. **The run action.** Each row of [Exit codes of a run](#exit-codes-of-a-run): the exits `0`, `1`, `2`, `4`, `5` and `75`, the third exit `75` of one run in one call, and `cli.run.agent.prompt_text_path` in stderr. The next free attempt number of a resumed run.
11. **The start checks.** The refusal of `NODE_USE_ENV_PROXY` and of `--use-env-proxy` in `NODE_OPTIONS`. The refusal of a comparison call with no band verdict `in`, and with a `--model` that is not the calibrated model and level. The exit `1` of a `--confirm` call on an incomplete comparison set, and the exit `0` with no run when no R passes rules 1 and 2. A refused call writes no line to `calls.jsonl`.
12. **The credential state.** A changed digest, a changed mode, a mode other than `0600`, and a new entry in the configuration directory each stop the evaluation.
13. **The refresh.** With an `oauth` entry that expires far in the future, the refresh writes no file, keeps the digest of `auth.json` and writes nothing to stdout or stderr. A thrown error and an `undefined` result each give the stop, with no error text of pi.
14. **The price read.** The price read of [Configuration](#configuration) creates no entry in `<home>/.config/kanthord` and reads no credential file. It gives the base prices 0.30, 1.20 and 0.006.

### Rules with no check, and the reason

- **The live evaluation.** It needs the credential of Ulrich and the cost of real runs. It runs at step 4.3 of the agent gate.
- **A live refresh of an `oauth` entry.** It needs a real login. Unit-level rule 13 covers the refresh with no network request.
- **The case content rules.** They are rules for the case author. The secret pattern run before each commit of the evaluation set enforces rule 4.
- **Provisioning.** It needs a real login by Ulrich.

## Handoffs to later layers

- [L6](L6-migration.md) part A: add `scripts/evaluation/agent/run.sh`, `report.sh`, `evaluation.mjs` and `evaluation.test.mjs` to the engine, after the step that ships `run agent`. Run the L7 checks in the step that adds them.
- [L6](L6-migration.md) part A: run the L7 checks in a container where the user database gives the home of the test user, as for L2-AC6. Add the new test file to the scripts `test`, `format`, `lint` and `format:check` of `package.json`.
- [L6](L6-migration.md) part A: give the L7 test file a timeout above 60 seconds. Reason: variant 1 of L7-AC2 waits for three attempts with three pi retries each, about 42 seconds.
- [L6](L6-migration.md) part A: build the evaluation set: 15 cases and `config.json` under `<data>/evaluation/agent/`, with the content rules. The set is no part of the engine repository.
- [L6](L6-migration.md) part B: remove each role profile with the verdict `leave` from the runtime catalog, after the agent gate.
- [L8](L8-worker-evaluation.md): the worker-level checks against a local KanthorD server, the review cases of `reviewer@1` and `re@1`, and the successor of `~/kanthord-evalset/worker-v2/`.
- [HANDOFF.md](../HANDOFF.md#agent-component), Agent component: the later eval model `openai-codex/gpt-6-luna:max`.

## Decisions

1. **L7-D1.** The agent evaluation is the layer L7, a caller of the agent CLI (Ulrich, 2026-11-22). Constraint: the design of L7 comes after L3 and before L6 part A; it runs at gate step 4.3 against the built agent; an evaluation with no verdict fails gate step 4.3; the worker evaluation is L8.
2. **L7-D2.** The default eval model is `anthropic/claude-haiku-5-5:high`, and the second eval model is `openrouter/deepseek/deepseek-v4.1-flash:high` (Ulrich, 2026-11-22). Constraint: calibration fixes the level; one evaluation uses one eval model; no `~`-alias id.
3. **L7-D3.** Calibration runs `swe@1` once on each case and fixes the level when the pass share is from 30% to 80%. Constraint: the calibration runs at the fixed level count as repeat 1 of `swe@1`; a level measured before, an edge step or no counted run ends calibration with no verdict; each level of one evaluation has its own run directories.
4. **L7-D4.** The evaluation set has 15 cases: 5 `backend`, 5 `frontend` and 5 `test`. Constraint: scripted hidden checks decide each pass; no LLM decides a pass; the set holds no review case; `repo.bundle` holds no commit after C.
5. **L7-D5.** The `frontend` cases use a synthetic React and Tailwind fixture (Ulrich, 2026-11-22). Constraint: the fixture reproduces the dogfood finding of E1.
6. **L7-D6.** A run passes when it ends `completed`, the diff rules pass and `check.sh` exits `0`. A run with a contaminated session does not count. Constraint: a lost run of a role profile counts as failed, and a lost run of `swe@1` counts as passed; a planned run with no check line gives no verdict; the contamination search is a heuristic.
7. **L7-D7.** Each profile runs each case 2 times. A role profile stays when it passes at least 4 more of its 10 runs than `swe@1`, wins more cases than it loses and passes the confirming check (Ulrich, 2026-11-22). Constraint: the rule is fixed before the first run.
8. **L7-D8.** The confirming check runs on `anthropic/claude-sonnet-5-5:high`, one run of each case of the group (Ulrich, 2026-11-22). Constraint: R passes no fewer runs than `swe@1`; the check is void when `swe@1` passes 0 runs or a run ends `budget_end`.
9. **L7-D9.** The evaluation run has no turn limit. The wall budget and the cost budget of each case, fixed in `case.json`, bound each run (Ulrich, 2026-11-22). Constraint: `wall` is at most `2h`; the runner passes no cost budget for `openai-compatible`.
10. **L7-D10.** One cap `cap_usd` in `config.json` covers each phase of one evaluation. The cap is in base dollars, the price of `base_model` `openrouter/deepseek/deepseek-v4.1-flash` (Ulrich, 2026-11-22). Constraint: `cap_usd` starts at 15 as a hypothesis, and Ulrich sets it again from the measured costs; the base cost of a run is its `list_price_usd` divided by `r`; the cap is a start gate, and a run starts only when the sum plus the case reserve is at or below `cap_usd`; Ulrich approves `cap_usd` before the first live run.
11. **L7-D11.** The evaluation set lies in `<data>/evaluation/agent/`, and the results lie in `<state>/evaluation/runs/<evaluation-id>/` of the KanthorD XDG directories (Ulrich, 2026-11-22). Constraint: each directory has mode `0700`; each run directory names its phase and level; each workspace is a new clone in a random root under `<state>/evaluation/work/`; the set has no remote; nobody commits a result.
12. **L7-D12.** The runner is `run.sh`, `report.sh` and `evaluation.mjs` in `scripts/evaluation/agent/` of the engine. Constraint: it calls only the built `kanthord run agent`, git, the case scripts, Node and the exported pi API; the runs go in sequence; a stop leaves a planned run with no check line, and the same evaluation id resumes it by the key phase, level, case, agent and repeat.
13. **L7-D13.** The credential is the KanthorD `auth.json` file at the default `--auth` path. Constraint: no credential value enters a case, a result, a check record, a call record or a report; the runner checks the digest and the mode of the file around each run, and counts the credential values after each run; provisioning uses a private temporary pi directory and one move of `auth.json`.
14. **L7-D14.** The refresh of an `oauth` entry uses `ModelRuntime.create` and `getAuth` of pi with an explicit `authPath` from the user database. Constraint: no pi CLI, no environment variable that selects the file, no proxy of the environment, no output of the token, and no error text of pi.
15. **L7-D15. Applied to L1, L2 and the hub.** The L2 comparison rule names the verdict inputs of L7. L1 "Rules with no check" points L1-D16 to L7 unit-level rule 3. The hub gate step 4.1 holds the L7 checks, step 4.3 states that no verdict fails the step, L6 part A holds the runner and the set, and the glossary holds the terms of L7.
16. **L7-D16.** The case budget `usd` of a case is in base dollars. The runner scales it to each model with one price ratio `r(m) = blend(m) / blend(base_model)`, where `blend(m) = 0.8 × cacheRead(m) + 0.2 × input(m) + 0.02 × output(m)` (Ulrich, 2026-11-22). Constraint: the ratio assumes a cache-read hit of 80%; a model with price tiers uses its highest tier; the constants are part of the rule; an exact multiple of 0.01 stays, else the scaled budget rounds up to the next 0.01.
17. **L7-D17. Applied to L1, L2 and the hub.** L1-D16 states the margin of 4. The L2 result section points to the L7 verdict inputs, and the L2 comparison rule compares `system_prompt_digest` for each case. The hub glossary holds the term group and the new definition of case.
18. **L7-D18.** The price read uses the exported pi API with an in-memory credential store. Constraint: the price read opens no credential file.
19. **L7-D19.** Each workspace is a clone with no remote and no reflog. Constraint: no path of the case folder stays in the workspace.
20. **L7-D20. Applied to L2 and the hub.** L2-D15 and the L2 comparison rule name a new clone of the case commit. The hub glossary holds the terms base model and base cost.

## Open questions for Ulrich

None.
