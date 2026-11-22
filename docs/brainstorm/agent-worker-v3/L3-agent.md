# L3: The agent

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model and [L2](L2-agent-cli.md) is the public surface that this page satisfies. Each KanthorD path starts at `engine/`. Each pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`), unless the path names another pi package. The code of today is engine `c864130e`. The Workbench code of the branch is `origin/feature/workbench-v2` at `0d901afa`.

## Goals

1. **G1.** Each file of `src/agent/` has one owner: the agent runtime, the server part, or a consumer that the file moves to. The runtime imports no worker, project, mission or scheduler module ([L1-D5](L1-model.md#decisions)).
2. **G2.** One agent contract takes the exact input and gives the exact output of a run. `run agent`, the worker, the Workbench Service and the Project Service open sessions only through it. Each requirement of [L2](L2-agent-cli.md#requirements-on-l3) maps to one contract part and one check.
3. **G3.** The runtime catalog declares the full tool set of each profile by name, consumer tools included. A declared consumer tool with no implementation leaves the model request.
4. **G4.** The profile prompt is the Standard, the shared coding text and the Role. One pure composition function joins the system prompt for every consumer, and its output is the input of `system_prompt_digest`.
5. **G5.** Each profile declares its start preconditions. A failed precondition refuses the start with a stable id and a reason, before any request, file write or workspace change.
6. **G6.** The guards hold for every consumer in one fixed order. The redaction keeps each credential rule at its strength or stricter after the change of R2-H.
7. **G7.** The contract enforces the stop, the forced stop, the wall budget and the list-price budget, and gives the class of a failure from the pi predicates.
8. **G8.** Each pi extension is one module with one factory and its own test file ([L1 Extension rule](L1-model.md#extension-rule)).
9. **G9.** Each public behavior of L3 is an end-to-end acceptance check or a unit-level rule with its owning module and test file ([index](index.md#layer-files)).

## Agent runtime files

(G1)

### File assignment

Change: the runtime and the server part of `src/agent/` separate by file. A file of the runtime imports no file of the server part. The server part can import the runtime.

| File (today)                                        | Owner after L3                           | Responsibility, and the change                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-contract.ts` (new)                           | Runtime                                  | The agent contract: `openAgent`, the input, the run handle and the output ([Input and output contract](#input-and-output-contract))                                                                                                                                                   |
| `agent-session.ts`                                  | Runtime                                  | The pi session open: `sessionParts`, `openSessionRuntime`, `closeRuntime`, `withDeadline`. Change: `sessionParts` builds the guard list of [Guards](#guards). `openSession` stays only for the Workbench Service of `main` and leaves with the [Workbench change](#workbench-service) |
| `catalog.ts`                                        | Runtime                                  | The runtime catalog: the profiles, `AgentTools`, the tool names, `TOOL_CATALOG` and the preconditions. Change: [Profile catalog](#profile-catalog). It imports no worker module and no `contract.ts`                                                                                  |
| `declarations.ts` (new)                             | Server part                              | `AGENT_DECLARATIONS` of the configuration owners, keyed by `AgentName`: `overridable_fields`, `workbench` and the server Role text. It reads the tool set from the runtime catalog                                                                                                    |
| `prompt-chain.ts` (new)                             | Runtime                                  | `composeSystemPrompt`, `profilePrompt` and `systemPromptDigest` ([Profile prompts](#profile-prompts)). They replace the joins `finalPrompt` and `systemPrompt` of `prompt-render.ts`                                                                                                  |
| `prompt-assets.ts`                                  | Runtime                                  | The shipped prompt texts. Change: it adds the shared coding text and the Role files of [Prompt files](#prompt-files). The server part imports the constants that it reads                                                                                                             |
| `start-preconditions.ts` (new)                      | Runtime                                  | The precondition checks of [Start preconditions](#start-preconditions)                                                                                                                                                                                                                |
| `run-budget.ts` (new)                               | Runtime                                  | The wall, list-price and turn limits of [Budget](#budget)                                                                                                                                                                                                                             |
| `run-outcome.ts` (new)                              | Runtime                                  | The end, the class, the failure kind, the totals and the complete reply of [End and class](#end-and-class)                                                                                                                                                                            |
| `redaction.ts` (new)                                | Runtime                                  | The redaction state of one session: the marker table, the matchers, the counts, `text`, `exitText` and `exitValue`. It comes from `sensitiveTextRedaction` less its two factories                                                                                                     |
| `sensitive-text.ts`                                 | Runtime                                  | The rule set, `knownMatcher` and `redactValue`. Unchanged                                                                                                                                                                                                                             |
| `tool-table.ts`                                     | Runtime                                  | The wrapped `bash` and `ToolProcesses`. Change: [Child processes](#child-processes)                                                                                                                                                                                                   |
| `bash-process.ts`                                   | Runtime                                  | The process operations of `bash`. Unchanged                                                                                                                                                                                                                                           |
| `environment.ts`                                    | Runtime                                  | `childEnvironment`. Unchanged                                                                                                                                                                                                                                                         |
| `pi.ts`                                             | Runtime                                  | `loadPi`, the pi directory. Unchanged                                                                                                                                                                                                                                                 |
| `pi-tools.ts`                                       | Runtime                                  | The pi tool install. Change: the code constant moves here from `WorkerErrorCode.StartToolMissing` (`src/worker/contract.ts:1061`). The value `worker.start.tool_missing` stays, because `docs/cli/worker.md:1341` documents it for `serve server` and `serve worker`                  |
| `pinned-layers.ts`                                  | Runtime                                  | The system prompt pin and the work pin. Change: the pin is a text, not a `WorkPrompt`, so the file imports no `prompt-composer.ts`. `countTurns` leaves: the contract events replace it                                                                                               |
| `hooks/*.ts`                                        | Runtime                                  | The extensions of [Extension modules](#extension-modules)                                                                                                                                                                                                                             |
| `hooks/tool-approval.ts`                            | Workbench Service                        | Consumer hook of the Workbench. It moves to `src/workbench/` with the [Workbench change](#workbench-service)                                                                                                                                                                          |
| `agent-port.ts`                                     | Worker layer                             | Change: it leaves `src/agent/` unchanged in L6 part A. [L5](L5-worker.md) rewires it on the contract as the port `agent.open`: `planOf`, `checkoutsRootOf`, `sessionManagerOf`, `SessionTrace`, `SessionBudget`                                                                       |
| `session-directory.ts`, `review-roots.ts`           | Worker layer                             | They compute the session directory and the roots input ([L1 Tool inventory](L1-model.md#tool-inventory)). They move with `agent-port.ts`                                                                                                                                              |
| `capabilities/*.ts`                                 | Worker layer                             | `executionEvidence`, `linkUpdates`, `SessionHostTools`, `asToolError`. They move with `HOST_TOOL_PARAMETERS`, `EVIDENCE_UPLOAD_PARAMETERS` and `LINK_UPDATE_LIST_PARAMETERS` of `catalog.ts` ([L5](L5-worker.md#worker-capabilities))                                                 |
| `hooks/sensitive-text-redaction.ts`                 | Split                                    | The state goes to `redaction.ts`, the factories to four hook modules ([Extension modules](#extension-modules)). `credentialSecrets` and `mergedSecrets` go to `src/llm/known-secrets.ts`, next to `frozenStore`                                                                       |
| `contract.ts`                                       | Server part                              | `AgentName`, the schemas, the operations. It imports `src/scheduler/contract.ts`, so no runtime file imports it                                                                                                                                                                       |
| `prompt-render.ts`                                  | Server part                              | The part reads: `layerOf`, `headingOf`, `promptPart`, `bindingParts`, `framing`. Change: `finalPrompt` and `systemPrompt` leave; the callers call `composeSystemPrompt`                                                                                                               |
| `prompt-composer.ts`                                | Server part                              | `renderWorkPrompt` and `digest`: the turn text from the templates of the server part                                                                                                                                                                                                  |
| `config.ts`, `index.ts`                             | Server part                              | The configuration schema and the exports of `AgentComponent`                                                                                                                                                                                                                          |
| Each other file of `src/agent/`                     | Server part                              | `service.ts`, `configuration.ts`, `enablements.ts`, `cooldowns.ts`, `migrations.ts`, `prompt-resolve.ts`, `prompt-source.ts`, `prompt-files.ts`, `instruction-files.ts`, `prompt-templates.ts`, as L1 assigns                                                                         |
| `test-support.ts`, `sensitive-text-test-support.ts` | The owner of the modules that they serve | Test support. No production module imports them                                                                                                                                                                                                                                       |

### Import rule

Today the runtime imports four modules outside its allowed set:

- `src/worker/contract.ts`: `HostTool` and `LINK_UPDATE_LIMIT_*` in `catalog.ts`, `AgentSetup` and `ExecutionSetup` in `agent-port.ts`, `WorkerErrorCode` in `pi-tools.ts`, `HostTools` in `capabilities/host-tools.ts`.
- `src/tracking/contract.ts`: `SpanStatus` in `agent-port.ts`. That module imports `src/worker/contract.ts` (`src/tracking/contract.ts:25`).
- `src/custody/contract.ts`: `SecretShape` in `hooks/sensitive-text-redaction.ts`, for `credentialSecrets`.
- `src/scheduler/contract.ts`: `ProviderFailure`, through `src/llm/provider-failure.ts:1`.

The rulings:

1. **`SpanStatus`.** It leaves the runtime. The trace belongs to the consumer ([L1 Statelessness](L1-model.md#statelessness), check 4). `SessionTrace` moves with `agent-port.ts` to the worker layer, and the worker sets the span status from the [output](#output).
2. **`SecretShape`.** `credentialSecrets` and `mergedSecrets` read a pi `CredentialStore` that the consumer holds. They move to `src/llm/known-secrets.ts`. The runtime takes `KnownSecrets` as input and imports no custody module.
3. **`ProviderFailure`.** It moves to `src/llm/provider-failure.ts`, next to `providerFailureOf` ([L2 handoff to L6](L2-agent-cli.md#handoffs-to-later-layers)). `src/scheduler/contract.ts` imports it from there.
4. **The worker contract.** Each import leaves with the moves of the [file assignment](#file-assignment). The catalog owns the names of the worker tools, and `HostTool` of `src/worker/contract.ts` takes its values from the catalog.

Change: the import check of [L1-D5](L1-model.md#decisions) uses an allowed set. The import closure of each runtime module, type imports included, holds only these modules:

- the built-in modules of Node;
- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` and `zod`;
- the modules of `src/kernel/`, because no kernel module imports a module of a service today;
- `src/llm/provider-failure.ts`;
- the runtime modules of `src/agent/`;
- after the merge of `feature/workbench-v2`: `@anthropic-ai/sandbox-runtime`, for `bash-sandbox.ts`.

The check also refuses each reference to `setGlobalDispatcher` and `EnvHttpProxyAgent` in a runtime module ([L2 requirement 9](L2-agent-cli.md#requirements-on-l3)). pi does not export `configureHttpDispatcher` from `dist/index.d.ts`, so no runtime module can call it.

## Input and output contract

(G2)

### Input

```ts
export interface AgentInput {
  profile: ProfileName;
  model: ModelSelection;
  systemPrompt: SystemPromptInput;
  workspace: Workspace;
  budget: RunBudget;
  session: SessionRecord;
  knownSecrets: KnownSecrets;
  childEnvironment: Readonly<Record<string, string>>;
  hostHome: string;
  consumerTools: readonly ToolDefinition[];
  extensions: readonly InlineExtension[];
  signal: AbortSignal;
  observe: (event: AgentEvent) => void;
}

export interface ModelSelection {
  runtime: ModelRuntime;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
}

export type SystemPromptInput =
  | { kind: "composed"; text: string }
  | { kind: "context"; texts: readonly string[] };

export interface Workspace {
  cwd: string;
  roots: readonly string[];
  confine: boolean;
}

export interface RunBudget {
  deadline: number | null;
  usd: number | null;
  turns: number | null;
}

export type SessionRecord =
  | { kind: "new_file"; path: string }
  | { kind: "directory"; directory: string; id: string | null }
  | { kind: "resume"; path: string }
  | { kind: "memory" };

export type KnownSecrets = () => Promise<readonly string[]>;
```

Each field and its reader:

| Field               | Rule                                                                                                                                                                                                                                                                                                                                                  | Reader                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `profile`           | A name of the runtime catalog. The contract asserts it                                                                                                                                                                                                                                                                                                | Each consumer                                        |
| `model`             | The model runtime holds the credential store ([L1 LLM credential](L1-model.md#llm-credential)). `thinkingLevel` must be in `getSupportedThinkingLevels(model)` (`@earendil-works/pi-ai`, `dist/models.d.ts:262`). Else the open throws. The contract never clamps. pi clamps the level (`dist/core/sdk.js:143`), and a supported level stays the same | Each consumer                                        |
| `systemPrompt`      | `composed`: the text of the composition function, whole; the agent adds no text ([L1 boundary rule 3](L1-model.md#agentworker-boundary)). `context`: the context texts in order; the contract composes the shipped profile prompt with them ([Profile prompts](#profile-prompts))                                                                     | Server consumers: `composed`. `run agent`: `context` |
| `workspace.cwd`     | An absolute path. The working directory of the session and the `cwd` of the session header                                                                                                                                                                                                                                                            | Each consumer                                        |
| `workspace.roots`   | Absolute paths, not empty. The directories of the start preconditions and of the confinement                                                                                                                                                                                                                                                          | Each consumer                                        |
| `workspace.confine` | `true` adds the confinement to a profile that does not set it. A consumer can never remove the confinement of a profile ([L3-D18](#decisions))                                                                                                                                                                                                        | Workbench Service after the merge                    |
| `budget`            | `deadline` is an epoch time in milliseconds. Each `null` is no limit ([Budget](#budget))                                                                                                                                                                                                                                                              | Each consumer                                        |
| `session`           | [Session record](#session-record)                                                                                                                                                                                                                                                                                                                     | Each consumer                                        |
| `knownSecrets`      | The source of the known secrets. The contract reads it at the open and at each turn start                                                                                                                                                                                                                                                             | Each consumer                                        |
| `childEnvironment`  | The only names of a child process, less the names that `childEnvironment` removes, plus the pi `PATH` ([Child processes](#child-processes))                                                                                                                                                                                                           | Each consumer                                        |
| `hostHome`          | The base of the `<cwd>` section that `homeRelativeCwd` writes                                                                                                                                                                                                                                                                                         | Each consumer                                        |
| `consumerTools`     | The pi tool definitions of declared consumer tools. A name outside the declared consumer tools of the profile throws `agent.tool_undeclared` at the open ([L3-D6](#decisions))                                                                                                                                                                        | Workbench Service, Project Service                   |
| `extensions`        | The consumer extensions: worker capabilities and consumer hooks, in consumer order                                                                                                                                                                                                                                                                    | Worker, Workbench Service                            |
| `signal`            | The stop signal. An abort starts the graceful stop ([Stop and forced stop](#stop-and-forced-stop))                                                                                                                                                                                                                                                    | Each consumer                                        |
| `observe`           | The event sink ([Events](#events))                                                                                                                                                                                                                                                                                                                    | Worker, Workbench Service                            |

The input names no execution, no claim, no node and no server address ([L1 boundary rule 1](L1-model.md#agentworker-boundary)). Change: today `SessionOpenRequest` carries `claim.execution_id` and `setup.agents` (`src/agent/agent-port.ts`).

After the merge of `feature/workbench-v2`, the input gains `bashSandbox: SandboxScope | null` for the Workbench ([Workbench Service](#workbench-service)). It has no reader before the merge, so it does not exist before the merge.

### Session record

| Kind        | pi call                                                                                                                                                                 | Rule                                                                                                                                                                   | Consumer                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `new_file`  | `SessionManager.open(path, dirname(path), cwd)`: with no file at the path, pi starts a new session and keeps the explicit path (`dist/core/session-manager.js:685-689`) | The contract asserts that `lstat` finds no entry at the path. pi creates the file at the first conversation entry with `openSync(path, "wx")` (`_persist`, `:794-814`) | `run agent`                   |
| `directory` | `SessionManager.create(cwd, directory, { id })`                                                                                                                         | pi names the file in the directory. Today `sessionManagerOf` does this (`src/agent/agent-port.ts:137`)                                                                 | Worker; Workbench new session |
| `resume`    | `SessionManager.open(path, dirname(path))`                                                                                                                              | The session file exists. The start preconditions skip `git_clean` ([Start preconditions](#start-preconditions))                                                        | Workbench resume              |
| `memory`    | `SessionManager.inMemory(cwd)`                                                                                                                                          | No file. The consumer reads no record of the session                                                                                                                   | Project Service               |

### Open order

`openAgent(input): Promise<AgentOpen>` does these steps in order:

1. Find the profile in the runtime catalog. Check the names of `consumerTools` against the declared consumer tools. Check `thinkingLevel`. A failed check throws: it is a defect of the consumer.
2. Check the [start preconditions](#start-preconditions) of the profile. A failure returns `{ kind: "refused" }` and does nothing else.
3. Compose the system prompt, or take the composed text. Compute `systemPromptDigest`.
4. Read the known secrets once.
5. Load pi. Build the session manager of the [session record](#session-record), the wrapped `bash`, the guard list and the pi session through `openSessionRuntime`. The pi option `tools` holds the declared names of the session ([Coding tools](#coding-tools)). The option `customTools` holds the wrapped `bash` and `consumerTools`.
6. Pin the system prompt (`pinInference`). Start the budget timer and the stop listener. Bind an error listener on the extension runner.
7. Return `{ kind: "opened", run }`.

Steps 1 and 2 write no file and send no request. Steps 3 to 6 send no provider request: the open makes no model call, and `bindExtensions` emits only `session_start` ([L2 requirement 13](L2-agent-cli.md#requirements-on-l3)). pi writes the session file only at the first conversation entry, so a refused or failed open leaves no session file.

### Run handle

```ts
export type AgentOpen =
  | { kind: "refused"; refusal: StartRefusal }
  | { kind: "opened"; run: AgentRun };

export interface StartRefusal {
  precondition: StartPrecondition;
  reason: string;
}

export interface AgentRun {
  readonly systemPromptDigest: string;
  send(text: string, options?: { pin?: string }): Promise<TurnEnd>;
  appendCustom(customType: string, data: unknown): void;
  forceStop(): TurnEnd;
  redactionSummary(): RedactionSummary;
  close(): Promise<void>;
}
```

- `send` passes `text` through the input redaction, then calls `session.prompt(text, { expandPromptTemplates: false })` and waits for the end of the agent loop. `pin` sets the work pin of the pinned layers. One `send` runs at a time; a second call during a `send` throws.
- `appendCustom` writes one pi custom entry (`appendCustomEntry`) after the input redaction of each string of `data`. The worker writes `kanthord.pinned_context` (`src/worker/unit/native-agent.ts`). The Workbench writes its records on the branch (`appendRecord`).
- `forceStop` returns at once ([Stop and forced stop](#stop-and-forced-stop)).
- `redactionSummary` gives the counts of [Redaction counts](#redaction-counts). The worker telemetry, the Workbench log and the Project Service log read it.
- `close` aborts the session, disposes the runtime through `closeRuntime` and kills each child process that is still alive. A second call does nothing.

### Output

```ts
export interface TurnEnd {
  end: "completed" | "budget_end" | "stopped" | "failed";
  budgetReached: "wall" | "usd" | "turns" | null;
  failure: RunFailure | null;
  complete: boolean;
  text: string | null;
  totals: RunTotals;
  warnings: readonly SecretWarning[];
}

export interface RunFailure {
  kind: ProviderFailure | "internal";
  class: "retryable" | "terminal";
  reason: string;
}

export interface RunTotals {
  modelCalls: number;
  toolCalls: number;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  listPriceUsd: number;
}

export interface SecretWarning {
  rule: SensitiveRule;
  count: number;
}
```

| Field           | Value                                                                                                                                                                      | Reader                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `end`           | [End and class](#end-and-class)                                                                                                                                            | Each consumer                                 |
| `budgetReached` | The first limit that ended the run, for `budget_end`; else `null`                                                                                                          | `run agent` (`wall`, `usd`); worker (`turns`) |
| `failure`       | For `failed` only. `reason` is the error text after `exitText`                                                                                                             | Each consumer                                 |
| `complete`      | The last assistant message has the stop reason `stop`, holds text that is not blank and holds no tool call. Today `isCompleteReply` (`src/worker/unit/native-agent.ts:94`) | Worker                                        |
| `text`          | `getLastAssistantText()` after `exitText`, or `null` with no assistant text                                                                                                | `run agent`, worker                           |
| `totals`        | The totals since the open: the assistant messages, the tool call blocks of the assistant messages, the token sums and the sum of `usage.cost.total`                        | `run agent`, worker telemetry                 |
| `warnings`      | The rotate warnings since the last `send` returned, in order ([Rotate warning](#rotate-warning))                                                                           | `run agent`, worker telemetry                 |

### Events

```ts
export type AgentEvent =
  | { type: "session"; event: AgentSessionEvent }
  | { type: "entry"; entry: SessionEntry };
```

- `session`: each pi session event, after `exitValue` on a deep copy. The worker telemetry and the Workbench views read it.
- `entry`: each new pi session entry, in append order, after `exitValue` on a deep copy. The contract reads the new entries of the session manager at each `message_end` and `turn_end`. The worker sends them to the server ([L5](L5-worker.md)).
- No consumer gets the `AgentSession`, the session manager or a raw message. Change: today `PortSession` gives `session` to the worker (`src/agent/agent-port.ts`), and the Workbench and the Project Service hold the `AgentSession`.

### Requirement map

Each requirement of [L2](L2-agent-cli.md#requirements-on-l3) and the contract part that meets it. L3 meets each requirement.

| L2 requirement                     | Contract part                                                                                                                                                                                                              | Check                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1. Input                           | `AgentInput`: `systemPrompt.kind` `context`, `workspace` `{ cwd: W, roots: [W], confine: false }`, `session.kind` `new_file`, no `consumerTools`, no `extensions`; the message goes to `send`. No clamp of `thinkingLevel` | L2-AC1, L2-AC13, L3-U7 |
| 2. Catalog                         | `getProfile` and `PROFILE_NAMES` of `catalog.ts`; `bee@1`, `fee@1`, `te@1` are profiles                                                                                                                                    | L2-AC8, L3-U2          |
| 3. Declared consumer tools         | The pi option `tools` holds the declared names; pi declares only a registered tool ([A declared consumer tool with no implementation](#a-declared-consumer-tool-with-no-implementation))                                   | L2-AC1, L3-AC3         |
| 4. Start refusal                   | `AgentOpen` `refused` with `StartRefusal`, at step 2 of the [open order](#open-order)                                                                                                                                      | L2-AC12, L3-AC5, L3-U4 |
| 5. Session file                    | `SessionRecord` `new_file`; header `cwd` is `workspace.cwd`                                                                                                                                                                | L2-AC1, L2-AC3         |
| 6. Output                          | `TurnEnd`, `systemPromptDigest`                                                                                                                                                                                            | L2-AC1, L2-AC10, L3-U5 |
| 7. Exit redaction                  | `exitText` on `text` and `failure.reason`; `exitValue` on each event                                                                                                                                                       | L2-AC4, L1 U3          |
| 8. Silence                         | No runtime module writes to `process.stdout` or `process.stderr`; the extension errors go to the error listener                                                                                                            | L3-U7                  |
| 9. No proxy from the environment   | The [import rule](#import-rule) refuses `setGlobalDispatcher` and `EnvHttpProxyAgent`                                                                                                                                      | L2-AC2, L1 U15         |
| 10. pi directory and resources     | `sessionParts`: `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`, `SettingsManager.inMemory`, the model runtime as service                                                                    | L2-AC2, L2-AC7         |
| 11. Budget                         | `RunBudget.deadline`, `RunBudget.usd`; `budgetReached`                                                                                                                                                                     | L2-AC10, L3-U6         |
| 12. Place of the context texts     | `composeSystemPrompt` places the context texts after the profile prompt ([Prompt chain](#prompt-chain))                                                                                                                    | L2-AC8, L3-AC2, L3-U1  |
| 13. No request at the open         | [Open order](#open-order)                                                                                                                                                                                                  | L2-AC12, L3-U7         |
| 14. Child processes                | `killGroupAtEnd` on each command; `ToolProcesses.killAll` at the end of `send` and at `close`                                                                                                                              | L2-AC11, L3-U11        |
| 15. Child environment              | [Child processes](#child-processes)                                                                                                                                                                                        | L2-AC2, L3-U11         |
| 16. Error text of a failed request | `inputRedaction` redacts the `errorMessage` of an `assistant` message ([Redaction](#redaction))                                                                                                                            | L3-AC1, L2-AC10        |
| 17. Abort                          | `signal` ([Stop and forced stop](#stop-and-forced-stop))                                                                                                                                                                   | L2-AC11, L3-U7         |
| 18. Forced stop                    | `forceStop()`                                                                                                                                                                                                              | L3-U7; L2 unit rule 11 |

## Profile catalog

(G3)

### Coding tools

Change: the runtime catalog lists every profile that opens an agent session. `AGENT_NAMES` of the server part keeps only the configuration owners ([L1 C6](L1-model.md#e1-constraints)). Today `AGENT_DECLARATIONS` holds `swe@1`, `re@1` and `env@1` (`src/agent/catalog.ts`).

The full tool set of each profile:

| Profile                          | Agent tools                                           | Declared consumer tools                                                                                                                                                   | Confined | Start preconditions                                | Profile prompt                         |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- | -------------------------------------- |
| `swe@1`                          | `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash` | `host`: `evidence-upload`, `link_update_list`. After the merge: `operation`: the six node review reads; `workbench`: `evidence_read`, `offer_action`, `request_owner_act` | No       | `workspace_directory`, `git_worktree`, `git_clean` | Standard, coding text, `role/swe@1.md` |
| `bee@1`                          | the seven tools of `swe@1`                            | none                                                                                                                                                                      | No       | as `swe@1`                                         | Standard, coding text, `role/bee@1.md` |
| `fee@1`                          | the seven tools of `swe@1`                            | none                                                                                                                                                                      | No       | as `swe@1`                                         | Standard, coding text, `role/fee@1.md` |
| `te@1`                           | the seven tools of `swe@1`                            | none                                                                                                                                                                      | No       | as `swe@1`                                         | Standard, coding text, `role/te@1.md`  |
| `re@1`                           | `read`, `grep`, `find`, `ls`                          | After the merge: `operation`: the six node review reads; `workbench`: `evidence_read`, `offer_action`, `request_owner_act`                                                | Yes      | `workspace_directory`                              | Standard, coding text, `role/re@1.md`  |
| `env@1` (`pe@1` after the merge) | `read`, `grep`, `find`, `ls`                          | `environment`: `probe`, `environment_write`                                                                                                                               | Yes      | `workspace_directory`                              | Standard, `env@1.md`                   |
| `ops@1` (after the merge)        | none                                                  | `operation`: the 36 operations of `OPS_OPERATIONS`; `workbench`: `offer_action`, `request_owner_act`                                                                      | No       | `workspace_directory`                              | Standard, `ops@1.md`                   |
| `plan@1` (after the merge)       | none                                                  | `operation`: the 8 operations of `PLAN_OPERATIONS`; `workbench`: `offer_action`, `request_owner_act`                                                                      | No       | `workspace_directory`                              | Standard, `plan@1.md`                  |

- The six node review reads are `NODE_REVIEW_READS` of the branch: `mission.node.get`, `mission.attempt.list`, `mission.outcome.list`, `mission.assessment.list`, `mission.evidence.list`, `mission.evidence.get` (`git show origin/feature/workbench-v2:src/agent/catalog.ts`).
- The role profiles hold the seven agent tools of today and no other tool ([L1 E1, fit rule 8](L1-model.md#e1-role-profiles-bee1-fee1-te1-fits-with-a-fit-rule)). They declare no consumer tool, because no consumer gives a tool to a role profile this round ([L1-D4](L1-model.md#decisions)).
- `re@1` and `env@1` are confined. Change: confinement is the property `confined` of the profile. Today `CONFINED_AGENTS` holds only `re@1` (`src/agent/catalog.ts`), and the Project Service adds the confinement to `env@1` itself (`src/project/environment-agent.ts:306`).
- `guard@1` of the branch is no profile. The Workbench calls `runtime.complete` for it and opens no agent session (`git show origin/feature/workbench-v2:src/workbench/guard-classifier.ts`). It stays a declaration of the server part. The fork summary of the branch is a direct completion too.
- `offer_action` and `request_owner_act` are tools of the Workbench on the branch (`WORKBENCH_ACTION_TOOL_NAME` in `src/workbench/actions.ts:32`, `WORKBENCH_REQUEST_OWNER_ACT_TOOL` in `src/workbench/contract.ts:39`). Change: the `workbench` field of the branch lists only `evidence_read`. The Workbench change adds the two names, so the allowlist passes them.

### Consumer tool declaration

The catalog takes the field shape `AgentTools` of the branch (`git show origin/feature/workbench-v2:src/agent/catalog.ts`). The runtime catalog of `main` holds only the fields that have a reader:

```ts
export interface AgentTools {
  builtin: readonly BuiltinTool[];
  host: readonly WorkerTool[];
  environment: readonly EnvironmentTool[];
}

export interface Profile {
  name: ProfileName;
  tools: AgentTools;
  confined: boolean;
  preconditions: readonly StartPrecondition[];
  prompt: ProfilePromptFiles;
}
```

- `builtin` holds the agent tools. `host` holds the worker tools, read by the worker. `environment` holds the consumer tools of the Project Service. Change: today `EnvironmentTool` exists in `catalog.ts`, but `env@1` declares neither tool.
- The merge adds `operation: readonly string[]` and `workbench: readonly WorkbenchTool[]`, with their reader, the Workbench Service.
- The declared names of a session are the agent tools of the profile plus each consumer tool name of every field.
- `WorkerTool` holds `evidence-upload` and `link_update_list`. Their parameter schemas move to the worker layer with the capabilities.
- `TOOL_CATALOG` keeps one location list for each declared tool, also an empty list ([L1 tool ownership rule 7](L1-model.md#tool-ownership-rule)). After the merge it gains each operation and Workbench tool name with an empty list.

### A declared consumer tool with no implementation

- The contract passes the declared names of the session in the pi option `tools`. pi declares a tool to the model only when the tool is registered (`_applyToolLoadout` in `dist/core/agent-session.js:1155-1159`). A declared name with no implementation is thus absent from the model request, and the session opens and runs ([L2 requirement 3](L2-agent-cli.md#requirements-on-l3)).
- A model call of such a name gets the pi result `Tool <name> not found` (`@earendil-works/pi-agent-core`, `dist/agent-loop.js:481-488`). Example: `run agent swe@1` gives no implementation of `evidence-upload` and `link_update_list`.
- pi also never registers a tool outside the option `tools`, also a tool of `customTools` or of an extension (`_refreshToolRegistry`, `dist/core/agent-session.js:2808-2821`; `_isAllowedTool`, `:1118-1124`). The allowlist guard blocks each other name that reaches `tool_call`, for example an MCP tool that pi keeps registered.
- Change: a name of `consumerTools` outside the declared consumer tools throws `agent.tool_undeclared` at the open. Reason: pi drops it in silence, and the consumer then believes that the model has the tool.

## Profile prompts

(G4)

### Prompt chain

The KanthorD prompt chain of a session, in this order:

1. **Profile prompt.** The Standard (`base.md`), the shared coding text (coding profiles only), the Role.
2. **Repository prompt place, layer 2.** The instruction file and the stored Repository prompt of each repository; for `run agent`, the context texts in input order.
3. **Binding prompt place, layer 3.** The Binding prompt of each repository.
4. **Consumer texts.** The framing of the consumer (worker or Workbench).

The precedence of [agent.md](../agent.md#prompt-composer) stays. `run agent` has no layer 3 text and no framing: the [evaluation](L2-agent-cli.md#one-evaluation-run) gives the stored Repository prompt and the Binding prompt of `swe@1` as two context texts, in the order of the worker path. The Workbench part `workbench.md` stays in layer 1 after the Role, as today (`promptFiles` in `src/agent/prompt-files.ts`). After the merge, the parts `identity` and `variant` of the branch stay where the server part places them in layer 1.

### Composition function

```ts
export interface PromptText {
  heading: string | null;
  text: string;
}

export function composeSystemPrompt(
  profile: readonly PromptText[],
  instructions: readonly PromptText[],
): string;

export function profilePrompt(name: ProfileName): readonly PromptText[];

export function systemPromptDigest(composed: string): string;
```

- `composeSystemPrompt` is pure. It renders each part as `heading + "\n\n" + text` when the part has a heading, else as `text`. It joins the profile parts, then the instruction parts, with `"\n\n"`. It changes no text. It asserts that the profile list is not empty and that each text is not empty.
- This is the join of today: `partText` and the join of `finalPrompt` and `systemPrompt` (`src/agent/prompt-render.ts`). Change: the server part calls `composeSystemPrompt` in place of `finalPrompt` and `systemPrompt`. The framing text is the last instruction part. The composed text of a worker execution, a Workbench session and an `env@1` session stays byte-equal ([L1 E1, fit rule 9](L1-model.md#e1-role-profiles-bee1-fee1-te1-fits-with-a-fit-rule)).
- `profilePrompt` gives the shipped parts of a profile, each with no heading. `run agent` calls `composeSystemPrompt(profilePrompt(profile), contextTexts)`, each context text with no heading ([L2 Prompt](L2-agent-cli.md#prompt), rule 3).
- `systemPromptDigest` is the SHA-256 hex digest of the output of `composeSystemPrompt`, before the input redaction and before pi adds `<cwd>` (`dist/core/system-prompt.js:110`). Reason: the marker of a redacted value holds a random tag per session (`sensitiveTextRedaction`, `tag`), so a digest after the redaction differs between two runs with the same input.
- With `systemPrompt.kind` `composed`, the digest is the digest of the given text.

### Prompt files

The shared coding text is the three sections `## Code principles`, `## Code` and `## Tests`. Today `swe@1.md` and `re@1.md` hold these three sections byte-equal (`static/prompt/swe@1.md`, `static/prompt/re@1.md`).

| File (new)                    | Content                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `static/prompt/coding.md`     | The sections `## Code principles`, `## Code` and `## Tests` of `swe@1.md`, byte-equal                           |
| `static/prompt/role/swe@1.md` | `## Role` of `swe@1.md`; `## Execution` of `swe@1.md` less the protocol text; `## Findings` of `swe@1.md`       |
| `static/prompt/role/re@1.md`  | `## Role` of `re@1.md`; `## Judgement` items 1 to 7 of `re@1.md`                                                |
| `static/prompt/role/bee@1.md` | The role statement below; `## Execution` and `## Findings` of `role/swe@1.md`, byte-equal                       |
| `static/prompt/role/fee@1.md` | The role statement below; `## Execution` of `role/swe@1.md` plus item 6 below; `## Findings` of `role/swe@1.md` |
| `static/prompt/role/te@1.md`  | The role statement below; `## Execution` and `## Findings` of `role/swe@1.md`, byte-equal                       |

The protocol text that leaves `## Execution` ([L1 boundary rule 7](L1-model.md#agentworker-boundary), [L1-D12](L1-model.md#decisions)):

- Item 4 loses the sentence "The worker runs the verifications after the turn."
- Item 5 loses the sentence "The worker merges the base branch itself." Its first sentence names the node branch, so it becomes: "**Merge no branch.** Merge, rebase or cherry-pick no other branch into the branch of the workspace."
- In `re@1.md`, item 8 of `## Judgement` and the section `## Findings` leave.

The role statements, exact text:

```markdown
## Role

Your role is `bee@1`, the backend engineer that performs the steps of a task.
Your responsibility is the change that the task describes, in the workspace, to the default standard.
Write the code, and run any check while you work.
Before you end a turn, check the work against the criterion of the task and the default standard.
```

```markdown
## Role

Your role is `fee@1`, the frontend engineer that performs the steps of a task.
Your responsibility is the change that the task describes, in the workspace, to the default standard.
Write the code, and run any check while you work.
Before you end a turn, check the work against the criterion of the task and the default standard.
```

```markdown
## Role

Your role is `te@1`, the test engineer that performs the steps of a task.
Your responsibility is the tests that the task describes, in the workspace, to the default standard.
Write the tests, and run them while you work.
Before you end a turn, check the work against the criterion of the task and the default standard.
```

Item 6 of `## Execution` of `fee@1`, exact text. It traces to the dogfood finding "The tasks of the `apps` repository did not follow the UI" ([L1 E1](L1-model.md#e1-role-profiles-bee1-fee1-te1-fits-with-a-fit-rule)):

```markdown
6. **Follow the existing interface.** Before you change a user interface, read the components, the styles and the design tokens that the change touches. Build the change from them. When the task names a design, match it, and state each difference from it in your reply.
```

- `bee@1` and `te@1` hold no method rule of their own, because no dogfood finding and no evaluation result supports one ([L1-D16](L1-model.md#decisions)). Each differs from `swe@1` only in the role statement. The evaluation of [L1-D20](L1-model.md#decisions) then measures the role statement and, for `fee@1`, item 6.
- No Role holds a convention of one repository ([L1 C4](L1-model.md#e1-constraints)).
- The worker path keeps `swe@1.md` and `re@1.md` of today in layer 1. Layer 2 of E1 moves the worker path to the chain: it adds the part `coding` to `PromptPart`, points the server Role at `role/<name>.md` and deletes the old files ([L5](L5-worker.md#worker-instructions)). Until then the text exists twice, and [L3-U3](#unit-level-rules) fails on a difference.
- The build adds each new file of `static/prompt/` to the shipped assets (`shippedAsset` in `src/kernel/assets.ts`).

## Start preconditions

(G5)

```ts
export const StartPrecondition = {
  WorkspaceDirectory: "workspace_directory",
  GitWorktree: "git_worktree",
  GitClean: "git_clean",
} as const;
```

| Id                    | Pass condition                                                                                                                 | Reason text                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `workspace_directory` | `workspace.cwd` and each root are absolute paths of directories that exist (`stat`)                                            | `the working directory or a root is no directory` |
| `git_worktree`        | For each root, `git -C <root> rev-parse --is-inside-work-tree` exits `0` and prints `true`                                     | `a root is not inside a git worktree`             |
| `git_clean`           | For each root, `git -C <root> --no-optional-locks status --porcelain=v1 --untracked-files=normal` exits `0` and prints nothing | `a root holds an uncommitted change`              |

- The checks run in the order of the profile list, root by root. The first failure gives the refusal. `StartRefusal.reason` is `<id>: <reason text>`. `run agent` writes it in the `reason` row of `cli.run.agent.start_refused` ([L2 Run order](L2-agent-cli.md#run-order), step 9). The reason holds no path.
- An ignored file is no uncommitted change. An untracked file that no ignore rule covers is an uncommitted change.
- Each `git` command runs with `isolatedGitEnvironment(process.env)` (`src/kernel/git-environment.ts`): no global or system configuration, `core.fsmonitor=false`, `core.hooksPath=/dev/null`. Reason: a repository configuration then runs no command of the repository at the check. `--no-optional-locks` stops the refresh write of the index, so the check changes no file of the workspace ([L1 AC10](L1-model.md#checks)).
- Each command has the deadline `RUNTIME_SETUP_DEADLINE_MS` (`src/agent/agent-session.ts`). A timeout fails the precondition of that command.
- **Resume.** With `session.kind` `resume`, the contract checks each precondition except `git_clean`. Reason: at a resume, the uncommitted change is the work of the same session, and the session file records it.
- **Every consumer.** The list holds for every consumer ([L1 handoff](L1-model.md#handoffs-to-later-layers)). The worker gives roots that pass: the checkouts of a node, each a git worktree with no uncommitted change. [L5](L5-worker.md) states the roots of each chain.
- **Read-only profiles.** `re@1` and `env@1` declare only `workspace_directory`. They change no file, so a change in their workspace cannot mix with their work.
- Change: today `openSession` checks no precondition (`src/agent/agent-session.ts`).

## Guards

(G6)

### Guard order

`sessionParts` builds the extension list of every session in this order. pi runs the handlers of one event in extension order, and the first `block` of `tool_call` wins (`emitToolCall`, `dist/core/extensions/runner.js:957-972`).

1. `homeRelativeCwd(hostHome)`: the `<cwd>` section.
2. `toolAllowlist(declaredNames)`: blocks each tool name outside the declared names of the session.
3. `markerRestore(state)`: restores a marker of this session into `write` and `edit`, blocks the other markers, and blocks a known secret in each tool input ([Known secret in a tool input](#known-secret-in-a-tool-input)).
4. `checkoutConfinement({ cwd, roots })`, when the profile is confined or `workspace.confine` is `true`. It checks the input after the restore and freezes it.
5. `pinnedLayersHook`: the work pin.
6. The consumer extensions, in input order: worker capabilities and consumer hooks, for example `toolApproval`.
7. `inputRedaction(state)`: the input redaction at `message_end` and `context`. It runs last, so it redacts the final message after each consumer handler.
8. `outputFinding(state, record)`: the rotate warning at `message_end` of an `assistant` message.

- No consumer can remove or reorder a guard: the consumer gives only item 6 ([L1-D8](L1-model.md#decisions)).
- Change: today the order is `homeRelativeCwd`, `restore`, the hooks of the consumer, `hook` (`src/agent/agent-session.ts:123-128`), and only `agentPort` adds `toolAllowlist` and the confinement (`guardsOf`, `src/agent/agent-port.ts:119`). The restore moves after the allowlist, so the restore acts only on a declared tool. The confinement stays after the restore.
- Each guard handler catches its own error and fails closed: the allowlist and the restore block, the confinement blocks, the input redaction writes the failure marker. pi catches a handler error, emits it and keeps the message (`emitMessageEnd`, `dist/core/extensions/runner.js:864-899`). The error listener of the contract then ends the run with the end `failed` and the failure `internal`.

### Allowlist block text

The block text of `toolAllowlist` is fixed once, as today (`src/agent/hooks/tool-allowlist.ts`):

```text
The tool <name> is not declared for this agent.
```

`<name>` is the tool name of the call. [L1 U6](L1-model.md#unit-level-rules) compares with this text.

### Confinement roots

- The roots input is `workspace.roots`, and the base of a relative path is `workspace.cwd`.
- `run agent`: `cwd` and the one root are the workspace ([L2 Options](L2-agent-cli.md#options)).
- Worker: [L5](L5-worker.md) gives the roots. Today `planOf` gives the review directory and its evidence placement (`reviewRootsOf`, `src/agent/review-roots.ts`).
- Project Service: the checkout is `cwd` and the one root, as today (`src/project/environment-agent.ts:306`).
- Workbench after the merge: `place.cwd` is `cwd` and the one root, with `confine: true` ([Workbench Service](#workbench-service)).

## Redaction

(G6)

### Build change of the session file

This is the build change of [L1 Session file](L1-model.md#session-file).

- **Removed.** The redaction of the `assistant` message with rule 0 at `message_end`; `keepThinking` and the count `thinking_kept`; the redaction of the compaction summary at `context` and at `session_compact`, and the count `compaction_residual` (`src/agent/hooks/sensitive-text-redaction.ts:105-111`, `:368-388`, `:548-590`).
- **Kept.** The input redaction of each `system`, `user`, `toolResult` and `custom` message at `message_end`, and of each `custom` message at `context`. The redaction of the system prompt before pi gets it (`text`, `src/agent/agent-session.ts`). The restore of `write` and `edit` arguments. `modelOutput`, now `exitText`.
- **Error text.** `inputRedaction` redacts the `errorMessage` field of an `assistant` message at `message_end`, and no other field of that message. pi replaces the message in place, so the agent state, the events and the session file get the redacted copy (`_replaceMessageInPlace`, `dist/core/agent-session.js:864-877`).
- **Custom entries.** `appendCustom` redacts each string of `data` with `text` before pi writes the entry. So each entry kind that a consumer writes is input-redacted.

### Known secret in a tool input

- Today the assistant redaction replaces a known secret in the tool call arguments with a marker. pi replaces the message in place, so the tool runs with the marker, and the restore blocks a credential marker in every tool (`RestoreReason.Credential`; AH-Q3 in [HANDOFF.md](../HANDOFF.md#agent-component): "A rule 0 value blocks in every tool").
- R2-H keeps the arguments as the model gave them. Without a new rule, a `bash` call with the raw key then runs, for example `curl` with the key. That makes AH-Q3 weaker.
- Change: `markerRestore` also blocks a call when a string of its input holds a known secret, in every tool. The block reason is new:

  ```text
  The input holds a value of a known credential. No tool receives this value.
  ```

- The block changes no recorded response: the assistant entry keeps the arguments. It counts as `restore_blocked`. The finding of the same value counts once, in [Rotate warning](#rotate-warning).

### Rotate warning

- `outputFinding` scans each string of the `content` of an `assistant` message at `message_end` with the known-secret matcher: text, thinking, the thinking signature and the tool call arguments. It does not scan `errorMessage`.
- One `assistant` message with one or more findings gives one `SecretWarning`: `rule` is `llm_credential`, the rule of each known secret (`SensitiveRule.LlmCredential`, `src/agent/sensitive-text.ts`), and `count` is the number of findings in that message.
- The warning refuses nothing and changes no message. It holds no value, no marker index, no tag, no length and no digest of a value.
- The contract puts each warning in `TurnEnd.warnings`. `run agent` writes it as the line `cli.run.agent.secret_exposed` with this `rule` and `count` ([L2 stderr](L2-agent-cli.md#stderr), item 2). The worker records it as a telemetry finding ([L5](L5-worker.md)).

### Exit redaction

The contract applies the exit redaction at its output, so no consumer can omit it ([L1 Session file](L1-model.md#session-file), "Exit redaction").

| Output                              | Function    | Form                                                                                                                                                                  |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TurnEnd.text`, `RunFailure.reason` | `exitText`  | The session marker `<redacted:RULE:N:TAG>` of the pattern rules and the known secrets. Today `modelOutput` (`src/agent/hooks/sensitive-text-redaction.ts`)            |
| Each `session` and `entry` event    | `exitValue` | `redactValue` of a deep copy with the known matcher of the session. Today `sessionEntryRecord` does this in the worker (`src/worker/unit/session-entries.ts:122-137`) |

Change: the Workbench Service and the Project Service get the exit redaction at the contract. Today they read the session events and `session.state.errorMessage` with no exit redaction (`src/workbench/service.ts`, `agent.subscribe`; `src/project/environment-agent.ts:331`).

### Redaction counts

```ts
export interface RedactionCounts {
  redacted: Partial<Record<SensitiveRule, number>>;
  scan_failed: number;
  unkept: number;
  restore_blocked: number;
  output_found: Partial<Record<SensitiveRule, number>>;
}
```

Change: `compaction_residual` and `thinking_kept` leave with the redaction that wrote them. `output_found` is new: the findings of [Rotate warning](#rotate-warning). `redactionSummary` maps `output_found` to `output_found_count` and `output_found_rules`. [L5](L5-worker.md) renames the span attributes of the worker.

### Interim redaction of the Workbench of main

- The Workbench of `main` reads the session events and the messages with no exit redaction, and it opens sessions with `openSession` until the [Workbench change](#workbench-service). With the removal of the `assistant` redaction, a key in LLM output then reaches the Workbench views. That makes a rule of today weaker.
- Change: `openSession` adds one more extension, `assistantRedaction(state)`, after `inputRedaction`. It keeps the three redactions of LLM output of today and the counts `thinking_kept` and `compaction_residual`, for that path only.
- The module and its test leave with the Workbench change. No other path adds it.

## Stop, budget and class

(G7)

### Stop and forced stop

- **Graceful stop.** An abort of `input.signal` calls `session.abort()`. pi aborts the in-flight request and stops each tool call (`abort`, `dist/core/agent-session.js:1909-1920`). The `bash` operations send SIGKILL to the process tree of the command (`processBashOperations` in `src/agent/bash-process.ts`). `send` returns after pi persists the aborted entry (`waitForIdle`) and after each child process ends. The end is `stopped`.
- **Forced stop.** `forceStop()` kills each live child process at once (`ToolProcesses.killAll`), returns a `TurnEnd` with the end `stopped`, the totals so far, the last assistant text so far after `exitText` and the warnings so far, and makes the open `send` return that same `TurnEnd`. It then disposes the session and does not wait. The session file can lack the aborted entry ([L2 Shutdown](L2-agent-cli.md#shutdown), rule 2).
- **Close.** `close` after a `send` that returned kills each child process that is still alive. So each child process ends before the contract returns ([L2 requirement 14](L2-agent-cli.md#requirements-on-l3)).
- Change: today `ToolProcesses` records only ended processes (`src/agent/tool-table.ts`). It gains the set of live processes and `killAll`, which calls `killChildTree` (`src/kernel/process-group.ts`).

### Budget

| Limit      | Enforcement                                                                                                                                                                                   | `budgetReached` |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `deadline` | A timer at the deadline aborts the session. The wait of each pi retry counts, because the timer runs in wall time ([L2 Budget](L2-agent-cli.md#budget), rule 9)                               | `wall`          |
| `usd`      | At each `message_end` of an `assistant` message, the contract adds `usage.cost.total` to the list price. When the sum is equal to or more than `usd`, it aborts the session                   | `usd`           |
| `turns`    | At each `turn_end`, the contract adds 1. When the count is equal to or more than `turns`, `finishTurn` of the pi agent returns the end action, so the run ends at that turn end with no abort | `turns`         |

- The first limit that the run reaches decides `budgetReached`. A later limit changes nothing.
- The command limit of `bash` is `min(remaining wall time, COMMAND_LIMIT_MS)`, as today (`src/agent/tool-table.ts`). With `deadline` `null`, it is `COMMAND_LIMIT_MS` (600 s).
- One model call can pass the `usd` limit before the abort ([L2 Budget](L2-agent-cli.md#budget), rule 5).
- The worker gives its turn limit in `turns` ([L5](L5-worker.md)). Today `ExecutionBudget` counts turns and sets `finishTurn` itself (`src/worker/unit/native-agent.ts:194-197`). `run agent` gives `turns: null`.

### End and class

| End          | Condition                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stopped`    | The stop signal or `forceStop` ended the run                                                                                                             |
| `budget_end` | A budget limit ended the run                                                                                                                             |
| `failed`     | The last `assistant` message has the stop reason `error`, after the retries of pi; or `session.prompt` threw. The second case has the failure `internal` |
| `completed`  | Each other end of the agent loop                                                                                                                         |

- **Class.** For a provider error, the class is `retryable` when `isContextOverflow(last, model.contextWindow)` is `false` and `isRetryableAssistantError(last)` is `true` (`@earendil-works/pi-ai`, `dist/utils/overflow.d.ts:57`, `dist/utils/retry.d.ts:57`). Else it is `terminal`. The failure `internal` is `terminal` ([L2 Classes](L2-agent-cli.md#classes), rule 3).
- **Failure kind.** `providerFailureOf(errorMessage)` of the redacted error text (`src/llm/provider-failure.ts`). An unknown text gives `unavailable`. The failure kind does not decide the class.
- **Reason.** `RunFailure.reason` is the `errorMessage` of the last `assistant` message, or the message of the thrown error, after `exitText`.
- The contract retries nothing. The retries of pi stay, with the in-memory settings of `sessionParts`.
- Change: today the worker builds the provider failure from the session messages (`providerFailure`, `src/worker/unit/native-agent.ts:77`), and the Project Service throws `session.state.errorMessage` (`src/project/environment-agent.ts:331`).

### Child processes

- Change: the wrapped `bash` builds the environment of a child process only from `input.childEnvironment`, plus the `PATH` that pi computes, through `childEnvironment` (`src/agent/environment.ts`). Today `exec` passes `childEnvironment(execOptions.env ?? env)` (`src/agent/tool-table.ts:118`), and pi fills `execOptions.env` from `process.env` (`getShellEnv` in `dist/utils/shell.js:115-126`). So each name of the runtime process reaches a child today.
- The runtime process and pi do not read `input.childEnvironment` ([L2 requirement 15](L2-agent-cli.md#requirements-on-l3)).
- `killGroupAtEnd` stays `true`: the group of each command ends with the command.

## Other consumers

(G2, G6)

### Worker

The worker side belongs to [L5](L5-worker.md). L3 fixes only what the contract gives it: `systemPrompt.kind` `composed`, `session.kind` `directory`, `extensions` with the worker capabilities, `budget.turns`, the `entry` and `session` events, `TurnEnd.complete`, `TurnEnd.failure` and `redactionSummary`. [Handoffs](#handoffs-to-later-layers) lists the items.

### Project Service

The Project Service opens each `env@1` session through `openAgent`:

| Input              | Value                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `profile`          | `env@1`                                                                                                                |
| `systemPrompt`     | `composed`: `composeSystemPrompt` of the parts that the server part resolves today, binding parts and framing included |
| `workspace`        | `{ cwd: checkout, roots: [checkout], confine: false }`; the profile sets the confinement                               |
| `budget`           | `deadline` from the context of the setup run; `usd` and `turns` `null`                                                 |
| `session`          | `memory`, as today                                                                                                     |
| `knownSecrets`     | `credentialSecrets` of the server agent store (`src/llm/known-secrets.ts`)                                             |
| `childEnvironment` | `{}`: `env@1` declares no `bash`                                                                                       |
| `consumerTools`    | `probe`, `environment_write`                                                                                           |
| `extensions`       | none                                                                                                                   |

- Change: `environment_write` returns the pi tool result `terminate: true` when its proof passes (`terminate` in `@earendil-works/pi-agent-core`, `dist/types.d.ts:387-391`). pi then ends the loop after that tool batch (`dist/agent-loop.js:167`, `:466`). This replaces the patch of `session.agent.finishTurn` (`src/project/environment-agent.ts:314-316`), because pi gives the mechanism ([L1-D24](L1-model.md#decisions)).
- Change: the Project Service reads `TurnEnd.failure.reason` in place of `session.state.errorMessage`, and logs `redactionSummary()`.
- The Project Service change touches no worker module. [L6](L6-migration.md) places it.

### Workbench Service

- **Constraint.** The Workbench change starts only after `feature/workbench-v2` merges into `main` ([L1-D8](L1-model.md#decisions)). Until then the Workbench of `main` keeps `openSession` with [Interim redaction](#interim-redaction-of-the-workbench-of-main). The agent build touches Workbench files only for the import paths of moved symbols.
- **Open.** The Workbench opens each session through `openAgent`: `systemPrompt` `composed` with the Workbench parts and the framing; `workspace` `{ cwd: place.cwd, roots: [place.cwd], confine: true }`, which keeps the confinement of every Workbench session of the branch (`checkoutConfinement(session.place.cwd)` in `src/workbench/service.ts` of the branch); `budget` all `null`; `session` `directory` for a new session and `resume` for a resume; `consumerTools` the operation tools, `offer_action`, `request_owner_act` and `evidence_read`; `extensions` `[toolApproval]`.
- **Views.** The Workbench reads only the contract events and the `TurnEnd`, after the exit redaction. It holds no `AgentSession`.
- **`bash`.** The Workbench `bash` wrapper leaves. The runtime `bash` is the one `bash` of every consumer ([L1 handoff](L1-model.md#handoffs-to-later-layers)). The branch wraps each Workbench command with `bashSandbox.wrap` and a deny list of server files (`builtinTools` in `src/workbench/tools.ts` of the branch; `src/agent/bash-sandbox.ts` of the branch). Change: the input gains `bashSandbox: SandboxScope | null`, the Workbench gives `hostDenyRead`, and the runtime `bash` wraps each command with it. So the sandbox of the branch keeps its strength. The branch sets `killGroupAtEnd: false`; **(Q1)** holds the ruling.
- **`swe@1` with no worktree.** Today the working directory of a Workbench session is a directory per agent name that is no git worktree (`workbenchDirectory` in `src/workbench/sessions.ts`). The coding preconditions refuse it. **(Q2)** holds the ruling.

## Extension modules

(G8)

Each module exports one extension factory, with its test file next to it ([L1 Extension rule](L1-model.md#extension-rule)).

| Module                                    | Factory               | Test file                      | Change                                                                                                                    |
| ----------------------------------------- | --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/hooks/home-relative-cwd.ts`    | `homeRelativeCwd`     | `home-relative-cwd.test.ts`    | New test. Today no test names it                                                                                          |
| `src/agent/hooks/tool-allowlist.ts`       | `toolAllowlist`       | `tool-allowlist.test.ts`       | New test. Today no test names it                                                                                          |
| `src/agent/hooks/marker-restore.ts`       | `markerRestore`       | `marker-restore.test.ts`       | New module from `restore`, plus the known-secret block                                                                    |
| `src/agent/hooks/checkout-confinement.ts` | `checkoutConfinement` | `checkout-confinement.test.ts` | Unchanged                                                                                                                 |
| `src/agent/hooks/pinned-layers.ts`        | `pinnedLayersHook`    | `pinned-layers.test.ts`        | New test. Today no test names it                                                                                          |
| `src/agent/hooks/input-redaction.ts`      | `inputRedaction`      | `input-redaction.test.ts`      | New module from `hook`, less the three redactions of LLM output, plus `errorMessage`                                      |
| `src/agent/hooks/output-finding.ts`       | `outputFinding`       | `output-finding.test.ts`       | New module                                                                                                                |
| `src/agent/hooks/assistant-redaction.ts`  | `assistantRedaction`  | `assistant-redaction.test.ts`  | New interim module; it leaves with the Workbench change                                                                   |
| `src/agent/hooks/tool-approval.ts`        | `toolApproval`        | `tool-approval.test.ts`        | New test. Today only `sensitive-text-redaction.test.ts` tests it. Both move to `src/workbench/` with the Workbench change |

- `src/agent/redaction.ts` is no extension. It holds the state that four factories share: the marker table, the matchers and the counts. Its test file is `redaction.test.ts`.
- `src/agent/hooks/sensitive-text-redaction.ts` and its test leave. Its tests move to the test file of the module that owns each behavior.
- The capabilities `executionEvidence` and `linkUpdates` move to the worker layer with their tests ([L5](L5-worker.md#worker-capabilities)).

## Acceptance checks

(G9)

Each check is an end-to-end test ([index](index.md#layer-files)). It runs the built `kanthord run agent` as a process, with a real file system, real git and the real pi runtime. The only stub is the LLM stub. The fixtures are the [L2 fixtures](L2-agent-cli.md#l2-fixtures): Auth, Stub, W, H, X, T, D, S, O, Run and `$TEST`. "Refused" means: exit `1`, no result, and the first stderr line that is no JSON line starts with the code. "A digest listing of W" is `find W -type f | sort` with the SHA-256 digest of each file, the files of `.git` included.

1. **L3-AC1. No input entry of a session file holds a known secret.** Makes L1 [AC3](L1-model.md#checks) runnable.
   - Fixture: K is the key of Auth. The one commit of W holds `secret.txt` with the text `token K`. `$TEST/context.md` holds `context K`. Run 1 has its own S1 and W1. Run 2 has its own S2 and W2. The scripted answers of run 1: call `read` with the path `secret.txt`; then answer the text `done`. In run 2, Stub answers each request with HTTP 400 and the body `{"error":{"message":"bad key K"}}`.
   - Command: run 1: Run with `--system-prompt "$TEST/context.md" --prompt "use K"` in place of `--prompt "$INPUT"`. Run 2: the same, with S2 and W2.
   - Pass:
     - Run 1 exits `0`. Run 2 exits `5`, and its line in O has `end` `failed`, `class` `terminal` and `failure` `bad_request`.
     - No request body to Stub in run 1 holds K. The system text and the user text of the first request of run 1 hold `<redacted:llm_credential:`. The `read` tool result in the second request holds `<redacted:llm_credential:`.
     - For each line of S1 and S2: when the entry has `type` `message` and `message.role` `assistant`, its `errorMessage` field holds K zero times. Each other line holds K zero times.
     - S2 holds one or more `assistant` entries with `stopReason` `error` and an `errorMessage` that holds `<redacted:llm_credential:`.
     - O and stderr hold K zero times.

2. **L3-AC2. Each profile composes the prompt chain.**
   - Fixture: `$TEST/context.md` holds `Repository prompt M4`. Each run has its own W and S. Stub answers the text `ok`.
   - Command: for P in `swe@1`, `bee@1`, `fee@1`, `te@1`, `re@1` and `env@1`: Run with the profile P and `--system-prompt "$TEST/context.md"`.
   - Pass: each run exits `0`. Let C(P) be the join with `"\n\n"` of these texts, each as the file holds it: `static/prompt/base.md`; `static/prompt/coding.md` for each P except `env@1`; `static/prompt/role/P.md`, or `static/prompt/env@1.md` for `env@1`; then `Repository prompt M4`. The system text of the first request of each run starts with C(P) byte for byte, and the rest is one `<cwd>` section. `system_prompt_digest` of each line in O is the SHA-256 hex digest of C(P).

3. **L3-AC3. Each profile offers its full tool set, and a declared tool with no implementation is absent.**
   - Fixture: each run has its own W and S. The scripted answers: for `swe@1`, call `evidence-upload` with `{"path":"README"}`, then answer `done`; for `re@1`, call `bash` with `{"command":"ls"}`, then answer `done`; for `env@1`, call `probe` with `{}`, then answer `done`; for `bee@1`, `fee@1` and `te@1`, answer `done`.
   - Command: Run once for each of the six profiles.
   - Pass: each run exits `0`. The first request lists exactly `read`, `edit`, `write`, `grep`, `find`, `ls` and `bash` for `swe@1`, `bee@1`, `fee@1` and `te@1`, and exactly `read`, `grep`, `find` and `ls` for `re@1` and `env@1`. The tool result of the scripted call in S is an error result with the text `Tool evidence-upload not found`, `Tool bash not found` and `Tool probe not found`. For `re@1` and `env@1`, a digest listing of W is equal before and after.

4. **L3-AC4. A known secret in a tool input blocks the call, and the record keeps the model output.**
   - Fixture: one scripted assistant message with two tool calls: `bash` with `{"command":"printf %s K > $TEST/leak"}`, and `write` with `{"path":"leak.txt","content":"K"}`. Then the answer `done`.
   - Command: Run.
   - Pass: exit `0`. Each of the two tool results in S is the block text `The input holds a value of a known credential. No tool receives this value.` No file exists at `$TEST/leak` or at `W/leak.txt`. `git -C "$W" status --porcelain` prints nothing. The `assistant` entry of S holds both arguments byte for byte, K included. stderr holds exactly one line with `"code":"cli.run.agent.secret_exposed"`, `"rule":"llm_credential"` and `"count":2`. O and stdout hold K zero times.

5. **L3-AC5. The start preconditions of each profile, with no write and no repository code.** Gives the precondition list of L1 [AC10](L1-model.md#checks).
   - Fixture: each variant has its own W and S. The script `$TEST/fsmonitor` writes the marker file `$TEST/M10` and exits `0`.
     1. `bee@1`; W holds an uncommitted change of a tracked file.
     2. `te@1`; W is an empty directory that is no git worktree.
     3. `re@1`; W is an empty directory that is no git worktree.
     4. `re@1`; W holds an uncommitted change of a tracked file.
     5. `swe@1`; W has no uncommitted change, and `git -C "$W" config core.fsmonitor "$TEST/fsmonitor"` ran before the run.
   - Stub answers the text `ok`.
   - Command: Run with the profile of each variant.
   - Pass:
     - Variant 1 is refused with `cli.run.agent.start_refused`, and the `reason` row starts with `git_clean:`. Variant 2 is refused, and the `reason` row starts with `git_worktree:`. For both, Stub receives no request, no file exists at S, and a digest listing of W is equal before and after.
     - Variants 3, 4 and 5 exit `0`.
     - For variant 5, no file exists at `$TEST/M10`, and a digest listing of W is equal before and after.

## Unit-level rules

(G9)

Each rule holds in one module, with no process and no LLM stub ([index](index.md#layer-files)). A test with a model uses Faux and the test consumer of the [L1 shared fixtures](L1-model.md#shared-fixtures). Each test file lies next to its module.

1. **L1 U2.** `inputRedaction` redacts a `custom` message and a steering message before pi persists them, and a `custom` message that a `context` handler adds. Test file: `src/agent/hooks/input-redaction.test.ts`.
2. **L1 U3.** Each text that the contract gives out holds K zero times: `TurnEnd.text`, `RunFailure.reason`, each `session` event and each `entry` event. K is in the model text, in a tool result and in a provider error. Test file: `src/agent/agent-contract.test.ts`.
3. **L1 U6.** `toolAllowlist` blocks an undeclared name with the text `The tool <name> is not declared for this agent.`, and the implementation does not run. A declared name passes. Test file: `src/agent/hooks/tool-allowlist.test.ts`.
4. **L1 U10.** `outputFinding` gives one warning with the rule `llm_credential` and the count of findings for one `assistant` message, and none for a message with no finding. The `assistant` entry stays byte for byte. A known secret in `errorMessage` gives no finding. Test file: `src/agent/hooks/output-finding.test.ts`.
5. **L3-U1. Composition function.** The output for the worker parts of today is byte-equal to `finalPrompt` of today, on a golden case with an instruction file, a Repository prompt, a Binding prompt and the framing. The output for the Workbench parts is byte-equal to `systemPrompt` of today. A heading renders as heading, blank line, text. The digest is the digest of the text before the redaction. Test file: `src/agent/prompt-chain.test.ts`.
6. **L3-U2. Catalog.** Each profile has the exact tool set, confinement and precondition list of [Coding tools](#coding-tools). Each declared tool has a `TOOL_CATALOG` entry. `getProfile` of an unknown name gives `undefined`. `AGENT_NAMES` holds no role profile. Test file: `src/agent/catalog.test.ts`.
7. **L3-U3. Prompt files.** `coding.md` equals the three shared sections of `swe@1.md` and of `re@1.md`. `role/swe@1.md` and `role/re@1.md` equal the other sections of `swe@1.md` and `re@1.md` less the protocol text of [Prompt files](#prompt-files). `## Execution` and `## Findings` of `role/bee@1.md` and `role/te@1.md` equal those of `role/swe@1.md`, and those of `role/fee@1.md` differ only by item 6. No Role holds the words `worker`, `node branch` or `gate`. Test file: `src/agent/prompt-assets.test.ts`.
8. **L3-U4. Start preconditions.** Each id passes and fails as its row states; the order and the first failure; the reason text; a resume skips `git_clean`; each `git` command gets the isolated environment and `--no-optional-locks`; a timeout fails the precondition. Test file: `src/agent/start-preconditions.test.ts`.
9. **L3-U5. End and class.** Each end from its condition; the class from `isContextOverflow` and `isRetryableAssistantError`, a context overflow included; the failure kind; the failure `internal` for a thrown error; `complete`; the totals. Test file: `src/agent/run-outcome.test.ts`.
10. **L3-U6. Budget.** The deadline gives `wall`; a list price equal to the limit gives `usd`; the turn count gives `turns` with no abort; the first limit wins; the command limit with a `null` deadline is `COMMAND_LIMIT_MS`. The test uses a model with a catalog price. Test file: `src/agent/run-budget.test.ts`.
11. **L3-U7. Contract.** An undeclared name of `consumerTools` throws `agent.tool_undeclared`. A declared consumer tool with no implementation is absent from the request. An unsupported `thinkingLevel` throws, and no level is clamped. A refused open writes no session file and sends no request. The open sends no request. The guard order is the order of [Guard order](#guard-order). `workspace.confine` adds the confinement. An abort gives `stopped` after pi persists the aborted entry. `forceStop` returns at once with the totals so far and kills each live child process. No runtime module writes to `process.stdout` or `process.stderr`. A handler error of an extension ends the run with the failure `internal`. `appendCustom` redacts its data. Test file: `src/agent/agent-contract.test.ts`.
12. **L3-U8. Marker restore.** The restore cases of today ([agent.impl.md](../agent.impl.md#the-restore-by-tool)), and the block of a known secret as raw text in the input of `bash`, `write`, `read` and a consumer tool, with the new block text. Test file: `src/agent/hooks/marker-restore.test.ts`.
13. **L3-U9. Hooks of today with no test.** `homeRelativeCwd` writes the `<cwd>` section relative to the host home. `pinnedLayersHook` adds the work pin once and keeps the system messages first. `toolApproval` blocks with the reason of the decision and passes an allowed call. Test files: `home-relative-cwd.test.ts`, `pinned-layers.test.ts`, `tool-approval.test.ts` in `src/agent/hooks/`.
14. **L3-U10. Redaction state.** The counts hold no `compaction_residual` and no `thinking_kept`; `output_found` counts the findings; `exitText` gives the session marker; `exitValue` gives `redactValue`; `text` refreshes the known secrets. Test file: `src/agent/redaction.test.ts`.
15. **L3-U11. Child processes.** A child process gets only the names of `childEnvironment`, less the removed names, plus the pi `PATH`; a name of `process.env` that the input does not hold is absent. `killAll` kills each live process tree. Test file: `src/agent/tool-table.test.ts`.
16. **L3-U12. Interim redaction.** `assistantRedaction` keeps the three redactions of LLM output of today, only on the `openSession` path. Test file: `src/agent/hooks/assistant-redaction.test.ts`. The rule leaves with the module.
17. **L1 U15.** The import closure of each runtime module stays in the allowed set of [Import rule](#import-rule), and no runtime module names `setGlobalDispatcher` or `EnvHttpProxyAgent`. Module: the import check of the build ([L6](L6-migration.md)). L3 gives the allowed set.

### Rules with no check, and the reason

- **The turn limit end to end.** `run agent` has no turn input. L3-U6 covers it, and [L5](L5-worker.md) covers it for the worker.
- **A resume.** `run agent` has no resume input ([L2-D5](L2-agent-cli.md#decisions)). L3-U4 covers the precondition rule.
- **The forced stop end to end.** `run agent` reaches it only after a 10-second graceful stop that a test cannot force with no hang of pi. L3-U7 and the signal handler rule of L2 cover it.
- **The Workbench and the Project Service.** L1 [AC19](L1-model.md#checks) and [AC20](L1-model.md#checks) belong to L5.
- **The interim redaction.** It is a temporary path of the Workbench of `main`. L3-U12 covers it.

## Handoffs to later layers

### To L6 part A

These are order hints. [L6](L6-migration.md) fixes the order.

1. The import moves: `ProviderFailure` to `src/llm/provider-failure.ts`; `credentialSecrets` and `mergedSecrets` to `src/llm/known-secrets.ts`; the code constant to `pi-tools.ts`; the worker tool names to `catalog.ts`. Move `agent-port.ts`, `session-directory.ts`, `review-roots.ts` and `capabilities/` to the worker layer unchanged. After this step the import check of [Import rule](#import-rule) can pass.
2. The split of `sensitive-text-redaction.ts` into `redaction.ts` and the hook modules, with their tests. The build change of [Redaction](#redaction), the known-secret block and the interim module, in one step. L3-AC1 comes in the same step. This step comes before the step that makes `run agent` write a session file ([L1 Session file](L1-model.md#session-file), "Order").
3. The catalog split: `catalog.ts` with the profiles and `AgentTools`, and `declarations.ts`. The role profiles. The prompt files with L3-U3.
4. `prompt-chain.ts`. The server part then calls `composeSystemPrompt`; L3-U1 proves the byte-equal text.
5. `start-preconditions.ts`, `run-budget.ts`, `run-outcome.ts`, the changes of `tool-table.ts`, then `agent-contract.ts`.
6. `run agent` of L2 on the contract.
7. The Project Service on the contract. It needs no worker change, so L6 can place it in part A or part B.
8. The gate check of [L1 U8](L1-model.md#unit-level-rules) after the test files of [Extension modules](#extension-modules) exist.

### To L5

1. The port `agent.open` builds `AgentInput` from the execution setup: the profile, the model runtime, the composed text of the server, the workspace roots of each chain, `session` `directory`, `budget.deadline` from the claim, `budget.turns` from the remaining turns, `knownSecrets` from `mergedSecrets` of the handover stores, `childEnvironment`, `hostHome` and the worker capabilities in `extensions`.
2. The roots of each chain pass the coding preconditions: the checkouts of an `implement` node; the trees of `workspace.review` for `examine` with `swe@1`. L5 confirms that each tree is a git worktree with no uncommitted change, or states the change.
3. The worker reads `TurnEnd` in place of `completeReply`, `lastText` and `providerFailure`, and the `entry` and `session` events in place of the `AgentSession` (`src/worker/unit/native-agent.ts`, `agent-telemetry.ts`, `session-entries.ts`). `sessionEntryRecord` keeps its size bound; the contract already applies `exitValue`.
4. The worker records each `SecretWarning` as a telemetry finding. It renames the span attributes of [Redaction counts](#redaction-counts).
5. The worker gives the turn limit of `NATIVE_RESOURCE_BUDGET` in `budget.turns` and stops the patch of `finishTurn`.
6. Layer 2 of E1 in the worker path: the part `coding` of `PromptPart`, the server Role from `role/<name>.md`, the protocol text in the worker instructions, and the deletion of the old `swe@1.md` and `re@1.md` ([Prompt files](#prompt-files)).
7. The Workbench change of [Workbench Service](#workbench-service), after the merge, with the rulings of Q1 and Q2. The lint glob of [L1-D15](L1-model.md#decisions) covers `src/workbench/tool-approval.ts`.
8. The changes of AC18, AC19 and U13 in [Changes needed in upper layers](#changes-needed-in-upper-layers), when Ulrich accepts them.

### To HANDOFF.md

L3 adds no item. The contract answers two open items of [HANDOFF.md](../HANDOFF.md#agent-component), Agent component: "Give an agent session a budget input that the consumer supplies" (`RunBudget`) and "split `NativeAgentInput` ... into a session input that names no execution" (`AgentInput`). L6 closes them when it builds the contract.

## Changes needed in upper layers

L3 does not edit L1 or L2. Each item states the change and the reason. L3 stays consistent with the current upper text, except where an item states the conflict.

1. **L1 AC18, AC19 and U13: the result of an undeclared tool.** The three pass conditions require the block text of U6, "not the pi result `Tool <name> not found`", for a tool that a consumer registers and that the profile does not declare. pi never registers a tool outside the option `tools`, also a tool of `customTools` or of an extension (`_refreshToolRegistry`, `dist/core/agent-session.js:2808-2821`). The model then never sees it, and a call gets `Tool <name> not found` before any `tool_call` handler. A block text needs the contract to pass more names to pi than the declaration, which accepts what pi refuses ([L1-D24](L1-model.md#decisions)). Proposed text: an undeclared name in `consumerTools` refuses the open with `agent.tool_undeclared`; AC18 and AC19 assert that the first request lists exactly the declared tools that have an implementation, and that a scripted call of an undeclared name gets `Tool <name> not found` with no implementation run; U13 asserts the open refusal, and the block text of U6 for an MCP tool name that pi keeps registered. The current text conflicts with L1-D24, and L3 follows L1-D24.
2. **L1 E6, Mapping of today, L1-D6 and L1-D9: the name of `env@1`.** The branch renames `env@1` to `pe@1` (`PE_AGENT_NAME` in `src/project/environment-agent.ts:55` of the branch; `pe@1.md` in `prompt-assets.ts` of the branch). After the merge the profile name is `pe@1`. L1 names `env@1` as the Operation Setup agent. L3 uses `env@1` and marks `pe@1`.
3. **L1 Session file and the rules table: the block of a known secret in a tool input.** Add one rule: a tool call whose input holds a known secret as raw text is blocked in every tool, and the block changes no recorded response. Reason: R2-H keeps the tool call arguments raw, so AH-Q3 ("A rule 0 value blocks in every tool") becomes weaker without this rule ([Known secret in a tool input](#known-secret-in-a-tool-input)). The strength of the row "Session redaction ... LLM output included" then stays the same for tool inputs.
4. **L1 Session file: the interim of the Workbench of `main`.** Add the constraint that the Workbench of `main` keeps the redaction of LLM output until it opens sessions through the contract ([Interim redaction](#interim-redaction-of-the-workbench-of-main)). Reason: else the order of L6 makes a rule of the Workbench weaker between the two steps.
5. **L1-D9 and tool ownership rule 7: a consumer can add the confinement.** Add: a consumer can add the confinement to a session of a profile that does not set it, and can never remove it. Reason: the branch confines every Workbench session, `swe@1` included; a profile property alone makes that rule weaker after the merge.
6. **L1 Statelessness check 4 and the boundary table: a session with no file.** Add: a consumer that reads no record of a session opens it in memory, for example the Project Service. Add the record kinds `resume` (Workbench) and `memory` (Project Service) to the row "Consumer records". Reason: the Project Service writes no session file today and has no reader of one.
7. **L1 handoff to L3: the precondition check at a resume.** L1 asks L3 to rule it. L3 rules that a resume skips `git_clean`. L1 needs no text change; the item records the ruling for the joint review.

## Decisions

1. **L3-D1.** The runtime and the server part of `src/agent/` separate by file as [File assignment](#file-assignment) states. Constraint: the import closure of each runtime module stays in the allowed set of [Import rule](#import-rule); `agent-port.ts`, `session-directory.ts`, `review-roots.ts` and `capabilities/` leave for the worker layer.
2. **L3-D2.** `SpanStatus` leaves the runtime with the trace; `credentialSecrets` and `mergedSecrets` move to `src/llm/known-secrets.ts`; `ProviderFailure` moves to `src/llm/provider-failure.ts`; the code constant of the pi tool install moves to `pi-tools.ts` with its value `worker.start.tool_missing`. Reason: each import serves a consumer concern, and a new code value changes a documented code for no gain.
3. **L3-D3.** The agent contract is `openAgent(input)` with the input, the run handle, the output and the events of [Input and output contract](#input-and-output-contract). Constraint: every consumer opens sessions only through it; no consumer gets the `AgentSession`; `openSession` stays only for the Workbench of `main` until the Workbench change.
4. **L3-D4.** The runtime catalog in `catalog.ts` lists every profile that opens a session; `declarations.ts` of the server part lists only the configuration owners. Constraint: `AGENT_NAMES` holds no role profile; `guard@1` stays a server declaration, because it opens no session.
5. **L3-D5.** `AgentTools` of the branch is the field shape. `main` holds `builtin`, `host` and `environment`; the merge adds `operation` and `workbench`. Constraint: a field exists only with its reader; `offer_action` and `request_owner_act` join `workbench`; the role profiles declare no consumer tool.
6. **L3-D6.** The pi option `tools` holds the declared names of the session, and an undeclared name in `consumerTools` throws `agent.tool_undeclared` at the open. Reason: pi drops an undeclared tool in silence, and a defect of the consumer becomes visible at the open. Constraint: the allowlist block text stays `The tool <name> is not declared for this agent.`.
7. **L3-D7.** The profile prompt of a coding profile is `base.md`, `coding.md` and `role/<name>.md`. `coding.md` holds the three sections that `swe@1.md` and `re@1.md` share today. Constraint: the worker path keeps `swe@1.md` and `re@1.md` until layer 2 of E1; L3-U3 fails on a difference between the two copies; `bee@1` and `te@1` differ from `swe@1` only in the role statement, and `fee@1` also in item 6.
8. **L3-D8.** `composeSystemPrompt` of `prompt-chain.ts` is the one composition function. `system_prompt_digest` is the digest of its output before the redaction. Reason: the redaction marker holds a random tag per session. Constraint: the composed text of each consumer of today stays byte-equal.
9. **L3-D9.** The start preconditions are `workspace_directory`, `git_worktree` and `git_clean`. The coding implementation profiles declare all three; `re@1`, `env@1`, `ops@1` and `plan@1` declare `workspace_directory`. Constraint: `git` runs with `isolatedGitEnvironment` and `--no-optional-locks`; a resume skips `git_clean`; the reason holds no path.
10. **L3-D10.** The guard order is `homeRelativeCwd`, `toolAllowlist`, `markerRestore`, `checkoutConfinement`, `pinnedLayersHook`, the consumer extensions, `inputRedaction`, `outputFinding`. Constraint: `sessionParts` builds it for every open path; the consumer gives only its extensions; each guard fails closed.
11. **L3-D11.** `markerRestore` blocks a tool call whose input holds a known secret as raw text, in every tool. Reason: it keeps AH-Q3 after R2-H. Constraint: the block changes no recorded response.
12. **L3-D12.** The build change of R2-H removes the three redactions of LLM output and keeps the input redaction, the restore and `exitText`. The rotate warning has the rule `llm_credential` and one count per `assistant` message. Constraint: `compaction_residual` and `thinking_kept` leave, and `output_found` is new.
13. **L3-D13.** The Workbench of `main` keeps the redaction of LLM output through `assistantRedaction` on the `openSession` path. Reason: it has no exit redaction until the Workbench change. Constraint: the module leaves with the Workbench change.
14. **L3-D14.** The contract applies `exitText` to `TurnEnd.text` and `RunFailure.reason`, and `exitValue` to each event. Constraint: no consumer reads a text of the session outside the contract output.
15. **L3-D15.** `RunBudget` holds `deadline`, `usd` and `turns`. The first limit that the run reaches decides `budgetReached`. Constraint: the wall and list-price limits abort; the turn limit ends at a turn end with no abort; the `bash` command limit is `min(remaining wall time, COMMAND_LIMIT_MS)`.
16. **L3-D16.** An abort of the stop signal is the graceful stop; `forceStop` returns at once and kills each live child process. Constraint: `ToolProcesses` tracks live processes and gains `killAll`; `close` kills each child process that is still alive.
17. **L3-D17.** The class of a provider error is `retryable` only when `isContextOverflow` rejects it and `isRetryableAssistantError` accepts it. The failure kind is `providerFailureOf` of the redacted error text. Constraint: the contract retries nothing; the retries of pi stay.
18. **L3-D18.** Confinement is the property `confined` of the profile, and a consumer can add it with `workspace.confine`. Reason: the branch confines every Workbench session. Constraint: no consumer can remove the confinement of a profile.
19. **L3-D19.** A child process gets only the names of `input.childEnvironment`, less the names that `childEnvironment` removes, plus the pi `PATH`. Constraint: the runtime process and pi do not read the input.
20. **L3-D20.** The Project Service opens `env@1` through the contract with a `memory` session, and `environment_write` ends the loop with the pi result `terminate: true`. Reason: pi gives the mechanism. Constraint: no consumer patches `finishTurn`; only the contract sets it, for the turn limit.
21. **L3-D21.** After the merge, the runtime `bash` is the one `bash` of every consumer, and the input gains `bashSandbox` for the Workbench. Constraint: the sandbox of the branch keeps its strength; the Workbench change starts only after the merge of `feature/workbench-v2`.
22. **L3-D22.** Every session holds the pinned layers. `send(text, { pin })` sets the work pin. Constraint: the system prompt pin applies to every consumer.
23. **L3-D23.** The session record has four kinds: `new_file`, `directory`, `resume` and `memory`. Constraint: `new_file` uses `SessionManager.open` with the explicit path and the workspace as `cwd`, and the contract asserts that no entry exists at the path.
24. **L3-D24.** The contract never clamps the reasoning effort. An unsupported level throws at the open. Constraint: the consumer checks the level first, as `run agent` does ([L2 Model selection](L2-agent-cli.md#model-selection), rule 6).

## Open questions for Ulrich

1. **Q1. Background processes of the Workbench `bash`.** Aelita wants to kill the process group at the end of each Workbench command, as the runtime `bash` does for every other consumer. Reason: L2 requirement 14 and L3-D21 need one `bash`, and a process that outlives its command keeps the reach of the session ([L1 Reach of an unconfined session](L1-model.md#reach-of-an-unconfined-session)). Alternatives:
   - Keep the group of a Workbench command alive (`killGroupAtEnd: false`, as the branch does): a human can start a development server with `&`, but the process outlives the command and the turn, and the runtime `bash` gets a consumer switch.
   - Kill the group at the end of the run, not of the command: a background process lives for one run, and `close` kills it; this adds a second kill rule to the runtime.
2. **Q2. The Workbench `swe@1` session with no worktree.** Aelita wants the Workbench to give each new `swe@1` session its own new directory, with `git init` and one empty commit. A resume of that session then skips `git_clean`. Reason: the coding preconditions hold for every consumer, and each new session then starts clean with no commit step in the Workbench. Alternatives:
   - Keep one directory per agent name, make it a git repository once, and let the Workbench commit the directory after each run: the files stay shared between sessions, but the Workbench owns a commit step.
   - Give the Workbench `swe@1` session only `workspace_directory`: no Workbench change, but the precondition list of a profile then depends on the consumer, against [L1 handoff](L1-model.md#handoffs-to-later-layers) "The list holds for every consumer".
