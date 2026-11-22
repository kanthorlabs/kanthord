# L3: The agent

Back to the [index](index.md). The terms follow the [glossary](index.md#glossary). [L1](L1-model.md) is the model and [L2](L2-agent-cli.md) is the public surface that this page satisfies. Each KanthorD path starts at `engine/`. Each pi path starts at `@earendil-works/pi-coding-agent/` (pi `1.1.0`), unless the path names another pi package. The code of today is engine `c864130e`. The Workbench code of the branch is `origin/feature/workbench-v2` at `0d901afa`.

## Goals

1. **G1.** Each file of `src/agent/` has one owner: the agent runtime, the server part, or a consumer that the file moves to. The runtime imports no worker, project, mission or scheduler module ([L1-D5](L1-model.md#decisions)).
2. **G2.** One agent contract fixes the input type and the output type of a run. It fixes the shape and the invariants of the output, not the model text ([Output](#output)). Each requirement of [L2](L2-agent-cli.md#requirements-on-l3) maps to one contract part and one check.
3. **G3.** The runtime catalog declares the full tool set of each profile by name, consumer tools included. A declared consumer tool with no implementation leaves the model request.
4. **G4.** The profile prompt is the Standard, the shared coding text and the Role. One pure composition function joins the system prompt, and its output is the input of `system_prompt_digest`.
5. **G5.** Each profile declares its start preconditions. A failed precondition refuses the start with a stable id and a reason, before any request, file write or workspace change.
6. **G6.** The guards hold in one fixed order. The redaction keeps each credential rule at its strength or stricter after the change of R2-H.
7. **G7.** The contract enforces the stop, the forced stop, the wall budget and the list-price budget. It gives the class of a failure from the pi predicates.
8. **G8.** Each pi extension is one module with one factory and its own test file ([L1 Extension rule](L1-model.md#extension-rule)).
9. **G9.** Each public behavior of L3 is an end-to-end acceptance check or a unit-level rule with its owning module and test file ([index](index.md#reading-order)).
10. **G10.** Each open path of today has a stated shape and guard list. The worker path keeps it until [L6](L6-worker.md). The Workbench path keeps it until the rebase of the Workbench branch.

## Agent runtime files

(G1)

### File assignment

Change: the runtime and the server part of `src/agent/` separate by file. A file of the runtime imports no file of the server part. The server part can import the runtime.

| File (today)                                           | Owner after L3                           | Responsibility, and the change                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-contract.ts` (new)                              | Runtime                                  | The agent contract: `openAgent`, the input, the run handle, the output and `AgentOpenError` ([Input and output contract](#input-and-output-contract))                                                                                                                                                                                                                                |
| `agent-session.ts`                                     | Runtime                                  | The pi session open: `sessionParts`, `openSessionRuntime`, `openSession`, `closeRuntime`, `withDeadline`. Change: `sessionParts` builds the guard list of each path ([Guards](#guards); [Open paths until L6 and the Workbench change](#open-paths-until-l6-and-the-workbench-change))                                                                                               |
| `catalog.ts`                                           | Runtime                                  | The runtime catalog: the profiles, `AgentTools`, the tool names, `TOOL_CATALOG` and the preconditions. Change: [Profile catalog](#profile-catalog). It imports no worker module and no `contract.ts`                                                                                                                                                                                 |
| `declarations.ts` (new)                                | Server part                              | `AGENT_DECLARATIONS` of the configuration owners, keyed by `AgentName`: `overridable_fields`, `workbench` and the server Role text. It reads the tool set from the runtime catalog                                                                                                                                                                                                   |
| `prompt-chain.ts` (new)                                | Runtime                                  | `composeSystemPrompt`, `profilePrompt` and `systemPromptDigest` ([Profile prompts](#profile-prompts))                                                                                                                                                                                                                                                                                |
| `prompt-assets.ts`                                     | Runtime                                  | The shipped prompt texts. Change: it adds the shared coding text and the Role files of [Prompt files](#prompt-files). The server part imports the constants that it reads                                                                                                                                                                                                            |
| `start-preconditions.ts` (new)                         | Runtime                                  | The precondition checks of [Start preconditions](#start-preconditions)                                                                                                                                                                                                                                                                                                               |
| `run-budget.ts` (new)                                  | Runtime                                  | The wall and list-price limits of [Budget](#budget) and the `finishTurn` of `endAfterTurn`                                                                                                                                                                                                                                                                                           |
| `run-outcome.ts` (new)                                 | Runtime                                  | The end, the class, the failure kind and the totals of [End and class](#end-and-class)                                                                                                                                                                                                                                                                                               |
| `redaction.ts` (new)                                   | Runtime                                  | The redaction state of one session: the marker table, the matchers, the counts, `text` and `exitText`. [L6](L6-worker.md) adds `exitValue` with the events ([Events](#events)). It comes from `sensitiveTextRedaction` less its two factories                                                                                                                                        |
| `sensitive-text.ts`                                    | Runtime                                  | The rule set, `knownMatcher` and `redactValue`. Unchanged                                                                                                                                                                                                                                                                                                                            |
| `tool-table.ts`                                        | Runtime                                  | The wrapped `bash` and `ToolProcesses`. Change: [Child processes](#child-processes)                                                                                                                                                                                                                                                                                                  |
| `bash-process.ts`                                      | Runtime                                  | The process operations of `bash`. Unchanged                                                                                                                                                                                                                                                                                                                                          |
| `environment.ts`                                       | Runtime                                  | `childEnvironment`. Unchanged                                                                                                                                                                                                                                                                                                                                                        |
| `pi.ts`                                                | Runtime                                  | `loadPi`, the pi directory. Unchanged                                                                                                                                                                                                                                                                                                                                                |
| `pi-tools.ts`                                          | Runtime                                  | The pi tool install. Change: the code constant moves here from `WorkerErrorCode.StartToolMissing` (`src/worker/contract.ts:1061`). The value `worker.start.tool_missing` stays, because `docs/cli/worker.md:1341` documents it for `serve server` and `serve worker`                                                                                                                 |
| `pinned-layers.ts`                                     | Runtime                                  | `pinInference`, the system prompt pin and the work pin of each stream call, and the state of the work pin ([Pinned layers](#pinned-layers)). Change: the signature is `setWork(work: WorkPin \| null)`, with `interface WorkPin { text: string }`. `null` clears the work pin. A `WorkPrompt` fits that shape, so the file imports no `prompt-composer.ts` and the worker call stays |
| `hooks/*.ts`                                           | Runtime                                  | The extensions of [Extension modules](#extension-modules)                                                                                                                                                                                                                                                                                                                            |
| `hooks/tool-approval.ts`                               | Workbench Service                        | Consumer hook of the Workbench. It moves to `src/workbench/tool-approval.ts` with the [Workbench change](#constraints-on-the-workbench-branch-at-rebase)                                                                                                                                                                                                                             |
| `agent-port.ts`                                        | Worker layer                             | It moves unchanged to `src/worker/unit/agent-port.ts`, next to its test of today. [L6](L6-worker.md) rewires it on the contract as the worker port `agent.open`                                                                                                                                                                                                                      |
| `session-directory.ts`, `review-roots.ts`              | Worker layer                             | They compute the session directory and the roots input ([L1 Tool inventory](L1-model.md#tool-inventory)). They move unchanged to `src/worker/unit/`                                                                                                                                                                                                                                  |
| `capabilities/*.ts`                                    | Worker layer                             | `executionEvidence`, `linkUpdates`, `SessionHostTools`, `asToolError`. They move unchanged to `src/worker/unit/capabilities/` ([L6](L6-worker.md#worker-capabilities))                                                                                                                                                                                                               |
| `HOST_TOOL_PARAMETERS` and two schemas of `catalog.ts` | Worker contract                          | `HOST_TOOL_PARAMETERS`, `EVIDENCE_UPLOAD_PARAMETERS` and `LINK_UPDATE_LIST_PARAMETERS` move to `src/worker/contract.ts`, next to `HostTool`. Their readers are `src/worker/tool-declarations.ts` and the capabilities                                                                                                                                                                |
| `hooks/sensitive-text-redaction.ts`                    | Split                                    | The state goes to `redaction.ts`, the factories to four hook modules ([Extension modules](#extension-modules)). `credentialSecrets` and `mergedSecrets` go to `src/llm/known-secrets.ts`, next to `frozenStore`                                                                                                                                                                      |
| `contract.ts`                                          | Server part                              | `AgentName`, the schemas, the operations. It imports `src/scheduler/contract.ts`, so no runtime file imports it                                                                                                                                                                                                                                                                      |
| `prompt-render.ts`                                     | Server part                              | The part reads: `layerOf`, `headingOf`, `promptPart`, `bindingParts`, `framing`. It keeps `finalPrompt` with the unresolved-part rule ([Composition function](#composition-function)). `systemPrompt` leaves                                                                                                                                                                         |
| `prompt-composer.ts`                                   | Server part                              | `renderWorkPrompt` and `digest`: the turn text from the templates of the server part                                                                                                                                                                                                                                                                                                 |
| `config.ts`, `index.ts`                                | Server part                              | The configuration schema and the exports of `AgentComponent`                                                                                                                                                                                                                                                                                                                         |
| Each other file of `src/agent/`                        | Server part                              | `service.ts`, `configuration.ts`, `enablements.ts`, `cooldowns.ts`, `migrations.ts`, `prompt-resolve.ts`, `prompt-source.ts`, `prompt-files.ts`, `instruction-files.ts`, `prompt-templates.ts`, as L1 assigns                                                                                                                                                                        |
| `test-support.ts`, `sensitive-text-test-support.ts`    | The owner of the modules that they serve | Test support. No production module imports them                                                                                                                                                                                                                                                                                                                                      |

### Import rule

Today the runtime imports three modules outside its allowed set:

- `src/worker/contract.ts`: `HostTool` and `LINK_UPDATE_LIMIT_*` in `catalog.ts`, `AgentSetup` and `ExecutionSetup` in `agent-port.ts`, `WorkerErrorCode` in `pi-tools.ts`, `HostTools` in `capabilities/host-tools.ts`.
- `src/tracking/contract.ts`: `SpanStatus` in `agent-port.ts`. That module imports `src/worker/contract.ts` (`src/tracking/contract.ts:25`).
- `src/custody/contract.ts`: `SecretShape` in `hooks/sensitive-text-redaction.ts`, for `credentialSecrets`.

The rulings:

1. **`SpanStatus`.** It leaves the runtime. The trace belongs to the consumer ([L1 Statelessness](L1-model.md#statelessness), check 4). `SessionTrace` moves with `agent-port.ts` to the worker layer, and the worker sets the span status from the [output](#output).
2. **`SecretShape`.** `credentialSecrets` and `mergedSecrets` read a pi `CredentialStore` that the consumer holds. They move to `src/llm/known-secrets.ts`. The runtime takes `KnownSecrets` as input and imports no custody module.
3. **The worker contract.** Each import leaves with the moves of the [file assignment](#file-assignment). The catalog owns the names of the worker tools. `HostTool` of `src/worker/contract.ts` keeps its values, and a unit rule of L6 asserts that they equal the catalog names.
4. **`ProviderFailure` (new design).** Today no runtime module imports `src/llm/provider-failure.ts`. `run-outcome.ts` adds that import for the failure kind. `src/llm/provider-failure.ts:1` imports `ProviderFailure` from `src/scheduler/contract.ts`, so the type moves to `src/llm/provider-failure.ts` ([L2 handoff to LA](L2-agent-cli.md#handoffs-to-later-layers)). `src/scheduler/contract.ts` imports it from there.

Change: the import check of [L1-D5](L1-model.md#decisions) uses an allowed set. The import closure of each runtime module, type imports included, holds only these modules:

- the built-in modules of Node;
- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` and `zod`;
- the modules of `src/kernel/`. The closure stops at a kernel module: a package that a kernel module imports is allowed, for example `simple-git` of `src/kernel/git-environment.ts`. No kernel module imports a module of a service today;
- `src/llm/provider-failure.ts`;
- the runtime modules of `src/agent/`;
- after the rebase of `feature/workbench-v2`: `@anthropic-ai/sandbox-runtime`, for `bash-sandbox.ts` ([Constraints on the Workbench branch at rebase](#constraints-on-the-workbench-branch-at-rebase)).

The check also refuses each reference to `setGlobalDispatcher` and `EnvHttpProxyAgent` in a runtime module ([L2 requirement 9](L2-agent-cli.md#requirements-on-l3)). pi does not export `configureHttpDispatcher` from `dist/index.d.ts`, so no runtime module can call it.

## Input and output contract

(G2)

### Input

```ts
export interface AgentInput {
  profile: ProfileName;
  model: ModelSelection;
  systemPrompt: string;
  workspace: Workspace;
  budget: RunBudget;
  session: SessionRecord;
  knownSecrets: KnownSecrets;
  childEnvironment: Readonly<Record<string, string>>;
  hostHome: string;
  consumerTools: readonly ToolDefinition[];
  signal: AbortSignal;
}

export interface ModelSelection {
  runtime: ModelRuntime;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
}

export interface Workspace {
  cwd: string;
  roots: readonly string[];
}

export interface RunBudget {
  deadline: number | null;
  usd: number | null;
}

export const SessionKind = {
  NewFile: "new_file",
  Memory: "memory",
} as const;

export interface NewFileSession {
  kind: typeof SessionKind.NewFile;
  path: string;
}

export interface MemorySession {
  kind: typeof SessionKind.Memory;
}

export type SessionRecord = NewFileSession | MemorySession;

export type KnownSecrets = () => Promise<readonly string[]>;
```

Each field and its reader:

| Field              | Rule                                                                                                                                                                                                                                                                                                                                                                            | Reader                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `profile`          | A name of the runtime catalog. The contract asserts it                                                                                                                                                                                                                                                                                                                          | Each consumer                                             |
| `model`            | The model runtime holds the credential store ([L1 LLM credential](L1-model.md#llm-credential)). `thinkingLevel` must be in `getSupportedThinkingLevels(model)` (`@earendil-works/pi-ai`, `dist/models.d.ts:262`). Else the open throws `agent.level_unsupported`. The contract never clamps. pi clamps the level (`dist/core/sdk.js:143`), and a supported level stays the same | Each consumer                                             |
| `systemPrompt`     | The composed system prompt, whole. The agent adds no text ([L1 boundary rule 3](L1-model.md#agentworker-boundary)). The server consumers pass `finalPrompt` of the server part. `run agent` passes `composeSystemPrompt(profilePrompt(profile), contextTexts)` ([Composition function](#composition-function))                                                                  | Each consumer                                             |
| `workspace.cwd`    | An absolute path. The working directory of the session and the `cwd` of the session header                                                                                                                                                                                                                                                                                      | Each consumer                                             |
| `workspace.roots`  | Absolute paths, not empty. The directories of the start preconditions and of the confinement                                                                                                                                                                                                                                                                                    | Each consumer                                             |
| `budget`           | `deadline` is an epoch time in milliseconds. Each `null` is no limit ([Budget](#budget))                                                                                                                                                                                                                                                                                        | `run agent`. L6 adds the worker as a reader of `deadline` |
| `session`          | [Session record](#session-record)                                                                                                                                                                                                                                                                                                                                               | Each consumer                                             |
| `knownSecrets`     | The source of the known secrets. The contract reads it at the open and at each turn start                                                                                                                                                                                                                                                                                       | Each consumer                                             |
| `childEnvironment` | The names of a child process and of the precondition `git` commands ([Child processes](#child-processes); [Start preconditions](#start-preconditions))                                                                                                                                                                                                                          | Each consumer                                             |
| `hostHome`         | The base of the `<cwd>` section that `homeRelativeCwd` writes                                                                                                                                                                                                                                                                                                                   | Each consumer                                             |
| `consumerTools`    | The pi tool definitions of declared consumer tools. A name outside the declared consumer tools of the profile makes the open throw `agent.tool_undeclared` ([L3-D6](#decisions))                                                                                                                                                                                                | Project Service; the Workbench branch after its rebase    |
| `signal`           | The stop signal. An abort starts the graceful stop ([Stop and forced stop](#stop-and-forced-stop))                                                                                                                                                                                                                                                                              | Each consumer                                             |

- The input names no execution, no claim, no node and no server address ([L1 boundary rule 1](L1-model.md#agentworker-boundary)). Change: today `SessionOpenRequest` carries `claim.execution_id` and `setup.agents` (`src/agent/agent-port.ts`).
- The [Workbench change](#constraints-on-the-workbench-branch-at-rebase) adds three inputs at the rebase of the branch, each with its reader: `workspace.confine`, the session kind `resume` and `bashSandbox`. They do not exist on `main` before that rebase.

### Session record

| Kind       | pi call                                                                                                                                                                 | Rule                                                                                                                                                                   | Consumer        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `new_file` | `SessionManager.open(path, dirname(path), cwd)`. With no file at the path, pi starts a new session and keeps the explicit path (`dist/core/session-manager.js:685-689`) | The contract asserts that `lstat` finds no entry at the path. pi creates the file at the first conversation entry with `openSync(path, "wx")` (`_persist`, `:794-814`) | `run agent`     |
| `memory`   | `SessionManager.inMemory(cwd)`                                                                                                                                          | No file. The consumer reads no record of the session                                                                                                                   | Project Service |

### Open order

`openAgent(input): Promise<AgentOpen>` does these steps in order:

1. Find the profile in the runtime catalog. Check the names of `consumerTools` against the declared consumer tools. Check `thinkingLevel`.
2. Check the [start preconditions](#start-preconditions) of the profile. A failure returns `AgentRefused` and does nothing else.
3. Compute `systemPromptDigest` of `systemPrompt`.
4. Read the known secrets once.
5. Load pi. Build the session manager of the [session record](#session-record), the wrapped `bash`, the guard list and the pi session runtime. The pi option `tools` holds the declared names of the session ([A declared consumer tool with no implementation](#a-declared-consumer-tool-with-no-implementation)). The option `customTools` holds the wrapped `bash` and `consumerTools`. Bind the error listener (`extensionRunner.onError`) after pi creates the session and before `bindExtensions`.
6. Pin the system prompt with `pinInference`. It takes the redacted system prompt of `sessionParts`, as today (`src/agent/agent-port.ts:205`; `src/agent/agent-session.ts:109-112`). Start the budget timer and the stop listener.
7. Return `AgentOpened`.

- Steps 1 and 2 write no file and send no request. Steps 3 to 6 send no provider request. `bindExtensions` emits only `session_start` ([L2 requirement 13](L2-agent-cli.md#requirements-on-l3)). pi writes the session file only at the first conversation entry, so a refused or failed open leaves no session file.
- **Failed open.** Each failure of the open that is no refusal throws one error class, `AgentOpenError`, with a code and a message. The message passes `exitText`.

| Code                      | Condition                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `agent.tool_undeclared`   | Step 1: a name of `consumerTools` is no declared consumer tool of the profile                                       |
| `agent.level_unsupported` | Step 1: the model does not support `thinkingLevel`                                                                  |
| `agent.open_failed`       | Steps 3 to 6: pi fails to load, a setup step passes `RUNTIME_SETUP_DEADLINE_MS`, a guard throws, or `signal` aborts |

- **Abort during the open.** An abort of `signal` before step 7 closes each part that the open made and throws `agent.open_failed` with the message `aborted`. No session file exists, because no conversation entry exists.

### Run handle

```ts
export const AgentOpenKind = {
  Refused: "refused",
  Opened: "opened",
} as const;

export interface AgentRefused {
  kind: typeof AgentOpenKind.Refused;
  refusal: StartRefusal;
}

export interface AgentOpened {
  kind: typeof AgentOpenKind.Opened;
  run: AgentRun;
}

export type AgentOpen = AgentRefused | AgentOpened;

export interface StartRefusal {
  precondition: StartPrecondition;
  reason: string;
}

export interface SendOptions {
  work: string | null;
}

export interface AgentRun {
  readonly systemPromptDigest: string;
  send(text: string, options: SendOptions): Promise<TurnEnd>;
  endAfterTurn(): void;
  forceStop(): TurnEnd;
  redactionSummary(): RedactionSummary;
  close(): Promise<void>;
}
```

- `send` passes `text` and `work` through the input redaction. It then sets the work pin of the pinned layers to the redacted `work` ([Pinned layers](#pinned-layers)). It calls `session.prompt(text, { expandPromptTemplates: false })` and waits for the end of the agent loop. One `send` runs at a time; a second call during a `send` throws.
- `work` is the work pin: the task text that stays in each stream call after a compaction ([Pinned layers](#pinned-layers)). A text replaces the pin, and `null` clears it. Example: the worker sends the work prompt "Implement node N, criterion C" with `work` equal to that prompt. A later `send` of "The verification failed: ..." keeps `work` equal to the work prompt. `run agent` passes its message as `work`.
- `endAfterTurn` ends the agent loop at the end of the current turn, after each tool result of the batch ([Project Service](#project-service)). The contract reads the flag in its `finishTurn` ([Budget](#budget)). The end is `completed`. Each `send` clears the flag at its start, so a flag that a tool sets late in one `send` does not end the next `send`.
- `forceStop` returns at once ([Stop and forced stop](#stop-and-forced-stop)).
- `redactionSummary` gives the counts of [Redaction counts](#redaction-counts).
- `close` aborts the session, disposes the runtime through `closeRuntime`, and kills each child process that is still alive. `closeRuntime` waits at most `RUNTIME_SETUP_DEADLINE_MS` (30 s) for the abort and the dispose. After that limit, it disposes the session with no wait (`src/agent/agent-session.ts`). A second `close`, or a `close` after `forceStop`, does nothing.

### Output

```ts
export const RunEnd = {
  Completed: "completed",
  BudgetEnd: "budget_end",
  Stopped: "stopped",
  Failed: "failed",
} as const;
export type RunEnd = (typeof RunEnd)[keyof typeof RunEnd];

export const BudgetLimit = {
  Wall: "wall",
  Usd: "usd",
} as const;
export type BudgetLimit = (typeof BudgetLimit)[keyof typeof BudgetLimit];

export const FailureClass = {
  Retryable: "retryable",
  Terminal: "terminal",
} as const;
export type FailureClass = (typeof FailureClass)[keyof typeof FailureClass];

export const InternalFailure = {
  Internal: "internal",
} as const;

export interface TurnEnd {
  end: RunEnd;
  budgetReached: BudgetLimit | null;
  failure: RunFailure | null;
  text: string | null;
  totals: RunTotals;
  warnings: readonly SecretWarning[];
}

export interface RunFailure {
  kind: ProviderFailure | typeof InternalFailure.Internal;
  class: FailureClass;
  reason: string;
}

export interface RunTotals {
  modelCalls: number;
  toolCalls: number;
  usage: TokenUsage;
  listPriceUsd: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SecretWarning {
  rule: SensitiveRule;
  count: number;
}
```

| Field           | Value                                                                                                                                               | Reader          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `end`           | [End and class](#end-and-class)                                                                                                                     | Each consumer   |
| `budgetReached` | The first limit that ended the run, for `budget_end`; else `null`                                                                                   | `run agent`     |
| `failure`       | For `failed` only. `reason` is the error text after `exitText`                                                                                      | Each consumer   |
| `text`          | `getLastAssistantText()` after `exitText`, or `null` with no assistant text                                                                         | `run agent`; L6 |
| `totals`        | The totals since the open: the assistant messages, the tool call blocks of the assistant messages, the token sums and the sum of `usage.cost.total` | `run agent`; L6 |
| `warnings`      | The rotate warnings since the last `send` returned, in order ([Rotate warning](#rotate-warning))                                                    | `run agent`; L6 |

**What the output fixes.** These rules hold for each run, also with a real model:

- Each `TurnEnd` has every field of its type.
- `end` is one of the four values. `budgetReached` is not `null` only for `budget_end`. `failure` is not `null` only for `failed`.
- `systemPromptDigest` is a pure function of the input. Two runs with the same input give the same digest.
- Each text of the output passes `exitText`.
- `totals` equals the sums over the assistant messages since the open.
- Each child process ends before `send` returns.

**What the output does not fix.** These parts depend on the model and the provider: the model text, the tool calls and their order, the values of `totals` and `warnings`, and the end of a run. An acceptance check asserts exact values only because the LLM stub scripts the model.

### Events

- The L3 contract emits no event and has no `observe` input. Reason: no L3 consumer reads an event. `run agent` reads only `TurnEnd`. The first readers are the worker ([L6](L6-worker.md)) and the Workbench branch at its rebase ([Constraints on the Workbench branch at rebase](#constraints-on-the-workbench-branch-at-rebase)).
- No consumer gets the `AgentSession`, the session manager or a raw message. Change: today `PortSession` gives `session` to the worker (`src/agent/agent-port.ts`), and the Workbench and the Project Service hold the `AgentSession`.
- **Constraints on the reader that adds events.**
  - Each event passes `exitValue` on a deep copy: `redactValue` with the known matcher of the session.
  - The contract forwards no `message_update` event until a reader needs it. Its partial `message` can end in a prefix of a known secret that `exitValue` does not match. The known matcher finds a part of a secret only at a line start or before a truncation marker (`src/agent/sensitive-text.ts:1299-1330`).
  - A reader that needs `message_update` adds a hold-back. The contract keeps back the end of a streamed block when that end has 4 or more characters and is a prefix of a known secret. A shorter prefix passes. A streamed block is a text, thinking or tool-argument block.
  - The `entry` event of an assistant message comes before the `tool_execution_start` event of each of its tool calls. pi persists a message at its `message_end` (`_handleAgentEvent`), and the worker span attribute `kanthord.session.entry_id` needs this order.

**Example.** The model streams `The key is sk-abc123XYZ789qwe`, and K = `sk-abc123XYZ789qwe` is a known secret.

| Piece | `delta`       | Partial `message` text          | Text after `exitValue`                 |
| ----- | ------------- | ------------------------------- | -------------------------------------- |
| 1     | `The key is ` | `The key is `                   | `The key is `                          |
| 2     | `sk-abc123`   | `The key is sk-abc123`          | `The key is sk-abc123`                 |
| 3     | `XYZ789qwe`   | `The key is sk-abc123XYZ789qwe` | `The key is <redacted:llm_credential>` |

Piece 2 shows the first 9 characters of K. With the deltas, a reader joins pieces 2 and 3 and gets all of K. The hold-back keeps back `sk-abc123` until piece 3 arrives.

### Requirement map

Each requirement of [L2](L2-agent-cli.md#requirements-on-l3) and the contract part that meets it. L3 meets each requirement.

| L2 requirement                     | Contract part                                                                                                                                                                                                                                                                | Check                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1. Input                           | `AgentInput`: `systemPrompt` from `composeSystemPrompt(profilePrompt(profile), contextTexts)`, `workspace` `{ cwd: W, roots: [W] }`, `session.kind` `new_file`, no `consumerTools`. The message goes to `send` with `work` equal to the message. No clamp of `thinkingLevel` | L2-AC1, L2-AC13, L3-U7 |
| 2. Catalog                         | `getProfile` and `PROFILE_NAMES` of `catalog.ts`; `profilePrompt` and `composeSystemPrompt` of `prompt-chain.ts`                                                                                                                                                             | L2-AC8, L3-U2          |
| 3. Declared consumer tools         | The pi option `tools` holds the declared names. pi declares only a registered tool ([A declared consumer tool with no implementation](#a-declared-consumer-tool-with-no-implementation))                                                                                     | L2-AC1, L3-AC3         |
| 4. Start refusal                   | `AgentOpen` `refused` with `StartRefusal`, at step 2 of the [open order](#open-order)                                                                                                                                                                                        | L2-AC12, L3-AC5, L3-U4 |
| 5. Session file                    | `SessionRecord` `new_file`; the header `cwd` is `workspace.cwd`                                                                                                                                                                                                              | L2-AC1, L2-AC3         |
| 6. Output                          | `TurnEnd`, `systemPromptDigest`                                                                                                                                                                                                                                              | L2-AC1, L2-AC10, L3-U5 |
| 7. Exit redaction                  | `exitText` on `text`, `failure.reason` and the `AgentOpenError` message. The contract emits no event ([Events](#events))                                                                                                                                                     | L2-AC4, L1 U3          |
| 8. Silence                         | No runtime module writes to `process.stdout` or `process.stderr`. The extension errors go to the error listener                                                                                                                                                              | L3-U7                  |
| 9. No proxy from the environment   | The [import rule](#import-rule) refuses `setGlobalDispatcher` and `EnvHttpProxyAgent`                                                                                                                                                                                        | L2-AC2, L1 U15         |
| 10. pi directory and resources     | `sessionParts`: `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`, `SettingsManager.inMemory`, the model runtime as service                                                                                                                      | L2-AC2, L2-AC7         |
| 11. Budget                         | `RunBudget.deadline`, `RunBudget.usd`; `budgetReached`                                                                                                                                                                                                                       | L2-AC10, L3-U6         |
| 12. Place of the context texts     | `composeSystemPrompt` places the context texts after the profile prompt ([Prompt chain](#prompt-chain))                                                                                                                                                                      | L2-AC8, L3-AC2, L3-U1  |
| 13. No request at the open         | [Open order](#open-order)                                                                                                                                                                                                                                                    | L2-AC12, L3-U7         |
| 14. Child processes                | `killGroupAtEnd` on each command; `ToolProcesses.killAll` at the end of `send` and at `close`                                                                                                                                                                                | L2-AC11, L3-U11        |
| 15. Child environment              | [Child processes](#child-processes)                                                                                                                                                                                                                                          | L2-AC2, L3-U11         |
| 16. Error text of a failed request | `inputRedaction` redacts the `errorMessage` of an `assistant` message ([Redaction](#redaction))                                                                                                                                                                              | L3-AC1, L2-AC10        |
| 17. Abort                          | `signal` ([Stop and forced stop](#stop-and-forced-stop))                                                                                                                                                                                                                     | L2-AC11, L3-U7         |
| 18. Forced stop                    | `forceStop()`                                                                                                                                                                                                                                                                | L3-U7; L2 unit rule 11 |

## Profile catalog

(G3)

### Coding tools

Change: the runtime catalog lists every profile that opens an agent session. `AGENT_NAMES` of the server part keeps the configuration owners. Today `AGENT_DECLARATIONS` holds `swe@1`, `re@1` and `env@1` (`src/agent/catalog.ts`).

The full tool set of each profile:

| Profile | Agent tools                                           | Declared consumer tools                       | Confined | Start preconditions                                | Profile prompt                         |
| ------- | ----------------------------------------------------- | --------------------------------------------- | -------- | -------------------------------------------------- | -------------------------------------- |
| `swe@1` | `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash` | `host`: `evidence-upload`, `link_update_list` | No       | `workspace_directory`, `git_worktree`, `git_clean` | Standard, coding text, `role/swe@1.md` |
| `re@1`  | `read`, `grep`, `find`, `ls`                          | none                                          | Yes      | `workspace_directory`                              | Standard, coding text, `role/re@1.md`  |
| `env@1` | `read`, `grep`, `find`, `ls`                          | `environment`: `probe`, `environment_write`   | Yes      | `workspace_directory`                              | Standard, `env@1.md`                   |

- `re@1` and `env@1` are confined. Change: confinement is the property `confined` of the profile. Today `CONFINED_AGENTS` holds only `re@1` (`src/agent/catalog.ts`), and the Project Service adds the confinement to `env@1` itself (`src/project/environment-agent.ts:306`).
- The Workbench branch adds its profiles and tools at its rebase ([Constraints on the Workbench branch at rebase](#constraints-on-the-workbench-branch-at-rebase)).

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
- The declared names of a session are the agent tools of the profile plus each consumer tool name of every field.
- `WorkerTool` holds `evidence-upload` and `link_update_list`. Their parameter schemas move to `src/worker/contract.ts`.
- `TOOL_CATALOG` keeps one location list for each declared tool, also an empty list ([L1 tool ownership rule 7](L1-model.md#tool-ownership-rule)). Today `bash` has no entry (`src/agent/catalog.ts:70-81`). So the confinement blocks `bash` in a confined session with `The tool bash has no location rule in this session.` (`src/agent/hooks/checkout-confinement.ts`). No confined profile declares `bash` today, so no entry has a reader.

### A declared consumer tool with no implementation

- The contract passes the declared names of the session in the pi option `tools`. pi declares a tool to the model only when the tool is registered (`_applyToolLoadout` in `dist/core/agent-session.js:1155-1159`). A declared name with no implementation is thus absent from the model request, and the session opens and runs ([L2 requirement 3](L2-agent-cli.md#requirements-on-l3)).
- A model call of a name that is not active gets the pi result `Tool <name> not found` (`@earendil-works/pi-agent-core`, `dist/agent-loop.js:481-488`). No `tool_call` handler runs for it. Example: `run agent swe@1` gives no implementation of `evidence-upload` and `link_update_list`.
- pi registers no tool outside the option `tools`, also no tool of `customTools` or of an extension (`_refreshToolRegistry`, `dist/core/agent-session.js:2808-2821`; `_isAllowedTool`, `:1118-1124`). An extension tool that the profile does not declare thus gets `Tool <name> not found` at a call, and its implementation does not run.
- Change: a name of `consumerTools` outside the declared consumer tools makes the open throw `agent.tool_undeclared`. Reason: pi drops it with no signal, and the consumer then believes that the model has the tool.
- **Reach of the allowlist guard.** pi keeps an MCP tool registered unless the allowlist filters MCP (`_isAllowedTool`). A tool can call a registered `codemode` or `deferred` tool through `ctx.executeTool` (`_getCallableTools`, `:1140-1148`). That nested call reaches `tool_call`. The allowlist guard blocks only such a nested call of a name outside the declared names. [L1 U6](L1-model.md#unit-level-rules) is a unit test of the handler.

## Profile prompts

(G4)

### Prompt chain

The KanthorD prompt chain of a session, in this order:

1. **Profile prompt.** The Standard (`base.md`), the shared coding text (coding profiles only), the Role.
2. **Repository prompt place, layer 2.** The instruction file and the stored Repository prompt of each repository; for `run agent`, the context texts in input order.
3. **Binding prompt place, layer 3.** The Binding prompt of each repository.
4. **Consumer texts.** The framing of the consumer (worker or Workbench).

**Add a part.** The chain is one ordered list of `PromptText` parts. One join makes the system prompt ([Composition function](#composition-function)).

- Add a profile part in `profilePrompt`, at its place in layer 1.
- Add a consumer part to the instruction list before the framing. The framing stays last, and `finalPrompt` asserts it.
- A later part governs an earlier part.
- Each new part of the server part gets a `PromptPart` kind, so its reference reaches the span.
- L3-U1 proves the byte-equal text of each consumer of today.

The precedence of [agent.md](../agent.md#prompt-composer) stays. `run agent` has no layer 3 text and no framing. In stage 2, the [evaluation](L4-agent-evaluation.md#one-evaluation-run) gives the binding prompt of a kind of project as one context text. The Workbench part `workbench.md` stays in layer 1 after the Role, as today (`promptFiles` in `src/agent/prompt-files.ts`).

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
- This is the join of today: `partText` and the join of `finalPrompt` (`src/agent/prompt-render.ts:204-216`).
- **Callers.** `composeSystemPrompt` has two callers:
  - `run agent`: `composeSystemPrompt(profilePrompt(profile), contextTexts)`, each context text with no heading ([L2 Prompt](L2-agent-cli.md#prompt), rule 3). It passes the result in `systemPrompt`.
  - `finalPrompt` of `prompt-render.ts`, in the server part. It keeps the unresolved-part rule of today. It asserts that the last part is the framing. It returns `null` when a part is not resolved. Else it maps the parts to `PromptText` and calls `composeSystemPrompt`. Its callers stay: `prompt-resolve.ts`, `service.ts` and `src/worker/execution-setup.ts`.
- Change: `systemPrompt` of `prompt-render.ts` leaves ([L1-D10](L1-model.md#decisions)). Its two callers, the Workbench Service and the Project Service, append the framing part and call `finalPrompt`. They assert that the result is not `null`. The composed text of a worker execution, a Workbench session and an `env@1` session stays byte-equal ([L3-D8](#decisions)).
- `profilePrompt` gives the shipped parts of a profile, each with no heading.
- `systemPromptDigest` is the SHA-256 hex digest of the output of `composeSystemPrompt`. It takes the text before the input redaction and before pi adds `<cwd>` (`dist/core/system-prompt.js:110`). Reason: the marker of a redacted value holds a random tag per session (`tag` in `sensitiveTextRedaction`). So a digest after the redaction differs between two runs with the same input.

### Prompt files

The shared coding text is the three sections `## Code principles`, `## Code` and `## Tests`. Today `swe@1.md` and `re@1.md` hold these three sections byte-equal (`static/prompt/swe@1.md`, `static/prompt/re@1.md`).

| File (new)                    | Content                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `static/prompt/coding.md`     | The sections `## Code principles`, `## Code` and `## Tests` of `swe@1.md`, byte-equal                     |
| `static/prompt/role/swe@1.md` | `## Role` of `swe@1.md`; `## Execution` of `swe@1.md` less the protocol text; `## Findings` of `swe@1.md` |
| `static/prompt/role/re@1.md`  | `## Role` of `re@1.md`; `## Judgement` items 1 to 7 of `re@1.md`                                          |

The protocol text that leaves `## Execution` ([L1 boundary rule 7](L1-model.md#agentworker-boundary), [L1-D12](L1-model.md#decisions)):

- Item 4 loses the sentence "The worker runs the verifications after the turn."
- Item 5 changes in two ways:
  - It loses the sentence "The worker merges the base branch itself."
  - Its first sentence names the node branch, so it becomes: "**Merge no branch.** Merge, rebase or cherry-pick no other branch into the branch of the workspace."
- In `re@1.md`, item 8 of `## Judgement` and the section `## Findings` leave.

- No Role holds a convention of one repository ([L1 E1, fit rule 6](L1-model.md#e1-project-context-through-the-binding-prompt-fits-with-a-fit-rule)).
- The worker path keeps `swe@1.md` and `re@1.md` of today in layer 1. [L6](L6-worker.md#worker-instructions) moves the worker path to the chain. It adds the part `coding` to `PromptPart`. It points the server Role at `role/<name>.md` and deletes the old files. Until then the text exists twice, and [L3-U3](#unit-level-rules) fails on a difference. A change of the `swe@1` text from the [evaluation](L4-agent-evaluation.md) edits both copies in one change.
- The build adds each new file of `static/prompt/` to the shipped assets (`shippedAsset` in `src/kernel/assets.ts`).

## Start preconditions

(G5)

```ts
export const StartPrecondition = {
  WorkspaceDirectory: "workspace_directory",
  GitWorktree: "git_worktree",
  GitClean: "git_clean",
} as const;
export type StartPrecondition =
  (typeof StartPrecondition)[keyof typeof StartPrecondition];
```

| Id                    | Pass condition                                                                                                                 | Reason text                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `workspace_directory` | `workspace.cwd` and each root are absolute paths of directories that exist (`stat`)                                            | `the working directory or a root is no directory` |
| `git_worktree`        | For each root, `git -C <root> rev-parse --show-toplevel` exits `0` and prints the real path of the root (`realpath`)           | `a root is not the top level of a git worktree`   |
| `git_clean`           | For each root, `git -C <root> --no-optional-locks status --porcelain=v1 --untracked-files=normal` exits `0` and prints nothing | `a root holds an uncommitted change`              |

- The checks run in the order of the profile list, root by root. The first failure gives the refusal. `StartRefusal.reason` is `<id>: <reason text>`. `run agent` writes it in the `reason` row of `cli.run.agent.start_refused` ([L2 Run order](L2-agent-cli.md#run-order), step 9). The reason holds no path.
- `git_worktree` is stricter than "inside a git worktree": a subdirectory of a worktree fails. Reason: a session in a subdirectory changes files that `git_clean` of that subdirectory does not see.
- An ignored file is no uncommitted change. An untracked file that no ignore rule covers is an uncommitted change.
- **Environment.** Each `git` command runs with `isolatedGitEnvironment(childEnvironment({ ...input.childEnvironment, PATH }))`. `PATH` is the `PATH` of `input.childEnvironment` when the input holds one. Else it is the `PATH` of the runtime process. No other name of the runtime process reaches the check. `isolatedGitEnvironment` (`src/kernel/git-environment.ts`) sets no global and no system configuration, `core.excludesFile` and `core.attributesFile` to `/dev/null`, `core.hooksPath` to `/dev/null` and `core.fsmonitor` to `false`.
- **What runs.** The check runs no fsmonitor command and no hook. A `filter.<driver>.clean` or `filter.<driver>.process` command of the repository configuration can run, when `git status` hashes a file that an attribute assigns to that driver. The contract does not disable filters, because Git LFS and other filter drivers need them.
- **No write.** `--no-optional-locks` stops the refresh write of the index, so the check changes no file of the workspace ([L1 AC10](L1-model.md#checks)).
- **Differences from a `git status` of the developer.** The global ignore file and the global filter drivers are absent. A file that only a global ignore rule covers is thus an uncommitted change. [LA](LA-agent-build.md) writes this text in `docs/cli/run.md`.
- Each command has the deadline `RUNTIME_SETUP_DEADLINE_MS` (`src/agent/agent-session.ts`). A timeout fails the precondition of that command.
- **Every consumer.** The list holds for every consumer ([L1 handoff](L1-model.md#handoffs-to-later-layers)). The worker gives roots that pass: the checkouts of a node, each the top level of a git worktree with no uncommitted change. [L6](L6-worker.md) states the roots of each chain.
- **Read-only profiles.** `re@1` and `env@1` declare only `workspace_directory`. They change no file, so a change in their workspace cannot mix with their work.
- **Resume.** The session kind `resume` arrives with the [Workbench change](#constraints-on-the-workbench-branch-at-rebase), with its precondition rule.
- Change: today `openSession` checks no precondition (`src/agent/agent-session.ts`).

## Guards

(G6)

### Guard order

`sessionParts` builds the extension list of each contract session in this order. pi runs the handlers of one event in extension order, and the first `block` of `tool_call` wins (`emitToolCall`, `dist/core/extensions/runner.js:957-972`).

1. `homeRelativeCwd(hostHome)`: the `<cwd>` section.
2. `toolAllowlist(declaredNames)`: blocks a nested call of a name outside the declared names of the session ([Reach of the allowlist guard](#a-declared-consumer-tool-with-no-implementation)).
3. `markerRestore(state)`: restores a marker of this session into `write` and `edit`. It blocks a known-secret marker in every tool and each marker in `bash`. In `write` and `edit`, it blocks a marker of an earlier run and an unkept marker. It passes other markers as text. It blocks a known secret as raw text in each tool input ([Known secret in a tool input](#known-secret-in-a-tool-input)). `state` is the redaction state of `redaction.ts`: `inputRedaction` writes the marker table, and `markerRestore` reads it.
4. `checkoutConfinement({ cwd, roots })`, when the profile is confined. It checks the input after the restore and freezes it.
5. `pinnedLayersHook`: the work pin of each agent-loop request ([Pinned layers](#pinned-layers)).
6. The place of the consumer extensions that [L6](L6-worker.md) adds: worker capabilities and consumer hooks, in input order, for example `toolApproval`.
7. `inputRedaction(state)`: the input redaction at `message_end` and `context`. It runs after each consumer handler, so it redacts the final message.
8. `outputFinding(state)`: the rotate warning at `message_end` of an `assistant` message.

- No consumer can remove or reorder a guard: the consumer gives only item 6 ([L1-D8](L1-model.md#decisions)).
- Change: today the order is `homeRelativeCwd`, `restore`, the hooks of the consumer, `hook` (`src/agent/agent-session.ts:124-127`). Only `agentPort` adds `toolAllowlist` and the confinement (`guardsOf`, `src/agent/agent-port.ts:119`). On the contract path, the restore moves after the allowlist, so the restore acts only on a declared tool. The confinement stays after the restore.
- Each guard handler catches its own error and fails closed. The allowlist, the restore and the confinement block. The input redaction writes the failure marker. pi catches a handler error, emits it and keeps the message (`emitMessageEnd`, `dist/core/extensions/runner.js:864-899`). The error listener of the contract then ends the run with the end `failed` and the failure `internal`.
- The open paths of today keep their own guard list until their consumers move ([Open paths until L6 and the Workbench change](#open-paths-until-l6-and-the-workbench-change)).

### Allowlist block text

The block text of `toolAllowlist` is fixed once, as today (`src/agent/hooks/tool-allowlist.ts`):

```text
The tool <name> is not declared for this agent.
```

`<name>` is the tool name of the call. [L1 U6](L1-model.md#unit-level-rules) compares with this text.

### Confinement roots

- The roots input is `workspace.roots`, and the base of a relative path is `workspace.cwd`.
- `run agent`: `cwd` and the one root are the workspace ([L2 Options](L2-agent-cli.md#options)).
- Worker: [L6](L6-worker.md) gives the roots. Today `planOf` gives the review directory and its evidence placement (`reviewRootsOf`, `src/agent/review-roots.ts`).
- Project Service: the checkout is `cwd` and the one root, as today (`src/project/environment-agent.ts:306`).

### Pinned layers

Each contract session holds two pin mechanisms. A stream call is each call of `streamFunction` of the pi agent. An agent-loop request is a stream call of the agent loop. Each mechanism covers its own set of stream calls. pi `1.1.0` keeps the last 20000 tokens of a session as they are (`keepRecentTokens`, `dist/core/compaction/compaction.js:53-57`). A compaction replaces each older entry with a summary that the model writes. pi can compact inside one `send`, before the next assistant response (`dist/core/agent-session.js:424-432`, `:541`).

- **Work pin.** It keeps the task text in each stream call. Reason: after a compaction, the first user message is a model summary, not the task text.
- **System prompt pin.** It keeps the composed system prompt in each stream call. No consumer sets it.
- **`pinnedLayersHook`: each agent-loop request.** pi emits the event `context` before each agent-loop request (`dist/core/sdk.js:278-283`; `@earendil-works/pi-agent-core`, `dist/agent-loop.js:263-264`). The hook adds the work pin to that request.
- **`pinInference`: each stream call.** It wraps `streamFunction` of the pi agent, so each stream call goes through it. pi sends each compaction summary request through `streamFunction` with no `context` event (`dist/core/agent-session.js:2144-2148`). `pinContext` adds the composed system prompt first when the first message does not hold it (`src/agent/pinned-layers.ts:52-61`). It adds the work text after the system messages when no user message equals it (`:64-71`).

| Stream call                | System prompt pin                                                                                                                             | Work pin                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Agent-loop request         | Adds nothing: the system message of the request is the composed text                                                                          | `pinnedLayersHook` adds it at `context`. `pinContext` then finds it and adds nothing |
| Compaction summary request | Adds the composed text before `SUMMARIZATION_SYSTEM_PROMPT`, the system message of the summary (`dist/core/compaction/compaction.js:498-509`) | `pinContext` adds it                                                                 |

**How the work pin works at `context`.**

1. pi emits the event `context` before each agent-loop request. The event holds the messages that pi built from the session for that request, with no system message (`dist/core/extensions/runner.js:1012-1014`).
2. `pinnedLayersHook` removes each earlier `kanthord.prompt-layer` message from that list.
3. It looks for a user message whose text equals the work pin.
4. When no such message exists, it inserts one hidden custom message (`customType` `kanthord.prompt-layer`, `display: false`) with the work pin at the head of the list.
5. pi puts the current system message in front of the returned list (`restoreSystemMessages`, `dist/core/extensions/runner.js:101-106`).
6. The insert holds for that request only. pi appends nothing to the session file.
7. `inputRedaction` runs later at the same `context` event, so it redacts the inserted message.

**Example.** The worker runs `swe@1` with the work prompt as its first message and as `work`.

| Moment                                           | Messages that pi builds                                                        | Insert                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Turn 3, before a compaction                      | System message, the work prompt, the turns since                               | None: a user message equals the work pin                   |
| The compaction summary request                   | `SUMMARIZATION_SYSTEM_PROMPT`, the summary prompt                              | `pinContext` adds the composed text and the work prompt    |
| Turn 40, after a compaction at about 180k tokens | System message, the summary, the last 20000 tokens, "Verification failed: ..." | The work prompt, after the system message                  |
| Each later request of the session                | As turn 40, plus the new turns                                                 | The work prompt again, because the session never stores it |

- Change: none. Both mechanisms stay as today: `pinnedLayersHook` (`src/agent/hooks/pinned-layers.ts:20-50`) and `pinContext` (`src/agent/pinned-layers.ts:52-71`). The worker path of today adds `pins.hook` to its hooks and calls `pinInference` (`src/agent/agent-port.ts:169-205`).
- `src/worker/unit/pinned-layers.test.ts` asserts both request sets today (`:40-124`, `:186-239`, `:241-447`). It moves to `src/agent/pinned-layers.test.ts`, next to `pinned-layers.ts`. The moved test uses Faux and the test consumer of the [L1 shared fixtures](L1-model.md#shared-fixtures). It drops its imports of `src/worker/unit/test-support.ts`, `prompt-composer.ts`, `prompt-render.ts`, `prompt-templates.ts` (`SHIPPED_TEMPLATES`), `openSession`, `countTurns` and `getAgentDeclaration(...).agent_prompt`.

## Redaction

(G6)

### Build change of the session file

This is the build change of [L1 Session file](L1-model.md#session-file) on the contract path.

- **Removed** (`src/agent/hooks/sensitive-text-redaction.ts:105-111`, `:368-388`, `:544-581`):
  - the redaction of the `assistant` message with rule 0 at `message_end`;
  - `keepThinking` and the count `thinking_kept`;
  - the redaction of the compaction summary at `context` and at `session_compact`, and the count `compaction_residual`.
- **Kept.** The input redaction of each `system`, `user`, `toolResult` and `custom` message at `message_end`, and of each `custom` message at `context`. The redaction of the system prompt before pi gets it (`text`, `src/agent/agent-session.ts`). The restore of `write` and `edit` arguments. `modelOutput`, now `exitText`.
- **Error text.** `inputRedaction` redacts the `errorMessage` field of an `assistant` message at `message_end`, and no other field of that message. pi replaces the message in place, so the agent state, the events and the session file get the redacted copy (`_replaceMessageInPlace`, `dist/core/agent-session.js:864-877`).
- **Custom entries.** No contract consumer writes a custom entry before [L6](L6-worker.md). L6 adds `appendCustom(customType, data)`, which redacts each string of `data` with `text` before pi writes the entry.
- The open paths of today keep the redaction of LLM output until their consumers move ([Interim redaction](#interim-redaction)).

### Known secret in a tool input

- Today the assistant redaction replaces a known secret in the tool call arguments with a marker. pi replaces the message in place, so the tool runs with the marker, and the restore blocks a credential marker in every tool (`RestoreReason.Credential`; AH-Q3 in [HANDOFF.md](../HANDOFF.md#agent-component): "A rule 0 value blocks in every tool").
- R2-H keeps the arguments as the model gave them. Without a new rule, a `bash` call with the raw key runs, for example `curl` with the key. That makes AH-Q3 weaker.
- Change: `markerRestore` also blocks a call when a string of its input holds a known secret, in every tool. The matcher is the known-secret matcher of the session (`secretMatcher` in `sensitiveTextRedaction` today). The block reason is new:

  ```text
  The input holds a value of a known credential. No tool receives this value.
  ```

- The block changes no recorded response: the assistant entry keeps the arguments. It counts as `restore_blocked`. The finding of the same value counts once, in [Rotate warning](#rotate-warning).

**Example of the restore and the block.**

1. `.env` holds `STRIPE_SECRET_KEY=sk_live_51HxQ...` and `DEBUG=false`.
2. The model reads `.env` and sees `STRIPE_SECRET_KEY=<redacted:saas_token:b:jpdkbcmenfgahilo>`.
3. The model calls `edit` with `oldText` `STRIPE_SECRET_KEY=<redacted:saas_token:b:jpdkbcmenfgahilo>` plus `DEBUG=false`, and `newText` with `DEBUG=true`.
4. `markerRestore` replaces the marker in both strings with `sk_live_51HxQ...`. The edit matches the file, and the key stays. The assistant entry keeps the marker.

With no restore, the edit fails, because `oldText` is not in the file. A `write` gives `.env` the marker text, and the Stripe key is lost. The restore never gives back a known secret (`markerRefusal`, `src/agent/hooks/sensitive-text-redaction.ts:200-214`; the restored-value block, `:483-485`). When the model calls `bash` with `curl -H "x-api-key: <raw LLM key>"`, the call blocks with `The input holds a value of a known credential. No tool receives this value.`

### Rotate warning

- `outputFinding` scans the `content` of an `assistant` message at `message_end` with the known-secret matcher. It scans each string: text, thinking, the thinking signature and the tool call arguments. It does not scan `errorMessage`.
- One `assistant` message with one or more findings gives one `SecretWarning`. `rule` is `llm_credential`, the rule of each known secret (`SensitiveRule.LlmCredential`, `src/agent/sensitive-text.ts`). `count` is the number of findings in that message.
- The warning refuses nothing and changes no message. It holds no value, no marker index, no tag, no length and no digest of a value.
- The contract puts each warning in `TurnEnd.warnings`. `run agent` writes it as the line `cli.run.agent.secret_exposed` with this `rule` and `count` ([L2 stderr](L2-agent-cli.md#stderr), item 2). [L6](L6-worker.md) records it as a telemetry finding.

### Exit redaction

The contract applies the exit redaction at its output, so no consumer can omit it ([L1 Session file](L1-model.md#session-file), "Exit redaction").

| Output                                                            | Function    | Form                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TurnEnd.text`, `RunFailure.reason`, the `AgentOpenError` message | `exitText`  | The session marker `<redacted:RULE:N:TAG>` of the pattern rules and the known secrets. Today `modelOutput` (`src/agent/hooks/sensitive-text-redaction.ts`)                                |
| Each event that L6 adds                                           | `exitValue` | `redactValue` of a deep copy with the known matcher of the session ([Events](#events)). Today `sessionEntryRecord` does this in the worker (`src/worker/unit/session-entries.ts:122-137`) |

- Change: the Workbench Service and the Project Service get the exit redaction when they move to the contract. Today they read the session events and `session.state.errorMessage` with no exit redaction (`src/workbench/service.ts`, `agent.subscribe`; `src/project/environment-agent.ts:331`).
- **Full-entry read of a session file.** The server can ask a worker for one entry of a session file (`SessionRead`). The worker reads it with no redaction (`readSessionFileEntry` in `src/worker/unit/session-store.ts:236-275`). Today the file holds LLM output after the `assistant` redaction, so the read gives no known secret of the LLM output. At the end of an execution, the worker discards the credential views and zeroes the handover keys (`discard` in `src/apps/worker/handover.ts:295-302`). A later read thus has no known secret to match. [L6](L6-worker.md) rules this path before the worker path drops the interim redaction.

### Redaction counts

```ts
export interface RedactionCounts {
  redacted: Partial<Record<SensitiveRule, number>>;
  scan_failed: number;
  unkept: number;
  restore_blocked: number;
  output_found: Partial<Record<SensitiveRule, number>>;
  thinking_kept: number;
  compaction_residual: number;
}
```

- `output_found` is new: the findings of [Rotate warning](#rotate-warning). Only `outputFinding` writes it.
- `thinking_kept` and `compaction_residual` stay until the interim module leaves. Only `assistantRedaction` writes them, and the fields leave with it.
- The contract `redactionSummary` gives `redaction_count`, `redaction_rules`, `redaction_failed`, `unkept`, `restore_blocked`, `output_found_count` and `output_found_rules`. `redactionSummary(counts)` of the open paths of today keeps its fields of today. [L6](L6-worker.md) renames the span attributes of the worker.

### Interim redaction

- The worker, the Workbench of `main` and the Project Service open sessions with the open paths of today until their consumers move. The worker sends session entries and gives the full-entry read of [Exit redaction](#exit-redaction). The Workbench and the Project Service read the session events with no exit redaction. With the removal of the `assistant` redaction, a key in LLM output then reaches the server records and the Workbench views. That makes a rule of today weaker.
- Change: `sessionParts` adds `assistantRedaction(state)` after `inputRedaction` on each open path of today: `openSessionRuntime` and `openSession`. It keeps the three redactions of LLM output of today and their counts.
- `assistantRedaction` and `outputFinding` are never in one session. The contract path holds `outputFinding` and no `assistantRedaction`. The open paths of today hold `assistantRedaction` and no `outputFinding`, because no consumer of those paths reads a warning before L6.
- The module and its test leave when the last open path of today leaves: [L6](L6-worker.md) for the worker, the rebase of the Workbench branch for the Workbench.

## Open paths until L6 and the Workbench change

(G10)

After [LA](LA-agent-build.md), three open paths exist:

| Path                 | Callers                                                                                                                             | Leaves with                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `openAgent`          | `run agent`; the Project Service after its step ([Project Service](#project-service))                                               | Stays                                                                   |
| `openSessionRuntime` | `agentPort` in `src/worker/unit/agent-port.ts` (`src/agent/agent-port.ts:182` today)                                                | [L6](L6-worker.md)                                                      |
| `openSession`        | The Workbench Service (`src/workbench/service.ts:397`); the Project Service (`src/project/environment-agent.ts:283`) until its step | The Workbench branch at its rebase, and the step of the Project Service |

The input of both open paths of today after [LA](LA-agent-build.md), exact:

```ts
export interface OpenSessionInput {
  cwd: string;
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  allowlist: string[];
  customTools: ToolDefinition[];
  hostHome: string;
  hooks: InlineExtension[];
  context: Context;
  sessionManager?: SessionManager;
}

export interface FreshRedaction {
  knownSecrets: KnownSecrets;
}

export interface ReusedRedaction {
  redaction: SessionRedaction;
}

export type SessionRedactionInput = FreshRedaction | ReusedRedaction;
```

- `OpenSessionInput` is unchanged. `SessionRedactionInput` keeps its shape of today, with named members for the lint rule of [L3-D39](#decisions). `SessionRedaction` is the state of `redaction.ts`, in place of `SensitiveTextRedaction`.
- `ReusedRedaction`: at a reopen of one Workbench session, the Workbench passes the state of the earlier open (`src/workbench/service.ts:429-431`). The marker table of the session then stays valid for the session file.
- The outputs stay: `openSession` gives `{ session, redaction, systemPrompt }`, and `openSessionRuntime` gives `{ runtime, redaction, systemPrompt }`.
- **Guards of the open paths of today.** `sessionParts` adds, in this order: `homeRelativeCwd`, `markerRestore`, the `hooks` of the caller, `inputRedaction`, `assistantRedaction`. It adds no `toolAllowlist`, no confinement and no `pinnedLayersHook`, because the callers add them in `hooks`, as today:
  - `agentPort`: `toolAllowlist`, the confinement for `re@1`, `pins.hook`, the capabilities (`guardsOf` and `hooks` in `src/agent/agent-port.ts:182-200`).
  - The Project Service: `checkoutConfinement` (`src/project/environment-agent.ts:306`).
  - The Workbench: `toolApproval` (`src/workbench/service.ts:409-425`).
  - So no guard runs twice in one session.
- **Symbols that stay until L6.**
  - `countTurns` of `pinned-layers.ts`, read by `src/worker/unit/native-agent.ts:23`.
  - `modelOutput` on the redaction state, as an alias of `exitText`, read by `src/worker/unit/native-agent.ts:242`.
  - `ToolProcesses.take` and `takeTimeout`, read by `src/worker/unit/agent-telemetry.ts:351-352`.
  - `sessionTools` of `tool-table.ts`, read by `agentPort`. It reads the tool set with `getProfile`.
  - `isConfinedAgent` stays in `catalog.ts`, read by `agentPort` (`src/agent/agent-port.ts:115`). It reads `Profile.confined`.
  - `redactionSummary`, `redactionObserved` and `REDACTION_LOG_MESSAGE` move to `redaction.ts`. Their readers are `src/worker/unit/native-agent.ts`, `src/project/environment-agent.ts` and `src/workbench/service.ts`.

#### Catalog reads at the split

The catalog split changes the field reads of each consumer of `getAgentDeclaration` and `WORKBENCH_AGENT_NAMES` (`src/agent/catalog.ts:144`):

| Reader                                                                                                                        | Read of today                                                                                             | Read after the split                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `sessionTools` (`src/agent/tool-table.ts:83-88`)                                                                              | `agent.tools`, `agent.host_tools`                                                                         | `getProfile(name).tools.builtin`, `.tools.host`                          |
| `builtinTools` (`src/workbench/tools.ts:126-130`)                                                                             | `agent.tools`                                                                                             | `getProfile(name).tools.builtin`                                         |
| `src/worker/tool-declarations.ts:17-43`                                                                                       | `agent.tools`, `agent.host_tools`                                                                         | `getProfile(name).tools.builtin`, `.tools.host`                          |
| `src/project/environment-agent.ts:213`, `:301`                                                                                | `declaration.tools`                                                                                       | `getProfile("env@1").tools.builtin` and `.tools.environment`             |
| `src/workbench/sessions.ts:10`, `src/workbench/service.ts:37`                                                                 | `WORKBENCH_AGENT_NAMES` of `catalog.ts`                                                                   | `WORKBENCH_AGENT_NAMES` of `declarations.ts`, from the field `workbench` |
| `src/agent/service.ts:148`, `:640`, `:711`, `:1271`, `:1360`; `src/agent/prompt-files.ts:141`; `src/workbench/service.ts:329` | `getAgentDeclaration` of `catalog.ts`: the declaration, `overridable_fields`, `workbench`, `agent_prompt` | `getAgentDeclaration` of `declarations.ts`, with the same fields         |

- **Destinations of the moved files.** `src/worker/unit/agent-port.ts`, `src/worker/unit/session-directory.ts`, `src/worker/unit/review-roots.ts`, `src/worker/unit/capabilities/*.ts`; the parameter schemas in `src/worker/contract.ts`; `src/llm/known-secrets.ts`; `ProviderFailure` in `src/llm/provider-failure.ts`. `hooks/tool-approval.ts` moves to `src/workbench/tool-approval.ts` with the Workbench change.

## Stop, budget and class

(G7)

### Stop and forced stop

- **Graceful stop.** An abort of `input.signal` calls `session.abort()`. pi aborts the in-flight request and stops each tool call (`abort`, `dist/core/agent-session.js:1909-1920`). The `bash` operations send SIGKILL to the process tree of the command (`processBashOperations` in `src/agent/bash-process.ts`). `send` returns after pi persists the aborted entry (`waitForIdle`) and after each child process ends. The end is `stopped`.
- **Forced stop.** `forceStop()` does these steps:
  1. It kills each live child process at once (`ToolProcesses.killAll`).
  2. It returns a `TurnEnd` with the end `stopped`, the totals so far, the last assistant text so far after `exitText` and the warnings so far.
  3. The open `send` returns that same `TurnEnd`.
  4. It disposes the session with no wait. The session file can lack the aborted entry ([L2 Shutdown](L2-agent-cli.md#shutdown), rule 2).
- **Close.** `close` after a `send` that returned kills each child process that is still alive. So each child process ends before the contract returns ([L2 requirement 14](L2-agent-cli.md#requirements-on-l3)).
- Change: today `ToolProcesses` records only ended processes (`src/agent/tool-table.ts:37-75`). It gains the set of live processes and `killAll`, which calls `killChildTree` (`src/kernel/process-group.ts:50`).

### Budget

| Limit      | Enforcement                                                                                                                                                                 | `budgetReached` |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `deadline` | A timer at the deadline aborts the session. The wait of each pi retry counts, because the timer runs in wall time ([L2 Budget](L2-agent-cli.md#budget), rule 9)             | `wall`          |
| `usd`      | At each `message_end` of an `assistant` message, the contract adds `usage.cost.total` to the list price. When the sum is equal to or more than `usd`, it aborts the session | `usd`           |

- The contract wraps `finishTurn` of the pi agent. pi calls it after a completed assistant turn and its tool results, before `turn_end` (`@earendil-works/pi-agent-core`, `dist/agent-loop.js:179`; `FinishTurn`, `dist/types.d.ts:125-131`). It returns `{ action: "end" }` after `endAfterTurn`. Else it calls the `finishTurn` that pi installs at the session creation and returns its result (`_installAgentBoundaryHooks`, `dist/core/agent-session.js:522-534`). The patches of today do the same (`src/project/environment-agent.ts:314-316`; `src/worker/unit/native-agent.ts:194-197`).
- The first limit that the run reaches decides `budgetReached`. A later limit changes nothing.
- The command limit of `bash` is `min(remaining wall time, COMMAND_LIMIT_MS)`, as today (`src/agent/tool-table.ts:102`). With `deadline` `null`, it is `COMMAND_LIMIT_MS` (600 s).
- One model call can pass the `usd` limit before the abort ([L2 Budget](L2-agent-cli.md#budget), rule 5).
- **Turns.** The L3 contract has no turn limit, because no L3 consumer reads one. [L6](L6-worker.md) adds `RunBudget.turns` with the turn limit of the worker as its first reader.

### End and class

| End          | Condition                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stopped`    | The stop signal or `forceStop` ended the run                                                                                                                                                                    |
| `budget_end` | A budget limit ended the run                                                                                                                                                                                    |
| `failed`     | The last `assistant` message has the stop reason `error`, after the retries of pi. Or `session.prompt` threw, or the error listener received an extension error. The last two cases have the failure `internal` |
| `completed`  | Each other end of the agent loop, `endAfterTurn` included                                                                                                                                                       |

- **Class.** For a provider error, the class is `retryable` when `isContextOverflow(last, model.contextWindow)` is `false` and `isRetryableAssistantError(last)` is `true` (`@earendil-works/pi-ai`, `dist/utils/overflow.d.ts:57`, `dist/utils/retry.d.ts:57`). Else it is `terminal`. The failure `internal` is `terminal` ([L2 Classes](L2-agent-cli.md#classes), rule 3).
- **Failure kind.** `providerFailureOf(errorMessage)` of the redacted error text (`src/llm/provider-failure.ts`). An unknown text gives `unavailable`. The failure kind does not decide the class.
- **Reason.** `RunFailure.reason` is the `errorMessage` of the last `assistant` message, or the message of the error, after `exitText`.
- The contract retries nothing. The retries of pi stay, with the in-memory settings of `sessionParts`.
- Change: today the worker builds the provider failure from the session messages (`providerFailure`, `src/worker/unit/native-agent.ts:77`), and the Project Service throws `session.state.errorMessage` (`src/project/environment-agent.ts:331`).

### Child processes

- The wrapped `bash` gives each child process only the names of `input.childEnvironment`, less the names that `childEnvironment` removes (`src/agent/environment.ts`), plus the pi `PATH`. This rule holds today: `spawnHook` replaces the environment of each command with `childEnvironment({ ...env, PATH })` (`src/agent/tool-table.ts:95-98`), and `env` is the input of `sessionTools`.
- The fallback `execOptions.env ?? env` of `exec` (`src/agent/tool-table.ts:118`) changes no rule. Its removal is a cleanup only. L3-U11 guards the rule as a regression test.
- The runtime process and pi do not read `input.childEnvironment` ([L2 requirement 15](L2-agent-cli.md#requirements-on-l3)).
- `killGroupAtEnd` stays `true`: the group of each command ends with the command.

## Other consumers

(G2, G6)

### Worker

The worker side belongs to [L6](L6-worker.md). Until then the worker uses `openSessionRuntime` ([Open paths until L6 and the Workbench change](#open-paths-until-l6-and-the-workbench-change)). On the contract, the worker gives the composed text of the server in `systemPrompt`. It reads `TurnEnd.failure` and `redactionSummary`. L6 adds the inputs and outputs that only the worker reads: `extensions`, `RunBudget.turns`, the session kind `directory`, `TurnEnd.complete` and the events ([Events](#events)). [Handoffs](#handoffs-to-later-layers) lists the items.

### Project Service

The Project Service opens each `env@1` session through `openAgent`:

| Input              | Value                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`          | `env@1`                                                                                                                                                              |
| `systemPrompt`     | `finalPrompt` of the parts that the server part resolves today, binding parts and framing included                                                                   |
| `workspace`        | `{ cwd: checkout, roots: [checkout] }`; the profile sets the confinement                                                                                             |
| `budget`           | `deadline` `null` and `usd` `null`. The setup run has no deadline today (`src/project/onboarding.ts:1529`). Its context signal carries the stop and goes to `signal` |
| `session`          | `memory`, as today                                                                                                                                                   |
| `knownSecrets`     | `credentialSecrets` of the server agent store (`src/llm/known-secrets.ts`)                                                                                           |
| `childEnvironment` | `{}`: `env@1` declares no `bash`                                                                                                                                     |
| `consumerTools`    | `probe`, `environment_write`                                                                                                                                         |

- **Work pin.** Each `send` passes `work: null`. Today the Project Service sets no work pin (`src/project/environment-agent.ts:306`).
- **End after the tool batch.** Today `end()` of the session handle sets a flag, and the patched `finishTurn` ends the loop after the current tool batch (`src/project/environment-agent.ts:275-316`). Five cases call `end()` (`src/project/onboarding.ts:1555-1640`):
  1. a passed proof;
  2. the last attempt, 5 of 5, with any result;
  3. an attempt over the limit;
  4. a refused write at the last attempt;
  5. a tool call over the limit of 64 (`ENV_AGENT_TOOL_CALL_LIMIT`).
- A mixed batch ends after each result of the batch.
- Change: the `end` callback calls `run.endAfterTurn()`. The contract `finishTurn` gives the same end at the same point, with the end `completed`. `run` returns `Aborted` when the context signal aborts, which gives the end `stopped`. It throws for `failed`. It returns `Ended` for each other end, as today (`src/project/environment-agent.ts:152-185`). A refused open throws. The onboarding reads the proof from its records, not from the session.
- **Reason for `endAfterTurn`.** `finishTurn` is the exported pi mechanism that ends the loop after a batch with no abort ([L3-D20](#decisions)).
- Change: the Project Service reads `TurnEnd.failure.reason` in place of `session.state.errorMessage`, and logs `redactionSummary()`.
- The Project Service change touches no worker module. [LA4](LA4-consumer-migration.md#pr-1-the-project-service-on-the-contract) places it in PR 1. Until then it uses `openSession`.

### Constraints on the Workbench branch at rebase

Ulrich set the merge order on 2026-11-22. The Agent V2 and Worker V3 work merges into `main` first. After this round, `feature/workbench-v2` rebases onto `main`. The Workbench change is the work of that rebase. Each item of this section is a constraint that the branch meets at its rebase.

- **`main` until the rebase.** The Workbench of `main` keeps `openSession` with [Interim redaction](#interim-redaction). Reason: the branch rewrites the Workbench. The agent build changes three things in Workbench files of `main`:
  - the import paths of moved symbols;
  - the call of `finalPrompt` in place of `systemPrompt`;
  - the catalog reads of [Catalog reads at the split](#catalog-reads-at-the-split).
- **Removal.** The rebase deletes `openSession`, `assistantRedaction` and `SessionRedactionInput`, when no other consumer reads them.
- **Open.** The Workbench opens each session through `openAgent`:
  - `systemPrompt` from `finalPrompt` of the Workbench parts and the framing. The server part places the parts `identity` and `variant` of the branch in layer 1.
  - `workspace` `{ cwd: place.cwd, roots: [place.cwd], confine: true }`. This keeps the confinement of every Workbench session of the branch (`checkoutConfinement(session.place.cwd)`, `src/workbench/service.ts:1702` of the branch).
  - `budget` all `null`; `session` `directory` for a new session and `resume` for a resume.
  - `consumerTools`: the operation tools, `offer_action`, `request_owner_act` and `evidence_read`. `extensions`: `[toolApproval]`.
  - Each `send` passes `work: null`. Today the Workbench sets no work pin (`src/workbench/service.ts:435`).
- **Catalog.** The branch adds these profiles and fields:

  | Profile                       | Agent tools | Declared consumer tools                                                                                   | Confined  | Start preconditions   | Profile prompt        |
  | ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- | --------- | --------------------- | --------------------- |
  | `swe@1`, `re@1` (added tools) | as `main`   | `operation`: the six node review reads; `workbench`: `evidence_read`, `offer_action`, `request_owner_act` | as `main` | as `main`             | as `main`             |
  | `pe@1` (rename of `env@1`)    | as `env@1`  | as `env@1`                                                                                                | Yes       | `workspace_directory` | as `env@1`            |
  | `ops@1`                       | none        | `operation`: the 36 operations of `OPS_OPERATIONS`; `workbench`: `offer_action`, `request_owner_act`      | No        | `workspace_directory` | Standard, `ops@1.md`  |
  | `plan@1`                      | none        | `operation`: the 8 operations of `PLAN_OPERATIONS`; `workbench`: `offer_action`, `request_owner_act`      | No        | `workspace_directory` | Standard, `plan@1.md` |
  - The six node review reads are `NODE_REVIEW_READS` of the branch: `mission.node.get`, `mission.attempt.list`, `mission.outcome.list`, `mission.assessment.list`, `mission.evidence.list`, `mission.evidence.get` (`git show origin/feature/workbench-v2:src/agent/catalog.ts`).
  - `AgentTools` gains `operation: readonly string[]` and `workbench: readonly WorkbenchTool[]`, with their reader, the Workbench Service.
  - `offer_action` and `request_owner_act` are tools of the Workbench on the branch (`WORKBENCH_ACTION_TOOL_NAME` in `src/workbench/actions.ts:32`, `WORKBENCH_REQUEST_OWNER_ACT_TOOL` in `src/workbench/contract.ts:39`). The `workbench` field of the branch lists only `evidence_read`. The rebase adds the two names, so pi registers them.
  - `guard@1` of the branch is no profile. The Workbench calls `runtime.complete` for it and opens no agent session (`git show origin/feature/workbench-v2:src/workbench/guard-classifier.ts`). It stays a declaration of the server part. The fork summary of the branch is a direct completion too.
  - `TOOL_CATALOG` gains the entries of `bash` and of each operation and Workbench tool, each with an empty location list. The confinement then passes `bash` with no path check. The confinement does not confine `bash`; the sandbox confines it.

- **Inputs that the rebase adds.**
  - `workspace.confine: boolean`. `true` adds the confinement to a profile that does not set it. A consumer can never remove the confinement of a profile ([L3-D18](#decisions)).
  - The session kind `resume` with `SessionManager.open(path, dirname(path))`. The file exists. A resume checks each start precondition except `git_clean`. Reason: at a resume, the uncommitted change is the work of the same session, and the session file records it ([L3-D23](#decisions)).
  - `bashSandbox: SandboxScope | null` ([`bash`](#workbench-bash)). The open throws `AgentOpenError` with the new code `agent.sandbox_missing` when three conditions hold: the session is confined, the profile declares `bash`, and `bashSandbox` is `null`.
  - `@anthropic-ai/sandbox-runtime` joins the allowed set of [Import rule](#import-rule).
- **Events.** The Workbench is a reader of the events that L6 adds ([Events](#events)). At the open of a `resume`, the contract emits each stored entry of the session file as an `entry` event, after `exitValue` and before the first `send`. The Workbench views read stored entries only from these events. The streaming view reads `message_update` only with the hold-back of [Events](#events).
- **Views.** The Workbench reads only the contract events and the `TurnEnd`, after the exit redaction. It holds no `AgentSession`.
- **Session entries.** The Workbench writes no session entry around the contract. The branch writes these entries on the `SessionManager` or the `AgentSession`. Each one goes through a runtime API that holds the redaction state of the session:

  | Entry                                   | Calls on the branch                                                                                                                                                                                                                                                                                     | Path at the rebase                                                                                                             |
  | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
  | `message`                               | `appendMessage` in `appendOpening` (`src/workbench/sessions.ts:307`, `:312`), in `appendForkOpening` (`:322`, `:332`) and in `runPlanPipeline` (`src/workbench/plan-pipeline.ts:179`). The `user` message of a fork holds the fork summary that the model writes (`src/workbench/service.ts:3344-3347`) | A runtime API that applies the input redaction to each text block                                                              |
  | `session_info`                          | `appendSessionInfo(text)` with the user text (`src/workbench/service.ts:1537`)                                                                                                                                                                                                                          | A runtime API that applies the input redaction to the name                                                                     |
  | `custom`                                | `appendCustomEntry` (`src/workbench/service.ts:2296`, `src/workbench/sessions.ts:449`)                                                                                                                                                                                                                  | `appendCustom` of [L6](L6-worker.md), which redacts each string of `data`                                                      |
  | `custom_message`                        | `appendCustomMessageEntry` (`src/workbench/service.ts:2261`, `src/workbench/plan-pipeline.ts:138`). This entry kind enters the model context                                                                                                                                                            | A runtime API that applies the input redaction. The rebase adds it                                                             |
  | `custom_message` through the agent      | `session.agent.sendCustomMessage` (`src/workbench/service.ts:2247`, `:2804`)                                                                                                                                                                                                                            | A call of `AgentRun` that applies the input redaction, then calls pi `sendCustomMessage`. No consumer holds the `AgentSession` |
  | `model_change`, `thinking_level_change` | `appendModelChange` and `appendThinkingLevelChange` (`src/workbench/service.ts:2304`, `:2306`)                                                                                                                                                                                                          | A runtime API that writes both from `ModelSelection`. They hold a provider, a model id and a level, and no free text           |

- **Writes with no open run.** The branch writes the configuration, model, level and opening entries before `openAgent` (`src/workbench/service.ts:3572-3577`), the fork entries (`:3339-3348`) and the `else` branch entry (`:2257-2261`). The rebase adds a runtime API that writes an entry to a session with no open run. That API applies the redaction state of that session.

- **Checks.** L1 [AC19](L1-model.md#checks) runs on the branch after the rebase. The lint glob of [L1-D15](L1-model.md#decisions) covers `src/workbench/tool-approval.ts`.

#### Workbench `bash`

- The Workbench `bash` wrapper leaves. The runtime `bash` is the one `bash` of every consumer ([L1 handoff](L1-model.md#handoffs-to-later-layers)).
- On the branch, `bashSandbox` has two readers:
  - The Workbench wraps each command with `bashSandbox.wrap` and a deny list of server files (`builtinTools` in `src/workbench/tools.ts:318-345` of the branch).
  - The worker wraps each command with the sandbox scope of its slot (`src/worker/unit/tool-table.ts:145` of the branch). The slot gives `deny_read: hostDenyRead(env)` (`src/apps/worker/slot.ts:164` of the branch).
- The input gains `bashSandbox`, and the runtime `bash` wraps each command with it. The Workbench gives `hostDenyRead`. The rebase gives the scope of the worker on the V3 worker port. So the sandbox of the branch keeps its strength.
- The branch sets `killGroupAtEnd: false` (`src/workbench/tools.ts:330` of the branch). [L3-D37](#decisions) holds the ruling.
- **`swe@1` with no worktree.** Today the working directory of a Workbench session is a directory per agent name that is no git worktree (`workbenchDirectory` in `src/workbench/sessions.ts:31`). A Workbench `swe@1` session passes the coding preconditions ([L3-D38](#decisions)). [HANDOFF.md](../HANDOFF.md#workbench-service), Workbench Service, holds the directory rule.

## Extension modules

(G8)

Each module exports one extension factory, with its test file next to it ([L1 Extension rule](L1-model.md#extension-rule)).

| Module                                    | Factory               | Test file                      | Change                                                                                                                                |
| ----------------------------------------- | --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/hooks/home-relative-cwd.ts`    | `homeRelativeCwd`     | `home-relative-cwd.test.ts`    | New test. Today no test names it                                                                                                      |
| `src/agent/hooks/tool-allowlist.ts`       | `toolAllowlist`       | `tool-allowlist.test.ts`       | New test. Today no test names it                                                                                                      |
| `src/agent/hooks/marker-restore.ts`       | `markerRestore`       | `marker-restore.test.ts`       | New module from `restore`, plus the known-secret block                                                                                |
| `src/agent/hooks/checkout-confinement.ts` | `checkoutConfinement` | `checkout-confinement.test.ts` | Unchanged                                                                                                                             |
| `src/agent/hooks/pinned-layers.ts`        | `pinnedLayersHook`    | `pinned-layers.test.ts`        | New test file. Today `src/worker/unit/pinned-layers.test.ts` runs the hook through `pinnedLayers().hook` (`:54`, `:86`)               |
| `src/agent/hooks/input-redaction.ts`      | `inputRedaction`      | `input-redaction.test.ts`      | New module from `hook`, less the three redactions of LLM output, plus `errorMessage`                                                  |
| `src/agent/hooks/output-finding.ts`       | `outputFinding`       | `output-finding.test.ts`       | New module                                                                                                                            |
| `src/agent/hooks/assistant-redaction.ts`  | `assistantRedaction`  | `assistant-redaction.test.ts`  | New interim module from `hook`. It leaves with the last open path of today                                                            |
| `src/agent/hooks/tool-approval.ts`        | `toolApproval`        | `tool-approval.test.ts`        | New test. Today only `sensitive-text-redaction.test.ts` tests it. Both move to `src/workbench/` at the rebase of the Workbench branch |

- `src/agent/redaction.ts` is no extension. It holds the state that four factories share: the marker table, the matchers and the counts. Its test file is `redaction.test.ts`.
- `src/agent/hooks/sensitive-text-redaction.ts` and its test leave. Each of its tests moves to the test file of the module that owns the behavior.
- The capabilities `executionEvidence` and `linkUpdates` move to `src/worker/unit/capabilities/` with their tests ([L6](L6-worker.md#worker-capabilities)).

## Acceptance checks

(G9)

Each check is an end-to-end test ([index](index.md#reading-order)). It runs the built `kanthord run agent` as a process, with a real file system, real git and the real pi runtime. The only stub is the LLM stub. The fixtures are the [L2 fixtures](L2-agent-cli.md#l2-fixtures): Auth, Stub, W, H, X, T, D, S, O, Run and `$TEST`. "Refused" means: exit `1`, no result, and the first stderr line that is no JSON line starts with the code. "A digest listing of W" is `find W -type f | sort` with the SHA-256 digest of each file, the files of `.git` included.

1. **L3-AC1. No input entry of a session file holds a known secret.** Makes L1 [AC3](L1-model.md#checks) runnable.
   - Fixture: K is the key of Auth, of ASCII letters only, so no JSON escape changes it. The one commit of W holds `secret.txt` with the text `token K`. `$TEST/context.md` holds `context K`. Run 1 has its own S1 and W1. Run 2 has its own S2 and W2. The scripted answers of run 1: call `read` with the path `secret.txt`; then answer the text `done`. In run 2, Stub answers each request with HTTP 400 and the body `{"error":{"message":"bad key K"}}`.
   - Command: run 1: Run with `--system-prompt "$TEST/context.md" --prompt "use K"` in place of `--prompt "$INPUT"`. Run 2: the same, with S2 and W2.
   - Pass:
     - Run 1 exits `0`. Run 2 exits `5`, and its line in O has `end` `failed`, `class` `terminal` and `failure` `bad_request`.
     - No request body to Stub in run 1 holds K. The system text and the user text of the first request of run 1 hold `<redacted:llm_credential:`. The `read` tool result in the second request holds `<redacted:llm_credential:`.
     - For each line of S1 and S2: when the entry has `type` `message` and `message.role` `assistant`, its `errorMessage` field holds K zero times. Each other line holds K zero times.
     - S2 holds one or more `assistant` entries with `stopReason` `error` and an `errorMessage` that holds `<redacted:llm_credential:`.
     - O and stderr hold K zero times.

2. **L3-AC2. Each profile composes the prompt chain.**
   - Fixture: `$TEST/context.md` holds `Repository prompt M4`. Each run has its own W and S. Stub answers the text `ok`.
   - Command: for P in `swe@1`, `re@1` and `env@1`: Run with the profile P and `--system-prompt "$TEST/context.md"`.
   - Pass: each run exits `0`. Let C(P) be the join with `"\n\n"` of these texts, in this order, each as the file holds it:
     1. `static/prompt/base.md`;
     2. `static/prompt/coding.md`, for each P except `env@1`;
     3. `static/prompt/role/P.md`, or `static/prompt/env@1.md` for `env@1`;
     4. `Repository prompt M4`.
   - The system text of the first request of each run starts with C(P) byte for byte, and the rest is one `<cwd>` section. `system_prompt_digest` of each line in O is the SHA-256 hex digest of C(P).

3. **L3-AC3. Each profile offers its full tool set, and a declared tool with no implementation is absent.**
   - Fixture: each run has its own W and S. The scripted answers:
     - `swe@1`: call `evidence-upload` with `{"path":"README"}`, then answer `done`.
     - `re@1`: call `bash` with `{"command":"ls"}`, then answer `done`.
     - `env@1`: call `probe` with `{}`, then answer `done`.
   - Command: Run once for each of the three profiles.
   - Pass:
     - Each run exits `0`.
     - For `swe@1`, the first request lists exactly `read`, `edit`, `write`, `grep`, `find`, `ls` and `bash`.
     - For `re@1` and `env@1`, the first request lists exactly `read`, `grep`, `find` and `ls`.
     - The tool result of the scripted call in S is an error result: `Tool evidence-upload not found`, `Tool bash not found` and `Tool probe not found`.
     - For `re@1` and `env@1`, a digest listing of W is equal before and after.

4. **L3-AC4. A known secret in a tool input blocks the call, and the record keeps the model output.**
   - Fixture: K as in L3-AC1. One scripted assistant message with two tool calls: `bash` with `{"command":"printf %s K > $TEST/leak"}`, and `write` with `{"path":"leak.txt","content":"K"}`. Then the answer `done`.
   - Command: Run.
   - Pass: exit `0`. Each of the two tool results in S is the block text `The input holds a value of a known credential. No tool receives this value.` No file exists at `$TEST/leak` or at `W/leak.txt`. `git -C "$W" status --porcelain` prints nothing. The `assistant` entry of S holds both arguments byte for byte, K included. stderr holds exactly one line with `"code":"cli.run.agent.secret_exposed"`, `"rule":"llm_credential"` and `"count":2`. O, stdout and stderr hold K zero times.

5. **L3-AC5. The start preconditions of each profile, with no write, no fsmonitor command and no hook.** Gives the precondition list of L1 [AC10](L1-model.md#checks).
   - Fixture: each variant has its own W and S. The script `$TEST/fsmonitor` writes the marker file `$TEST/M10` and exits `0`. The script `$TEST/hook` writes the marker file `$TEST/M11` and exits `0`.
     1. `swe@1`; W holds an uncommitted change of a tracked file.
     2. `swe@1`; W is an empty directory that is no git worktree.
     3. `swe@1`; W is the subdirectory `src` of a git worktree with no uncommitted change.
     4. `re@1`; W is an empty directory that is no git worktree.
     5. `re@1`; W holds an uncommitted change of a tracked file.
     6. `swe@1`; W has no uncommitted change. Before the run, `git -C "$W" config core.fsmonitor "$TEST/fsmonitor"` and `git -C "$W" config core.hooksPath "$TEST/hooks"` ran, and `$TEST/hooks/post-index-change` is a copy of `$TEST/hook`. After the commit, `touch` gave one tracked file a later modification time.
   - Stub answers the text `ok`.
   - Command: Run with the profile of each variant.
   - Pass:
     - Variant 1 is refused with `cli.run.agent.start_refused`, and the `reason` row starts with `git_clean:`. Variants 2 and 3 are refused, and the `reason` row starts with `git_worktree:`. For each of the three, Stub receives no request, no file exists at S, and a digest listing of W is equal before and after.
     - Variants 4, 5 and 6 exit `0`.
     - For variant 6, no file exists at `$TEST/M10` or at `$TEST/M11`. A digest listing of W is equal before and after the start of the run.

## Unit-level rules

(G9)

Each rule holds in one module, with no process and no LLM stub ([index](index.md#reading-order)). A test with a model uses Faux and the test consumer of the [L1 shared fixtures](L1-model.md#shared-fixtures). Each test file lies next to its module.

1. **L1 U2.** `inputRedaction` redacts a `custom` message and a steering message before pi persists them, and a `custom` message that a `context` handler adds. Test file: `src/agent/hooks/input-redaction.test.ts`.
2. **L1 U3.** Each text that the contract gives out holds K zero times: `TurnEnd.text`, `RunFailure.reason`, and the `AgentOpenError` message. K is in the model text, in a tool result and in a provider error. When L6 adds the events, the rule covers each event. Faux streams K in two deltas. No event holds K or a prefix of K of 4 or more characters. Test file: `src/agent/agent-contract.test.ts`.
3. **L1 U6.** The `toolAllowlist` handler blocks an undeclared name with the text `The tool <name> is not declared for this agent.`, and the implementation does not run. A declared name passes. Test file: `src/agent/hooks/tool-allowlist.test.ts`.
4. **L1 U10.** `outputFinding` gives one warning with the rule `llm_credential` and the count of findings for one `assistant` message, and none for a message with no finding. The `assistant` entry stays byte for byte. A known secret in `errorMessage` gives no finding. Test file: `src/agent/hooks/output-finding.test.ts`.
5. **L3-U1. Composition function.** The golden case holds an instruction file, a Repository prompt, a Binding prompt and the framing. For it, the output of `finalPrompt` is byte-equal to its output of today. The output for the Workbench parts is byte-equal to `systemPrompt` of today. `finalPrompt` gives `null` for an unresolved part. A heading renders as heading, blank line, text. The digest is the digest of the text before the redaction. Test file: `src/agent/prompt-chain.test.ts`.
6. **L3-U2. Catalog.** Each profile has the exact tool set, confinement and precondition list of [Coding tools](#coding-tools). Each declared tool except `bash` has a `TOOL_CATALOG` entry. `getProfile` of an unknown name gives `undefined`. Test file: `src/agent/catalog.test.ts`.
7. **L3-U3. Prompt files.** `coding.md` equals the three shared sections of `swe@1.md` and of `re@1.md`. `role/swe@1.md` and `role/re@1.md` equal the other sections of `swe@1.md` and `re@1.md` less the protocol text of [Prompt files](#prompt-files). No Role holds the words `worker`, `node branch` or `gate`. Test file: `src/agent/prompt-assets.test.ts`.
8. **L3-U4. Start preconditions.** Each id passes and fails as its row states. A subdirectory of a worktree fails `git_worktree`. The order and the first failure. The reason text. Each `git` command gets `--no-optional-locks` for `git_clean`, the isolated environment and the `PATH` of the input, else of the runtime process. A name of `process.env` that `input.childEnvironment` does not hold is absent from the environment of each `git` command. A timeout fails the precondition. Test file: `src/agent/start-preconditions.test.ts`.
9. **L3-U5. End and class.** Test file: `src/agent/run-outcome.test.ts`.
   - Each end from its condition.
   - The class from `isContextOverflow` and `isRetryableAssistantError`, a context overflow included.
   - The failure kind.
   - The failure `internal` for a thrown error and for an extension error.
   - The totals.
10. **L3-U6. Budget.** The deadline gives `wall`. A list price equal to the limit gives `usd`. The first limit wins. `endAfterTurn` ends the run after the current batch, a mixed batch included. A flag set in one `send` does not end the next `send`. The command limit with a `null` deadline is `COMMAND_LIMIT_MS`. The test uses a model with a catalog price. Test file: `src/agent/run-budget.test.ts`.
11. **L3-U7. Contract.**
    - An undeclared name of `consumerTools` throws `agent.tool_undeclared`. An unsupported `thinkingLevel` throws `agent.level_unsupported`, and no level is clamped.
    - A declared consumer tool with no implementation is absent from the request.
    - A refused open writes no session file and sends no request. The open sends no request.
    - An abort during the open throws `agent.open_failed` with the message `aborted` and leaves no session file.
    - The guard order is the order of [Guard order](#guard-order).
    - `send` redacts `work` before it sets the work pin. `work: null` clears the pin.
    - An abort gives `stopped` after pi persists the aborted entry. `forceStop` returns at once with the totals so far and kills each live child process. `close` after `forceStop` does nothing.
    - No runtime module writes to `process.stdout` or `process.stderr`. A handler error of an extension ends the run with the failure `internal`.
    - Test file: `src/agent/agent-contract.test.ts`.
12. **L3-U8. Marker restore.** The restore cases of today ([agent.impl.md](../agent.impl.md#the-restore-by-tool)). The block of a known secret as raw text, with the new block text, in the input of `bash`, `write`, `read` and a consumer tool. Test file: `src/agent/hooks/marker-restore.test.ts`.
13. **L3-U9. Hooks of today with no test.** `homeRelativeCwd` writes the `<cwd>` section relative to the host home. `pinnedLayersHook` adds the work pin once, at the head of the `context` list, only when no user message equals it. After `session.compact()`, each request holds the work pin. `toolApproval` blocks with the reason of the decision and passes an allowed call. Test files: `home-relative-cwd.test.ts`, `pinned-layers.test.ts`, `tool-approval.test.ts` in `src/agent/hooks/`. `src/agent/pinned-layers.test.ts` keeps the cases of today: each agent-loop request and each compaction summary request holds the system prompt pin and the work pin.
14. **L3-U10. Redaction state.** With no `assistantRedaction`, `thinking_kept` and `compaction_residual` stay `0`. `output_found` counts the findings of `outputFinding`. `exitText` gives the session marker, and `modelOutput` gives the same text. `text` refreshes the known secrets. Test file: `src/agent/redaction.test.ts`.
15. **L3-U11. Child processes, a regression rule.** A child process gets only the names of `childEnvironment`, less the removed names, plus the pi `PATH`. A name of `process.env` that the input does not hold is absent. `killAll` kills each live process tree. Test file: `src/agent/tool-table.test.ts`.
16. **L3-U12. Interim redaction.** `assistantRedaction` keeps the three redactions of LLM output of today and their counts. Test file: `src/agent/hooks/assistant-redaction.test.ts`. The rule leaves with the module.
17. **L3-U13. Open paths of today.** `openSession` and `openSessionRuntime` hold `homeRelativeCwd`, `markerRestore`, the caller `hooks`, `inputRedaction` and `assistantRedaction`, in this order. They hold no `outputFinding` and no guard of their own that a caller also adds. `{ redaction }` reuses the given state. Test file: `src/agent/agent-session.test.ts`.
18. **L1 U15.** The import closure of each runtime module stays in the allowed set of [Import rule](#import-rule), and no runtime module names `setGlobalDispatcher` or `EnvHttpProxyAgent`. Module: the import check of the build ([LA](LA-agent-build.md)). L3 gives the allowed set.

### Rules with no check, and the reason

- **The forced stop end to end.** `run agent` reaches it only after a 10-second graceful stop that a test cannot force with no hang of pi. L3-U7 and the signal handler rule of L2 cover it.
- **The Workbench and the Project Service.** L1 [AC19](L1-model.md#checks) runs on the Workbench branch after its rebase. L1 [AC20](L1-model.md#checks) is built in [LA4](LA4-consumer-migration.md).
- **The interim redaction and the open paths of today.** They are temporary paths. L3-U12 and L3-U13 cover them.
- **The filter driver of a repository.** A filter command can run at `git_clean`, by design. No check asserts its absence.

## Handoffs to later layers

### To LA

These are order hints. [LA](LA-agent-build.md) fixes the order.

1. The import moves of [Open paths until L6 and the Workbench change](#open-paths-until-l6-and-the-workbench-change), with their tests. In the same change:
   - Move the lint glob `src/agent/capabilities/**/*.ts` (`eslint.config.js:1007`) to `src/worker/unit/capabilities/**/*.ts` ([L1-D15](L1-model.md#decisions)).
   - Update the list of agent files that `worker-unit` and `apps-worker` can import (`eslint.config.js:518-548`).
2. The split of `sensitive-text-redaction.ts` into `redaction.ts` and the hook modules, with their tests. The build change of [Redaction](#redaction), the known-secret block and the interim module on both open paths of today, in one step. The unit-level rules of Redaction pass in the same step. L3-AC1 runs in the first step that makes `run agent` write a session file (LA-D3). This step comes before the step that makes `run agent` write a session file ([L1 Session file](L1-model.md#session-file), "Order").
3. The catalog split: `catalog.ts` with the profiles and `AgentTools`, and `declarations.ts`. The prompt files with L3-U3.
4. `prompt-chain.ts`. `finalPrompt` then calls `composeSystemPrompt`, and `systemPrompt` leaves. L3-U1 proves the byte-equal text.
5. `start-preconditions.ts`, `run-budget.ts`, `run-outcome.ts`, the changes of `tool-table.ts`, then `agent-contract.ts`. The import check of [Import rule](#import-rule) passes with `agent-contract.ts`, after the catalog split of item 3 and `setWork(WorkPin)`.
6. `run agent` of L2 on the contract.
7. The Project Service on the contract. It needs no worker change, so LA places it in LA4 PR 1 (LA-D4).
8. The gate check of [L1 U8](L1-model.md#unit-level-rules) after the test files of [Extension modules](#extension-modules) exist.
9. `docs/cli/run.md`: the text of the start preconditions, with the differences from a `git status` of the developer ([Start preconditions](#start-preconditions)).
10. The lint rule `kanthord/no-inline-object-type` of [L3-D39](#decisions) comes in the first step. Each step lists its files in the scope of L3-D39, and the rule applies to them. Sites at `c864130e` in the files that L3 names, as union members, property object types and string literal property types:
    - `src/worker/contract.ts`: 20, 5 and 8. It receives `HOST_TOOL_PARAMETERS` and the two schemas.
    - `src/agent/prompt-render.ts`: 2, 1 and 0. The step of `prompt-chain.ts` edits `finalPrompt`.
    - `src/workbench/service.ts`: 0, 2 and 0. The agent build edits the call of `finalPrompt` and the catalog reads.
    - `src/agent/agent-session.ts`: 2, 0 and 0. L3 names the members of `SessionRedactionInput`.
    - `src/scheduler/contract.ts`: out of scope. `ProviderFailure` only leaves it.

### To L6

1. The port `agent.open` builds `AgentInput` from the execution setup:
   - the profile, the model runtime and the composed text of the server;
   - the workspace roots of each chain, and `session` `directory`;
   - `budget.deadline` from the claim, and `budget.turns` from the remaining turns;
   - L6 adds to the contract the parts that the worker is the first to read:
     - the input `extensions`, at item 6 of [Guard order](#guard-order);
     - `RunBudget.turns`: the contract counts each response in its `finishTurn`, an error included, and returns `{ action: "end" }` at the limit. At an error or aborted response at the limit, it starts an abort of the session and does not wait for it inside `finishTurn`. The end is `budget_end` with `budgetReached` `turns`;
     - the session kind `directory`, with `SessionManager.create(cwd, directory, { id })`, as `sessionManagerOf` today (`src/agent/agent-port.ts:137`);
     - `TurnEnd.complete`: the last assistant message has the stop reason `stop`, holds text that is not blank and holds no tool call, as `isCompleteReply` today (`src/worker/unit/native-agent.ts:94`);
   - `knownSecrets` from `mergedSecrets` of the handover stores;
   - `childEnvironment`, `hostHome`, and the worker capabilities in `extensions`.
2. The roots of each chain pass the coding preconditions: the checkouts of an `implement` node; the trees of `workspace.review` for `examine` with `swe@1`. Each root is the top level of a git worktree with no uncommitted change. L6 confirms it, or states the change.
3. L6 adds the `observe` input and the events `session` and `entry`, with `exitValue`, under the constraints of [Events](#events). The worker reads `TurnEnd` in place of `completeReply`, `lastText` and `providerFailure`, and the events in place of the `AgentSession` (`src/worker/unit/native-agent.ts`, `agent-telemetry.ts`, `session-entries.ts`). `sessionEntryRecord` keeps its size bound. `countTurns` and the alias `modelOutput` then leave.
4. L6 adds `appendCustom(customType, data)` to `AgentRun`. It redacts each string of `data` with `text`, then calls pi `appendCustomEntry`. pi never sends a `custom` entry to the model. The worker writes `kanthord.pinned_context`, and the trace view of `apps` reads it (`apps/src/lib/agent-prompt-parts.ts:174`). Example line: `{"type":"custom","customType":"kanthord.pinned_context","data":{"part":"system_prompt"},"id":"a1b2c3d4","parentId":"9f8e7d6c","timestamp":"2026-11-22T09:15:02.123Z"}`.
5. The bash process facts of the telemetry: `ToolProcesses.take` and `takeTimeout` (`src/worker/unit/agent-telemetry.ts:351-352`). L6 adds them to a contract event, or deletes those span attributes.
6. The worker records each `SecretWarning` as a telemetry finding. It renames the span attributes of [Redaction counts](#redaction-counts).
7. The worker gives the turn limit of `NATIVE_RESOURCE_BUDGET` in `budget.turns` and stops the patch of `finishTurn`. Today `ExecutionBudget` counts turns and patches `finishTurn` itself (`src/worker/unit/native-agent.ts:194-197`).
8. The full-entry read of a session file (`readSessionFileEntry`): L6 rules its redaction before the worker path drops `assistantRedaction` ([Exit redaction](#exit-redaction)).
9. A unit rule that `HostTool` of `src/worker/contract.ts` equals the worker tool names of the catalog.
10. The worker path on the prompt chain ([Prompt files](#prompt-files)):
    - the part `coding` of `PromptPart`;
    - the server Role from `role/<name>.md`;
    - the protocol text in the worker instructions;
    - the deletion of the old `swe@1.md` and `re@1.md`.

### To HANDOFF.md

L3 adds three items: the lint rule of [L3-D39](#decisions) under Architecture, the rebase of the Workbench branch and the Workbench `swe@1` directory under Workbench Service. The contract answers two open items of [HANDOFF.md](../HANDOFF.md#agent-component), Agent component: "Give an agent session a budget input that the consumer supplies" (`RunBudget`) and "split `NativeAgentInput` ... into a session input that names no execution" (`AgentInput`). LA closes them when it builds the contract.

## Changes needed in upper layers

No change is open. L3-D28 to L3-D36 and L3-D42 to L3-D45 record the changes that L3 applied to L1 and L2.

## Decisions

1. **L3-D1.** The runtime and the server part of `src/agent/` separate by file as [File assignment](#file-assignment) states. Constraint: the import closure of each runtime module stays in the allowed set of [Import rule](#import-rule), and the closure stops at a kernel module. `agent-port.ts`, `session-directory.ts`, `review-roots.ts` and `capabilities/` move unchanged to `src/worker/unit/`.
2. **L3-D2.** `SpanStatus` leaves the runtime with the trace. `credentialSecrets` and `mergedSecrets` move to `src/llm/known-secrets.ts`. `ProviderFailure` moves to `src/llm/provider-failure.ts`, because `run-outcome.ts` adds that import. The code constant of the pi tool install moves to `pi-tools.ts` with its value `worker.start.tool_missing`. Reason: each import serves a consumer concern.
3. **L3-D3.** The agent contract is `openAgent(input)` with the input, the run handle and the output of [Input and output contract](#input-and-output-contract). Constraint: each new consumer opens sessions only through it, and no consumer of it gets the `AgentSession`.
4. **L3-D4.** The runtime catalog in `catalog.ts` lists every profile that opens a session. `declarations.ts` of the server part lists only the configuration owners. Constraint: `guard@1` stays a server declaration, because it opens no session.
5. **L3-D5.** `AgentTools` of the branch is the field shape. `main` holds `builtin`, `host` and `environment`; the Workbench branch adds `operation` and `workbench` at its rebase. Constraint: a field exists only with its reader. `offer_action` and `request_owner_act` join `workbench`.
6. **L3-D6.** The pi option `tools` holds the declared names of the session. An undeclared name in `consumerTools` makes the open throw `agent.tool_undeclared`. An undeclared extension tool gets `Tool <name> not found`. Reason: pi drops an undeclared tool with no signal. Constraint: the allowlist guard blocks only a nested `ctx.executeTool` call, and its block text stays `The tool <name> is not declared for this agent.`.
7. **L3-D7.** The profile prompt of a coding profile is `base.md`, `coding.md` and `role/<name>.md`. `coding.md` holds the three sections that `swe@1.md` and `re@1.md` share today. Constraint: the worker path keeps `swe@1.md` and `re@1.md` until L6 moves the worker path to the chain, and L3-U3 fails on a difference between the two copies; a change of the `swe@1` text edits both copies in one change.
8. **L3-D8.** `composeSystemPrompt` of `prompt-chain.ts` is the one composition function. Its callers are `run agent` and `finalPrompt` of the server part. The input `systemPrompt` is the composed text, whole, for every consumer. `system_prompt_digest` is the digest of its output before the redaction. Reason: the redaction marker holds a random tag per session. Constraint: `finalPrompt` keeps the unresolved-part rule; `systemPrompt` leaves; the composed text of each consumer of today stays byte-equal.
9. **L3-D9.** The start preconditions are `workspace_directory`, `git_worktree` and `git_clean`. `swe@1` declares all three. `re@1` and `env@1` declare `workspace_directory`, and so do `ops@1` and `plan@1` of the Workbench branch. Each root must be the top level of a git worktree. Constraint: `git` runs with `isolatedGitEnvironment(childEnvironment({ ...input.childEnvironment, PATH }))` and `--no-optional-locks`. `PATH` is the `PATH` of the input, else of the runtime process. The check runs no fsmonitor command and no hook, and it keeps the filter drivers. The reason holds no path.
10. **L3-D10.** The guard order of a contract session is `homeRelativeCwd`, `toolAllowlist`, `markerRestore`, `checkoutConfinement`, `pinnedLayersHook`, the place of the consumer extensions, `inputRedaction`, `outputFinding`. Constraint: a consumer gives only its extensions, and each guard fails closed.
11. **L3-D11.** `markerRestore` blocks a tool call whose input holds a known secret as raw text, in every tool, with the matcher `secretMatcher` of the session. Reason: it keeps AH-Q3 after R2-H. Constraint: the block changes no recorded response.
12. **L3-D12.** On the contract path, the build change of R2-H removes the three redactions of LLM output and keeps the input redaction, the restore and `exitText`. The rotate warning has the rule `llm_credential` and one count per `assistant` message. Constraint: `output_found` is new; only `outputFinding` writes it.
13. **L3-D13.** `assistantRedaction` keeps the redaction of LLM output on both open paths of today, `openSessionRuntime` and `openSession`, until L6 and the Workbench change. Reason: the worker records, the full-entry read and the Workbench views have no exit redaction until then. Constraint: `thinking_kept` and `compaction_residual` stay in `RedactionCounts` until the module leaves. `assistantRedaction` and `outputFinding` are never in one session.
14. **L3-D14.** The contract applies `exitText` to `TurnEnd.text`, `RunFailure.reason` and the `AgentOpenError` message. The L3 contract emits no event. Constraint: no consumer of the contract reads a text of the session outside the contract output. The reader that adds events applies `exitValue` to each event, and forwards `message_update` only with the hold-back of [Events](#events).
15. **L3-D15.** `RunBudget` holds `deadline` and `usd`. The first limit that the run reaches decides `budgetReached`. Constraint: both limits abort. The `bash` command limit is `min(remaining wall time, COMMAND_LIMIT_MS)`.
16. **L3-D16.** An abort of the stop signal is the graceful stop. `forceStop` returns at once and kills each live child process. Constraint: `ToolProcesses` tracks live processes and gains `killAll`. `close` kills each child process that is still alive, waits at most `RUNTIME_SETUP_DEADLINE_MS`, and does nothing after `forceStop`.
17. **L3-D17.** The class of a provider error is `retryable` only when `isContextOverflow` rejects it and `isRetryableAssistantError` accepts it. The failure kind is `providerFailureOf` of the redacted error text. Constraint: the contract retries nothing; the retries of pi stay.
18. **L3-D18.** Confinement is the property `confined` of the profile. Constraint of the Workbench change: the input gains `workspace.confine`. A consumer can add the confinement with it and can never remove it. `TOOL_CATALOG` gains `bash` with an empty location list. The sandbox, not the confinement, confines `bash`.
19. **L3-D19.** A child process gets only the names of `input.childEnvironment`, less the names that `childEnvironment` removes, plus the pi `PATH`. This rule holds today. Constraint: L3-U11 guards it as a regression rule; the runtime process and pi do not read the input.
20. **L3-D20.** The Project Service opens `env@1` through the contract with a `memory` session. Its `end` callback calls `endAfterTurn`, which keeps the end of today after the tool batch of each of the five cases that call `end()`. Reason: `finishTurn` is the exported pi mechanism that gives this end with no abort. Constraint: no consumer patches `finishTurn`; only the contract wraps it. Each `send` clears the flag at its start.
21. **L3-D21.** At the rebase of the Workbench branch, the runtime `bash` is the one `bash` of every consumer, and the input gains `bashSandbox`. The Workbench and the worker are its readers. Constraint: the sandbox of the branch keeps its strength. A confined session of a profile that declares `bash` with no `bashSandbox` makes the open throw `agent.sandbox_missing`. The rebase gives the scope of the worker on the V3 worker port.
22. **L3-D22.** Every contract session holds the pinned layers. `send(text, { work })` redacts `work` and sets the work pin; `null` clears it. `run agent` passes its message as `work`. Reason: a pi compaction replaces the first user message with a model summary. Constraint: `pinnedLayersHook` adds the work pin to each agent-loop request at the event `context`. `pinInference` adds the system prompt pin and the work pin to each stream call that lacks them, the compaction summary request included. Neither mechanism writes the session file. No consumer sets the system prompt pin.
23. **L3-D23.** The session record has two kinds now: `new_file` and `memory`. L6 adds `directory`. Constraint: `new_file` uses `SessionManager.open` with the explicit path and the workspace as `cwd`, and the contract asserts that no entry exists at the path. The Workbench branch adds `resume` at its rebase, which skips `git_clean` and emits the stored entries after `exitValue`.
24. **L3-D24.** The contract never clamps the reasoning effort. An unsupported level throws `agent.level_unsupported` at the open. Constraint: the consumer checks the level first, as `run agent` does ([L2 Model selection](L2-agent-cli.md#model-selection), rule 6).
25. **L3-D25.** Each failure of the open that is no refusal throws `AgentOpenError` with one of the codes `agent.tool_undeclared`, `agent.level_unsupported` and `agent.open_failed`. An abort during the open gives `agent.open_failed` with the message `aborted`. Constraint: the message passes `exitText`; a failed open leaves no session file.
26. **L3-D26.** Until L6 and the Workbench change, `openSessionRuntime` and `openSession` keep `OpenSessionInput` and `SessionRedactionInput` of today, with the state of `redaction.ts`. Constraint: `sessionParts` adds `homeRelativeCwd`, `markerRestore`, the caller hooks, `inputRedaction` and `assistantRedaction`, and no guard that a caller adds. `countTurns`, `modelOutput`, `take` and `takeTimeout` stay until L6.
27. **L3-D27.** The L3 contract has no `observe` input, no event, no `appendCustom`, no `extensions` input, no `RunBudget.turns`, no session kind `directory` and no `TurnEnd.complete`. Reason: no L3 consumer reads them. Constraint: [L6](L6-worker.md) adds them with the worker as first reader. `appendCustom` redacts each string of `data` with `text` before pi writes the entry.
28. **L3-D28. Applied to L1.** AC18, AC19, U6, U13 and the entry "Boundary rule 8" now state the pi behavior. An undeclared `consumerTools` name makes the open throw `agent.tool_undeclared`. An undeclared extension tool, or a model call of an undeclared name, gets `Tool <name> not found`. U6 is a unit test of the handler.
29. **L3-D29. Applied to L1.** The mapping row of `env@1` and E6 note that the rebase of `feature/workbench-v2` renames `env@1` to `pe@1`. The rename lands with the rebase.
30. **L3-D30. Applied to L1.** [Session file](L1-model.md#session-file) holds the block of a known secret in a tool input, in every tool, with the matcher `secretMatcher`. The rules table records that AH-Q3 keeps its strength.
31. **L3-D31. Applied to L1.** [Session file](L1-model.md#session-file) holds the interim. Both open paths of today keep the redaction of LLM output until L6 and the Workbench change. "Exit redaction" names the full-entry read of a session file. It hands the ruling of that read to L6, with the fact of `discard` at the end of an execution.
32. **L3-D32. Applied to L1.** L1-D9 holds the constraint of the Workbench change: a consumer can add the confinement and can never remove it. The confinement does not confine `bash`; the sandbox confines it.
33. **L3-D33. Applied to L1.** Statelessness check 4 and the boundary row "Consumer records" hold the session kind `memory` of the Project Service now. They hold the kind `resume` with the Workbench change.
34. **L3-D34. Applied to L1.** The L1 handoff to L3 on the start preconditions records the ruling: a resume skips `git_clean`, with the Workbench change.
35. **L3-D35. Applied to L1.** The tool inventory row of `agentPort` states that `agent-contract.ts` is the agent part, and that the rest of `agent-port.ts` becomes the worker port `agent.open`.
36. **L3-D36. Applied to L2.** A failed open gives `cli.run.agent.open_failed` with the `reason` row, class `terminal`, exit `1` and no result. A signal during the open keeps the rule of L2 Shutdown, rule 5: exit `2` and no result.
37. **L3-D37.** At the Workbench change, the runtime `bash` of the Workbench kills the process group at the end of each command, as for every other consumer, with the 600 s command limit (Ulrich, 2026-11-22). Constraint: no process of a Workbench command outlives that command.
38. **L3-D38.** A Workbench `swe@1` session passes the coding preconditions (Ulrich, 2026-11-22). Constraint: the Workbench branch owns the directory rule of that session, and [HANDOFF.md](../HANDOFF.md#workbench-service), Workbench Service, records it.
39. **L3-D39.** A new engine lint rule `kanthord/no-inline-object-type` refuses four forms:
    - an object type literal in a union member (`TSUnionType > TSTypeLiteral`);
    - an object type literal as a property type (`TSPropertySignature > TSTypeAnnotation > TSTypeLiteral`);
    - a string literal type as a property type (`TSPropertySignature > TSTypeAnnotation > TSLiteralType[literal.value=type(string)]`);
    - a string literal type in a union that is a property type (`TSPropertySignature > TSTypeAnnotation > TSUnionType > TSLiteralType[literal.value=type(string)]`).

    A kind of the const-object style has the type `typeof X.Y`, and no selector matches it. The rule applies to these files:
    - each file that the V3 work adds;
    - each file where a V3 step adds or edits a declaration;
    - each file that receives a moved declaration.

    Other files keep their sites: a file that a declaration only leaves, a file that only changes an import path, and a file that moves with no other change. Test files stay outside the rule, as for `kanthord/no-inline-param-type` (`eslint.config.js:1103-1110`). Constraint: the rule adds no entry to `eslint-suppressions.json`. Each type of this page uses named interfaces and a const object for each kind. Each build step of [LA](LA-agent-build.md) lists its files. The other sites of today go to [HANDOFF.md](../HANDOFF.md#architecture), Architecture.

40. **L3-D40.** The contract fixes the input type, the output type and the invariants of [Output](#output). It does not fix the model text, the tool calls or the end that a run reaches. Constraint: an acceptance check asserts an exact model-dependent value only through the LLM stub.
41. **L3-D41.** The Agent V2 and Worker V3 work merges into `main` first, and `feature/workbench-v2` rebases onto it after this round (Ulrich, 2026-11-22). The Workbench of `main` keeps `openSession` with the interim redaction until that rebase. Constraint: each branch-only item lies in [Constraints on the Workbench branch at rebase](#constraints-on-the-workbench-branch-at-rebase), and the rest of this page describes `main`.
42. **L3-D42. Applied to L1.** L1 states the merge order of [L3-D41](#decisions), and the Workbench change owns AC19 on the branch after the rebase.
43. **L3-D43. Applied to L1.** L1 gives the three texts of the contract output to L3 and each event to L6. The agent CLI composes the system prompt with the composition function of the agent runtime.
44. **L3-D44. Applied to L2.** `run agent` composes the system prompt with `profilePrompt` and `composeSystemPrompt` of the agent runtime before the open.
45. **L3-D45. Applied to L1.** `prompt-render.ts` stays in the server part, and its `finalPrompt` calls the composition function of the agent runtime.

## Open questions for Ulrich

L3 holds no open question for Ulrich.
