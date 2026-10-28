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
The first version supports a native agent at every placement through the same [worker unit](#the-worker-unit-and-its-wrappers), and no proxy exists.
The hosting application gives pi its own directories.
Before the first import of `@earendil-works/pi-coding-agent`, it sets `PI_OFFLINE=1` and sets `PI_CODING_AGENT_DIR` to `pi/` of the state directory, so pi downloads no tool binary.
At the `worker` placement, that directory is `pi/` of the data directory of the instance, `$XDG_DATA_HOME/kanthord/workers/<name>/pi/`.
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
- It checks `binary_sha256`. Then it writes the binary to `pi/bin/<tool>` of the state directory with mode `0755`, through a temporary file and a rename. At the `worker` placement, it uses `pi/bin/` of the data directory of the instance. It skips a binary whose file already has that digest. It writes the license files to `pi/bin/licenses/<tool>/`.
- Then it runs `<tool> --version` from `pi/bin/`. A missing source, a host target outside the manifest, a digest mismatch or a failed run stops the start of the worker or of the server with `worker.start.tool_missing`.
- `pnpm run pi-tools:update <tool> <version>` of the engine rewrites the entry of one tool for the three targets with fresh digests. The root target `make pi-tools-update TOOL=<tool> VERSION=<version>` runs it. It refuses a release younger than the `minimumReleaseAge` of `pnpm-workspace.yaml`, 4320 minutes.
- A test compares the tool set of the pi tool manager with the tools of the manifest. A pi version bump that adds or removes a tool fails it.
- `bash`, `git`, `ssh`, `ssh-agent` and `ssh-add` are host requirements of the [Repository component](repository.impl.md#repository-connector). A worker host needs no SSH key. A program that the agent runs through `bash`, for example `node` or `npm`, belongs to the environment of the project on the worker host.

## The worker template registry

- A worker template is a static server module; the registry maps worker names to templates and loads no runtime plugin.
- A worker references the declaration of its agent in the [agent catalog](agent.impl.md#the-agent-catalog) and carries no separate configuration version.
- `coder@1` references `swe@1`; `reviewer@1` references `re@1`.
- `coder@1`, `reviewer@1` and `claude-code@1` declare `declared_intents: [implement, examine]`.
- The Worker Service offers `declarationOf(workerName)` to the Scheduler Service through its `contract.ts`. It answers the worker name, `declared_node_states` and `declared_intents` of the template, and null for a name that the registry does not hold.
- The worker unit selects the method form from `intent` of the pinned node revision.

## Externally hosted worker

The kanthord extension of Claude Code registers the instance under its client identity, issue the work pull, drive the execution operations through the CLI and the MCP server, and release.
Their design, and the packaging of the `/work` orchestration skill that they carry, are epic decisions.

## The identities of the Worker Service

- A runtime identity is `worker_registration_<ulid>`. It names one registration.
- An instance record revision is `worker_instance_<ulid>`, and a connection is `connection_<ulid>`. [Worker instances](#worker-instances) states both.
- The output schema of `POST /api/worker/register` returns it under `runtime_identity`, beside `resource_identity` from the verified machine identity and `worker_name` from the worker binding row that the registration transaction reads.
- The machine identity of [gateway-service.impl.md](gateway-service.impl.md#the-forwarding-contract) names it for a live registration.
- It is no JWT claim.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.
- The Worker Service answers the client attribution of a runtime identity to the Scheduler Service in-process. The attribution is the `client_id` and the `client_name` of its `worker_registration` row, ended rows included. The human `worker.registration.get` still answers 404 for an ended registration.

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
- A registration of a binding with no free slot, or of an unavailable binding, answers 409 `worker.registration.slot_unavailable`, the code of the resume.
- The same client identity registers again with a fresh idempotency key, after an expiry or after its deregistration.
- The expiry proves no stop, and physical stop and capacity reuse are the B9 items SC5 and W5.

## Inspection operations

- Four `human` operations expose the published worker contract and the runtime-only registration record. Each one is `unary`, declares `mutation: false`, uses the default 30 s timeout and reads no table of another service.
- `worker.catalog.list` is `GET /api/worker/catalog` with `limit` and `cursor` under the [pagination rule](architecture.impl.md#pagination), keyed by worker name in ascending alphabetical order, and the next page reads the names that are greater than the cursor. An item holds `name`, `host` (`kanthord` or `external-harness`), `declared_node_states` and `declared_intents`. The answer lists the supplied workers; a registration adds no entry.
- `worker.catalog.get` is `GET /api/worker/catalog/:worker_name`.
  The answer holds the item fields and `resource_budget` for every worker.
  It also holds `harness` for an externally hosted worker, or `method` and `agent_name` for a worker that kanthord hosts.
  An unknown name answers 404 `worker.catalog.not_found`.
- `worker.registration.list` is `GET /api/worker/registration` with optional `project_id`, `resource_identity`, `limit` and `cursor`. `project_id` is a `project_<ulid>` and `resource_identity` is `worker:kanthord:<binding name>`. `resource_identity` requires `project_id`, and a binding that the project does not hold answers 400 `worker.registration.binding_unknown`. The answer pages live registration records by runtime identity descending. It is a live inventory and no history.
- `worker.registration.get` is `GET /api/worker/registration/:runtime_identity`. An unknown or ended registration answers 404 `worker.registration.not_found`.
- A registration record holds `runtime_identity`, `project_id`, `resource_identity`, `worker_name`, `host`, `placement`, `client_id`, `name`, `instance`, `activity`, `draining`, `execution_id` and `registered`. It holds no JWT.
  - `placement` is `server`, `container` or `worker` for a kanthord host, from the placement of the binding.
  - `client_id` and `name` name a registered instance. `instance` is the instance name at the `worker` placement, else null.
  - `activity` is `idle`, `pulling` or `executing`. `execution_id` holds a value while the registration executes.
  - `draining` comes from the [pool](#the-pool). It is true for a slot that drains.
- The dashboard shows the placement of a pool slot registration as the text `· server` or `· container` in the row description. It shows `draining` as an outline badge. A registration at the `worker` placement shows `· instance <name>`. A registration of an external harness shows neither.
- The dashboard calls these rows live registrations.
- The reads change no registration, no pool, no configuration and no scheduling state, and they infer no dead process from silence.
- The instance healthcheck runs before a work pull and before a claim commits, not through a human inspection command. A disabled enablement shows in `agent get`; a missing enablement refuses the binding write under [configuration validation](agent.impl.md#agent-configuration-validation). The health report covers registration liveness.
- Tests cover each human read and machine-JWT refusal, each unknown name or identity, the binding-to-project check, and records after registration, during execution and after a drain. They assert no JWT and no pool side effect.

## Deregistration

- `worker.registration.deregister` is a `client` mutation of `unary` lifetime at `DELETE /api/worker/registration/:runtime_identity`, with no body, the default 30 s timeout and the default 10 MiB body limit.
- It is no execution operation and requires no live registration under [the Gateway machine identity rules](gateway-service.impl.md#the-jwt). Authentication still checks the credential and binding.
- The handler ends the live registration whose runtime identity equals the path parameter and whose client identity, project and resource identity equal those of the caller. The path parameter names the target because the machine identity names no runtime identity after the end.
- The handler ends the registration and frees its slot through the Project instance-count collaboration in the same transaction, as registration takes it.
- Every target that is no live registration of the caller answers 404 `worker.registration.not_found`. This includes an unknown or ended identity, the registration of another client and a newer registration of the same client identity, which stays intact. A delayed request for an ended runtime identity never ends a newer registration.
- The answer is 200 `{ runtime_identity, registered: false }`.
- A retry with the same `Idempotency-Key`, caller and target replays the recorded answer after the end, inside one process and the TTL. The operation declares no `replayGuard`. Authentication grants no bypass for a revoked credential. An ended group gets no handler run, under the ended group answer below.
- For an ended group, `worker.registration.deregister` answers 404 `worker.registration.ended`. A group ends when its binding is removed, its effective instance count is 0, or a tombstone newer than the token exists. That answer runs no handler and changes no state. Every other authentication failure keeps its 401. Authentication gives this answer before the handler, so it replaces 404 `worker.registration.not_found` for each target.
- A retry after a restart runs the handler again. It ends the registration when the registration is still live, and it answers 404 when the registration already ended. The worker application and harness extension read that 404 after their own call as the end of their registration.
- The operation proves no process stop, releases no execution and authorizes no workspace reuse. A live execution follows the [Scheduler liveness rules](scheduler-service.md#liveness). Physical stop and capacity reuse stay B9 SC5 and W5.
- Tests assert end and slot release in one transaction, same-key replay after the end, a post-restart retry that ends a live registration or answers 404 for an ended one, and 404 for each non-owned target. They assert that a newer registration stays intact and the worker unit calls it at graceful stop. They assert 404 `worker.registration.ended` with no handler run for a removed binding, a count of 0 and a tombstone newer than the token, and 401 for each other authentication failure.

## Resume of a registration

- `worker.registration.resume` is a `human` mutation of `unary` lifetime at `POST /api/worker/registration/:runtime_identity/resume`, with no body, the default 30 s timeout and the default 10 MiB body limit.
- It reopens an ended registration while that registration is the claimant of a `running` execution.
  The Worker Service reads the `running` execution of the runtime identity through the Scheduler Service in the same transaction.
  The Scheduler first settles any expired unsettled execution under [Scheduler liveness](scheduler-service.md#liveness).
- It clears `ended_at`, sets the last heartbeat to the time of the act and takes the slot through the Project instance-count collaboration, in one transaction.
- The next registration of its client identity answers that registration, and its work pull returns the `running` execution.
- A resume of a live registration answers 200 and changes nothing.
- An unknown runtime identity answers 404 `worker.registration.not_found`.
- A registration that is the claimant of no `running` execution answers 409 `worker.registration.no_live_execution`.
  A lost execution is never revived.
- A client identity that holds another live registration answers 409 `worker.registration.client_live`.
- A binding without a free slot, or an unavailable binding, answers 409 `worker.registration.slot_unavailable`.
- The answer is 200 `{ runtime_identity, registered: true }`.
- Tests assert the reopen, the heartbeat and the slot in one transaction, and each refusal.
  They assert the resume of the `running` execution through the next registration and work pull.

## The worker application

`kanthord serve worker` starts the `worker` application, which hosts one [worker instance](#worker-instances) at the `worker` placement.
It is the `worker` wrapper of [the worker unit](#the-worker-unit-and-its-wrappers). The rules below that name a process, a signal, an exit code or the instance configuration bind the `worker` wrapper. The other rules bind the worker unit at every placement.

- The command declares `--instance <name>` and `--endpoint`. It refuses `--token` and `--config`.
- The wrapper resolves the [instance configuration](#the-instance-configuration). It reads no `cli.yaml`.
- The bindings, the worker, the agent configuration and the effective instance count come from the server through the [connection answer](#the-instance-exchange). The worker application reads the setup of one execution through `worker.execution.setup.get`.
- One process hosts one instance. The instance serves each binding that lists it through one registration of that binding.
- The data directory of an instance is `$XDG_DATA_HOME/kanthord/workers/<name>/`. It holds `workspaces/` and `pi/` of the worker unit.
- The log directory of an instance is `$XDG_STATE_HOME/kanthord/workers/<name>/`.
- The wrapper gives the worker unit these directories. The worker unit names no placement and no instance.
- The startup order is:
  1. The wrapper resolves the instance configuration.
  2. It checks the endpoint. An `http://` endpoint whose host is not in the private address set refuses the start with `worker.start.endpoint_insecure`. The set is loopback, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `fc00::/7` and `fe80::/10`. The wrapper resolves the host once at the start.
  3. It takes a [worker token](#the-instance-exchange) and compares `server_version` with its package version. A difference exits 1 with `worker.version.mismatch`.
  4. It logs one record `Worker instance ready` with `instance`, `worker`, `fingerprint`, `connection_name` and `config_source`.
  5. It connects and opens the binding entries of the connection answer.
  6. The worker unit installs and checks the [pi tool binaries](#pi-tool-binaries), checks the server package version and registers each binding entry.
- The wrapper does not install the pi tools.
- The worker unit checks `ssh-agent` and `ssh-add` for presence at its start. A spawn that answers `ENOENT` refuses the start with `repository.connector.tool_missing`.
- The application logs one info record for each task start, task commit, task verification, done record, planning of the units and of the verdict, verdict rule check, release verification, routed release failure, turn violation, node judgement and base merge. A record holds identities and results, and no agent content.
- When an execution ends, the application logs one record `execution ended` with `execution_id` and `kind`. The `kind` is `released`, `closed` or `ended`. For `ended`, the record adds `reason` and `code`. For `released` with a `stop`, the record adds the `reason` and the `code` of that `stop`. When the stop has a cause text, the record also adds `detail`.
- The worker unit keeps the agent sessions of each execution in `pi/sessions/execution/<execution identity>/` of its data directory, under [Traces](#traces). It keeps the newest 50 execution directories.
- After each registration, the worker unit logs one record `Worker application ready` with `runtime_identity`, `resource_identity` and `worker_name`.
- The application writes operational log records to stderr as JSON lines. It prints no token, no private key and no instance configuration, and it requires no terminal.
- A startup failure prints its diagnostic, releases what it acquired and exits 1.
- A registration whose answer is indeterminate stops the start with `worker.start.registration_indeterminate`.
- `SIGINT` and `SIGTERM` stop further startup and further work pulls.
- A `SIGINT` or a `SIGTERM` during the startup is a stop, not a startup failure. The application exits 0 with no diagnostic.
- A stop aborts each outstanding work pull. A claim that commits during that abort has no worker until its lease expires, and settlement then declares it lost.
- The application deregisters only a registration whose runtime identity it knows.
- The application deregisters at a stop only when no execution is live and no work pull answer failed its schema. An upgrade stops the old process before it starts the new one.
- A work pull answer that fails its schema ends the pull loop with `gateway.client.answer_invalid`. The application deregisters nothing and exits 1. A restart of the same instance inside the heartbeat window resumes the same registration and the same claim.
- It exits 0 after a successful deregistration of each registration, or after a 404 `worker.registration.not_found` or `worker.registration.ended`. Any other deregistration or cleanup failure exits 1 without a retry.
- An execution that ends with a release or a closure leaves the registration live, and the application pulls again. A release with a `stop` is a release. An execution that ends with no release and no closure exits 1.
- A stop during a live execution exits 1 with `worker.stop.execution_live`. A deregistration whose answer is indeterminate exits 1 with `worker.stop.deregistration_indeterminate`.
- A superseded connection exits with status 3 under [The instance exchange](#the-instance-exchange). Every other stop diagnostic exits 1.
- A 10-second watchdog applies only when no execution is live and no registration waits for its answer.
- `SIGHUP` reopens nothing.
- B9 owns shutdown during a live execution or a registration with no answer, and a stop deadline in those cases.
- Tests cover the option resolution, the refusal of `--token` and `--config`, the startup order, each startup failure and the ready records. They also cover deregistration before exit and a failed deregistration. They cover the abort of the outstanding work pulls at a stop and the watchdog of a settled state.
- A test covers a claim answer with an unknown field. It asserts one pull, the exit with `gateway.client.answer_invalid`, no deregistration, and a restart that resumes the same claim and completes the handover.

### The instance configuration

The instance configuration holds `name`, `endpoint`, `instance_id` and `private_key`.
`instance_id` is the id of the instance record revision. `private_key` is the base64url form of the 32-byte X25519 private key.

- The configuration value is the unpadded base64url form of the canonical JSON of the configuration. It has no prefix.
- The instance file is `$XDG_CONFIG_HOME/kanthord/workers/<name>.yaml`, with mode `0600` in a directory with mode `0700`. It holds the same four keys. It is no `cli.yaml`.
- `kanthord worker join` and `kanthord serve worker` decode the value and validate it against the configuration schema. A mismatch answers `worker.instance.config_invalid`. A file whose `name` differs from its file name answers the same code.
- With the file source, `kanthord serve worker` requires `--instance <name>` and reads `workers/<name>.yaml`.
- With `KANTHORD_WORKER_CONFIG` set, the name comes from the value, and `--instance` is optional. A given `--instance` that differs from that `name` exits 1 with `worker.instance.config_invalid`.
- `KANTHORD_WORKER_CONFIG` set while `workers/<name>.yaml` exists for the same name exits 1 with `worker.start.instance_config_conflict`.
- Neither source exits 1 with `worker.start.instance_config_absent`. The diagnostic names each path that it read and the value of `XDG_CONFIG_HOME`.
- The record `Worker instance ready` states `config_source: env` or `config_source: file`.
- `kanthord serve worker` writes no configuration.
- `KANTHORD_ENDPOINT` and `--endpoint` override `endpoint`.
- A Reset key gives a new instance configuration. The operator replaces the file with `kanthord worker join --force` or replaces the env value.
- A stateless host sets `KANTHORD_WORKER_CONFIG` at each start and needs no volume for the identity. With no data volume, a restart loses the workspaces, and a resumed execution prepares its workspace again from the node branch.
- `childEnvironment` of `src/agent/environment.ts` removes `KANTHORD_WORKER_CONFIG`, `KANTHORD_TOKEN` and `KANTHORD_ENDPOINT` from each child process. A tool that reads `/proc` still reads the initial environment of the process, under [Trust boundary](#trust-boundary).
- The template unit `kanthord-worker@.service` is a systemd user unit. It runs `kanthord serve worker --instance %i` with `Restart=on-failure` and `RestartPreventExitStatus=3`, and it sets no `XDG_*_HOME`.
- [architecture.impl.md](architecture.impl.md#the-command-surface) states the commands `kanthord worker join` and `kanthord worker instance`.
- Tests cover each source, the conflict, the absence with its paths and an invalid value. They also cover a file name mismatch, another `--instance`, the file modes and the environment of a child process.

### The copy blocks

The Add instance sheet and the Reset key result show the one copy block of the host kind that the human selects, under [The worker pages](architecture.impl.md#the-worker-pages).
No block puts the instance configuration on a command line. `<name>` is the instance name, and `<version>` is the server version.

`Linux (systemd)` runs the instance as a systemd user unit:

1. Download `kanthord-linux-<arch>` and `SHA256SUMS` of the release `<version>` from the [releases page](https://github.com/kanthorlabs/kanthord/releases). `<arch>` is `x64` for an `x86_64` host and `arm64` for an `arm64` host.

2. Check the download against `SHA256SUMS`, then install it:

   ```sh
   sha256sum --ignore-missing -c SHA256SUMS
   sudo install -m 755 kanthord-linux-<arch> /usr/local/bin/kanthord
   ```

3. Let the user units of the user run without a login session:

   ```sh
   loginctl enable-linger
   ```

4. Write the instance file. `kanthord worker join` reads the instance configuration from standard input. Paste the value, press `Enter`, then press `Ctrl-D`:

   ```sh
   kanthord worker join
   ```

5. Create the directory of the user units, and write the template unit `kanthord-worker@.service`:

   ```sh
   mkdir -p ~/.config/systemd/user
   cat > ~/.config/systemd/user/kanthord-worker@.service <<'EOF'
   [Unit]
   Description=KanthorD worker instance %i

   [Service]
   ExecStart=/usr/local/bin/kanthord serve worker --instance %i
   Restart=on-failure
   RestartPreventExitStatus=3

   [Install]
   WantedBy=default.target
   EOF
   ```

6. Write the settings of this instance. They set the author of the agent commits and turn off core dumps. `<git name>` and `<git email>` set the identity of the commits that the agents make:

   ```sh
   mkdir -p ~/.config/systemd/user/kanthord-worker@<name>.service.d
   cat > ~/.config/systemd/user/kanthord-worker@<name>.service.d/kanthord.conf <<'EOF'
   [Service]
   Environment="GIT_AUTHOR_NAME=<git name>" "GIT_AUTHOR_EMAIL=<git email>" "GIT_COMMITTER_NAME=<git name>" "GIT_COMMITTER_EMAIL=<git email>"
   LimitCORE=0
   EOF
   ```

7. Start the instance, and start it again at each boot:

   ```sh
   systemctl --user daemon-reload
   systemctl --user enable --now kanthord-worker@<name>
   ```

`macOS (foreground)` runs the instance in a terminal. macOS has no systemd user unit, so nothing restarts the process.

1. Download `kanthord-darwin-arm64` and `SHA256SUMS` of the release `<version>` from the [releases page](https://github.com/kanthorlabs/kanthord/releases).

2. Check the download against `SHA256SUMS`, remove the macOS quarantine flag, then install it. Without the `xattr` command, macOS refuses to start the binary.

   ```sh
   shasum -a 256 --ignore-missing -c SHA256SUMS
   xattr -d com.apple.quarantine kanthord-darwin-arm64
   sudo install -m 755 kanthord-darwin-arm64 /usr/local/bin/kanthord
   ```

3. Write the instance file. Paste the value, press `Enter`, then press `Ctrl-D`:

   ```sh
   kanthord worker join
   ```

4. Set the author of the agent commits for this terminal. `<git name>` and `<git email>` set the identity of the commits that the agents make:

   ```sh
   export GIT_AUTHOR_NAME="<git name>" GIT_AUTHOR_EMAIL="<git email>" GIT_COMMITTER_NAME="<git name>" GIT_COMMITTER_EMAIL="<git email>"
   ```

5. Start the instance. Keep the terminal open:

   ```sh
   kanthord serve worker --instance <name>
   ```

A container host kind adds the field **Container runtime** with the values `Podman` and `Docker`. `Podman` is the default. The sheet shows the steps of that runtime. The Podman form follows. The Docker forms follow the Podman forms.

`Container` runs the instance on a container platform with no writable configuration:

- Store the instance configuration as a secret of the platform, and expose it to the container as the env value `KANTHORD_WORKER_CONFIG`.
- Use the image `docker.io/kanthorlabs/kanthord:<version>` with the command `serve worker`.
- Run the container with no health check, for example with `podman run --no-healthcheck`. The health check of the image reads a server, and a worker container serves no server.
- Set a memory limit on the container, for example with `podman run --memory=4g`. Give the host 1 GiB for the server plus the limit of each instance. An out-of-memory kill then stops a process of this container only.
- Run one replica. A second replica supersedes the first, under [The instance exchange](#the-instance-exchange).
- Publish no port. The instance opens every connection to the server.

`Container on this host` runs the instance in a container beside the server container `kanthord`. The sheet fills the endpoint `http://kanthord:31415`.

1. Put both containers on one network:

   ```sh
   podman network create kanthord-net
   podman network connect kanthord-net kanthord
   ```

2. Store the instance configuration as a Podman secret. `podman secret create` reads it from standard input. Paste the value, press `Enter`, then press `Ctrl-D`:

   ```sh
   podman secret create kanthord-worker-<name> -
   ```

3. Start the instance. `<git name>` and `<git email>` set the identity of the commits that the agents make. `--memory=4g` keeps an out-of-memory kill inside this container when the host holds 1 GiB for the server plus the limit of each instance:

   ```sh
   podman run -d --name kanthord-worker-<name> --network kanthord-net --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --memory=4g --no-healthcheck --secret kanthord-worker-<name>,type=env,target=KANTHORD_WORKER_CONFIG -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version> serve worker
   ```

The Docker form of `Container` replaces the first bullet, the health check bullet and the memory bullet:

- Write the line `KANTHORD_WORKER_CONFIG=<value>` to an env file of mode 0600. Give the file to `docker run` with `--env-file`, then delete the file. `docker inspect` shows the value to every user that can run `docker`.
- Run the container with no health check, for example with `docker run --no-healthcheck`. The health check of the image reads a server, and a worker container serves no server.
- Set a memory limit on the container, for example with `docker run --memory=4g`. Give the host 1 GiB for the server plus the limit of each instance. An out-of-memory kill then stops a process of this container only.

The Docker form of `Container on this host`:

1. Put both containers on one network:

   ```sh
   docker network create kanthord-net
   docker network connect kanthord-net kanthord
   ```

2. Write the instance configuration to an env file of mode 0600. `cat` reads it from standard input. Type `KANTHORD_WORKER_CONFIG=`, paste the value, press `Enter`, then press `Ctrl-D`:

   ```sh
   (umask 077 && cat > <name>.env)
   ```

3. Start the instance. `docker run` reads the env file once. `docker inspect` shows the value to every user that can run `docker`. `<git name>` and `<git email>` set the identity of the commits that the agents make. `--memory=4g` keeps an out-of-memory kill inside this container when the host holds 1 GiB for the server plus the limit of each instance:

   ```sh
   docker run -d --name kanthord-worker-<name> --network kanthord-net --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --memory=4g --no-healthcheck --env-file <name>.env -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version> serve worker
   ```

4. Delete the env file. The container keeps the value:

   ```sh
   rm <name>.env
   ```

## The worker unit and its wrappers

[worker-service.md](worker-service.md#instances-and-hosting) requires one worker unit inside one worker boundary at every placement.

- `src/apps/worker/unit.ts` holds `WorkerUnit`, the worker unit.
- It takes `{ bindings, directories, env, log, instance_key?, model_runtime_factory?, repository_transport?, resume_pull_wait_ms?, watchdog?: () => () => void }`. It takes no endpoint, no token and no configuration path.
- `bindings` is a list of `{ transport, client_secret }`, one entry for each registration of the instance. A pool slot passes a list of one entry.
- `directories` is `{ data, log }`. The data directory holds `workspaces/` and `pi/`.
- `instance_key` is `{ holder, sealed_to, public_key, private_key() }` of the instance. `private_key()` answers a new buffer that the caller clears after each open. The `worker` wrapper passes it, and the `server` wrapper passes none.
- The handover of the worker unit opens a sealed item with `openSealedCopy` of [the custody client](custody.impl.md#the-credential-handover), and it seals each refreshed credential to its own key. Without `instance_key`, or with a key that does not open it, a sealed item fails the handover with `worker.handover.sealed_unopened`.
- The `server` wrapper passes `state/kanthord/` of the slot root for both. The `worker` wrapper passes the data directory and the log directory of [The worker application](#the-worker-application).
- The worker unit registers each entry. Every request of a registration renews its heartbeat, and an idle registration sends a heartbeat inside the heartbeat window.
- While idle, the worker unit keeps one outstanding work pull on each registration. When one pull answers a claim, it aborts the other pulls and starts no pull until the execution ends.
- A no-work answer that the server held for the backoff delay or longer resets the backoff, and the pull loop pulls again at once. A shorter no-work answer waits for the rest of the delay. A refused pull therefore keeps its place in the [queue order](scheduler-service.impl.md#the-claim-selection) of its instance.
- The `worker` wrapper adds and removes entries when the connection answer changes. An entry in the state `draining` ends its live execution first, then deregisters and leaves the list.
- `log` is a log destination, or a line sink for a test.
- The `env` of the worker unit equals the `process.env` of its thread.
- `WorkerUnit` reads no `process.env`, installs no signal handler and calls no `process.exit`.
- `WorkerUnit` offers `start()`, `run()`, `drain()` and `stop()`.
- `stop()` follows the stop rules of [The worker application](#the-worker-application).
- `drain()` stops further work pulls and lets the live execution end with its release or its closure. Then it deregisters each registration and ends `run()`. An idle unit deregisters and ends at once.
- A unit that drains before its first pull makes one resume pull. `resume_pull_wait_ms` (default 5000) bounds that pull, so that a running execution resumes.
- `instanceHealthcheck` refuses a draining slot, so that pull claims no new work. The claim returns a `running` execution before the healthcheck.
- The modules of `src/worker/` that only the worker unit runs move to `src/worker/unit/`. `src/worker/unit/index.ts` is their one entry.
- Today these modules are `execution-run`, `native-agent`, `native-method`, `steps-implement`, `steps-examine`, `judgement`, `evaluation` and `evaluation-input`.
- They also include `turn-gate`, `release-gate`, `verdict-rule` and `done-record`, the modules of [the coder flow](#the-coder-flow).
- They also include `base-refresh`, `verification`, `local-git`, `workspace`, `budget`, `model-runtime`, `tool-table`, `host-tools` and `method-clients`.
- They also include `method-telemetry`, `telemetry`, `agent-telemetry`, `session-entries`, `report-facts` and `node-reads`.
- `toolDeclarations` moves out of `tool-table` and stays in `src/worker/`, because the server reads it.
- `src/worker/index.ts` keeps the server entry: `WorkerService`, its migrations and its configuration.
- `local-git`, `verification` and `tool-table` take the `env` of the worker unit. They pass `childEnvironment(env)` to each child process and read no `process.env`.
- `local-git` builds each git environment with `isolatedGitEnvironment` of `src/kernel/git-environment.ts`. [repository.impl.md](repository.impl.md#repository-connector) states the rules.
- The `worker` wrapper is `src/apps/worker/index.ts`. It resolves the instance configuration, runs [the instance exchange](#the-instance-exchange), builds one HTTP transport for each binding entry and passes `process.env`.
- It logs to stderr, installs the signal handlers and owns the exit code. It arms its 10-second exit through `watchdog`.
- The `server` wrapper is the pool host `src/apps/server/worker-pool.ts`. It starts the instance of each started pool slot through the slot driver of [The slot driver](#the-slot-driver).
- The `thread` driver `src/apps/server/thread-driver.ts` starts one `node:worker_threads` thread for each slot of the `server` placement.
- At the `container` placement, `kanthord serve slot` inside the container starts the same thread entry, under [The container driver](#the-container-driver).
- The `server` wrapper passes no `watchdog`.
- The thread entry `src/apps/worker/thread.ts` builds the port transport and runs `WorkerUnit`.
- The `thread` driver sends a `parentPort` message `{ kind: "drain" }` or `{ kind: "stop" }`. `thread.ts` maps it to `drain()` or `stop()`.
- A start in drain mode sends the instance the `drain` control.
- After `run()` returns, `thread.ts` closes its port, and the thread ends by itself.
- `src/apps/worker/thread-start.ts` starts the thread entry. The `thread` driver and `serve slot` both use it.
- The release build embeds a bundle of `src/apps/worker/thread.ts` as the SEA asset `worker-thread.cjs`. It uses the esbuild flags of `kanthord.cjs`, but its banner resolves `import.meta.url` from `process.execPath`, because `__filename` of eval code is `[worker eval]`. The release build checks that URL. `thread-start.ts` starts it with `eval: true`.
- A development checkout starts the TypeScript file.
- No module of the worker unit names a placement. The placement exists only in the wrappers, in the slot drivers, in the transports and in the binding.

## The worker transport

- `WorkerTransport` of `src/apps/worker/transport.ts` is the one interface through which the worker unit reaches kanthord. It replaces `WorkerApi`.
- It holds `gateway`, `worker`, `scheduler`, `mission` and `tracking`. Each is a `ServiceClient` of `src/kernel/operation.ts` over the operation map of its `contract.ts`.
- `httpTransport(endpoint, bearer)` builds each client with `httpClient` of `src/gateway/client.ts`. `bearer` is a function that the transport calls at each request, so a renewed client token reaches the next request.
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
- The `container` driver carries each port message unchanged as a `port` frame under [The slot channel of a container](#the-slot-channel-of-a-container).

## The machine identity of a pool slot

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
- At the `server` and the `container` placements, `worker.register` checks that the client identity of the caller is a current pool slot of the binding.
- A current pool slot is every slot in the pool state of the binding, a slot that drains included.
- The pool check `isSlot` compares the project, the binding and the generation.
- Another client identity answers 409 `worker.registration.placement_mismatch`.

## Worker instances

[worker-service.md](worker-service.md#worker-instances) states the rules of a worker instance.

### The instance record

The table `worker_instance` holds one row for each revision of an instance, after the pattern of the `credential` table. [01-setup.md](../reference/erd/01-setup.md) holds the schema.

| Column        | Rule                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `worker_instance_<ulid>`, one revision. Primary key.                                                                                     |
| `name`        | The binding name form of `bindingNameSchema`: 1 to 63 characters, lower-case letters, digits and hyphens, a letter first. Never changes. |
| `worker`      | The name of a catalogue worker that kanthord hosts. Never changes.                                                                       |
| `revision`    | The revision value of [architecture.impl.md](architecture.impl.md#the-revision-value). Unique with `name`.                               |
| `public_key`  | The base64url form of the 32-byte X25519 public key.                                                                                     |
| `fingerprint` | `SHA256:<unpadded base64 of the SHA-256 of the 32 key bytes>`. Unique over every row.                                                    |
| `created_at`  | Unix ms.                                                                                                                                 |
| `ended_at`    | Unix ms, null while the revision is live.                                                                                                |

- The table holds three unique indexes: the primary key `id`, `(name, revision)` and `fingerprint`. It holds no other index and no `CHECK`.
- The Worker Service validates the name form, the worker against the catalogue and the key form before each write.
- An archived name stays taken. A create of a taken name answers 409 `worker.instance.name_conflict`.
- The names `server`, `token`, `connect` and `heartbeat` are reserved and answer 400 `worker.instance.name_invalid`. `server` is the holder value of a server-held credential. The other three are static route segments.
- The live revision of a name is its row with the greatest `revision` and a null `ended_at`. A name with no live revision is archived.
- Only a Reset key creates a revision. `worker.instance.rotate` names `expected_revision`. In one transaction it inserts the next revision with the new public key and ends the old revision.
- In the same transaction, the Reset key ends every live registration whose client identity derives from the old revision. Registrations of other instances of the same binding stay live.
- Every worker token, connection and client token of the old revision fails its next request, because each carries the old `instance_id`.
- The client identities of the instance change, because their derivation label holds the revision id.
- Every credential copy sealed to the old fingerprint has no holder until a human enters its secret again, under [custody.impl.md](custody.impl.md).
- An archive ends the live revision for good. It names `expected_revision`.
- The archive refuses while a binding that is no tombstone lists the instance, with 409 `worker.instance.in_use` and `details.bindings`.
- The archive also refuses while a registration of the instance is the claimant of an execution with a null `ended_at`, with 409 `worker.instance.in_use` and `details.executions`. A draining execution therefore ends before the archive.
- In the same transaction, the archive ends every live registration whose `instance_id` names a revision of the instance.
- In the same transaction, the archive calls the custody collaboration `archiveHeld(tx, holder)`, which archives every live credential row of the instance.
- The confirmations of Reset key and Archive read `worker.instance.get`. They list the bindings that list the instance, the connection, the live registrations and executions, and the credential copies.
- The Reset key confirmation states: "Rotate each listed credential with a new secret, and rotate the key at the provider. The old configuration still opens these credentials."
- A list row shows `<name> (v<revision>)`.
- The `worker_registration` row holds `instance_id`, the instance revision id of a registration at the `worker` placement, and null at every other placement.
- The Worker Service implements the Scheduler collaboration `registrationsOfInstance(tx, runtimeIdentity)` from `instance_id`, under [scheduler-service.impl.md](scheduler-service.impl.md#the-claim-selection).

### The operations of an instance

| Operation                   | Route                                               | Policy                                    | Input                                            | Answer                                                                                                                                                       |
| --------------------------- | --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `worker.instance.create`    | `POST /api/worker/instance`                         | `human`, mutation                         | `{ name, worker, public_key?, endpoint? }`       | 200 instance record                                                                                                                                          |
| `worker.instance.list`      | `GET /api/worker/instance`                          | `human`, read                             | `worker?`, `limit`, `cursor`, `include_archived` | items: instance record, `connection`, `binding_count`, `holder_mismatch`                                                                                     |
| `worker.instance.get`       | `GET /api/worker/instance/:instance_name`           | `human`, read                             | none                                             | instance record, `connection`, `bindings: [{ project_id, binding }]`, `registrations`, `credentials: [{ name, revision, platform, sealed_current, health }]` |
| `worker.instance.rotate`    | `POST /api/worker/instance/:instance_name/revision` | `human`, mutation                         | `{ public_key?, endpoint?, expected_revision }`  | 200 instance record                                                                                                                                          |
| `worker.instance.archive`   | `POST /api/worker/instance/:instance_name/archive`  | `human`, mutation                         | `{ expected_revision }`                          | 200 instance record                                                                                                                                          |
| `worker.instance.token`     | `POST /api/worker/instance/token`                   | `public`, read                            | `{ instance_id }`                                | 200 `{ server_version, sealed }`                                                                                                                             |
| `worker.instance.connect`   | `POST /api/worker/instance/connect`                 | `worker`, mutation                        | `{ connection_id?, connection_name }`            | 200 `{ connection_id, binding_version, sealed }`                                                                                                             |
| `worker.instance.heartbeat` | `POST /api/worker/instance/heartbeat`               | `worker`, mutation                        | `{ connection_id, connection_name }`             | 200 `{ server_version, binding_version, credential_version, login_sessions }`                                                                                |
| `worker.ssh.sign`           | `POST /api/worker/ssh/sign`                         | `client`, secret mutation, live execution | `{ execution_id, nonce, ciphertext }`            | 200 `{ nonce, ciphertext }`                                                                                                                                  |

- An instance record is `{ id, name, worker, revision, public_key, fingerprint, created_at, ended_at }`.
- `worker.instance.create` and `worker.instance.rotate` take `public_key` or `endpoint`, never both and never neither. Another input answers 400 `worker.instance.key_invalid`.
- With `public_key`, the server stores that key. The CLI commands `kanthord worker instance create` and `rotate` generate the key pair on their host and send only `public_key`.
- With `endpoint`, the server generates the X25519 key pair and stores only the public key. The dashboard path sends `endpoint`.
- The answer then adds `instance_configuration`, the configuration value of [The instance configuration](#the-instance-configuration), once. The answer carries `Cache-Control: no-store`.
- The server keeps no copy of the private key. It clears the key buffer in a `finally` block after the answer, also after a failure.
- `connection` is `{ connection_name, connected_at, last_heartbeat_at }`, or null when the instance holds no current connection.
- `holder_mismatch` is true when a binding that lists the instance names a credential with no live copy sealed to the current fingerprint of the instance. The worker page shows its badge from it.
- `bindings` lists the bindings of every project that list the instance. The dashboard reads the cross-project bindings of an instance from it.
- No answer holds a secret except the sealed objects and `instance_configuration`.
- [gateway-service.impl.md](gateway-service.impl.md#access-policy) rules the access policies `worker` and `public`.
- Tests cover each operation, each refusal of the error table and the absence of a secret in each other answer. A test checks `Cache-Control: no-store` on an answer with `instance_configuration`.

### Error codes of an instance

| HTTP | Code                                    | Condition                                                                                                                                               |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 409  | `worker.instance.name_conflict`         | The name is taken, by a live or an archived instance.                                                                                                   |
| 400  | `worker.instance.name_invalid`          | The name breaks the form or is reserved.                                                                                                                |
| 400  | `worker.instance.worker_invalid`        | The worker is unknown or is a worker of an external harness.                                                                                            |
| 400  | `worker.instance.key_invalid`           | The key is no base64url 32-byte value, all its bytes are zero, or the input holds both `public_key` and `endpoint` or neither.                          |
| 409  | `worker.instance.key_conflict`          | A row of any instance holds the fingerprint.                                                                                                            |
| 404  | `worker.instance.not_found`             | The name is unknown, or the `instance_id` is unknown or ended.                                                                                          |
| 409  | `worker.instance.revision_conflict`     | `expected_revision` is not the live revision.                                                                                                           |
| 409  | `worker.instance.archived`              | A write names an archived instance.                                                                                                                     |
| 409  | `worker.instance.in_use`                | An archive names an instance that a binding lists, or whose registration holds a live execution. `details.bindings` or `details.executions` lists them. |
| 409  | `worker.instance.connection_superseded` | A `connect` or a heartbeat names a connection that is not current.                                                                                      |
| 400  | `worker.ssh.sign_refused`               | The relay refuses the payload. `details.reason` names the reason.                                                                                       |
| 400  | `worker.ssh.sign_invalid`               | The sealed sign request does not open, or its plaintext does not match the schema.                                                                      |
| 403  | `worker.ssh.placement_refused`          | The worker binding of the execution is not at the `worker` placement. `details.placement` names its placement.                                          |

The `serve worker` diagnostics of an instance are `worker.start.instance_config_absent`, `worker.start.instance_config_conflict`, `worker.instance.config_invalid`, `worker.start.endpoint_insecure`, `worker.version.mismatch`, `worker.instance.superseded`, `worker.instance.secret_changed` and `worker.handover.credential_open_failed`.

## The instance exchange

The instance key is the only machine credential of a worker instance.
HPKE base mode with the suite `DhkemX25519HkdfSha256`, HKDF-SHA256 and AES-128-GCM seals each answer to the public key of the live revision.
HPKE base mode gives confidentiality to the key holder only, and it does not authenticate the server. TLS or the same host authenticates the server to an instance.
[The HPKE dependency](architecture.impl.md#the-hpke-dependency) names the library.

The worker token:

1. The process calls `worker.instance.token` with `{ instance_id }`.
2. The server answers `{ server_version, sealed }`. `sealed` is sealed to the public key of that revision, with the info `kanthord/worker-token/v1` and the aad `instance_id`.
3. `sealed` opens to `{ token, expired_at, name, worker, fingerprint }`. `token` is a JWT of the kind `worker`, which [gateway-service.impl.md](gateway-service.impl.md#the-jwt) rules. Its lifetime is `WORKER_TOKEN_LIFETIME`, 3600 s.

- An unknown or ended `instance_id` answers 404 `worker.instance.not_found`.
- The call changes no state, and it creates no connection. A caller without the key gains an object that it cannot open.

The connection:

1. The process calls `worker.instance.connect` with `{ connection_id?, connection_name }`. `connection_name` is the host name of the process, for display only.
2. Without `connection_id`, the server creates `connection_<ulid>` and makes it current. The previous connection of the instance ends at once.
3. The answer is `{ connection_id, binding_version, sealed }`. `sealed` uses the info `kanthord/instance-connection/v1` and the aad `instance_id` followed by `connection_id`.
4. `sealed` opens to `{ bindings: [{ project_id, resource_identity, client_id, token, expired_at, client_secret, state }] }`, one entry for each binding that lists the instance. `state` is `serving` or `draining`.

- The client identity of an instance for one binding is `client_identity_<26 characters>`. It comes from `deriveKey(master_key, "worker/instance-client/<instance_id>/<project_id>/<resource_identity>/<generation>")`, in the form of [The machine identity of a pool slot](#the-machine-identity-of-a-pool-slot).
- No database holds it. A new binding generation or a Reset key changes it.
- `client_secret` is `deriveClientSecret(master_key, auth_version, client_id)`, as for a pool slot. `master_key` never leaves the server.
- Each `token` is a `client` JWT with the claims `instance_id` and `connection_id`. Its lifetime is `WORKER_TOKEN_LIFETIME`.
- A binding that drops the instance from `worker_instances` stays in the answer with `state: draining` while the instance holds a live registration of it. The worker unit ends the execution of that binding, deregisters, and the entry leaves the next answer.
- At the `worker` placement, `worker.register` checks that the client identity of the caller is the derived identity of a listed instance for that binding. `isSlot` makes the same check for a pool slot. Another identity answers 409 `worker.registration.placement_mismatch`.
- `register` returns the live registration of a client identity before the count check, so a restart resumes the same runtime identity.

The current connection:

- The server keeps in memory only the current `connection_id` of each instance and its last heartbeat. It remembers no ended connection.
- A server start keeps no connection. A `connect`, a heartbeat or a `client` request whose `connection_id` arrives while the instance has no current connection makes that id current. A heartbeat also sets its `connection_name` on a current connection that holds none.
- When another id is current, `connect` and the heartbeat answer 409 `worker.instance.connection_superseded`. A `client` request answers 401 `gateway.jwt.connection_superseded`, under [gateway-service.impl.md](gateway-service.impl.md#the-jwt).
- On 401 `gateway.jwt.connection_superseded`, the wrapper sends one heartbeat. A 409 answer ends the process as superseded. A success makes the connection current again, and the process continues.
- A superseded process calls `unit.abandon`. The unit keeps its registrations, cancels the context of the running execution and waits for the end of the execution.
- The cancellation aborts a running bash tool. The bash tool ends its child tree through `killChildTree`, under [Enforcement of the worker boundary](#enforcement-of-the-worker-boundary).
- The process then exits with status 3 and `worker.instance.superseded`. The diagnostic names the `connection_name` of the current connection.
- The template unit sets `RestartPreventExitStatus=3`, so systemd does not restart a superseded process. A restart loop on a container platform means two deployments of one instance configuration.
- Two processes can act in the same workspace of one host between a supersede and the next heartbeat of the old process. That time is at most one heartbeat interval, plus the time of the heartbeat request.

The heartbeat and the renewal:

- The process calls `worker.instance.heartbeat` once at its start, then every `INSTANCE_HEARTBEAT_INTERVAL`, 15 s, and every 2 s while the instance holds an open login session.
- The answer is `{ server_version, binding_version, credential_version, login_sessions }`. [The health of an instance copy](llm.impl.md#the-health-of-an-instance-copy) defines `credential_version`. [The login of an instance](llm.impl.md#the-login-of-an-instance) defines `login_sessions`.
- A `server_version` that differs from the package version stops the worker unit and exits 1 with `worker.version.mismatch`.
- A changed `binding_version` makes the process call `connect` with its `connection_id`.
- `bindingsChanged(projectId)` bumps the `binding_version` of each instance that a binding of the project lists in its previous or its latest revision.
- The process takes a new worker token and calls `connect` again 1800 s after each answer, on the local monotonic clock. The connection answer carries fresh client tokens, so an execution longer than one hour keeps its bearer.
- The dashboard shows an instance as connected while its last heartbeat is inside `INSTANCE_CONNECTED_WINDOW`, 60 s.
- An increment of `gateway.auth.version` fails every token with 401. The process takes a new worker token and connects with its `connection_id`. When a `client_secret` changed, it exits 1 with `worker.instance.secret_changed`. The restart resumes each registration and each `running` execution with a fresh handover.
- The renewal reads only the monotonic clock, so a difference of the two clocks stops nothing.

Tests:

- A Reset key ends the tokens and the registrations of the old revision in one transaction.
- A second process supersedes the first. The first ends the child tree of its running bash tool before it exits 3.
- After a server restart, the first valid connection becomes current, and a request of the same connection passes.
- An auth-version increment exits with `worker.instance.secret_changed`, and the restart resumes a `running` execution of a fake unit.
- Two pulls of one instance on two bindings commit one claim.
- An execution passes one renewal of its client token.
- A heartbeat with another `server_version` stops the unit.

## The pool

- The Worker Service holds the pool state in memory.
- For each binding at the `server` or the `container` placement, it holds the slots.
- The reconciliation takes a binding only when its placement is a value of `PoolPlacement`: `server` or `container`. `requirePoolSlot` applies the same test.
- A binding of an external harness reads `placement: null`, so it never holds a pool slot.
- A binding at the `worker` placement holds no pool slot. The Project Service answers its effective instance count, the length of `worker_instances`, through `workerBindingOf`. Registration, the claim count and the Gateway verification read that count.
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
- A raise clears the drain flag, but the instance still finishes its drain. The pool host then starts the slot again.
- The pool host retires every excess slot through `drain()`. An idle unit deregisters and ends at once. A busy unit ends its execution, deregisters and ends.
- A drained slot ends through its own deregistration.
- A target of 0 ends every registration of the binding in the transaction of the binding-set write, under [Registration heartbeat](#registration-heartbeat).
- The pool host then drains every slot of the binding. A live execution learns of the end at its next call.
- `worker.server_slot_limit` caps the started slots of the server over both pool placements, as a positive safe integer with the default `16`.
- A slot over the cap stays pending. The pool host starts the lowest pending slot when an entry leaves.
- A drain of a pending slot with no live registration removes the slot at once.
- The pool host writes `worker.pool.slot_limit` with `project_id`, `binding` and `slot` to the server log.
- An instance exit without a drain or stop request restarts the slot with a backoff of 1 s that doubles up to 30 s. The backoff resets after the instance lives 30 s.
- The pool host writes `worker.pool.instance_failed` with `project_id`, `binding`, `slot`, `runtime_identity`, `exit_code` and `err` to the server log.
- The pool host starts a slot that drains and still holds a live registration again in drain mode.
- A slot that drains and has no live registration ends. The pool host deletes the entry and calls `ended()`.
- The registration stays live during the backoff, so the new instance resumes the registration and its `running` execution.
- At server stop, `stopPool` runs first, before quiesce. The pool host sends the `stop` control to each instance through its slot driver.
- The pool host calls `terminate()` for an instance that does not end within the pool stop deadline of 5 s. The server watchdog is 10 s.
- A stopped slot cancels its live execution. Only a worker unit with a live execution keeps its registration. An idle worker unit deregisters.
- The project pause reaches a pool slot through its work pull, as it reaches every instance. The pool reads no pause.
- `startPool` runs `check()` of the `container` driver only when a live binding holds `placement: container`. An unavailable answer writes one `worker.pool.driver_unavailable` record with `placement`, `reason` and `detail` to the server log. The server start never fails on it, so a human can fix the binding through the dashboard.

## The slot driver

[worker-service.md](worker-service.md#instances-and-hosting) requires that the `server` application starts the instance of each pool slot through the slot driver that the placement selects.

- `WorkerPool` of `src/apps/server/worker-pool.ts` is the pool host. It implements `PoolHost` and keeps every rule that names no driver.
- The pool host keeps the entry map, the cap, the pending slots, the backoff and the drain, resume and stop decisions of [The pool](#the-pool).
- It creates the slot root and appends the instance output to `stderr.log`.
- It creates the `MessageChannel` of the slot channel, serves `port1` with `servePort` and mints the machine JWT of each call.
- It derives the `client_secret` of the slot.
- It writes `worker.pool.slot_limit`, `worker.pool.instance_failed`, `worker.pool.driver_unavailable` and `worker.pool.cleanup_failed`.
- A slot driver starts one instance and connects the instance end of the slot channel. It forwards a control, ends the instance by force, reports the exit and reports its availability.
- `src/apps/server/slot-driver.ts` declares `SlotDriver`, `SlotLaunch`, `SlotInstance` and `SlotExit`.
- `SlotLaunch` holds exactly `slot`, `channel`, `client_secret`, `root`, `output` and `environment`.
  - `slot` is the `PoolSlot`, and `slot.placement` selects the driver.
  - `channel` is `port2` of the `MessageChannel`, the instance end of the slot channel. The `thread` driver transfers it, and the `container` driver bridges it.
  - `root` is the slot root, and `output` is the append stream of its `stderr.log`.
  - `environment` is the server `env`. The driver builds the `env` of the instance from it under G3.
- `SlotInstance` offers `control(kind)`, `terminate()` and `exited`.
  - `control` takes `drain` or `stop`. A control before the start of the instance waits in order.
  - `exited` resolves once with `{ code, error }`, and it never rejects.
- `SlotDriver` offers `placement`, `check()`, `prepare()` and `launch(launch)`.
  - `check()` answers a `PlacementStatus`, and it never throws.
  - The pool host calls `prepare()` of each pool driver once at each start, before any launch, and does not wait for it. `prepare()` removes the runtime leftovers of the owner. Only a successful `prepare()` counts. A failed `prepare()` runs again before the next launch.
  - The `thread` driver has no runtime leftover. The `container` driver removes the containers of the owner when a runtime answers. With no runtime, it does nothing and logs nothing.
  - A throw of `launch` counts as an exit with code 1.
- `ThreadControl` of `src/apps/worker/thread-data.ts` takes the name `SlotControl`.
- `src/worker/contract.ts` holds the enums `InstancePlacement` (`server`, `container`, `worker`), `PoolPlacement` (`server`, `container`), `PlacementIssue` and `ContainerRuntime` (`podman`, `docker`).
- `WorkerPlacement` of `src/project/contract.ts` holds the same three values as `InstancePlacement`. A type test keeps the two enums equal.
- `PoolSlot` and `PoolTarget` hold `placement`. The group key stays `(project_id, resource_identity, generation)`, because the placement of a binding never changes.
- `PlacementStatus` holds `placement`, `available`, `reason`, `detail` and `container_runtime`. `detail` holds the first line of the runtime answer, at most 200 bytes.
- `PoolHost` offers `placementStatus(placement)`.
- The Worker contract offers `placementStatus(placement)` to the Project Service. It answers the `check()` result of the pool host, and it runs outside every transaction.
- A driver adds no pool state. The states stay pending, running, draining or stopping, exited, then ended, backoff or relaunch.
- An async launch failure resolves `exited` with code 1. The pool host then follows the failure path of [The pool](#the-pool), so the backoff covers a stopped runtime, a failed pull and an absent image.
- The `thread` driver answers `check()` with `available: true`, and its `prepare()` does nothing. [Isolation of a thread slot](#isolation-of-a-thread-slot) rules its instance.
- The `container` driver follows [The container driver](#the-container-driver).

### The guarantees of a slot driver

The pool host and the code of the worker unit keep these guarantees at every slot driver.

- **G1.** The instance reaches kanthord only through its slot channel. No driver gives it a token or an endpoint.
- **G2.** The pool host gives `client_secret` to the instance once at the start. The `thread` driver uses `workerData`, and the `container` driver uses the `init` frame of the slot channel. It never enters an `env`, an argv, an image layer, a label or a file.
- **G3.** The `env` of the instance holds only the allowlist and the directory variables. It holds no `KANTHORD_*` variable, no `NODE_OPTIONS` and no `SSH_AUTH_SOCK`.
- **G4.** The instance ends when its slot channel closes.
- **G5.** The instance runs the server package version. The worker unit checks the version at its start with `worker.version.mismatch`. The worker application also checks the `server_version` of each instance heartbeat.
- **G6.** The instance ends within 5 s after `terminate()`, before the 10 s server watchdog.
- **G7.** The instance output goes to `stderr.log` of the slot root. The server log holds no record of the worker unit.
- **G8.** The slot channel never leaves the server host. On macOS it crosses only the local link between the runtime client and its VM.

The OS-containment guarantees below bind the `container` driver.
The `thread` driver keeps none of them for the agent tools and the verification commands, under [Trust boundary](#trust-boundary).

- **C1.** The root file system is read-only. The writable state of the instance is its slot volume and the tmpfs mounts of the runtime.
- **C2.** No path of the server host is mounted: no configuration, data or state directory of the server, no `HOME` and no runtime socket.
- **C3.** The instance holds its own PID namespace, so it cannot see or signal the server process.
- **C4.** The instance holds no capability, `no-new-privileges` applies, and the core size is 0.
- **C5.** The uid 10001 of the container maps to no privileged host uid, through a rootless runtime or the VM of a macOS runtime.
- **C6.** The instance holds its own network namespace and no published port.

C1 to C6 leave two reaches open.

- A tool process reaches the memory of its own instance. It therefore reaches the `client_secret` of the slot and the handover of the live execution, as at the `worker` placement. It reaches every network that the container reaches.
- A tool at the `server` placement on the same server reaches every `container` slot through the container runtime.

Tests of the slot driver:

- `worker-pool.test.ts` and `worker-thread.test.ts` pass against the `thread` driver. Only the `threadOf` accessor moves to the `thread` driver.
- `pool-host.test.ts` runs the pool host against a fake driver. It covers these cases:
  - the cap and the promote;
  - the backoff from 1 s to 30 s and its reset;
  - the drain and the resume;
  - the stop deadline that calls `terminate()`;
  - a launch throw as exit 1;
  - the end of a drained slot with no registration;
  - a binding of an external harness, which starts no slot.
- A key test asserts the six keys of `SlotLaunch`, and that `SlotLaunch` holds no `master_key` and no token.

## Isolation of a thread slot

- The root of a slot is `workers/<client_id>/` of the state directory of the server, with mode `0700`. Every pool slot holds a slot root.
- The pool host creates the slot root. After that, it only appends `stderr.log` in the slot root. It reads nothing in it.
- After the last slot of a removed binding ends, the pool host removes the slot root and the slot volume of each slot.
- At each start, the pool host removes slot roots under `workers/` and slot volumes of the owner. It removes only those whose client identity belongs to no live binding at any slot number.
- A lowered count keeps the slot root and the slot volume, because the client identity of the slot returns with a raised count.
- A failed removal or sweep writes `worker.pool.cleanup_failed` with the slot root or the volume name and `err` to the server log. It blocks no start and no launch.
- A removed binding at count 0 has no slot that ends. The next start sweep removes its slot roots and slot volumes.
- The slot root of a `thread` slot holds `state/kanthord/kanthord.log` and `stderr.log`. The slot root of a `container` slot holds `stderr.log` only, and the [slot volume](#the-slot-volume) holds the state.
- The rules below bind the `thread` driver.
- The thread starts with its own `env` and never with `SHARE_ENV`.
- The thread refuses a start with `worker.thread.directory_invalid` when any of `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` is absent or not absolute.
- The pool host sets `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` to `config/`, `state/`, `data/` and `cache/` of the slot root.
- The `env` is an allowlist of these server variables, when they are set: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ` and `TMPDIR`.
- The allowlist also holds `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`.
- The `env` holds no other variable, so it holds no `KANTHORD_*` variable, no `NODE_OPTIONS` and no `SSH_AUTH_SOCK`.
- `HOME` is the value of the server user. The `thread` driver keeps no OS-containment guarantee, under [The guarantees of a slot driver](#the-guarantees-of-a-slot-driver).
- `childEnvironment` of `src/agent/environment.ts` removes `SSH_AUTH_SOCK` and `SSH_AGENT_PID`, so an agent tool process at every placement holds no agent of the host user.
- The worker unit keeps its workspaces, its `pi/` directory with its agent sessions and its log under `state/kanthord/` of the slot root. Two slots share no workspace.
- Each thread holds its own `process.env` and its own module instance of pi.
- `loadPi` therefore sets `PI_OFFLINE` and `PI_CODING_AGENT_DIR` for its thread only. pi of that thread finds `rg` and `fd` in `pi/bin/` of the slot.
- The worker unit installs and checks the [pi tool binaries](#pi-tool-binaries) into its own `pi/bin/` at its start, at every placement.
- The `thread` driver gives the worker unit `LogDestination.File`, so the worker unit writes `kanthord.log` of its own state directory.
- The thread starts with `stdout: true` and `stderr: true`. The pool host appends both streams to `stderr.log` of the slot root.
- The server log holds the pool records and the Gateway request records of each port, and no record of the worker unit.
- The worker unit sends its telemetry through the `tracking` client of its transport at every placement.
- An uncaught exception or a `process.exit` of a thread ends that thread only.

## The container driver

[worker-service.md](worker-service.md#instances-and-hosting) requires one container on the server host for each slot of the `container` placement.

- `src/apps/server/container-runtime.ts` detects the container runtime and builds the argv of each runtime command as a pure function.
- `src/apps/server/container-driver.ts` holds the `container` driver.
- One server for each `master_key` uses one container runtime.

### The runtime check

- `check()` answers the first match in this order:
  1. `server_in_container` when `/run/.containerenv` or `/.dockerenv` exists, or when `KUBERNETES_SERVICE_HOST` is set.
  2. `runtime_absent` when neither `podman` nor `docker` resolves on the `PATH` of the server.
  3. For `podman`, then `docker`, the driver runs `<runtime> info --format json` with a 10 s limit. The first runtime that answers wins.
  4. A Docker answer counts as failed when `ServerErrors` is not empty or `ServerVersion` is empty. A Docker client below version 23 counts as failed, and `detail` states the version.
  5. `runtime_failed` when no runtime answers. `detail` holds the first stderr line of the first runtime that resolves.
  6. `runtime_failed` when rootless Podman holds no `host.idMappings.uidmap` entry that covers the container uid 10001. `detail` names the server user.
  7. `runtime_rootful` when the host is Linux, the runtime is rootful and the server uid is not 0. Podman is rootful when `host.security.rootless` is false. Docker is rootful when `SecurityOptions` holds no `name=rootless`. Docker Desktop, whose `OperatingSystem` is `Docker Desktop`, is exempt.
- The driver keeps the newest answer for 10 s and reuses it. A launch with no answer yet waits for one.
- The driver uses the runtime of the newest available answer.
- The runtime CLI runs with the full server `env`, because Podman reads `HOME`, `XDG_RUNTIME_DIR`, `XDG_DATA_HOME` and `CONTAINER_HOST`, and Docker reads `DOCKER_HOST` and `DOCKER_CONTEXT`. Only the named `--env` variables reach the container.
- A server with a custom `XDG_CONFIG_HOME` or `XDG_DATA_HOME` loses the Podman machine connection, because Podman keeps the connection list under those directories. The check then answers `runtime_failed`.
- `check()` runs outside every transaction.

### The placement list

- `worker.placement.list` is a `human` read of `unary` lifetime at `GET /api/worker/placement`. It takes no input.
- It answers `200 { items: [{ placement, available, reason, detail, container_runtime }] }` in the order `server`, `container`, `worker`.
- `server` and `worker` always answer `available: true` with null fields. `container` answers the result of `check()`.
- The CLI leaf is `kanthord worker placement list`.
- The worker binding sheet of the dashboard reads the list when it opens for a new binding.
- While the list loads, `Container` is off and reads "Checking the server host…".
- When the read of the list fails, `Container` is off and reads "Off. The check of the server host failed. Open this sheet again."
- **Placement** shows two radio cards in this order: `Server`, then `Container`. The sheet preselects `Server`, because it is built in and always available.
  - `Server` reads "Built in. Runs each instance as a thread of the server."
  - `Container` reads "Runs each instance in its own container on the server host with `<runtime>`." `<runtime>` is `Podman` or `Docker` from `container_runtime`. The sentence drops "with `<runtime>`" when `container_runtime` is null.
  - Below the cards, **Placement** reads "The binding keeps this choice."
- The sheet turns `Container` off when `reason` is `server_in_container`, `runtime_absent` or `runtime_rootful`. The card then shows "Off." and the text of the reason in place of its description:
  - `server_in_container`: "This server runs in a container, so it cannot start a container for each instance. Keep server."
  - `runtime_absent`: "Install Podman or Docker on the server host, then open this sheet again."
  - `runtime_rootful`: "`<runtime>` runs as root on this host. Use rootless Podman or rootless Docker." `<runtime>` is `Podman` or `Docker` from `container_runtime`, or "The container runtime" when `container_runtime` is null.
- On `runtime_failed`, `Container` stays on, because the write accepts that binding. The card adds "`<detail>`. Fix the container runtime of the server user, then open this sheet again." to its description.
- The `worker` placement is no card. A collapsed **Advanced settings** section of the sheet holds the switch **Worker placement**, the resource budget and the tags. The switch reads "Runs each listed worker instance as a kanthord serve worker process on a machine that you manage. Add the instances on the worker page first."
- While the switch is on, both cards are off, **Instances** replaces **Instance count**, and **Placement** reads "Advanced settings set the worker placement. Turn it off to choose server or container." A switch back to off selects `Server`.
- **Advanced settings** opens by itself when the draft holds the `worker` placement, a budget or a tag, and when a budget field or the tags fail their check.

### The image

- The image reference is `<worker.container_image>:<server package version>`, so the instance runs the server version.
- `worker.container_image` holds an image name with no tag and no digest. The default is `docker.io/kanthorlabs/kanthord`.
- A value that holds `@`, or a `:` after its last `/`, fails with `system.config.invalid_field`. `localhost:5000/kanthord` is valid.
- The image holds `/usr/local/bin/kanthord` of the server version, `/usr/bin/tini`, `/bin/sh`, the user 10001 with an `/etc/passwd` entry, and `/var/lib/kanthord` owned by uid 10001. Every image `FROM docker.io/kanthorlabs/kanthord:<version>` holds them.
- A project toolchain comes from the environment of the repository binding, under [the Onboarding component](project-service.impl.md#the-onboarding-component). The environment image takes `kanthord` and `tini` from this image. A binding names no image.
- The pull policy is `--pull=missing`. The first start of a slot pulls the image, and the pull output goes to `stderr.log`.

### The slot image

- The image of a slot is the image of the environment that its worker binding names in `environment`, under [the Onboarding component](project-service.impl.md#the-onboarding-component).
- At each slot start, `ContainerDriver` calls `imageFor(runtime, slot)`. It calls `slotImage(projectId, workerResourceIdentity, signal)` of the Onboarding component. The slot starts only when the promise resolves: on `<tag>` of a `ready` environment, or on `<worker.container_image>:<version>` when the worker binding names no repository binding.
- A slot of an environment that is not ready waits and starts no container. It pulls no work, so the nodes of that repository wait with no backoff loop and no log line for each retry. A stop or a drain of the slot ends the wait.
- The driver records the image of each slot.
- After a run makes an environment `ready`, the Onboarding component calls `environmentReady(projectId, resourceIdentity, tag)` of the Worker Service. The Worker Service marks each slot of the worker bindings that name the environment and run another image as draining before the call returns. A draining slot takes no new claim, ends its execution, and the pool host starts it again on the new image.
- The image of a slot is fixed for the life of the slot. The reviewer runs on the current digest, as the coder does.

### Names, labels and stale containers

- The owner value is the Crockford base32 form of the first 128 bits of `deriveKey(master_key, "worker/container-owner")`. Nothing stores it.
- The container and its volume take the name `kanthord_slot_<client_id>`. Both carry the labels `io.kanthord.owner=<owner>` and `io.kanthord.client_id=<client_id>`.
- `prepare()` runs `<runtime> ps --all --filter label=io.kanthord.owner=<owner> --format '{{.Names}}'`, then `<runtime> rm --force <name>` for each name.
- `prepare()` never removes a volume, because the volume holds the workspace of a registration that resumes. The start sweep of [Isolation of a thread slot](#isolation-of-a-thread-slot) removes the volume of a removed binding.
- Each launch first runs `<runtime> rm --force kanthord_slot_<client_id>`.
- A `rm --force` of `prepare()`, of a launch or of an environment proof counts as success when it succeeds or answers "no such container" in any letter case.
- When `rm --force` fails otherwise, the removal runs `<runtime> container inspect --format '{{.Id}}' <name>`. A failed inspect that answers "no such container" counts as success.
- Every other inspect answer fails the removal with the error output of `rm --force`.
- The removal of the slot volume of a removed binding is a [HANDOFF](HANDOFF.md#worker-service) item.

### The slot volume

- The named volume `kanthord_slot_<client_id>` mounts at `/var/lib/kanthord`. At its first mount, it copies the ownership of `/var/lib/kanthord` from the image, so uid 10001 owns it on every runtime.
- It holds `state/kanthord/kanthord.log`, the workspaces, the `pi/` directory and `tmp/`.
- An agent session of a `container` slot is a file in `state/kanthord/pi/sessions/execution/<execution_id>/` of the slot volume.
- No host file changes its owner, and no `--userns` option applies.

### The run command

The driver spawns the runtime client with `detached: true`, so a terminal signal or a stop of the server process group never reaches it.

```text
<runtime> run --rm -i --pull=missing
  --name kanthord_slot_<client_id>
  --label io.kanthord.owner=<owner> --label io.kanthord.client_id=<client_id>
  --user 10001 --sig-proxy=false --log-driver none --no-healthcheck
  --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m
  --volume kanthord_slot_<client_id>:/var/lib/kanthord --workdir /var/lib/kanthord
  --env HOME=/var/lib/kanthord --env TMPDIR=/var/lib/kanthord/tmp --env LANG=C.UTF-8
  --env XDG_CONFIG_HOME=/var/lib/kanthord/config --env XDG_DATA_HOME=/var/lib/kanthord/data
  --env XDG_STATE_HOME=/var/lib/kanthord/state --env XDG_CACHE_HOME=/var/lib/kanthord/cache
  --env <NAME> ...
  --entrypoint /usr/bin/tini
  <worker.container_image>:<version> -- /bin/sh -c 'exec 3>&1 1>&2; exec /usr/local/bin/kanthord serve slot'
```

- `--env <NAME>` repeats for each of `TZ`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` that the server `env` sets. The argv holds the name only, so the value comes from the client `env`.
- The driver passes no `PATH`, `USER`, `LOGNAME`, `SHELL`, `LC_ALL` or `LC_CTYPE` of the host.
- The command holds no `-t`, because a TTY mixes the streams and changes the line ends.
- `tini` of the image is PID 1. It reaps the children and forwards the signals.
- `/bin/sh` moves fd 1 to fd 3 and points fd 1 at fd 2. `serve slot` writes frames to fd 3 only, so every other output of the instance lands in `stderr.log`.
- `--no-healthcheck` turns off the healthcheck of the image, which calls `gateway liveness` inside the container.
- `--log-driver none` keeps the runtime from a second copy of the frames, which carry agent content. The attach works with no log driver.
- `--sig-proxy=false` keeps a signal of the client from the container. The pool host stops an instance only through the `stop` frame and `<runtime> kill`.
- `TMPDIR` points into the slot volume, because the runtime mounts `/tmp` as `noexec`, and a clone in a tmpfs fills the memory of the VM.
- The command holds no resource limit. `worker.server_slot_limit` caps the count of containers.

### The network

- The instance uses the default network of the runtime: pasta or slirp4netns for rootless Podman, the bridge for Docker. The command holds no `--network host` and publishes no port.
- The instance reaches the LLM provider, the git remotes and the S3 endpoint of evidence upload.
- G1 is a rule of authority. A route to the Gateway port answers 401 to every call, because the container holds no token.
- An endpoint on `127.0.0.1` of the server host is unreachable from the container. A binding that needs such an endpoint uses the `server` placement.

### The slot channel of a container

- The slot channel is the stdin and the stdout of the runtime client. Each line holds one UTF-8 JSON object. `JSON.stringify` writes no raw newline.
- The frames are below.

| Direction         | Frame                                          | Rule                      |
| ----------------- | ---------------------------------------------- | ------------------------- |
| server → instance | `{"kind":"init","client_secret":"…"}`          | first frame, exactly once |
| server → instance | `{"kind":"port","message":{…}}`                | one port answer           |
| server → instance | `{"kind":"control","control":"drain"\|"stop"}` | the drain or stop control |
| server → instance | `{"kind":"ping"}`                              | every 5 s                 |
| instance → server | `{"kind":"port","message":{…}}`                | one port call or cancel   |

- `src/apps/worker/frames.ts` holds the strict zod schemas of the frames and `bridgePort(port, readable, writable, options)`.
- The bridge checks only the frame envelope. `servePort` and `portCaller` check the message, as over a thread port.
- The `body` of a port answer is a structured value. The server side of the bridge writes it with `JSON.stringify`, as the HTTP transport writes the same answer. A failed `JSON.stringify` answers 500 `gateway.invocation.invalid_response` for that `call_id`, and the instance stays.
- A line from the instance above 64 MiB is a protocol violation. The server holds one line buffer for each slot, so the worst case is `worker.server_slot_limit` × 64 MiB. A machine caller reaches no delivery operation.
- An invalid line from the instance terminates the instance. The exit carries `worker.slot.frame_invalid`, and the pool host writes `worker.pool.instance_failed`.

### `kanthord serve slot`

- `kanthord serve slot` of `src/apps/worker/slot.ts` is an internal mode of the `server` application. A human never runs it.
- It creates `TMPDIR` with mode `0700`, then creates a `MessageChannel`.
- It starts the thread entry through `thread-start.ts` with `workerData { port, client_secret, log: "stderr" }`.
- The thread starts with `stdout: true` and `stderr: true`, and `serve slot` pipes both streams to fd 2.
- It ends with exit 1 and a diagnostic in these cases:

| Code                         | Condition                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `worker.slot.init_absent`    | No `init` frame arrives within 10 s.                                                         |
| `worker.slot.frame_invalid`  | A line on stdin is no valid frame, or the pool host reads an invalid line from the instance. |
| `worker.slot.channel_closed` | Stdin reaches its end, or no frame arrives within 15 s.                                      |

- A deadline timer defers the exit by one `setImmediate` and checks the time of the last frame again. A pending frame after a host wake therefore keeps the instance.
- A `SIGTERM` or a `SIGINT` inside the container acts as the `stop` control.
- A frame that arrives before `init` and is not `init` ends the instance with `worker.slot.frame_invalid`.
- A signal before `init` exits 0, because no thread runs yet.
- The `stop` on the signal path has a 5 s deadline. When the thread does not exit, `serve slot` ends the thread and exits 1 with no error code.
- A failed write to fd 3 ends the instance with `worker.slot.channel_closed`.
- When the thread exits, `serve slot` flushes fd 3 and exits with the exit code of the thread.
- When PID 1 exits, the runtime kills every process of the container. G4 therefore holds when the runtime keeps stdin open after the client dies.

### Stop, terminate and server crash

- `control("stop")` sends the `stop` frame. The worker unit stops under its rules, the thread exits and `serve slot` exits. The container ends, `--rm` removes it, and the client exits with the code of the container.
- `terminate()` runs `<runtime> kill --signal KILL kanthord_slot_<client_id>`. "no such container" counts as success. When the client still lives 2 s later, the driver sends `SIGKILL` to the client.
- `exited` resolves at the exit of the client. Code 125 is a runtime error, for example a pull, name or mount failure. Code 126 or 127 means that the command cannot run. The pool host writes each one as `worker.pool.instance_failed` with `exit_code`, and `stderr.log` holds the runtime text.
- A server crash closes the pipe ends of the server. The container then reads the end of stdin, and `serve slot` exits. When the client survives or dies with no end of stdin, the 15 s frame deadline ends the instance. This stop after a crash is best effort. A slot container that stays running is removed at the next start.
- Under systemd, a crash can kill `conmon` with the instance. The runtime then keeps a container record with no process. No slot acts on a claim, so G5 holds.
- At the next start, `prepare()` removes every container of the owner. The slot starts again with the same `client_id`, the same slot volume and the live registration, so the `running` execution resumes.
- A systemd unit of the server sets `KillMode=mixed`. `systemctl stop` then sends `SIGTERM` to the server process only, and the pool host stops each instance with its `stop` frame.

### macOS and Linux hosts

- On macOS, the Podman machine or Docker Desktop holds the slot volume inside its VM, so no host path is shared. The workspace runs on the native file system of the VM.
- On macOS, the frames cross the API link of the runtime: SSH to the Podman machine, or the socket of Docker Desktop.
- The VM memory bounds every container. The default Podman machine holds 2 GiB. Two or more slots that run `npm` need `podman machine set --memory 8192`.
- A stopped Podman machine answers `runtime_failed`. After `podman machine start`, the slots recover through the backoff.
- A Linux binary install under a system user needs a subordinate uid range and a runtime directory:
  - `apt install podman uidmap`, then `usermod --add-subuids 200000-265535 --add-subgids 200000-265535 kanthord`.
  - The unit sets `RuntimeDirectory=kanthord`, `RuntimeDirectoryMode=0700`, `Environment=XDG_RUNTIME_DIR=/run/kanthord` and `KillMode=mixed`.
  - `~/.config/containers/containers.conf` of the server user sets `cgroup_manager = "cgroupfs"` and `events_logger = "file"`, because a system user holds no systemd user session.
- A Linux desktop user runs rootless Podman with no setup.
- A custom `XDG_DATA_HOME` of the server moves the Podman image store, so an image that a human built in another shell can be absent.

### Tests of the container driver

- Argv golden tests for Podman and Docker assert every option of the run command, and no `client_secret` and no `env` value in the argv.
- Detection fixtures cover these hosts:
  - rootless Podman, a stopped Podman machine, a subordinate range of exactly 10001 uids and a range of 10000 uids;
  - Docker Desktop, rootless Docker, rootful Docker, the `podman-docker` shim and a stopped Docker daemon;
  - `/.dockerenv`.
- Frame tests cover these cases:
  - a round trip, a chunk split inside a UTF-8 sequence and two frames in one chunk;
  - a refused line of 64 MiB plus 1 byte, and a refused unknown `kind`.
- A conformance case sends an answer body that holds a `Date` and an `undefined` field over both port sides.
- Child-process tests of `serve slot` cover `worker.slot.init_absent`, and `worker.slot.channel_closed` at the end of stdin and at the frame deadline. A test checks that a `console.log` of the thread never reaches fd 3.
- A project test covers the 409 `project.bindings.worker.placement_unavailable` on an added binding, and the pass of an edit and of `runtime_failed`.
- `make test-container` runs the driver against a live runtime on Linux rootless Podman and on the macOS Podman machine. It runs in a pull-request workflow on `ubuntu-24.04` with rootless Podman. It asserts these criteria:
  1. A launch registers within 120 s, the first pull included, with `placement: container`.
  2. `<runtime> inspect` shows no `client_secret` and no `KANTHORD_*` in the `env` or the command. It shows the read-only root file system, `CapDrop` `ALL` and `no-new-privileges`.
  3. A drain of an idle slot exits 0. No container of the slot remains after 10 s, and the slot volume remains.
  4. A stop exits within 5 s. `terminate()` ends an instance that ignores the stop within 5 s.
  5. A process that launches a slot and then receives `SIGKILL` leaves a container that the next `prepare()` removes.
  6. `prepare()` removes a container with the owner label, and keeps a container of another owner.
  7. A relaunch with the same `client_id` reads a file that the first run wrote into the slot volume.
  8. `stderr.log` on the host holds the record `Worker application ready`.
  9. `--log-driver none` keeps the attach on both runtimes.
  10. A verification runs a script from `$TMPDIR`.

## Enforcement of the worker boundary

- `eslint-plugin-boundaries` declares the element `worker-unit` for `src/worker/unit` and keeps `apps-worker` for `src/apps/worker`.
- The policy of both elements allows only these targets:
  - `src/kernel/`, except `caller-mint.ts`, `service-mint.ts`, `test-identity.ts` and `fatal.ts`;
  - the `contract.ts` of every service and component;
  - `src/agent/` files `pi.ts`, `pi-tools.ts`, `bash-process.ts`, `agent-session.ts`, `environment.ts`, `catalog.ts` and `prompt-composer.ts`;
  - `src/agent/` files `prompt-render.ts`, `prompt-templates.ts`, `prompt-source.ts`, `prompt-assets.ts`, `pinned-layers.ts` and `hooks/`;
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
- It refuses `node:worker_threads` and `worker_threads` outside `src/apps/worker/thread.ts`, `src/apps/worker/thread-start.ts` and `src/apps/worker/slot.ts`. A type import is excepted.
- `no-restricted-properties` refuses `process.env`, `process.exit`, `process.exitCode`, `process.on`, `process.once`, `process.addListener`, `process.kill`, `process.abort` and `process.dlopen`.
- `no-restricted-globals` refuses the globals `process`, `globalThis` and `global`.
- `no-restricted-syntax` refuses a dynamic `import()`.
- Both rules apply to `src/worker/unit/` and to every file of `src/apps/worker/` except `index.ts`, `thread.ts` and `slot.ts`. Only those three files use the global `process`.
- `killChildTree` of `src/kernel/process-group.ts` is the one signal path of the worker unit. It refuses the pid and the parent pid of its own process.
- Before the exit of a detached child that the unit started, `killChildTree` calls `killProcessTree`. That function signals the leader group and each descendant group, and never its own group.
- `killProcessTree` stops each group with `SIGSTOP`. It reads the process table again until no new descendant group appears, for at most 8 passes. It then kills each stopped group with `SIGKILL`.
- When the tree still forks after 8 passes, `killProcessTree` reads the table once more and kills each new group. It reports the pass limit as a failure.
- After a failed table read, `killProcessTree` still kills each stopped group, or the leader group when it stopped no group. It reports every failure.
- After the exit of the child, `killChildTree` signals only the leader group, because the kernel reparents the children at the exit.
- A descendant whose parent exited before the kill is no longer a descendant of the leader. It survives the kill.
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
- The thread receives `workerData` with `port`, `client_secret` and `log` only, and the port in the transfer list. `workerData.log` is `file` from the `thread` driver and `stderr` from `serve slot`. `threadDataSchema.log` takes every value of `LogDestination`.
- A structured clone carries no function, no store and no service object. `WorkerUnit` takes one transport and no other client.
- Tests assert the keys of `workerData`, the keys of the thread `env` and the mode of the slot root.
- Tests assert the place of `kanthord.log` and `stderr.log`, and no record of the worker unit in the server log.
- Tests assert that `servePort` passes `authorization` and never `identity` to `Invocation.invoke`.
- `src/apps/server/worker-transport-conformance.test.ts` runs one table of cases through both transports.
- It runs `httpTransport` against a started Gateway and `portTransport` against `servePort` of the same server.
- A third side runs `portTransport` over `bridgePort` on two `PassThrough` streams, with the same assertions.
- It asserts the same status, the same error code and the same body for each case:
  - a registration, a second registration of the same client identity, and a registration above the count with 409 `worker.registration.slot_unavailable`;
  - a heartbeat;
  - a pull of a paused project gets no work from the claim and waits for a wakeup. The case cancels the pull after 500 ms on both transports. It asserts an indeterminate outcome and a Gateway 503 request record on both;
  - an execution operation that names an execution of another project, with 403 `gateway.invocation.execution_proof_failed`;
  - an execution operation that names a claim of another binding, with the same 403;
  - a `human` operation with 401;
  - a `service` operation and a `direct: true` operation, each with the 404 of an absent route;
  - a deregistration of the registration of another client identity with 404 `worker.registration.not_found`;
  - a call after the removal of the binding with 401;
  - a body above the limit with 413 `gateway.request.body_too_large`;
  - a body with a duplicate member, and a body that is no JSON value;
  - a body on an operation with no body, and a numeric query value;
  - a registration of a client identity that is no pool slot on a binding at the `server` or `container` placement, with 409 `worker.registration.placement_mismatch`.

## The execution setup

`worker.execution.setup.get` is a `client` read of `unary` lifetime at `GET /api/worker/execution/:execution_id/setup` that requires a live execution.

- It declares `mutation: false`, no body and the default 30 s timeout. It has no CLI leaf.
- The invocation chain proves the path identity, and the server derives the setup from the proven claim.
- The answer is `{ execution_id, worker_name, agents, templates, resource_budget, intent, repositories }`.
- Each entry of `agents` is `{ agent_name, effective_configuration, position, level, credential_id, metadata, prompt }`. The entry of each native agent of the worker is present, in the order of the declaration.
- `worker_name` comes from the worker binding revision that the claim pins, and each `agent_name` comes from the declaration of that worker.
- `effective_configuration` is the pinned selection of `agent_name` in `agent_selections` of the execution. It is never the head of the chain.
- `position` and `level` are the chain position and the chain level of the pinned selection of `agent_name`.
- `intent` is `implement` or `examine`, from the pinned node revision.
- The resolution reads the pinned worker binding revision, the agent selection that the pin rebuilds from the pinned enablement revision, the state of the current enablement and the metadata of the pinned credential revision from one snapshot.
- The credential revision is the revision that the handover of the execution pins for the credential name of the effective configuration. The read creates no pin and selects no other revision.
- An execution that pins no revision of that name answers 409 `worker.execution.credential_not_pinned`. A revoked pinned revision answers 409 `credential.revision.revoked`.
- The model and reasoning-effort validation use the metadata of the pinned credential revision.
- `credential_id` is the row identity of the pinned revision. `metadata` holds the metadata of that revision for every provider, and it is null for a platform without metadata.
- `resource_budget` is the override of the pinned worker binding revision, or the default of the worker.
- Each entry of `repositories` holds `{ binding_id, name, address, ssh_host_key, ssh_public_key, strategy: { base_branch } }`. The entry holds no prompt, because the server composes every Binding prompt.
- `ssh_host_key` is `{ known_hosts }`: the line of the [pin](repository.impl.md#host-keys) of the address host. The line is `<host> <key>` for port 22 and `[<host>]:<port> <key>` for another port. The answer holds no key.
- The read refuses a binding whose address host is outside the SSH host set with `project.bindings.repository.address_invalid`, and an unpinned host with `repository.host_key.unpinned`. The worker stops the execution with that code.
- `ssh_public_key` is the OpenSSH public key of the SSH credential of the binding. The answer holds no private key.
- `ssh_public_key` is the `public_key` metadata of the revision that the execution pins for that credential name, else of the newest live revision. The read creates no pin. A revision without that metadata answers 409 `repository.credential.ssh_key_legacy`.
- The worker matches each entry of `repositories` to its `ssh_identities` entry of the handover by `binding_id`. It derives the public key from the private key and the SSH port from the address with `RepositoryComponent.sshPortOfAddress`, and builds `SshAccess` in memory.
- When the handover holds no SSH identity for a repository binding, the worker builds `SshAccess` over the [SSH signature relay](#the-ssh-signature-relay) for that binding. The choice reads the handover, not the placement.
- The worker drops each `SshAccess` at the end of the execution and writes no key to a file.
- Each method of `RepositoryTransport` takes `ssh: SshAccess`. It holds no SSH proof step.
- `repositories` holds one row for each repository binding that the pinned node revision names, in binding order, for an `implement` node and for an `examine` node.
- `prompt` holds `final`, the system prompt that the server composes: the Standard, the Role, the Binding prompts of the pinned revisions and the framing, as [`agent.get`](agent.impl.md#the-prompt-answer) with `view=final` answers them.
- `templates` holds the [prompt templates](agent.impl.md#prompt-templates) that the server resolves. The worker application renders the work prompt and each instruction from this set.
- An execution of an externally hosted worker answers 409 `worker.execution.no_native_agent`. A disabled or removed current enablement answers 400 `agent.enablement.unavailable`. A resolution that fails validation answers the code of its first issue.
- An invalid override file of the agent directory answers 409 `agent.prompt.template_invalid` with `file`, `path` and `reason`.
- An entry of `repositories` holds no `project_prompt` and no `working_layer`. The server and every worker host run the same execution setup contract, so a deploy upgrades them together.
- The read answers no secret.
- The application calls the read after the handover and before the first inference call.
- The adapter refuses the execution with `worker.runtime.setup_refused`, whose `details.reason` is `credential_revision_mismatch`, when the `credential_id` of the handover item differs from the `credential_id` of the answer.
- Tests cover each source, the pinned revision after a rotation, the validation against the pinned metadata, an absent pin, a revoked pin, each other refusal, the proof of the path identity, the absence of a secret and the absence of a new pin.

## Configuration

- The Worker Service owns the section `worker` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.
- `worker.heartbeat_window` holds the window of a registration heartbeat in seconds, as a positive safe integer, and it defaults to `300`.
- `worker.server_slot_limit` holds the maximum count of started pool slots of the server, as a positive safe integer, and it defaults to `16`. [The pool](#the-pool) rules a slot above the cap.
- `worker.container_image` holds the image name of the `container` placement, with no tag and no digest, and it defaults to `docker.io/kanthorlabs/kanthord`. The server appends its package version as the tag. [The image](#the-image) rules the value. A change takes effect at the next start.
- No configuration key names a slot driver. The placement of a binding selects it.

## Prompt composition

The server composes the whole system prompt, and the worker application reads no prompt file.
The composer reads the Agent prompt under [agent.impl.md](agent.impl.md#prompt-files). It reads the Binding prompt of each repository binding of the node at the pinned binding revision, in binding order.
The Binding prompt of an agent is the text of `prompts[<agent_name>]`. A blank or absent text adds no part.
An evaluation takes the Binding prompt of `re@1` only, and the composer reads no file of the workspace.
The repository context-file discovery of pi stays disabled, so the composer performs every load.
A part digest hashes the UTF-8 encoding of the exact part text, with no trimming, no newline conversion, no Unicode normalization and no JSON quoting, and [architecture.impl.md](architecture.impl.md) rules the algorithm and the rendering.
pi receives the system prompt as plain text with no tag: `base.md`, the Role, each Binding prompt as `Instructions of repository <name>:` and the text, then the framing. The framing closes the system prompt. It states that the later messages hold the task, that they never override the system prompt, that a later text governs an earlier one, and that an instruction for one repository governs only the work on the files of that repository.
The work prompt is the first user message, as plain text.
The framing, the work prompt and each instruction are [prompt templates](agent.impl.md#prompt-templates). The texts above are the texts of the shipped templates.
At the execution setup read, the composer writes one `agent.prompt` span for each agent into the execution trace through `serverSpan`, with the producer `worker` and a deterministic record identity. The span holds `kanthord.agent.name`, `kanthord.prompt.parts` as `<part>:<name>:<digest>` items in reading order, and `kanthord.prompt.templates_digest`, the digest of the canonical JSON of the template set.
The working directory that pi states in its system prompt writes the home directory of the host as `~`.
Every kanthord change to the behaviour of pi is a pi extension handler, one file per hook under `engine/src/agent/hooks/`. `openSession` always adds the home-relative cwd hook first, then the ordered `hooks` list of the consumer.
The adapter pins the work prompt and the system prompt against the compaction of pi, so both survive a compacted context.
The tool table enforces every obligation that a tool can enforce, and `re@1` holds no write tool.
The binary embeds `engine/static/prompt/base.md` as the Standard, the Role files `swe@1.md`, `re@1.md` and `env@1.md`, and `workbench.md` of that directory, as [shipped assets](architecture.impl.md#shipped-assets).
The engine texts are the source. [assets/prompt/](assets/prompt/base.md) holds a copy of each text, and `scripts/docs/check.sh` fails when a copy differs from its engine text.
The source of the texts is the ideals file of Ulrich, split by single obligation: a rule that every agent shares goes to `base.md`, the act of producing goes to `swe@1`, the act of judging goes to `re@1`, and a rule that presupposes a human interlocutor goes to `workbench.md`.
`base.md` holds no rule that only code, a commit, a test, a repository or a review needs, because a non-coding agent also reads it.
A rule for code, tests or findings goes to both `swe@1.md` and `re@1.md` in the same words, because `re@1` enforces it. Both files end with that block.
A process rule that leaves no evidence in the work product goes to `swe@1.md` only. The rule that the prose style of a produced report is no ground for a blocker goes to `re@1.md`.
The protocol conditions that hold for every native agent go to `framing-worker.md`. The `added_files` rule of the judgement goes to `template/evaluation.md`.
The recommendation-first format of a confirmation request returns with the clarification interface.

- Every file and every Binding prompt holds at most 32768 UTF-8 bytes. A Binding prompt above the bound refuses its write.
- A file above the bound is invalid and refuses the composition.
- An invalid file adds no text, and no reader falls back to the shipped text.

The acceptance path proves the configured precedence, an absent file, an invalid file and a blank Binding prompt.
It proves that a reviewer execution takes no file of the workspace.

## The credential store of an execution

- Every native inference call, including compaction and retries, resolves auth through the [custody execution store](custody.impl.md#the-credential-store-of-an-execution).
- The view exposes only the credential that the effective agent provider names, at the revision that the execution pins, under the pi adapter id.
- `read(providerId)` answers `undefined` for every other id.
- The adapter passes the model identifier and the reasoning effort of the effective configuration to the [model connector](llm.impl.md#the-model-connector), which maps them onto the pi model and fails closed with `worker.runtime.setup_refused`.
- The store holds the credential of one execution, so no credential crosses executions.
- Environment hygiene of the pi process belongs to the adapter, and the process inherits no provider environment variable.
- The Worker Service supplies the authorization function of the [protected facility](custody.impl.md#the-protected-facility) for a model inference credential, through the worker binding of the claim.
- A broken chain of a model inference credential answers 403 `worker.authorization.refused` with `details: { reason }`, where `reason` is `binding_mismatch`, `binding_removed`, `binding_disabled` or `no_native_agent`.
- The authorization reads the credential, the provider and the model of each native agent from the pinned selection of the execution. It validates the model against the metadata of the pinned credential revision. Before the first handover pins a revision, it validates against the newest live revision.
- A disabled or removed current enablement answers 400 `agent.enablement.unavailable`, and a selection that fails validation answers the code of its first issue.

## The credential handover

- `worker.handover` is a `client` secret mutation of `unary` lifetime that requires a live execution. `POST /api/worker/handover` takes the body `{ execution_id }` and answers the envelope that [custody.impl.md](custody.impl.md#the-credential-handover) rules.
- While its idempotency record remains in memory within the TTL, a repeat of the key answers 409 without the envelope. The application recovers a lost answer with a new key, which reads the pinned revision again.
- The worker unit calls it once after its claim and before the first inference call. The handover pins each credential revision that it carries.
- It decrypts the envelope with the handover key that it derives from its own `client_secret`. It builds an in-memory pi-ai credential store from the payload and holds the plaintext in memory alone.
- The payload also carries `ssh_identities`, the SSH key of each repository binding of the execution, under [custody.impl.md](custody.impl.md#the-credential-handover). The worker takes the handover before the execution setup.
- A handover item is `{ credential_id, provider_id, credential }` for a server-held credential, at the `server` and the `container` placements only. It is `{ credential_id, provider_id, sealed }` for a copy that an instance holds.
- At the `worker` placement, custody refuses each server-held item and each item of another holder with 403 `custody.handover.holder_refused`. `ssh_identities` is `[]`. [custody.impl.md](custody.impl.md#the-credential-handover) rules the refusal.
- The worker unit opens a sealed item through the `sealed_credentials` function pair of its wrapper. Only the `worker` wrapper passes it, and it opens the item with the instance private key. An item that does not open ends the execution with `worker.handover.credential_open_failed`.
- `worker.credential` is a `client` mutation at `POST /api/worker/credential` that requires a live execution. Its body is `{ execution_id, nonce, ciphertext }`, where `nonce` and `ciphertext` carry the sealed refresh report, and it answers 204.
- The plaintext of the report is `{ credential_id, digest, credential }` for a server-held credential, or `{ credential_id, digest, sealed }` for an instance copy. For an instance copy, the worker unit seals the refreshed credential to the instance key through `sealed_credentials`. `digest` is then the digest of the stored sealed object. The application calls it after each refresh that pi-ai performs and once at the release.
- The credential report request body permits at most 65,536 bytes; [Custody's serialized-credential budget](custody.impl.md#serialized-credential-budget) ensures the compact report fits. The application reports once at release even when the credential is unchanged.
- For both operations, the invocation chain proves the execution that the body field `execution_id` names.
- The application discards every credential when the execution ends, and it writes none to a file.
- A platform action runs through the action performer of the server.
- The `worker` application takes the `client_secret` of each binding from the sealed connection answer of [The instance exchange](#the-instance-exchange). It reads no `client_secret` from a file, an environment variable or an option.
- The `worker` application holds no `master_key`.
- At the `server` and the `container` placements, the pool host derives the `client_secret` of the slot. The slot driver delivers it to the instance once at the start. The `thread` driver puts it in `workerData`. The `container` driver sends it in the `init` frame. The worker unit holds no `master_key`.
- A `client_secret` that belongs to another machine JWT fails every decryption. The application ends the execution as a cannot-progress condition.
- A handover envelope that the handover key does not open ends the execution with `worker.handover.decryption_failed`.
- In server and container placements, custody refuses a handover of a revision with an OAuth refresh in flight, and the handover pins nothing. [The OAuth refresh of a check](llm.impl.md#the-oauth-refresh-of-a-check) rules the refusal.
- The handler then waits until the refresh ends and runs the handover again. The wait ends 5 s before the 30 s route timeout of `worker.handover`, so the handler answers before the route timer.
- When the refresh does not end in the wait, the handler answers 503 `worker.handover.refresh_in_flight`. The refusal is retryable, and nothing commits after the answer.
- The worker application retries a `worker.handover.refresh_in_flight` answer with a new key, with the backoff of an indeterminate result, until the claim expires. It does not retry another 503 or a 504.

## The SSH signature relay

The relay lets a worker unit authenticate a git operation with an SSH key that only the server holds.
The worker unit uses it for each repository binding whose SSH identity the handover does not carry.
The relay serves only the `worker` placement, and the `server` and `container` placements keep `ssh_identities` in the handover.

- The worker unit serves a private agent socket for one git operation, in `TMPDIR` under the path rule of the [Repository implementation](repository.impl.md#the-ssh-identity). `src/repository/ssh-relay-agent.ts` serves the socket.
- The socket answers `SSH_AGENTC_REQUEST_IDENTITIES` with `ssh_public_key` of the execution setup.
- It relays `SSH_AGENTC_SIGN_REQUEST` to `worker.ssh.sign`, and it answers `SSH_AGENT_FAILURE` to every other message.
- It answers `SSH_AGENT_FAILURE` to a sign request for another key and to each failure of the relay. git then fails with `repository.connector.git_failed`.
- The socket records the last relay error. The cause of `repository.connector.git_failed` appends the line `ssh relay: <code>: <message>` and holds that error as its own cause.
- It closes a connection on a frame of 0 bytes or of more than 262,144 bytes.
- OpenSSH sends the extension `session-bind@openssh.com` first. The answer `SSH_AGENT_FAILURE` to it is not fatal, and OpenSSH continues with the sign request.
- The socket ends with its git operation. The end cancels each relay call in flight.
- `worker.ssh.sign` is a `client` secret mutation of `unary` lifetime that requires a live execution.
- Its body is `{ execution_id, nonce, ciphertext }`. The plaintext is `{ binding_id, data, flags }`.
- `data` is the base64 of at most 8,192 bytes. `flags` is an unsigned 32-bit value. The body permits at most 16,384 bytes.
- `src/apps/worker/ssh-relay.ts` seals each request of the worker unit and opens each answer.
- The answer is `{ nonce, ciphertext }`. The plaintext is `{ signature }`.
- The keys come from HKDF of `client_secret` with the info `ssh-sign/worker-to-server/v1` and `ssh-sign/server-to-worker/v1`.
- The AAD is the length-prefixed execution identity followed by the length-prefixed runtime identity.
- A repeat of an idempotency key answers 409 with no answer.
- A sealed request that does not open, or a plaintext that does not match the schema, answers 400 `worker.ssh.sign_invalid`.
- A worker binding of the execution that is not at the `worker` placement answers 403 `worker.ssh.placement_refused`, before the request opens. `details.placement` is `server`, `container` or `null`.
- The server authorizes the `ssh_identity` grant for a repository binding of the pinned node revision, and it pins the credential revision, under [custody.impl.md](custody.impl.md#the-release-of-an-ssh-key).
- The server signs only a user-authentication request for that key, with the user name `git` and the method `publickey` or `publickey-hostbound-v00@openssh.com`.
- For the host-bound method, the server host key in the signed data equals the pinned host key of the repository host.
- Another payload answers 400 `worker.ssh.sign_refused`. `details.reason` is `not_user_authentication`, `key_mismatch` or `host_key_mismatch`, a closed enum in code.
- The server signs with ed25519 and ignores `flags`. It drops the key material. It logs the execution, the binding, the credential, `client_id` and `instance_id`.
- `RepositoryComponent.sshSignatureOf` in `src/repository/index.ts` checks the payload with `src/repository/ssh-sign.ts`. After the check, it releases the key through custody and signs.
- During a live claim, the holder of the client token and the `client_secret` can authenticate as the deploy key. The reach ends with the claim.
- Tests cover the socket protocol, each refusal reason, another binding, another placement, an execution with no live claim and a replay with 409.
- Plain `git` and OpenSSH push and fetch through the relay against `src/repository/test-sshd.ts`, and once against the live repository host.
- The tests check that the repository key type is ed25519, or that the relay supports the sign flags `rsa-sha2-256` and `rsa-sha2-512`.

## Evidence upload

The `worker` application serves `evidence upload` locally for a file on its host.
The server and the harness extension serve the same helper on their own hosts.
The helper safely opens the path inside the execution workspace.
It refuses path traversal, symbolic-link escapes and path replacement races.
A refused path answers `worker.evidence_upload.path_refused`, whose `details.reason` is `outside_workspace`, `symbolic_link`, `not_regular` or `replaced`.
It calls `mission.evidence.submit` with execution context, the evidence metadata and the asset list, where the file is an `object` asset with its size, media type and optional SHA-256.
It sends the file directly to the presigned PUT destination of that asset, then calls `mission.evidence.asset.complete`.
A failed transfer goes to `mission.evidence.asset.complete`, and its check records the binding as failed.
The helper then submits again, and the server grants the next binding.
A file above the size limit answers `worker.evidence_upload.transfer_failed`, and its message holds no URL and no header.
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

## The coder flow

The steps method of `coder@1` on an `implement` node runs only coding turns of the agent. `src/worker/unit/steps-implement.ts` holds the flow.

- A **unit** is one item of work with a work prompt and a list of verifications. Each task is one unit. A node with no task is one unit, the **node unit**, with the node identity as its id. `workUnitsOf` builds the list.
- The node unit holds the node content and the task list as its work prompt, and the node verifications as its commands. `nodeUnitOf` of `release-gate.ts` builds it.
- The shipped `work` template starts the work prompt of a task with `# Node <name>` and the `Requirement` and the `Criterion` of the node. The line "Do only the task below. The node part above is context." follows.
- The task part then starts with `# Task <name>` and holds the task content. The work prompt of the node unit holds no node part.
- The node part is in the pinned work prompt, a user message. The system prompt holds no node part.
- A **turn** is one call of `prompt` or `instruct` on the agent: a work turn, a revision turn or a conflict turn. The execution runs no answer turn: no start-check judgement, no task judgement, no task choice and no repair turn.
- One `swe@1` session serves every turn of the execution.

The flow of one execution:

1. Read the pinned revision. Read the verdict or the cleared assessment under [The unblock reads](#the-unblock-reads).
2. Prepare each checkout under [Workspace](#workspace), then run the restore sequence of [Gate G](#gate-g) to the head that the checkout step read.
3. Open the `swe@1` session.
4. Run merge step M under [The base merge](#the-base-merge).
5. Plan the units under [The done record](#the-done-record) and [The verdict unit](#the-verdict-unit).
6. For each pending unit, in plan order: check the claim, run a work turn or a revision turn, run gate G in write mode, apply the progress rule, verify the unit in the live checkout, run the restore sequence, and write the done record on a pass. A code failure sends a revision turn.
7. Run the verdict unit when step 5 planned one.
8. Run [The release gate](#the-release-gate). A routed failure goes back to step 6 with one unit.
9. Push the node branch of each checkout. The push is not forced.
10. Submit the head commit of each checkout as one evidence, in binding order.
11. Release with `further_work: false`.

The progress rule:

- `changed` from gate G is the only measure of progress. A worker commit alone is not progress.
- The unchanged-turn counter `unchangedTurns` lives in the state of the execution.
- A revision turn with `changed` false adds one. A verdict turn that leaves the verdict rule false adds one.
- A turn with `changed` true sets the counter to zero. No other event sets it to zero.
- At `NO_PROGRESS_LIMIT` (2), the execution stops with `no_progress` before the next verification.
- The stop `detail` names the rule that fired and its counts, as a JSON object:
  - `rule` is `unchanged_revision` for a revision turn with `changed` false, or `verdict_rule_unmet` for a verdict turn that leaves the verdict rule false.
  - `count` is the counter at the stop, and `limit` is `NO_PROGRESS_LIMIT`.
  - `verification` is the last verification of any unit of the execution, or `null` before the first verification. It holds `passed`, `ran` (the count of commands that ran), `exit_code` (the exit code of the last command that ran) and `timed_out`. `exit_code` is `null` when the command has no exit code or no command ran. `timed_out` is true when the last command that ran reached its command limit, and false otherwise. A verification stops at the first command that does not pass, so these facts keep a fixed size.
- The `worker.task` span that the stop ends carries `kanthord.stop.reason`, `kanthord.stop.rule`, `kanthord.stop.count`, `kanthord.stop.limit` and, after a verification, `kanthord.stop.verification.passed`.
- A work turn with `changed` false adds nothing. The verification of the unit decides.

## The further-work release

- A budget end always releases with `further_work: true`. Only the release gate releases with `further_work: false`.
- At a budget end, the execution aborts the agent, removes the release clones, runs gate G in checkpoint mode under the cleanup deadline, pushes and releases.
- The budget-end release sends the stop `{ reason: "budget_end", code, cause }` when no unit completed in the execution. `code` names the limit that ran out: `turns` or `wall_time`.
- A unit completed when the execution wrote a new done record for it and step 5 found no record for it. A pass of the verdict unit, or of the node unit with the cleared text, always counts as completed.
- A violation that the checkpoint gate of a budget end finds stops the execution with that violation, not with the budget end.

## The base merge

Merge step M brings `origin/<base_branch>` into the node branch of each checkout. `refreshAtClaim` of `src/worker/unit/base-refresh.ts` runs it at the start, and `refreshAtRelease` fetches the base and runs it again in the release gate.

- When `origin/<base_branch>` is an ancestor of `HEAD`, the step does nothing.
- Otherwise the step runs `git merge --no-edit --no-ff --message <merge message> origin/<base_branch>`. The merge message comes from [Commit attribution](#commit-attribution).
- A merge with no conflict ends the step, and the merge commit is the new head.
- A conflict sends one conflict turn with the `conflict` template: the binding, the directory, the base branch and the unmerged files. The template states that the worker commits.
- Gate G then runs in conflict mode with the merged commit and the unmerged files of the step.
- The step logs `base merged` with the binding, the base branch, the head and the conflict count.
- A budget end during the conflict turn ends the step. The checkpoint gate aborts the merge.

## Gate G

Gate G is the worker step after every agent turn. `src/worker/unit/turn-gate.ts` holds it.

- `gatedAgent` wraps `prompt` and `instruct` of the agent of the steps method. The wrapper records `before`, the head of each checkout, runs the turn, then runs the gate. A new call site cannot skip it.
- The wrapper skips the gate when the budget ends inside the turn. The checkpoint gate of the budget end then runs.
- Modes: `write` after a work turn or a revision turn, `conflict` after a conflict turn, `checkpoint` at a budget end or a stop. No other mode exists.
- Every git command of the gate runs under the cleanup context of the budget, bounded by `expired_at`.
- Every git command of the worker runs under `isolatedGitEnvironment` of `src/kernel/git-environment.ts`. `ISOLATION` sets `GIT_CONFIG_COUNT` 3: `core.excludesFile`, `core.attributesFile` and `core.hooksPath`, each `/dev/null`. No hook of the target repository runs.

The steps for each checkout:

| #   | Mode       | Check or act                                                                                                                                                                          |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0  | checkpoint | When `MERGE_HEAD` exists, run `git merge --abort`.                                                                                                                                    |
| G1  | all        | `git symbolic-ref -q HEAD` is `refs/heads/<node branch>`. Else `worker.turn.branch_changed`.                                                                                          |
| G2  | all        | `before` is an ancestor of `HEAD`. Else `worker.turn.history_rewritten`.                                                                                                              |
| G3  | conflict   | `MERGE_HEAD` is the commit that step M merged. Else `worker.turn.merge_missing`.                                                                                                      |
| G3  | all        | No `rebase-merge`, `rebase-apply`, `CHERRY_PICK_HEAD` or `REVERT_HEAD`, and no `MERGE_HEAD` outside conflict mode. Else `worker.turn.git_in_progress`.                                |
| G4  | all        | When `HEAD` is not `before`, run `git reset --soft <before>`.                                                                                                                         |
| G5  | all        | Stage with `git add --all`. A path whose only change is a line-ending conversion is unstaged. `changed` is true when the stage differs from `HEAD`, and always true in conflict mode. |
| G6  | conflict   | Scan only the unmerged paths of step M with `git grep --no-index -l -E '^(<{7}\|>{7})( \|$)'`. A match aborts the merge and stops with `worker.merge.markers_left`.                   |
| G7  | all        | Commit when `changed` is true, with the message of the unit. In conflict mode, commit to conclude the merge. Make no empty commit outside conflict mode.                              |
| G8  | all        | Read `HEAD` into `checkout.head`. Assert invariant I.                                                                                                                                 |
| G9  | all        | With two or more checkouts, remove each entry of the agent root that is not a checkout or `.kanthord-scratch`. Log `root entries removed` with the names.                             |

- Invariant I: the checkout is on `refs/heads/<node branch>`, `HEAD` equals `checkout.head`, the index matches `HEAD`, no untracked file exists apart from ignored files, and no git operation is in progress.
- A turn with `changed` true sets the unchanged-turn counter to zero.
- The gated agent keeps the set of commits that its gate made. [The done record](#the-done-record) reads it.

The violation path:

- A failure of G1, G2 or G3 runs the restore sequence to `before` on every checkout and logs `turn violation` with the code and the detail.
- The detail names the checkout and the cause, and passes through `reasonOf`, so the redaction of `redactReason` applies.
- In write mode, in conflict mode and in the checkpoint of a budget end, the gate stops with `operation_failed`, the code and the detail.
- In the checkpoint of a stop, the gate restores and commits nothing. The stop keeps its own reason.
- The stop path skips the checkpoint after a violation stop and pushes the node branch at `before`.

The restore sequence brings a checkout back to invariant I from any state. `restoreCheckout` runs it:

1. For each operation whose state exists, run `git rebase --quit`, `git am --quit`, `git cherry-pick --quit`, `git revert --quit` or `git merge --abort`.
2. Run `git checkout --force -B <node branch> <target> --`.
3. Run `git reset --hard HEAD` and `git clean -ffd`.
4. Assert invariant I.

The target is `before` in the violation path, the head of the checkout step in prepare, and `checkout.head` after each live verification. Prepare keeps its `git clean -ffdx` on a branch switch under [Workspace](#workspace).

## The done record

- Format: the trailer `Kanthord-Done: <unit id> <digest>`.
- Digest: `digest` of `src/kernel/json.ts`, the SHA-256 hex of the canonical JSON with sorted keys, of the content of the unit. For a task, the content is the task content. For the node unit, the content is the node content.
- Write: after a unit passes its live verification, `writeDoneRecord` takes each checkout whose head is in the commit set of the gated agent of that unit run. It runs `git commit --amend --no-edit --trailer "Kanthord-Done: <id> <digest>"` on it and reads `HEAD` again. It logs `done recorded`.
- A unit run whose gate made no commit writes no record and logs `done record skipped`.
- Read: `readDoneRecords` runs `git log --format=%(trailers:key=Kanthord-Done,valueonly) origin/<base_branch>..HEAD --` in each checkout and takes the union.
- A unit is done when a record matches its id and its current digest. A revision that changes a task content reopens only that task.
- Only the worker writes the trailer. G4 removes the messages of agent commits.
- The amend targets only a commit of the current unit run, which no push holds yet, because the execution pushes only at the finish and at a stop.
- The record lives in the pushed branch, so a fresh clone on another host reads it.
- Correctness rests on the release gate. The records only save turns.
- The planning logs `units planned` with the head set and the pending unit ids.

## The release gate

`releaseGate` of `src/worker/unit/release-gate.ts` is the only entry to `further_work: false`.

1. `refreshAtRelease` fetches the base of each checkout and runs merge step M. A budget end ends the gate.
2. `verificationCommands(revision)` gives the node commands, then the commands of each task in plan order. `commandOwners` gives one owner for each index: the node unit for a node command, the task for a task command.
3. The gate removes `workspaces/<node identity>/release/`, then builds one clone for each checkout in the layout of the agent root under it. For each checkout it runs `git clone --local --no-checkout -- <live checkout> <dir>`, fetches `+refs/remotes/origin/*:refs/remotes/origin/*` from the live checkout with `--prune --no-tags`, sets the `origin` URL to the repository address, and runs `git checkout --detach <checkout.head>`.
4. It runs the commands at the agent root of the clones with the runner of [The verifications](#the-verifications), under the wall deadline, with no rerun of a code failure.
5. It removes the release directory after the run, in a `finally` block, so a budget end and a stop also remove it.
6. A budget-end class ends the gate with a budget end. An infrastructure failure stops the execution.
7. When a command fails, the owner of the first failed index gets one revision turn with the `task-revision` text of the failure. The flow logs `release failure routed` and runs that unit, then comes back to step 1.
8. When every command passes, the gate runs [the affected test run](#the-affected-test-run) of each checkout in its release clone. The release clone holds `refs/remotes/origin/*` of the live checkout, and the base check uses `state.base`.
9. The verdict `failed` gives the node unit one revision turn with the `task-revision` text of the affected failure. The flow logs `release failure routed` and runs that unit, then comes back to step 1.
10. When each verdict is `passed`, `base_red` or `absent`, the gate logs `release verified` with the affected verdict, and the flow goes to the push.

- The release gate compares no trees. The verdict rule applies at the unit level.
- A failure of the release gate never resets the head.
- The live checkout stays the place of the unit loop, so installed dependencies persist between turns.

## The verdict unit

The verdict is the latest review that asks for more work. `readPrior` of `src/worker/unit/node-reads.ts` reads it, under [The unblock reads](#the-unblock-reads).

- A verdict holds a text and a judged commit for each binding that the review saw.
- The judged commit of an assessment is the commit of each `repository` address of its `tested_input`. The judged commit of change requests is the `commit_id` of the latest change request of each binding, by `submitted_at`.
- `judgedCheckouts` keeps a judged commit only when the checkout holds it and it is an ancestor of `HEAD`. It logs `judged commit off the node history` for each other one.
- The verdict rule holds when at least one kept checkout gives a nonempty `git rev-list --first-parent --ancestry-path --no-merges --max-count=1 <judged commit>..HEAD`. A merge commit never satisfies the rule. `verdictRuleHolds` of `src/worker/unit/verdict-rule.ts` checks it.
- At planning, a verdict whose rule holds plans no verdict unit. Any other verdict plans the node unit with the `criterion-revision` text of the verdict, after the pending units. The planning logs `verdict planned`.
- With no kept judged commit, the verdict unit has no rule, and its verification decides.
- While the rule fails after a verdict turn, the turn counts as unchanged, and the same instruction goes again. The flow logs `verdict rule checked` after each turn.
- When the rule holds, the flow runs the node verifications. A failure sends the `task-revision` text.
- A cleared assessment that is not `success` plans the node unit with its rationale as plain instruction text, with no rule. A pass completes the unit.
- No substring of a verdict routes work to a task.
- A pass of the verdict unit counts as completed, also with no new done record.

## The unblock reads

- At the start of the steps method on an `implement` node, the execution reads the verdict. The rework assessment of the attempt, from `mission.execution.rework_assessment.get`, comes first. Its rationale is the verdict text.
- With no rework assessment, an execution of attempt 2 or later reads `mission.execution.clearedOutcome.get`.
- When the cleared outcome has the closing event `external-failed`, the execution reads `worker.execution.change_request.get`.
- `worker.execution.change_request.get` is an API-only `client` read of the Worker Service. It reads the external actions of the cleared attempt.
- For each `pull_request` action with the resolution `other-end`, the read calls `intake.action.read` through the direct adapter. It uses the method `github-pull-request-change-request-get` and the request evidence of that action.
- Each item of `worker.execution.change_request.get` holds `binding_id`, the repository binding of its `pull_request` action.
- The execution writes the change requests into one requested-changes text. The text holds the reviewer, the commit and the body of each change request, and it names the repository binding of each change request. It also holds the path, the line and the body of each review comment of that change request.
- The requested-changes text stops at 4 KiB.
- The requested-changes text is the verdict text. It enters [The verdict unit](#the-verdict-unit).
- When the read finds no current change request, an execution of attempt 2 or later reads `mission.execution.cleared_assessment.get`. A cleared assessment that is not `success` gives its rationale as plain instruction text.
- A change request routes no task. The verdict unit sends the whole text to the agent, and the verdict rule keeps an unchanged head from the next review.
- A platform failure of the read answers 502 `repository.platform.github.<class>`. The execution stops with `operation_failed` and that code.

## The verifications

The verification run follows [mission-service.impl.md](mission-service.impl.md#the-verifications).
That run starts at the agent root of the execution workspace, not at the server's `workspaces/` directory.
A node with two or more repository bindings uses one subdirectory for each binding under the layout rule of [worker-service.md](worker-service.md#executions).
A test checks the [host requirements](repository.impl.md#repository-connector) and the shared verification run mechanism.
A test checks base-branch heads and one tested commit per binding for an `examine` node with two repository bindings.
A test checks the evidence-placement rule for an `examine` node that names no repository binding.
A test checks that the reviewer of an `examine` node with one repository binding places the produced evidence in the `evidence` directory of the workspace.
A test checks the same for an `implement` node with an evidence snapshot.
Both tests check that each checkout stays clean and that each asset path is relative to the agent root.
A test checks one checkout per binding, one tested commit per binding and the stop with `operation_failed` on an evidence snapshot that misses a binding, for an `implement` node with two repository bindings.
Tests prove that execution code, never the agent, runs verifications before judgement.
The runner classifies each command result. The first matching rule decides: a spent budget, a kill at the wall deadline or no start before the deadline is a budget end; a kill at `COMMAND_LIMIT_MS` (`timed_out: true`) or a cancellation is a code failure; a spawn error, a signal or an exit code from 129 to 192 is an infrastructure failure; exit code 0 is a pass; exit code 127 follows [the environment classification](#the-environment-classification); any other exit code is a code failure.
At the release gate and at the evaluation of an `implement` node, [the affected test run](#the-affected-test-run) follows only after every listed verification passes.
An infrastructure failure runs once more, unless the deadline passed or the context ended. The rerun result takes the same rules, and a pass on it is a pass.
A second infrastructure failure stops the execution with `operation_failed`, the code `worker.verification.infrastructure_failed` and a detail with the JSON of the exit code, the signal, `timed_out` and the command. `infrastructureStop` builds it. The coder and the reviewer apply these rules.
Reviewer tests assert a failed assessment without judgement for a failed or unrun verification; the rationale names that verification.
The reviewer reruns a code failure up to 2 times on the same commit, unless the item timed out. The item still fails. The coder runs no rerun of a code failure.
When a rerun passes, the rationale states that the test is flaky. The rationale carries the output of the failed run.
The review bundle holds `added_files`: the files that each evidenced commit adds against `origin/<base branch>` of its binding. An `examine` node has none.
Each `added_files` path is relative to the agent root. With two or more repository bindings, each path has the form `<binding name>/<file>`.
The review bundle also holds `changed_files`: every file that the change adds, modifies or deletes against `origin/<base branch>`, sorted. `modifiedFiles` reads it with `git diff --name-only -z --no-renames <base>...HEAD --`. Each path has the same prefix as an `added_files` path. An `examine` node has none.
The reviewer judges the scope of the change from `changed_files`, not from the state of the workspace. A changed file that the requirement forbids is an unmet stated item. The exception is a change that correct work needs for a criterion, a verification or an affected test.
Tests require a reviewer to judge the assets that the evidence still holds.
Steps tests revise after a failed verification within the resource budget, commit anew and rerun the verifications.
Budget-end tests release with further work at every budget end, a budget end during a verification and during the release gate included.
Steps tests skip each unit whose done record matches, also on a fresh clone, and run a work turn for every other unit, also when its verifications pass on the base.
Steps tests run an `implement` node with no task as one work unit, with the node verifications, under the node identity as the done-record id.
Steps tests count zero answer turns in an `implement` execution.
Steps tests with two repository bindings commit only the checkouts with a change.
They merge every checkout before a release in the release gate, and route a failure of the release gate to the owner of the first failed command.
They push every node branch before the evidence, and they submit one evidence with one asset per binding.
Steps tests on an `examine` node check out each base-branch head, create no node branch, make no commit and push nothing.
Restart tests check out `origin/<base branch>` for an attempt whose claim names `kanthord/<node id>-a<k>`, push that branch and leave the head of the earlier node branch unchanged.
Tests check out `origin/kanthord/<node id>-a<k>` for a later attempt that continues it, and merge the moved base.
Missing-branch tests delete a pushed node branch at the remote and assert `repository.node_branch.missing`, an unchanged checkout and a second refusal. They assert the same refusal for a fresh workspace with repository evidence of the attempt. They assert a start from the base branch for a first execution and for an attempt with the start point `base_branch`. A test asserts that a prepare keeps an unpushed local commit when the remote node branch is missing and no record shows a push.
Tests assert that a branch switch removes `.kanthord-scratch/` and an ignored file, and that a checkout of the same branch keeps them.
Rework tests assert that a verdict with no task id still runs a verdict turn, that an unchanged verdict ends with `no_progress`, and that a base move gives no new work under the verdict rule.
Tests assert that the action performer does not reuse an open pull request of the earlier node branch, and that an attempt that continues its branch reuses its own pull request.

## The environment setup

- The execution setup answers `environment` for each repository binding of the node, from the current revision of that binding at the claim: `{ source: "stored", document, digest }`, `{ source: "repository", digest }` at the `container` placement, `{ source: "detected" | "universal", document, digest }` at the `image` target, or null.
- `digest` is the current digest of the group in the [Onboarding component](project-service.impl.md#the-digest-and-the-tag).
- `worker/unit/environment-setup.ts` runs the setup of each checkout: each script of `updateContentCommand`, then each script of `postCreateCommand`. The object form runs its values one after another in key order.
- The setup runs at the prepare, in each release clone, in the reviewer checkouts and in the examine checkouts.
- Each command has the command limit of a verification, and the setup uses the wall deadline of the execution. Its time counts toward the budget of the execution.
- At the `server` and the `worker` placements, only the setup commands of a stored environment run. The repository devcontainer reaches the worker only at the `container` placement, and the worker reads it at `origin/<base branch>` of its checkout. A non-regular entry counts as absent.
- After a setup passes in a checkout, the worker appends each untracked path to `.git/info/exclude`, so no task commit takes the setup output.
- A setup that changes a tracked file stops the execution with `environment_failed`, the code `setup_failed` and the paths in the detail, because KanthorD commits no change that the agent did not make.
- The setup writes only inside the checkout, `$HOME` and `/tmp`, because the slot root is read-only. A system install belongs in `onCreateCommand`, which runs at the build as root.
- Commands that a feature contributes do not run at the setup.
- Each verification span records `environment.digest`: the digest of the single repository binding of the node, or the digests of its repository bindings joined by `,` in binding order.

## The environment classification

- A setup failure on the node head reruns the setup on a base-head clone at `<node key>/base`. A failure there too, or a node head equal to the base head, stops the execution with `environment_failed` and the code `setup_failed`.
- A setup failure on the node head that passes on the base head is a code failure of the node unit. At the release gate it routes a revision to the node unit. At the prepare, the agent receives the setup output as its first revision instruction, and the setup runs again before the next verification.
- A verification with exit 127 reruns once on the base head, in the base-head clone after its setup. Exit 127 on both heads stops the execution with `environment_failed` and the code `command_absent`. Exit 127 on the node head only is a code failure.
- A base setup that fails stops with `setup_failed`. A base setup or a rerun that ends by the budget is a budget end.
- The worker caches the base result for the execution by the base commits, the environment digests and the command.
- The stop detail holds the JSON of the exit code, the signal, `timed_out`, the command and `digests`, the map from the resource identity of each repository binding of the node to its current digest at the setup, from `environmentDigestOf`. A binding with a null environment, for example the source `none` or a `server` placement with no stored environment, also takes its entry.
- An `environment_failed` stop never becomes a revision turn of `swe@1`.

## The affected test run

The worker runs the affected test command of each repository at each release gate and at each evaluation of an `implement` node.
The repository owns the map from changed files to tests, the selection and the test run. KanthorD runs one repository command, the affected test command.
KanthorD owns the change set, the run, the verdict, the evidence and the spans.
The worker enforces the verdict. The admission of the Mission Service does not change, under [Evidence content](mission-service.impl.md#evidence-content).

### The run points

| Point                                     | Affected run                                     | Verdict `failed`                                            |
| ----------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| Task verification after a turn            | No                                               | —                                                           |
| Release gate of an `implement` node       | Yes, after every listed command passes           | One revision turn of the node unit                          |
| Evaluation of an `implement` node         | Yes, after every listed command and setup passes | `criterion-not-met`, stage `affected`, before the judgement |
| Steps and evaluation of an `examine` node | No                                               | —                                                           |

- Only an `implement` node with a repository checkout runs the affected command.
- Each repository of a node runs its own command on its own change set. The commands run in checkout order, after the listed commands.
- The affected run keeps a listed test in its selection, so a test file can run twice.
- The wall budget of the execution covers the affected run.
- A node can edit its own selector so that it selects fewer tests. KanthorD accepts this limit, because the CI of the repository runs the whole suite before the landing.

### The command

- The worker reads [the affected test declaration](project-service.impl.md#the-affected-test-declaration) of each checkout at the base-branch head, at every placement. A node cannot change the command that judges it.
- A checkout with no declaration has the verdict `absent`.
- The worker runs `command` with `bash -c` in the checkout directory of the repository, at the node head. The command thus runs the selector code of the node head.
- The command runs under `time_limit_s` of the declaration and under the wall deadline of the execution.
- The child environment equals the environment of a verification, plus three variables:

| Variable                   | Value                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `KANTHORD_CHANGES`         | The absolute path of the changes file.                                                       |
| `KANTHORD_AFFECTED_REPORT` | The absolute path where the command writes its report. The file does not exist at the start. |
| `KANTHORD_BASE_COMMIT`     | The merge-base commit.                                                                       |

- The worker writes both files in `<workspace key>/affected/<binding name>/`, outside every checkout, with mode `0600`. It removes the directory after the run.
- With no `KANTHORD_CHANGES`, the command computes the change set from `origin/<base branch>` and the working tree, and it prints the report. The command thus also runs outside KanthorD.
- The worker computes the changed gate files of each repository with `changedGateFiles`. A changed gate file is a path of `gate_files` of the base declaration. It equals the `path` or the `previous_path` of an entry of the change set. The list holds each path once, sorted.

### The changes file

- The diff base is the merge base of the base branch and the node head.
- KanthorD computes `files` with `git diff --name-status -z --find-renames <base_commit> <head_commit>`.
- `status` is one of `added`, `modified`, `deleted` and `renamed`. A type change (`T`) reads as `modified`. A copy is not detected.
- A `renamed` entry holds `previous_path`.
- Each path is relative to the root of the repository and uses `/`.

```json
{
  "version": 1,
  "binding_id": "binding_01M5SQ3VMP6H1MR49ZHN0EKBDC",
  "repository": "engine",
  "base_commit": "f0d09a0cbb8f53f69a21d3163c4bd626b00026cf",
  "head_commit": "88e07e90b2f48caaeebcc7b010b5d6e3f5aed770",
  "files": [
    { "path": "src/tracking/contract.ts", "status": "modified" },
    { "path": "src/tracking/analytics-bucket.ts", "status": "modified" }
  ]
}
```

### The report

- The command writes one JSON report to `KANTHORD_AFFECTED_REPORT`. The exit code is the verdict of the selector, and it is 0 exactly when `failed` is empty.
- `selection` is one of `related`, `all` and `none`. When the map is unsure, the selector selects all tests in its scope.
- `reason` is a nonblank text of at most 256 bytes for `all`, and null otherwise.
- `tests` lists each selected test file. `none` requires an empty list.
- `failed` and `flaky` list test ids. A test id is `{ file, name }`. `name` is the full name of the test: the names of its suites and its own name, joined with a space, `>` and a space. A file that fails to load gives one id with the file path as its name.
- Each `file` of `failed` and `flaky` is in `tests`. `failed` and `flaky` hold no common id.
- The selector retries a failed test file once. A test that fails and then passes is flaky.
- The KanthorD selectors rerun the failed test files only when 8 or fewer files hold a failed id, the limit `RERUN_FILE_LIMIT`. With more files, the report lists every failed id in `failed` and an empty `flaky`.
- `excluded_e2e` lists each e2e test file that the selection reached and left out.
- The report is at most 1 MiB. Each list holds at most 10000 entries, and each text is at most 1024 bytes.
- KanthorD parses the report with a strict schema. A missing report, an invalid report, or an exit code that does not match `failed`, is an invalid report.

```json
{
  "version": 1,
  "selection": "related",
  "reason": null,
  "tests": [
    "src/tracking/analytics-bucket.test.ts",
    "src/tracking/service.test.ts"
  ],
  "failed": [
    {
      "file": "src/tracking/service.test.ts",
      "name": "a duration query holds a measure of the closed set"
    }
  ],
  "flaky": [],
  "excluded_e2e": ["src/apps/server/e2e-worker-host.test.ts"]
}
```

### The verdict of one repository

- KanthorD counts a flaky test as failed when its file is in the change set, and lists it in `promoted_flaky`. A flaky test in another file passes, and the report, the evidence and the span name it.

| Verdict    | Condition                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absent`   | The repository holds no declaration.                                                                                                                                                                    |
| `passed`   | Exit 0, a valid report, and no flaky test in a file of the change set.                                                                                                                                  |
| `failed`   | A valid report with a failed test id after the flaky rule, and no `base_red`. Also exit 127 at the head with a valid base report. Also an invalid report at the head, with a valid base result in time. |
| `base_red` | Valid reports at the head and at the base, and each failed test id of the head is a failed test id of the base.                                                                                         |

- `passed`, `base_red` and `absent` pass the release gate and go to the reviewer. `base_red` routes no revision and gives no `criterion-not-met`.

### The base check

- On a failure at the head, KanthorD runs the same command with the same changes file on the base head, in the base-head clone of [the environment classification](#the-environment-classification).
- An invalid report or exit 127 at the head first runs the base check. A valid base result in time gives `failed`.
- A time-limit end at the head runs no base check. It stops the execution under [the stops](#the-stops).
- After a test failure at the head, an invalid report or a time-limit end of the base run gives no `base_red`, and the head failure counts.
- KanthorD does not rerun the whole command after a test failure.
- A setup failure of the base-head clone stops the execution with `environment_failed` and the class `setup_failed`.

### The stops

| Condition                                                             | Stop                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Invalid declaration                                                   | `environment_failed`, class `affected_invalid`                                          |
| `time_limit_s` ends the command at the head                           | `environment_failed`, class `affected_timeout`                                          |
| No valid head report, and an invalid report at the base               | `environment_failed`, class `affected_invalid`                                          |
| No valid head report, and `time_limit_s` ends the command at the base | `environment_failed`, class `affected_timeout`                                          |
| The wall deadline ends the command                                    | The `budget_end` class                                                                  |
| A signal end, or an exit from 129 to 192                              | The `infrastructure` class: one rerun, then `worker.verification.infrastructure_failed` |
| No valid head report, and exit 127 at the base                        | `environment_failed`, class `command_absent`                                            |

- With no valid report at the head, the class of the base result decides the stop. An invalid report and exit 127 at the head are no valid report.
- `affected_invalid` and `affected_timeout` belong to `EnvironmentFailure`. The detail of a stop after the base check holds the binding, the commit of the base head, the command and the exit code. It also holds the parse error or the limit.
- The detail of a time-limit stop at the head holds `binding_id`, the head commit as `commit`, `command` and `time_limit_s`. `redactedDetail` keeps `binding_id` and `commit` of every affected stop detail and passes every other string value through `redactReason`.
- The release of the stop follows [the failure of an execution](project-service.impl.md#the-failure-of-an-execution). A new base commit, or a rebuild, opens the gate again.
- The existing limits stay: the `no_progress` rule of the unit loop, the wall budget and the rework limit of the Mission Service.

### The evaluation

1. The evaluation runs the listed commands and submits the evidence `Evaluation verification results`.
2. When the listed commands and the setup pass, it runs the affected command of each checkout. The change set comes from the snapshot checkout, with the base of `addedFiles` of `evaluation-input.ts`.
3. It submits the evidence `Affected test results`.
4. The verdict `failed` gives `criterion-not-met` with the stage `affected` and the affected failure report as the rationale. No agent judges it.
5. The verdicts `passed` and `base_red` go to the reviewer in the [evaluation prompt](agent.impl.md#prompt-templates).

- The assessment submit holds the changed gate files of each repository in `gate_files`, as `{ binding_id, paths }`. The evaluation omits the key when no gate file changed.
- `prepareEvaluation` excludes the evidence with the subject `Affected test results` from the support assets, from `snapshotOf` and from `placedOf`.
- The asset of the evidence follows [Evidence content](mission-service.impl.md#evidence-content). Its content is this canonical JSON:

```json
{
  "version": 1,
  "verdict": "failed",
  "repositories": [
    {
      "binding_id": "binding_01M5SQ3VMP6H1MR49ZHN0EKBDC",
      "repository": "engine",
      "command": "pnpm --silent run test:affected",
      "base_commit": "f0d09a0cbb8f53f69a21d3163c4bd626b00026cf",
      "head_commit": "88e07e90b2f48caaeebcc7b010b5d6e3f5aed770",
      "changed_files": 10,
      "verdict": "failed",
      "exit_code": 1,
      "signal": null,
      "duration_ms": 0,
      "report": {
        "version": 1,
        "selection": "related",
        "reason": null,
        "tests": ["..."],
        "failed": [
          {
            "file": "src/tracking/service.test.ts",
            "name": "a duration query holds a measure of the closed set"
          }
        ],
        "flaky": [],
        "excluded_e2e": ["..."]
      },
      "promoted_flaky": [],
      "base_run": {
        "commit": "f0d09a0cbb8f53f69a21d3163c4bd626b00026cf",
        "exit_code": 0,
        "failed": []
      },
      "output": "<the last 4 KiB>"
    }
  ]
}
```

- `promoted_flaky` lists each flaky test id that KanthorD counts as failed under the flaky rule.

### The revision text

The release gate renders `task-revision` with a rationale of this form:

```text
The affected test run of repository engine failed. KanthorD ran `pnpm --silent run test:affected` for 10 changed files. The run selected 177 test files, and 1 test failed: src/tracking/service.test.ts > a duration query holds a measure of the closed set. Each selected test imports a changed file directly or through other files. Change the code or the test so that every selected test passes.
```

The results hold the affected command with its exit code. The output is the last 4 KiB of the run.

The release gate renders `task-revision` with `release` true, for a failed listed command and for a failed affected run. The text then holds the sentence "The release clone holds only tracked files and the setup commands of the environment." A task revision in the node checkout renders `release` false.

Every `task-revision` text holds the sentence "When a verification or an affected test needs a change to a forbidden file, make the smallest such change." The release gate then passes, and the reviewer sees the forbidden file in `changed_files`. When correct work needs that change, the reviewer gives the ground `conflict`, and the node moves to `Blocked` with the rule `plan_defect`. A failure that a defect of the work causes stays a `stated` item. Only the reviewer assigns a plan cause. The coder writes no conflict note. A verification failure in the evaluation keeps the rework route with the suspects `model` and `plan`.

The spans of the affected run follow [tracking-service.impl.md](tracking-service.impl.md#the-affected-run-spans).

## Workspace

- The workspace root is `workspaces/` of the data directory that the wrapper gives the worker unit, under [The worker unit and its wrappers](#the-worker-unit-and-its-wrappers).
- The workspace of a steps execution on an `implement` node is `workspaces/<node identity>/`, keyed as [worker-service.md](worker-service.md#executions) states. Each checkout is `workspaces/<node identity>/checkouts/<binding name>/`.
- The agent root is the directory that the agent works from. It is the workspace for no repository binding, the one checkout for one repository binding, and `checkouts/` for two or more.
- The workspace of an evaluation execution and of a steps execution on an `examine` node is `workspaces/<execution identity>/`, with the same layout rule, and the Worker Service removes it at the release. An evaluation execution that checks out repositories also holds `workspaces/<execution identity>/evidence/`, beside `checkouts/`. This covers an `implement` node with an evidence snapshot.
- `.kanthord-scratch/` sits at the agent root. The preparation adds it to `.git/info/exclude` of each checkout, so a task commit never stages the scratch files of the agent.
- The preparation holds the node key once and prepares one checkout for each repository binding.
- The preparation reads the node branch from `node_branch` of the claim. `fetchAndCheckout` checks out the remote node branch when it exists. Else it checks out the local node branch without a reset when the workspace holds one, so that commits of a failed push stay. Else it checks out the base branch. It runs `git clean -ffd` when the workspace HEAD is on the node branch of the claim, and `git clean -ffdx` otherwise, so a branch switch also removes `.kanthord-scratch/` and the other ignored files of the earlier branch.
- Two records show an earlier push of the node branch. The first is the remote-tracking ref `refs/remotes/origin/<node branch>` of the node workspace before the fetch. The second is an evidence of the claimed attempt with a `repository` asset of the repository binding. The preparation reads that evidence through `execution.evidence.list`.
- When either record exists and the remote node branch is missing, `fetchAndCheckout` refuses with `repository.node_branch.missing` and keeps the checkout. The execution stops with `operation_failed` and that code.
- When the workspace holds the remote-tracking ref, `fetchAndCheckout` checks the remote node branch with `git ls-remote` before `git fetch --prune`. A refusal therefore keeps the ref, and the next execution refuses again.
- A first execution of a node branch has neither record and starts from the base branch. An attempt with the start point `base_branch` has a new node branch name, so a missing earlier node branch does not refuse it.
- A directory under the root holds mode `0700`, and the permissions audit of the start covers the root and no entry under it.
- The workspace retention period of [worker-service.md](worker-service.md#executions) is 7 days from the end of the last execution of the node.
- A sweep at the start and every hour removes an expired workspace.
- The workspace stays on the disk of the instance because an active workspace holds uncommitted work and unsubmitted evidence that a re-clone cannot rebuild.

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
A `kanthord` landing pull request action submits its request evidence. When `gate_files` of its action context entry is empty, the action performer then calls `intake.action.perform` once more with `merge_evidence_id` set to the evidence identity. The merge request key is `<node id>/<attempt>/<FrozenAction.key>/merge/<tested commit>`, for example `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/2/kanthord-repo.pull_request/merge/b4c5d6`. A failed merge changes no return item.

After the dispatch loop, the action performer calls `intake.action.perform` once per required `kanthord` landing pull request action whose request evidence has no end state. It skips an action whose `gate_files` is not empty.
It passes `merge_evidence_id` = that request evidence id and the new tested commit.
The request key is `<node id>/<attempt>/<FrozenAction.key>/merge/<tested commit>`.
A failed call changes no return item and logs a warning with the evidence identity.
`gate_files` of an action context entry holds the changed gate files of the binding in the current assessment of the attempt.
When a nonempty `gate_files` skips a merge, the action performer logs the warning "merge skipped: gate files changed" with `evidence_id` and `gate_files`. The pull request then waits for a human.

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
- Every client reaches the MCP server under the machine identity of its live registration, and the proof compares the registration for every client. A native agent at every placement has no other path.
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

[worker-service.md](worker-service.md#executions) requires that every commit of the execution is attributable to its task and its attempt.

- `src/kernel/commit-message.ts` builds every worker commit message and the pull request title of `src/intake/action-perform.ts`.
- `commit_type` is an optional closed enum on the node content: `feat`, `fix`, `docs`, `style`, `refactor`, `test` or `chore`. `commitTypeOf` gives `feat` when it is absent. The Mission Service validates it before the write, and the store keeps `null` when it is absent.
- The header is `<commit_type>: <subject>` with no scope. The subject of a task commit is the task `name`. The subject of a node unit commit and of a verdict commit is the node `name`. The subject of a merge commit is `merge <base_branch>`. The subject of a checkpoint commit is the `name` of the current unit. The pull request title uses the node `name`.
- The builder replaces each run of whitespace with one space, writes the first letter in lowercase, cuts the subject so that the header holds at most `COMMIT_HEADER_MAX_LENGTH` (100) characters, keeps a surrogate pair whole, and removes every final full stop and space.
- `isCommitHeader` checks `^(<type>)(\(<scope>\))?: \S.*$`, the length and the final full stop before each commit. A node or task `name` that gives no valid subject for some type fails the write with `mission.node.content_invalid` and `details.field` `name`.
- The body holds the unit id on its own line. The done record follows after a blank line. The worker writes no other trailer.
- Today the body names the unit and no attempt. The evidence of the attempt names the head commit.

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
- The stop `detail` holds the cause text or the JSON facts of the progress rule. In a cause text, `redactReason` removes the credential secrets read at the open and at the stop, bearer values, JWTs and tokens of 32 or more characters, keeps a file path, and cuts the text to 300 characters. The sources are:
  - the error text of a provider error reply, with `provider_failed`;
  - `<error name>: <message>` of an uncoded error that a prompt to the agent session or any step of the execution throws, with `operation_failed`;
  - the violation text of gate G, with `operation_failed` and the code `worker.turn.*`;
  - the JSON result of the command, with `operation_failed` and the code `worker.verification.infrastructure_failed`;
  - the redacted git stderr of a failed gate G commit, with `operation_failed` and the code `worker.git.commit_failed`;
  - the JSON facts of the progress rule, with `no_progress`. The JSON holds no text, and the worker does not cut it.
- A `CodedError` gives its code and no `detail`, except `worker.git.commit_failed`, which gives the redacted git stderr as `detail`. `budget_end` and `worker.merge.markers_left` carry no `detail`.
- A revision turn or a verdict turn that changes no file twice in a row stops the execution with `no_progress`, under the progress rule of [The coder flow](#the-coder-flow). The second unchanged turn runs no verification.
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
A credential report that the server refuses as ended also ends the execution as `revoked`. So does the claim read after a lost release answer. The refusal code is `gateway.invocation.execution_proof_failed` or `scheduler.execution.not_running`. After a refused credential report, KanthorD sends no release. The worker stays in its pull loop.
A pause of the node therefore stops a native execution within one agent turn.
On revocation or loss, the execution aborts its pi session and dispatches nothing after.
Abort does not prove that every descendant process stops.
The quiescence check before workspace reuse still needs a mechanism.
The [Repository implementation](repository.impl.md#repository-connector) states the transport's process-cancellation limit.
The execution enforces the turn budget on pi turn events and aborts the agent when either budget ends.
An agent that reaches its wall-time deadline ends the wall-time budget of the execution. The execution then takes the budget end, not a failure.
The bash timeout of an agent command stays below the remaining wall-time budget and below the 10-minute command limit of a verification item. A lower timeout that the model sets stays.
After the agent stops at budget end, the execution code, not the agent, runs gate G in checkpoint mode, pushes and releases with further work.
Every budget end releases with further work. Only the release gate releases with no further work.
Every cleanup command, including the push, is bounded by `expired_at`, not by the remaining budget.
A stop for a reason other than `revoked` aborts the agent and runs the same cleanup under a fresh context bounded by `expired_at`.
A steps execution runs gate G in checkpoint mode, which commits the uncommitted work, pushes and releases with `further_work: true` and `stop: { reason, code, detail?, cause }`.
After a violation stop of gate G, the execution makes no checkpoint commit and pushes the node branch at `before`.
A failed checkpoint or push of a stop logs `checkpoint failed` with the redacted reason.
A reviewer execution writes no commit and releases with the `stop` only.
A failed push still releases with the `stop`, and the next execution starts from the pushed head.
A failed release ends the execution with no release, and the loss settlement routes the node.
A reply with no valid marker line gets one repair turn, for the evaluation judgement and the review reply of `reviewer@1`.
The repair instruction is `The reply holds no valid <marker> line. Reply again with exactly one such line.`
A second invalid judgement stops the execution with `judgement_invalid`, and a second invalid review reply ends the review of that task.
The steps method of `coder@1` parses no reply on an `implement` node.
Tests stop a steps execution with each reason and assert the checkpoint commit, the push and the release with the `stop`. Tests stop a reviewer execution and assert the release with the `stop`. Tests send one invalid reply and assert the repair turn, and send two and assert the stop.

### The cause of a stop

The cause names the layer that caused a failure event. `src/worker/unit/execution-run.ts` computes it.

- The worker computes the cause at record time from the stop code, the git step, the verification class and the stop detail. It hands the cause in `ExecutionStop.cause`. A stop with no cause gives `unattributed` with no suspects.
- A cause holds `category`, `assigner`, and either `subcategory` or `suspects`. The rows of a recorded ground take the assigner `reviewer`. Every other row takes `rule`. The [closed sets](tracking-service.vocabulary.md#cause-category) live in the Tracking vocabulary.
- A rule assigns a category only when a recorded code names the cause. Otherwise the cause is `unattributed`, with the `assigner` `rule` and the `suspects`, the best guess first.
- The first matching row of the table decides.

| Stop reason or signal                     | Code or evidence                                                         | Cause                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `provider_failed`                         | `rate_limited`, `quota_exhausted`, `unavailable`                         | `llm_provider.<code>`                                              |
| `provider_failed`                         | `unauthorized`                                                           | `human.configuration`                                              |
| `provider_failed`                         | `bad_request`                                                            | `unattributed`, suspects `worker_action`, `prompt`, `llm_provider` |
| `environment_failed`                      | `setup_failed`, `command_absent`, `affected_invalid`, `affected_timeout` | `environment.<code>`                                               |
| failed `worker.git` step                  | `fetch_base`, `push`                                                     | `unattributed`, suspects `infrastructure`, `worker_action`         |
| failed `worker.git` step                  | `merge_base`                                                             | `unattributed`, suspects `worker_action`, `environment`            |
| `operation_failed`                        | `worker.verification.infrastructure_failed`                              | `infrastructure.verification_killed`                               |
| `operation_failed`                        | prefix `project.binding.`                                                | `human.configuration`                                              |
| `operation_failed`                        | `worker.git.commit_failed`                                               | `unattributed`, suspects `worker_action`, `environment`            |
| `operation_failed`                        | a `worker.turn.*` code, `worker.merge.markers_left`                      | `unattributed`, suspects `model`, `prompt`                         |
| `operation_failed`                        | other `worker.*` code                                                    | `unattributed`, suspects `worker_action`, `infrastructure`         |
| `operation_failed`                        | prefix `gateway.`, or no code                                            | `unattributed`, suspects `infrastructure`, `worker_action`         |
| `no_progress`                             | the last verification of the stop detail holds `timed_out: true`         | `unattributed`, suspects `environment`, `plan`                     |
| `no_progress`                             | other                                                                    | `unattributed`, suspects `model`, `prompt`, `plan`                 |
| `budget_end`, `assessment_absent`         | the last verification of the stop detail holds `timed_out: true`         | `unattributed`, suspects `environment`, `plan`, `model`            |
| `budget_end`, `assessment_absent`         | other                                                                    | `unattributed`, suspects `plan`, `model`                           |
| `judgement_invalid`, `report_absent`      | any                                                                      | `unattributed`, suspects `model`, `prompt`                         |
| `action_unsettled`                        | any                                                                      | `unattributed`, suspects `worker_action`, `infrastructure`         |
| `criterion-not-met`, stage `setup`        | none                                                                     | `unattributed`, suspects `environment`, `model`                    |
| `criterion-not-met`, stage `verification` | [class](#the-verifications) `code_failure`                               | `unattributed`, suspects `model`, `plan`                           |
| `criterion-not-met`, stage `affected`     | any                                                                      | `unattributed`, suspects `model`, `plan`                           |
| `criterion-not-met`, stage `judgement`    | an unmet ground `conflict`                                               | `plan.requirement_conflict`                                        |
| `criterion-not-met`, stage `judgement`    | an unmet ground `unstated`                                               | `plan.criterion_unstated`                                          |
| `criterion-not-met`, stage `judgement`    | first unmet ground `stated`                                              | `model.work_defect`                                                |
| `criterion-not-met`, stage `judgement`    | first unmet ground `standard`                                            | `model.standard_violation`                                         |
| none of the above                         | none                                                                     | `unattributed`                                                     |

- The stop classes `affected_invalid` and `affected_timeout` take the cause `environment.<code>`, as `setup_failed` and `command_absent` do.
- A verification that fails and then passes at the same commit gets no environment cause. The workspace can differ between the two runs.
- The reviewer execution computes the cause of a `criterion-not-met` assessment with the `criterion-not-met` rows. It hands that cause with the assessment submit. The Scheduler writes it on the root span end of that execution, as for a stop.
- The `worker.evaluation` span keeps the facts: `kanthord.evaluation.stage` (`setup`, `verification`, `affected` or `judgement`) and `kanthord.evaluation.unmet_grounds`.
- Each unmet item of the judgement holds the required field `ground`: `stated`, `standard`, `unstated` or `conflict`. A reply with no `ground` goes through the repair turn.
- A `conflict` item names two stated requirements or criteria that the work cannot meet together. Its reason quotes both as `"A" vs "B"`. For example, correct work fails a criterion, a verification or an affected test unless it changes a file that the requirement forbids. A failure that a defect of the work causes is no conflict and stays a `stated` item.
- A `conflict` ground decides over an `unstated` ground. An `unstated` ground decides over `stated` and `standard` grounds, in any position. Otherwise the first unmet ground decides.
- `judgementRationale` appends up to three blocks to the rationale and omits an empty block. The order is `Plan conflict:` for the `conflict` items, `Plan gap:` for the `unstated` items and `Unmet:` for the other items.
- The Scheduler assigns the cause of `lost` and `revoked`, as [The execution trace](scheduler-service.impl.md#the-execution-trace) states.
- Tests assert one cause for each row, and the `timed_out` suspects of a `no_progress` stop and of a budget end.

## Trust boundary

The operator provides the trust boundary as a disposable host that the operator trusts, or as an OS container around the server.
The host of every `worker` application sits inside it. That host holds the instance key, the `client_secret` of each binding that lists the instance and the credentials of its executions.
At the `worker` placement, one instance is one trust boundary over every project that it serves, under [worker-service.md](worker-service.md#instances-and-hosting).
The host of a `server` application that runs a slot of the `server` placement sits inside it for the same reason. A worker thread is no containment boundary for the code that the repository supplies.
Its child processes run with the rights of the server process.
A tool process at the `server` placement can therefore read the configuration file, its `master_key` and the database files. It can open every credential and sign a JWT of the server. kanthord accepts this reach in v1.
A slot of the `container` placement keeps C1 to C6 of [The guarantees of a slot driver](#the-guarantees-of-a-slot-driver).
The container is the boundary for the files of the server. The memory of the instance stays inside the boundary, as at the `worker` placement.

During a network git operation, a process of the same host user can sign through the SSH agent socket of that operation.
A checkout that an LLM agent writes can run code during a git operation through `.git/hooks`, `core.hooksPath`, `core.fsmonitor`, `url.<base>.insteadOf` or `protocol.<name>.allow`.
A hook process sees `GIT_SSH_COMMAND` with the socket path.
The trust boundary covers these paths, and the SSH agent exports no private key.
At the `server` and the `container` placements, the worker unit holds the SSH private key of each binding in its memory for the execution.
A process of the same host user can read that memory through `ptrace` or a core dump.
At the `worker` placement, the worker unit holds no SSH private key. A process of the instance user can sign through the [SSH signature relay](#the-ssh-signature-relay) during a live claim only.

## Traces

The pi session entries of an execution become its transcript telemetry, as the [session entries](tracking-service.impl.md#session-entries) of its agent sessions.

- `openNativeAgent` starts one `agent.session` span before it opens the pi session. The span identity is the pi session id.
- It opens the pi session with `SessionManager.create(<workspace>, <session directory>, { id })`, so pi persists every entry to a JSONL file.
- The session directory is `pi/sessions/execution/<execution identity>/` of the data directory, with mode `0700`.
- A resumed execution opens a new agent session, and a new session file, in the same directory.
- When the session opens, the worker appends one `kanthord.pinned_context` entry for the final system prompt.
- After each session event, the worker sends each entry beyond the count that it already sent.
- The agent trace closes once, before the telemetry flush of `release`, of `releaseStop` and of `submitAssessment`, or at the dispose of the agent. The close sends the remaining entries and ends the `agent.session` span, with `Error` for `releaseStop` and `Ok` otherwise. A record after the release has no live claim, so the server refuses it.
- A stop aborts the agent, so pi can still be inside a turn at the close. The close ends each open turn and tool span with `Error` and `error.type` `stopped`.
- An `agent.turn` span stays a child of its enclosing worker span: `worker.task` for a turn on a unit, `worker.phase` for a conflict turn, and `worker.evaluation` for the reviewer. Its `gen_ai.conversation.id` names its session.
- The start of an `agent.turn` span holds `kanthord.prompt.template`: the `PromptTemplate` value of the instruction that drove the turn. It also holds `kanthord.prompt.template.digest`, the sha-256 hex digest of the source template, and `kanthord.prompt.work.digest`, the `WorkPrompt.digest` that `renderWorkPrompt` computes.
- The worker replaces the secrets of the LLM credential of the agent with `[redacted]` in each entry before it sends the entry. It matches the exact secret strings only.
- The session file stays on the host as a convenience. A stateless container loses it, and the Tracking Service still holds every entry that reached it.
- The span identity of a worker span hashes the execution identity, a run key and the local key. The run key is 8 random hexadecimal characters, new in each process run of the execution. A resumed execution therefore writes new spans and keeps the spans of the earlier run.

pi keeps its own compaction logic, and kanthord designs nothing for it.
The handover and the report enter no transcript telemetry.
The steps method on an `implement` node writes one `worker.git` span for each base merge (`merge_base`), each fetch of the release gate (`fetch_base`) and the push of the finish or of a budget end (`push`). The push of a stop has no `worker.git` span. Each run of gate G writes one `worker.gate` span with `kanthord.gate.mode`, `kanthord.gate.changed` and `kanthord.gate.violation` on a violation, a restored one included. The checkpoint of a budget end is a run of gate G in checkpoint mode, and it writes a `worker.gate` span with `kanthord.gate.mode: checkpoint`. The commit of the gate runs inside that span and writes no `worker.git` span. A failed commit throws `worker.git.commit_failed` with the redacted git stderr as the cause message, and ends the `worker.gate` span with `Error` and the telemetry text `error`. A failed step ends its span with status `Error` and the telemetry text `error`. For a coded error, that text is the code and the cause message. For any other error, it is `system.operation.unknown: Operation failed.`

## Acceptance path

The acceptance path is the `coder@1` loop, the commit and the verification, the push, the release, the independent `reviewer@1` evaluation, the configured repository action, the authoritative observation of its end state, and the `Completed` outcome.
A scripted fake provider runs it deterministically.
A bounded real-provider smoke run proves the real configuration.

## Registration CLI validation

The registration CLI commands refuse invalid arguments locally with the following codes.
These declarations match the error table of `engine/docs/cli/worker.md`.

| HTTP  | Code                                                          | Condition                                                                                   |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| local | `cli.worker.registration.list.invalid_project_id`             | The `--project` value is not a canonical `project_<ulid>` identity.                         |
| local | `cli.worker.registration.list.invalid_binding_name`           | The `--binding` value is not a binding name.                                                |
| local | `cli.worker.registration.list.binding_without_project`        | `--binding` is given without `--project`.                                                   |
| local | `cli.worker.registration.get.invalid_runtime_identity`        | The `<runtime-identity>` argument is not a canonical `worker_registration_<ulid>` identity. |
| local | `cli.worker.registration.deregister.invalid_runtime_identity` | The `<runtime-identity>` argument is not a canonical `worker_registration_<ulid>` identity. |
| local | `cli.worker.registration.resume.invalid_runtime_identity`     | The `<runtime-identity>` argument is not a canonical `worker_registration_<ulid>` identity. |

## Instance CLI validation

`kanthord worker join` and `kanthord worker instance create --output` write the instance file. They refuse locally with the following codes.
`kanthord serve worker` also exits 1 with `worker.instance.config_invalid`, under [The instance configuration](#the-instance-configuration).

| HTTP  | Code                             | Condition                                                                                                                                                         |
| ----- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| local | `cli.worker.join.config_exists`  | The instance file of the name exists, and `--force` is absent. `--force` is the only overwrite.                                                                   |
| local | `worker.instance.config_invalid` | The instance configuration fails the configuration schema, the file name differs from `name`, or the `--instance` of `kanthord serve worker` differs from `name`. |

## Handover CLI validation

The `worker handover` command refuses an invalid argument locally, matching `engine/docs/cli/worker.md`.

| HTTP  | Code                                       | Condition                                                                     |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| local | `cli.worker.handover.invalid_execution_id` | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
