---
title: Worker Service Implementation
---

# Worker Service Implementation

This file holds the implementation rulings for the mechanisms that realize [worker-service.md](worker-service.md).
This file is not a design document, and `worker-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate, and a change to it is a change to the workers that run on it.

The implementation uses `simple-git` at 3.36.0.

## Native agent runtime

The first version supplies the workers `general@1` and `reviewer@1`.
The workers `claude@1` and `opencode@1` follow with the registration of an externally hosted instance.
The first version supplies `general@1` with the one agent `swe@1` and `reviewer@1` with the one agent `re@1`.
`tdd@1` follows when the runtime hosts several agents in one execution.
The native agent `swe@1` of `general@1` runs `@earendil-works/pi-coding-agent` at 0.86.0 in-process behind a kanthord-owned adapter.
The adapter builds the runtime with `ModelRuntime.create({ credentials })` over the credential store of the execution and the session with `createAgentSession({ modelRuntime })`.
The first version supports a native agent at the `worker` placement, and no proxy exists.
The hosting application gives pi its own directories.
It disables the discovery of user extensions, skills, prompt templates and themes.
It uses an in-memory session manager.
It disables the version check, the install telemetry and the provider catalog refresh.
It pins `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` at 0.86.0.
A pi version bump affects the workers that run on it and the credential shape of the handover.
Every runtime setup call carries an abort signal with a deadline.

## The worker template registry

- A worker template is a static server module; the registry maps worker names to templates and loads no runtime plugin.
- The catalog holds one declaration per agent name, with options, a whole-configuration constraint and prompts.
- A worker references that declaration and carries no separate configuration version.
- Options use `zod` at 4.4.3, and the constraint uses `superRefine`.
- `general@1` references `swe@1`; `reviewer@1` references `re@1`.
- Both declare an empty option schema.
- The declaration supplies no provider, model identifier or reasoning-effort default.
- `agent get` answers the declaration, `configurationSchema`, `overridableFields` and `enablement`.
- `enablement` is null when no record exists.

## Agent configuration validation

- The Worker Service owns enablement writes, effective configuration resolution and `validateEntry(tx, workerName, entry)`.
- The [entry forms](worker-service.vocabulary.md#entry) define inheritance and required fields.
- A write refuses nonempty `options`.
- Every enablement write, worker binding write and resolution runs the same checks.
- It checks the override allowlist before the merge, then validates the complete effective configuration.
- `overridableFields` of `swe@1` and `re@1` is `["agentProvider", "modelIdentifier", "reasoningEffort"]`.
- `validateEntry` refuses a worker whose agent has no enabled enablement, and names that agent.
- This refusal occurs inside the worker binding write transaction.
- An enablement change calls `entriesOfAgent(tx, agentName)` of the Project Service in the transaction of its commit.
- It validates every dependent worker binding and lists invalid bindings in its refusal.
- Removal checks all dependents in that same transaction.
- [The collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) requires co-location of the two owners.
- A resolution reads the worker binding, entry, enablement and credential metadata from one snapshot and records their revisions.
- Resolution makes no network call.
- The instance healthcheck reports whether the effective configuration resolves.

Provider definitions contain no auth types; [custody](custody.impl.md#platform-implementations) owns those types and suitability.

- A provider is a member of the [agent provider set](worker-service.vocabulary.md#agent-provider).
- Built-in definitions use `getBuiltinProviders()` of `@earendil-works/pi-ai` at 0.86.0.
- A model identifier belongs to `getBuiltinModels(provider)` or the `models` metadata of an `openai-compatible` credential.
- An empty `models` list permits no model selection.
- The reasoning effort belongs to the model's supported levels from `getSupportedThinkingLevels` or credential metadata `reasoningLevels`.
- A level that no source establishes fails validation.
- The Worker Service sends `{ credential, platform }` to custody and consumes its suitability result.
- It reads metadata through custody, never the secret.

## Configuration schema

- `configurationSchema` uses JSON Schema draft 2020-12, emitted by `z.toJSONSchema` of `zod` at 4.4.3.
- Its source is the effective-configuration schema, not the template's option schema.
- The root is an object with `additionalProperties: false`.
- All five properties below are required; none carries `default`, and the schema holds no `options`.

| Property | Schema |
| --- | --- |
| `agentProvider` | `string`; the name of an agent provider of the enablement |
| `provider` | `string`, enum `github-copilot`, `openai`, `anthropic`, `openai-compatible` |
| `credential` | `string`; a credential name |
| `modelIdentifier` | `string` |
| `reasoningEffort` | enum `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

- The schema description states the whole-configuration constraint of [configuration validation](#agent-configuration-validation).
- It names model membership in the provider catalog and reasoning-effort membership in the supported levels of that model.
- JSON Schema validates no cross-field lookup; the Worker Service enforces it.

## The OpenAI-compatible provider

- The Worker Service builds the pi provider from the credential metadata of the resolved revision.
- It calls `createProvider` with id `openai-compatible`, the agent provider name and metadata `baseUrl`.
- It supplies `auth: { apiKey: envApiKeyAuth("<agent provider name> API key", []) }` and `api: openAIResponsesApi()`.
- The environment-variable list is empty; the execution store supplies the credential.
- Each metadata model becomes a pi model with provider `openai-compatible` and the metadata base URL.
- The model carries `api: "openai-responses"`, `contextWindow`, `maxTokens` and the established reasoning levels.
- Input defaults to `["text"]`, and all cost rates are zero.
- The model list enters `createProvider`, and `setProvider` registers the provider.
- The adapter builds each model rather than reuses `OPENAI_MODELS`, whose base URLs address OpenAI.
- Provider construction performs no write-time remote call.

## The provider check

- `worker.provider.check` is a server-wide read operation under `human` access, with no project or binding.
- Its route is `POST /api/worker/provider/check`, and its input is only `{ credential }`.
- It accepts an `openai-compatible` credential and reads `baseUrl` from metadata through custody.
- No raw key reaches a Worker operation.
- Custody attaches the authorization header inside `use`, caches nothing and records the call against the credential record.
- `GET <baseUrl>/models` has a 10 s deadline.
- HTTP 200 holds `connection` with one of these values:
  - `ok`: the remote returns the OpenAI list shape.
  - `unauthorized`: the remote returns 401 or 403.
  - `unreachable`: a network failure or deadline prevents the answer.
  - `invalid_response`: the answer lacks the OpenAI list shape.
- An `ok` answer holds `models`, with `id`, `ownedBy` and `created` per model.
- HTTP 400 reports invalid input or an unsuitable credential; HTTP 404 reports an unknown credential.
- Error codes use the prefix `worker.provider.*`.
- The answer holds no key and pre-fills model ids, not limits or reasoning levels.
- A human approves models through a [credential metadata revision](custody.impl.md#platform-implementations).

## Agent provider healthcheck

- Every agent provider has a report-only resource healthcheck in the [health report](gateway-service.impl.md#the-resource-healthcheck-report).
- The check reads `GET /models` of its provider with its credential and reports provider readiness.
- It groups calls by provider endpoint and credential and attributes the result to each agent provider.
- Its capability is `model-list read`; it spends one request and no inference token.
- `GET /models` proves model-list access only, not inference readiness or model suitability.
- The check belongs to neither the liveness answer nor the claim path; instance healthchecks retain local resolution.
- [Custody healthcheck limits](custody.impl.md#the-resource-healthcheck) govern forbidden probes, unavailable probes and OAuth expiry without refresh.
- Shared probe code changes no owner.

## Configuration tests

- Tests cover both entry forms, missing enablement, disablement, complete-entry refusal and the empty option schema.
- Tests cover override allowlists, model catalogs, established reasoning levels and all five effective-configuration fields.
- Tests assert schema draft, required properties, absent defaults, absent options and the whole-configuration description.
- Tests cover transactional changes and removals, dependency lists, snapshot reads and recorded revisions.
- Tests cover the metadata provider build, per-model base URLs, zero costs and absent environment keys.
- Tests cover every provider-check answer, status, deadline and the absence of raw keys.
- Tests cover healthcheck grouping, attribution, report-only behaviour and no inference call.

## Externally hosted worker

The kanthord extension of Claude Code and the kanthord plugin of opencode register the instance under its client identity, issue the work pull, drive the execution operations through the CLI and the MCP server, and release.
Their design, and the packaging of the `/work` orchestration skill that they carry, are epic decisions.

## The identities of the Worker Service

- A runtime identity is `worker_instance_<ulid>`.
- The output schema of `POST /api/worker/register` returns it under `runtimeIdentity`.
- The machine identity of [gateway-service.impl.md](gateway-service.impl.md#the-forwarding-contract) names it for a live registration.
- It is no JWT claim.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.

## Registration heartbeat

- Every authenticated request of the client identity of a registered instance renews its heartbeat.
- This covers the work pull, every execution operation and every MCP request.
- An explicit heartbeat request is `POST /api/worker/heartbeat`, operation ID `worker.heartbeat`, with the client access policy and an empty body.
- It answers 204.
- The Worker Service records the time of the last heartbeat with a monotonic clock.
- The [resource healthcheck](worker-service.md#instances-and-hosting) of an instance reports `healthy` when its last heartbeat is inside `worker.heartbeatWindow`, and `unhealthy` otherwise.
- Its `capability` is `liveness of a registration`.
- A test checks both sides of the heartbeat window and asserts that the resource healthcheck changes no registration or instance healthcheck.
- A sweep every 30 s ends every registration whose last heartbeat is older than `worker.heartbeatWindow`.
- A live execution of an ended registration follows the loss rules of the [Scheduler Service](scheduler-service.md#liveness).
- The idle backoff of an instance stays under the window, and the sibling of the harness extension states its interval.
- A registration that ends by expiry frees the slot of its binding.
- The same client identity registers again with a fresh idempotency key, after an expiry or after its deregistration.
- The expiry proves no stop, and physical stop and capacity reuse are the B9 items SC5 and W5.

## Inspection operations

- Five `human` operations expose the published worker contract, the agent declaration and enablement, and the runtime-only instance record. Each one is `unary`, declares `mutation: false`, uses the default 30 s timeout and reads no table of another service.
- `worker.catalog.list` is `GET /api/worker/catalog` with `limit` and `cursor` under the [pagination rule](architecture.impl.md#pagination), keyed by worker name in descending order. An item holds `name`, `host` (`kanthord` or `external-harness`), `declaredNodeStates` and `requiredNodeFormat`. The answer lists the supplied workers; a registration adds no entry.
- `worker.catalog.get` is `GET /api/worker/catalog/:workerName`. The answer holds the item fields, `harness` for an externally hosted worker, and `method`, `agentName` and `resourceBudget` for a worker that kanthord hosts. An unknown name answers 404 `worker.catalog.not_found`.
- `worker.agent.get` is `GET /api/worker/agent/:agentName`, keyed by agent name. It answers `agentName`, `configurationSchema`, `overridableFields`, `basePrompt` when declared, `agentPrompt`, `tools` and `enablement`, the agent enablement or `null`. It composes no prompt and reads no agent file. An unknown agent answers 404 `worker.agent.not_found`. [Configuration schema](#configuration-schema) defines the schema, and [the worker template registry](#the-worker-template-registry) owns the declaration.
- `worker.instance.list` is `GET /api/worker/instance` with optional `projectId`, `workerBindingId`, `limit` and `cursor`. `projectId` is a `project_<ulid>` and `workerBindingId` is a `binding_<ulid>` of a worker binding. With `projectId`, a binding outside that project answers 400. The answer pages live instance records by runtime identity descending. It is a live inventory and no history.
- `worker.instance.get` is `GET /api/worker/instance/:runtimeIdentity`. An unknown or ended instance answers 404 `worker.instance.not_found`.
- An instance record holds `runtimeIdentity`, `projectId`, `workerBindingId`, `workerName`, `host`, `placement` for a kanthord host, `clientId` and `name` for a registered instance, `activity` (`idle`, `pulling` or `executing`), `draining`, `executionId` while executing, and `registered`. It holds no JWT.
- The reads change no registration, no pool, no configuration and no scheduling state, and they infer no dead process from silence.
- The instance healthcheck runs before a work pull and before a claim commits, not through a human inspection command. A disabled enablement shows in `worker agent get`; a missing enablement refuses the binding write under [configuration validation](#agent-configuration-validation). The health report covers registration liveness.
- Tests cover each human read and machine-JWT refusal, each unknown name or identity, the binding-to-project check, and records after registration, during execution and after a drain. They assert null and disabled enablements, no JWT and no pool side effect.

## Deregistration

- `worker.instance.deregister` is a `client` mutation of `unary` lifetime at `DELETE /api/worker/instance/:runtimeIdentity`, with no body, the default 30 s timeout and the default 10 MiB body limit.
- It is no execution operation and requires no live registration under [the Gateway machine identity rules](gateway-service.impl.md#the-jwt). Authentication still checks the credential and binding.
- The handler ends the live registration whose runtime identity equals the path parameter and whose client identity, worker binding and project equal those of the caller. The path parameter names the target because the machine identity names no runtime identity after the end.
- The handler ends the registration and frees its slot through the Project instance-count collaboration in the same transaction, as registration takes it.
- Every target that is no live registration of the caller answers 404 `worker.instance.not_found`. This includes an unknown or ended identity, another client's instance, a server-placement instance and a newer registration of the same client identity, which stays intact. A delayed request for an ended runtime identity never ends a newer registration.
- The answer is 200 `{ runtimeIdentity, registered: false }`.
- A retry with the same `Idempotency-Key`, caller and target replays the recorded answer after the end, inside one process and the TTL. The operation declares no `replayGuard`. Authentication grants no bypass for a revoked credential or unavailable binding.
- A retry after a restart answers 404. The worker application and harness extension read that answer after their own call as the end of their registration.
- The operation proves no process stop, releases no execution and authorizes no workspace reuse. A live execution follows the [Scheduler liveness rules](scheduler-service.md#liveness). Physical stop and capacity reuse stay B9 SC5 and W5.
- Tests assert end and slot release in one transaction, same-key replay after the end, post-restart 404, and 404 for each non-owned target. They assert that a newer registration stays intact, no server-placement instance ends through the route, and the worker application calls it at graceful stop.

## Configuration

- The Worker Service owns the section `worker` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.
- `worker.globalPrompt` holds the path of a Markdown file, as a string, and it defaults to an empty string.
- An empty value means the global prompt source is absent and the composer moves to the next source.
- A relative path resolves against the data directory.
- The loader of the composer reads that file under the same rules as every agent file.
- `worker.heartbeatWindow` holds the window of a registration heartbeat in seconds, as a positive safe integer, and it defaults to `300`.

## Prompt composition

The prompt composer resolves the global prompt from the file that `worker.globalPrompt` names, then `~/.agents/AGENTS.md`, then `~/.claude/CLAUDE.md`.
It resolves the project prompt from the repository binding, then `AGENTS.md` of the workspace root, then `CLAUDE.md` of the workspace root.
For an evaluation method that resolution stops at the repository binding, and the composer reads no agent file of the workspace.
It reads an agent file as UTF-8 Markdown, it rejects a control character outside tab and newline, and it resolves no `@` import.
It rejects a path of the workspace that a link resolves outside the workspace.
It follows a link of the host location, because the operator manages the dotfiles of the host.
A deadline bounds every read.
The repository context-file discovery of pi stays disabled, and the composer performs every load, so one loader holds the order and the provenance.
A layer digest hashes the UTF-8 encoding of the exact layer text, with no trimming, no newline conversion, no Unicode normalization and no JSON quoting, and [architecture.impl.md](architecture.impl.md) rules the algorithm and the rendering.
pi receives the base prompt and the agent prompt as its system prompt, with the framing that states the layers and their precedence.
It receives the global prompt, the project prompt and the work prompt as separate marked content, each one attributed to its source.
The adapter pins the composed layers against the compaction of pi, so every layer survives a compacted context.
The tool table enforces every obligation that a tool can enforce, and `re@1` holds no write tool.
The first version supplies one base prompt for `swe@1` and `re@1`, [assets/prompt/base.md](assets/prompt/base.md), and the agent prompts [assets/prompt/swe@1.md](assets/prompt/swe@1.md) and [assets/prompt/re@1.md](assets/prompt/re@1.md).
The source of the three texts is the ideals file of Ulrich, split by single obligation: a standard of the product and a shared conduct go to the base prompt, the act of producing goes to `swe@1`, the act of judging goes to `re@1`, and a rule that presupposes a human interlocutor is adapted or dropped.
The recommendation-first format of a confirmation request returns with the clarification interface.

- Every source of the global prompt and of the project prompt holds at most 32768 UTF-8 bytes.
- A source above the bound is invalid.
- The layer takes no content from an invalid source.

The acceptance path proves the configured precedence, an absent source, an invalid source, a disabled layer and a link that leaves the workspace.
It proves that a reviewer execution takes no agent file of the workspace.

## The credential store of an execution

- Every native inference call, including compaction and retries, resolves auth through the [custody execution store](custody.impl.md#the-credential-store-of-an-execution).
- The view exposes only the credential that the effective agent provider names, under the pi adapter id.
- `read(providerId)` answers `undefined` for every other id.
- The adapter maps the model identifier and the reasoning effort of the effective configuration onto the pi model and fails closed.
- The store holds the credential of one execution, so no credential crosses executions.
- Environment hygiene of the pi process belongs to the adapter, and the process inherits no provider environment variable.

## The credential handover

- `worker.handover` is a `client` operation of `unary` lifetime that requires a live execution. `POST /api/worker/handover` takes an empty body and answers the envelope that [custody.impl.md](custody.impl.md#the-credential-handover) rules.
- The `worker` application calls it once after its claim and before the first inference call.
- It decrypts the envelope with the key that it derives from its own `masterKey`. It builds an in-memory pi-ai credential store from the payload and holds the plaintext in memory alone.
- `worker.credential` is a `client` mutation at `POST /api/worker/credential` that requires a live execution. The application calls it after each refresh that pi-ai performs and once at the release.
- The application discards every credential when the execution ends, and it writes none to a file.
- A platform action runs through the MCP tool of the server.
- The `worker` application reads `masterKey` from the client configuration file alone, which [gateway-service.impl.md](gateway-service.impl.md#the-client-configuration-file) declares. It accepts no environment variable and no option for it.
- An absent or invalid `masterKey` stops the start of `kanthord serve worker`.
- A `masterKey` that differs from the one of the server fails every decryption. The application ends the execution as a cannot-progress condition.

## Evidence upload

The `worker` application serves `evidence upload` locally for a file on its host.
The server and the harness extension serve the same helper on their own hosts.
The helper safely opens the path inside the execution workspace.
It refuses path traversal, symbolic-link escapes and path replacement races.
It calls `mission.evidence.upload.begin` with execution context, evidence metadata, size, media type and optional SHA-256.
It sends the file directly to the presigned PUT destination, then calls `mission.evidence.upload.complete`.
It follows [the object evidence contract](mission-service.impl.md#object-evidence) for all placements and co-locations.
It returns the evidence identity and `s3://` URI to the agent.
A reader's component obtains a presigned GET through the content read operation.
No storage credential enters the credential handover.
The presigned URL is an API answer, not a handover field, tool result or agent-context value.
The MCP server exposes no upload write.

- Tests exercise local file access at every placement and refuse an out-of-workspace path or unsafe open.
- Tests assert begin, direct PUT and complete order, with publication only after the checks pass.
- Tests keep the storage credential and presigned URL out of the handover and agent context.
- Tests return only the evidence identity and object URI to the agent.
- Tests keep the MCP write set unchanged.

## Tool table

The tool table of a native agent holds three sources.
The first source is the pi built-in tools: `swe@1` enables read, edit, write, grep, find, ls and bash, and `re@1` enables read, grep, find and ls.
The second source is kanthord's own tools, which the server serves through its MCP server.
An external harness reaches the same MCP server, and pi reaches it as a tool source.
The third source is the other tools that a project adds, including other MCP servers.
The first version supports MCP v2, https://ts.sdk.modelcontextprotocol.io/v2/.
The tool register and the abstraction layer for tool instances manage the three sources.

## Platform connector and platform implementations

The GitHub implementation uses `octokit` at 5.0.5 with `X-GitHub-Api-Version: 2022-11-28`.

- Pull request read calls `GET /repos/{owner}/{repo}/pulls/{pull_number}`.
- Review comment list calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments`.
- Both return the response body unchanged.
- `limit` maps to `per_page`, defaults to 100 and ranges from 1 to 100.
- `cursor` is base64url canonical JSON `{ page, perPage }`.
- A differing `limit` answers 400 `worker.platform.github.cursor_page_size_mismatch`.
- `nextCursor` is null when no `rel="next"` link exists.
- Tool discovery embeds each endpoint's dereferenced response schema under `result`.
- The build extracts those schemas from `@octokit/openapi` at 23.0.2.
- A result class answers `worker.platform.github.<class>` with the HTTP status and GitHub message.
- The embedded schema is large; a harness that sends `outputSchema` to its model spends tokens on it.
- Tests assert unchanged bodies, pagination bounds, cursor page-size refusal, schema extraction and result-class details.

A platform implementation is a TypeScript module with its own method signatures and no shared interface.
The platform connector is a registry keyed by the platform value of the binding.
The registry uses static registration and loads no runtime plugin.
The GitHub implementation decodes a GitHub webhook payload into GitHub event types.
Every method returns a discriminated union: the success with the result of the operation, or the result class.
A deadline bounds the retry of a read on a transport error.
The platform implementation retries no write.
The platform implementation decides whether a request waits for a reply of the platform or returns after the platform accepts it.
An epic decides that form for each platform.

## Repository connector

The start requires git, OpenSSH and bash on the host and refuses a host without any of them.

- `simple-git` at 3.36.0 performs every git operation by spawning the `git` binary of the host.
- Its timeout plugin bounds each operation by the remaining resource budget of the execution.
- Its abort plugin binds to the `Context` of the execution.
- The `git` child inherits the SSH environment of the user that runs the hosting application.
- [project-service.impl.md](project-service.impl.md#the-network-git-operations) rules that environment.
- The connector passes no credential inside a URL and no credential on a command line.

## The verifications

The verification run follows [mission-service.impl.md](mission-service.impl.md#the-verifications).
The workspace root for that run is the root of the execution workspace, not the server's `workspaces/` directory.
An initiative uses one subdirectory per distinct repository binding from its current objectives.
A test checks the host requirements and the shared verification run mechanism.
A test checks duplicate removal, discarded objectives, base-branch heads and one tested commit per binding for an initiative.
A test checks the evidence-placement rule when an initiative's objectives name no repository.
Tests prove that execution code, never the agent, runs verifications before judgement.
Reviewer tests assert a failed assessment without judgement for a failed or unrun verification; the rationale names that verification.
Tests require a reviewer to judge without removed content and name it in its rationale.
Steps tests revise after a failed verification within the resource budget, commit anew and rerun the verifications.
Budget-end tests assert a failed task assessment without judgement when a verification fails or remains unrun.
Tests permit judgement only after every verification passes.

## Workspace

- The workspace root is `workspaces/` of the state directory of [architecture.impl.md](architecture.impl.md#the-directories-of-the-server).
- The workspace of a steps execution is `workspaces/<objective identity>/<repository binding identity>/`, keyed as [worker-service.md](worker-service.md#executions) states.
- The workspace of an evaluation execution is `workspaces/<execution identity>/`, and the Worker Service removes it at the release.
- A directory under the root holds mode `0700`, and the permissions audit of the start covers the root and no entry under it.
- The workspace retention period of [worker-service.md](worker-service.md#executions) is 7 days from the end of the last execution of the objective.
- A sweep at the start and every hour removes an expired workspace.
- The state directory holds the workspace because an active workspace holds uncommitted work and unsubmitted evidence that a re-clone cannot rebuild.

## Action performer

One internal function implements the action performer.
The evaluation method of `reviewer@1` and the MCP tool both call that function.
A per-execution-identity mutex serializes invocations inside the server.
The mutex establishes the no-redispatch invariant inside one server process only.
A durable dispatch record that survives a server restart is the B9 item W2, and it is an epic decision.
The action performer creates a fresh clone through the repository connector for a network git write.
It removes that checkout after the call.

The tool answers `{ toolName: "repository-action-request", items: ActionResultItem[] }`.
`ActionResultItem` is discriminated on `kind`, with one value per return class.

- `submitted` holds `externalObject`, the `ExternalObject` record that the Mission Service accepted, in the schema that `mission.externalObject.get` answers.
- `awaiting-prerequisite` holds `action: { key, bindingId }`, the waiting action, and `prerequisite: { key, externalObjectId }`, the requested action it follows and its external object. The reviewer release names that `externalObjectId` in its `external-observation` wait fact.
- `failed-before-effect` holds `action: { key, bindingId }` and `refusal: { class, code, message }`, where `class` is `confirmed_failure`, `retryable_refusal` or `final_refusal`. A final refusal declines the request before any write. `code` and `message` come from the connector that transported the request: the platform implementation for a platform action, the repository connector for a network git write.
- `uncertain` holds `action: { key, bindingId }`, `uncertainty: "effect" | "recording" | "both"` and an optional `address`, present when the remote returned the address and the Mission submission stayed uncertain. An `unknown_outcome` result class produces `effect`.

`key` is the `FrozenAction.key` of the attempt, and `bindingId` is the repository binding of the action, under [the attempt](mission-service.impl.md#the-attempt).
The first version produces no `awaiting-prerequisite` item, because a repository strategy holds at most one action and its `follows` is null.
The answer holds no release instruction, because [B9 items A3, W1, W4 and PR2](HANDOFF.md#worker-and-project-services) own what follows a failure or an uncertainty.

## MCP server

The MCP v2 server in [Tool table](#tool-table) is the one MCP server of the server.
An external harness connects over HTTP with the machine JWT of its client identity, and the live registration of that client identity is required.

- The MCP server uses the Streamable HTTP transport of the MCP specification.
- One endpoint path accepts `POST`, `GET` and `DELETE`.
- Every client JSON-RPC message is a new `POST`.
- The server answers a request with one `application/json` body or a `text/event-stream` response that stays open.
- The client may open a `GET` stream for server messages.
- The server assigns `Mcp-Session-Id` at initialization.
- Every later request carries `Mcp-Session-Id`.
- The client resumes a broken stream with `Last-Event-ID`.
- The specification states that a disconnection is no cancellation.
- A client cancels with an explicit `CancelledNotification`.
- The Worker Service owns the session.
- The Gateway owns the connection.
- [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) defines the lifetime of the operation.
- The v2 TypeScript SDK ships the Streamable HTTP server transport and the Hono integration package `@modelcontextprotocol/hono`.
- The endpoint mounts on the Gateway app without a second listener.
- The server supports no WebSocket transport and no deprecated HTTP+SSE transport.

This revision projects no tool to a REST route, and it gives the CLI no command that calls a tool.
A tool is reached through the MCP server.

- The endpoint path is `/api/worker/mcp`.
- `src/worker/contract.ts` declares three operations at that path. Each declares the `client` access policy, a live registration, the operational store, the 10 MiB body limit and the [900 s timeout](gateway-service.impl.md#cancellation).
- `worker.mcp.message` is `POST /api/worker/mcp` with the `stream` lifetime. Its body is one JSON-RPC message of the MCP specification. The answer is one `application/json` body or one `text/event-stream` response that stays open until the server answers that message.
- `worker.mcp.listen` is `GET /api/worker/mcp` with the `stream` lifetime and no body. It opens the server-to-client event stream. The route timeout ends the response, and the client resumes with `Last-Event-ID`.
- `worker.mcp.close` is `DELETE /api/worker/mcp` with the `unary` lifetime and no body. It ends the session that `Mcp-Session-Id` names and answers 204.
- The Gateway admits the request first: the JWT, then the live registration. The session lookup runs after admission.
- The session identity is `mcp_session_<ulid>` under the [protocol-representation rule](architecture.impl.md#the-identity-and-the-time). The Worker Service binds it to the client identity of the initializing request and its registration. An admitted request that names a foreign, ended or absent session answers 404, and the client initializes again. A newly registered instance that presents a session of its earlier registration meets that 404.
- A session ends on `DELETE`, when its registration ends and at server stop. A session holds no authority: the JWT authenticates every request, and a session identity alone authorizes nothing.
- The three operations declare `mutation: false` under the [Gateway exemption](gateway-service.impl.md#idempotency-of-a-mutation), because an MCP client carries no `Idempotency-Key`. The bodies follow the MCP specification, and the tool schemas live in `tools/list`.
- Each tool declares a required `executionId` argument. Before every `tools/call`, the MCP server runs the same [execution proof component](architecture.impl.md#the-operation-and-its-two-entry-adapters) as the invocation chain. It passes the node, attempt and pinned revision of the proven claim to the tool, which reads none of them from the arguments.
- A failed proof answers a JSON-RPC error whose `data` holds the shared error envelope with code `gateway.invocation.execution_proof_failed`. A refusal of the tool answers a tool result with `isError: true` and the envelope in its content.
- A native agent at the `server` placement reaches the MCP server in-process under its hosted execution. Its proof reads the claim state and skips the registration comparison. A native agent at the `worker` placement and an external harness reach it over HTTP with their machine JWT.
- Protocol messages such as `initialize` and `tools/list` need the live registration, or the hosted execution for a native agent at the `server` placement, and no execution identity argument.
- A tool runs under a session context. A disconnect ends the response stream only and cancels no accepted tool execution. The Gateway cancels the session contexts in shutdown phase 1.
- The action performer holds the idempotency of its one write. A restart before its dispatch record stays B9 W2.
- Every client receives the same static list: `github-pull-request-get`, `github-pull-request-review-comment-list` and `repository-action-request`. No client kind, claim kind or assessment state changes it. The MCP server reads no Mission record for `tools/list`.
- A read tool requires a live claim of any kind. The action tool under a steps claim answers `isError: true` with `worker.action_performer.claim_not_evaluation`. Under an evaluation claim with no current passing assessment it answers `isError: true` with `worker.action_performer.assessment_not_current`.
- The evaluation method of `reviewer@1` calls the action performer. A tool call by a native agent meets the same checks. The action performer serializes calls of one execution identity and never dispatches an action twice.
- Tests cover the Gateway mount without a second listener, all three lifetimes, session binding to client identity and registration, 404 for a foreign, ended or absent session after admission, shutdown-phase-1 cancellation, `Last-Event-ID` resume and heartbeat renewal on every MCP request.
- Tests assert no `Idempotency-Key` on the MCP path, proof before every tool call, a failed proof as a JSON-RPC error, tool refusal as an `isError` result, and a disconnect during a tool call that completes and records its write. They cover the server-placement proof without registration and all three emitted operations with the specification revision.
- Tests assert the same tool list for every client and before and after an assessment, no Mission read for a list, both action-tool refusal codes, and serialized native-method and tool calls with no duplicate dispatch.

The first version approves two read methods of the GitHub implementation.

- The read of a pull request.
- The list of the review comments of a pull request.

The tool of the action performer takes the execution identity only.

## Commit attribution

The page requires that every commit of the execution is attributable to its task and its attempt.
The carrier of that attribution is an epic decision.

## Stop and budget

- `general@1` and `reviewer@1` declare default `resourceBudget: { turns: 200, wallTimeMs: 7200000 }`.
- Both fields are positive safe integers.
- The optional `resourceBudget` of a native worker binding overrides that default.
- A turn is one `turn_end` event of the pi agent loop.
- Wall time runs from the claim response to release.
- `claude@1` and `opencode@1` declare no resource budget.
- Tests cover defaults, binding overrides, positive safe integers, turn events and elapsed wall time.

The lease runs in the execution.
On revocation or loss the execution aborts the pi session and dispatches nothing after.
Abort is not proven to kill every descendant process, so the quiescence check before workspace reuse that the page states needs a mechanism.
`simple-git` kills the `git` process and not the `ssh` child of that process.
The budget of a turn count and a wall time is enforced on pi turn events and by abort, with the bash timeout below the remaining budget.

## Trust boundary

The operator provides the trust boundary as a disposable host that the operator trusts, or as an OS container around the server.
The host of every `worker` application sits inside it because that host holds `masterKey` and the credentials of its executions.

## Traces

The pi session entries of an execution become its transcript telemetry, with the execution identity, the attempt and the trace identity, redacted of secrets.
pi keeps its own compaction logic, and kanthord designs nothing for it.
The handover and the report enter no transcript telemetry.

## Acceptance path

The acceptance path is the `general@1` loop, the commit and the verification, the push, the release, the independent `reviewer@1` evaluation, the configured repository action, the authoritative observation of its end state, and the `Completed` outcome.
A scripted fake provider runs it deterministically.
A bounded real-provider smoke run proves the real configuration.
