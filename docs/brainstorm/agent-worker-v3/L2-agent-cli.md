# L2: The agent CLI

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model that this page satisfies. Each KanthorD path starts at `engine/`. Each pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`), unless the path names another pi package. The code of today is engine `c864130e`.

## Goals

1. **G1.** `kanthord run agent` runs one agent profile from one input with no KanthorD server. The page states the full CLI contract: the command, each input, the output, the exit codes and each diagnostic code.
2. **G2.** Each credential rule of L1 for `run agent` maps to one CLI rule and one diagnostic code. No rule becomes weaker.
3. **G3.** Each L1 acceptance check with the owner L2 is runnable: the fixture, the command line and the asserted code or output field. Each new public behavior of L2 has its own check.
4. **G4.** The CLI alone runs the real-credential run of the agent gate and the evaluation of [L1-D20](L1-model.md#decisions). The page states the inputs that make two runs comparable.
5. **G5.** Each need of L2 from the agent contract is a requirement on [L3](L3-agent.md), not an L3 design.
6. **G6.** The direction point of R1, "input as options, a JSON file or a Markdown file", has a verdict and a fit rule.

## Evaluation of the direction

(G6)

### R1. Input as options, a JSON file or a Markdown file (fits in part, with a suggestion)

- **Verdict.** Options and a Markdown file fit. The JSON file does not fit.
- **Evidence.** pi takes the prompt as positional arguments: `pi [options] [--] [@files...] [messages...]` (pi `docs/cli.md`, section "Command Line"). An `@path` includes a text file, so a Markdown file carries a work prompt. pi takes extra system prompt text with `--append-system-prompt` (`dist/cli/args.js`). pi has no JSON input file. With the options and the pi forms, each field has one source, so a JSON file has no reader.
- **Suggestion for Ulrich.** Drop the JSON input file. The command line of a run records its fixed input, and the `input_digest` of the result proves that two runs had the same input ([Comparison rule](#comparison-rule)). Aelita applied this on 2026-11-22.
- **Fit rule.**
  1. The work prompt takes the pi forms: an `@path` text file or a literal message, positional after the profile ([Prompt](#prompt)).
  2. A Markdown file of extra instructions goes in with `--append-system-prompt <path>`.
  3. Each other input is one option. Each field has exactly one source.

## Command and the root `run`

(G1)

```text
kanthord run agent <agent-name> [options] [--] [@files...] [messages...]

options:
  --model <provider>/<model>:<level>   --session <path>
  [--append-system-prompt <path>]...   [--budget-wall <duration>]
  [--workspace <path>] [--auth <path>] [--pi-directory <path>]
  [--pass-env <name>]...
```

- `run agent` runs one agent profile from one input, prints one result and exits. It is local. It calls no route, opens no database, reads no server configuration file and reads no `cli.yaml`.
- Change: `run` joins the closed set of global root names. Today the set holds `config`, `upgrade`, `serve` and `auth` (`docs/cli/other.md`, section "Closed root names and option scope"; `TOP_LEVEL_NAMES` in `src/apps/cli/completeness.test.ts`). The constant `CommandName` of `src/apps/cli/constants.ts` gets `Run: "run"`, because `createProgram` asserts one root command per name (`src/apps/cli/index.ts`).
- `kanthord run` with no operand prints the group help and exits `0`, as each group does (`docs/cli/other.md`, section "Help semantics"). `kanthord run --help` lists `agent`.
- The name `run worker` is reserved for [L4](L4-worker-cli.md). Until L4 builds it, the group `run` holds only `agent`.
- The component root `agent` (`kanthord agent get`, `src/apps/cli/agent.ts`) stays. It reads the server part of the Agent component. `run agent` is the agent CLI. The two names do not overlap, because `agent` is a root and `agent` under `run` is a leaf.
- The new page `docs/cli/run.md` owns `run agent`, with the heading "Command inventory". `docs/cli/other.md` lists `run` among the global root names and links the page.
- The page `docs/cli/run.md` states these facts for the developer, as [L1](L1-model.md#handoffs-to-later-layers) hands them:
  - the [reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session) for `run agent` on a developer machine;
  - use a credential that the developer owns, not a credential of a project or a team;
  - disable core dumps with `ulimit -c 0` before a run. Today the page of `tasks run` states this rule (`docs/cli/worker.md`, section `tasks run`).
- Change: `kanthord worker tasks run`, `tasks seed` and `tasks compare` leave ([L1-D20](L1-model.md#decisions), [L1-D23](L1-model.md#decisions)). `run agent` takes over the credential checks of `tasks run`.

## Inputs

(G1, G2, G4)

### Options

| Input                 | Option or operand                    | Rule                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile               | `<agent-name>`                       | Required operand. One profile name of the runtime catalog, for example `swe@1` or `bee@1`. An unknown name is refused with `cli.run.agent.agent_unknown`.                                                                                                                                                                         |
| Work prompt           | `[@files...] [messages...]`          | Positional, after `<agent-name>`. At least one nonempty `@path` file or one message. [Prompt](#prompt) holds the rules.                                                                                                                                                                                                           |
| Appended instructions | `--append-system-prompt <path>`      | Repeatable. Each file is one instruction text, in the order of the command line. Path only: the run reads no text from the option itself. With no option, the run has no instructions. [Prompt](#prompt) holds the rules.                                                                                                         |
| Model selection       | `--model <provider>/<model>:<level>` | Required. The pi CLI form of one model selection with its reasoning effort. [Model selection](#model-selection) holds the rules. No default: a profile names no model ([L1-D3](L1-model.md#decisions)).                                                                                                                           |
| Wall budget           | `--budget-wall <duration>`           | Optional. A positive integer with `s`, `m` or `h`, as `tasks run` (`DURATION_PATTERN` in `src/worker/unit/tasks-seed.ts`). Default `2h`, the wall budget of a native worker (`NATIVE_RESOURCE_BUDGET` in `src/worker/catalog.ts`).                                                                                                |
| Session file          | `--session <path>`                   | Required. The path of the new pi session file. [Session file path](#session-file-path) holds the rules.                                                                                                                                                                                                                           |
| Workspace             | `--workspace <path>`                 | Optional. The working directory of the session, and the one confinement root of a confined profile. Default: the current directory of the process. The start preconditions of the profile apply to it ([L3](L3-agent.md)).                                                                                                        |
| LLM credential        | `--auth <path>`                      | Optional. The pi `auth.json` file. Default: `.pi/agent/auth.json` in the home directory of the OS user. [The `--auth` file](#the---auth-file) holds the rules.                                                                                                                                                                    |
| pi directory          | `--pi-directory <path>`              | Optional. The pi directory of the run. Default: the pi directory of the engine, `kanthord/pi` under the XDG state directory (`piDirectory` in `src/agent/pi.ts`). [Home, temporary and pi directories](#home-temporary-and-pi-directories) holds the rules.                                                                       |
| Passed variables      | `--pass-env <name>`                  | Repeatable. The run passes this variable of the shell to each child process. The refusals of `tasks run` apply (`passEnvRefused` in `src/worker/unit/tasks-seed.ts`), with `cli.run.agent.option_invalid`. A value of 12 or more characters joins the known secrets (`knownPassValues` in `src/worker/unit/tasks-credential.ts`). |

- A relative path resolves against the current directory of the process.
- A single-value option given twice is refused with `cli.option.duplicate` (`singleUse` in `src/apps/cli/shared.ts`).
- An absent `--model` is refused with `cli.run.agent.option_invalid`, `option: --model`.

### Model selection

Ulrich ruled on 2026-11-22: the model selection takes the official pi CLI form `<provider>/<model>:<level>` ([L1-D24](L1-model.md#decisions)). pi parses this form with the exported function `resolveCliModel({ cliProvider, cliModel, cliThinking, modelRuntime })` (`dist/core/model-resolver.d.ts`; exported by `dist/index.d.ts`). pi then matches fuzzily (exact id, then a partial id or name) and clamps the level to the model when it applies it (`docs/cli.md`, section "Models"). `run agent` keeps one model selection and makes no model choice ([Statelessness](L1-model.md#statelessness), check 9), so it refuses more than pi.

1. **Form (step 2 of the [run order](#run-order)).** `provider` is the text before the first `/`. `level` is the text after the last `:`. `model` is the text between them, and it is not empty. A model id can thus hold `/` and `:`. A value with no `/`, or with no `:` after the `/`, is refused with `cli.run.agent.option_invalid`, `option: --model`.
2. **Provider.** `provider` is a pi provider id: a value of `agentProviderKindSchema` (`src/agent/contract.ts`) other than `anthropic-subscription`. pi has no provider `anthropic-subscription`; its OAuth entry is the entry `anthropic` (`piProviderId` in `src/kernel/pi-provider.ts`). Else the run refuses it with `cli.run.agent.option_invalid`, `option: --model`.
3. **Level.** `level` is required and is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max` (pi `docs/cli.md`, section "Models"). Else the run refuses it with `cli.run.agent.option_invalid`, `option: --model`. The engine needs no mapping: `reasoningEffortSchema` (`src/agent/contract.ts`) and `ReasoningLevel` (`src/llm/platforms.ts`) hold the same seven values, and `agentPort` passes `reasoning_effort` unchanged as the pi `thinkingLevel` (`src/agent/agent-port.ts`). This page calls the level the reasoning effort, the term of the engine.
4. **Resolution (step 8).** After the model runtime exists, `run agent` calls `resolveCliModel` with `cliModel` set to the whole value and with no `cliProvider` and no `cliThinking`. No result model, or an `error`, is refused with `cli.run.agent.model_unknown`.
5. **Exact match (step 8).** The provider of the result model must equal `provider`, its id must equal `model`, and the returned `thinkingLevel` must equal `level`, each byte for byte. Else the run refuses it with `cli.run.agent.model_inexact`. Reason: a fuzzy match, a case-insensitive match or the raw-id fallback of `resolveCliModel` selects another model than the text names (`dist/core/model-resolver.js`).
6. **Supported level (step 8).** `level` must be in `getSupportedThinkingLevels` of the result model (`@earendil-works/pi-ai`, `dist/models.js`). Else the run refuses it with `cli.run.agent.level_unsupported`. The run never clamps the level. Today the engine refuses an unsupported level too (`resolveModel` in `src/llm/model-connector.ts`, `reasoning_effort_unsupported`).

Change: `tasks run` takes `--model <provider/model>` and `--reasoning <level>` as two options (`withModel` in `src/worker/unit/tasks-seed.ts`).

### Prompt

The work prompt takes the pi forms (pi `docs/cli.md`, section "Invocation and output"; `dist/cli/args.js`). Each positional argument after `<agent-name>` that starts with `@` is a file; each other one is a message. `--` stops the option parse, so a message can start with `-`.

1. **`@path`.** The path resolves against the workspace, the working directory of the session, as pi resolves it against its working directory. An absolute path stays as given. `run agent` expands no `~`; pi expands it (`resolveReadPath` in `dist/core/tools/path-utils.js`). The file is a regular UTF-8 text file. Else the run refuses it with `cli.run.agent.file_invalid`, with the `path` row. An empty file adds no text, as in pi.
2. **No image.** pi also takes an image `@path` (`processFileArguments` in `dist/cli/file-processor.js`). `run agent` refuses it this round, as a file that is not UTF-8 text. Reason: the coding profiles of L3 need no image input (R2), and the session file holds no image record that the evaluation reads.
3. **Text form.** The text of each file is `<file name="<absolute path>">`, a newline, the content without a byte order mark, a newline, `</file>` and a newline. This is the form of pi (`processFileArguments`). pi does not export that function, so `run agent` builds the same text.
4. **Turns.** As in pi, the first turn is the text of each file in order, followed by the first message. Each later message is one more turn of the same session, in order (`buildInitialMessage` in `dist/cli/initial-message.js`; `runPrintMode` in `dist/modes/print-mode.js`). A turn starts after the end of the turn before it. The run ends after the last turn, or at the first end that is not `completed`.
5. **Required.** With no message and no file text, the run refuses the input with `cli.run.agent.prompt_missing`.
6. **Standard input.** pi prepends piped standard input to the first turn. `run agent` reads no standard input (L1-D22), so a piped text never reaches a turn.
7. **`--append-system-prompt <path>`.** The pi option name. pi takes text or a file path; `run agent` takes a path only, which resolves against the current directory of the process. The file is a regular UTF-8 text file, else `cli.run.agent.file_invalid`. Each file is one instruction text, in the order of the command line. An empty file adds no instruction text.
8. **Reader of the appended instructions.** The [evaluation](#one-evaluation-run) gives the stored Repository prompt and the Binding prompt of `swe@1` with this option, so a role profile runs with the same repository context. `run agent` reads no server, so no other source of these texts exists. The agent composes the appended texts at the place of the Repository prompt, layer 2 of the KanthorD prompt chain ([Requirements on L3](#requirements-on-l3), item 12).

### Inputs that do not exist

- No option other than `--auth` names a credential source ([L1-D14](L1-model.md#decisions)). No option, no environment variable and no input file other than the `--auth` file names an endpoint.
- `run agent` never reads standard input ([L1-D22](L1-model.md#decisions)), also for the work prompt ([Prompt](#prompt), rule 6). Change: `tasks run` reads the credential from standard input with `--credential-stdin` (`readDescriptor` and `runAction` in `src/apps/cli/worker-tasks.ts`).
- `--token` is refused with `cli.run.agent.token`. The command declares `--token [value]` as a hidden option only to refuse it, as `serve worker` does (`serveWorker` in `src/apps/cli/index.ts`). The refusal comes first, before each other check.
- No resume input exists in this round. `--session` names a new file only ([L2-D5](#decisions)).
- No telemetry output exists. The session file is the record of the run.
- No JSON input file exists. Each field has one source, the option or the positional argument ([R1](#r1-input-as-options-a-json-file-or-a-markdown-file-fits-in-part-with-a-suggestion)).

## The `--auth` file

(G2)

This section maps each item of [The `--auth` file of `run agent`](L1-model.md#the---auth-file-of-run-agent) to a CLI rule. The item numbers are the numbers of L1.

### File checks

1. **Default path (item 1).** `run agent` builds the default path from `homedir` of `os.userInfo()`, the home directory of the OS user in the user database. It reads no `HOME` and no `PI_CODING_AGENT_DIR` for it. Reason: `os.homedir()` returns `HOME` first on POSIX, and `HOME` is an environment variable.
2. **Read before the ambient removal (item 2).** `run agent` reads the entry before it redirects `HOME` ([Run order](#run-order), step 6).
3. **File checks (item 5).** `lstat` of the path must give a regular file. An absent path, a symbolic link or another file type is refused with `cli.run.agent.auth_file_invalid`. A file that another user owns is refused with `cli.run.agent.auth_file_owner`. A mode with a group or other bit (`0o077`) is refused with `cli.run.agent.auth_file_mode`. Change: L1 does not refuse a symbolic link; L2 refuses it, as `cli.yaml` does (`docs/cli/other.md`, section "`cli.yaml` and its effects").
4. **The read (item 3).** `run agent` calls `readStoredCredential(providerId, authPath)` with the absolute path (`dist/core/auth-storage.js`). `providerId` is the `provider` of the [model selection](#model-selection), a pi provider id. The call writes nothing.
5. **No entry (item 10).** `undefined` from the read is refused with `cli.run.agent.auth_entry_missing`. The read gives `undefined` for an absent entry and for a file that holds no valid JSON (`readStoredCredential`), so one code covers both. The `field` row names the provider id.

### Entry checks

The checks run in this order. The first failed check gives the refusal.

1. **Entry schema (item 10).** The raw entry must pass one branch. Else the run refuses it with `cli.run.agent.auth_entry_invalid`, and the `field` row names the failed path.
   - `api_key`: a strict object with `type: "api_key"`, `key` and an optional `env`. `key` passes the `api_key` branch of `piCredentialSchema` (`src/custody/contract.ts`). `env` is an object of string values.
   - `oauth`: an object with `type: "oauth"`, `access`, `refresh` and `expires`. These four fields pass the `oauth` branch of `piCredentialSchema`. The run ignores each other field and passes only the four fields to the frozen store. Reason: pi writes provider fields in an OAuth entry, for example `accountId` of `openai-codex` (`@earendil-works/pi-ai`, `dist/auth/oauth/openai-codex.js`, `credentialsFromToken`). The request path of `openai-codex` reads the account from the access token (`extractAccountId` in `@earendil-works/pi-ai`, `dist/api/openai-codex-responses.js`).
   - Each branch refuses each entry that the pi `auth.json` load refuses (`load` of `ReadOnlyAuthStorage` in `dist/core/auth-storage.js`, a class that pi does not export). It also refuses an `api_key` entry with no `key`, which pi accepts ([L1-D24](L1-model.md#decisions)).
2. **Shell command (item 7).** A `key` that starts with `!` is refused with `cli.run.agent.auth_key_command`, field `key`.
3. **Variable reference (item 6).** A `key` that holds `$` anywhere is refused with `cli.run.agent.auth_key_reference`, field `key`.
4. **Provider check (item 4).** The entry type must equal the secret shape of the selected provider (`secret_shape` of `LLM_PLATFORMS` in `src/llm/platforms.ts`). Else the run refuses it with `cli.run.agent.auth_entry_invalid`, field `type`. Change: today `credentialOf` compares only the provider id (`src/worker/unit/tasks-credential.ts`). The `--auth` read selects the entry by the provider id, so the shape check is the provider check of `run agent`. For the pi provider `anthropic`, the entry type selects the provider of the engine: an `api_key` entry is `anthropic`, and an `oauth` entry is `anthropic-subscription` (`ANTHROPIC_SUBSCRIPTION_PLATFORM` in `src/kernel/pi-provider.ts`). For each other provider, the provider of the engine is the pi provider id.
5. **Routing metadata (item 4 and "Endpoint" of [LLM credential](L1-model.md#llm-credential)).** The run maps the `env` object to the routing metadata with the [mapping](#routing-metadata-mapping). The metadata schema of the provider must pass (`metadata_schema` of `LLM_PLATFORMS`). Else the run refuses it with `cli.run.agent.auth_entry_invalid`. The `field` row names `env` or `env.<NAME>`.
6. **Expiry (item 4).** An `oauth` entry whose `expires` is before the wall deadline plus `PI_OAUTH_REFRESH_WINDOW_MS` (`src/llm/refresh-watch.ts`) is refused with `cli.run.agent.credential_expiring`. The wall deadline is the time of step 5 of the [run order](#run-order) plus the wall budget. The human refreshes the entry with pi.

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

1. The `env` object holds exactly the names of the selected provider. A name outside that list is refused, and the `field` row names it. Reason: pi gives a value of `env` precedence over `process.env` for endpoint placeholders and proxy variables (`ProviderRequestOptions.env` in `@earendil-works/pi-ai`, `dist/types.d.ts`).
2. A provider with no metadata schema takes an absent or empty `env`. This keeps the rule of today that a provider with no metadata schema refuses metadata (`routingMetadataOf` in `src/worker/unit/tasks-credential.ts`).
3. The value of `OPENAI_COMPATIBLE_MODELS` is JSON text, because pi keeps each `env` value as a string (`ProviderEnv` in `@earendil-works/pi-ai`, `dist/types.d.ts`). Text that is no JSON is refused, field `env.OPENAI_COMPATIBLE_MODELS`.
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

(G2)

This section maps [Session file](L1-model.md#session-file), "Place", to CLI rules. The checks run before any pi session open.

1. The path is absolute after resolution against the current directory.
2. No entry exists at the path, a symbolic link included, also when its target does not exist. `lstat` decides. Else the run refuses it with `cli.run.agent.session_exists`.
3. The parent directory exists and is a directory, after `realpath`. Else the run refuses it with `cli.run.agent.session_directory_invalid`. `realpath` lets a parent path through a link of the system, for example `/tmp` on macOS.
4. The current user owns the real parent directory. Else the run refuses it with `cli.run.agent.session_directory_owner`.
5. The path is not inside the workspace or the pi directory, compared by real paths. Else the run refuses it with `cli.run.agent.session_place`. Reason: a session file inside the workspace is a change that the agent reads and that a later commit takes. A session file inside the pi directory breaks check 5 of [Statelessness](L1-model.md#statelessness).
6. pi creates the file at the first conversation entry with `openSync(file, "wx")` (`dist/core/session-manager.js`, `_persist`). `wx` refuses a path that exists, a symbolic link included. `runCLI` sets the umask `0o077` (`PRIVATE_UMASK` in `src/kernel/files.ts`; `src/apps/cli/index.ts`), so the file mode is `0600`.
7. A run that ends before the first conversation entry leaves no file at the path.

## Home, temporary and pi directories

(G2)

L1 asks L2 to place the redirected `HOME` of `withoutAmbientCredentials` and the pi directory P, so that [AC1](L1-model.md#checks) holds: `HOME` H and `TMPDIR` T stay unchanged, and the redirected home lies inside P, or inside T and the run removes it before exit.

### The run directory

1. After the `--auth` read, `run agent` makes the run directory R with `mkdtemp` in the `TMPDIR` of the process, mode `0700`. R holds `home/` and `tmp/`, mode `0700`.
2. The ambient removal of `withoutAmbientCredentials` (`src/worker/unit/tasks-credential.ts`) runs on the process environment, with `HOME` set to `R/home`. The AWS file paths go under `R/home/.aws/`. The removal list and the set names stay as today (`AMBIENT_CREDENTIAL_NAMES` in `src/worker/unit/tasks-seed.ts`; `docs/cli/worker.md`, `tasks run`, rule 6). `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` stay, as today.
3. Change: the run also sets `TMPDIR` of the process to `R/tmp`. Reason: pi writes each output file, for example the full text of a truncated tool output, in the OS temporary directory (`dist/utils/output-files.js`, `createOutputFilePath`). AC1 requires that T holds no file after exit.
4. Each child process gets `PATH` and `LANG` of the shell, `TMPDIR=R/tmp`, `HOME=R/home`, `GIT_CONFIG_NOSYSTEM=1`, the `GIT_SSH_COMMAND` of `FIXED_GIT_ENV` (`src/worker/unit/tasks-run.ts`) and the `--pass-env` variables only. Change: today a child gets the `TMPDIR` of the shell (`SHELL_NAMES` in `src/apps/cli/worker-tasks.ts`). The names stay the same; only the value of `TMPDIR` changes.
5. `run agent` removes R recursively before it exits, on each end and on each refusal after step 6 of the [run order](#run-order). A `SIGKILL` skips the removal, and R stays in T.

R lies in T and not in P. Reason: AC1 requires that P holds only shipped files, byte-equal after run 1 and run 2. A home in P holds the files that child processes write, so it carries state from one run to the next.

### The pi directory

1. The default is `piDirectory(process.env)`, computed before the ambient removal (`src/agent/pi.ts`). The default thus lies under the real home or `XDG_STATE_HOME`. AC1 passes an explicit P, so H stays unchanged.
2. The last segment of the path must be `pi`. Reason: `usePiDirectory` and `piAgentDirectory` assert it (`src/agent/pi.ts`). The fixture P is thus `<test directory>/pi`.
3. When the path exists, it is a directory that the current user owns, and no symbolic link. Else the run refuses it with `cli.run.agent.pi_directory_invalid`.
4. An `auth.json` in the pi directory is refused with `cli.run.agent.auth_in_pi_directory` (item 9). Change: the check runs before the pi tool install. Today `bindPiDirectory` installs the tools first and then checks (`src/worker/unit/tasks-run.ts`).
5. The pi tool install then writes only shipped files (`installPiTools` in `src/agent/pi-tools.ts`), and `loadPi` sets `PI_CODING_AGENT_DIR` to the pi directory (`src/agent/pi.ts`).

## Run order

(G1, G2)

1. Parse the command line. Refuse `--token` with `cli.run.agent.token`.
2. Check each option value. Resolve the workspace path. Read each `@path` file against the workspace and each `--append-system-prompt` file against the current directory. Read each `--pass-env` value from the shell.
3. Find the profile in the runtime catalog.
4. Resolve the workspace, the session file path and the pi directory. Run the checks of [Session file path](#session-file-path) and of [The pi directory](#the-pi-directory).
5. Read and check the `--auth` entry.
6. Make R and run the ambient removal.
7. Install the pi tools in the pi directory.
8. Build the model runtime from the checked credential and the metadata (`createModelRuntime` in `src/llm/model-connector.ts`). Resolve the model with the rules 4 to 6 of [Model selection](#model-selection): `cli.run.agent.model_unknown`, `cli.run.agent.model_inexact` or `cli.run.agent.level_unsupported`. The runtime makes no network call here (`allowModelNetwork: false`, `refreshOnCreate: false`).
9. Open the session through the agent contract. A failed start precondition gives `cli.run.agent.start_refused`, with the `reason` row of L3.
10. Send the turns of [Prompt](#prompt), rule 4. Wait for the end of each turn.
11. Write the result line on stdout. Remove R. Exit.

- A refusal at steps 1 to 9 writes nothing on stdout and gives exit `1`. Its diagnostic is the first stderr line. No model request leaves before step 10, so the provider receives no request.
- Steps 1 to 5 create no file and no directory.
- SIGINT during step 10 stops the turn with the end `stopped` (`stopOnSignal` in `src/apps/cli/worker-tasks.ts` does this for `tasks run` today).

## Output

(G1)

### stdout

After each end of step 10, stdout is exactly one line: one compact JSON object. A refusal prints nothing on stdout. This follows the engine rule "one JSON value followed by a newline" for a domain result (`docs/cli/other.md`, section "Output and exit behavior").

| Field                  | Value                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `agent`                | The profile name                                                                                                        |
| `engine_version`       | The package version (`packageVersion` in `src/kernel/version.ts`)                                                       |
| `provider`             | The provider of the model selection                                                                                     |
| `model`                | The model id                                                                                                            |
| `reasoning_effort`     | The reasoning effort: the `level` of the model selection                                                                |
| `budget_wall_ms`       | The wall budget in milliseconds                                                                                         |
| `input_digest`         | The [input digest](#input-digest)                                                                                       |
| `system_prompt_digest` | The SHA-256 hex digest of the composed system prompt that the model reads, from the agent contract                      |
| `workspace`            | The real path of the workspace                                                                                          |
| `session`              | The absolute path of the session file                                                                                   |
| `session_id`           | The pi session id, equal to `id` of the header entry of the session file                                                |
| `end`                  | `completed`, `budget_end`, `stopped` or `failed`                                                                        |
| `exit_code`            | The exit code of the process                                                                                            |
| `duration_ms`          | The wall time from the session open to the end of the last turn                                                         |
| `model_calls`          | The count of assistant messages of the run                                                                              |
| `tool_calls`           | The count of tool calls of the run                                                                                      |
| `usage`                | `{ "input", "output", "cache_read", "cache_write" }`: the sums of the token counts of the assistant messages of the run |
| `text`                 | The last assistant text of the run after the exit redaction, or `null` when the run has no assistant text               |

- stdout holds no credential value. `text` passes the exit redaction of the agent contract, so a known secret shows as the redaction marker ([L1](L1-model.md#session-file), "Exit redaction").
- Change: `tasks run` prints `{ "output", "end", "exit_code" }` and writes an output folder (`tasksRun` in `src/apps/cli/worker-tasks.ts`). `run agent` writes no output folder.

### Input digest

`input_digest` is `digest` (`src/kernel/json.ts`) of this object: `files`, `messages`, `append_system_prompt`, `provider`, `model`, `reasoning_effort`, `budget_wall_ms` and `pass_env`. `files` is the list of `{ "path", "text" }` of each `@path` file in order: the path as given and the file content. `messages` is the list of messages in order. `append_system_prompt` is the list of the appended instruction texts in order. `pass_env` is the list of passed names. The digest holds no workspace path and no value of a passed variable, so two runs in two worktrees with the same input give the same digest.

### stderr

1. A refusal writes the diagnostic in the engine format: line 1 is `<code>: <message>`, then one aligned `name: value` row per value (`diagnostic` and `diagnosticRows` in `src/kernel/errors.ts`). The message holds no value.
2. `run agent` writes no other line before a refusal. [L3](#requirements-on-l3) requires that the runtime writes nothing to stdout or stderr.
3. The rotate warning of R2-H ([L1](L1-model.md#session-file), "Finding in LLM output"): one JSON line per warning that the agent contract gives, in order. The line is `{ "code": "cli.run.agent.secret_exposed", "msg": "model output holds a known secret; rotate that credential", "rule", "count" }`. `rule` is the redaction rule that L3 names, and `count` is the count of the warning. The line holds no value. The warning refuses nothing and does not change the exit code.
4. The end `failed` writes the diagnostic `cli.run.agent.internal_error` after the result line, with the `reason` row. The agent contract gives the reason after the exit redaction.
5. Each stderr line holds no credential value.

### Exit codes

| Exit | End or cause                                                                        |
| ---- | ----------------------------------------------------------------------------------- |
| `0`  | `completed`                                                                         |
| `1`  | A refusal of the [run order](#run-order), steps 1 to 9, or a Commander syntax error |
| `2`  | `stopped`: SIGINT                                                                   |
| `4`  | `budget_end`: the wall budget ends the turn                                         |
| `5`  | `failed`: the provider or the runtime ends the turn with an error                   |

Exit `3` stays the code of a superseded `serve worker` (`ExitCode` in `src/apps/cli/constants.ts`). Change: for `tasks run`, a budget end gives exit `0`, and exit `4` means a failed `--verify` check (`TasksExit` in `src/worker/unit/tasks-run.ts`). For `run agent`, a budget end is no completion, so it has its own code.

## Diagnostic codes

(G1, G2)

Each code of `run agent` has the form `cli.run.agent.<reason>`. The table lists each code. The rows use the closed row names of `docs/cli/other.md`, section "Output and exit behavior".

| Code                                      | Condition                                                                                                                 | Rows            | Source                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| `cli.run.agent.token`                     | `--token` is on the command line                                                                                          | `option`        | [L1-D17](L1-model.md#decisions), AC8                 |
| `cli.run.agent.option_invalid`            | An option value fails its rule; `--model` is absent                                                                       | `option`        | [Options](#options)                                  |
| `cli.option.duplicate`                    | A single-value option is repeated. The code exists today (`src/apps/cli/shared.ts`)                                       | `option`        | [Options](#options)                                  |
| `cli.run.agent.agent_unknown`             | The profile name is in no entry of the runtime catalog                                                                    | `option`        | [Options](#options)                                  |
| `cli.run.agent.file_invalid`              | An `@path` file or an `--append-system-prompt` file is absent, is no regular file or is not UTF-8 text, an image included | `path`          | [Prompt](#prompt), rules 1, 2 and 7                  |
| `cli.run.agent.prompt_missing`            | The positional arguments give no message and no file text                                                                 | none            | [Prompt](#prompt), rule 5                            |
| `cli.run.agent.auth_file_invalid`         | The `--auth` path is absent, is a symbolic link or is no regular file                                                     | `path`          | Item 5; L2-D10                                       |
| `cli.run.agent.auth_file_owner`           | Another user owns the `--auth` file                                                                                       | `path`          | Item 5                                               |
| `cli.run.agent.auth_file_mode`            | The mode of the `--auth` file has a group or other bit                                                                    | `path`          | Item 5                                               |
| `cli.run.agent.auth_entry_missing`        | The read gives no entry of the selected provider                                                                          | `path`, `field` | Items 3 and 10                                       |
| `cli.run.agent.auth_entry_invalid`        | The entry fails the entry schema, the provider check or the routing metadata mapping                                      | `path`, `field` | Items 4 and 10; [mapping](#routing-metadata-mapping) |
| `cli.run.agent.auth_key_command`          | The key starts with `!`                                                                                                   | `path`, `field` | Item 7                                               |
| `cli.run.agent.auth_key_reference`        | The key holds `$`                                                                                                         | `path`, `field` | Item 6                                               |
| `cli.run.agent.credential_expiring`       | The OAuth `expires` is before the wall deadline plus the refresh window                                                   | `path`          | Item 4                                               |
| `cli.run.agent.auth_in_pi_directory`      | The pi directory holds `auth.json`                                                                                        | `path`          | Item 9                                               |
| `cli.run.agent.pi_directory_invalid`      | The pi directory path does not end with the segment `pi`, is no directory, is a symbolic link or another user owns it     | `path`          | [The pi directory](#the-pi-directory)                |
| `cli.run.agent.session_exists`            | An entry exists at the session file path, a symbolic link included                                                        | `path`          | [Session file path](#session-file-path), rule 2      |
| `cli.run.agent.session_directory_invalid` | The parent directory of the session file path is absent or no directory                                                   | `path`          | Rule 3                                               |
| `cli.run.agent.session_directory_owner`   | Another user owns the real parent directory of the session file path                                                      | `path`          | Rule 4                                               |
| `cli.run.agent.session_place`             | The session file path is inside the workspace or the pi directory                                                         | `path`          | Rule 5                                               |
| `cli.run.agent.model_unknown`             | `resolveCliModel` gives no model for the model selection                                                                  | none            | [Model selection](#model-selection), rule 4          |
| `cli.run.agent.model_inexact`             | The resolved provider, model id or level differs from the text of `--model`                                               | none            | Rule 5                                               |
| `cli.run.agent.level_unsupported`         | The resolved model does not support the level                                                                             | none            | Rule 6                                               |
| `cli.run.agent.start_refused`             | The agent contract refuses the start: a start precondition fails                                                          | `reason`        | [L1-D21](L1-model.md#decisions); step 9              |
| `cli.run.agent.internal_error`            | The end `failed`. It follows the result line                                                                              | `reason`        | [Exit codes](#exit-codes)                            |
| `cli.run.agent.secret_exposed`            | A warning, not a refusal: model output holds a known secret                                                               | none; JSON line | R2-H                                                 |

A Commander syntax error, for example an unknown option or a missing `<agent-name>`, writes the Commander message and exits `1`, as for each command (`docs/cli/other.md`, section "Output and exit behavior").

## Evaluation input

(G4)

### One evaluation run

L1-D20 compares each role profile with `swe@1` on prepared workspaces with fixed inputs. One evaluation case holds one repository, one commit C and one task.

1. **Instructions.** Export the stored Repository prompt and the Binding prompt of `swe@1` once, one file per part. This is the only step that reads the server; each run reads no server. Each file holds the heading, one blank line and the text of the part, as the server renders a part (`docs/cli/agent.md`, section "`get <agent-name>`"). E1 fit rule 5 adds no instruction file and no `AGENTS.md`.

   ```sh
   kanthord agent get swe@1 --project "$PROJECT" --binding-id "$BINDING" > "$CASE/agent.json"
   for part in repository binding; do
     jq -j --arg part "$part" '.prompt.parts[]
       | select(.part == $part and .state == "resolved" and (.text | test("\\S")))
       | "\(.heading)\n\n\(.text)"' "$CASE/agent.json" > "$CASE/$part.md"
   done
   ```

2. **Task.** Write the task text in `$CASE/task.md`. It lies outside each workspace, so each run gives it as one absolute `@path`.
3. **Workspace.** Prepare one new worktree of C for each run, with no uncommitted change: `git -C "$REPO" worktree add --detach "$CASE/$AGENT-$N/w" "$C"`. A run changes its workspace, so no two runs share one.
4. **Run.** Give the same task, instructions and model selection to each profile. Only the profile, the workspace and the session file change.

   ```sh
   mkdir -m 700 -p "$CASE/$AGENT-$N"
   kanthord run agent "$AGENT" --model "$PROVIDER/$MODEL:$LEVEL" \
     --append-system-prompt "$CASE/repository.md" --append-system-prompt "$CASE/binding.md" \
     --workspace "$CASE/$AGENT-$N/w" --session "$CASE/$AGENT-$N/session.jsonl" \
     -- "@$CASE/task.md" > "$CASE/$AGENT-$N/result.json"
   ```

5. **Record.** The pi session file is the record of the run: the model change, the thinking level, each message with its usage, and each tool call and tool result. `result.json` holds the identity and the totals of the run. The workspace holds the changes: `git -C w add -A && git -C w diff --cached "$C"`.

### Comparison rule

- Two runs compare only when `input_digest`, `engine_version`, `provider`, `model`, `reasoning_effort` and `budget_wall_ms` are equal. Equal values mean the same messages, the same `@path` file contents, the same appended instruction texts in the same order, the same shipped profile prompts and the same model selection.
- `agent` and `system_prompt_digest` differ by profile. Two runs of one profile with equal fields above have an equal `system_prompt_digest`.
- The model output is not deterministic. The evaluation plan of the agent gate sets the count of runs per profile and the verdict method. The verdict is a judgement with no fixed pass value ([L1](L1-model.md#rules-with-no-check-and-the-reason), L1-D16).

### Gate procedure: the real-credential run

Round order step 4.2 needs the credential of Ulrich, so it is a gate step and no automated check. Ulrich gives the pi provider id of the entry in his pi `auth.json`, the model id and the level. The run reads the default `--auth` path.

```sh
ulimit -c 0
mkdir -m 700 -p "$GATE"
git -C "$REPO" worktree add --detach "$GATE/w" "$C"
shasum -a 256 ~/.pi/agent/auth.json > "$GATE/auth.before"
stat -f %Lp ~/.pi/agent/auth.json >> "$GATE/auth.before"
kanthord run agent swe@1 --model "$PROVIDER/$MODEL:$LEVEL" \
  --workspace "$GATE/w" --session "$GATE/session.jsonl" \
  -- "Run git log -1 --format=%H with bash. Reply with the commit id only." \
  > "$GATE/result.json" 2> "$GATE/stderr.txt"
```

The run passes when each condition holds:

1. The exit code is `0`. `result.json` is one JSON line with `end` `completed`, `tool_calls` of 1 or more, and `text` that holds the output of `git -C "$GATE/w" rev-parse HEAD`.
2. A session file exists at `$GATE/session.jsonl` with mode `0600`. It holds one or more `message` entries with the role `assistant`.
3. The session file holds no credential value of the entry. The check prints only a count: `grep -cFf <(jq -r --arg p "$PROVIDER" '.[$p] | (.key, .access, .refresh) // empty' ~/.pi/agent/auth.json) "$GATE/session.jsonl"` prints `0`.
4. `~/.pi/agent/auth.json` has the same SHA-256 digest and the same mode as in `auth.before`. The commands are the macOS forms, because the `auth.json` of Ulrich is on his macOS machine.
5. `stderr.txt` holds no line with `cli.run.agent.secret_exposed`.
6. `git -C "$GATE/w" status --porcelain` prints nothing.

## Requirements on L3

(G5)

L2 needs these items from the agent contract. [L3](L3-agent.md#input-and-output-contract) designs them.

1. **Input.** The contract takes, from `run agent`: the profile name; the model runtime and the model that the consumer builds and resolves; the reasoning effort as the pi `thinkingLevel`, which the contract applies with no clamp; the workspace as the working directory and, for a confined profile, as the one root; the wall deadline; the appended instruction texts in order; the turns in order; the session file path; the known-secret source; the child environment; the host home; an abort signal. It takes no trace sink, no capability and no field of an execution.
2. **Catalog.** The runtime exports a lookup of a profile by name, so the CLI refuses an unknown name before step 4. The role profiles `bee@1`, `fee@1` and `te@1` are in the runtime catalog.
3. **Declared consumer tools with no implementation.** A session of a profile that declares a consumer tool opens and runs when the consumer gives no implementation. `swe@1` declares `evidence-upload` and `link_update_list`, and `run agent` gives no implementation ([L1](L1-model.md#handoffs-to-later-layers) hands the session shape to L3).
4. **Start refusal.** A failed start precondition gives a refusal with a stable precondition id and a reason. It comes before any model request, any session file write and any workspace change.
5. **Session file.** The contract writes the pi session file at the exact path of the input through pi, with the workspace as the `cwd` of the session header. It creates the file only through the `wx` open of pi.
6. **Output.** The contract gives: the end of each turn (`completed`, `budget_end`, `stopped`, or `failed` with a reason); the last assistant text; the pi session id; the SHA-256 digest of the composed system prompt that the model reads; the counts of model calls and tool calls and the token usage, or the session events that give them; each rotate warning with its rule and count.
7. **Exit redaction.** Each text that the contract gives out passes the exit redaction, the failure reason included.
8. **Silence.** The runtime writes nothing to the stdout or the stderr of the process.
9. **No proxy from the environment.** The runtime calls no `configureHttpDispatcher` of pi and sets no global HTTP dispatcher (AC24). Today the engine does not call it; only `dist/main.js` of pi does (`dist/core/http-dispatcher.js`).
10. **pi directory and resources.** The runtime writes into the pi directory only through the pi tool install. pi writes no `auth.json`, no settings file and no session file there. The runtime loads no extension, skill, prompt template, theme or context file from a path (AC1, AC27; `sessionParts` in `src/agent/agent-session.ts` does this today).
11. **Budget.** The contract ends the current turn with `budget_end` at the wall deadline. One wall deadline covers all turns of the run.
12. **Place of the appended instructions.** The composition function of [L1-D10](L1-model.md#decisions) places the appended instruction texts, in order and with no added heading, at the place of the Repository prompt: layer 2, after the profile prompt ([agent.md](../agent.md#prompt-composer)). Each text carries its own heading from the export.

## Handoffs to later layers

- [L4](L4-worker-cli.md): `run worker` under the root `run`. Its codes take the form `cli.run.worker.<reason>`, to match `run agent`. `kanthord run --help` then lists `agent` and `worker` (AC17).
- [L6](L6-migration.md): add `CommandName.Run` and the group `run` to `createProgram`. Add `run` to `TOP_LEVEL_NAMES`, the page `run` to `PAGE_INVENTORIES` and `PAGE_COUNTS`, and update `DOCUMENTED_COUNT` and `IMPLEMENTED_COUNT` (`src/apps/cli/completeness.test.ts`). Write `docs/cli/run.md`. Update the root names and the root help list of `docs/cli/other.md`, and the link list of `docs/cli/README.md`.
- [L6](L6-migration.md): move the checks that L1 lists before the deletion of `tasks run`, with the changes of this page: the entry reader with `readStoredCredential`; `routingMetadataOf` with the mapping and with no seed comparison; `withoutAmbientCredentials` with R in place of the output folder; the `TMPDIR` value; the check of `auth.json` before the pi tool install.
- [L6](L6-migration.md): the test container of the checks that need a second OS user, the network namespace N or an OS home directory other than the one of the developer: AC1, AC2, AC6, AC21, AC24 and L2-AC6.

## Acceptance checks

(G3)

A refusal means: exit code `1`, nothing on stdout, and a first stderr line that starts with the diagnostic code ([L1](L1-model.md#acceptance-checks)). Each check runs the built binary. Each check that runs in N, as a second OS user or with an OS home directory runs in the Linux test container of L6.

### L2 fixtures

L2 adds these details to the [shared fixtures of L1](L1-model.md#shared-fixtures).

- **Stub.** It serves `POST /v1/responses`, because the model connector gives `openai-compatible` the API `openai-responses` (`compatibleProvider` in `src/llm/model-connector.ts`). Its address is `http://127.0.0.1:$PORT`.
- **Auth.** The file of the [example entry](#routing-metadata-mapping), mode `0600`, with `OPENAI_COMPATIBLE_BASE_URL` set to `http://127.0.0.1:$PORT/v1` and the model `stub-1`.
- **P.** The path `$TEST/pi`, an empty directory.
- **Run.** This command line, with `$INPUT` the message of the check:

  ```sh
  HOME="$H" TMPDIR="$T" kanthord run agent swe@1 \
    --auth "$AUTH" --model openai-compatible/stub-1:off \
    --workspace "$W" --session "$S" --pi-directory "$P" \
    -- "$INPUT"
  ```

- **No request.** "Stub receives no request" means that the request log of Stub is empty after the exit.
- **Clean exit.** T holds no file after the exit.

### L1 checks with the owner L2

1. **AC1. No state outside the session file.**
   - Fixture: as L1. P is `$TEST/pi`. The parent environment sets the four `KANTHORD_*` names to markers. The scripted turn of each run calls `bash` with `env`, then answers a text.
   - Command: Run in N with `$INPUT` M1 and `--session "$D/s1.jsonl"`. Then Run in N with `$INPUT` M2 and `--session "$D/s2.jsonl"`. `$D` is one `0700` directory.
   - Assert: each pass condition of L1. Each run exits `0`. `find "$H" -type f -exec sha256sum {} +` is equal before and after each run. `$D` holds only `s1.jsonl` after run 1, and only `s1.jsonl` and `s2.jsonl` after run 2. P holds only the files of the pi tool manifest and their licenses, and its digest listing is equal after run 1 and run 2. `find "$T" -mindepth 1` prints nothing after each exit. The `bash` tool result in the session file holds no `KANTHORD_` name. The first request of run 2 holds no M1, one system prompt and one user message.

2. **AC2. The session file at the caller path, in a private place.**
   - Command: Run, once per variant of L1.
   - Assert: variant 1 exits `0`, and `stat -c %a "$S"` prints `600`. No other session file exists under H, P or T. Variants 2 and 3 are refused with `cli.run.agent.session_exists`. Variant 4 is refused with `cli.run.agent.session_directory_owner`. For variants 2 to 4, Stub receives no request, no file exists at S or at the link target, and the target of variant 2 is byte-equal.

3. **AC4. LLM output stays unchanged, and stderr holds the rotate warning.**
   - Fixture: as L1. The scripted assistant text holds K once.
   - Command: Run.
   - Assert: exit `0`. The `assistant` entry of S holds the scripted text byte for byte. stderr holds exactly one line with `"code":"cli.run.agent.secret_exposed"`, the rule of L3 in `rule` and `1` in `count`. stdout and stderr hold K zero times. The field `text` of stdout holds the redaction marker in the place of K.

4. **AC6. Refusals of the `--auth` file.**
   - Fixture: as L1. For cases 11 and 12, the command line has `--model openai-codex/m:off --budget-wall 10m`, and Run runs in N. In case 11, `expires` is the current time minus 1 minute. In case 12, `expires` is the current time plus 14 minutes.
   - Command: Run, once per variant.
   - Assert, per case: cases 1 and 2 give `cli.run.agent.auth_file_mode`. Case 3 gives `cli.run.agent.auth_file_owner`. Cases 4 to 9 give `cli.run.agent.auth_key_reference` with the row `field: key`. Case 10 gives `cli.run.agent.auth_key_command`, and no file exists at `<marker>`. Cases 11 and 12 give `cli.run.agent.credential_expiring`, and N logs no connection outside loopback. Case 13 gives `cli.run.agent.auth_entry_missing`. Case 14 (`"key": 123`) gives `cli.run.agent.auth_entry_invalid` with the row `field: key`. For each case, Stub receives no request, no file exists at S, and T holds no file.

5. **AC7. No credential from standard input.**
   - Command: `printf '%s' "$DOC_K2" | ` Run. `$DOC_K2` is `{"provider_id":"openai-compatible","credential":{"type":"api_key","key":"<K2>"}}`.
   - Assert: exit `0`. The `Authorization` header of each request to Stub holds K and never K2. S, stdout and stderr hold K2 zero times.

6. **AC8. `run agent` refuses `--token`.**
   - Fixture: as L1, with `KANTHORD_TOKEN=T1` and `"$H/.config/kanthord/cli.yaml"` that holds `token: T2`, mode `0600`.
   - Command: Run with `--token "$T3"` added. Then Run.
   - Assert: the first run is refused with `cli.run.agent.token`, with the row `option: --token`. Stub receives no request, and no file exists at S. The second run exits `0`. No request to Stub and no line of S holds T1, T2 or T3.

7. **AC14. `run` is in the closed root set, with `agent` under it.**
   - Command: `kanthord run --help`; `kanthord --help`; `pnpm --silent run test:files src/apps/cli/completeness.test.ts`.
   - Assert: `kanthord run --help` exits `0` and lists `agent`. `kanthord --help` lists `run`. The section "Closed root names and option scope" of `docs/cli/other.md` names `run` as a global root name. The completeness test exits `0`, and `TOP_LEVEL_NAMES` holds `run`.

8. **AC21. The default `--auth` path is in the home directory of the OS user.**
   - Fixture: as L1. In the test container, the user database gives H as the home of the OS user. `PI_CODING_AGENT_DIR` is D2, with an `auth.json` that holds K2.
   - Command: Run with the option `--auth` removed.
   - Assert: exit `0`. Each request to Stub carries K and never K2.

9. **AC22. An `auth.json` in the pi directory is refused.**
   - Fixture: as L1. `$P/auth.json` exists with mode `0600`.
   - Command: Run.
   - Assert: refused with `cli.run.agent.auth_in_pi_directory`, with the row `path: $P/auth.json`. Stub receives no request. No file exists at S. P holds only `auth.json`, because the check runs before the pi tool install.

10. **AC23. No ambient credential reaches the LLM or a child process.**
    - Fixture: as L1. The scripted turn calls `bash` with `env; cat ~/.aws/credentials`.
    - Command: Run.
    - Assert: exit `0`. No request to Stub holds a marker, in a header or in the body. The `bash` tool result in S holds no marker. S holds no marker.

11. **AC24. No environment variable names an endpoint or a credential of the provider.**
    - Fixture: as L1. Stub2 listens on a second loopback port.
    - Command: Run in N.
    - Assert: exit `0`. Stub2 records no connection. Stub receives each request, and each request carries K and never the `OPENAI_API_KEY` marker.

12. **AC27. `run agent` loads no extension and no context file from a path.**
    - Fixture: as L1. W holds `.pi/extensions/x.ts` and `AGENTS.md` with M8 in its one commit. `$P/extensions/y.ts` writes M9 at load.
    - Command: Run.
    - Assert: exit `0`. No file exists at M7 or M9. No request to Stub holds M8.

### L2 checks

1. **L2-AC1. A well-formed run exits 0 with the stated stdout.**
   - Fixture: Auth, Stub, W, H, P, T, S. The scripted turn answers the text `done-1` with the usage input 10 and output 2, and calls no tool.
   - Command: Run with `$INPUT` `say done`.
   - Assert: exit `0`. stdout is one line of one JSON object with exactly the 18 fields of [stdout](#stdout). `agent` is `swe@1`, `provider` is `openai-compatible`, `model` is `stub-1`, `reasoning_effort` is `off`, `budget_wall_ms` is `7200000`, `end` is `completed`, `exit_code` is `0`, `model_calls` is `1`, `tool_calls` is `0`, `usage` is `{"input":10,"output":2,"cache_read":0,"cache_write":0}` and `text` is `done-1`. `engine_version` equals the output of `kanthord --version`. `workspace` is the real path of W. `session_id` equals `id` of the first line of S. stderr is empty. T holds no file.

2. **L2-AC2. One input runs under two profiles, and the results compare.**
   - Fixture: Auth, Stub, H, P, T. W1, W2 and W3 are worktrees of one commit that holds `task.md` with the text M3. F is a file outside the worktrees with the text `Binding prompt of repository r:\n\nM4`. S1, S2 and S3 are paths in one `0700` directory.
   - Command: `kanthord run agent swe@1 --model openai-compatible/stub-1:off --budget-wall 10m --append-system-prompt F --workspace W1 --session S1 --auth "$AUTH" --pi-directory "$P" -- @task.md M5`. Then the same with `re@1`, W2 and S2. Then the same with `swe@1`, W3 and S3.
   - Assert: each run exits `0`. `input_digest` is equal for the three runs. `system_prompt_digest` is equal for runs 1 and 3 and differs for run 2. The first request of each run holds one user message: `<file name="<Wn>/task.md">`, M3, `</file>` and then M5, with `<Wn>` the real path of its workspace. Its system prompt holds M4 after the Role.

3. **L2-AC3. Input refusals.**
   - Fixture: Auth, Stub, W, H, P, T, S. W holds the empty file `empty.md` and the PNG file `image.png` in its one commit.
   - Command: Run, changed once per case:
     1. no message: `cli.run.agent.prompt_missing`;
     2. the message replaced by `@empty.md`: `cli.run.agent.prompt_missing`;
     3. `@missing.md` added: `cli.run.agent.file_invalid`, `path` the real path of W plus `/missing.md`;
     4. `@image.png` added: `cli.run.agent.file_invalid`;
     5. `--append-system-prompt "$TEST/missing.md"` added: `cli.run.agent.file_invalid`;
     6. `--model` removed: `cli.run.agent.option_invalid`, `option: --model`;
     7. `--model openai-compatible/stub-1` with no level: `cli.run.agent.option_invalid`, `option: --model`;
     8. `--budget-wall 10x` added: `cli.run.agent.option_invalid`, `option: --budget-wall`;
     9. `--pass-env HOME` added: `cli.run.agent.option_invalid`, `option: --pass-env`;
     10. a second `--auth "$AUTH"` added: `cli.option.duplicate`, `option: --auth`;
     11. the profile `xx@1`: `cli.run.agent.agent_unknown`;
     12. `--pi-directory "$TEST/tools"`: `cli.run.agent.pi_directory_invalid`.
   - Assert: each case is refused with the stated code and row. Stub receives no request. No file exists at S. T holds no file.

4. **L2-AC4. A failed start precondition is a refusal of the CLI.**
   - Fixture: Auth, Stub, H, P, T, S. Variant 1: W with an uncommitted change of a tracked file. Variant 2: an empty directory that is no git worktree.
   - Command: Run, once per variant, with `--workspace` set to the variant.
   - Assert: each variant is refused with `cli.run.agent.start_refused`, and the `reason` row holds the precondition id of L3. Stub receives no request. No file exists at S. A digest listing of the workspace is equal before and after. For variant 1, `git status --porcelain` is equal before and after. T holds no file.

5. **L2-AC5. More refusals of the session file path.**
   - Fixture: Auth, Stub, W, H, P, T.
   - Command: Run, once per value of `--session`:
     1. a regular file with known text: `cli.run.agent.session_exists`, and the file is byte-equal;
     2. a directory: `cli.run.agent.session_exists`;
     3. `"$W/s.jsonl"`: `cli.run.agent.session_place`;
     4. `"$P/s.jsonl"`: `cli.run.agent.session_place`;
     5. a path whose parent directory does not exist: `cli.run.agent.session_directory_invalid`.
   - Assert: each case is refused with the stated code. Stub receives no request. No new file exists at the path.

6. **L2-AC6. Each end has its exit code.**
   - Fixture: Auth, W, H, P, T, S. Stub variants: A answers after 10 s; B answers HTTP 400 with a body that holds K.
   - Command: (1) Run with `--budget-wall 2s` against A. (2) Run against A; send SIGINT to the process after A receives the first request. (3) Run against B.
   - Assert: (1) exit `4`, `end` `budget_end`. (2) exit `2`, `end` `stopped`. (3) exit `5`, `end` `failed`, and stderr holds a line that starts with `cli.run.agent.internal_error`. In each case stdout is one JSON line, stdout and stderr hold K zero times, and T holds no file.

7. **L2-AC7. The entry schema and the routing metadata mapping.**
   - Fixture: Stub, W, H, P, T, S. One `--auth` file per case, mode `0600`.
   - Command: Run with the `--model` and the entry of each case.
   - Refusal cases, each with `cli.run.agent.auth_entry_invalid` and the stated `field` row:
     1. `openai-compatible`, a valid `oauth` entry: `type`;
     2. `--model openai-codex/m:off`, an `api_key` entry under `openai-codex`: `type`;
     3. Auth with no `OPENAI_COMPATIBLE_MODELS`: `env.OPENAI_COMPATIBLE_MODELS`;
     4. Auth with the extra name `HTTPS_PROXY`: `env.HTTPS_PROXY`;
     5. Auth with `OPENAI_COMPATIBLE_MODELS` set to `stub-1`, which is no JSON: `env.OPENAI_COMPATIBLE_MODELS`;
     6. Auth with `OPENAI_COMPATIBLE_BASE_URL` set to `http://127.0.0.1:1/v1?x=1`: `env.OPENAI_COMPATIBLE_BASE_URL`;
     7. `--model anthropic/m:off`, an `api_key` entry with `env` `{"AWS_REGION":"x"}`: `env.AWS_REGION`;
     8. `--model amazon-bedrock/m:off`, an `api_key` entry with no `env`: `env.AWS_REGION`.
   - Pass cases: for each provider of the [mapping table](#routing-metadata-mapping), and for `openai-codex` with a valid `oauth` entry that also holds `accountId`, the entry holds the mapped names with valid values, and the model selection is `<provider>/unknown-model:off`. Each run is refused with `cli.run.agent.model_unknown`. The case `anthropic` with an `oauth` entry also passes, as the provider `anthropic-subscription`. This refusal comes after the entry checks, so the entry passed them.
   - Assert: each case gives its code and row. Stub receives no request. No file exists at S.

8. **L2-AC8. The help of `run agent`.**
   - Command: `kanthord run agent --help`.
   - Assert: exit `0`. The output lists `<agent-name>`, the positional prompt arguments and each option of the [synopsis](#command-and-the-root-run). It does not list `--token`.

9. **L2-AC9. The model selection is exact.**
   - Fixture: Stub, W, H, P, T, S. Auth with `OPENAI_COMPATIBLE_MODELS` set to `[{"id":"stub-1"},{"id":"stub-1-large"},{"id":"think-1","reasoning_levels":["off","high"]}]`.
   - Command: Run with `--model` changed once per case:
     1. `openai-compatible/stub-1-lar:off`, a partial id: `cli.run.agent.model_inexact`;
     2. `openai-compatible/think-1:medium`: `cli.run.agent.level_unsupported`;
     3. `openai-compatible/nothing:off`: `cli.run.agent.model_unknown`;
     4. `openai-compatible/stub-1:extreme`: `cli.run.agent.option_invalid`, `option: --model`;
     5. `anthropic-subscription/m:off`: `cli.run.agent.option_invalid`, `option: --model`;
     6. `openai-compatible/think-1:high`: exit `0`.
   - Assert: cases 1 to 5 are refused with the stated code, Stub receives no request, and no file exists at S. Case 6 exits `0`, stdout holds `model` `think-1` and `reasoning_effort` `high`, and the request to Stub carries the reasoning effort `high`.

10. **L2-AC10. Each message after the first is one more turn.**
    - Fixture: Auth, Stub, W, H, P, T, S. Stub answers `a-1` to the first request and `a-2` to the second request. Standard input holds the text M6.
    - Command: `printf M6 |` Run with the message `M1` and one more message `M2` after it.
    - Assert: exit `0`. Stub receives two requests. The first request holds one user message, `M1`, and no M6. The second request holds `M1`, `a-1` and `M2`, in order. stdout holds `model_calls` `2` and `text` `a-2`.

### Rules with no check, and the reason

- **Statelessness check 4, resume.** `run agent` has no resume input in this round ([L2-D5](#decisions)).
- **The removal of R after `SIGKILL`.** A kill skips each cleanup by design.
- **The real-credential run.** It needs the credential of Ulrich. [Gate procedure](#gate-procedure-the-real-credential-run) states it with its pass conditions.
- **A request to a cloud provider other than `openai-compatible`.** It needs that endpoint. L2-AC7 shows that each mapped entry passes the entry checks. The gate run covers the provider of Ulrich.
- **The text of `docs/cli/run.md` for the developer.** It is page text, not a behavior. The review of the L6 step checks it.

## Decisions

1. **L2-D1.** The agent CLI is the leaf `run agent <agent-name>` under the new global root `run`. Constraint: `run` joins `TOP_LEVEL_NAMES` and `CommandName`; `docs/cli/run.md` owns the command; `run worker` is reserved for L4.
2. **L2-D2.** The inputs are the options of [Options](#options) and the positional prompt arguments. The profile is the first operand. The model selection is required in the pi form `<provider>/<model>:<level>`, with the level required and no default. Constraint: each field has exactly one source; no JSON input file exists.
3. **L2-D3.** The work prompt takes the pi forms `[@files...] [messages...]`. An `@path` resolves against the workspace and is a UTF-8 text file; the first turn joins the file texts and the first message, and each later message is one more turn. Constraint: no image `@path` this round; no standard input; `--prompt`, `--prompt-file` and `--input` do not exist.
4. **L2-D4.** Extra instructions come only from `--append-system-prompt <path>`, repeatable, path only. Its reader is the evaluation with the repository context of `swe@1`. Constraint: the agent composes the texts at the place of the Repository prompt, layer 2.
5. **L2-D5.** `--session` is required and names a new file. This round has no resume input. Constraint: an existing entry at the path is refused; the path lies in a directory that the current user owns, outside the workspace and the pi directory.
6. **L2-D6.** The `--auth` entry passes a strict `api_key` branch or an `oauth` branch that keeps four fields. The provider check is the match of the entry type with the secret shape of the provider. Constraint: the run refuses each entry that pi refuses and an `api_key` entry with no key.
7. **L2-D7.** The routing metadata comes from the `env` object through the [mapping](#routing-metadata-mapping), the inverse of `METADATA_ENV` plus `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_MODELS`. Constraint: the `env` object holds exactly the names of the provider; the raw `env` never reaches pi.
8. **L2-D8.** The redirected home and the temporary directory of the run lie in a new run directory R in T, which the run removes before exit. Constraint: the process and each child get `HOME=R/home` and `TMPDIR=R/tmp`; P holds only shipped files.
9. **L2-D9.** The default pi directory is the pi directory of the engine. The path ends with the segment `pi`. Constraint: the `auth.json` check runs before the pi tool install; the current user owns the directory.
10. **L2-D10.** The default `--auth` path comes from the user database (`os.userInfo().homedir`). A symbolic link at the `--auth` path is refused. Constraint: no environment variable selects the `--auth` file.
11. **L2-D11.** stdout is one JSON line with the 18 fields of [stdout](#stdout). stderr holds the diagnostics, the rotate warning lines and the failure diagnostic. Constraint: nothing precedes a refusal on stderr; the runtime writes nothing to stdout or stderr.
12. **L2-D12.** The exit codes are `0` completed, `1` refusal, `2` stopped, `4` budget end, `5` failed. Constraint: exit `3` stays the code of a superseded `serve worker`.
13. **L2-D13.** Each code has the form `cli.run.agent.<reason>`, and [Diagnostic codes](#diagnostic-codes) lists each code. Constraint: L4 uses `cli.run.worker.<reason>`.
14. **L2-D14.** `run agent` maps only the wall budget to the agent contract, with the default `2h`. Constraint: the OAuth expiry check uses this wall deadline.
15. **L2-D15.** Two evaluation runs compare only with equal `input_digest`, `engine_version`, `provider`, `model`, `reasoning_effort` and `budget_wall_ms`. Constraint: `input_digest` covers the messages, the `@path` file contents and the appended instruction texts, in order; each run has its own new worktree of the case commit; the session file and `result.json` are the record.
16. **L2-D16.** `run agent` writes no telemetry file and gives the agent contract no trace sink. Constraint: the session file is the record of the run.
17. **L2-D17.** The [run order](#run-order) is fixed. Constraint: steps 1 to 5 create no file; no model request leaves before step 10.
18. **L2-D18.** `run agent` parses the model selection with the exported pi function `resolveCliModel` (Ulrich, 2026-11-22). Constraint: the run refuses a result that differs from the text of `--model` and a level that the model does not support; it never matches fuzzily and never clamps the level. `provider` is a pi provider id, and the entry type of `anthropic` selects `anthropic` or `anthropic-subscription`.

## Open questions for Ulrich

No question is open. Each decision of this page stays inside the CLI of the engine and makes no credential rule weaker.
