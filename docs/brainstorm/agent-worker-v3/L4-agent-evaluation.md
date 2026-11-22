# L4: The agent evaluation

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model, [L2](L2-agent-cli.md) is the agent CLI that this page uses and [L3](L3-agent.md) is the agent that it measures. Each KanthorD path starts at `engine/`. Each pi model fact comes from `@earendil-works/pi-ai` `1.1.0`, `dist/providers/data/<provider>.json`. Each other pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`). The code of today is engine `c864130e`.

## Goals

1. **G1.** `swe@1` reaches fixed goals on the evaluation set. Each change of its prompt comes from an evaluation finding and shows an effect above the run-to-run noise ([L1-D16](L1-model.md#decisions), [L1-D20](L1-model.md#decisions)).
2. **G2.** Ulrich fixes the [stage gate](#stage-gate) before the first run. The same files always give the same verdict.
3. **G3.** Scripted checks decide each pass. The Opus diagnosis explains the failures and never decides a pass.
4. **G4.** The grading follows [DeepSWE v1.1](#grading-method): the agent diff applies to a new clone of the base commit, and the agent has no control of the hidden tests.
5. **G5.** The evaluation uses only `kanthord run agent` and the result file of L2. It adds no engine command and no server call.
6. **G6.** Each credential rule of L2 holds for each run. No credential value enters a case, a result, a check record, a diagnosis or a report.
7. **G7.** Each public behavior of L4 is an end-to-end acceptance check or a unit-level rule with its owning module ([index](index.md#reading-order)).
8. **G8.** Each evaluation has a fixed spend limit in base dollars.

## Goal aspects

(G1, G3)

Each run of `swe@1` has one result for each goal aspect.

| Aspect | Name              | Question                                                                                          | Decided by                                                                                                 | Effect                                   |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| A1     | Correctness       | Do the hidden tests that fail on the base commit pass with the agent diff?                        | Scripted: `check.sh <dir> fail_to_pass` in the grading clone ([Grading](#grading))                         | Part of the pass                         |
| A2     | No regression     | Do the tests that pass on the base commit still pass with the agent diff?                         | Scripted: `check.sh <dir> pass_to_pass` in the grading clone                                               | Part of the pass                         |
| A3     | Scope discipline  | Does the diff change only the paths of the case scope?                                            | Scripted: the [scope rules](#scope-rules) on the agent diff                                                | Part of the pass                         |
| A4     | Repository fit    | Does the diff follow the conventions of the case repository?                                      | Scripted: `check.sh <dir> conventions` and, for the kind `frontend`, the [frontend rules](#frontend-rules) | Part of the pass                         |
| A5     | Self-verification | Did the agent run the build and the tests before its final answer?                                | Opus diagnosis ([Diagnosis](#diagnosis))                                                                   | Counted in the report. Never a pass rule |
| A6     | Honest report     | Does the final answer state the true state of the work?                                           | Opus diagnosis                                                                                             | Counted in the report. Never a pass rule |
| A7     | Instruction fit   | Did the agent follow the task text and the context texts, and add tests for the changed behavior? | Opus diagnosis                                                                                             | Counted in the report. Never a pass rule |
| A8     | Efficiency        | What did the run cost?                                                                            | Measured: base cost, `duration_ms`, `model_calls`, `tool_calls` and `usage` of the result line             | Shown in the report. Never a pass rule   |
| A9     | Boundary          | Did the run stay inside the boundary of the evaluation?                                           | Scripted: the [breach rules](#breach-rules)                                                                | A breach stops the evaluation            |

- A run passes when its result line has `end` `completed` and A1, A2, A3 and A4 pass ([Pass rule](#pass-rule)).
- The Opus diagnosis can name each aspect A1 to A9 in a finding. Only the diagnosis gives a result for A5, A6 and A7.
- A9 covers the boundary of the evaluation: the credential, the `auth.json` file, the hidden tests and the evaluation set. A write or a destructive command outside the workspace is an A9 finding of the diagnosis.

## Evaluation of the direction

(G1, G3)

- **Direction.** Ulrich, 2026-11-22: evaluate `swe@1` first, and fix it until it reaches the goals. Then add backend and frontend binding prompts. Haiku 5.5 at `high` runs the agent, scripted hidden checks decide, Opus 5.5 at `high` diagnoses the mistakes, and DeepSWE v1.1 is the standard.
- **Verdict.** Fits.
- **Fit rule.**
  1. The scripted aspects A1 to A4 and the breach rules of A9 decide the pass and the gate.
  2. The Opus findings change no pass. They give the target of the next prompt change.
  3. The held-out set measures the gate. Iterations read only the dev set, so a prompt change cannot fit the held-out cases.
  4. The held-out set gets no diagnosis. Reason: a diagnosis of a held-out run is a text about a held-out case, and that text can reach a prompt change.

## Placement in the round

(G1, G5)

- L4 is a caller of the agent CLI. It is no CLI layer and no core layer. Its design comes after L3 and before LA (Ulrich, 2026-11-22).
- The evaluation runs at step 4.3 of the [agent gate](index.md#round-order), against the agent that LA builds.
- [L7](L7-worker-evaluation.md), the worker evaluation, owns the worker-level checks, the review cases and the successor of `~/kanthord-evalset/worker-v2/`.

## Stages

(G1)

| Stage | Context of each run                                                                             | Start condition                  |
| ----- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| 1     | None. `swe@1` runs with the profile prompt only                                                 | The agent gate step 4.2 passes   |
| 2     | The kind prompt of the case kind, `binding/<kind>.md` of the set, as one `--system-prompt` part | The stage gate of stage 1 passes |

- The kind prompt of a kind is the repository prompt of the case repository of that kind, with its conventions: the todoapp repository for `backend`, the frontend fixture for `frontend`. It simulates a repository binding prompt ([L1 E1](L1-model.md#e1-project-context-through-the-binding-prompt-fits-with-a-fit-rule)).
- Each stage has its own iterations and its own stage gate. A run of stage 1 and a run of stage 2 never compare, because their `input_digest` differs.

## Model

(G1)

| Use            | `--model`                         | Catalog entry                             | List price per MTok (input, output, cache read)            | Entry in `auth.json` |
| -------------- | --------------------------------- | ----------------------------------------- | ---------------------------------------------------------- | -------------------- |
| Run of `swe@1` | `anthropic/claude-haiku-5-5:high` | `anthropic.json`, `chat:claude-haiku-5-5` | 0.10, 0.50, 0.01; above 100k input tokens 0.50, 2.50, 0.05 | `anthropic`, `oauth` |
| Diagnosis      | `anthropic/claude-opus-5-5:high`  | `anthropic.json`, `chat:claude-opus-5-5`  | 4, 20, 0.2                                                 | `anthropic`, `oauth` |

- Ulrich ruled on 2026-11-22: the run model is Haiku 5.5 at `high` only. The evaluation measures no other level.
- The catalog entry of Opus 5.5 is "Claude Opus 5.5". It accepts `low`, `medium`, `high`, `xhigh` and `max`. Its cache-write price is 5 per MTok, its context window is 1,000,000 tokens and its output limit is 128,000 tokens.
- `model` and `judge_model` of [Configuration](#configuration) hold the two values.
- **Ceiling.** A case where each run of `swe@1` passes shows no effect of a prompt change. The report shows the [set-difficulty line](#reportsh). When more than half of the dev cases are at the ceiling, the set author replaces them with harder cases before the next iteration ([Iteration](#iteration), rule 6).

## Evaluation set

(G2, G4, G6)

### Location

Ulrich ruled on 2026-11-22: the evaluation uses the KanthorD XDG directories. `directories(env)` of `src/kernel/xdg.ts` gives each directory, with the same rule as L2.

| Content                                 | Path                                                | Mode   |
| --------------------------------------- | --------------------------------------------------- | ------ |
| The evaluation set                      | `<data>/evaluation/agent/`, a local git repository  | `0700` |
| The configuration of the evaluation     | `<data>/evaluation/agent/config.json`               | `0600` |
| One case                                | `<data>/evaluation/agent/cases/<set>/<case-id>/`    | `0700` |
| The binding prompts of stage 2          | `<data>/evaluation/agent/binding/<kind>.md`         | `0600` |
| The shared fixture folder of the set    | `<data>/evaluation/agent/shared/`                   | `0700` |
| The results directory of one evaluation | `<state>/evaluation/runs/<evaluation-id>/`          | `0700` |
| The run directory of one run            | `<results directory>/<case-id>/<repeat>-<attempt>/` | `0700` |
| The workspace root of one run           | `<state>/evaluation/work/<random>/`                 | `0700` |
| The grading root of one run             | `<state>/evaluation/work/<random>/`, a second name  | `0700` |

- `<data>` is `directories(env).data`, for example `~/.local/share/kanthord`. `<state>` is `directories(env).state`, for example `~/.local/state/kanthord`.
- The results directory and the workspace root lie outside the pi directory `<state>/pi` ([L2 The pi directory](L2-agent-cli.md#the-pi-directory)). So L2 accepts each session path and output path in them.
- `<set>` is `dev` or `held-out`. A case id is unique over both sets.
- `<kind>` is `backend` or `frontend`.
- `<evaluation-id>` is a name that the operator gives: letters, digits, `-` and `_`. One evaluation id names one evaluation: one stage, one set and one prompt version.
- `<repeat>` starts at `1` and ends at `repeats` of [Configuration](#configuration). `<attempt>` starts at `1`. A new attempt takes the next free number ([Exit codes of a run](#exit-codes-of-a-run)).
- `<random>` is 16 random lowercase letters. The workspace path names no case and no evaluation. The runner makes the grading root after the run ends, with a new random name, so the session cannot name it.
- Nobody commits a results directory. The evaluation set repository has no remote.
- The `.gitignore` of the evaluation set names `config.json`. So the operator can change `cap_usd` with no commit and no breach `set_change`.

### Configuration

`config.json` holds exactly these keys.

| Key           | Value                                                                                      | Question it answers                                 |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `cap_usd`     | A number above 0. The start value is `15`                                                  | How much can one evaluation spend?                  |
| `base_model`  | `<provider>/<model>` with no level. The value is `openrouter/deepseek/deepseek-v4.1-flash` | Which price list measures the spend?                |
| `model`       | The `--model` form of L2. The value is `anthropic/claude-haiku-5-5:high`                   | Which model runs `swe@1`?                           |
| `judge_model` | The `--model` form of L2. The value is `anthropic/claude-opus-5-5:high`                    | Which model writes the diagnosis?                   |
| `judge_usd`   | A cost budget in base dollars with at most 2 fraction digits. The start value is `0.1usd`  | How much can one diagnosis spend?                   |
| `repeats`     | An integer of at least 2. The start value is `2`                                           | How many runs does each case get in one evaluation? |
| `gate_share`  | A number above 0 and at most 1. The start value is `0.6`                                   | Which share of held-out runs must pass at the gate? |

- `cap_usd`, `judge_usd` and `gate_share` are hypotheses. Ulrich sets `cap_usd` and `judge_usd` again from the measured results of the report ([`report.sh`](#reportsh)). Ulrich approved the start values `cap_usd` 15, `gate_share` 0.6 and `judge_usd` `0.1usd` on 2026-11-22.
- `run.sh` and `report.sh` read the file at the start of each call. A resumed evaluation reads `cap_usd` and `judge_usd` of that time, and `calls.jsonl` keeps the cap of each call.
- `run.sh` copies `repeats` into `iteration.json` at the first call of an evaluation. The evaluation keeps that value.
- **Fixed gate share.** `run.sh` copies `gate_share` into `iteration.json` at the first call of a held-out evaluation. When an earlier held-out evaluation of the same stage exists under `<state>/evaluation/runs/`, `run.sh` refuses a different `gate_share` in `config.json` with exit `1`. So Ulrich can change `gate_share` only before the first held-out evaluation of a stage. `report.sh` uses the copied values.
- **Price read.** `evaluation.mjs` reads each price with the exported pi API and no credential file:
  - `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`. `ModelRuntime` is an export of `@earendil-works/pi-coding-agent`, and `InMemoryCredentialStore` is an export of `@earendil-works/pi-ai`.
  - `getModel(provider, id)` gives the model. The price is its `cost`: `input`, `output`, `cacheRead`, `cacheWrite` and `tiers`.
  - The same read gives the price of `base_model`, `model` and `judge_model`, and so the `r` of each run.
  - **No price.** A model has no price when the read gives no model, or when each of `input`, `output`, `cacheRead` and `cacheWrite` is 0. For example, the read gives no model for `openai-compatible/stub-1`.
- **Refusals.** `run.sh` and `report.sh` exit `1` at the start of the call in each of these conditions:
  - the file is absent, or is no JSON object;
  - the file holds another key, or misses a key;
  - a value breaks the rule of its row;
  - pi gives no model for `base_model`;
  - the base model has no `input`, `output` or `cacheRead` price.

  stderr names the file and the key. A refused call writes no line to `calls.jsonl`.

### Case folder

| File          | Content                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `case.json`   | `kind`, `commit`, `wall`, `usd` and `allowed`. [Unit-level rules](#unit-level-rules), rule 1, holds the schema                  |
| `repo.bundle` | A git bundle of the case repository, with no remote. It holds only the commit C of `commit` and its ancestors, and no other ref |
| `setup.sh`    | The dependency install for one clone. It reads only the case folder and the shared fixture folder, and it uses no network       |
| `task.md`     | The case text, the `--prompt` value                                                                                             |
| `check/`      | The hidden checks: `check.sh`, the folder `tests/` and `reference.patch`, a correct solution as a diff on C                     |

- The case id is the name of the case folder.
- `kind` is `backend` or `frontend`. It selects the binding prompt of stage 2 and the [frontend rules](#frontend-rules).
- `wall` is the wall budget of the case, for example `30m`. `usd` is the cost budget of the case in base dollars, with at most 2 fraction digits, for example `0.5usd` ([Price ratio](#price-ratio)). `allowed` is the list of path globs that the run can change.
- `check/tests/` holds the hidden tests at their paths in the case repository: the tests that must start to pass, and each test file of the case repository that `pass_to_pass` runs. The grading copies the folder over the grading clone, so a file of the same name replaces the agent version ([Grading](#grading)).
- `check.sh <dir> <mode>` runs one mode in the directory `<dir>` and exits `0` on a pass. The modes are `fail_to_pass`, `pass_to_pass` and `conventions`. A failed build fails each mode.
- `setup.sh` installs each dependency into a path that the `.gitignore` of the case repository names. So the start precondition `git_clean` of [L3](L3-agent.md#start-preconditions) still passes.
- No file of `check/` lies in a workspace or in a grading clone before the grading copies it. The grading never copies `reference.patch`.

### Dev and held-out sets

| Set        | Cases | Kinds                     | Use                                               |
| ---------- | ----- | ------------------------- | ------------------------------------------------- |
| `dev`      | 10    | 5 `backend`, 5 `frontend` | Each iteration. The Opus diagnosis reads each run |
| `held-out` | 6     | 3 `backend`, 3 `frontend` | The stage gate only. No diagnosis                 |

- **Sources.** The `backend` cases come from the task texts of the todoapp seeds of Worker V2, at the tree of the base of the claim (`.dev/v2-b3/trees`, `~/kanthord-evalset/worker-v2/bases.tsv`). Their hidden tests come from the reference node head. The `frontend` cases use a synthetic React and Tailwind fixture with design tokens and components of its own (Ulrich, 2026-11-22).
- The `frontend` fixture reproduces the dogfood finding of [L1 E1](L1-model.md#e1-project-context-through-the-binding-prompt-fits-with-a-fit-rule): a session that does not follow the existing interface fails A4.
- **Blind held-out set.** Nobody reads a held-out session file, a held-out check output or a held-out case text to change a prompt. The held-out report shows no line for one case.
- The evaluation set holds no review case. [L7](L7-worker-evaluation.md) owns the review cases.

### Content rules

1. Each case is synthetic or owned by kanthorlabs. No case holds customer code, a `seed.json` of Worker V2 or a `.env` file. Reason: `seed.json` holds `effective_configuration.credential`, `ssh_public_key` and `known_hosts`.
2. Each commit of a case repository has the author `Kanthor Eval <eval@kanthorlabs.invalid>`.
3. `repo.bundle` holds no commit after C. Reason: a node branch of `.dev/v2-b3/trees` holds the reference solution, and a later commit in the object store gives the solution to the agent.
4. A pre-commit hook of the evaluation set runs `node evaluation.mjs scan` over the staged files. The command applies the secret patterns of the engine (`findPatternText` of `src/agent/sensitive-text.ts`). A match stops the commit.
5. `setup.sh` copies each file that it takes from the shared fixture folder. It makes no symbolic link into the evaluation set. Reason: a link puts the path of the set into a stack trace, and the [protected-path search](#breach-rules) then matches an honest run.
6. No path of a case repository, no case text, no kind prompt and no path that `setup.sh` installs holds a string of the protected-path list. Reason: the same false match. A false match found during an evaluation needs a fix of the set and a new evaluation id.
7. On the unchanged commit C with the hidden tests copied in, `check.sh <dir> fail_to_pass` exits other than `0`, and `pass_to_pass` and `conventions` exit `0`.
8. **Reference solution.** On C with `reference.patch` applied, the grading steps 3 to 7 of [Grading](#grading) exit `0` in each mode three times in sequence, and the patch passes the [scope rules](#scope-rules). Reason: a hidden test that fails a correct solution, or that fails one time of three, gives a false A1 or A2 fail.
9. `task.md` names each path and each exported name that the hidden tests use. It holds no convention of the case repository. The kind prompt holds the conventions.
10. `check.sh` names each test file of `check/tests/` explicitly. It reads no script and no runner configuration from a path of `allowed`.
11. `allowed` holds no runner configuration, no lock file and no `.gitignore`. Reason: the scope rule is the only guard of the test configuration, and DeepSWE v1.1 found grading defects where test infrastructure lay under the control of the agent ([Grading method](#grading-method)).
12. A kind prompt holds a heading, one blank line and the text.

`node evaluation.mjs validate <case folder>` checks rules 6, 7 and 8 over the repository paths, the case texts, the kind prompts and the installed paths. The set author runs it for each case before each set commit.

## One evaluation run

(G4, G5)

The runner does each step for each run of `swe@1`.

1. **Workspace.** Make the run directory and a new workspace root. No two runs share one clone. Make the clone `w` with the [clone steps](#clone-steps).
2. **Setup.** Run `setup.sh` with `w` as the current directory. An exit other than `0` stops the evaluation.
3. **Credential refresh.** For an `oauth` entry, refresh the entry ([Credential](#credential), rule 3).
4. **Run.** Call `run agent`. `$RUN` is the run directory, and `$RESULTS` is the results directory. In stage 1, the command has no `--system-prompt`. In stage 2, it has `--system-prompt "$SET/binding/$KIND.md"` before `--workspace`.

   ```sh
   kanthord run agent swe@1 --model "$MODEL" \
     --budget "$WALL" --budget "$USD" \
     --workspace "$ROOT/w" --session "$RUN/session.jsonl" \
     --output "$RESULTS/results.jsonl" --prompt "$CASE/task.md" 2> "$RUN/stderr.txt"
   ```

5. **Breach rules.** Apply the [breach rules](#breach-rules) 1 to 4. A breach writes the check line with `breach` and stops the evaluation.
6. **Diff.** Write the diff to `$RUN/diff.patch` ([Diff steps](#diff-steps)). Apply breach rule 5 to `diff.patch`.
7. **Grading.** Grade the diff in a new grading root ([Grading](#grading)). Apply breach rule 5 to `check.txt`. Append one line to `<results directory>/checks.jsonl` ([Check record](#check-record)).
8. **Diagnosis.** On the dev set, run the [diagnosis](#diagnosis) of the run.
9. **Removal.** Remove the workspace root and the grading root. On the held-out set, remove `check.txt`. The runner also removes both roots when the evaluation stops at any step.

- The run directory keeps `session.jsonl`, `stderr.txt` and `diff.patch`. On the dev set, it also keeps `check.txt` and, for each diagnosis attempt n from `1`, `judge-<n>.jsonl` and `judge-<n>-stderr.txt`. It keeps no other file.
- `evaluation.mjs` does each step. `run.sh` and `report.sh` only start `evaluation.mjs` with their options.
- The pi session file is the record of the work. The line in `results.jsonl` holds the identity, the end, the class and the totals of the run ([L2 The result](L2-agent-cli.md#the-result)).
- The runner passes no `--auth`, so `run agent` reads the default `--auth` file ([Credential](#credential)).
- The runs go in sequence. Reason: a pi refresh writes the `auth.json` file, and a subscription has a rate limit.

### Clone steps

Each clone of a case repository uses these commands, with `$DIR` the new clone:

- `git clone --no-hardlinks "$CASE/repo.bundle" "$DIR"`;
- `git -C "$DIR" checkout --detach "$C"`;
- `git -C "$DIR" remote remove origin`;
- `git -C "$DIR" reflog expire --expire=now --all`.

Reason: the clone writes the absolute path of the bundle into the remote and the reflog. After the last two commands, the clone holds no path of the case folder.

- The runner keeps a copy of `$DIR/.git/config` after the clone steps, outside `$DIR` in the same root.
- Each runner `git` command runs with `isolatedGitEnvironment` of `src/kernel/git-environment.ts` ([L3 Start preconditions](L3-agent.md#start-preconditions)).

### Diff steps

1. Restore `w/.git/config` from the copy of the clone steps, and remove `w/.git/info/attributes`. Reason: a filter driver or a diff driver in the configuration of the agent can run a command or change the diff.
2. Run `git -C w add -A`.
3. Write `git -C w diff --cached --binary --no-renames --no-ext-diff --no-textconv --no-color "$C"` to `$RUN/diff.patch`.

A failed `add` or `diff` fails A1, A2, A3 and A4, and the grading does not run.

### Grading

The grading grades only the agent diff, in a clone that the agent never saw.

1. Make the grading root and the grading clone `g` in it with the [clone steps](#clone-steps).
2. Run `setup.sh` with `g` as the current directory. An exit other than `0` stops the evaluation, because it is a fault of the set.
3. Apply the diff. A 0-byte `diff.patch` skips the apply. Else run `git -C g apply --binary "$RUN/diff.patch"`. When the apply fails, A1, A2 and A4 fail, and the grading goes to step 8.
4. A4: run `check.sh g conventions`, and apply the [frontend rules](#frontend-rules) for the kind `frontend`.
5. Copy `check/tests/` over `g`. For each file, the copy removes the destination entry first, after an `lstat`, and then writes the file. A failed copy fails A1 and A2, and the grading goes to step 8.
6. A1: run `check.sh g fail_to_pass`.
7. A2: run `check.sh g pass_to_pass`.
8. A3: apply the [scope rules](#scope-rules) to `diff.patch`.

- stdout and stderr of each `check.sh` call go to `$RUN/check.txt`, each part after a line with the mode and its exit code.
- The grading runs for each run, also for a run that ends `budget_end` or `failed`.
- The order puts the environment before the patch: `setup.sh` runs on C only, so an agent diff fails its own run and never stops the evaluation.

### Grading method

The grading follows [DeepSWE v1.1](https://deepswe.datacurve.ai/blog/deepswe-v1-1) (Datacurve). L4 adopts these steps:

- a base commit with no future history (content rule 3);
- the grading of the committed patch in a separate clean clone ([Grading](#grading));
- hidden tests that the agent cannot control (steps 2 and 5, content rules 10 and 11);
- a result for each test mode in `check.txt`;
- Pass@1 for each run, with the cost, the tokens and the model calls in the report.

An independent review found grading defects in DeepSWE v1.1 where test infrastructure lay under the control of the agent. That is the reason for the order of steps 2 to 5, for the copy with `lstat`, and for content rules 10 and 11.

### Scope rules

- Each changed path of the diff matches a glob of `allowed`. A changed path is each path in a `diff --git` header of `diff.patch`. With `--no-renames`, a rename gives a deletion and an addition.
- No added line holds a conflict marker. A conflict marker is a line that starts with `<<<<<<< ` or `>>>>>>> `.
- No diff entry has the mode `120000`, a symbolic link, or `160000`, a submodule.

### Frontend rules

- The diff adds no CSS file.
- **Arbitrary-value rule.** The rule reads each added line of a file that ends in `.tsx`, `.jsx` or `.html`.
  - A class token is a token between spaces in the value of a `className` or `class` attribute, or in a string argument of a call of `cn` or `clsx`. The frontend fixture uses only these two class helpers. Each other token is no class token.
  - The rule splits each class token at each `:` outside brackets. The last part is the utility. The rule fails when a utility holds `[`.
  - Fail: `w-[calc(100%-1rem)]`, `text-[var(--x)]`, `bg-[#fff]`, `[mask-type:luminance]`.
  - Pass: `data-[state=open]:p-2`, `[&>*]:p-2`, `group-[.is-open]:hidden`. The bracket lies in a variant, not in the utility.
  - Pass: `items[0]` and `useState<string[]>([])` outside a literal.
  - Pass: `` `row-${rows[0].id}` ``, `querySelector("[data-id]")`, `"app/[id]/page"` and `placeholder="[optional]"`. They are no class value.

`evaluation.mjs` owns the scope rules and the frontend rules ([Unit-level rules](#unit-level-rules), rule 4).

### Breach rules

A run breaches A9 in each of these conditions. The runner checks rules 1 to 4 in this order after the run, and rule 5 after the diff and after the grading.

1. **`credential`.** The session file holds a credential value of the entry ([Credential](#credential), rule 6).
2. **`auth_file`.** The digest or the mode of the `auth.json` file changes, or the configuration directory gets a new entry ([Credential](#credential), rule 5).
3. **`protected_path`.** The session file names a protected path.
4. **`set_change`.** `git -C <evaluation set> status --porcelain` prints a line.
5. **`credential`, in a file of the run.** `diff.patch` or `check.txt` holds a credential value of the entry. The runner counts after the diff and after the grading, before the copy into the judge workspace. A count other than `0` is the breach `credential`. The runner removes `diff.patch` and `check.txt`. Reason: a `bash` copy of `auth.json` into the workspace puts the values into the diff with no value in the session file.

**Protected-path search.** The profile `swe@1` is not confined, so a session can read each file of the OS user ([L1 Reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session)). The search guards the hidden tests. pi records the tool call arguments as the model wrote them and the tool result text. It records no path that a tool resolved. `evaluation.mjs` searches the whole session file for each of these strings:

- the absolute path of the evaluation set, of the results directory and of the case folder;
- the path parts `evaluation/agent`, `evaluation/runs` and `/check/`;
- the file names `check.sh`, `reference.patch`, `checks.jsonl`, `results.jsonl`, `calls.jsonl`, `diagnoses.jsonl`, `iteration.json`, `report.md`, `config.json`, `session.jsonl` and `stderr.txt`, and each name that starts with `judge-`. A file name matches only after a path boundary: the start of a text, `/`, a whitespace character or a quote. So `tsconfig.json` does not match `config.json`.

The search is a heuristic. A path that a shell builds from parts, a glob or a cut output can pass the search.

## Diagnosis

(G3, G5, G6)

The diagnosis reads one dev run and writes findings. It decides no pass.

1. **Call method.** The runner calls `kanthord run agent re@1`. `re@1` is confined and has only `read`, `grep`, `find` and `ls` ([L3 Coding tools](L3-agent.md#coding-tools)).
2. **Judge workspace.** The runner makes the directory `j` in the grading root. It puts these files into `j`:
   - `diff.patch` and `check.txt` of the run;
   - `check.json`, the check line of the run;
   - `task.md` of the case, and in stage 2 the kind prompt of the case kind;
   - `transcript.md`, which `evaluation.mjs` writes from the entries of `session.jsonl`. Each entry has its id, its role and its text. Each tool result is cut to 4,000 characters. Reason: pi `read` returns no line above 50 KB (`dist/core/tools/read.js:136-139`), and `re@1` has no `bash`.
3. **Command.** `$RUNNER` is `scripts/evaluation/agent/` of the engine. `$JUDGE_USD` is `judge_usd × r(judge_model)` ([Price ratio](#price-ratio), rule 3).

   ```sh
   kanthord run agent re@1 --model "$JUDGE_MODEL" \
     --budget 15m --budget "$JUDGE_USD" \
     --system-prompt "$RUNNER/judge.md" \
     --workspace "$GRADE/j" --session "$RUN/judge-$N.jsonl" \
     --output "$RESULTS/results.jsonl" --prompt "$RUNNER/judge-task.md" 2> "$RUN/judge-$N-stderr.txt"
   ```

4. **Credential.** The credential refresh, the digest check and the credential count of [Credential](#credential) apply to the diagnosis run as to a run of `swe@1`. A breach of rule 1 or 2 of [Breach rules](#breach-rules) stops the evaluation.
5. **Output.** `judge.md` defines each goal aspect and the output form. The final answer is exactly one JSON object `{"findings": [...]}` with at most 20 findings. Each finding holds exactly:
   - `aspect`: one of `A1` to `A9`;
   - `evidence`: a text of 1 to 500 characters that quotes a file of `j` and names the file, with the entry id for `transcript.md`;
   - `severity`: `high`, `medium` or `low`.
6. **Read.** `evaluation.mjs` parses the `text` field of the `re@1` result line ([L2 The result](L2-agent-cli.md#the-result)). It appends one line to `<results directory>/diagnoses.jsonl` ([Diagnosis record](#diagnosis-record)). A text that breaks rule 5, or a run that does not end `completed`, gives `valid` `false`.
7. **Fixed judge.** `judge.md` and `judge-task.md` lie in the runner, outside `static/prompt/`. An iteration changes only the files of [Iteration](#iteration), rule 1, so the `re@1` profile prompt stays the same. `report.sh` refuses an iteration whose `re@1` lines and parent `re@1` lines differ in `system_prompt_digest`.
8. **Cost.** The base cost of each diagnosis run counts against `cap_usd` ([Run budget](#run-budget), rule 7).
9. **Attempt.** `$N` is the attempt number of the diagnosis, from `1`. A new attempt takes the next free number. The diagnosis of a run is the last `re@1` line whose `session` lies in the run directory.

- A run of `swe@1` is good on A5, A6 or A7 when its diagnosis is valid and holds no finding of that aspect with the severity `high` or `medium`.
- The held-out set gets no diagnosis ([Evaluation of the direction](#evaluation-of-the-direction), fit rule 4).
- `$GRADE` is the grading root of the run.

## Iteration

(G1, G2)

One evaluation of the dev set is one iteration. The first evaluation of a stage is the baseline. It has no parent.

1. **One change.** An iteration changes one thing in the prompt of `swe@1`: one commit of the engine that changes only `static/prompt/role/swe@1.md` and the same text in `static/prompt/swe@1.md` ([L3 Prompt files](L3-agent.md#prompt-files)). Reason: `base.md` and `coding.md` are also parts of the `re@1` prompt, so a change there changes the judge.
   - `run.sh` refuses a dirty engine tree with exit `1`, and records `engine_commit` in `iteration.json`.
   - `report.sh` refuses an iteration when `git diff --name-only <parent engine_commit> <new engine_commit>` lists another path.
2. **Hypothesis.** The iteration names its parent, one target aspect from A1 to A7 and a hypothesis text. `run.sh` writes them in `iteration.json` ([Iteration record](#iteration-record)).
3. **Repeats.** Each case runs `repeats` times, at least 2.
4. **Comparability.** The iteration and its parent have the same stage, the same set commit and equal common keys of L2 for each case ([L2 Comparison rule](L2-agent-cli.md#comparison-rule)). The `system_prompt_digest` of `swe@1` differs, except for an [A/A pair](#aa-measure). Else `report.sh` refuses the iteration.
5. **Noise rule.** The rule is a hypothesis. Reason: a simulation with 10 cases and 2 repeats gives `keep` in 10% to 21% of iterations with no real change, and in 31% to 52% with a real gain of 0.2 on each uncertain case. Ulrich sets the threshold again from the [A/A measure](#aa-measure). For an evaluation x and an aspect a:
   - good(x, a) is the count of runs of x that are good on a. For A1 to A4, the check line gives it. For A5 to A7, the diagnosis gives it ([Diagnosis](#diagnosis)).
   - flips(x, a) is the count of cases where some runs of x are good on a and some runs are not.
   - passes(x) is the count of passed runs of x. flips(x) is the count of cases where some runs of x pass and some runs fail.
   - noise(a) is max(2, flips(parent, a)). noise is max(2, flips(parent)).

   The verdict is `keep` when each condition holds. Else it is `revert`.
   - good(new, target) − good(parent, target) is at least noise(target);
   - passes(parent) − passes(new) is less than noise;
   - no run of the new evaluation breaches A9.

6. **Ceiling.** Before an iteration, the set author replaces the dev cases at the ceiling when more than half of the dev cases are at the ceiling. A replaced case gives a new set commit, so the next evaluation is a new baseline, with a new A/A measure.
7. **Record.** Each iteration keeps its results directory, `iteration.json` and `report.md`. The report of a `revert` iteration stays. The prompt commit of a `revert` iteration leaves the engine.

- **No verdict.** The iteration has no verdict when a planned run or a planned diagnosis of the two evaluations has no line, or when the target is A5, A6 or A7 and the `re@1` lines of the two evaluations differ in `provider`, `model` or `reasoning_effort`. A breach gives `revert`, also with a planned run with no line.

### A/A measure

Before the first iteration of a stage, the baseline runs twice with the same prompt.

1. The second evaluation names the first with `--replicate <id>`. `run.sh` writes `replicate` in `iteration.json`.
2. `report.sh` accepts one `system_prompt_digest` in the two evaluations only for such a pair. Each other check of [Iteration](#iteration), rule 4, holds.
3. The report of the second evaluation holds the A/A line: for each aspect A1 to A7, good(first, a), good(second, a), the difference and flips(first, a); and passes(first), passes(second) and the difference.
4. Ulrich sets the threshold of the noise rule from the A/A line before the first iteration of the stage.

- An invalid diagnosis counts as good in the parent and as not good in the new evaluation. Reason: an invalid diagnosis then never helps the change.

## Stage gate

(G1, G2)

Ulrich fixes the stage gate before the first run (Ulrich, 2026-11-22). One evaluation of the held-out set at the current prompt measures it.

1. The pass share of a kind is the passes of that kind divided by its planned runs: the held-out cases of the kind times `repeats`.
2. The gate passes when the pass share of `backend` and the pass share of `frontend` are each at least `gate_share`, and no run breaches A9. Reason: one share over both kinds can pass with a failed half.
3. A breach fails the gate, also with a planned run with no line.
4. **No verdict.** The gate has no verdict when a planned run has no line in `checks.jsonl` and no run breaches A9.
5. A failed gate returns the stage to iterations on the dev set. Ulrich decides the next step after a gate with no verdict.
6. Each held-out evaluation names its stage. Stage 2 starts only after a held-out evaluation of stage 1 passes the gate.
7. `gate_share` stays fixed from the first held-out evaluation of a stage ([Configuration](#configuration)).
8. The gate line shows the count of earlier held-out evaluations of the stage. Reason: each gate try shows a held-out result, and the count shows how often the stage tried.

## Run budget

(G8)

1. **Case budget.** Ulrich ruled on 2026-11-22: each case sets its case budget in `case.json`, a wall budget `wall` and a cost budget `usd`. For reference, the largest Worker V2 execution ran 3 units in 35 minutes on Haiku 5.5. Its list price was 1.09 usd (`baseline.md`, execution `T8TWV9P5`).
2. **No turn limit.** A run has no turn limit. The wall budget and the cost budget bound each run ([L2 Budget](L2-agent-cli.md#budget), rule 8).
3. **Scaled cost budget.** `usd` and `judge_usd` are in base dollars. A run of the model m gets `--budget <usd × r(m)>usd` ([Price ratio](#price-ratio)).
4. **No price.** The runner passes no cost budget when the model has no price ([Configuration](#configuration)), for example an `openai-compatible` model. Its `r` is `none`. Reason: `run agent` refuses a cost budget for a model with no price, with `cli.run.agent.budget_unpriced` ([L2 Budget](L2-agent-cli.md#budget), rule 6). Such a run has the base cost `0`.
5. **Wall limit.** `wall` is at most `2h`, the default wall budget of `run agent`. A diagnosis run has the wall budget `15m`.
6. **Base cost.** The base cost of a run of the model m is its `list_price_usd` divided by `r(m)`. So the list price of a model with a higher price is above its base cost.
7. **One cap.** One cap `cap_usd` of [Configuration](#configuration) covers one evaluation. The sum is the base cost of each line of `results.jsonl` of the evaluation: each run of `swe@1`, each diagnosis run and each attempt.
8. **Start gate.** Each run of `swe@1` reserves the `usd` of its case, and each diagnosis run reserves `judge_usd`, also when the runner passes no cost budget (rule 4). The runner starts a run only when the sum plus that reserve is at or below `cap_usd`. Else it writes the report and exits `4`. The cap is a start gate: the last run can pass the cap.
9. A subscription entry pays no list price, but the cap applies to the base cost ([L2 Budget](L2-agent-cli.md#budget), rule 5).

### Price ratio

(G8)

Ulrich ruled on 2026-11-22: one price ratio converts between the base model and the model of the run. The ratio assumes a cache-read hit of 80%.

1. **Blended price.** For a model m, in USD per million input-side tokens:

   ```text
   blend(m) = 0.8 × cacheRead(m) + 0.2 × input(m) + 0.02 × output(m)
   ```

   - 0.8 and 0.2: the assumption of Ulrich, 80% cache-read hits on the input side.
   - 0.02: the output tokens for each input-side token in the Worker V2 baseline. The baseline holds 584,888 output tokens against 30.31M input-side tokens, which is 1.9%.
   - For a model with price tiers, each price is the price of the highest tier. Reason: an agent session passes the tier threshold.

2. **Ratio.** `r(m) = blend(m) / blend(base_model)`. `r` is the exact quotient, with no rounding.
3. **Scaled budget.** The runner passes `--budget <usd × r(m)>usd`. An exact multiple of 0.01 stays. Else the value rounds up to the next 0.01.
   - The runner reads each price as an integer count of 10⁻⁶ USD per MTok, and computes `100 × blend` as an integer.
   - The scaled budget in cents is `ceil(cents(usd) × 100·blend(m) / 100·blend(base_model))`, with integer arithmetic. So `0.3usd` at `r` 1 stays `0.3usd`.
4. The three constants are part of this rule. `config.json` does not hold them.

| Model                            | `cacheRead` | `input` | `output` | `blend` | `r`    |
| -------------------------------- | ----------- | ------- | -------- | ------- | ------ |
| DeepSeek V4.1 Flash, OpenRouter  | 0.006       | 0.30    | 1.20     | 0.0888  | 1      |
| Haiku 5.5, tier above 100k input | 0.05        | 0.50    | 2.50     | 0.19    | ~2.14  |
| Opus 5.5                         | 0.20        | 4.00    | 20.00    | 1.36    | ~15.32 |

- The prices are the pi `1.1.0` catalog prices per MTok.
- Check: the baseline Haiku list price, 1.98 usd, divided by the base price of its tokens is 1.75 to 2.25. The range comes from the price of its 842,513 cache-write tokens: the base input price gives 1.75, the base cache-write price 0 gives 2.25. The baseline cache-read share is 97.2%, above the assumed 80%, and the baseline ran `medium`, not `high`.

### Cost arithmetic

(G8)

These estimates use the Worker V2 baseline of Haiku 5.5 at `medium`: 1.98 usd list price for 21 units (`baseline.md`). One run of one case counts as one unit. One Haiku run is about 0.094 usd list price and about 0.044 base dollars. The page has no measured diagnosis run. The estimate of one diagnosis run is 50,000 cache-write tokens, 300,000 cache-read tokens and 8,000 output tokens on Opus 5.5: about 0.47 usd list price and about 0.031 base dollars.

| Evaluation        | Runs                                  | Base cost  | List price |
| ----------------- | ------------------------------------- | ---------- | ---------- |
| One dev iteration | 20 runs of `swe@1`, 20 diagnosis runs | about 1.50 | about 11.3 |
| One held-out gate | 12 runs of `swe@1`                    | about 0.53 | about 1.13 |

- **Reserve bound.** The start gate reserves 20 × `usd` + 20 × `judge_usd` for one dev iteration. At `0.5usd` and `0.1usd` that is 12.0 base dollars. So `cap_usd` 15 holds one dev iteration for each case budget up to `0.65usd`.
- The report shows the measured base cost and list price, and Ulrich sets `cap_usd` and `judge_usd` again from them.

## Pass rule

(G3)

A run passes when each condition holds:

1. The line in `results.jsonl` has `end` `completed`.
2. A1, A2, A3 and A4 pass ([Grading](#grading)).
3. The run breaches no rule of A9.

### Exit codes of a run

This table applies to each `run agent` call: a run of `swe@1` and a diagnosis run.

| Exit of `run agent`                           | Runner action                                                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`                                           | For `swe@1`, the grading decides the pass. For `re@1`, the parse decides `valid`                                                                                                                         |
| `4`, `5`                                      | For `swe@1`, the run fails, and the grading still runs. For `re@1`, the diagnosis has `valid` `false`                                                                                                    |
| `75`                                          | The run starts again with a new session file and a new workspace, as the next attempt. A diagnosis starts again as the next attempt `n`. The third exit `75` of one run in one call stops the evaluation |
| `1`, `2`                                      | The evaluation stops                                                                                                                                                                                     |
| stderr holds `cli.run.agent.prompt_text_path` | The evaluation stops. Reason: a prompt file did not reach the run ([L2 Text or path](L2-agent-cli.md#text-or-path))                                                                                      |
| Each other exit                               | The evaluation stops                                                                                                                                                                                     |

- Each line of `results.jsonl` stays, the lines of a retried run included ([L2 Comparison rule](L2-agent-cli.md#comparison-rule)).
- **Stop.** A stopped evaluation writes the report. The runner exits `1`.
- **Resume.** A later call with the same evaluation id resumes the evaluation. The resume key of a run is the case and the repeat. The runner skips each run whose key has a line in `checks.jsonl`, and runs the missing diagnosis of a dev run that has a check line. A run that starts again takes the next free attempt number, so no run uses a session file twice.
- **Planned runs.** The planned runs of an evaluation are `repeats` runs of `swe@1` on each case of its set. On the dev set, each planned run has a planned diagnosis.

### Check record

Each line of `checks.jsonl` holds `case`, `repeat`, `session`, `a1`, `a2`, `a3`, `a4`, `pass` and `breach`.

| Field                  | Reader                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `case`                 | The report: the passes for each case and the set-difficulty line. The resume key                                         |
| `repeat`               | The resume key                                                                                                           |
| `session`              | The join of the line to its line in `results.jsonl`, which gives `agent`, `end` and the costs; the join of the diagnosis |
| `a1`, `a2`, `a3`, `a4` | The report: the goal table. The noise rule for a target from A1 to A4                                                    |
| `pass`                 | The report, the noise rule and the stage gate                                                                            |
| `breach`               | `null`, or the name of the breach rule. The report, the noise rule and the stage gate                                    |

- A line with a `breach` has `a1` to `a4` and `pass` `false`, because the grading does not run or its result does not count.

### Diagnosis record

Each line of `diagnoses.jsonl` holds `session`, `valid` and `findings`.

| Field      | Reader                                                                               |
| ---------- | ------------------------------------------------------------------------------------ |
| `session`  | The join to the check line and to the `swe@1` result line. The resume of a diagnosis |
| `valid`    | The report: the count of invalid diagnoses. The noise rule                           |
| `findings` | The report: the count for each aspect and severity. The noise rule for A5, A6 and A7 |

- The `re@1` result lines of the diagnosis give its cost. The runner joins the last `re@1` line whose `session` is `<run directory>/judge-<n>.jsonl`.

### Iteration record

`run.sh` writes `iteration.json` in the results directory at the first call of an evaluation. It holds `stage`, `set`, `set_commit`, `engine_commit`, `repeats`, `gate_share`, `parent`, `replicate`, `aspect` and `hypothesis`.

| Field           | Reader                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `stage`         | The context of each run. The comparability check. The report                                               |
| `set`           | The planned runs. The report: the iteration or the gate                                                    |
| `set_commit`    | `git -C <evaluation set> rev-parse HEAD` at the first call. The comparability check                        |
| `engine_commit` | The engine commit of the runner at the first call. The one-change check of [Iteration](#iteration), rule 1 |
| `repeats`       | `repeats` of `config.json` at the first call. The planned runs                                             |
| `gate_share`    | On the held-out set, `gate_share` of `config.json`, else `null`. The stage gate                            |
| `parent`        | The evaluation id of the parent, or `null`. The noise rule                                                 |
| `replicate`     | The evaluation id of the first baseline of an A/A pair, or `null`. The A/A line                            |
| `aspect`        | The target aspect, or `null`. The noise rule                                                               |
| `hypothesis`    | The hypothesis text, or `null`. The report                                                                 |

- A resumed call refuses options that differ from `iteration.json` with exit `1`.
- A call refuses a `set_commit` that differs from `git -C <evaluation set> rev-parse HEAD` with exit `1`.

### Call record

Each call of `run.sh` that passes its start checks appends one line to `<results directory>/calls.jsonl` at its start. The line holds `cap_usd`. A call that a start check or a configuration refusal ends writes no line.

| Field     | Reader                                       |
| --------- | -------------------------------------------- |
| `cap_usd` | The report: the cap that each call ran under |

## Runner

(G5)

The runner is a set of scripts in the engine repository: `scripts/evaluation/agent/` ([Handoffs](#handoffs-to-later-layers)). It holds `run.sh`, `report.sh`, `evaluation.mjs`, `judge.md` and `judge-task.md`. It calls only the built `kanthord run agent`, git, the case scripts and Node. `evaluation.mjs` calls the exported pi API for the refresh and the prices. The runner adds no engine command.

### `run.sh`

```text
run.sh --evaluation <id> --stage <1|2> --set <dev|held-out> [--parent <id> --aspect <A1..A7> --hypothesis <text> | --replicate <id>]
```

| Option         | Question it answers                                | Rule                                                                                |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `--evaluation` | Which evaluation do the results join?              | Required. The evaluation id                                                         |
| `--stage`      | Which context do the runs get?                     | Required. `1` or `2` ([Stages](#stages))                                            |
| `--set`        | Which cases run?                                   | Required. `dev` or `held-out`                                                       |
| `--parent`     | Which evaluation does this iteration compare with? | Optional. Only with `--set dev`. It requires `--aspect` and `--hypothesis`          |
| `--aspect`     | Which aspect does the prompt change target?        | Only with `--parent`. One of `A1` to `A7`                                           |
| `--hypothesis` | What does the prompt change expect?                | Only with `--parent`. A text of 1 to 500 characters                                 |
| `--replicate`  | Which baseline does this evaluation repeat?        | Optional. Only with `--set dev` and with no `--parent` ([A/A measure](#aa-measure)) |

- The evaluation set and its configuration are the fixed paths of [Location](#location).
- The run order is fixed: the cases in byte order of the case id, then the repeats. On the dev set, the diagnosis of a run follows the run.
- `--parent` names an evaluation that has `iteration.json` with the same stage and the set `dev`. Else the call exits `1` and starts no run.
- The runner refuses `NODE_USE_ENV_PROXY` in its environment and `--use-env-proxy` in `NODE_OPTIONS` with exit `1` ([Credential](#credential), rule 4).
- The runner runs `ulimit -c 0` before its first step ([Credential](#credential), rule 8).
- The runner exits `0` when each planned run and diagnosis has a line, `1` at a stop or a breach, and `4` at the cap.

### `report.sh`

```text
report.sh --evaluation <id>
```

1. It reads `iteration.json`, `results.jsonl`, `checks.jsonl`, `diagnoses.jsonl` and `calls.jsonl` of the evaluation, and `config.json`. With a parent, it reads the same files of the parent.
2. It joins each check line and each diagnosis line to its result line by `session`.
3. It checks the keys of the [L2 Comparison rule](L2-agent-cli.md#comparison-rule):
   - each line of the file has one `engine_version`;
   - the `swe@1` lines have one `provider`, `model`, `reasoning_effort` and `system_prompt_digest`;
   - the `swe@1` lines of one case have one `input_digest` and one `budget`;
   - the `re@1` lines have one `provider`, `model`, `reasoning_effort` and `system_prompt_digest`;
   - with a parent, rule 4 of [Iteration](#iteration) holds, the `re@1` lines of the parent have the same `system_prompt_digest`, and the one-change check of rule 1 holds.

   It refuses a file that breaks a check. It exits `1` and names the first two lines, or the key of the iteration check.

4. It writes `report.md` in the results directory:
   - the head: the evaluation id, the stage, the set, the set commit, and, with a parent, the parent, the target aspect and the hypothesis;
   - the goal table: for A1 to A4, the count of good runs; for A5 to A7, the count of findings of each severity and the count of good runs; for A8, the median and the sum of the base cost, and the median `duration_ms`, `model_calls` and `tool_calls`; for A9, the count of breaches and the name of each breach rule; the count of runs for each `end`;
   - the passes and the planned runs, and the count of invalid diagnoses;
   - on the dev set, one line for each case: the passes, and the good runs for each aspect A1 to A7;
   - on the dev set, the set-difficulty line: the count of ceiling cases, where each run passes, and of floor cases, where no run passes, of the case count;
   - with a parent, the iteration line: good(parent, target), good(new, target), noise(target), passes(parent), passes(new), noise, and the verdict `keep`, `revert` or `no verdict`; and for each aspect A1 to A7, good(new, a) − good(parent, a);
   - with `replicate`, the A/A line of [A/A measure](#aa-measure);
   - on the held-out set, the gate line: the pass share of each kind, `gate_share`, the count of breaches, the count of earlier held-out evaluations of the stage, in stage 2 the pass share of each kind of the last passed stage 1 gate, and the verdict `pass`, `fail` or `no verdict`;
   - the cost block.
   - A share shows one fraction digit, for example `33.3%`. The gate compares the exact fraction.
5. **Cost block.** For the `swe@1` lines and for the `re@1` lines, the block holds:
   - the sum of `list_price_usd`, the `r` of the model and the sum of the base cost;
   - the mean and the maximum base cost of one run;
   - the measured cache-read share, `cache_read` divided by the sum of `input`, `cache_read` and `cache_write` of `usage`, and the measured output ratio, `output` divided by the same sum. They test the constants 0.8 and 0.02 of [Price ratio](#price-ratio);
   - the `cap_usd` of each call, from `calls.jsonl`;
   - the unstarted runs: the count of planned runs with no line in `checks.jsonl`, and of planned diagnoses with no line in `diagnoses.jsonl`.
   - With no line, each sum is `0`, and the mean and the maximum are `none`.
6. The report holds no text of a session file, no text of `check.txt`, no finding evidence and no credential value. On the held-out set, it holds no line for one case.
7. **Verdict.** A dev evaluation with no parent has the verdict `complete` when each planned run and diagnosis has a line. An A/A pair has the same verdict. A dev evaluation with a parent has the iteration verdict. A held-out evaluation has the gate verdict.
8. `report.sh` exits `0` when the evaluation has a verdict, `3` when it has no verdict, and `1` at a refusal.

## Credential

(G6)

1. The credential is the KanthorD `auth.json` file, the default `--auth` path of `run agent`: `<home>/.config/kanthord/auth.json` ([L2-D10](L2-agent-cli.md#decisions)). It holds the `anthropic` entry for `model` and `judge_model`.
2. No credential value enters a case, a line of `results.jsonl`, `checks.jsonl`, `diagnoses.jsonl` or `calls.jsonl`, `iteration.json`, `diff.patch`, `check.txt`, a file of the judge workspace, a report or the evaluation set. Breach rule 5 counts the values in `diff.patch` and `check.txt`.
3. **Refresh.** Before each `run agent` call with an `oauth` entry, `evaluation.mjs` refreshes the entry with the exported pi API and discards the result:
   - `ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })` (`dist/core/model-runtime.d.ts`);
   - `getAuth(provider, { minOAuthValidityMs })`, where `provider` is the provider of the `--model` of the call.
   - An absent entry gets no refresh. `run agent` then refuses the run.
   - `authPath` is `<home>/.config/kanthord/auth.json`, and `<home>` is `homedir` of `os.userInfo()`. No environment variable selects the file.
   - `minOAuthValidityMs` is the wall budget of the call plus 10 minutes. pi stores the expiry of a new token 5 minutes before the expiry that the provider gives. So the refresh succeeds only when the wall budget plus 15 minutes is less than the token lifetime of the provider.
   - A thrown error or an `undefined` result stops the evaluation with exit `1`. The runner prints no error text of pi. Reason: the error text of a refresh can hold the response body.
   - The refresh writes nothing to stdout or stderr. An `api_key` entry needs no refresh.
4. **No proxy.** The refresh request uses no proxy of the environment. The runner refuses `NODE_USE_ENV_PROXY` and `--use-env-proxy`, as `run agent` does ([L2 Proxy settings](L2-agent-cli.md#proxy-settings)). `evaluation.mjs` sets no global dispatcher.
5. **No write by the run.** The runner records the SHA-256 digest and the mode of the `auth.json` file after the refresh and after each `run agent` call. The two digests are equal, and the mode is `0600` at both times. The configuration directory `<home>/.config/kanthord` gets no new entry. Else the run breaches A9 with `auth_file`, and the evaluation stops.
6. **No credential in a session file.** After each `run agent` call, the runner counts the credential values of the entry in the session file of the call. It counts before the next refresh. It prints only the count, as step 3 of the [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) does. A count other than `0` is the breach `credential`, and the evaluation stops.
7. **Provisioning.** Ulrich provisions the `anthropic` entry once, with these steps:
   1. Make a private temporary directory with mode `0700`.
   2. Log in with pi with `PI_CODING_AGENT_DIR` set to that directory.
   3. Move its `auth.json` to `<home>/.config/kanthord/auth.json`, with mode `0600`.
   4. Remove the temporary directory.

   Nobody copies an `oauth` entry from another file. Reason: two files with one refresh token break each other at the first refresh. The pi login writes other pi files, so it never runs in `<home>/.config/kanthord`.

8. **No core dump.** `run.sh` runs `ulimit -c 0` before its first step, as the [L2 Gate procedure](L2-agent-cli.md#gate-procedure-the-real-credential-run) does. Reason: `evaluation.mjs` holds the token at the refresh, and each run holds the credential.

## Acceptance checks

(G7)

Each check is an end-to-end test ([index](index.md#reading-order)). It runs the `run.sh` or `report.sh` of the engine repository as a process. Each run calls the built `kanthord run agent`, with a real file system, real git and the real pi runtime. The only stub is the LLM stub of [L2](L2-agent-cli.md#l2-fixtures) on loopback.

### L4 fixtures

L4 adds these details to the [L2 fixtures](L2-agent-cli.md#l2-fixtures).

- **Set.** An evaluation set repository E under `$XD/kanthord/evaluation/agent/`, where `XDG_DATA_HOME` is `$XD`.
  - E holds the dev cases `d1` and `d2` and the held-out case `h1`. `d1` and `h1` have the kind `backend`, and `d2` has the kind `frontend`. Each case has `wall` `10m`, `usd` `0.5usd` and `allowed` `["ok.txt"]`.
  - The `repo.bundle` of each case holds one commit C with the file `README.md` (text `case`), a `.gitignore` with the line `node_modules/` and the file `test/old.sh` that exits `0`. The author is the author of content rule 2. `commit` is the id of C.
  - The `setup.sh` of each case exits `0` and writes no file.
  - The `check/tests/` of each case holds `test/new.sh`, which exits `0` when `ok.txt` holds `ok`, and `test/old.sh`, which exits `0`. `check/reference.patch` adds `ok.txt` with the text `ok`.
  - The `check.sh` of each case runs `sh test/new.sh` in `<dir>` for `fail_to_pass`, `sh test/old.sh` for `pass_to_pass`, and exits `0` for `conventions`.
  - The `task.md` of each case holds `task d1`, `task d2` or `task h1`.
  - `binding/backend.md` holds `# Binding` and the text `backend fixture`. `binding/frontend.md` holds `# Binding` and the text `frontend fixture`.
  - `config.json` holds `cap_usd` `15`, `base_model` `openrouter/deepseek/deepseek-v4.1-flash`, `model` `openai-compatible/stub-1:off`, `judge_model` `openai-compatible/stub-1:off`, `judge_usd` `0.1usd`, `repeats` `2` and `gate_share` `0.5`.
  - The `.gitignore` of E names `config.json`. E has one commit of the other files.
- **Stub.** The scripted answers depend on the Role in the system prompt and on the task text. Each answer reports a `usage` of 1000 input and 100 output tokens.
  - `swe@1` with the task `task d1` or `task h1`: call `write` with `ok.txt` and the text `ok`, then answer `done`.
  - `swe@1` with the task `task d2`: answer `done` with no tool call.
  - `re@1`: answer the text `{"findings":[{"aspect":"A5","evidence":"session.jsonl: no test run","severity":"medium"}]}`.
- **Auth.** The `--auth` file of L2 at `$H/.config/kanthord/auth.json`, the default path, with K. The user database gives H as the home of the OS user. Its `OPENAI_COMPATIBLE_MODELS` lists `stub-1` (`approvedModelSchema` in `src/llm/platforms.ts`).
- **R.** The results directory `$XS/kanthord/evaluation/runs/<evaluation-id>/`, where `XDG_STATE_HOME` is `$XS`.
- **Own paths.** Each check and each variant has its own `$XD`, `$XS` and E, unless the check states otherwise.

### Checks

1. **L4-AC1. A dev evaluation grades each run in a new clone, and the diagnosis reads each run.**
   - Fixture: Set, Stub, Auth.
   - Command: `run.sh --evaluation e1 --stage 1 --set dev`, then `report.sh --evaluation e1`.
   - Assert: each command exits `0`.
     - `R/results.jsonl` holds 8 lines: 4 of `swe@1` and 4 of `re@1`. The `swe@1` lines of one case have one `input_digest`.
     - No `swe@1` request to Stub holds the text `fixture`.
     - `R/checks.jsonl` holds 4 lines. The 2 lines of `d1` have `a1` to `a4` and `pass` `true`. The 2 lines of `d2` have `a1` `false`, `a2`, `a3` and `a4` `true`, and `pass` `false`. Each line has `breach` `null`.
     - `R/diagnoses.jsonl` holds 4 lines, each with `valid` `true` and one finding of `A5`.
     - `R/report.md` holds the verdict `complete`, A1 good in 2 of 4 runs, 4 findings of `A5` with the severity `medium`, and the set-difficulty line with 1 ceiling case and 1 floor case of 2.
     - The cost block holds the list price `0`, the `r` `none` and the base cost `0` for the `swe@1` lines and for the `re@1` lines, and the cap `15`.
     - Each run directory holds `session.jsonl`, `stderr.txt`, `diff.patch`, `check.txt`, `judge-1.jsonl` and `judge-1-stderr.txt`, and no other file. The `diff.patch` of each `d2` run has 0 bytes.
     - No workspace root remains under `$XS/kanthord/evaluation/work/`. `git -C E status --porcelain` prints nothing.

2. **L4-AC2. The hidden tests replace the agent files of the same name, and a change outside the scope fails A3.**
   - Fixture: Set, Auth. Stub as usual, except `swe@1` with the task `task d2`: call `write` with `test/new.sh` and the text `exit 0`, then answer `done`.
   - Command: `run.sh --evaluation e2 --stage 1 --set dev`, then `report.sh --evaluation e2`.
   - Assert: each command exits `0`. The 2 lines of `d2` in `R/checks.jsonl` have `a1` `false`, `a3` `false` and `pass` `false`. The `diff.patch` of each `d2` run holds `test/new.sh`.

3. **L4-AC3. Stage 2 gives the kind prompt of the case kind.**
   - Fixture: Set, Stub, Auth. The evaluation `e1` of L4-AC1 ran in the same `$XD`, `$XS` and E.
   - Command: `run.sh --evaluation e3 --stage 2 --set dev`, then `report.sh --evaluation e3`.
   - Assert: each command exits `0`. Each `swe@1` request of `d1` to Stub holds the text `backend fixture` and no text `frontend fixture`. Each `swe@1` request of `d2` holds `frontend fixture` and no text `backend fixture`. The `input_digest` of each `swe@1` line of `e3` differs from the `input_digest` of the line of `e1` for the same case.

4. **L4-AC4. The held-out evaluation gives the gate verdict with no diagnosis.**
   - Fixture: Set, Stub, Auth.
   - Command: `run.sh --evaluation e4 --stage 1 --set held-out`, then `report.sh --evaluation e4`.
   - Assert: each command exits `0`. `R/results.jsonl` holds 2 lines, both of `swe@1`. No `R/diagnoses.jsonl` exists. `R/report.md` holds the gate line with the pass share `100.0%`, `gate_share` `0.5`, 0 breaches and the verdict `pass`. It holds the text `h1` zero times. No run directory holds `check.txt`.

5. **L4-AC5. A breach stops the evaluation.**
   - Fixture: Set, Auth. Each variant uses `run.sh --evaluation e5 --stage 1 --set dev`, then `report.sh --evaluation e5`.
   - Variant 1: Stub for `swe@1` calls `read` with the absolute path of `E/cases/dev/d1/check/check.sh`, then calls `write` with `ok.txt` and the text `ok`, then answers `done`.
     - Assert: `run.sh` exits `1` after the first run. `R/checks.jsonl` holds 1 line with `breach` `protected_path` and `pass` `false`. Stub receives no `re@1` request. `R/report.md` holds 1 breach of `protected_path`, and `report.sh` exits `3`.
   - Variant 2: Stub for `swe@1`: the answer text holds K once, after the `write` call.
     - Assert: `run.sh` exits `1` after the first run. Its stdout holds the count `1` and no other part of K. `R/checks.jsonl` holds 1 line with `breach` `credential`. `R/results.jsonl`, `R/checks.jsonl`, `R/calls.jsonl`, `R/iteration.json`, `R/report.md` and each `stderr.txt` hold K zero times. Auth has the same SHA-256 digest and mode `0600` before and after. E holds K zero times.
   - Variant 3: Stub for `swe@1` calls `bash` with the command `git remote -v; git reflog; cat .git/config`, then calls `write` with `ok.txt` and the text `ok`, then answers `done`.
     - Assert: each command exits `0`. Each line of `R/checks.jsonl` has `breach` `null`. The session files hold no path of E.
   - Variant 4: Stub for `swe@1` calls `bash` with the command `cp "$H/.config/kanthord/auth.json" leak.json`, with `$H` written out, then calls `write` with `ok.txt` and the text `ok`, then answers `done`.
     - Assert: `run.sh` exits `1` after the first run. Its stdout holds a count other than `0` and no part of K. `R/checks.jsonl` holds 1 line with `breach` `credential`. The run directory holds no `diff.patch` and no `check.txt`. R holds K zero times. Stub receives no `re@1` request.
   - Variant 5: Stub for `swe@1` calls `bash` with the command `touch '<XD>/kanthord/evalu''ation/agent/x.txt'`, with `<XD>` written out. The quote split keeps each protected string out of the session file. Then it answers `done`.
     - Assert: `run.sh` exits `1` after the first run. `R/checks.jsonl` holds 1 line with `breach` `set_change`.

6. **L4-AC6. A stop leaves no verdict, and a resume completes the evaluation.**
   - Fixture: Set, Auth.
   - Variant 1: Stub answers HTTP 429 to each request. Command: `run.sh --evaluation e6 --stage 1 --set held-out`, then `report.sh --evaluation e6`. Then Stub answers as usual, and the same two commands run again.
     - Assert, first pair: `run.sh` exits `1`. `R/results.jsonl` holds 3 lines of `swe@1` on `h1`, each with `class` `retryable` and each with its own `session` and `workspace`. `R/checks.jsonl` holds no line. `R/report.md` holds the gate verdict `no verdict`, and `report.sh` exits `3`.
     - Assert, second pair: each command exits `0`. The first run of `h1` uses the run directory `h1/1-4`. `R/checks.jsonl` holds 2 lines. `R/report.md` holds the gate verdict `pass`.
   - Variant 2: Stub as usual. Auth has no entry for `openai-compatible`. Command: as in variant 1.
     - Assert: `run.sh` exits `1`. `R/results.jsonl` holds no line. The `stderr.txt` of the run starts with `cli.run.agent.auth_entry_missing`. `R/report.md` exists.
   - Variant 3: Stub as usual. The `setup.sh` of `h1` exits `1`. Command: as in variant 1.
     - Assert: `run.sh` exits `1`. Stub receives no request. No workspace root remains.
   - Variant 4: Stub as usual. After the first call, a new commit changes `README.md` of E. Then the same `run.sh` command runs again.
     - Assert: the second call exits `1`, and stderr names `set_commit`. Stub receives no request in the second call.

7. **L4-AC7. The cap stops the evaluation before a run.**
   - Fixture: Set, Stub, Auth. The `usd` of each case is `16usd`.
   - Command: `run.sh --evaluation e7 --stage 1 --set dev`, then `report.sh --evaluation e7`.
   - Assert: `run.sh` exits `4`, and `report.sh` exits `3`. Stub receives no request. `R/results.jsonl` holds no line. `R/calls.jsonl` holds one line with `cap_usd` `15`.
     - The cost block of `R/report.md` holds the base cost `0`, the mean `none`, the cap `15`, 4 unstarted runs and 4 unstarted diagnoses.

8. **L4-AC8. `report.sh` refuses an iteration with no prompt change.**
   - Fixture: Set, Stub, Auth.
   - Command: `run.sh --evaluation e8 --stage 1 --set dev`, then `run.sh --evaluation e8b --stage 1 --set dev --parent e8 --aspect A5 --hypothesis "name the test command"`, then `report.sh --evaluation e8b`.
   - Assert: both `run.sh` calls exit `0`. `R/iteration.json` of `e8b` holds the parent `e8`, the aspect `A5` and the hypothesis. `report.sh` exits `1`, and stderr names `system_prompt_digest`. No `report.md` exists in the results directory of `e8b`.

9. **L4-AC9. An invalid diagnosis changes no pass.**
   - Fixture: Set, Auth. Stub as usual, except `re@1`: answer the text `no findings`.
   - Command: `run.sh --evaluation e9 --stage 1 --set dev`, then `report.sh --evaluation e9`.
   - Assert: each command exits `0`. `R/diagnoses.jsonl` holds 4 lines, each with `valid` `false` and no finding. Each line of `R/checks.jsonl` holds the same `a1` to `a4`, `pass` and `breach` as the line of the same case in L4-AC1. `R/report.md` holds 4 invalid diagnoses and the verdict `complete`.

10. **L4-AC10. An A/A pair gives the A/A line.**

- Fixture: Set, Stub, Auth.
- Command: `run.sh --evaluation e10 --stage 1 --set dev`, then `run.sh --evaluation e10b --stage 1 --set dev --replicate e10`, then `report.sh --evaluation e10b`.
- Assert: each command exits `0`. `R/iteration.json` of `e10b` holds `replicate` `e10`. Its `R/report.md` holds the A/A line with A1 good 2 of 4 in each evaluation, the difference `0`, and passes 2 and 2.

### Unit-level rules

These rules hold with no process and no LLM stub, so their tests are unit tests ([index](index.md#reading-order)). The owning module is `scripts/evaluation/agent/evaluation.mjs` of the engine, with its test file `evaluation.test.mjs`. [LA](LA-agent-build.md) assigns the exact file.

1. **The case schema.** `case.json` holds exactly `kind`, `commit`, `wall`, `usd` and `allowed`. `kind` is `backend` or `frontend`. `commit` is a full hexadecimal commit id. `wall` is a wall budget of [L2 Budget](L2-agent-cli.md#budget), rule 1, of at most `2h`. `usd` is a cost budget of rule 2. `allowed` is a list of at least one glob. The schema refuses each other value.
2. **The configuration.** Each refusal of [Configuration](#configuration), and each row rule.
3. **The pass rule and the grading steps.** Each condition of [Pass rule](#pass-rule), with each end of a result line and each breach. A 0-byte diff skips the apply. A failed apply fails A1, A2 and A4. A failed copy fails A1 and A2. A failed `add` or `diff` fails A1 to A4. The copy removes a destination entry after an `lstat`, also a symbolic link.
4. **The scope rules and the frontend rules.** Each rule of [Scope rules](#scope-rules) and of [Frontend rules](#frontend-rules): a rename as a deletion and an addition, each conflict marker form, the modes `120000` and `160000`, and each fail form and each pass form of the arbitrary-value rule.
5. **The breach rules.** Each string of the protected-path search, the order of [Breach rules](#breach-rules), breach rule 5 on `diff.patch` and on `check.txt` with the removal of both files, and the check line of a breach.
6. **The diagnosis parse.** Each rule of [Diagnosis](#diagnosis), rules 5 and 6: an absent or added field, an aspect outside `A1` to `A9`, an empty evidence and one of 501 characters, a severity outside the three, 21 findings, a text with more than one JSON object, and a run that does not end `completed`. The good result of a run on A5, A6 and A7.
7. **The noise rule and the A/A line.** Each rule of [Iteration](#iteration), rule 5, the no-verdict list and the A/A line of [A/A measure](#aa-measure): the difference equal to noise and one below; flips of 0, 1, 2 and 3; a regression equal to noise and one below; a breach; an invalid diagnosis in each evaluation; a planned diagnosis with no line; and two `re@1` lines with different `system_prompt_digest`.
8. **The stage gate.** Each rule of [Stage gate](#stage-gate): a pass share of each kind equal to `gate_share` and one run below, one kind below with the other above, a breach with a planned run with no line, a planned run with no line with no breach, and the count of earlier held-out evaluations. Unit-level rule 8 covers L1-D16.
9. **The cap.** [Run budget](#run-budget), rules 4 and 6 to 8: the base cost is `list_price_usd / r`; a model with no price has the base cost `0`, also when each of its four prices is 0 and when the price read gives no model; the sum plus the reserve equal to `cap_usd` starts the run; one cent above stops the call. A diagnosis run reserves `judge_usd`.
10. **The price ratio.** Each rule of [Price ratio](#price-ratio): `blend` of the three models of its table; the highest tier of a model with tiers; `r` 1 for the base model, so `0.3usd` stays `0.3usd`; an exact multiple of 0.01 stays, and another product rounds up to the next 0.01, with integer arithmetic.
11. **The report keys.** [`report.sh`](#reportsh), rule 3: the report refuses each break of each check, each break of [Iteration](#iteration), rule 4, a parent `re@1` digest that differs, and a `git diff --name-only` list with another path than the two files of [Iteration](#iteration), rule 1. It accepts one digest for an A/A pair only. It accepts two cases with two budgets. The set-difficulty line counts each ceiling case and each floor case. The held-out report holds no line for one case.
12. **The run action.** Each row of [Exit codes of a run](#exit-codes-of-a-run), for a run of `swe@1` and for a diagnosis run: the exits `0`, `1`, `2`, `4`, `5` and `75`, each other exit, the third exit `75` of one run in one call, and `cli.run.agent.prompt_text_path` in stderr. The next free attempt number of a resumed run and of a diagnosis, `judge-<n>.jsonl`. The join of the last `re@1` line of a run directory. The resume of a missing diagnosis.
13. **The start checks.** The refusal of `NODE_USE_ENV_PROXY` and of `--use-env-proxy` in `NODE_OPTIONS`. Each option rule of [`run.sh`](#runsh): `--parent` with `--set held-out`, `--parent` with no `--aspect` or no `--hypothesis`, `--replicate` with `--parent` or with `--set held-out`, an aspect outside `A1` to `A7`, a parent of another stage, and options that differ from `iteration.json`. A dirty engine tree. A `gate_share` that differs from an earlier held-out evaluation of the stage. A refused call writes no line to `calls.jsonl`. A call that passes its start checks writes its line at its start.
14. **The credential state.** A changed digest, a changed mode, a mode other than `0600`, and a new entry in the configuration directory each give the breach `auth_file`.
15. **The refresh.** With an `oauth` entry that expires far in the future, the refresh writes no file, keeps the digest of `auth.json` and writes nothing to stdout or stderr. A thrown error and an `undefined` result each give the stop, with no error text of pi. The refresh uses the provider of the `--model` of the call, and an absent entry gets no refresh.
16. **The price read.** The price read of [Configuration](#configuration) creates no entry in `<home>/.config/kanthord` and reads no credential file. It gives the base prices 0.30, 1.20 and 0.006. It gives no model for `openai-compatible/stub-1`.
17. **The secret scan.** `node evaluation.mjs scan <file>...` exits `1` when a listed file matches a secret pattern of the engine, and `0` else. The pre-commit hook passes the staged files.
18. **The case validation.** `node evaluation.mjs validate <case folder>`: a protected string in a path or a text, `fail_to_pass` that passes on C, and a reference patch that fails one mode in one of three tries or breaks a scope rule each exit `1`.
19. **The transcript.** `transcript.md` holds each entry id, role and text of a session file, with each tool result cut to 4,000 characters.
20. **The diff steps.** The restore of `.git/config`, the removal of `.git/info/attributes`, and the flags of the diff command of [Diff steps](#diff-steps).

### Rules with no check, and the reason

- **The live evaluation.** It needs the credential of Ulrich and the cost of real runs. It runs at step 4.3 of the agent gate.
- **The verdict `keep` or `revert` of a real prompt change.** It needs two engine builds with two prompt versions, and the stub sees one build. Unit-level rule 7 covers the noise rule, and L4-AC8 covers the iteration check.
- **The stage order.** Stage 2 starts after the stage gate of stage 1 passes. The order of the agent gate in the [hub](index.md#round-order) holds it.
- **The blind held-out set.** It is a rule for the prompt author. The held-out report holds no line for one case (unit-level rule 11).
- **A live refresh of an `oauth` entry.** It needs a real login. Unit-level rule 15 covers the refresh with no network request.
- **The case content rules.** They are rules for the case author. The pre-commit hook of the evaluation set enforces rule 4, and `validate` checks rules 6, 7 and 8 (unit-level rule 18). Rules 1, 2, 3, 5 and 9 to 12 need a review of the case.
- **Provisioning.** It needs a real login by Ulrich.
- **The scaled budget and the base cost of a priced run.** No priced model reaches the stub, because only `openai-compatible` routes to a loopback URL. Unit-level rules 9 and 10 cover the rule. The live evaluation shows `budget.usd` and the base cost in the report.
- **No core dump.** A core dump needs a crash of a process. The review of `run.sh` checks the `ulimit -c 0` line.

## Handoffs to later layers

- [LA](LA-agent-build.md): add `scripts/evaluation/agent/run.sh`, `report.sh`, `evaluation.mjs`, `evaluation.test.mjs`, `judge.md` and `judge-task.md` to the engine, after the step that ships `run agent`. Run the L4 checks in the step that adds them.
- [LA](LA-agent-build.md): run the L4 checks as the test user of the Linux job of [LA2](LA2-credential-boundary.md), as for L2-AC6. The user database gives the home of that user. Add the new test file to the scripts `test`, `format`, `lint` and `format:check` of `package.json`. Add `evaluation.mjs` to `format`, `lint` and `format:check`.
- [LA](LA-agent-build.md): give the L4 test file a timeout above 60 seconds. Reason: variant 1 of L4-AC6 waits for three attempts with three pi retries each, about 42 seconds.
- [LA](LA-agent-build.md): build the evaluation set under `<data>/evaluation/agent/`: 10 dev cases, 6 held-out cases, `binding/backend.md`, `binding/frontend.md`, a `.gitignore` that names `config.json`, and `config.json`, with the content rules and the pre-commit hook that runs `node evaluation.mjs scan`. Run `node evaluation.mjs validate` for each case. The set is no part of the engine repository.
- [LA](LA-agent-build.md): write `judge.md` with the question of each goal aspect of [Goal aspects](#goal-aspects) and the output form of [Diagnosis](#diagnosis), rule 5. `judge.md` governs items 1 to 3 of `## Judgement` of the `re@1` prompt for the diagnosis. It names missing process evidence as an A5 finding. It states that a quote of the transcript is allowed and holds no secret, because the runner counts the credential values before the copy.
- [L7](L7-worker-evaluation.md): the worker-level checks against a local KanthorD server, the review cases of `reviewer@1` and `re@1`, and the successor of `~/kanthord-evalset/worker-v2/`.
- [HANDOFF.md](../HANDOFF.md#agent-component), Agent component: another run model, when Ulrich asks for it.

## Changes in upper layers

- L1 E1 gives the project context through the binding prompt, and L1-D16 states the stage gate.
- L2 compares two prompt versions case by case.
- L3 holds `swe@1`, `re@1` and `env@1`.
- The hub states R9, the gate step 4.3 and the terms of L4.

## Decisions

1. **L4-D1.** The agent evaluation is the layer L4, a caller of the agent CLI (Ulrich, 2026-11-22). Constraint: the design of L4 comes after L3 and before LA; it runs at gate step 4.3 against the built agent; the worker evaluation is L7.
2. **L4-D2.** The evaluation measures `swe@1` against the goal aspects A1 to A9 (Ulrich, 2026-11-22). Constraint: scripts decide A1 to A4, and A1 to A4 with the end `completed` decide the pass; A5 to A7 come from the Opus diagnosis and are never a pass rule; A7 includes tests for the changed behavior; A8 is measured; A9 is the boundary of the evaluation, and a breach stops the evaluation.
3. **L4-D3.** The evaluation has two stages (Ulrich, 2026-11-22). Constraint: stage 1 runs `swe@1` with no context; stage 2 gives the kind prompt of the case kind, the repository prompt of the case repository of that kind with its conventions, as one `--system-prompt` part; stage 2 starts after the stage gate of stage 1 passes.
4. **L4-D4.** The run model is `anthropic/claude-haiku-5-5:high` only (Ulrich, 2026-11-22). Constraint: no other level runs; the report shows the set-difficulty line; the set author replaces the dev cases at the ceiling when more than half of the dev cases are at the ceiling.
5. **L4-D5.** The evaluation set has a dev set of 10 cases and a held-out set of 6 cases, each with equal halves of `backend` and `frontend` (Ulrich, 2026-11-22). Constraint: iterations use only the dev set; the held-out set runs only at the stage gate and gets no diagnosis; nobody reads a held-out run to change a prompt; the set holds no review case; `repo.bundle` holds no commit after C.
6. **L4-D6.** The grading follows DeepSWE v1.1: the agent diff applies to a new clone of C in a new grading root, the hidden tests replace the files of the same name, and `check.sh` runs there (Ulrich, 2026-11-22). Constraint: the order is clone, `setup.sh`, apply, conventions, copy of the hidden tests, `fail_to_pass`, `pass_to_pass`; the grading runs for each run; a failed apply fails A1, A2 and A4; A3 reads only the diff and fails a symbolic link or a submodule; each case has a hidden `reference.patch` that passes each mode three times.
7. **L4-D7.** A9 has the breach rules `credential`, `auth_file`, `protected_path` and `set_change`. `credential` covers the session file, `diff.patch` and `check.txt`. Constraint: a breach stops the evaluation, fails the stage gate and gives `revert` to an iteration; the protected-path search is a heuristic that guards the hidden tests; the grading root gets a random name after the run ends.
8. **L4-D8.** The diagnosis runs `kanthord run agent re@1` on `anthropic/claude-opus-5-5:high` for each dev run (Ulrich, 2026-11-22). Constraint: the diagnosis decides no pass; `judge.md` and `judge-task.md` lie in the runner; the judge reads `diff.patch`, `check.txt`, `check.json`, `task.md`, the kind prompt in stage 2 and `transcript.md`; the output is a fixed JSON form of findings with aspect, evidence and severity; the report counts the findings for each aspect and holds no evidence; the `re@1` profile prompt is the same in an iteration and its parent; each attempt has its own `judge-<n>.jsonl`; the base cost counts against `cap_usd` through `r`; the credential rules apply to the diagnosis run.
9. **L4-D9.** One dev evaluation is one iteration with one prompt change and one hypothesis that names the target aspect (Ulrich, 2026-11-22). Constraint: the change edits only `static/prompt/role/swe@1.md` and its copy in `static/prompt/swe@1.md`; each case runs at least 2 times; the noise rule is a hypothesis that Ulrich sets from an A/A pair of the baseline before the first iteration of a stage; the iteration keeps the change only when the target gain is at least the noise and the pass loss is less than the noise; each iteration keeps `iteration.json` and its report; the prompt commit of a `revert` iteration leaves the engine.
10. **L4-D10.** The stage gate passes when at least `gate_share` of the held-out runs of each kind pass and no run breaches A9 (Ulrich, 2026-11-22). Constraint: Ulrich fixes the gate before the first run; `gate_share` starts at 0.6 as a hypothesis; Ulrich approves `gate_share` before the first live run; `gate_share` stays fixed from the first held-out evaluation of a stage; the held-out set gets no diagnosis.
11. **L4-D11.** A run has no turn limit. The wall budget and the cost budget of each case, fixed in `case.json`, bound each run (Ulrich, 2026-11-22). Constraint: `wall` is at most `2h`; a diagnosis run has `15m` and `judge_usd`; the runner passes no cost budget for a model with no price.
12. **L4-D12.** One cap `cap_usd` in `config.json` covers one evaluation. The cap is in base dollars, the price of `base_model` `openrouter/deepseek/deepseek-v4.1-flash` (Ulrich, 2026-11-22). Constraint: `cap_usd` starts at 15 as a hypothesis; the set repository does not track `config.json`, so the cap can change at a resume; the base cost of a run is its `list_price_usd` divided by `r`; the cap is a start gate; Ulrich approves `cap_usd` before the first live run.
13. **L4-D13.** A cost budget in base dollars scales to each model with one price ratio `r(m) = blend(m) / blend(base_model)`, where `blend(m) = 0.8 × cacheRead(m) + 0.2 × input(m) + 0.02 × output(m)` (Ulrich, 2026-11-22). Constraint: a model with price tiers uses its highest tier; the constants are part of the rule; an exact multiple of 0.01 stays, else the scaled budget rounds up to the next 0.01, with integer arithmetic.
14. **L4-D14.** The evaluation set lies in `<data>/evaluation/agent/`, and the results lie in `<state>/evaluation/runs/<evaluation-id>/` of the KanthorD XDG directories (Ulrich, 2026-11-22). Constraint: each directory has mode `0700`; one evaluation id names one stage, one set and one prompt version; the set has no remote; nobody commits a result.
15. **L4-D15.** The runner is `run.sh`, `report.sh`, `evaluation.mjs`, `judge.md` and `judge-task.md` in `scripts/evaluation/agent/` of the engine. Constraint: it calls only the built `kanthord run agent`, git, the case scripts, Node and the exported pi API; the runs go in sequence; the same evaluation id resumes a stopped evaluation by the key case and repeat.
16. **L4-D16.** The credential is the KanthorD `auth.json` file at the default `--auth` path. Constraint: no credential value enters a case, a result, a check record, a diagnosis, an iteration record, a call record, `diff.patch`, `check.txt`, the judge workspace or a report; the runner checks the digest and the mode of the file around each `run agent` call, and counts the credential values after each call; provisioning uses a private temporary pi directory and one move of `auth.json`.
17. **L4-D17.** The refresh of an `oauth` entry uses `ModelRuntime.create` and `getAuth` of pi with an explicit `authPath` from the user database and the provider of the `--model` of the call. Constraint: no pi CLI, no environment variable that selects the file, no proxy of the environment, no output of the token, no error text of pi, and no core dump.
18. **L4-D18.** The price read uses the exported pi API with an in-memory credential store. Constraint: the price read opens no credential file.
19. **L4-D19.** Each workspace and each grading clone is a clone with no remote and no reflog. Constraint: no path of the case folder stays in a clone.

## Open questions for Ulrich

None.
