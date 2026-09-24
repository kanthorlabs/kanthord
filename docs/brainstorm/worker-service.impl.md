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
- A sweep every 30 s ends every registration whose last heartbeat is older than `worker.heartbeatWindow`.
- A live execution of an ended registration follows the loss rules of the [Scheduler Service](scheduler-service.md#liveness).
- The idle backoff of an instance stays under the window, and the sibling of the harness extension states its interval.
- A registration that ends by expiry frees the slot of its binding.
- The same client identity registers again with a fresh idempotency key.
- The expiry proves no stop, and physical stop and capacity reuse are the B9 items SC5 and W5.

## The command group `worker`

[architecture.impl.md](architecture.impl.md) rules the command surface and client configuration.
This sibling declares the command table of the group `worker`.

- `register [--token <jwt>] [--idempotency-key <ulid>]` calls `POST /api/worker/register`, operation ID `worker.register`, with the client access policy.
- `heartbeat [--token <jwt>]` calls `POST /api/worker/heartbeat`, operation ID `worker.heartbeat`, with the client access policy.
- `handover [--token <jwt>]` calls `POST /api/worker/handover`, operation ID `worker.handover`, with the client access policy. It prints nothing but a status, and it never prints the envelope.
- `credential` runs inside the `worker` application alone and is no command of the CLI.

The command registers a worker instance under the client identity of its machine JWT. It creates no human account, client identity or worker definition.
[gateway-service.impl.md](gateway-service.impl.md#worker-instance-registration) owns the JWT verification, the instance-count transaction and the registration replay contract.
`--endpoint` belongs to the group and resolves through the client configuration precedence.
`--token` overrides `KANTHORD_TOKEN` and the `token` field of the client configuration file. A missing token stops the command without prompting or sending a request.
The request presents that token as a bearer token and carries an empty body. The command accepts no server configuration option.
An explicit idempotency key must be a canonical ULID. The command generates a key when the option is omitted and performs no automatic retry.
Success prints one JSON line containing the `runtimeIdentity` of the instance and the `idempotencyKey`, and exits with zero. It prints no token and saves no client configuration.
A declared failure prints its HTTP status and idempotency key without the token and exits with a non-zero status. An indeterminate result prints the key and instructs the operator to retry the same request with that key.
The runtime of a worker may call the route directly with its machine JWT.

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
The bound of the global prompt and the bound of the project prompt are epic decisions.
The acceptance path proves the configured precedence, an absent source, an invalid source, a disabled layer and a link that leaves the workspace.
It proves that a reviewer execution takes no agent file of the workspace.

## The credential store of an execution

- Every inference call of a native agent, including compaction and retries, resolves its auth through the pi-ai credential store of the execution. [project-service.impl.md](project-service.impl.md#the-credential-store-of-an-execution) rules that store.
- The adapter maps the model identifier and the reasoning effort of the effective configuration onto the pi model and fails closed.
- The store holds the credential of one execution, so no credential crosses executions.
- Environment hygiene of the pi process belongs to the adapter, and the process inherits no provider environment variable.

## The credential handover

- `worker.handover` is a `client` operation of `unary` lifetime that requires a live execution. `POST /api/worker/handover` takes an empty body and answers the envelope that [project-service.impl.md](project-service.impl.md#the-credential-handover) rules.
- The `worker` application calls it once after its claim and before the first inference call.
- It decrypts the envelope with the key that it derives from its own `masterKey`. It builds an in-memory pi-ai credential store from the payload and holds the plaintext in memory alone.
- `worker.credential` is a `client` mutation at `POST /api/worker/credential` that requires a live execution. The application calls it after each refresh that pi-ai performs and once at the release.
- The application discards every credential when the execution ends, and it writes none to a file.
- A platform action runs through the MCP tool of the server.
- The `worker` application reads `masterKey` from the client configuration file alone, which [gateway-service.impl.md](gateway-service.impl.md#the-command-group-gateway) declares. It accepts no environment variable and no option for it.
- An absent or invalid `masterKey` stops the start of `kanthord serve worker`.
- A `masterKey` that differs from the one of the server fails every decryption. The application ends the execution as a cannot-progress condition.

## Tool table

The tool table of a native agent holds three sources.
The first source is the pi built-in tools: `swe@1` enables read, edit, write, grep, find, ls and bash, and `re@1` enables read, grep, find and ls.
The second source is kanthord's own tools, which the server serves through its MCP server.
An external harness reaches the same MCP server, and pi reaches it as a tool source.
The third source is the other tools that a project adds, including other MCP servers.
The first version supports MCP v2, https://ts.sdk.modelcontextprotocol.io/v2/.
The tool register and the abstraction layer for tool instances manage the three sources.

## Platform connector and platform implementations

The GitHub implementation calls the GitHub REST API through Octokit at a pinned version.
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

- `simple-git` at 3.36.0 performs every git operation by spawning the `git` binary of the host.
- Its timeout plugin bounds each operation by the remaining resource budget of the execution.
- Its abort plugin binds to the `Context` of the execution.
- Under the SSH transport form, the `git` child inherits the SSH environment of the user that runs the hosting application.
- Under the HTTPS transport form, the hosting application supplies `GIT_ASKPASS` and the token through the environment of the child.
- [project-service.impl.md](project-service.impl.md) rules that supply.
- The connector passes no credential inside a URL and no credential on a command line.
- The credential helper writes no credential to a file in the workspace.

## Workspace

- The workspace root is `workspaces/` of the state directory of [architecture.impl.md](architecture.impl.md#the-directories-of-the-server).
- The workspace of a steps execution is `workspaces/<objective identity>/<repository binding identity>/`, keyed as [worker-service.md](worker-service.md#executions) states.
- The workspace of an evaluation execution is `workspaces/<execution identity>/`, and the Worker Service removes it at the release.
- A directory under the root holds mode `0700`, and the permissions audit of the start covers the root and no entry under it.
- The bounded retention of [worker-service.md](worker-service.md#executions) is 7 days since the end of the last execution of the objective.
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

The first version approves two read methods of the GitHub implementation.

- The read of a pull request.
- The list of the review comments of a pull request.

The tool of the action performer takes the execution identity only.

## Commit attribution

The page requires that every commit of the execution is attributable to its task and its attempt.
The carrier of that attribution is an epic decision.

## Stop and budget

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
