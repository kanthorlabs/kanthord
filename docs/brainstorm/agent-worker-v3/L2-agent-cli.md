# L2: The agent CLI

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model that this page satisfies. Each KanthorD path starts at `engine/`. Each pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`), unless the path names another pi package. The code of today is engine `c864130e`.

## Goals

1. **G1.** `kanthord run agent` runs one agent profile on one piece of work with no KanthorD server. The page states the full CLI contract: the command, each input, the output, the exit codes and each diagnostic code.
2. **G2.** Each option answers one question that a KanthorD agent run needs. pi stays the base runtime; the command is no wrapper of the pi CLI.
3. **G3.** Each credential rule of L1 for `run agent` maps to one CLI rule and one diagnostic code. No rule becomes weaker.
4. **G4.** Each public behavior of L2 is an end-to-end acceptance check or a unit-level rule with its owning module ([index](index.md#layer-files)).
5. **G5.** The CLI alone runs the real-credential run of the agent gate and the evaluation of [L1-D20](L1-model.md#decisions). The output file is the record that the evaluation reads.
6. **G6.** Each need of L2 from the agent contract is a requirement on [L3](L3-agent.md), not an L3 design.
7. **G7.** The direction point of R1, "input as options, a JSON file or a Markdown file", has a verdict and a fit rule.

## Evaluation of the direction

(G7)

### R1. Input as options, a JSON file or a Markdown file (fits in part, with a suggestion)

- **Verdict.** Options and a Markdown file fit. The JSON file does not fit.
- **Evidence.** Each input of a run is one option, and a `--prompt` or `--system-prompt` value can name a Markdown file ([Text or path](#text-or-path)). Each field then has one source, so a JSON input file has no reader.
- **Suggestion for Ulrich.** Drop the JSON input file. The command line of a run records its fixed input, and the `input_digest` of the result proves that two runs had the same input ([Comparison rule](#comparison-rule)). Aelita applied this on 2026-11-22.
- **Fit rule.**
  1. The work prompt and the extra context take text or a file path ([Text or path](#text-or-path)).
  2. Each other input is one option. Each field has exactly one source.

## Command and the root `run`

(G1, G2)

```text
kanthord run agent <agent-name>
  --model <provider>/<model>:<level>
  --session <path>
  --prompt <text|path>...
  [--system-prompt <text|path>]...
  [--budget <duration|Nusd>]...
  [--workspace <path>]
  [--auth <path>]
  [--output <stdout|path>]
```

- Ulrich ruled on 2026-11-22: the command represents the needs of a KanthorD agent run. pi stays the base runtime. Each option answers one question, and no other option answers it.
- `run agent` runs one agent profile on one piece of work, writes one result and exits. It is local. It calls no route, opens no database, reads no server configuration file and reads no `cli.yaml`.
- Change: `run` joins the closed set of global root names. Today the set holds `config`, `upgrade`, `serve` and `auth` (`docs/cli/other.md`, section "Closed root names and option scope"; `TOP_LEVEL_NAMES` in `src/apps/cli/completeness.test.ts`). The constant `CommandName` of `src/apps/cli/constants.ts` gets `Run: "run"`, because `createProgram` asserts one root command per name (`src/apps/cli/index.ts`).
- `kanthord run` with no operand prints the group help and exits `0`, as each group does (`docs/cli/other.md`, section "Help semantics"). `kanthord run --help` lists `agent`.
- The name `run worker` is reserved for [L4](L4-worker-cli.md). Until L4 builds it, the group `run` holds only `agent`.
- The component root `agent` (`kanthord agent get`, `src/apps/cli/agent.ts`) stays. It reads the server part of the Agent component. `run agent` is the agent CLI. The two names do not overlap, because `agent` is a root and `agent` under `run` is a leaf.
- The new page `docs/cli/run.md` owns `run agent`, with the heading "Command inventory". `docs/cli/other.md` lists `run` among the global root names and links the page.
- The page `docs/cli/run.md` states these facts for the developer, as [L1](L1-model.md#handoffs-to-later-layers) hands them:
  - the [reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session) for `run agent` on a developer machine;
  - use a credential that the developer owns, not a credential of a project or a team;
  - a `--prompt` or `--system-prompt` path can name each file that the OS user can read, for example a file in `~/.ssh` or `~/.aws`, and the run sends its text to the provider;
  - `list_price_usd` and the cost budget use the list price of the pi catalog, also for a subscription entry, which pays no such charge;
  - disable core dumps with `ulimit -c 0` before a run. Today the page of `tasks run` states this rule (`docs/cli/worker.md`, section `tasks run`).
- Change: `kanthord worker tasks run`, `tasks seed` and `tasks compare` leave ([L1-D20](L1-model.md#decisions), [L1-D23](L1-model.md#decisions)). `run agent` takes over the credential checks of `tasks run`.

## Inputs

(G1, G2, G3)

### Options

| Option or operand                    | Question it answers                          | Rule                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<agent-name>`                       | Which agent runs?                            | Required operand, checked at step 2. One profile name of the runtime catalog, for example `swe@1` or `bee@1`. The run refuses an unknown name with `cli.run.agent.agent_unknown`.                                                                                                                                                                               |
| `--prompt <text\|path>`              | What work does the agent do?                 | Required and repeatable. Each value is one prompt part, in the order of the command line. [Text or path](#text-or-path) decides whether a value is text or a file. [Prompt](#prompt) holds the rules.                                                                                                                                                           |
| `--system-prompt <text\|path>`       | What extra context does the agent get?       | Optional and repeatable. Each value is one context part, in order, after the profile prompt at the place of the Repository prompt, layer 2. It never replaces the profile prompt. [Prompt](#prompt) holds the rules.                                                                                                                                            |
| `--model <provider>/<model>:<level>` | Which model runs, at which reasoning effort? | Required. One model selection with its reasoning effort. [Model selection](#model-selection) holds the rules. No default: a profile names no model ([L1-D3](L1-model.md#decisions)).                                                                                                                                                                            |
| `--budget <duration\|Nusd>`          | How much can the run spend?                  | Optional and repeatable: one wall budget, one cost budget, or both. The first limit that the run reaches ends it with the end `budget_end`. [Budget](#budget) holds the rules.                                                                                                                                                                                  |
| `--workspace <path>`                 | Where does the agent work?                   | Optional. The working directory of the session, and the one confinement root of a confined profile. Default: the current directory of the process. At step 2, the run refuses an absent path or a path that is no directory with `cli.run.agent.option_invalid`, `option: --workspace`. The start preconditions of the profile apply to it ([L3](L3-agent.md)). |
| `--session <path>`                   | Where does the record of the work go?        | Required: L1 rules that the consumer names the path of the session file ([Statelessness](L1-model.md#statelessness), check 4). [Session file path](#session-file-path) holds the rules.                                                                                                                                                                         |
| `--auth <path>`                      | Which credential pays for the model?         | Optional. A file in the pi `auth.json` format. Default: `.config/kanthord/auth.json` in the home directory of the OS user. [The `--auth` file](#the---auth-file) holds the rules.                                                                                                                                                                               |
| `--output <stdout\|path>`            | Where does the result go?                    | Optional. Default `stdout`: a text result for a human. A path: one JSON line per run, appended to that file. [Output](#output) holds the rules.                                                                                                                                                                                                                 |

- A relative path resolves against the current directory of the process.
- The run refuses a single-value option given twice with `cli.option.duplicate` (`singleUse` in `src/apps/cli/shared.ts`). `--prompt`, `--system-prompt` and `--budget` repeat.
- The run refuses an absent `<agent-name>`, `--model`, `--session` or `--prompt` with `cli.run.agent.option_invalid` and the `option` row. For the operand, the `option` row is `<agent-name>`. The command declares the operand and these options as optional in Commander and checks them at step 2. Reason: a Commander required option ends the parse with a Commander error before the `--token` refusal of step 1.
- Change: no option selects the pi directory. The run uses the pi directory of the engine ([The pi directory](#the-pi-directory)).

### Text or path

Ulrich ruled on 2026-11-22: a `--prompt` or `--system-prompt` value has no mark and no prefix. The run decides from the value itself. pi reads a `--system-prompt` value as a file when a file of that name exists (`resolvePromptInput` in `dist/core/resource-loader.js:100`). `run agent` decides in this order, which refuses more than pi:

1. **Looks like a path.** A value looks like a path when all three conditions hold:
   1. it holds no line break (`\n`, `\r`) and no NUL character;
   2. its length is 1 to 4096 bytes in UTF-8;
   3. it starts with `/`, `./` or `../`, or it holds no whitespace and either holds a `/` or ends with `.` followed by 1 to 8 ASCII letters or digits. Whitespace is the ASCII space, tab, carriage return and line feed.
2. **Text.** A value that does not look like a path is text, even when a file of that name exists. Examples: `fix the failing test`, `README`. To read the file `README`, write `./README`. A value with a line break is always text. A script that passes a text from outside appends a line break, so the text never reads a file.
3. **Path.** The run resolves a value that looks like a path against the current directory. It expands no `~`. `stat` decides whether an entry exists, so a symbolic link resolves to its target.
   1. When no entry exists at the path, the value is text. The run writes one notice line on stderr ([stderr](#stderr), item 3) with the code `cli.run.agent.prompt_text_path`. The notice refuses nothing. Reason: a typo in a file name becomes visible.
   2. The run refuses the entry with `cli.run.agent.auth_place` when it is the `--auth` file, compared by device and inode. It also refuses an entry whose real path lies in the KanthorD configuration directory or in the pi directory. The configuration directory is `<home>/.config/kanthord` of the user database and `directories(env).config` (`src/kernel/xdg.ts`). Reason: the text of a prompt part enters the model request. The check runs before the read.
   3. The run refuses the entry with `cli.run.agent.prompt_place` when its absolute path before link resolution or its real path lies under `/dev` or `/proc`. Example: on Linux, `/dev/stdin` resolves through `/proc/self/fd/0`. Reason: `run agent` reads no standard input and no process state, for example `/proc/self/environ`.
   4. When an entry exists, the run reads it with `readTextFile` (`src/apps/cli/shared.ts:101-118`). That function refuses a path that is no regular file with `cli.file.not_regular`, and text that is not UTF-8 with `cli.file.encoding_invalid`. Each refusal has the `path` row. Reason: an existing entry shows that the human meant a file. This refusal is narrower than the ruling of Ulrich, which uses each other value as text ([Open questions for Ulrich](#open-questions-for-ulrich)).
4. **No image.** An image file is not UTF-8 text, so rule 3.4 refuses it. Reason: the coding profiles of L3 need no image input (R2), and the session file holds no image record that the evaluation reads.

### Prompt

1. **One turn.** The run sends one user message, one turn. The message is the text of each `--prompt` part, in order, joined with one blank line (`\n\n`). A file part is the content of the file without a byte order mark. The run removes each final line break (`\n` or `\r\n`) of each part.
2. **Required.** A part with no text adds nothing. With no text in all parts, the run refuses the input with `cli.run.agent.prompt_missing`.
3. **Extra context.** Each `--system-prompt` part is one instruction text, in order, with its final line breaks removed. A part with no text adds nothing. The composition function of [L1-D10](L1-model.md#decisions) places the texts at the place of the Repository prompt, layer 2, after the profile prompt ([Requirements on L3](#requirements-on-l3), item 12). A part never replaces the profile prompt. Change against pi: the pi option `--system-prompt` replaces the default system prompt (pi `docs/cli.md`, section "Prompts and process").
4. **Reader of the extra context.** The [evaluation](#one-evaluation-run) gives the stored Repository prompt and the Binding prompt of `swe@1` with `--system-prompt`, so a role profile runs with the same repository context. `run agent` reads no server, so no other source of these texts exists.
5. **Standard input.** `run agent` reads no standard input ([L1-D22](L1-model.md#decisions)), so a piped text never reaches the message.

### Model selection

Ulrich ruled on 2026-11-22: the model selection takes the official pi CLI form `<provider>/<model>:<level>` ([L1-D24](L1-model.md#decisions)). pi parses this form with the exported function `resolveCliModel({ cliProvider, cliModel, cliThinking, modelRuntime })` (`dist/core/model-resolver.d.ts`; exported by `dist/index.d.ts`). pi then matches fuzzily (exact id, then a partial id or name) and clamps the level to the model when it applies it (`docs/cli.md`, section "Models"). `run agent` keeps one model selection and makes no model choice ([Statelessness](L1-model.md#statelessness), check 9), so it refuses more than pi.

1. **Form (step 2 of the [run order](#run-order)).** `provider` is the text before the first `/`. `level` is the text after the last `:`. `model` is the text between them, and it is not empty. A model id can thus hold `/` and `:`. The run refuses a value with no `/`, or with no `:` after the `/`, with `cli.run.agent.option_invalid`, `option: --model`.
2. **Provider.** `provider` is a pi provider id: a value of `agentProviderKindSchema` (`src/agent/contract.ts`) other than `anthropic-subscription`. pi has no provider `anthropic-subscription`; its OAuth entry is the entry `anthropic` (`piProviderId` in `src/kernel/pi-provider.ts`). Else the run refuses it with `cli.run.agent.option_invalid`, `option: --model`.
3. **Level.** `level` is required and is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max` (pi `docs/cli.md`, section "Models"). Else the run refuses it with `cli.run.agent.option_invalid`, `option: --model`. The engine needs no mapping: `reasoningEffortSchema` (`src/agent/contract.ts`) and `ReasoningLevel` (`src/llm/platforms.ts`) hold the same seven values, and `agentPort` passes `reasoning_effort` unchanged as the pi `thinkingLevel` (`src/agent/agent-port.ts`). This page calls the level the reasoning effort, the term of the engine.
4. **Resolution (step 9).** `run agent` calls `resolveCliModel` with `cliModel` set to the whole value and with no `cliProvider` and no `cliThinking`. The run refuses a result with no model or with an `error` with `cli.run.agent.model_unknown`. The run then calls `modelRuntime.getModel` with the provider and the id of the result model (`dist/core/model-runtime.d.ts`). The run refuses an `undefined` result, or a result that is not the result model of `resolveCliModel`, with `cli.run.agent.model_unknown`. Reason: the custom model fallback of `resolveCliModel` (`buildFallbackModel`, `dist/core/model-resolver.js`) returns a model that the runtime does not hold. A fuzzy result is a model of the runtime, so rule 5 refuses it. Today `resolveModel` refuses a model that `getModel` does not give (`src/llm/model-connector.ts:182-186`). pi also treats that result as not found (`dist/cli/credential-print.js:35`). The run does not read the warning text of `resolveCliModel`.
5. **Exact match (step 9).** The provider of the result model must equal `provider`, its id must equal `model`, and the returned `thinkingLevel` must equal `level`, each byte for byte. Else the run refuses it with `cli.run.agent.model_inexact`. Reason: a fuzzy match, a case-insensitive match or the raw-id fallback of `resolveCliModel` selects another model than the text names (`dist/core/model-resolver.js`).
6. **Supported level (step 9).** `level` must be in `getSupportedThinkingLevels` of the result model (`@earendil-works/pi-ai`, `dist/models.js`). Else the run refuses it with `cli.run.agent.level_unsupported`. The run never clamps the level. Today the engine refuses an unsupported level too (`resolveModel` in `src/llm/model-connector.ts`, `reasoning_effort_unsupported`).

Change: `tasks run` takes `--model <provider/model>` and `--reasoning <level>` as two options (`withModel` in `src/worker/unit/tasks-seed.ts`).

### Budget

Ulrich ruled on 2026-11-22: one option `--budget` takes each limit, and the form of the value decides its kind.

1. **Wall budget.** A positive integer with `s`, `m` or `h`, for example `30m` or `1h` (`DURATION_PATTERN` in `src/worker/unit/tasks-seed.ts`). The wall clock starts at the clock read of step 9.
2. **Cost budget.** A positive decimal number with at most 6 fraction digits and the suffix `usd`, for example `5usd` or `0.25usd`.
3. **Kinds.** The run refuses a value of no kind, a zero value and a second value of one kind with `cli.run.agent.option_invalid`, `option: --budget`.
4. **First limit.** The first limit that the run reaches ends the current turn with the end `budget_end`. The result names the limit in `budget_reached`: `wall` or `usd`.
5. **Cost.** The cost of a run is its list price: the sum of `usage.cost.total` of each assistant message of the run (`Usage` in `@earendil-works/pi-ai`, `dist/types.d.ts:291-312`). pi computes it from the catalog price of the model (`calculateCost` in `@earendil-works/pi-ai`, `dist/models.js:658`). A subscription entry pays no list price, but the run still counts the list price. Aelita decision: an `oauth` entry accepts a cost budget as a limit on the list price. The run compares the sum with the limit after each assistant message. One model call can thus pass the limit before the run ends.
6. **No price.** The run refuses a cost budget at step 9 when the resolved model has no price: each of `cost.input`, `cost.output`, `cost.cacheRead` and `cost.cacheWrite` of the model is 0. The code is `cli.run.agent.budget_unpriced`. Reason: the run cannot enforce a cost limit that the usage never reaches. Each `openai-compatible` model has no price (`compatibleProvider` in `src/llm/model-connector.ts:100`), and some catalog models have none, for example the free models of `openrouter`. The `nvidia` models and the `google` gemma models include more examples (`@earendil-works/pi-ai`, `dist/providers/data/`). The other models of the pi catalog carry a price, for example `dist/providers/data/openai-codex.json`.
7. **Default.** Aelita decision: with no wall budget, the wall budget is `2h`, the wall budget of a native worker (`NATIVE_RESOURCE_BUDGET` in `src/worker/catalog.ts:23`). With no cost budget, the run has no cost limit.
8. **No count limit.** Aelita decision: the wall budget and the cost budget are the only two limits. The count limit of 200 of `NATIVE_RESOURCE_BUDGET` does not apply to `run agent`.
9. **Retries in the budget.** The wait of each pi retry ([Classes](#classes), rule 5) counts against the wall budget.

### Inputs that do not exist

- No option other than `--auth` names a credential source ([L1-D14](L1-model.md#decisions)). No option, no environment variable and no input file other than the `--auth` file names an endpoint.
- `run agent` never reads standard input ([L1-D22](L1-model.md#decisions)). Change: `tasks run` reads the credential from standard input with `--credential-stdin` (`readDescriptor` and `runAction` in `src/apps/cli/worker-tasks.ts`).
- The run refuses `--token <jwt>` with `cli.run.agent.token`. The command declares `--token <jwt>` as a hidden option only to refuse it, as `serve worker` does (`src/apps/cli/index.ts:196-199,240`). The refusal comes first, before each other check. A `--token` with no value is a Commander syntax error, exit `1`.
- No `--pass-env` exists in this round, because no reader of a passed variable exists. A child process gets only the names of [The run directory](#the-run-directory), rule 5. [HANDOFF.md](../HANDOFF.md#agent-component) holds the future input with the rules of today.
- No resume input exists in this round. `--session` names a new file only ([L2-D5](#decisions)).
- No telemetry output exists. The session file and the result are the record of the run.
- No JSON input file exists ([R1](#r1-input-as-options-a-json-file-or-a-markdown-file-fits-in-part-with-a-suggestion)).

## The `--auth` file

(G3)

This section maps each item of [The `--auth` file of `run agent`](L1-model.md#the---auth-file-of-run-agent) to a CLI rule. The item numbers are the numbers of L1.

### File checks

1. **Default path (item 1).** Ulrich ruled on 2026-11-22: the default path is `<home>/.config/kanthord/auth.json`. `<home>` is `homedir` of `os.userInfo()`, the home directory of the OS user in the user database. The path is fixed. It reads no `HOME`, no `XDG_CONFIG_HOME` and no `PI_CODING_AGENT_DIR`. Reason: no environment variable selects the credential file, and `os.homedir()` returns `HOME` first on POSIX. The file format stays the pi `auth.json` format. To reuse the file of pi, the human passes `--auth ~/.pi/agent/auth.json`. With no `--auth` and a failed lookup in the user database, the run refuses with `cli.run.agent.auth_file_invalid` and no `path` row.
2. **Read before the ambient removal (item 2).** `run agent` reads the entry before it redirects `HOME` ([Run order](#run-order), step 6).
3. **File checks (item 5).** `lstat` of the path must give a regular file. The run refuses an absent path, a symbolic link or another file type with `cli.run.agent.auth_file_invalid`. It refuses a file that another user owns with `cli.run.agent.auth_file_owner`. It refuses a mode with a group or other bit (`0o077`) with `cli.run.agent.auth_file_mode`. Reason for the link refusal: pi reads the entry by path (`readStoredCredential(providerId, authPath)`), so the run checks the file at that path and follows no link.
4. **Place.** The `--auth` file is not inside the workspace. The run compares the real path of its parent directory, plus its name, with the real path of the workspace. Else the run refuses it with `cli.run.agent.auth_place`. Reason: the agent reads each workspace file with `read` or `bash`, so the credential reaches the model, and a commit takes the file. A prompt path that is the `--auth` file gets the same refusal ([Text or path](#text-or-path), rule 3.2).
5. **The read (item 3).** `run agent` calls `readStoredCredential(providerId, authPath)` with the absolute path (`dist/core/auth-storage.js`). `providerId` is the `provider` of the [model selection](#model-selection), a pi provider id. The call writes nothing.
6. **No entry (item 10).** The run refuses `undefined` from the read with `cli.run.agent.auth_entry_missing`. The read gives `undefined` for an absent entry and for a file that holds no valid JSON (`readStoredCredential`), so one code covers both. The `field` row names the provider id.

### Entry checks

Checks 1 to 5 run at step 5 of the [run order](#run-order), in this order. The first failed check gives the refusal. Check 6 runs at step 9.

1. **Entry schema (item 10).** The raw entry must pass one branch. Else the run refuses it with `cli.run.agent.auth_entry_invalid`, and the `field` row names the failed path.
   - `api_key`: a strict object with `type: "api_key"`, `key` and an optional `env`. `key` passes the `api_key` branch of `piCredentialSchema` (`src/custody/contract.ts`). `env` is an object of string values.
   - `oauth`: an object with `type: "oauth"`, `access`, `refresh` and `expires`. These four fields pass the `oauth` branch of `piCredentialSchema`. The run ignores each other field and passes only the four fields to the frozen store. Reason: pi writes provider fields in an OAuth entry, for example `accountId` of `openai-codex` (`@earendil-works/pi-ai`, `dist/auth/oauth/openai-codex.js`, `credentialsFromToken`). The request path of `openai-codex` reads the account from the access token (`extractAccountId` in `@earendil-works/pi-ai`, `dist/api/openai-codex-responses.js`).
   - Each branch refuses each entry that the pi `auth.json` load refuses (`load` of `ReadOnlyAuthStorage` in `dist/core/auth-storage.js`, a class that pi does not export). It also refuses an `api_key` entry with no `key`, which pi accepts ([L1-D24](L1-model.md#decisions)).
2. **Shell command (item 7).** The run refuses a `key` that starts with `!` with `cli.run.agent.auth_key_command`, field `key`.
3. **Variable reference (item 6).** The run refuses a `key` that holds `$` anywhere with `cli.run.agent.auth_key_reference`, field `key`.
4. **Provider check (item 4).** The entry type must equal the secret shape of the selected provider (`secret_shape` of `LLM_PLATFORMS` in `src/llm/platforms.ts`). Else the run refuses it with `cli.run.agent.auth_entry_invalid`, field `type`. Change: today `credentialOf` compares only the provider id (`src/worker/unit/tasks-credential.ts`). The `--auth` read selects the entry by the provider id, so the shape check is the provider check of `run agent`. For the pi provider `anthropic`, the entry type selects the provider of the engine: an `api_key` entry is `anthropic`, and an `oauth` entry is `anthropic-subscription` (`ANTHROPIC_SUBSCRIPTION_PLATFORM` in `src/kernel/pi-provider.ts`). For each other provider, the provider of the engine is the pi provider id.
5. **Routing metadata (item 4 and "Endpoint" of [LLM credential](L1-model.md#llm-credential)).** The run maps the `env` object to the routing metadata with the [mapping](#routing-metadata-mapping). The metadata schema of the provider must pass (`metadata_schema` of `LLM_PLATFORMS`). Else the run refuses it with `cli.run.agent.auth_entry_invalid`. The `field` row names `env` when the `env` value is no object of string values. Else it names `env.<NAME>` for the first failed name. First come the required names of the provider that are absent or invalid, in the order of the mapping table. Then come the extra names, in byte order.
6. **Expiry (item 4, step 9).** The run refuses an `oauth` entry whose `expires` is before the wall deadline plus `PI_OAUTH_REFRESH_WINDOW_MS` (5 minutes, `src/llm/refresh-watch.ts:4`), with `cli.run.agent.credential_expiring`. The wall deadline is the clock read of step 9 plus the wall budget. The check runs before the session open. The human refreshes the entry with pi ([Gate procedure](#gate-procedure-the-real-credential-run)).

Each credential value of the entry joins the known secrets (item 8): `key`, or `access` and `refresh` (`credentialValues` in `src/worker/unit/tasks-credential.ts`). One `frozenStore` (`src/llm/refresh-watch.ts`) serves the checked credential to the model runtime.

### Routing metadata mapping

L1 hands this mapping to L2. Each name is a key of the `env` object of the entry. The mapping is the inverse of `METADATA_ENV` (`src/llm/model-connector.ts`), which gives these names to pi today. The `openai-compatible` names are new, because pi has no `openai-compatible` provider. The model connector registers that provider itself (`compatibleProvider` in `src/llm/model-connector.ts`).

| Provider                | Name in `env`                                    | Metadata field                          | Schema (`src/llm/platforms.ts`)     |
| ----------------------- | ------------------------------------------------ | --------------------------------------- | ----------------------------------- |
| `openai-compatible`     | `OPENAI_COMPATIBLE_BASE_URL`                     | `base_url`                              | `openaiCompatibleMetadataSchema`    |
| `openai-compatible`     | `OPENAI_COMPATIBLE_MODELS`                       | `models`, as the JSON text of the array | `openaiCompatibleMetadataSchema`    |
| `amazon-bedrock`        | `AWS_REGION`                                     | `region`                                | `amazonBedrockMetadataSchema`       |
| `google-vertex`         | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`  | `project`, `location`                   | `googleVertexMetadataSchema`        |
| `azure`                 | `AZURE_OPENAI_RESOURCE_NAME`                     | `resource_name`                         | `azureMetadataSchema`               |
| `cloudflare-workers-ai` | `CLOUDFLARE_ACCOUNT_ID`                          | `account_id`                            | `cloudflareWorkersAIMetadataSchema` |
| `cloudflare-ai-gateway` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID` | `account_id`, `gateway_id`              | `cloudflareAIGatewayMetadataSchema` |
| Each other provider     | none                                             | none                                    | `metadata_schema: null`             |

Rules:

1. The `env` object holds exactly the names of the selected provider. The run refuses a name outside that list, and the `field` row names it. Reason: pi gives a value of `env` precedence over `process.env` for endpoint placeholders and proxy variables (`ProviderRequestOptions.env` in `@earendil-works/pi-ai`, `dist/types.d.ts`).
2. A provider with no metadata schema takes an absent or empty `env`. This keeps the rule of today that a provider with no metadata schema refuses metadata (`routingMetadataOf` in `src/worker/unit/tasks-credential.ts`).
3. The value of `OPENAI_COMPATIBLE_MODELS` is JSON text, because pi keeps each `env` value as a string (`ProviderEnv` in `@earendil-works/pi-ai`, `dist/types.d.ts`). The run refuses text that is no JSON, field `env.OPENAI_COMPATIBLE_MODELS`.
4. The run passes the metadata to the model connector, and the connector gives pi the names of `METADATA_ENV`, as the worker path does (`withMetadataEnv` in `src/llm/model-connector.ts`). The raw `env` object never reaches pi.
5. Change: today the metadata of standard input must also equal the metadata of the seed (`routingMetadataOf`). `run agent` has no seed, so only the schema check applies. L1 marks this row "Weaker for `run agent` (Q8, ruled 2026-11-21)".

Example entry of the fixture Auth:

```json
{
  "openai-compatible": {
    "type": "api_key",
    "key": "<K>",
    "env": {
      "OPENAI_COMPATIBLE_BASE_URL": "http://127.0.0.1:<port>/v1",
      "OPENAI_COMPATIBLE_MODELS": "[{\"id\":\"stub-1\"}]"
    }
  }
}
```

## Session file path

(G3)

This section maps [Session file](L1-model.md#session-file), "Place", to CLI rules. The checks run before any pi session open.

1. The path is absolute after resolution against the current directory.
2. No entry exists at the path, a symbolic link included, also when its target does not exist. `lstat` decides. Else the run refuses it with `cli.run.agent.session_exists`.
3. The parent directory exists and is a directory, after `realpath`. Else the run refuses it with `cli.run.agent.session_directory_invalid`. `realpath` lets a parent path through a link of the system, for example `/tmp` on macOS.
4. The current user owns the real parent directory. Else the run refuses it with `cli.run.agent.session_directory_owner`.
5. The real parent directory has no group or other write bit (`0o022`). Else the run refuses it with `cli.run.agent.session_directory_mode`. Reason: a user with write access to the directory can rename or remove the session file.
6. The path is not inside the workspace or the pi directory, compared by real paths. Else the run refuses it with `cli.run.agent.session_place`. Reason: a session file inside the workspace is a change that the agent reads and that a later commit takes. A session file inside the pi directory breaks check 5 of [Statelessness](L1-model.md#statelessness).
7. pi creates the file at the first conversation entry with `openSync(file, "wx")` (`dist/core/session-manager.js`, `_persist`). `wx` refuses a path that exists, a symbolic link included. `runCLI` sets the umask `0o077` (`PRIVATE_UMASK` in `src/kernel/files.ts`; `src/apps/cli/index.ts`), so the file mode is `0600`.
8. A run that ends before the first conversation entry leaves no file at the path.

## Home, temporary and pi directories

(G3)

L1 asks L2 to place the redirected `HOME` of `withoutAmbientCredentials` and the pi directory P. The place keeps [AC1](L1-model.md#checks): `HOME` H and `TMPDIR` T stay unchanged. The redirected home lies inside P, or inside T with its removal before exit.

### The run directory

1. After the `--auth` read, `run agent` makes the run directory R with `mkdtemp` in the `TMPDIR` of the process, mode `0700`. R holds `home/` and `tmp/`, mode `0700`.
2. The ambient removal of `withoutAmbientCredentials` (`src/worker/unit/tasks-credential.ts`) runs on the process environment, with `HOME` set to `R/home`. The AWS file paths go under `R/home/.aws/`. The removal list and the set names of today stay (`AMBIENT_CREDENTIAL_NAMES` in `src/worker/unit/tasks-seed.ts`; `docs/cli/worker.md`, `tasks run`, rule 6).
3. Change: the removal also removes `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY`, each in upper and lower case. Today these names stay (`docs/cli/worker.md:1006`). Reason: pi-ai reads them from `process.env`, lower case first, for the requests of `amazon-bedrock` (`getProxyEnv` in `@earendil-works/pi-ai`, `dist/utils/node-http-proxy.js:10-17`; `dist/api/bedrock-converse-stream.js:101`). On Node, `openai-codex` does not read them: it reads them only under Bun (`dist/api/openai-codex-responses.js:732-740`).
4. Change: the run also sets `TMPDIR` of the process to `R/tmp`. Reason: pi writes each output file, for example the full text of a truncated tool output, in the OS temporary directory (`dist/utils/output-files.js`, `createOutputFilePath`). AC1 requires that T holds no file after exit.
5. Each child process gets only `PATH` and `LANG` of the shell (`shellOf` in `src/apps/cli/worker-tasks.ts:130-137`), `TMPDIR=R/tmp`, `HOME=R/home`, `GIT_CONFIG_NOSYSTEM=1` and the `GIT_SSH_COMMAND` of `FIXED_GIT_ENV` (`src/worker/unit/tasks-run.ts:118-122`). Change: today a child also gets the `--pass-env` variables and the `TMPDIR` of the shell (`SHELL_NAMES` in `src/apps/cli/worker-tasks.ts:45`). The shell names stay the same; only the value of `TMPDIR` changes. The `PATH` of a child is the pi `PATH`: pi puts `$P/bin` first (`getShellEnv` in `dist/utils/shell.js:115-126`), and the engine passes that value (`src/agent/tool-table.ts:95-98`).
6. The host home input of the agent contract is the home directory of the OS user from the user database, the base of the `--auth` default. The hook `homeRelativeCwd` writes the `<cwd>` section relative to it (`src/agent/hooks/home-relative-cwd.ts`). Reason: the `<cwd>` section of a workspace under the home then holds no OS user name. The Workbench and the server give `homedir()` today (`src/workbench/service.ts:369`; `src/apps/server/index.ts:1244`). Change: `tasks run` gives the redirected home (`hostHome: env.HOME`, `src/worker/unit/tasks-run.ts:642`).
7. `run agent` removes R recursively before it exits, on each end and on each refusal after step 6 of the [run order](#run-order). A `SIGKILL` skips the removal, and R stays in T.

### Proxy settings

At step 1, the run refuses a Node proxy setting with `cli.run.agent.env_proxy`:

1. `NODE_USE_ENV_PROXY` is set, with any value: the row `variables: NODE_USE_ENV_PROXY`;
2. `NODE_OPTIONS` holds the token `--use-env-proxy`: the row `variables: NODE_OPTIONS`;
3. `process.execArgv` holds `--use-env-proxy`: the row `option: --use-env-proxy`.

Reason: Node 24 reads the proxy names at process start and sets the global HTTP clients from them (`node --help`, `--use-env-proxy`). A later removal of the names does not undo that setting. Aelita verified this on Node v24.15.0: with `NODE_USE_ENV_PROXY=1`, a `fetch` goes to the proxy after the process deletes `HTTP_PROXY`.

### The pi directory

Ulrich ruled on 2026-11-22: `run agent` uses the KanthorD XDG directories and ignores the default directories of pi.

1. The pi directory is the pi directory of the engine: `kanthord/pi` under the KanthorD XDG state directory (`piDirectory` in `src/agent/pi.ts`; `directories` in `src/kernel/xdg.ts`). No option changes it. The run computes it before the ambient removal. `loadPi` sets `PI_CODING_AGENT_DIR` to it (`src/agent/pi.ts`), so pi reads no `~/.pi/agent/`.
2. When the path exists, it is a directory that the current user owns, and no symbolic link. Else the run refuses it with `cli.run.agent.pi_directory_invalid`.
3. The run refuses an `auth.json` in the pi directory with `cli.run.agent.auth_in_pi_directory` (item 9). Change: the check runs before the pi tool install. Today `bindPiDirectory` installs the tools first and then checks (`src/worker/unit/tasks-run.ts`).
4. The pi tool install then writes only shipped files (`installPiTools` in `src/agent/pi-tools.ts`).
5. The run refuses a failed pi tool install with `cli.run.agent.tool_install_failed`. The refusal keeps the rows of the install diagnostic: `tool`, and `target`, `license`, `reason` or `exit_status` where the install gives one (`toolMissing` and `installPiTools` in `src/agent/pi-tools.ts`).

## Run order

(G1, G3)

1. Parse the command line. Refuse `--token` with `cli.run.agent.token`. Refuse a Node proxy setting with `cli.run.agent.env_proxy` ([Proxy settings](#proxy-settings)).
2. Check each option value: the `--model` form, each `--budget` value, the `--output` form and the `--workspace` directory. Refuse an absent `<agent-name>`, `--model`, `--session` or `--prompt`. Resolve the `--auth` path, with no read. Resolve each `--prompt` and `--system-prompt` value with [Text or path](#text-or-path).
3. Find the profile in the runtime catalog.
4. Resolve the workspace, the session file path, the pi directory and the output file path. Run the checks of [Session file path](#session-file-path), [The pi directory](#the-pi-directory) and [The output file](#the-output-file).
5. Run the [file checks](#file-checks) of the `--auth` file, read the entry and run the entry checks 1 to 5.
6. Make R. Open the output file, when `--output` names a path. Run the ambient removal.
7. Install the pi tools in the pi directory. Refuse a failed install with `cli.run.agent.tool_install_failed`.
8. Build the model runtime from the checked credential and the metadata (`createModelRuntime` in `src/llm/model-connector.ts`). The runtime makes no network call here (`allowModelNetwork: false`, `refreshOnCreate: false`).
9. Read the clock once. That instant starts the wall budget and `duration_ms`, and the wall deadline is that instant plus the wall budget. Run the expiry check (entry check 6). Resolve the model with the rules 4 to 6 of [Model selection](#model-selection). Refuse an unpriced cost budget with `cli.run.agent.budget_unpriced`. Open the session through the agent contract. A failed start precondition gives `cli.run.agent.start_refused`, with the `reason` row of L3. The open sends no provider request ([Requirements on L3](#requirements-on-l3), item 13).
10. Send the message of [Prompt](#prompt). Wait for the end of the turn.
11. Remove R. Write the result to the [output](#output). Exit with the code of [Exit codes](#exit-codes).

- A refusal at steps 1 to 9 writes no result and gives exit `1`. Its diagnostic is the first stderr line that is no JSON line. No model request leaves before step 10, so the provider receives no request.
- Steps 1 to 5 create no file and no directory.
- A signal starts the [shutdown](#shutdown).

## Shutdown

(G1)

Ulrich ruled on 2026-11-22: a signal ends the run with the full record. Aelita decision: the graceful part has a time limit of 10 seconds.

1. **First signal during step 10.** At the first SIGINT or SIGTERM, the run does these steps in order:
   1. It aborts the session through the agent contract. pi aborts the in-flight model request and stops each tool call (`abort` of `AgentSession`, `dist/core/agent-session.js:1909-1920`).
   2. Each child process ends at once. At the abort, the `bash` operations of the engine send SIGKILL to the process tree of the command (`processBashOperations` in `src/agent/bash-process.ts`; `killChildTree` in `src/kernel/process-group.ts`).
   3. pi finishes the session file: the abort resolves after pi persists the aborted entry (`waitForIdle`).
   4. The run removes R.
   5. The run writes the result with the end `stopped` and the class `terminal`.
   6. The run exits `2`.
2. **Time limit.** When steps 1.1 to 1.3 take more than 10 seconds, the run makes a forced stop through the agent contract ([Requirements on L3](#requirements-on-l3), item 18). The forced stop kills each child process and returns the totals so far. The run then does steps 1.4 to 1.6. The result has the end `stopped`, the class `terminal`, the totals so far and the last assistant text so far. The session file then can lack the aborted entry.
3. **Second signal.** A second SIGINT or SIGTERM during the shutdown stops the wait. The run makes the forced stop, removes R and exits `2` with no result.
4. **Step 11.** The run ignores a signal during step 11, so the result line is whole.
5. **Signal before step 10.** A SIGINT or SIGTERM before step 10 ends the run with exit `2`, no result and the removal of R.
6. **Class.** The end `stopped` is `terminal`: a person or the system asked the run to stop, and the caller decides on a new run.
7. Change: today `stopOnSignal` handles only SIGINT and has no time limit (`src/apps/cli/worker-tasks.ts:287-292`).

## Output

(G1, G5)

Ulrich ruled on 2026-11-22: `--output` names where the result goes. The exit redaction of the agent contract applies to each form, so `text` and each `reason` show a known secret as the redaction marker ([L1](L1-model.md#session-file), "Exit redaction").

### The result

The result of one run holds these fields. The JSON form uses these names. The [comparison](#comparison-rule) of the evaluation reads each field.

| Field                  | Value                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`                | The profile name                                                                                                                                                                 |
| `engine_version`       | The package version (`packageVersion` in `src/kernel/version.ts`)                                                                                                                |
| `provider`             | The provider of the model selection                                                                                                                                              |
| `model`                | The model id                                                                                                                                                                     |
| `reasoning_effort`     | The `level` of the model selection                                                                                                                                               |
| `budget`               | `{ "wall_ms", "usd" }`: the wall budget in milliseconds, and the cost budget as a number or `null`                                                                               |
| `budget_reached`       | `wall` or `usd` for the end `budget_end`; else `null`                                                                                                                            |
| `input_digest`         | The [input digest](#input-digest)                                                                                                                                                |
| `system_prompt_digest` | The SHA-256 hex digest of the output of the composition function of [L1-D10](L1-model.md#decisions), before pi adds `<cwd>` (`dist/core/system-prompt.js:110`)                   |
| `workspace`            | The real path of the workspace                                                                                                                                                   |
| `session`              | The absolute path of the session file                                                                                                                                            |
| `end`                  | `completed`, `budget_end`, `stopped` or `failed`                                                                                                                                 |
| `class`                | `null` for `completed`; else `retryable` or `terminal` ([Classes](#classes))                                                                                                     |
| `failure`              | For the end `failed`: `rate_limited`, `unavailable`, `quota_exhausted`, `unauthorized`, `bad_request` or `internal`; else `null`                                                 |
| `duration_ms`          | The time from the clock read of step 9 to the end of the turn, on the monotonic clock                                                                                            |
| `model_calls`          | The count of assistant messages of the run                                                                                                                                       |
| `tool_calls`           | The count of tool calls of the run                                                                                                                                               |
| `usage`                | `{ "input", "output", "cache_read", "cache_write" }`: the sums of the token counts of the assistant messages of the run                                                          |
| `list_price_usd`       | The list price of the run: the sum of `usage.cost.total` of the assistant messages, from the catalog price ([Budget](#budget), rule 5). It is no charge for a subscription entry |
| `text`                 | The last assistant text of the run after the exit redaction, or `null` when the run has no assistant text                                                                        |

Change: `tasks run` prints `{ "output", "end", "exit_code" }` and writes an output folder (`tasksRun` in `src/apps/cli/worker-tasks.ts`). `run agent` writes no output folder.

### `--output stdout`

The default. stdout gets a text result for a human, and stderr gets each diagnostic, notice and warning line. The run writes no color code. The layout is exact:

1. Line 1 is `<agent> <end>`.
2. Then one row per field, in this order: `model`, `exit`, `class`, `failure`, `budget`, `reached`, `duration`, `calls`, `tokens`, `list price`, `session`, `workspace`. Each row starts with two spaces, then the label padded with spaces to 11 characters, then the value.
3. The row `failure` exists only for the end `failed`. The row `reached` exists only for the end `budget_end`.
4. The values:
   - `model`: `<provider>/<model>:<reasoning_effort>`;
   - `exit`: the exit code;
   - `class`: `none`, `retryable` or `terminal`;
   - `failure`: the `failure` field;
   - `budget`: each budget as the command line gave it, joined with `, `, each wall budget followed by ` wall`. The default wall budget shows as `2h wall (default)`;
   - `reached`: the `budget_reached` field;
   - `duration`: the seconds with one fraction digit, then ` s`;
   - `calls`: `<model_calls> model, <tool_calls> tool`;
   - `tokens`: `<input> input, <output> output, <cache_read> cache read, <cache_write> cache write`;
   - `list price`: the list price with 6 fraction digits, then ` usd`;
   - `session` and `workspace`: the paths.
5. Then one empty line, then `text`, or `(no text)` when `text` is `null`.

Sample of L2-AC1, variant 2:

```text
swe@1 completed
  model      openai-compatible/stub-1:off
  exit       0
  class      none
  budget     2h wall (default)
  duration   0.4 s
  calls      3 model, 2 tool
  tokens     30 input, 6 output, 0 cache read, 0 cache write
  list price 0.000000 usd
  session    /tmp/l2/d/s.jsonl
  workspace  /tmp/l2/w

done-1
```

### `--output <path>`

The run appends one JSON line per run to the file: one compact JSON object with exactly the fields of [The result](#the-result), then a newline. stdout gets nothing. stderr gets each diagnostic, notice and warning line. The file is the record that the [evaluation](#one-evaluation-run) reads. The value `stdout` selects stdout, so a file with that name takes the form `./stdout`.

### The output file

1. The path is absolute after resolution against the current directory. Its real parent directory exists and is a directory, the current user owns it, and it has no group or other write bit. These are rules 3 to 5 of [Session file path](#session-file-path). Else the run refuses it with `cli.run.agent.output_invalid`.
2. When the file exists, it is a regular file that the current user owns, with mode `0600`, and no symbolic link. Else the run refuses it with `cli.run.agent.output_invalid`.
3. The path is not inside the workspace or the pi directory, and it is not the `--auth` file or the session file, compared by real paths. Else the run refuses it with `cli.run.agent.output_place`. Reason: a result inside the workspace is a change that a commit takes, and a result never mixes with a credential or a session record.
4. At step 6, the run opens the file with `openPrivate` and the flags `O_WRONLY`, `O_APPEND` and `O_CREAT` (`src/kernel/files.ts:77-91`). `openPrivate` adds `O_NOFOLLOW`, creates the file with mode `0600` and checks the owner and the mode of the open file. The run writes only by append.
5. At step 11, the run writes the line with one append. A refusal writes no line.

### Input digest

`input_digest` is `digest` (`src/kernel/json.ts`) of this object: `prompt`, `system_prompt`, `provider`, `model`, `reasoning_effort` and `budget`. `prompt` and `system_prompt` are each the list of the part texts in order. `budget` is the field of [The result](#the-result). The digest holds no path, so two runs in two worktrees with the same input give the same digest.

### stderr

1. A refusal writes the diagnostic in the engine format: line 1 is `<code>: <message>`, then one aligned `name: value` row per value (`diagnostic` and `diagnosticRows` in `src/kernel/errors.ts`). The message holds no value.
2. The rotate warning of R2-H ([L1](L1-model.md#session-file), "Finding in LLM output"): one JSON line per warning that the agent contract gives, in order. The line is `{ "code": "cli.run.agent.secret_exposed", "msg": "model output holds a known secret; rotate that credential", "rule", "count" }`. `rule` is the redaction rule that L3 names, and `count` is the count of the warning. The line holds no value. The warning refuses nothing and does not change the exit code.
3. The notice of [Text or path](#text-or-path): one JSON line per value that looks like a path and names no entry. The line is `{ "code": "cli.run.agent.prompt_text_path", "msg": "a value that looks like a path names no file; the run uses it as text", "option", "index" }`. `option` is `--prompt` or `--system-prompt`, and `index` is the position of the value among the values of that option, from 1. The line holds no value.
4. The end `failed` writes one diagnostic after the result: `cli.run.agent.provider_retryable`, `cli.run.agent.provider_failed` or `cli.run.agent.internal_error`, with the `reason` row. The agent contract gives the reason after the exit redaction. The `reason` row is one line: the run replaces each line break of the reason with one space.
5. `run agent` writes no other line. [L3](#requirements-on-l3) requires that the runtime writes nothing to stdout or stderr.
6. Each stderr line holds no credential value.

### Classes

Ulrich ruled on 2026-11-22: each end and each diagnostic code has a class.

1. **`retryable`.** The same input can succeed later with a new `--session` path and a workspace that passes the start preconditions. A new path is necessary, because the session file of the failed run exists ([Session file path](#session-file-path), rule 2). A new workspace is necessary when the failed run changed it.
2. **`terminal`.** A change of the input, the credential or the environment is necessary.
3. **Class of a failure.** The class of a provider error comes from two pi predicates on the last error (`@earendil-works/pi-ai`). The class is `retryable` when `isContextOverflow` rejects it and `isRetryableAssistantError` accepts it (`dist/utils/overflow.js:132`, exported by `dist/index.d.ts:29`; `dist/utils/retry.js:188`, exported by `dist/index.d.ts:30`). Else the class is `terminal`. Reason: a context overflow repeats with the same input. The class then matches the retry rule of pi. An error of the runtime that is no provider error is `terminal`.
4. **Failure kind.** `failure` is the kind of `providerFailureOf` of the error text (`src/llm/provider-failure.ts:14-28`; `ProviderFailure` in `src/scheduler/contract.ts:67-73`). An unknown text falls back to `unavailable` (`src/llm/provider-failure.ts:27`). An error of the runtime has the failure `internal`. The failure kind does not decide the class.
5. **pi retries.** `run agent` retries nothing by itself. pi retries a provider error that `isRetryableAssistantError` accepts, inside the session (`_isRetryableError` in `dist/core/agent-session.js:2978-2983`; `@earendil-works/pi-ai`, `dist/utils/retry.js:188-195`). With the in-memory settings of the engine (`src/agent/agent-session.ts:96-99`), pi makes up to 3 retries, with a base delay of 2 seconds and a maximum delay of 60 seconds (`getRetrySettings` in `dist/core/settings-manager.js:683-690`). These retries stay. The class applies to the error after the last pi retry.
6. **Codes.** Each refusal code is `terminal`. [Diagnostic codes](#diagnostic-codes) states the class of each code.

### Exit codes

Ulrich ruled on 2026-11-22 that the retryable class has its own exit code. Aelita decision: the values of the table.

| Exit | End or cause                                                                        | Class       |
| ---- | ----------------------------------------------------------------------------------- | ----------- |
| `0`  | `completed`                                                                         | none        |
| `1`  | A refusal of the [run order](#run-order), steps 1 to 9, or a Commander syntax error | `terminal`  |
| `2`  | `stopped`: SIGINT or SIGTERM                                                        | `terminal`  |
| `4`  | `budget_end`: the first limit of [Budget](#budget)                                  | `terminal`  |
| `5`  | `failed` with a terminal failure                                                    | `terminal`  |
| `75` | `failed` with a retryable failure                                                   | `retryable` |

- Exit `75` is `EX_TEMPFAIL` of `sysexits.h`: a temporary failure, and a later try can succeed.
- Exit `3` stays the code of a superseded `serve worker` (`ExitCode` in `src/apps/cli/constants.ts`).
- Change: for `tasks run`, a budget end gives exit `0`, and exit `4` means a failed `--verify` check (`TasksExit` in `src/worker/unit/tasks-run.ts`). For `run agent`, a budget end is no completion, so it has its own code.

## Diagnostic codes

(G1, G3)

Each code of `run agent` has the form `cli.run.agent.<reason>`. The rows use the closed row names of `docs/cli/other.md`, section "Output and exit behavior". A refusal exits `1`. A notice and a warning refuse nothing and have no class.

| Code                                      | Condition                                                                                                                                                             | Rows                               | Class       | Source                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------- | ----------------------------------------------- |
| `cli.run.agent.token`                     | `--token` is on the command line                                                                                                                                      | `option`                           | `terminal`  | [L1-D17](L1-model.md#decisions)                 |
| `cli.run.agent.env_proxy`                 | `NODE_USE_ENV_PROXY` is set, or `NODE_OPTIONS` or `process.execArgv` holds `--use-env-proxy`                                                                          | `variables` or `option`            | `terminal`  | [Proxy settings](#proxy-settings)               |
| `cli.run.agent.option_invalid`            | An option value fails its rule; `<agent-name>`, `--model`, `--session` or `--prompt` is absent                                                                        | `option`                           | `terminal`  | [Options](#options)                             |
| `cli.option.duplicate`                    | A single-value option is repeated. The code exists today (`src/apps/cli/shared.ts`)                                                                                   | `option`                           | `terminal`  | [Options](#options)                             |
| `cli.run.agent.agent_unknown`             | The profile name is in no entry of the runtime catalog. No row: the profile is an operand                                                                             | none                               | `terminal`  | [Options](#options)                             |
| `cli.file.not_regular`                    | A path-like prompt value names an entry that is no regular file. The code exists today                                                                                | `path`                             | `terminal`  | [Text or path](#text-or-path), rule 3.4         |
| `cli.file.encoding_invalid`               | A path-like prompt value names a file that is not UTF-8 text, an image included. The code exists today                                                                | `path`                             | `terminal`  | [Text or path](#text-or-path), rules 3.4 and 4  |
| `cli.run.agent.prompt_place`              | A prompt path lies under `/dev` or `/proc`                                                                                                                            | `path`                             | `terminal`  | [Text or path](#text-or-path), rule 3.3         |
| `cli.run.agent.prompt_missing`            | The `--prompt` parts hold no text                                                                                                                                     | none                               | `terminal`  | [Prompt](#prompt), rule 2                       |
| `cli.run.agent.prompt_text_path`          | A notice: a path-like prompt value names no entry, and the run uses it as text                                                                                        | none; JSON line                    | none        | [Text or path](#text-or-path), rule 3.1         |
| `cli.run.agent.auth_file_invalid`         | The `--auth` path is absent, is a symbolic link or is no regular file                                                                                                 | `path`                             | `terminal`  | Item 5                                          |
| `cli.run.agent.auth_file_owner`           | Another user owns the `--auth` file                                                                                                                                   | `path`                             | `terminal`  | Item 5                                          |
| `cli.run.agent.auth_file_mode`            | The mode of the `--auth` file has a group or other bit                                                                                                                | `path`                             | `terminal`  | Item 5                                          |
| `cli.run.agent.auth_place`                | The `--auth` file is inside the workspace, or a prompt path is the `--auth` file or lies in the KanthorD configuration directory or the pi directory                  | `path`                             | `terminal`  | [File checks](#file-checks), rule 4             |
| `cli.run.agent.auth_entry_missing`        | The read gives no entry of the selected provider                                                                                                                      | `path`, `field`                    | `terminal`  | Items 3 and 10                                  |
| `cli.run.agent.auth_entry_invalid`        | The entry fails the entry schema, the provider check or the routing metadata mapping                                                                                  | `path`, `field`                    | `terminal`  | Items 4 and 10                                  |
| `cli.run.agent.auth_key_command`          | The key starts with `!`                                                                                                                                               | `path`, `field`                    | `terminal`  | Item 7                                          |
| `cli.run.agent.auth_key_reference`        | The key holds `$`                                                                                                                                                     | `path`, `field`                    | `terminal`  | Item 6                                          |
| `cli.run.agent.credential_expiring`       | The OAuth `expires` is before the wall deadline plus the refresh window. Step 9                                                                                       | `path`                             | `terminal`  | Item 4                                          |
| `cli.run.agent.auth_in_pi_directory`      | The pi directory holds `auth.json`                                                                                                                                    | `path`                             | `terminal`  | Item 9                                          |
| `cli.run.agent.pi_directory_invalid`      | The pi directory is no directory, is a symbolic link or another user owns it                                                                                          | `path`                             | `terminal`  | [The pi directory](#the-pi-directory), rule 2   |
| `cli.run.agent.tool_install_failed`       | The pi tool install fails                                                                                                                                             | `tool` and the rows of the install | `terminal`  | [The pi directory](#the-pi-directory), rule 5   |
| `cli.run.agent.session_exists`            | An entry exists at the session file path, a symbolic link included                                                                                                    | `path`                             | `terminal`  | [Session file path](#session-file-path), rule 2 |
| `cli.run.agent.session_directory_invalid` | The parent directory of the session file path is absent or no directory                                                                                               | `path`                             | `terminal`  | Rule 3                                          |
| `cli.run.agent.session_directory_owner`   | Another user owns the real parent directory of the session file path                                                                                                  | `path`                             | `terminal`  | Rule 4                                          |
| `cli.run.agent.session_directory_mode`    | The real parent directory of the session file path has a group or other write bit                                                                                     | `path`                             | `terminal`  | Rule 5                                          |
| `cli.run.agent.session_place`             | The session file path is inside the workspace or the pi directory                                                                                                     | `path`                             | `terminal`  | Rule 6                                          |
| `cli.run.agent.output_invalid`            | The output file has no parent directory, its parent is not owned by the user or has a group or other write bit, or it is no regular file of the user with mode `0600` | `path`                             | `terminal`  | [The output file](#the-output-file)             |
| `cli.run.agent.output_place`              | The output file is inside the workspace or the pi directory, or it is the `--auth` file or the session file                                                           | `path`                             | `terminal`  | [The output file](#the-output-file)             |
| `cli.run.agent.model_unknown`             | `resolveCliModel` gives no model, or `getModel` does not give the result model                                                                                        | none                               | `terminal`  | [Model selection](#model-selection), rule 4     |
| `cli.run.agent.model_inexact`             | The resolved provider, model id or level differs from the text of `--model`                                                                                           | none                               | `terminal`  | Rule 5                                          |
| `cli.run.agent.level_unsupported`         | The resolved model does not support the level                                                                                                                         | none                               | `terminal`  | Rule 6                                          |
| `cli.run.agent.budget_unpriced`           | A cost budget names a model with no price                                                                                                                             | `option`                           | `terminal`  | [Budget](#budget), rule 6                       |
| `cli.run.agent.start_refused`             | The agent contract refuses the start: a start precondition fails                                                                                                      | `reason`                           | `terminal`  | [L1-D21](L1-model.md#decisions); step 9         |
| `cli.run.agent.provider_retryable`        | The end `failed`, and pi accepts the last error as retryable. It follows the result                                                                                   | `reason`                           | `retryable` | [Classes](#classes)                             |
| `cli.run.agent.provider_failed`           | The end `failed` with a provider error that pi does not retry. It follows the result                                                                                  | `reason`                           | `terminal`  | [Classes](#classes)                             |
| `cli.run.agent.internal_error`            | The end `failed` with the failure `internal`. It follows the result                                                                                                   | `reason`                           | `terminal`  | [Classes](#classes)                             |
| `cli.run.agent.secret_exposed`            | A warning, not a refusal: model output holds a known secret                                                                                                           | none; JSON line                    | none        | R2-H                                            |

A Commander syntax error, for example an unknown option, writes the Commander message and exits `1`, as for each command (`docs/cli/other.md`, section "Output and exit behavior"). Its class is `terminal`.

## Evaluation input

(G5)

### One evaluation run

L1-D20 compares each role profile with `swe@1` on prepared workspaces with fixed inputs. One evaluation case holds one repository, one commit C and one task.

1. **Instructions.** Export the stored Repository prompt and the Binding prompt of `swe@1` once, one file per part. This is the only step that reads the server; each run reads no server. Each file holds the heading, one blank line and the text of the part, as the server renders a part (`docs/cli/agent.md`, section "`get <agent-name>`"). With no server, write `repository.md` and `binding.md` by hand in the same form. E1 fit rule 5 adds no instruction file and no `AGENTS.md`.

   ```sh
   kanthord agent get swe@1 --project "$PROJECT" --binding-id "$BINDING" > "$CASE/agent.json"
   for part in repository binding; do
     jq -j --arg part "$part" '.prompt.parts[]
       | select(.part == $part and .state == "resolved" and (.text | test("\\S")))
       | "\(.heading)\n\n\(.text)"' "$CASE/agent.json" > "$CASE/$part.md"
   done
   ```

2. **Task.** Write the task text in `$CASE/task.md`. It lies outside each workspace, so each run gives it as one absolute path.
3. **Workspace.** Prepare one new worktree of C for each run, with no uncommitted change, in a new `0700` directory. A run changes its workspace, so no two runs share one.

   ```sh
   mkdir -m 700 -p "$CASE/$AGENT-$N"
   git -C "$REPO" worktree add --detach "$CASE/$AGENT-$N/w" "$C"
   ```

4. **Run.** Give the same task, context, model selection and budget to each profile. `$BUDGET` is the wall budget of the case, sized to the task, for example `30m`. Only the profile, the workspace and the session file change. Each run appends its result to the one file `$CASE/results.jsonl`. Use an `api_key` entry for an evaluation. An `oauth` entry needs the refresh step of the [Gate procedure](#gate-procedure-the-real-credential-run) before each run.

   The run counts only when `stderr.txt` holds no line with `cli.run.agent.prompt_text_path`.

   ```sh
   kanthord run agent "$AGENT" --model "$PROVIDER/$MODEL:$LEVEL" --budget "$BUDGET" \
     --auth "$AUTH" --system-prompt "$CASE/repository.md" --system-prompt "$CASE/binding.md" \
     --workspace "$CASE/$AGENT-$N/w" --session "$CASE/$AGENT-$N/session.jsonl" \
     --output "$CASE/results.jsonl" --prompt "$CASE/task.md" 2> "$CASE/$AGENT-$N/stderr.txt"
   ```

5. **Record.** The pi session file is the record of the work: the model change, the thinking level, each message with its usage, and each tool call and tool result. The line of the run in `results.jsonl` holds the identity, the end, the class and the totals of the run. The workspace holds the changes: `git -C w add -A && git -C w diff --cached "$C"`.

### Comparison rule

- The comparison reads the lines of `results.jsonl`.
- The common keys are `input_digest`, `engine_version`, `provider`, `model`, `reasoning_effort` and `budget`.
- Two runs of one profile compare only when the common keys and `system_prompt_digest` are equal.
- Two runs of two profiles compare only when the common keys are equal. Each run must also have the `system_prompt_digest` of the other runs of its profile in the evaluation.
- Equal `input_digest` means the same prompt parts and context parts in the same order. Equal `system_prompt_digest` means the same composed system prompt of the profile. Equal `engine_version` means the same engine release, with its tools and its pi version. The other common keys give the same model selection and budget.
- The comparison groups the runs by `agent`. It reads `end`, `class`, `failure`, `budget_reached` and `text` for the verdict. It reads the session file at `session` and the change of the worktree at `workspace` for the verdict. It reads `usage`, `list_price_usd`, `model_calls`, `tool_calls` and `duration_ms` as the cost of each run.
- A run with the class `retryable` runs again with a new session path and a new worktree of C. Its line stays in the file.
- The model output is not deterministic. This section owns the evaluation plan. Before round step 4.3, the plan gains the count of runs per profile and the verdict method. The verdict is a judgement with no fixed pass value ([L1](L1-model.md#rules-with-no-check-and-the-reason), L1-D16).

### Gate procedure: the real-credential run

Round order step 4.2 needs the credential of Ulrich, so it is a gate step and no automated check. Ulrich gives the pi provider id of the entry in his pi `auth.json`, the model id and the level. The run reads that file with `--auth`. For an `oauth` entry, Ulrich first refreshes the entry with pi:

```sh
pi auth print-bearer-token --provider "$PROVIDER" --min-expiry 20m > /dev/null
```

pi refreshes a token that expires within the minimum, writes the entry back and prints the token (`resolveCredentialForPrint` in `dist/cli/credential-print.js`). The redirect discards the token. `20m` covers the wall budget `10m`, the refresh window of 5 minutes and a margin. An `api_key` entry needs no refresh step.

```sh
ulimit -c 0
mkdir -m 700 -p "$GATE"
git -C "$REPO" worktree add --detach "$GATE/w" "$C"
shasum -a 256 ~/.pi/agent/auth.json > "$GATE/auth.before"
stat -f %Lp ~/.pi/agent/auth.json >> "$GATE/auth.before"
kanthord run agent swe@1 --model "$PROVIDER/$MODEL:$LEVEL" --budget 10m \
  --auth ~/.pi/agent/auth.json --workspace "$GATE/w" --session "$GATE/session.jsonl" \
  --output "$GATE/result.jsonl" \
  --prompt "Run git log -1 --format=%H with bash. Reply with the commit id only." \
  2> "$GATE/stderr.txt"
```

The run passes when each condition holds:

1. The exit code is `0`. `result.jsonl` is one JSON line with `end` `completed`, `class` `null`, `tool_calls` of 1 or more, and `text` that holds the output of `git -C "$GATE/w" rev-parse HEAD`.
2. A session file exists at `$GATE/session.jsonl` with mode `0600`. It holds one or more `message` entries with the role `assistant`.
3. The session file holds no credential value of the entry. The check prints only a count: `grep -cFf <(jq -r --arg p "$PROVIDER" '.[$p] | (.key, .access, .refresh) // empty' ~/.pi/agent/auth.json) "$GATE/session.jsonl"` prints `0`.
4. `~/.pi/agent/auth.json` has the same SHA-256 digest and the same mode as in `auth.before`. The commands are the macOS forms, because the `auth.json` of Ulrich is on his macOS machine.
5. `stderr.txt` holds no line with `cli.run.agent.secret_exposed`.
6. `git -C "$GATE/w" status --porcelain` prints nothing.

## Requirements on L3

(G6)

L2 needs these items from the agent contract. [L3](L3-agent.md#input-and-output-contract) designs them.

1. **Input.** The contract takes these inputs from `run agent`: the profile name; the model runtime and the resolved model; the reasoning effort; the workspace; the budget; the context texts in order; the one user message; the session file path; the known-secret source; the child environment; the host home; an abort signal. The contract applies the reasoning effort as the pi `thinkingLevel`, with no clamp. The workspace is the working directory and, for a confined profile, the one root. `run agent` gives no trace sink and no capability. The input holds no field of an execution.
2. **Catalog.** The runtime exports a lookup of a profile by name, so the CLI refuses an unknown name at step 3. The role profiles `bee@1`, `fee@1` and `te@1` are in the runtime catalog.
3. **Declared consumer tools with no implementation.** A session of a profile that declares a consumer tool opens and runs when the consumer gives no implementation. The model request then lists only the tools that have an implementation. `swe@1` declares `evidence-upload` and `link_update_list`, as `host_tools` (`src/agent/catalog.ts`), and `run agent` gives no implementation ([L1](L1-model.md#handoffs-to-later-layers) hands the session shape to L3).
4. **Start refusal.** A failed start precondition gives a refusal with a stable precondition id and a reason. It comes before any model request, any session file write and any workspace change.
5. **Session file.** The result is the pi session file at the exact path of the input, with the workspace as the `cwd` of the session header. The contract replaces or follows no existing entry at the path.
6. **Output.** The contract gives the end of the turn: `completed`, `budget_end` with the reached limit, `stopped`, or `failed` with the failure kind and a reason. For `failed`, it gives the class from `isContextOverflow` and `isRetryableAssistantError` ([Classes](#classes), rule 3). It gives the last assistant text and the SHA-256 digest of the output of the L1-D10 composition function. It gives the counts of model calls and tool calls, the token usage and the sum of `usage.cost.total`. It gives each rotate warning with its rule and count.
7. **Exit redaction.** Each text that the contract gives out passes the exit redaction, the failure reason included.
8. **Silence.** The runtime writes nothing to the stdout or the stderr of the process.
9. **No proxy from the environment.** The runtime calls no `configureHttpDispatcher` of pi (`dist/core/http-dispatcher.js:68`) and sets no global HTTP dispatcher (AC24). Today the engine does not call it. pi calls it in its own entry points: `dist/main.js:468,708`, `dist/cli/setup.js:10`, `dist/rpc-entry.js:9` and `dist/modes/interactive/interactive-mode.js:1562`. pi-ai also reads the proxy names from `process.env` for `amazon-bedrock`, so `run agent` removes them ([The run directory](#the-run-directory), rule 3).
10. **pi directory and resources.** The runtime writes into the pi directory only through the pi tool install. pi writes no `auth.json`, no settings file and no session file there. The runtime loads no extension, skill, prompt template, theme or context file from a path (AC1, AC27; `sessionParts` in `src/agent/agent-session.ts` does this today).
11. **Budget.** The budget input holds the wall deadline and the cost limit or none. The contract ends the turn with `budget_end` at the first limit that the run reaches, and names that limit.
12. **Place of the context texts.** The composition function of [L1-D10](L1-model.md#decisions) places the context texts, in order and with no added heading, at the place of the Repository prompt: layer 2, after the profile prompt ([agent.md](../agent.md#prompt-composer)). Each text carries its own heading, when it has one.
13. **No request at the open.** The session open sends no provider request.
14. **Child processes.** Each child process of a tool ends before the contract returns.
15. **Child environment.** The child environment of the input reaches only child processes. The runtime process and pi do not read it. A child process gets only the names of the child environment input, less the names that `childEnvironment` removes (`src/agent/environment.ts`). `PATH` is the pi `PATH`.
16. **Error text of a failed request.** The `errorMessage` of an `assistant` entry is no LLM output: pi writes it from the provider error (`formatProviderError` in `@earendil-works/pi-ai`, `dist/api/openai-responses.js:166-170`). The input redaction applies to it before pi persists the entry ([L1](L1-model.md#session-file), "Error text").
17. **Abort.** An abort ends the turn with `stopped`. The contract returns after pi persists the aborted entry and after each child process ends. The CLI applies the time limit of [Shutdown](#shutdown).
18. **Forced stop.** The contract gives a forced stop. It kills each child process at once, stops the wait for pi and returns the totals so far and the last assistant text so far.

## Handoffs to later layers

- [L4](L4-worker-cli.md): `run worker` under the root `run`. Its codes take the form `cli.run.worker.<reason>`, to match `run agent`. `kanthord run --help` then lists `agent` and `worker`.
- [L6](L6-migration.md): add `CommandName.Run` and the group `run` to `createProgram`. Add `run` to `TOP_LEVEL_NAMES`, the page `run` to `PAGE_INVENTORIES` and `PAGE_COUNTS`, and update `DOCUMENTED_COUNT` and `IMPLEMENTED_COUNT` (`src/apps/cli/completeness.test.ts`). Write `docs/cli/run.md`. Update the root names and the root help list of `docs/cli/other.md`, and the link list of `docs/cli/README.md`.
- [L6](L6-migration.md): move the checks that L1 lists before the deletion of `tasks run`, with the changes of this page. The entry reader uses `readStoredCredential`. `routingMetadataOf` uses the mapping and no seed comparison. `withoutAmbientCredentials` uses R in place of the output folder and also removes the proxy names. The child `TMPDIR` is `R/tmp`. The check of `auth.json` runs before the pi tool install.
- [L6](L6-migration.md): in `docs/cli/other.md`, section "Output and exit behavior", add the exits `2`, `4`, `5` and `75` of `run agent`, the stderr warning line and the stderr notice line. With `run`, the global root names are five. Fix the text that names three: `docs/cli/other.md:1155`, `docs/cli/README.md:71` and `docs/cli/project.md:36`.
- [L6](L6-migration.md): assign the file of each module of [Unit-level rules](#unit-level-rules).
- [L6](L6-migration.md): move `ProviderFailure` from the scheduler contract (`src/scheduler/contract.ts:67-73`) to `src/llm/`, next to `providerFailureOf`, so the agent runtime imports no scheduler module.
- [L6](L6-migration.md): the Linux test container. L2-AC2 runs in the network namespace N. L2-AC6 needs a user database entry whose home is H.

## Acceptance checks

(G4)

Each check is an end-to-end test ([index](index.md#layer-files)). It runs the built `kanthord run agent` as a process, with a real file system, real git and the real pi runtime. The only stub is the LLM stub at the outside edge. Each check asserts an outcome that crosses components. A refusal means: exit code `1`, no result, and the first stderr line that is no JSON line starts with the diagnostic code.

### L2 fixtures

L2 adds these details to the [shared fixtures of L1](L1-model.md#shared-fixtures).

- **Stub.** It serves `POST /v1/responses`, because the model connector gives `openai-compatible` the API `openai-responses` (`compatibleProvider` in `src/llm/model-connector.ts`). Its address is `http://127.0.0.1:$PORT`. It records each request and each connection.
- **Auth.** The file of the [example entry](#routing-metadata-mapping), mode `0600`, with `OPENAI_COMPATIBLE_BASE_URL` set to `http://127.0.0.1:$PORT/v1` and the model `stub-1`.
- **X.** An empty directory. It is `XDG_STATE_HOME` of the process, so the pi directory P is `$X/kanthord/pi`.
- **D.** An empty directory with mode `0700`. S is `$D/s.jsonl`, and O is `$D/results.jsonl`.
- **Run.** This command line, with `$INPUT` the prompt of the check:

  ```sh
  HOME="$H" TMPDIR="$T" XDG_STATE_HOME="$X" kanthord run agent swe@1 \
    --auth "$AUTH" --model openai-compatible/stub-1:off \
    --workspace "$W" --session "$S" --output "$O" --prompt "$INPUT"
  ```

- **`$TEST`.** The test directory. The harness expands `$TEST` in each scripted text before Stub serves it.
- **Own paths.** Each variant and each run of a check has its own S and its own W, unless the check states otherwise.
- **No request.** "Stub receives no request" means that the request log of Stub is empty after the exit.
- **Clean exit.** T holds no file after the exit.

### Checks

1. **L2-AC1. A run does its work, records it and reports it.** Covers L1 [AC2](L1-model.md#checks), variant 1.
   - Fixture: Auth, Stub, W, H, X, T, D. The scripted answers: call `write` with `note.md` and the text M1; call `bash` with `git status --porcelain`; answer the text `done-1`. Each answer has the usage input 10 and output 2.
   - Command: variant 1: Run with `$INPUT` `add the note`. Variant 2: the same with `--output` removed.
   - Assert, variant 1: exit `0`. stdout and stderr are empty. O holds one JSON line with exactly the fields of [The result](#the-result): `end` `completed`, `class` `null`, `failure` `null`, `budget` `{"wall_ms":7200000,"usd":null}`, `model_calls` `3`, `tool_calls` `2`, `usage` `{"input":30,"output":6,"cache_read":0,"cache_write":0}`, `list_price_usd` `0` and `text` `done-1`. `workspace` is the real path of W. The first request lists exactly the tools `read`, `edit`, `write`, `grep`, `find`, `ls` and `bash`. `W/note.md` holds M1, and `git -C "$W" status --porcelain` prints `?? note.md`. S has mode `0600`. Its header has the real path of W as `cwd`. It holds the user message, the three assistant messages and the two tool results, and the `bash` tool result holds `?? note.md`. T holds no file.
   - Assert, variant 2: exit `0`. stdout is the [text layout](#--output-stdout), with the values of variant 2 and the path values of its run. O gains no line.

2. **L2-AC2. Two runs in a hostile environment leave no state and leak nothing.** Covers L1 AC1, AC23 and AC24.
   - Fixture: Auth, Stub, W, H, X, T, D, N. Stub2 listens on a second loopback port. The parent environment sets `LANG=C`. It sets the four `KANTHORD_*` names, `ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_PROFILE`, `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_CONTAINER_CREDENTIALS_FULL_URI` and `OPENAI_API_KEY` to unique markers. It sets `KANTHORD_ENDPOINT`, `AZURE_OPENAI_BASE_URL`, `OPENAI_BASE_URL` and each proxy name in upper and lower case to the address of Stub2. `H/.aws/credentials` holds one more marker. The scripted answers of each run call `bash` with `env; cat ~/.aws/credentials`, then give a text.
   - Command: in N, Run with `$INPUT` M1 and S `$D/s1.jsonl`. Then Run with `$INPUT` M2 and S `$D/s2.jsonl`.
   - Assert: each run exits `0`. `find "$H" -mindepth 1 | sort` and the SHA-256 digest of each file under H are equal before and after each run. D holds only `s1.jsonl` and `results.jsonl` after run 1, and only `s1.jsonl`, `s2.jsonl` and `results.jsonl` after run 2. O holds two lines. P holds only the files of the pi tool manifest and their licenses, with an equal digest listing after run 1 and run 2. T holds no file after each exit. Stub2 records no connection, and N logs connections only to Stub. No request to Stub holds a marker, in a header or in the body. Each request carries K. Neither `bash` tool result holds a marker or a `KANTHORD_` name, and neither session file holds a marker. The first request of run 2 holds no M1, one system prompt and one user message. The names in the `env` output of each `bash` tool result are exactly `PATH`, `LANG`, `TMPDIR`, `HOME`, `GIT_CONFIG_NOSYSTEM` and `GIT_SSH_COMMAND`, plus `PWD`, `SHLVL` and `_`, which bash sets itself. Auth has the same SHA-256 digest and the same mode before and after each run.

3. **L2-AC3. A refused session path starts nothing.** Covers L1 AC2, variant 2.
   - Fixture: Auth, Stub, W, H, X, T, D. S is a symbolic link to a file F with known text in another directory.
   - Command: Run.
   - Assert: refused with `cli.run.agent.session_exists`. Stub receives no request. F is byte-equal. O does not exist. T holds no file.

4. **L2-AC4. LLM output stays unchanged, the result is redacted, and stderr holds the rotate warning.** Covers L1 AC4.
   - Fixture: Auth, Stub, W, H, X, T, D. The scripted assistant text holds K once.
   - Command: Run. Then Run with `--output` removed.
   - Assert: each run exits `0`. The `assistant` entry of each session file holds the scripted text byte for byte, K included. stderr of each run holds exactly one line with `"code":"cli.run.agent.secret_exposed"`, the rule of L3 in `rule` and `1` in `count`. The `text` field of the line in O holds the redaction marker in the place of K. stdout of the second run holds the redaction marker in the place of K. stdout, stderr and O hold K zero times.

5. **L2-AC5. A refused `--auth` file starts nothing and runs no shell code.** Covers L1 AC6.
   - Fixture: Stub, W, H, X, T, D. Auth with the key `!touch <marker>`.
   - Command: Run.
   - Assert: refused with `cli.run.agent.auth_key_command`, with the row `field: key`. No file exists at `<marker>`. Stub receives no request. No file exists at S. O does not exist. T holds no file.

6. **L2-AC6. The credential comes only from the `--auth` file.** Covers L1 AC7, AC8 and AC21.
   - Fixture: Stub, W, X, T, D, in the test container. The user database gives H as the home of the OS user. `H/.config/kanthord/auth.json` is Auth, with the key K. `PI_CODING_AGENT_DIR` is D2, with an `auth.json` that holds K2. `H/.pi/agent/auth.json` holds K5. The parent environment sets `KANTHORD_TOKEN` to T1, and `H/.config/kanthord/cli.yaml` holds `token: T2`. Standard input holds `{"provider_id":"openai-compatible","credential":{"type":"api_key","key":"<K6>"}}`. Each file has mode `0600`.
   - Command: variant 1: Run with `--auth` removed and `HOME="$H"`. Variant 2: the same with `HOME` set to H2, where `H2/.config/kanthord/auth.json` holds K3. Variant 3: the same as variant 1 with `XDG_CONFIG_HOME` set to X2, where `X2/kanthord/auth.json` holds K4.
   - Assert: each variant exits `0`. Each request to Stub carries K, and never K2, K3, K4, K5 or K6. No request and no session file holds T1 or T2.

7. **L2-AC7. The pi directory holds only shipped files, and the run loads nothing from a path.** Covers L1 AC22 and AC27.
   - Fixture: Auth, Stub, H, X, T, D. Variant 1: W as usual, and `$X/kanthord/pi/auth.json` exists with mode `0600`. Variant 2: the one commit of W holds `.pi/extensions/x.ts`, which writes the marker file M7 at load, and `AGENTS.md` with the marker text M8. `$X/kanthord/pi/extensions/y.ts` writes the marker file M9 at load.
   - Command: Run, once per variant.
   - Assert: variant 1 is refused with `cli.run.agent.auth_in_pi_directory`, with the row `path: $X/kanthord/pi/auth.json`. P holds only `auth.json`, because the check runs before the pi tool install. Stub receives no request, and no file exists at S. Variant 2 exits `0`. No file exists at M7 or M9. No request to Stub holds M8.

8. **L2-AC8. One input runs under each profile, and the results compare.**
   - Fixture: Auth, Stub, H, X, T, D. W1 to W6 are worktrees of one commit. A file `$TEST/task.md` holds the text M3. A file F holds `Binding prompt of repository r:\n\nM4`. S1 to S6 are paths in D.
   - Command: `kanthord run agent swe@1 --model openai-compatible/stub-1:off --budget 10m --system-prompt F --workspace W1 --session S1 --auth "$AUTH" --output "$O" --prompt "$TEST/task.md" --prompt M5`. Then the same command with `re@1`, `bee@1`, `fee@1` and `te@1`, on W2 to W5 with S2 to S5. Then the same command with `swe@1`, W6 and S6.
   - Assert: each run exits `0`. O holds six lines. `input_digest` is equal on the six lines. `system_prompt_digest` is equal on lines 1 and 6, although their workspaces differ. It differs between each two of lines 1 to 5. The user message of the first request of each run is exactly M3, a blank line and M5. Its system prompt holds M4 after the Role.

9. **L2-AC9. A prompt value is text or a file, and a typo is visible.**
   - Fixture: Auth, Stub, W, H, X, T, D. The current directory of the process is a directory C1 outside W. C1 holds `task.md` with the text M3. No entry exists at `C1/typo.md`.
   - Command: Run with `--prompt task.md --prompt "fix the bug" --prompt typo.md` in place of `--prompt "$INPUT"`.
   - Assert: exit `0`. The user message of the first request is exactly M3, a blank line, `fix the bug`, a blank line and `typo.md`. stderr holds exactly one line with `"code":"cli.run.agent.prompt_text_path"`, `"option":"--prompt"` and `"index":3`. The line in O has the `input_digest` of `digest` over the three part texts M3, `fix the bug` and `typo.md`.

10. **L2-AC10. Each end of a failed or limited run has its exit code and class.**
    - Fixture: Auth, W, H, X, T, D. Stub variants: A answers after 30 s; B answers HTTP 429 to each request; C answers HTTP 401 with a body that holds K. In this check K holds only ASCII letters, so the body matches no pattern of `isRetryableAssistantError` (`@earendil-works/pi-ai`, `dist/utils/retry.js`).
    - Command: (1) Run with `--budget 5s` against A. (2) Run against B. (3) Run against C.
    - Assert: (1) exit `4`; the line in O has `end` `budget_end`, `budget_reached` `wall`, `class` `terminal`, and `duration_ms` of 5000 or more and less than 30000. (2) exit `75`; B receives 4 requests, the first one and the 3 retries of pi; the line has `end` `failed`, `class` `retryable` and `failure` `rate_limited`; stderr holds a line that starts with `cli.run.agent.provider_retryable`. (3) exit `5`; C receives 1 request; the line has `class` `terminal` and `failure` `unauthorized`; stderr holds a line that starts with `cli.run.agent.provider_failed`; S holds K zero times. In each case S exists, stderr and O hold K zero times, and T holds no file.

11. **L2-AC11. A signal stops the run with the full record.**
    - Fixture: Auth, Stub, W, H, X, T, D. Variant 1: the scripted answer calls `bash` with `echo $$ > "$TEST/pid"; exec sleep 600`. Variant 2: Stub answers after 30 s.
    - Command: variant 1: Run; send SIGTERM to the process after `$TEST/pid` exists. Variant 2: Run; send SIGINT to the process after Stub receives the first request.
    - Assert: each variant exits `2` within 10 seconds of the signal. The line in O has `end` `stopped` and `class` `terminal`. T holds no file. Variant 1: no process with the id in `$TEST/pid` exists after the exit, and S holds the `bash` tool call. Variant 2: Stub records the close of the request connection before the exit, and S holds an `assistant` entry with the stop reason `aborted`.

12. **L2-AC12. A failed start precondition starts nothing and changes nothing.** Covers L1 AC10.
    - Fixture: Auth, Stub, H, X, T, D. Variant 1: W holds an uncommitted change of a tracked file. Variant 2: W is an empty directory that is no git worktree.
    - Command: Run, once per variant.
    - Assert: refused with `cli.run.agent.start_refused`, and the `reason` row holds the precondition id of L3. Stub receives no request. No file exists at S. A digest listing of W is equal before and after. For variant 1, the output of `git -C "$W" status --porcelain` is equal before and after. T holds no file.

13. **L2-AC13. The model selection reaches the request unchanged.**
    - Fixture: Stub, W, H, X, T, D. Auth with `OPENAI_COMPATIBLE_MODELS` set to `[{"id":"org/think:1","reasoning_levels":["off","high"]}]`.
    - Command: Run with `--model openai-compatible/org/think:1:high`.
    - Assert: exit `0`. The request to Stub names the model `org/think:1`, and its field `reasoning.effort` equals `high`. The line in O has `model` `org/think:1` and `reasoning_effort` `high`.

14. **L2-AC14. A confined profile reads nothing outside its root.** Covers L1 AC26.
    - Fixture: Auth, Stub, H, X, T, D. A marker file outside W holds the unique text M6. The one commit of W holds a file F with known text and a symbolic link L whose target is the marker file. The scripted calls: `read` of the marker file by its absolute path; `grep` for M6 on the directory of the marker file; `read` of the marker file by a relative `../` path; `read` of L; `read` of F. Then a text answer.
    - Command: Run with the profile `re@1` in place of `swe@1`.
    - Assert: exit `0`. The first four calls get a block result in S. The fifth call returns the text of F. M6 is in no request to Stub, in no entry of S and not in O.

### Unit-level rules

These rules hold with no process, no file system flow and no LLM stub, so their tests are unit tests ([index](index.md#layer-files)). Each item names the owning module. L3 or L6 assigns the exact file. Each rule stays in the text of this page.

1. **The option parser of `run agent`.** Each refusal of [Options](#options), [Model selection](#model-selection) rules 1 to 3 and [Budget](#budget) rules 1 to 3: an absent `<agent-name>`, `--model`, `--session` or `--prompt`; an absent or non-directory `--workspace`; a repeated single-value option; a `--model` with no `/`, no level, an unknown level or the provider `anthropic-subscription`; a `--budget` of no kind, of zero or of a repeated kind; the `--output` forms. The `--token` refusal comes before each other refusal. The help lists each option and no `--token`.
2. **The text-or-path reader.** Each rule of [Text or path](#text-or-path) and [Prompt](#prompt): the exact "looks like a path" test; a value with a line break; an absent path as text with the notice; a path under `/dev` or `/proc`, before or after link resolution; a path in the KanthorD configuration directory or the pi directory; the `--auth` file by device and inode; the removal of final line breaks; an existing entry that is no regular file, or not UTF-8, or an image; the join with one blank line; an empty part; `prompt_missing`.
3. **The `--auth` reader.** Each [file check](#file-checks) and [entry check](#entry-checks): the modes `0640` and `0604`; another owner; an absent path; a symbolic link; a file inside the workspace; the keys `$NAME`, `${NAME}`, `prefix-$NAME`, `prefix-${NAME}`, `$$` and `$!`; a key that starts with `!`; an expired and an expiring OAuth entry; no entry; an entry that fails the schema; the provider check by entry type; each row of the [routing metadata mapping](#routing-metadata-mapping) and its `field` row order. The fixed default path ignores `HOME`, `XDG_CONFIG_HOME` and `PI_CODING_AGENT_DIR`.
4. **The model selection.** [Model selection](#model-selection) rules 4 to 6: a partial id, a case-insensitive id, the custom model fallback, an unknown model and an unsupported level.
5. **The session path checks.** Each rule of [Session file path](#session-file-path): an existing file, a directory, a symbolic link to an absent target, an absent parent, a parent of another user, a parent with a group or other write bit, a path inside the workspace or the pi directory.
6. **The output writer.** Each rule of [The output file](#the-output-file) and the exact [text layout](#--output-stdout): a symbolic link, a mode other than `0600`, another owner, a path inside the workspace or the pi directory, the `--auth` file and the session file; a parent of another user or with a group or other write bit. The JSON line holds exactly the fields of [The result](#the-result).
7. **The pi directory checks.** [The pi directory](#the-pi-directory) rules 2 and 5: no directory, a symbolic link, another owner, a failed install with its rows.
8. **The start checks.** [Proxy settings](#proxy-settings): `NODE_USE_ENV_PROXY`, `NODE_OPTIONS` and `process.execArgv`.
9. **The budget.** [Budget](#budget) rules 4 to 8: the first limit, the list price sum, the refusal of a cost budget for a model with no price, the defaults and the absence of a count limit. The test of the cost limit uses a model with a catalog price.
10. **The class mapping.** [Classes](#classes) rules 3 and 4: the class from `isContextOverflow` and `isRetryableAssistantError`, the failure kind from `providerFailureOf`, and each end to its exit code.
11. **The signal handler.** [Shutdown](#shutdown) rules 2 to 5: the time limit with the forced stop, the second signal, a signal during step 11 and a signal before step 10.
12. **The input digest.** [Input digest](#input-digest): the object and the absence of each path.

### Rules with no check, and the reason

- **Statelessness check 4, resume.** `run agent` has no resume input in this round ([L2-D5](#decisions)).
- **The removal of R after `SIGKILL`.** A kill skips each cleanup by design.
- **The real-credential run.** It needs the credential of Ulrich. [Gate procedure](#gate-procedure-the-real-credential-run) states it with its pass conditions.
- **A request to a cloud provider other than `openai-compatible`.** It needs that endpoint. The unit tests of the `--auth` reader cover each mapped entry. The gate run covers the provider of Ulrich.
- **The cost limit end to end.** Each provider with a price has a fixed public host, so the LLM stub cannot serve it. The stub provider `openai-compatible` has no price (`src/llm/model-connector.ts:100`). The unit test of the budget covers the limit with a priced model. [HANDOFF.md](../HANDOFF.md#llm-component) holds the change that gives an `openai-compatible` model a price.
- **The text of `docs/cli/run.md` for the developer.** It is page text, not a behavior. The review of the L6 step checks it.

## Decisions

1. **L2-D1.** The agent CLI is the leaf `run agent <agent-name>` under the new global root `run`. Constraint: `run` joins `TOP_LEVEL_NAMES` and `CommandName`; `docs/cli/run.md` owns the command; `run worker` is reserved for L4.
2. **L2-D2.** Each option answers one question of a KanthorD agent run (Ulrich, 2026-11-22). The options are `--prompt`, `--system-prompt`, `--model`, `--budget`, `--workspace`, `--session`, `--auth` and `--output`, and the profile is the operand. Constraint: each field has exactly one source; no JSON input file and no positional prompt exist; an absent `<agent-name>`, `--model`, `--session` or `--prompt` gives `cli.run.agent.option_invalid`.
3. **L2-D3.** A `--prompt` or `--system-prompt` value is a file when it looks like a path and names an entry; else it is text (Ulrich, 2026-11-22). Constraint: a value with a line break is text; a path-like value with no entry gives the notice `cli.run.agent.prompt_text_path`; an existing entry that is no regular UTF-8 file is refused; a path to the `--auth` file, the KanthorD configuration directory, the pi directory, `/dev` or `/proc` is refused; the `--prompt` parts form one user message, one turn.
4. **L2-D4.** `--system-prompt` adds context after the profile prompt at layer 2 and never replaces the profile prompt. Its reader is the evaluation with the repository context of `swe@1`. Constraint: the meaning differs from the pi option of the same name.
5. **L2-D5.** `--session` is required and names a new file. This round has no resume input. Constraint: the run refuses an existing entry at the path; the path lies in a directory that the current user owns, with no group or other write bit, outside the workspace and the pi directory.
6. **L2-D6.** The `--auth` entry passes a strict `api_key` branch or an `oauth` branch that keeps four fields. The provider check is the match of the entry type with the secret shape of the provider. Constraint: the run refuses each entry that pi refuses and an `api_key` entry with no key.
7. **L2-D7.** The routing metadata comes from the `env` object through the [mapping](#routing-metadata-mapping), the inverse of `METADATA_ENV` plus `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_MODELS`. Constraint: the `env` object holds exactly the names of the provider; the raw `env` never reaches pi.
8. **L2-D8.** The redirected home and the temporary directory of the run lie in a new run directory R in T, which the run removes before exit. Constraint: the process and each child get `HOME=R/home` and `TMPDIR=R/tmp`; P holds only shipped files.
9. **L2-D9.** The pi directory is the pi directory of the engine under the KanthorD XDG state directory, and no option changes it (Ulrich, 2026-11-22). Constraint: the `auth.json` check runs before the pi tool install; the current user owns the directory.
10. **L2-D10.** The default `--auth` path is `.config/kanthord/auth.json` in the home directory of the OS user from the user database (Ulrich, 2026-11-22). Constraint: no environment variable selects the `--auth` file; the run refuses a symbolic link at the `--auth` path, an `--auth` file inside the workspace and a prompt file that is the `--auth` file; a failed lookup in the user database refuses the run.
11. **L2-D11.** `--output stdout` gives the exact text layout, and `--output <path>` appends one JSON line per run (Ulrich, 2026-11-22). Constraint: the output file is a private, append-only file outside the workspace and the pi directory; the exit redaction applies to each form; the runtime writes nothing to stdout or stderr.
12. **L2-D12.** The exit codes are `0` completed, `1` refusal, `2` stopped, `4` budget end, `5` terminal failure and `75` retryable failure. Ulrich ruled the separate retryable code on 2026-11-22; the values are an Aelita decision. Constraint: exit `3` stays the code of a superseded `serve worker`; each end and each code has a class.
13. **L2-D13.** Each code has the form `cli.run.agent.<reason>`, and [Diagnostic codes](#diagnostic-codes) lists each code with its class. Constraint: L4 uses `cli.run.worker.<reason>`.
14. **L2-D14.** `--budget` takes a wall budget and a cost budget; the first limit ends the run (Ulrich, 2026-11-22). Aelita decision: the default is `2h` wall and no cost limit, no count limit applies, and an `oauth` entry accepts a cost budget as a list-price limit. Constraint: the cost is the list price from the pi catalog; a cost budget for a model with no price is refused; one clock read at step 9 gives the wall deadline, the OAuth expiry check and the start of `duration_ms`.
15. **L2-D15.** Two evaluation runs compare only with equal `input_digest`, `engine_version`, `provider`, `model`, `reasoning_effort` and `budget`. Two runs of one profile also need an equal `system_prompt_digest`. Constraint: the evaluation reads the `--output` file; `system_prompt_digest` covers the output of the L1-D10 composition function, before pi adds `<cwd>`; each run has its own new worktree of the case commit.
16. **L2-D16.** `run agent` writes no telemetry file and gives the agent contract no trace sink. Constraint: the session file and the result are the record of the run.
17. **L2-D17.** The [run order](#run-order) is fixed. Constraint: steps 1 to 5 create no file; no model request leaves before step 10.
18. **L2-D18.** `run agent` parses the model selection with the exported pi function `resolveCliModel` (Ulrich, 2026-11-22). The result model must also be the model that `modelRuntime.getModel` gives for the provider and the id of the result model. Constraint: the run refuses a result that differs from the text of `--model`, a model that the runtime does not hold and a level that the model does not support; it never matches fuzzily and never clamps the level. `provider` is a pi provider id, and the entry type of `anthropic` selects `anthropic` or `anthropic-subscription`.
19. **L2-D19.** `run agent` removes the proxy names `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY`, in upper and lower case, from the process environment. It refuses a Node proxy setting with `cli.run.agent.env_proxy`. Constraint: no proxy setting of the environment reaches a model request.
20. **L2-D20.** `run agent` passes no named variable of the shell to a child process in this round, because no reader exists. Constraint: the item of the Agent component in [HANDOFF.md](../HANDOFF.md#agent-component) holds the future input and the rules of today that it keeps.
21. **L2-D21.** `run agent` reads each prompt file with `readTextFile`. Constraint: a file fault gives `cli.file.not_regular` or `cli.file.encoding_invalid`; no new file code exists.
22. **L2-D22.** The host home input is the home directory of the OS user from the user database. Constraint: `system_prompt_digest` excludes the `<cwd>` section, so the host home and the workspace path do not change it.
23. **L2-D23.** Each end and each diagnostic code is `retryable` or `terminal` (Ulrich, 2026-11-22). Constraint: `retryable` means that the same input can succeed later with a new `--session` path and a workspace that passes the start preconditions; the class comes from `isContextOverflow` and `isRetryableAssistantError`; the failure kind comes from `providerFailureOf`; `run agent` retries nothing, and the retries of pi stay.
24. **L2-D24.** A first signal stops the run gracefully, with the result `stopped`; a second signal ends it after the removal of R (Ulrich, 2026-11-22). Aelita decision: the graceful part has a limit of 10 seconds, then a forced stop. Constraint: SIGINT and SIGTERM have the same effect; the end `stopped` is `terminal`; step 11 ignores a signal.

## Open questions for Ulrich

1. **A path that names an entry that is not readable as text.** The ruling of 2026-11-22 uses each value that names no valid regular UTF-8 file as text. [Text or path](#text-or-path), rule 3.4, refuses a path to an existing entry that is no regular file or not UTF-8, which is narrower.
   - Aelita recommends: keep the refusal. An image or a binary path never goes out to the provider as text with no notice, and the human sees the fault before any request.
   - Alternative: use the value as text with the notice `cli.run.agent.prompt_text_path`, as for an absent path. This follows the ruling word for word, but the provider then gets the path text in place of the file.

Each other decision of this page stays inside the CLI of the engine and makes no credential rule weaker.
