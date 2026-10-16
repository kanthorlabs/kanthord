---
title: Worker Service Implementation
---

# Worker Service Implementation

This file holds the implementation rulings for the mechanisms that realize [worker-service.md](worker-service.md).
This file is not a design document, and `worker-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate, and a change to it is a change to the workers that run on it.

## Native agent runtime

The first version supplies the workers `coder@1` and `reviewer@1`.
The worker `claude-code@1` follows with the registration of an externally hosted instance.
The first version supplies `coder@1` with the one agent `swe@1` and `reviewer@1` with the one agent `re@1`.
`tdd@1` follows when the runtime hosts several agents in one execution.
The native agent `swe@1` of `coder@1` runs `@earendil-works/pi-coding-agent` at 1.1.0 in-process behind a kanthord-owned adapter.
The adapter obtains the runtime from the [model connector](llm.impl.md#the-model-connector) of the LLM component over the credential store of the execution, and it builds the session with `createAgentSession({ modelRuntime })`.
The first version supports a native agent at both placements through the same [worker unit](#the-worker-unit-and-its-wrappers), and no proxy exists.
The hosting application gives pi its own directories.
Before the first import of `@earendil-works/pi-coding-agent`, it sets `PI_OFFLINE=1` and sets `PI_CODING_AGENT_DIR` to `pi/` of the state directory, so pi downloads no tool binary.
The worker installs the [pi tool binaries](#pi-tool-binaries) into `pi/bin/`, the directory that pi searches before `PATH`.
The adapter persists no settings file in that directory or in `~/.pi`.
The [Agent implementation](agent.impl.md#session-file) rules the session file.
It disables the discovery of user extensions, skills, prompt templates and themes.
It disables the version check, the install telemetry and the provider catalog refresh.
It pins `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` at 1.1.0.
An execution of an externally hosted worker has no native agent, and a read of its [execution setup](#the-execution-setup) answers 409 `worker.execution.no_native_agent`.
A pi version bump affects the workers that run on it and the credential shape of the handover.
Every runtime setup call carries an abort signal with a deadline.

## Pi tool binaries

- The pi built-in tools `grep` and `find` run `rg` and `fd`. kanthord ships both programs at pinned versions. The worker never takes them from `PATH`.
- The manifest `static/pi-tools.json` of the engine lists each tool of the pi tool manager. A tool holds `version`, `repository` and one entry for each release target: `darwin-arm64`, `linux-x64` and `linux-arm64`.
- A target entry holds `url`, `archive_sha256`, `binary_path`, `binary_sha256` and `license_paths`.
- `pnpm run pi-tools:fetch` of the engine downloads the archives of the host target. It checks `archive_sha256`, extracts the binary and the license files, and checks `binary_sha256`.
- The fetch writes `.pi-tools/<target>/bin/<tool>` and `.pi-tools/<target>/licenses/<tool>/` in the engine. Git ignores `.pi-tools/`. A digest mismatch stops the fetch. A present binary with the right digest is not downloaded again.
- `make bootstrap`, `make release-build` and `make e2e` run the fetch.
- The single binary embeds each binary of its target as the asset `pi-tools/bin/<tool>`, and each license file as `pi-tools/licenses/<tool>/<file>`.
- The worker unit and the server both install the tools at startup, because a workbench session of the server also runs the pi tools `grep` and `find`. The server installs them after it creates the state directory and before it opens a service.
- Each reads the binary from the embedded asset inside the single binary, and from `.pi-tools/<host target>/` in a development checkout.
- It checks `binary_sha256`. Then it writes the binary to `pi/bin/<tool>` of the state directory with mode `0755`, through a temporary file and a rename. It skips a binary whose file already has that digest. It writes the license files to `pi/bin/licenses/<tool>/`.
- Then it runs `<tool> --version` from `pi/bin/`. A missing source, a host target outside the manifest, a digest mismatch or a failed run stops the start of the worker or of the server with `worker.start.tool_missing`.
- `pnpm run pi-tools:update <tool> <version>` of the engine rewrites the entry of one tool for the three targets with fresh digests. The root target `make pi-tools-update TOOL=<tool> VERSION=<version>` runs it. It refuses a release younger than the `minimumReleaseAge` of `pnpm-workspace.yaml`, 4320 minutes.
- A test compares the tool set of the pi tool manager with the tools of the manifest. A pi version bump that adds or removes a tool fails it.
- `bash`, `git` and `ssh` are host requirements of the [Repository component](repository.impl.md). A program that the agent runs through `bash`, for example `node` or `npm`, belongs to the environment of the project on the worker host.

## The worker template registry

- A worker template is a static server module; the registry maps worker names to templates and loads no runtime plugin.
- A worker references the declaration of its agent in the [agent catalog](agent.impl.md#the-agent-catalog) and carries no separate configuration version.
- `coder@1` references `swe@1`; `reviewer@1` references `re@1`.

## Externally hosted worker

The kanthord extension of Claude Code registers the instance under its client identity, issue the work pull, drive the execution operations through the CLI and the MCP server, and release.
Their design, and the packaging of the `/work` orchestration skill that they carry, are epic decisions.

## The identities of the Worker Service

- A runtime identity is `worker_instance_<ulid>`.
- The output schema of `POST /api/worker/register` returns it under `runtime_identity`, beside `resource_identity` from the verified machine identity and `worker_name` from the worker binding row that the registration transaction reads.
- The machine identity of [gateway-service.impl.md](gateway-service.impl.md#the-forwarding-contract) names it for a live registration.
- It is no JWT claim.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.
- The Worker Service answers the client attribution of a runtime identity to the Scheduler Service in-process: the `client_id` and the `client_name` of its `worker_instance` row, ended rows included. The human `worker.instance.get` still answers 404 for an ended instance.

## Registration heartbeat

- Every authenticated request of the client identity of a registered instance renews its heartbeat.
- This covers the work pull, every execution operation and every MCP request.
- An explicit heartbeat request is `POST /api/worker/heartbeat`, operation ID `worker.heartbeat`, with the client access policy and an empty body.
- It answers 204.
- The Worker Service records the time of the last heartbeat with a monotonic clock.
- The start of the server keeps every live registration and sets its last heartbeat to the start time.
- The [resource healthcheck](worker-service.md#instances-and-hosting) of an instance reports `healthy` when its last heartbeat is inside `worker.heartbeat_window`, and `unhealthy` otherwise.
- Its `capability` is `liveness of a registration`.
- A test checks both sides of the heartbeat window and asserts that the resource healthcheck changes no registration or instance healthcheck.
- A sweep every 30 s ends every registration whose last heartbeat is older than `worker.heartbeat_window`.
- A live execution of an ended registration follows the loss rules of the [Scheduler Service](scheduler-service.md#liveness).
- The idle backoff of an instance stays under the window, and the sibling of the harness extension states its interval.
- A registration that ends by expiry frees the slot of its binding.
- The Worker Service offers `endRegistrations(tx, projectId, resourceIdentity, now)` to the Project Service. It ends every live registration of the group in the transaction of the caller and opens no transaction. A removed or unavailable worker binding holds no live registration.
- A registration of a binding with no free slot, or of an unavailable binding, answers 409 `worker.instance.slot_unavailable`, the code of the resume.
- The same client identity registers again with a fresh idempotency key, after an expiry or after its deregistration.
- The expiry proves no stop, and physical stop and capacity reuse are the B9 items SC5 and W5.

## Inspection operations

- Four `human` operations expose the published worker contract and the runtime-only instance record. Each one is `unary`, declares `mutation: false`, uses the default 30 s timeout and reads no table of another service.
- `worker.catalog.list` is `GET /api/worker/catalog` with `limit` and `cursor` under the [pagination rule](architecture.impl.md#pagination), keyed by worker name in ascending alphabetical order, and the next page reads the names that are greater than the cursor. An item holds `name`, `host` (`kanthord` or `external-harness`), `declared_node_states` and `required_node_format`. The answer lists the supplied workers; a registration adds no entry.
- `worker.catalog.get` is `GET /api/worker/catalog/:worker_name`.
  The answer holds the item fields and `resource_budget` for every worker.
  It also holds `harness` for an externally hosted worker, or `method` and `agent_name` for a worker that kanthord hosts.
  An unknown name answers 404 `worker.catalog.not_found`.
- `worker.instance.list` is `GET /api/worker/instance` with optional `project_id`, `resource_identity`, `limit` and `cursor`. `project_id` is a `project_<ulid>` and `resource_identity` is `worker:kanthord:<binding name>`. `resource_identity` requires `project_id`, and a binding that the project does not hold answers 400 `worker.instance.binding_unknown`. The answer pages live instance records by runtime identity descending. It is a live inventory and no history.
- `worker.instance.get` is `GET /api/worker/instance/:runtime_identity`. An unknown or ended instance answers 404 `worker.instance.not_found`.
- An instance record holds `runtime_identity`, `project_id`, `resource_identity`, `worker_name`, `host`, `placement` for a kanthord host from the placement of the binding, `client_id` and `name` for a registered instance, `activity` (`idle`, `pulling` or `executing`), `draining` (from the [pool](#the-pool): true for a slot that drains), `execution_id` while executing, and `registered`. It holds no JWT.
- The dashboard shows the placement of a server-placement instance as the text `· server` in the row description, and `draining` as an outline badge. An instance of an external harness shows neither.
- The reads change no registration, no pool, no configuration and no scheduling state, and they infer no dead process from silence.
- The instance healthcheck runs before a work pull and before a claim commits, not through a human inspection command. A disabled enablement shows in `agent get`; a missing enablement refuses the binding write under [configuration validation](agent.impl.md#agent-configuration-validation). The health report covers registration liveness.
- Tests cover each human read and machine-JWT refusal, each unknown name or identity, the binding-to-project check, and records after registration, during execution and after a drain. They assert no JWT and no pool side effect.

## Deregistration

- `worker.instance.deregister` is a `client` mutation of `unary` lifetime at `DELETE /api/worker/instance/:runtime_identity`, with no body, the default 30 s timeout and the default 10 MiB body limit.
- It is no execution operation and requires no live registration under [the Gateway machine identity rules](gateway-service.impl.md#the-jwt). Authentication still checks the credential and binding.
- The handler ends the live registration whose runtime identity equals the path parameter and whose client identity, project and resource identity equal those of the caller. The path parameter names the target because the machine identity names no runtime identity after the end.
- The handler ends the registration and frees its slot through the Project instance-count collaboration in the same transaction, as registration takes it.
- Every target that is no live registration of the caller answers 404 `worker.instance.not_found`. This includes an unknown or ended identity, another client's instance and a newer registration of the same client identity, which stays intact. A delayed request for an ended runtime identity never ends a newer registration.
- The answer is 200 `{ runtime_identity, registered: false }`.
- A retry with the same `Idempotency-Key`, caller and target replays the recorded answer after the end, inside one process and the TTL. The operation declares no `replayGuard`. Authentication grants no bypass for a revoked credential or unavailable binding.
- A retry after a restart runs the handler again. It ends the registration when the registration is still live, and it answers 404 when the registration already ended. The worker application and harness extension read that 404 after their own call as the end of their registration.
- The operation proves no process stop, releases no execution and authorizes no workspace reuse. A live execution follows the [Scheduler liveness rules](scheduler-service.md#liveness). Physical stop and capacity reuse stay B9 SC5 and W5.
- Tests assert end and slot release in one transaction, same-key replay after the end, a post-restart retry that ends a live registration or answers 404 for an ended one, and 404 for each non-owned target. They assert that a newer registration stays intact and the worker unit calls it at graceful stop.

## Resume of a registration

- `worker.instance.resume` is a `human` mutation of `unary` lifetime at `POST /api/worker/instance/:runtime_identity/resume`, with no body, the default 30 s timeout and the default 10 MiB body limit.
- It reopens an ended registration while that registration is the claimant of a `running` execution.
  The Worker Service reads the `running` execution of the runtime identity through the Scheduler Service in the same transaction.
  The Scheduler first settles any expired unsettled execution under [Scheduler liveness](scheduler-service.md#liveness).
- It clears `ended_at`, sets the last heartbeat to the time of the act and takes the slot through the Project instance-count collaboration, in one transaction.
- The next registration of its client identity answers that registration, and its work pull returns the `running` execution.
- A resume of a live registration answers 200 and changes nothing.
- An unknown runtime identity answers 404 `worker.instance.not_found`.
- A registration that is the claimant of no `running` execution answers 409 `worker.instance.no_live_execution`.
  A lost execution is never revived.
- A client identity that holds another live registration answers 409 `worker.instance.client_live`.
- A binding without a free slot, or an unavailable binding, answers 409 `worker.instance.slot_unavailable`.
- The answer is 200 `{ runtime_identity, registered: true }`.
- Tests assert the reopen, the heartbeat and the slot in one transaction, and each refusal.
  They assert the resume of the `running` execution through the next registration and work pull.

## The worker application

`kanthord serve worker` starts the `worker` application, which hosts one native instance at the `worker` placement.
It is the `worker` wrapper of [the worker unit](#the-worker-unit-and-its-wrappers). The rules below that name a process, a signal, an exit code or `cli.yaml` bind the `worker` wrapper. The other rules bind the worker unit at both placements.

- The command declares `--endpoint` and `--token` only, and it refuses `--config`.
- The binding, the worker, the agent configuration and the instance count come from the server through the project and the resource identity that the machine token names. The worker application reads the setup of one execution through `worker.execution.setup.get`.
- The workspace lives under the XDG state directory of the host, and `cli.yaml` stays in the configuration directory.
- One process hosts one instance, because a machine token carries one client identity and a client identity holds at most one live registration.
- N registration slots of a worker binding need N processes with N machine tokens. The instance count limits the live registrations and promises no process count.
- The startup order is: the wrapper resolves the client configuration and checks `client_secret`. Then the worker unit installs and checks the [pi tool binaries](#pi-tool-binaries), checks the server package version and registers the instance.
- The wrapper does not install the pi tools.
- The application logs one info record for each task start, task commit, task verification, task judgement, task choice, node verification, node judgement and base merge. A record holds identities and results, and no agent content.
- The application writes the transcript of each execution to `transcripts/<execution identity>.jsonl` of the state directory with mode `0600`, and it keeps the newest 50 transcripts.
- After the registration, the application logs one record `Worker application ready` with `runtime_identity`, `resource_identity` and `worker_name`.
- The application writes operational log records to stderr as JSON lines. It prints no token and requires no terminal.
- A startup failure prints its diagnostic, releases what it acquired and exits 1.
- A registration whose answer is indeterminate stops the start with `worker.start.registration_indeterminate`.
- `SIGINT` and `SIGTERM` stop further startup and further work pulls.
- A stop aborts the outstanding work pull. A claim that commits during that abort has no worker until its lease expires, and settlement then declares it lost.
- The application deregisters only a registration whose runtime identity it knows.
- The application deregisters at a stop only when no execution is live and no work pull answer failed its schema. An upgrade stops the old process before it starts the new one.
- A work pull answer that fails its schema ends the pull loop with `gateway.client.answer_invalid`. The application deregisters nothing and exits 1. A restart with the same client identity inside the heartbeat window resumes the same registration and the same claim.
- It exits 0 after a successful deregistration or after the 404 that ends its registration. Any other deregistration or cleanup failure exits 1 without a retry.
- An execution that ends with a release or a closure leaves the instance registered, and the application pulls again. A release with a `stop` is a release. An execution that ends with no release and no closure exits 1.
- A stop during a live execution exits 1 with `worker.stop.execution_live`. A deregistration whose answer is indeterminate exits 1 with `worker.stop.deregistration_indeterminate`.
- A 10-second watchdog applies only when no execution is live and no registration waits for its answer.
- `SIGHUP` reopens nothing.
- B9 owns shutdown during a live execution or a registration with no answer, and a stop deadline in those cases.
- Tests cover the option resolution, the refusal of `--config`, the startup order, each startup failure, the ready record, deregistration before exit, a failed deregistration, the abort of the outstanding work pull at a stop and the watchdog of a settled state.
- A test covers a claim answer with an unknown field. It asserts one pull, the exit with `gateway.client.answer_invalid`, no deregistration, and a restart that resumes the same claim and completes the handover.

## The worker unit and its wrappers

[worker-service.md](worker-service.md#instances-and-hosting) requires one worker unit inside one worker boundary at both placements.

- `src/apps/worker/unit.ts` holds `WorkerUnit`, the worker unit.
- It takes `{ transport, client_secret, env, log, model_runtime_factory?, repository_transport?, resume_pull_wait_ms?, watchdog?: () => () => void }`. It takes no endpoint, no token and no configuration path.
- `log` is a log destination, or a line sink for a test.
- The `env` of the worker unit equals the `process.env` of its thread.
- `WorkerUnit` reads no `process.env`, installs no signal handler and calls no `process.exit`.
- It resolves its directories with `directories(env)` of the `env` that its wrapper gives.
- `WorkerUnit` offers `start()`, `run()`, `drain()` and `stop()`.
- `stop()` follows the stop rules of [The worker application](#the-worker-application).
- `drain()` stops further work pulls and lets the live execution end with its release or its closure. Then it deregisters and ends `run()`. An idle unit deregisters and ends at once.
- A unit that drains before its first pull makes one resume pull. `resume_pull_wait_ms` (default 5000) bounds that pull, so that a running execution resumes.
- `instanceHealthcheck` refuses a draining slot, so that pull claims no new work. The claim returns a `running` execution before the healthcheck.
- The modules of `src/worker/` that only the worker unit runs move to `src/worker/unit/`. `src/worker/unit/index.ts` is their one entry.
- Today these modules are `execution-run`, `native-agent`, `native-method`, `steps-objective`, `steps-initiative`, `judgement`, `judged-tasks`, `evaluation` and `evaluation-input`.
- They also include `base-refresh`, `verification`, `local-git`, `workspace`, `budget`, `model-runtime`, `tool-table`, `host-tools`, `transcript` and `method-clients`.
- They also include `method-telemetry`, `telemetry`, `agent-telemetry`, `report-facts` and `node-reads`.
- `toolDeclarations` moves out of `tool-table` and stays in `src/worker/`, because the server reads it.
- `src/worker/index.ts` keeps the server entry: `WorkerService`, its migrations and its configuration.
- `local-git`, `verification` and `tool-table` take the `env` of the worker unit. They pass `childEnvironment(env)` to each child process and read no `process.env`.
- `local-git` builds each git environment with `isolatedGitEnvironment` of `src/kernel/git-environment.ts`. [repository.impl.md](repository.impl.md#repository-connector) states the rules.
- The `worker` wrapper is `src/apps/worker/index.ts`. It resolves `cli.yaml`, checks `client_secret`, builds the HTTP transport and passes `process.env`.
- It logs to stderr, installs the signal handlers and owns the exit code. It arms its 10-second exit through `watchdog`.
- The `server` wrapper is the pool host `src/apps/server/worker-pool.ts`. It starts one `node:worker_threads` thread for each started pool slot.
- The `server` wrapper passes no `watchdog`.
- The thread entry `src/apps/worker/thread.ts` builds the port transport and runs `WorkerUnit`.
- The pool host sends a `parentPort` message `{ kind: "drain" }` or `{ kind: "stop" }`. `thread.ts` maps it to `drain()` or `stop()`.
- A start in drain mode sends the thread `{ kind: "drain" }`.
- After `run()` returns, `thread.ts` closes its port, and the thread ends by itself.
- The release build embeds a bundle of `src/apps/worker/thread.ts` as the SEA asset `worker-thread.cjs`. It uses the same esbuild flags as `kanthord.cjs`. The pool host starts it with `eval: true`.
- A development checkout starts the TypeScript file.
- No module of the worker unit names a placement. The placement exists only in the wrappers, in the transports and in the binding.

## The worker transport

- `WorkerTransport` of `src/apps/worker/transport.ts` is the one interface through which the worker unit reaches kanthord. It replaces `WorkerApi`.
- It holds `gateway`, `worker`, `scheduler`, `mission` and `tracking`. Each is a `ServiceClient` of `src/kernel/operation.ts` over the operation map of its `contract.ts`.
- `httpTransport(endpoint, token)` builds each client with `httpClient` of `src/gateway/client.ts`.
- `portTransport(port)` builds each client over a `MessagePort`. It validates the input with the schema of the operation, as `httpClient` does. It holds no credential.
- After a port close, `portTransport` refuses each new call at once as indeterminate.
- The port carries the HTTP wire form. A call posts `{ call_id, operation_id, params, query, body, idempotency_key, traceparent, tracestate }`.
- `params` and `query` hold the string values that `httpClient` writes into the path and the query string. `body` holds the JSON text, or null for an operation with no body.
- A cancellation posts `{ call_id, cancel: true }`.
- The answer is `{ call_id, status, body }`. The client maps it to an `OperationResult` as `httpClient` maps an HTTP answer.
- `servePort(port, invocation, credential, logger)` of `src/gateway/port.ts` serves the other end of the port. `src/gateway/index.ts` exports it.
- `credential` is a `string` or a `Promise<string>`.
- For each call, `servePort` answers the 404 of an absent route for an operation that has no HTTP route.
- These are a `service` operation, a `direct: true` operation, a `stream` operation and an identity outside the five maps.
- The route label of an unmatched call equals the HTTP label `/*`.
- A malformed message with a readable `call_id` answers 400 `gateway.request.validation_failed`. `servePort` drops any other malformed message.
- The check order equals the HTTP order: 413, then authentication, then `gateway.request.unexpected_body` or `gateway.request.invalid_json`.
- It measures the body limit on the JSON text with `bodyLimitOf(operation)`, the same function that `src/gateway/service.ts` uses. A body above the limit answers 413 `gateway.request.body_too_large`.
- It parses the JSON text with `parseJSON`, as the HTTP route does. A body on an operation with no body answers 400 `gateway.request.unexpected_body`.
- It then calls `Invocation.invoke(operation_id, { params, query, body }, options)` with the options of the HTTP route.
- The options hold `authorization` set to `Bearer <JWT>` from `credential`, the idempotency key, the trace context, a request identity and a cancellation context. They hold no `identity` option.
- `servePort` writes the same Gateway request records as the HTTP route.
- A failure inside the serve handler answers 500 and never stops the server.
- It cancels the context of a call at its cancellation message, at the close of the port and at the end of the thread.
- The worker unit calls no `stream` operation. The MCP path through the port transport is a [HANDOFF](HANDOFF.md#worker-service) item.

## The machine identity of a server-placement instance

- The pool host computes the client identity of a pool slot. It is `client_identity_<26 characters>`.
- The label of the derivation is `worker/server-client/<project_id>/<resource_identity>/<generation>/<slot>`.
- `<generation>` is the `revision` of the first binding revision after the latest tombstone. The value only increases.
- A group with no tombstone takes revision 1.
- The characters are the Crockford base32 form of the first 128 bits of `deriveKey(master_key, label)`. The first character is in `0` to `7`, so the value passes the identity schema.
- A binding that a project adds again after its removal therefore gets new client identities and new slot roots.
- The derivation stores nothing. No database holds the client identity of a slot, as [machine identities](gateway-service.md#machine-identities) require.
- The client identity of a slot is stable across server restarts. An increment of `gateway.auth.version` keeps it.
- The `client_secret` of a slot is `deriveClientSecret(master_key, auth_version, client_id)`, the derivation of `kanthord auth jwt generate`.
- `src/gateway/auth/jwt.ts` offers `generateSlotJWT`, which takes the `sub` of the slot. Only `src/apps/server/**` imports it.
- The `server` wrapper passes `servePort` a credential that mints a machine JWT in memory with `generateSlotJWT` for each call.
- The JWT holds the client identity of the slot, the project and the binding name.
- It holds the name `server slot <n>` and a lifetime of 60 s (`SLOT_TOKEN_LIFETIME`). It reaches no file and no thread.
- The Gateway authenticates that JWT through `Authentication.authenticate` and `resolveMachine`, as an HTTP bearer token.
- The binding resolution, the tombstone check of `iat`, the registration match, the access policy, the registration requirement and the execution proof apply unchanged.
- `worker.register` of a binding at the `server` placement checks that the client identity of the caller is a current pool slot of that binding.
- A current pool slot is every slot in the pool state of the binding, a slot that drains included.
- The pool check `isSlot` compares the project, the binding and the generation.
- Another client identity answers 409 `worker.instance.placement_mismatch`.

## The pool

- The Worker Service holds the pool state in memory.
- For each binding at the `server` placement, it holds the slots.
- For each slot, it holds the client identity, the runtime identity and the drain flag.
- `src/worker/pool.ts` computes the plan of a reconciliation.
- The pool host executes the plan through the `PoolHost` interface of `src/worker/contract.ts`.
- `PoolHost` offers `clientIdentity(project_id, resource_identity, generation, slot)`, `start(slot)`, `drain(slot)`, `stop()` and `onEnded(listener)`. The Worker Service holds no `master_key`.
- `stop` serves the server stop. `onEnded` tells the Worker Service that a slot ended. The Worker Service then removes the slot from the pool state.
- The composition root of the `server` application passes the pool host in `Dependencies`.
- The Worker Service reconciles every pool at server start and after each committed binding-set write.
- `startPool` runs after every service and the Gateway are ready.
- The Project Service calls the Worker contract method `bindingsChanged(projectId)` after the commit of a binding-set write. The method writes nothing.
- `bindingsChanged` returns at once and runs the reconciliation on the next tick. The reconciliation logs a failure as `worker.pool.reconcile_failed`. `bindingsChanged` before `startPool` is a no-op.
- The target of a binding is the instance count of its latest revision, or 0 for a removed binding.
- After a server restart, the reconciliation also checks each slot number from the target to 63. A slot at or above the target with a live registration starts in drain mode.
- A raise resumes the lowest draining slots first. Then it starts the lowest free slot numbers.
- A lower drains idle slots first, then busy slots, highest slot number first in each group.
- An idle slot holds the activity `idle` or `pulling`.
- A raise clears the drain flag, but the thread still finishes its drain. The pool host then starts the slot again.
- The pool host retires every excess slot through `drain()`. An idle unit deregisters and ends at once. A busy unit ends its execution, deregisters and ends.
- A drained slot ends through its own deregistration.
- A target of 0 ends every registration of the binding in the transaction of the binding-set write, under [Registration heartbeat](#registration-heartbeat).
- The pool host then drains every slot of the binding. A live execution learns of the end at its next call.
- `worker.server_slot_limit` caps the started slots of the server, as a positive safe integer with the default `16`.
- A slot over the cap stays pending. The pool host starts the lowest pending slot when an entry leaves.
- A drain of a pending slot with no live registration removes the slot at once.
- The pool host writes `worker.pool.slot_limit` with `project_id`, `binding` and `slot` to the server log.
- A thread exit without a drain or stop request restarts the slot with a backoff of 1 s that doubles up to 30 s. The backoff resets after the thread lives 30 s.
- The pool host writes `worker.pool.instance_failed` with `project_id`, `binding`, `slot`, `runtime_identity`, `exit_code` and `err` to the server log.
- The pool host starts a slot that drains and still holds a live registration again in drain mode.
- A slot that drains and has no live registration ends. The pool host deletes the entry and calls `ended()`.
- The registration stays live during the backoff, so the new thread resumes the registration and its `running` execution.
- At server stop, `stopPool` runs first, before quiesce. The pool host sends `{ kind: "stop" }` to each thread.
- The pool host terminates a thread that does not end within the pool stop deadline of 5 s. The server watchdog is 10 s.
- A stopped slot cancels its live execution. Only a worker unit with a live execution keeps its registration. An idle worker unit deregisters.
- The project pause reaches a server-placement instance through its work pull, as it reaches every instance. The pool reads no pause.

## Isolation of a server-placement instance

- The root of a slot is `workers/<client_id>/` of the state directory of the server, with mode `0700`.
- The pool host creates the slot root. After that, it only appends `stderr.log` in the slot root. It reads nothing in it.
- The slot root holds `state/kanthord/kanthord.log` and `stderr.log`.
- The thread starts with its own `env` and never with `SHARE_ENV`.
- The thread refuses a start with `worker.thread.directory_invalid` when any of `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` is absent or not absolute.
- The pool host sets `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` to `config/`, `state/`, `data/` and `cache/` of the slot root.
- The `env` is an allowlist of these server variables, when they are set: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ` and `TMPDIR`.
- The allowlist also holds `SSH_AUTH_SOCK`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`.
- The `env` holds no other variable, so it holds no `KANTHORD_*` variable and no `NODE_OPTIONS`.
- `HOME` and `SSH_AUTH_SOCK` are the values of the server user. The [HANDOFF](HANDOFF.md#worker-service) item of OS containment owns their containment.
- The worker unit keeps its workspaces, its transcripts, its `pi/` directory and its log under `state/kanthord/` of the slot root. Two slots share no workspace.
- Each thread holds its own `process.env` and its own module instance of pi.
- `loadPi` therefore sets `PI_OFFLINE` and `PI_CODING_AGENT_DIR` for its thread only. pi of that thread finds `rg` and `fd` in `pi/bin/` of the slot.
- The worker unit installs and checks the [pi tool binaries](#pi-tool-binaries) into its own `pi/bin/` at its start, at both placements.
- The `server` wrapper gives the worker unit `LogDestination.File`, so the worker unit writes `kanthord.log` of its own state directory.
- The thread starts with `stdout: true` and `stderr: true`. The pool host appends both streams to `stderr.log` of the slot root.
- The server log holds the pool records and the Gateway request records of each port, and no record of the worker unit.
- The worker unit sends its telemetry through the `tracking` client of its transport at both placements.
- An uncaught exception or a `process.exit` of a thread ends that thread only.

## Enforcement of the worker boundary

- `eslint-plugin-boundaries` declares the element `worker-unit` for `src/worker/unit` and keeps `apps-worker` for `src/apps/worker`.
- The policy of both elements allows only these targets:
  - `src/kernel/`, except `caller-mint.ts`, `service-mint.ts`, `test-identity.ts` and `fatal.ts`;
  - the `contract.ts` of every service and component;
  - `src/agent/` files `pi.ts`, `pi-tools.ts`, `agent-session.ts`, `environment.ts`, `catalog.ts` and `prompt-composer.ts`;
  - `src/agent/` files `prompt-layers.ts`, `prompt-render.ts`, `prompt-templates.ts`, `prompt-source.ts`, `prompt-assets.ts`, `pinned-layers.ts` and `hooks/`;
  - `src/llm/` files `model-connector.ts`, `platforms.ts` and `provider-failure.ts`;
  - `src/repository/index.ts`, `src/custody/client.ts`, `src/gateway/client.ts`, `src/gateway/client-result.ts` and `src/worker/catalog.ts`;
  - `src/worker/unit/` from `src/apps/worker`.
- The worker elements import only `RepositoryComponent` from `src/repository/index.ts`.
- In production, `src/apps/worker/` imports only `index.ts` of `src/worker/unit/`.
- Non-test files of `src/worker/unit/` and `src/apps/worker/` import no `**/test-support.ts`, including `src/kernel/test-support.ts`.
- Every other target is a boundary error.
- Examples are a `service.ts`, `src/gateway/invocation.ts`, `src/gateway/port.ts`, `src/gateway/auth/`, `src/config/` and `src/apps/server/`.
- `@typescript-eslint/no-restricted-imports` in both elements refuses `node:sqlite` and a value import of `src/kernel/store.ts`.
- It refuses `node:process`, `process`, `node:module` and `module`.
- It refuses `node:worker_threads` and `worker_threads` outside `src/apps/worker/thread.ts`. A type import is excepted.
- `no-restricted-properties` refuses `process.env`, `process.exit`, `process.exitCode`, `process.on`, `process.once`, `process.addListener`, `process.kill`, `process.abort` and `process.dlopen`.
- `no-restricted-globals` refuses the globals `process`, `globalThis` and `global`.
- `no-restricted-syntax` refuses a dynamic `import()`.
- Both rules apply to `src/worker/unit/` and to every file of `src/apps/worker/` except `index.ts` and `thread.ts`. Only those two files use the global `process`.
- `killProcessGroup` of `src/kernel/process-group.ts` is the one signal path of the worker unit.
- It signals only the group of a detached child that the unit started. It refuses the pid and the parent pid of its own process.
- Test files may use `src/agent/test-support.ts`, `src/repository/connector.ts`, `src/repository/node-branch.ts`, `src/worker/test-support.ts` and `src/kernel/test-support.ts`.
- Test files and `*test-support.ts` files of both elements are exempt from the global, property and dynamic import rules.
- Tests of `src/apps/server/` may import `src/worker/unit/index.ts`, `src/worker/unit/test-support.ts`, `src/apps/worker/transport.ts` and `src/apps/worker/thread-data.ts`.
- `src/apps/server/import-boundaries.test.ts` lints probes in both elements.
- An import of `src/worker/service.ts`, `src/project/service.ts`, `src/gateway/invocation.ts`, `src/config/index.ts` or `node:sqlite` is an error. A value import of `src/kernel/store.ts` is an error.
- Each refused property of `process` is an error. An import of `src/scheduler/contract.ts` is admitted.
- The test counts each new lint rule, so a rule that a later edit removes fails the test.
- A closure test builds `src/apps/worker/thread.ts` with esbuild and reads its metafile.
- Each direct import of a worker-element file in the metafile passes the lint rules of the worker elements.
- Each transitive file sits under the directory of an allowed direct target, or is a `src/*/contract.ts`.
- It holds no `service.ts` or `store.ts` outside `src/kernel/`, no `invocation.ts`, no `port.ts`, no file of `src/config/` or `src/gateway/auth/`, no `node:sqlite` and no `node:module`.
- The thread receives `workerData` with `port`, `client_secret` and `log` only, and the port in the transfer list. `workerData.log` is always `file`.
- A structured clone carries no function, no store and no service object. `WorkerUnit` takes one transport and no other client.
- Tests assert the keys of `workerData`, the keys of the thread `env` and the mode of the slot root.
- Tests assert the place of `kanthord.log` and `stderr.log`, and no record of the worker unit in the server log.
- Tests assert that `servePort` passes `authorization` and never `identity` to `Invocation.invoke`.
- `src/apps/server/worker-transport-conformance.test.ts` runs one table of cases through both transports.
- It runs `httpTransport` against a started Gateway and `portTransport` against `servePort` of the same server.
- It asserts the same status, the same error code and the same body for each case:
  - a registration, a second registration of the same client identity, and a registration above the count with 409 `worker.instance.slot_unavailable`;
  - a heartbeat;
  - a pull of a paused project gets no work from the claim and waits for a wakeup. The case cancels the pull after 500 ms on both transports. It asserts an indeterminate outcome and a Gateway 503 request record on both;
  - an execution operation that names an execution of another project, with 403 `gateway.invocation.execution_proof_failed`;
  - an execution operation that names a claim of another binding, with the same 403;
  - a `human` operation with 401;
  - a `service` operation and a `direct: true` operation, each with the 404 of an absent route;
  - a deregistration of the instance of another client identity with 404 `worker.instance.not_found`;
  - a call after the removal of the binding with 401;
  - a body above the limit with 413 `gateway.request.body_too_large`;
  - a body with a duplicate member, and a body that is no JSON value;
  - a body on an operation with no body, and a numeric query value;
  - a registration of a client identity that is no pool slot on a binding at the `server` placement, with 409 `worker.instance.placement_mismatch`.

## The execution setup

`worker.execution.setup.get` is a `client` read of `unary` lifetime at `GET /api/worker/execution/:execution_id/setup` that requires a live execution.

- It declares `mutation: false`, no body and the default 30 s timeout. It has no CLI leaf.
- The invocation chain proves the path identity, and the server derives the setup from the proven claim.
- The answer is `{ execution_id, worker_name, agent_name, effective_configuration, credential_id, metadata, resource_budget, repositories, prompt }`.
- `worker_name` comes from the worker binding revision that the claim pins, and `agent_name` comes from the declaration of that worker.
- `effective_configuration` is the pinned selection of `agent_name` in `agent_selections` of the execution. It is never the head of the chain.
- The resolution reads the pinned worker binding revision, its entry, the current enablement and the metadata of the pinned credential revision from one snapshot.
- The credential revision is the revision that the handover of the execution pins for the credential name of the effective configuration. The read creates no pin and selects no other revision.
- An execution that pins no revision of that name answers 409 `worker.execution.credential_not_pinned`. A revoked pinned revision answers 409 `credential.revision.revoked`.
- The model and reasoning-effort validation use the metadata of the pinned credential revision.
- `credential_id` is the row identity of the pinned revision. `metadata` holds the metadata of that revision for every provider, and it is null for a platform without metadata.
- `resource_budget` is the override of the pinned worker binding revision, or the default of the worker.
- Each entry of `repositories` holds `{ binding_id, name, address, ssh_identity, strategy: { base_branch }, project_prompt, working_layer }`. `working_layer` is the switch map of the pinned binding revision.
- `ssh_identity` is the metadata `{ host, hostname, port, identity_file }` of the `ssh` record of the binding. The worker application runs the [`ssh` validation](repository.impl.md#platform-validators) with it before each clone, fetch and push.
- For an objective, `repositories` holds the repository binding that the pinned node revision names.
- For an initiative, `repositories` holds one row per resource identity of the repository bindings of its current objectives, discarded objectives included, at the greatest revision.
- `prompt` holds `final`, the system layer, the agent layer and the framing that the server composes, as [`agent.get`](agent.impl.md#the-prompt-answer) with `view=final` answers them.
- `templates` holds the [prompt templates](agent.impl.md#prompt-templates) that the server resolves. The worker application renders the work prompt, the working-layer messages and each instruction from this set.
- An execution of an externally hosted worker answers 409 `worker.execution.no_native_agent`. A disabled enablement answers 400 `agent.enablement.unavailable`. A resolution that fails validation answers the code of its first issue.
- The read answers no secret.
- The application calls the read after the handover and before the first inference call.
- The adapter refuses the execution with `worker.runtime.setup_refused`, whose `details.reason` is `credential_revision_mismatch`, when the `credential_id` of the handover item differs from the `credential_id` of the answer.
- Tests cover each source, the pinned revision after a rotation, the validation against the pinned metadata, an absent pin, a revoked pin, each other refusal, the proof of the path identity, the absence of a secret and the absence of a new pin.

## Configuration

- The Worker Service owns the section `worker` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.
- `worker.heartbeat_window` holds the window of a registration heartbeat in seconds, as a positive safe integer, and it defaults to `300`.
- `worker.server_slot_limit` holds the maximum count of started pool slots of the server, as a positive safe integer, and it defaults to `16`. [The pool](#the-pool) rules a slot above the cap.

## Prompt composition

The prompt composer resolves the system layer and the agent layer under [agent.impl.md](agent.impl.md#prompt-composer-configuration).
The working layer of an execution joins `AGENTS.md`, `AGENTS.local.md`, `CLAUDE.md` and `CLAUDE.local.md` of the workspace root, then the `project_prompt` of the repository binding.
It takes each source that the switch of the pinned binding revision turns on.
The worker application composes only the working layer and the work prompt, and it reads no home file.
An empty or absent `project_prompt` is an absent source.
An evaluation takes the `project_prompt` only, and the composer reads no agent file of the workspace.
It reads an agent file as UTF-8 Markdown, it rejects a control character outside tab and newline, and it resolves no `@` import.
It rejects a path of the workspace that a link resolves outside the workspace.
It follows a link of the host location, because the operator manages the dotfiles of the host.
A deadline bounds every read.
The repository context-file discovery of pi stays disabled, and the composer performs every load, so one loader holds the order and the provenance.
A layer digest hashes the UTF-8 encoding of the exact layer text, with no trimming, no newline conversion, no Unicode normalization and no JSON quoting, and [architecture.impl.md](architecture.impl.md) rules the algorithm and the rendering.
pi receives the system layer and then the agent layer as its system prompt, as plain text with no tag. The framing closes the system prompt. It states that the later messages hold instruction files of the workspace and the task, that they never override the system prompt, and that a later text governs an earlier one.
It receives each source of the working layer as one user message, whose first line is `Instructions of <source>:`. The work prompt is the last user message, as plain text.
The framing, the working-layer message, the work prompt and each instruction are [prompt templates](agent.impl.md#prompt-templates). The texts above are the texts of the shipped templates.
The path of a source writes the home directory of the host as `~`.
The working directory that pi states in its system prompt writes the home directory of the host as `~`.
Every kanthord change to the behaviour of pi is a pi extension handler, one file per hook under `engine/src/agent/hooks/`. `openSession` always adds the home-relative cwd hook first, then the ordered `hooks` list of the consumer.
The adapter pins the composed layers against the compaction of pi, so every layer survives a compacted context.
The tool table enforces every obligation that a tool can enforce, and `re@1` holds no write tool.
The binary embeds `engine/static/prompt/base.md` as the default system prompt, and the agent prompts `swe@1.md` and `re@1.md` of that directory, as [shipped assets](architecture.impl.md#shipped-assets).
The engine texts are the source. [assets/prompt/](assets/prompt/base.md) holds a copy of each text, and `scripts/docs/check.sh` fails when a copy differs from its engine text.
The source of the three texts is the ideals file of Ulrich, split by single obligation: a standard of the product and a shared conduct go to `base.md`, the act of producing goes to `swe@1`, the act of judging goes to `re@1`, and a rule that presupposes a human interlocutor is adapted or dropped.
The recommendation-first format of a confirmation request returns with the clarification interface.

- Every source of every layer holds at most 32768 UTF-8 bytes. A custom text above the bound refuses its write.
- A source above the bound is invalid.
- An invalid source adds no text to its layer, and the composer continues with the next source.

The acceptance path proves the configured precedence, an absent source, an invalid source, a switched-off source and a link that leaves the workspace.
It proves that a reviewer execution takes no agent file of the workspace.

## The credential store of an execution

- Every native inference call, including compaction and retries, resolves auth through the [custody execution store](custody.impl.md#the-credential-store-of-an-execution).
- The view exposes only the credential that the effective agent provider names, at the revision that the execution pins, under the pi adapter id.
- `read(providerId)` answers `undefined` for every other id.
- The adapter passes the model identifier and the reasoning effort of the effective configuration to the [model connector](llm.impl.md#the-model-connector), which maps them onto the pi model and fails closed with `worker.runtime.setup_refused`.
- The store holds the credential of one execution, so no credential crosses executions.
- Environment hygiene of the pi process belongs to the adapter, and the process inherits no provider environment variable.
- The Worker Service supplies the authorization function of the [protected facility](custody.impl.md#the-protected-facility) for a model inference credential, through the worker binding of the claim.
- A broken chain of a model inference credential answers 403 `worker.authorization.refused` with `details: { reason }`, where `reason` is `binding_mismatch`, `binding_removed`, `binding_disabled` or `no_native_agent`.

## The credential handover

- `worker.handover` is a `client` secret mutation of `unary` lifetime that requires a live execution. `POST /api/worker/handover` takes the body `{ execution_id }` and answers the envelope that [custody.impl.md](custody.impl.md#the-credential-handover) rules.
- While its idempotency record remains in memory within the TTL, a repeat of the key answers 409 without the envelope. The application recovers a lost answer with a new key, which reads the pinned revision again.
- The worker unit calls it once after its claim and before the first inference call. The handover pins each credential revision that it carries.
- It decrypts the envelope with the handover key that it derives from its own `client_secret`. It builds an in-memory pi-ai credential store from the payload and holds the plaintext in memory alone.
- `worker.credential` is a `client` mutation at `POST /api/worker/credential` that requires a live execution. Its body is `{ execution_id, nonce, ciphertext }`, where `nonce` and `ciphertext` carry the sealed refresh report, and it answers 204. The application calls it after each refresh that pi-ai performs and once at the release.
- The credential report request body permits at most 65,536 bytes; [Custody's serialized-credential budget](custody.impl.md#serialized-credential-budget) ensures the compact report fits. The application reports once at release even when the credential is unchanged.
- For both operations, the invocation chain proves the execution that the body field `execution_id` names.
- The application discards every credential when the execution ends, and it writes none to a file.
- A platform action runs through the action performer of the server.
- The `worker` application reads `client_secret` from the client configuration file alone, which [gateway-service.impl.md](gateway-service.impl.md#the-client-configuration-file) declares. It accepts no environment variable and no option for it.
- The `worker` application holds no `master_key`.
- At the `server` placement, the pool host derives the `client_secret` of the slot and gives it to the thread. The thread holds no `master_key`.
- An absent or invalid `client_secret` stops the start of `kanthord serve worker` with `worker.start.client_secret_absent` or `worker.start.client_secret_invalid`.
- A `client_secret` that belongs to another machine JWT fails every decryption. The application ends the execution as a cannot-progress condition.
- A handover envelope that the handover key does not open ends the execution with `worker.handover.decryption_failed`.

## Evidence upload

The `worker` application serves `evidence upload` locally for a file on its host.
The server and the harness extension serve the same helper on their own hosts.
The helper safely opens the path inside the execution workspace.
It refuses path traversal, symbolic-link escapes and path replacement races.
A refused path answers `worker.evidence_upload.path_refused`, whose `details.reason` is `outside_workspace`, `symbolic_link`, `not_regular` or `replaced`.
It calls `mission.evidence.submit` with execution context, the evidence metadata and the asset list, where the file is an `object` asset with its size, media type and optional SHA-256.
It sends the file directly to the presigned PUT destination of that asset, then calls `mission.evidence.asset.complete`.
A failed transfer answers `worker.evidence_upload.transfer_failed`, and its message holds no URL and no header.
It follows [the object evidence contract](mission-service.impl.md#object-evidence) for all placements and co-locations.
It returns the evidence identity, the asset identity and the `s3://` URI to the agent.
At the `worker` placement the agent calls the helper through the host tool `evidence-upload`, whose one argument is the workspace-relative `path`; the subject of the evidence is that path, and the media type is `application/octet-stream`.
A failed upload answers a tool error with the code and the message alone.
A reader's component obtains a presigned GET through the content read operation.
No storage credential enters the credential handover.
The presigned URL is an API answer, not a handover field, tool result or agent-context value.
The MCP server exposes no upload write.

- Tests exercise local file access at every placement and refuse an out-of-workspace path or unsafe open.
- Tests assert submit, direct PUT and asset complete order, with publication only after the checks pass.
- Tests keep the storage credential and presigned URL out of the handover and agent context.
- Tests return only the evidence identity, the asset identity and the object URI to the agent.
- Tests keep the MCP write set unchanged.

## Tool table

The tool table of a native agent holds four sources.
The first source is the pi built-in tools: `swe@1` enables read, edit, write, grep, find, ls and bash, and `re@1` enables read, grep, find and ls.
The second source is kanthord's own tools, which the server serves through its MCP server.
An external harness reaches the same MCP server, and pi reaches it as a tool source.
The third source is the other tools that a project adds, including other MCP servers.
The fourth source is the host-supplied tools that the `worker` application serves in its own process.
An agent declaration names its host tools: `swe@1` holds `evidence-upload`, and `re@1` holds none.
The agent catalog `src/agent/catalog.ts` owns `EVIDENCE_UPLOAD_PARAMETERS`, the parameter schema of `evidence-upload`.
`agent.get` lists a host tool with the source `host`.
The first version supports MCP v2, https://ts.sdk.modelcontextprotocol.io/v2/.
The tool register and the abstraction layer for tool instances manage the four sources.

The [Repository implementation](repository.impl.md#platform-connector-and-platform-implementations) owns platform methods, result schemas and payload decoders.

## The further-work release

- A budget-end release of an execution that passed no new task sends the stop `{ reason: "budget_end", code }`. `code` names the limit that ran out: `turns` or `wall_time`.
- `startCheck` stores the judged commit of each task in the objective workspace. At a resume, it reruns the verifications of each task and skips the judgement of a task whose judged commit equals the head, unless the rationale of the latest rework names the task.

## The unblock reads

- At the start of the steps method on an objective, the execution reads the prior rationale. The rationale of the latest rework assessment of the attempt comes first.
- With no rework assessment, an execution of attempt 2 or later reads `mission.execution.clearedOutcome.get`.
- When the cleared outcome has the closing event `external-failed`, the execution reads `worker.execution.change_request.get`.
- `worker.execution.change_request.get` is an API-only `client` read of the Worker Service. It reads the external actions of the cleared attempt.
- For each `pull_request` action with the resolution `other-end`, the read calls `intake.action.read` through the direct adapter. It uses the method `github-pull-request-change-request-get` and the request evidence of that action.
- The execution writes the change requests into one requested-changes text. The text holds the reviewer, the commit and the body of each change request. It also holds the path, the line and the body of each review comment of that change request.
- The requested-changes text stops at 4 KiB.
- The requested-changes text is the prior rationale. It enters the task judgement of the start check and the criterion revision of each task that the agent judges unmet.
- When the read finds no current change request, the prior rationale is the rationale of the cleared assessment.
- A change request forces no task revision. The agent judgement decides each task. When the agent judges every task met, the execution pushes an unchanged head. The change request stays current on that head, so the next node check blocks the node again on the same change request.
- A platform failure of the read answers 502 `repository.platform.github.<class>`. The execution stops with `operation_failed` and that code.

## The node check of a rework

- A rework is an execution of an attempt that has a `criterion-not-met` assessment. `mission.execution.rework_assessment.get` answers that assessment.
- The start check of a rework runs the node verifications once, before the task checks. Another execution runs no node verification at its start.
- The run uses the verification runner of the task checks, with `COMMAND_LIMIT_MS` per command and one `worker.verification` span per command. It runs no rerun.
- The run logs `node verified` with the head commit, the result and the exit codes.
- When every node verification passes, the start check continues as before.
- When a node verification fails, the failure text is the failed verification report: the failed command, its result and the last 4 KiB of its output.
- The agent receives one `task-choice` instruction with the failure text and the filename, the name and the criterion of each task. The reply names one task by its filename.
- The worker parses the reply once, with no repair turn. A reply with no valid marker line, or with a filename outside the task set, selects the last task in plan order.
- The run logs `task chosen` with the task identity, the head commit and `fallback`.
- The chosen task is pending with the criterion revision of the failure text. It gets no judgement at the start check, and its judged commit does not skip it.
- Every other task keeps the rules of the start check.
- When the budget ends during the node check or the choice turn, the execution releases with further work and no checkpoint commit.

## The verifications

The verification run follows [mission-service.impl.md](mission-service.impl.md#the-verifications).
The workspace root for that run is the root of the execution workspace, not the server's `workspaces/` directory.
An initiative uses one subdirectory per distinct repository binding from its current objectives.
A test checks the [host requirements](repository.impl.md#repository-connector) and the shared verification run mechanism.
A test checks duplicate removal, discarded objectives, base-branch heads and one tested commit per binding for an initiative.
A test checks the evidence-placement rule when an initiative's objectives name no repository.
Tests prove that execution code, never the agent, runs verifications before judgement.
Reviewer tests assert a failed assessment without judgement for a failed or unrun verification; the rationale names that verification.
The reviewer reruns a failed item up to 2 times on the same commit, unless the item timed out. The item still fails.
When a rerun passes, the rationale states that the test is flaky. The rationale carries the output of the failed run.
The review bundle holds `added_files`: the files that the evidenced commit adds against `origin/<base branch>`. An initiative has none.
Tests require a reviewer to judge the assets that the evidence still holds.
Steps tests revise after a failed verification within the resource budget, commit anew and rerun the verifications.
Budget-end tests end the task work and release with no further work when the run of a task commit failed or left an item unrun and no later task work exists; they checkpoint and release with further work when the budget ends before a task commit or during a judgement.
Steps tests run every task verification at the head of the node branch at the start of an execution, and skip each task that passes.
Tests permit judgement only after every verification passes.
Restart tests check out `origin/<base branch>` for an attempt whose claim names `kanthord/<node id>-a<k>`, push that branch and leave the head of the earlier node branch unchanged.
Tests check out `origin/kanthord/<node id>-a<k>` for a later attempt that continues it, and merge the moved base.
Missing-branch tests delete a pushed node branch at the remote and assert `repository.node_branch.missing`, an unchanged checkout and a second refusal. They assert the same refusal for a fresh workspace with repository evidence of the attempt. They assert a start from the base branch for a first execution and for an attempt with the start point `base_branch`.
Tests assert that a branch switch removes `.kanthord-scratch/` and an ignored file, and that a checkout of the same branch keeps them.
Tests assert that a judgement of attempt k-1 is not reused in attempt k.
Rework tests assert that a failed node verification revises the chosen task only, that an invalid choice revises the last task, and that passing node verifications change nothing.
Tests assert that an execution that is not a rework runs no node verification at its start.
Tests assert that the action performer does not reuse an open pull request of the earlier node branch, and that an attempt that continues its branch reuses its own pull request.

## Workspace

- The workspace root is `workspaces/` of the state directory of [architecture.impl.md](architecture.impl.md#the-directories-of-the-server).
- The workspace of a steps execution on an objective is `workspaces/<objective identity>/<repository binding identity>/`, keyed as [worker-service.md](worker-service.md#executions) states.
- The workspace of an evaluation execution and of a steps execution on an initiative is `workspaces/<execution identity>/`, and the Worker Service removes it at the release.
- The preparation of an objective workspace adds `.kanthord-scratch/` to `.git/info/exclude`, so a task commit never stages the scratch files of the agent.
- The preparation reads the node branch from `node_branch` of the claim. `fetchAndCheckout` checks out the remote node branch when it exists, else the base branch. It runs `git clean -ffd` when the workspace HEAD is on the node branch of the claim, and `git clean -ffdx` otherwise, so a branch switch also removes `.kanthord-scratch/` and the other ignored files of the earlier branch.
- Two records show an earlier push of the node branch. The first is the remote-tracking ref `refs/remotes/origin/<node branch>` of the objective workspace before the fetch. The second is an evidence of the claimed attempt with a `repository` asset of the repository binding. The preparation reads that evidence through `execution.evidence.list`.
- When either record exists and the remote node branch is missing, `fetchAndCheckout` refuses with `repository.node_branch.missing` and keeps the checkout. The execution stops with `operation_failed` and that code.
- When the workspace holds the remote-tracking ref, `fetchAndCheckout` checks the remote node branch with `git ls-remote` before `git fetch --prune`. A refusal therefore keeps the ref, and the next execution refuses again.
- A first execution of a node branch has neither record and starts from the base branch. An attempt with the start point `base_branch` has a new node branch name, so a missing earlier node branch does not refuse it.
- A directory under the root holds mode `0700`, and the permissions audit of the start covers the root and no entry under it.
- The workspace retention period of [worker-service.md](worker-service.md#executions) is 7 days from the end of the last execution of the objective.
- A sweep at the start and every hour removes an expired workspace.
- The state directory holds the workspace because an active workspace holds uncommitted work and unsubmitted evidence that a re-clone cannot rebuild.

## Action performer

One internal function implements the action performer.
The evaluation method of `reviewer@1` at the `worker` placement calls that function through `worker.action.request`, and the MCP tool calls the same function.
`worker.action.request` is a `client` mutation of `unary` lifetime at `POST /api/worker/execution/:execution_id/action/request` that requires a live execution.
It takes no body and no query field and uses the operational store.
It takes a 900 s timeout and answers 200 with the result below.
It serves a reviewer execution of every harness under the same admission, and no CLI command calls it.
A per-execution-identity mutex serializes invocations inside the server.
An in-memory dispatch reservation, keyed by the node, the attempt and the requirement key, protects each action across the executions of one attempt.
The action performer takes the reservation directly after the admission snapshot, with no `await` between them, and before its first Intake call for that action.
Only the invocation that took the reservation settles it.
A contender of an in-flight reservation answers `uncertain` with `uncertainty: "effect"`, changes nothing and does not wait.
A contender of an uncertain reservation answers the stored item and changes nothing.
An uncertain result stays in the reservation with its uncertainty and its known address.
A failure of `intake.action.read` removes the reservation, because the read writes nothing.
A failure of `intake.action.perform` that proves that no write started removes the reservation.
Every other failure of `intake.action.perform`, an unclassified exception included, keeps the reservation as `uncertain` with `uncertainty: "effect"`.
Before a failure propagates, the invocation removes its other reservations of actions that it did not dispatch.
A request evidence of the same attempt removes the reservation of its requirement key, and a request evidence of an earlier attempt removes none.
Inside one server process, the mutex and the reservation prevent a redispatch within one attempt.
The outbound request of the [Intake Service](intake-service.md#outbound-requests) is the durable dispatch record.
B9 items A3, W1, W4 and PR2 own the reconciliation of an uncertain result, across attempts included.
The action performer calls `intake.action.perform` for every configured action, and it makes no clone of its own.
The operands take the node branch from `node_branch` of the claim.
It passes the request key `<node id>/<attempt>/<FrozenAction.key>`, and it appends the snapshot commit for `merge_push`, for example `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/2/kanthord-repo.merge_push/d4e5f6`. For the reuse of a pull request, it appends the number of the reused pull request and the snapshot commit, for example `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/3/kanthord-repo.pull_request/42/e7f8a9`.
After a `kanthord` landing pull request action submits its request evidence, the action performer calls `intake.action.perform` once more with `merge_evidence_id` set to the evidence identity. The merge request key is `<node id>/<attempt>/<FrozenAction.key>/merge/<tested commit>`, for example `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/2/kanthord-repo.pull_request/merge/b4c5d6`. A failed merge changes no return item.

After the dispatch loop, the action performer calls `intake.action.perform` once per required `kanthord` landing pull request action whose request evidence has no end state.
It passes `merge_evidence_id` = that request evidence id and the new tested commit.
The request key is `<node id>/<attempt>/<FrozenAction.key>/merge/<tested commit>`.
A failed call changes no return item and logs a warning with the evidence identity.

The operation and the tool answer `{ tool_name: "repository-action-request", items: ActionResultItem[] }`.
`ActionResultItem` is discriminated on `kind`, with one value per return class.

- `submitted` holds `evidence`, the request evidence that `mission.evidence.request` answers.
- `awaiting-prerequisite` holds `action: { key, binding_id }`, the waiting action, and `prerequisite: { key, evidence_id }`, the requested action it follows and its request evidence.
- `failed-before-effect` holds `action: { key, binding_id }` and `refusal: { class, code, message }`, where `class` is `confirmed_failure`, `retryable_refusal` or `final_refusal`. A final refusal declines the request before any write. `code` and `message` come from the [Repository component](repository.impl.md): the platform implementation for a platform action, the repository connector for a network git write.
- `uncertain` holds `action: { key, binding_id }`, `uncertainty: "effect" | "recording" | "both"` and an optional `address`, present when the remote returned the address and the Mission submission stayed uncertain. An `unknown_outcome` result class produces `effect`.

`key` is the `FrozenAction.key` of the attempt, and `binding_id` is the repository binding of the action, under [the attempt](mission-service.impl.md#the-attempt).
The first version produces no `awaiting-prerequisite` item, because a repository strategy holds at most one action and its `follows` is null.
The answer holds no release instruction, because [B9 items A3, W1, W4 and PR2](HANDOFF.md#worker-and-project-services) own what follows a failure or an uncertainty.
The action performer answers 409 `worker.action_performer.claim_not_evaluation` under a steps claim, 409 `worker.action_performer.assessment_not_current` without a current passing assessment of the attempt, and 409 `worker.action_performer.snapshot_absent` when that assessment names no repository snapshot of the binding of the action.

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
`worker.action.request` calls the action performer and projects no tool.
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
- Each tool declares a required `execution_id` argument. Before every `tools/call`, the MCP server runs the same [execution proof component](architecture.impl.md#the-operation-and-its-two-entry-adapters) as the invocation chain. It passes the node, attempt and pinned revision of the proven claim to the tool, which reads none of them from the arguments.
- A failed proof answers a JSON-RPC error whose `data` holds the shared error envelope with code `gateway.invocation.execution_proof_failed`. A refusal of the tool answers a tool result with `isError: true` and the envelope in its content.
- Every client reaches the MCP server under the machine identity of its live registration, and the proof compares the registration for every client. A native agent at either placement has no other path.
- Protocol messages such as `initialize` and `tools/list` need the live registration and no execution identity argument.
- A tool runs under a session context. A disconnect ends the response stream only and cancels no accepted tool execution. The Gateway cancels the session contexts in shutdown phase 1.
- The action performer derives the request key of its one write, and the Intake outbound request holds the idempotency of that key.
- Every client receives the same static list: `github-pull-request-get`, `github-pull-request-review-comment-list` and `repository-action-request`. No client kind, claim kind or assessment state changes it. The MCP server reads no Mission record for `tools/list`.
- A read tool requires a live claim of any kind. The action tool under a steps claim answers `isError: true` with `worker.action_performer.claim_not_evaluation`. Under an evaluation claim with no current passing assessment it answers `isError: true` with `worker.action_performer.assessment_not_current`.
- The evaluation method of `reviewer@1` calls the action performer. A tool call by a native agent meets the same checks. The action performer serializes calls of one execution identity and never dispatches an action twice.
- Tests cover the Gateway mount without a second listener, all three lifetimes, session binding to client identity and registration, 404 for a foreign, ended or absent session after admission, shutdown-phase-1 cancellation, `Last-Event-ID` resume and heartbeat renewal on every MCP request.
- Tests assert no `Idempotency-Key` on the MCP path, proof before every tool call, a failed proof as a JSON-RPC error, tool refusal as an `isError` result, and a disconnect during a tool call that completes and records its write. They cover all three emitted operations with the specification revision.
- Tests assert the same tool list for every client and before and after an assessment, no Mission read for a list, both action-tool refusal codes, and serialized native-method and tool calls with no duplicate dispatch.

The first version approves two read methods of the [GitHub implementation of the Repository component](repository.impl.md#platform-connector-and-platform-implementations).

- The read of a pull request.
- The list of the review comments of a pull request.

The tool of the action performer takes the execution identity only.

## Commit attribution

The page requires that every commit of the execution is attributable to its task and its attempt.
The carrier of that attribution is an epic decision.

## Stop and budget

- Every worker declares `resource_budget.wall_time_ms`.
- `coder@1` and `reviewer@1` declare default `resource_budget: { turns: 200, wall_time_ms: 7200000 }`.
- `claude-code@1` declares default `resource_budget: { wall_time_ms: 7200000 }`.
- Every worker binding can override its default through the optional `resource_budget`.
- `wall_time_ms` and any declared `turns` are positive safe integers, including in overrides.
- A turn is one `turn_end` event of the pi agent loop.
- Wall time runs from `created_at` of the execution.
- A verification item runs under the deadline `min(created_at + wall_time_ms, expired_at)` of its execution, and under its own limit of 10 minutes from its start.
- An item whose deadline arrived does not start and has no result. A started item that the deadline or its own limit ends records `timed_out: true`.
- The worker keeps the last 4 KiB of the combined stdout and stderr of each item. The output is not evidence. The task revision carries the output of the last item that ran.
- An agent turn that ends with a provider error stops the execution with `provider_failed`. pi retries a transient error before the turn ends.
- The stop code names the provider failure: `rate_limited`, `quota_exhausted`, `unauthorized`, `bad_request` or `unavailable`.
- A task revision after a failed verification that changes no file twice in a row stops the execution with `no_progress`. The second unchanged revision runs no verification.
- A `no_progress` stop counts toward the [consecutive failure limit](mission-service.md#consecutive-failure-limit). A `provider_failed` stop with `bad_request` or `unauthorized` counts too.
- A `provider_failed` stop with `rate_limited`, `quota_exhausted` or `unavailable` advances the [fallback chain](agent.md#advance). It is neutral for the failure limit.
- Tests cover native and external-harness defaults, overrides for every worker binding, and positive safe integers.
  They cover turn events, wall time from `created_at`, and cleanup bounded by `expired_at`, not by the remaining budget.
  They cover each provider failure code, a revision that changes nothing twice, and a revoked claim during a task loop and during a prompt.

The execution holds a fixed `expired_at` under [Scheduler configuration](scheduler-service.impl.md#configuration).
An external harness must release before the `expired_at` of its execution record.
Every execution learns of the end from a claim check or from its first refused call, and aborts then. The placement of its instance changes no part of this rule.
A native execution reads its claim after each agent turn and before each task cycle.
A claim that is not `running`, or a read that the Scheduler refuses as ended, ends the execution as `revoked`. A read that fails for another reason ends nothing.
A pause of the node therefore stops a native execution within one agent turn.
On revocation or loss, the execution aborts its pi session and dispatches nothing after.
Abort does not prove that every descendant process stops.
The quiescence check before workspace reuse still needs a mechanism.
The [Repository implementation](repository.impl.md#repository-connector) states the transport's process-cancellation limit.
The execution enforces the turn budget on pi turn events and aborts the agent when either budget ends.
An agent that reaches its wall-time deadline ends the wall-time budget of the execution. The execution then takes the budget end, not a failure.
The bash timeout of an agent command stays below the remaining wall-time budget and below the 10-minute command limit of a verification item. A lower timeout that the model sets stays.
After the agent stops at budget end, the execution code, not the agent, writes the checkpoint commit, pushes and releases with further work.
The boundary is the task commit: work that the budget ends before its task commit, or during the judgement of a passing run, takes the checkpoint; a task commit whose run failed or left an item unrun, with no later task work, takes the head-commit evidence and the release with no further work.
Every cleanup command, including the push, is bounded by `expired_at`, not by the remaining budget.
A stop for a reason other than `revoked` aborts the agent and runs the same cleanup under a fresh context bounded by `expired_at`.
A steps execution writes the checkpoint commit when the workspace holds uncommitted work, pushes and releases with `further_work: true` and `stop: { reason, code }`.
A reviewer execution writes no commit and releases with the `stop` only.
A failed push still releases with the `stop`, and the next execution starts from the pushed head.
A failed release ends the execution with no release, and the loss settlement routes the node.
A reply with no valid marker line gets one repair turn, for the task judgement, the evaluation judgement and the review reply.
The repair instruction is `The reply holds no valid <marker> line. Reply again with exactly one such line.`
A second invalid judgement stops the execution with `judgement_invalid`, and a second invalid review reply ends the review of that task.
Tests stop a steps execution with each reason and assert the checkpoint commit, the push and the release with the `stop`. Tests stop a reviewer execution and assert the release with the `stop`. Tests send one invalid reply and assert the repair turn, and send two and assert the stop.

## Trust boundary

The operator provides the trust boundary as a disposable host that the operator trusts, or as an OS container around the server.
The host of every `worker` application sits inside it because that host holds its `client_secret` and the credentials of its executions.
The host of a `server` application that runs a pool slot sits inside it for the same reason. A worker thread is no containment boundary for the code that the repository supplies.
Its child processes run with the rights of the server process.

## Traces

The pi session entries of an execution become its transcript telemetry, with the execution identity, the attempt and the trace identity, redacted of secrets.
pi keeps its own compaction logic, and kanthord designs nothing for it.
The handover and the report enter no transcript telemetry.

## Acceptance path

The acceptance path is the `coder@1` loop, the commit and the verification, the push, the release, the independent `reviewer@1` evaluation, the configured repository action, the authoritative observation of its end state, and the `Completed` outcome.
A scripted fake provider runs it deterministically.
A bounded real-provider smoke run proves the real configuration.

## Instance CLI validation

The instance CLI commands refuse invalid arguments locally with the following codes.
These declarations match the error table of `engine/docs/cli/worker.md`.

| HTTP  | Code                                                      | Condition                                                                               |
| ----- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| local | `cli.worker.instance.list.invalid_project_id`             | The `--project` value is not a canonical `project_<ulid>` identity.                     |
| local | `cli.worker.instance.list.invalid_binding_name`           | The `--binding` value is not a binding name.                                            |
| local | `cli.worker.instance.list.binding_without_project`        | `--binding` is given without `--project`.                                               |
| local | `cli.worker.instance.get.invalid_runtime_identity`        | The `<runtime-identity>` argument is not a canonical `worker_instance_<ulid>` identity. |
| local | `cli.worker.instance.deregister.invalid_runtime_identity` | The `<runtime-identity>` argument is not a canonical `worker_instance_<ulid>` identity. |
| local | `cli.worker.instance.resume.invalid_runtime_identity`     | The `<runtime-identity>` argument is not a canonical `worker_instance_<ulid>` identity. |

## Handover CLI validation

The `worker handover` command refuses an invalid argument locally, matching `engine/docs/cli/worker.md`.

| HTTP  | Code                                       | Condition                                                                     |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| local | `cli.worker.handover.invalid_execution_id` | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
