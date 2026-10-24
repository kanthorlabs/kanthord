# Run an application

[Reference index](README.md)

## Function description

Start an application and keep it running until cancellation, a shutdown signal, or a fatal failure. `server` is the default application; `worker` starts one [worker instance](worker/instance.md) at the `worker` placement.

### Server

Startup opens the operational log and SQLite store, applies every migration to a new database, and binds the listener. A configuration version or a pending migration stops the start; run [upgrade](upgrade.md). A history that the binary does not hold stops the start with `system.database.migration.incompatible_history`; install the matching binary or restore the backups. A database schema that differs from its migration text stops the start with `system.database.migration.schema_mismatch`; run the [reset procedure](upgrade.md#reset-a-pre-release-database). A `master_key` that does not match an existing database stops the start with `system.config.master_key_mismatch`; restore the configuration file that created the database, or the matching database backup. The first start records the `master_key` of a new database. Startup issues no JWT and requires no terminal. Obtain a human token explicitly with [JWT generation](auth/jwt.md). The default listener is `127.0.0.1:31415`. Startup also installs the pinned `rg` and `fd` into `pi/bin/` of the state directory for the pi tools of a workbench session; a tool that cannot be installed or run stops the start with `worker.start.tool_missing`. The server host needs `bash`, `git` 2.40 or later, and OpenSSH 9.0 or later with `ssh`, `ssh-agent`, `ssh-add` and `ssh-keyscan`. A missing tool stops the start with `repository.connector.tool_missing`, and an older tool with `repository.connector.tool_version`. The server keeps each SSH key in custody and needs no file under `~/.ssh`; see [SSH keys](repository/ssh-key.md).

A worker binding of a worker that kanthord hosts without `placement` stops the start with `system.database.binding_placement_missing`; run the [reset procedure](upgrade.md#reset-a-pre-release-database). At the `container` placement, the server starts one container for each worker instance. The container waits until the [environment](https://github.com/kanthorlabs/kanthord-engine/blob/main/docs/cli/project.md#binding-environment) of its repository binding is `ready`, then runs the image of that environment. That image takes `kanthord` and `tini` from `<worker.container_image>:<server version>`. In a project with no repository binding, the container runs `<worker.container_image>:<server version>`. The server setting `worker.container_image` holds an image name with no tag and no digest, and its default is `docker.io/kanthorlabs/kanthord`. A value with a tag or a digest stops the start with `system.config.invalid_field`. When the container runtime is unavailable at the start, the server logs `worker.pool.driver_unavailable` and still starts, and the slots start again with a backoff when the runtime recovers. See [Isolate worker instances in containers](../how-to-guides/isolate-worker-instances-in-containers.md) and [worker placements](worker/placement.md).

Each network git operation of the server or a worker creates its SSH agent socket in the temporary directory of the host. A temporary directory path above 75 bytes makes every SSH operation fail with `repository.connector.ssh_agent_failed`, step `socket_path`. Set `TMPDIR` to a short path such as `/tmp`; see [the temporary directory limit](repository/ssh-key.md#the-temporary-directory-limit).

`SIGINT` and `SIGTERM` initiate graceful shutdown with a 10-second bound. Shutdown stops admission, cancels waiting work and streams, drains in-flight work, and releases server resources. `SIGHUP` reopens the log; reopen failure initiates shutdown. Use [liveness](gateway/liveness.md) to inspect the running server.

### Worker

`kanthord serve worker` starts one worker instance. It reads the instance configuration `{ name, endpoint, instance_id, private_key }` from one of two sources:

| Source                   | Form                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KANTHORD_WORKER_CONFIG` | The unpadded base64url form of the canonical JSON of the configuration. The name comes from the value.                                                   |
| The instance file        | `$XDG_CONFIG_HOME/kanthord/workers/<name>.yaml`, mode `0600`, which [`kanthord worker join`](worker/instance.md) writes. `--instance <name>` selects it. |

The variable set while the instance file of the same name exists stops the start with `worker.start.instance_config_conflict`. Neither source stops the start with `worker.start.instance_config_absent`; its rows are `variable`, `path` and `xdg_config_home`. A value that fails the configuration schema, a file whose `name` differs from its file name, or an `--instance` that differs from the name of the variable stops the start with `worker.instance.config_invalid`. `serve worker` writes no configuration and reads no `cli.yaml`.

The endpoint is `--endpoint`, then `KANTHORD_ENDPOINT`, then the `endpoint` of the configuration. An `http` endpoint whose host does not resolve only to loopback or private addresses stops the start with `worker.start.endpoint_insecure` and the row `host`. The private addresses are `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `fc00::/7` and `fe80::/10`. Use `https` for any other host.

The startup runs these steps in order:

1. It installs the pinned `rg` and `fd` into `pi/bin/` of the data directory of the instance. It takes neither from `PATH`.
2. It takes a worker token with `worker.instance.token` and compares the server package version with its own. Another version stops the start with `worker.version.mismatch`. An unknown answer stops the start with `worker.version.unavailable`.
3. It logs one record `Worker instance ready` with `instance`, `worker`, `fingerprint`, `connection_name` and `config_source` (`env` or `file`). `connection_name` is the host name.
4. It opens the connection with `worker.instance.connect`. The answer holds the client token and the client secret of each binding that lists the instance.
5. It registers for each binding, and logs one record `Worker application ready` for each registration.

The data directory of the instance is `$XDG_DATA_HOME/kanthord/workers/<name>/`. It holds `workspaces/` and `pi/`. `pi/sessions/execution/` holds the pi session files of the executions. The log directory is `$XDG_STATE_HOME/kanthord/workers/<name>/`. The process writes its operational log records to standard error. It opens no database and reads no server configuration.

After the start, the instance sends a heartbeat every 15 seconds. A changed binding list opens the connection again, so the instance adds and drains bindings without a restart. Another server version ends the process with `worker.version.mismatch`. A **Reset key** or an archive of the instance ends the process with `404 worker.instance.not_found`. A changed client secret of a hosted binding ends the process with `worker.instance.secret_changed`.

A second process of the same instance takes the connection. The first process ends the child tree of its running bash tool, keeps its registrations and exits `3` with `worker.instance.superseded`. The row `connection_name` names the other process.

The worker host needs `bash`, `git` 2.40 or later, and OpenSSH 9.0 or later with `ssh`, `ssh-agent` and `ssh-add`. A missing tool stops the start with `repository.connector.tool_missing`, and an older tool with `repository.connector.tool_version`. The worker host needs no SSH key, no SSH configuration and no `known_hosts` entry. At the `worker` placement, the SSH key stays on the server, and the instance sends each SSH signature request to the server through the SSH signature relay. The execution setup carries the pinned host key. The worker host must reach the SSH port of each repository address host. The SSH port is 443 for `ssh.github.com`, `altssh.gitlab.com` and `altssh.bitbucket.org`, and 22 for every other host. See [SSH host keys](repository/host-key.md#function-description). No binding check proves that path from the worker host.

`SIGINT`, `SIGTERM`, or cancellation stops the pull loop and deregisters each registration of the instance. A stop during a live execution cancels that execution and fails with `worker.stop.execution_live`. A `SIGINT` or a `SIGTERM` during the start ends the start, and the command exits `0` with no error.

### Slot (internal)

`kanthord serve slot` is the command of a slot container at the `container` placement. The server starts it. A human never runs it, `--help` does not list it, and it takes no option.

The command reads the frames of the slot channel from standard input, one JSON object for each line. The first frame is `init`. The command writes frames to file descriptor 3 only, and every other output goes to standard error. A `control` frame or a `SIGTERM` or `SIGINT` stops the worker thread, and a thread that does not exit within 5 seconds after a signal is ended. When the thread exits, the command exits with the exit code of the thread.

A signal before the `init` frame exits `0`. The command exits `1` with a diagnostic of the [CLI diagnostics](errors.md#cli-diagnostics) when no `init` frame arrives within 10 seconds, when a line is no valid frame or the first frame is not `init`, and when standard input ends or no frame arrives within 15 seconds. A deadline of 5 seconds after a signal exits `1` with no code. A failed write to file descriptor 3 ends the command with `worker.slot.channel_closed`.

## Expected response

This is a long-running process, not a JSON-returning command. A clean run exits `0`; failure exits `1`.

| Output / property      | Purpose                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server operational log | Startup, runtime, and shutdown diagnostics sent to the configured log destination.                                                                                                       |
| Worker operational log | `Worker instance ready` confirms that the version matched and the instance key opened the worker token. `Worker application ready` with the runtime identity confirms each registration. |
| Exit code `0`          | Application completed a clean run and shutdown.                                                                                                                                          |
| Exit code `1`          | Startup or runtime failed; a [diagnostic](errors.md#cli-diagnostics) identifies the failure.                                                                                             |
| Exit code `3`          | Worker only: another process of the same instance took the connection, `worker.instance.superseded`.                                                                                     |

The internal `serve slot` exits `0` or `1` as described in its section.

A pi tool that cannot be installed or run reports `worker.start.tool_missing` on the server and on the worker. A worker version-read failure reports `worker.version.unavailable`; a mismatch reports `worker.version.mismatch`.

## API shape

Not available. Starting a local process has no API endpoint or cURL equivalent. The worker application calls the instance routes of [worker instances](worker/instance.md), `GET /api/openapi.yaml` and the Worker and Scheduler routes during its run, but no route starts an application.

## CLI shape

```text
kanthord serve [server] [--config <path>]
kanthord serve worker [--instance <name>] [--endpoint <url>]
```

```sh
kanthord serve
kanthord serve server --config /absolute/path/kanthord.yaml
kanthord serve worker --instance coder-1
KANTHORD_WORKER_CONFIG='<instance configuration>' kanthord serve worker
```

| Argument / option   | Applies to  | Default / resolution                                                 | Purpose                                                                                                  |
| ------------------- | ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `[application]`     | `serve`     | `server`; supported choices are `server` and `worker`                | Selects the application to start. The internal `slot` is no choice.                                      |
| `--config <path>`   | Server only | `KANTHORD_CONFIG` → XDG/default server configuration path            | Server configuration; see [path precedence](config/init.md#cli-shape).                                   |
| `--instance <name>` | Worker only | The name of `KANTHORD_WORKER_CONFIG`; required without that variable | Selects the instance file `workers/<name>.yaml`. With the variable, it must equal the name of the value. |
| `--endpoint <url>`  | Worker only | `KANTHORD_ENDPOINT` → the `endpoint` of the instance configuration   | Server base URL for every call of the instance.                                                          |

Explicit options take precedence. The worker refuses `--config` with `cli.serve.worker_config` and `--token` with `cli.serve.worker_token`. The instance key is its only credential. The agent processes of the instance do not receive `KANTHORD_WORKER_CONFIG`, `KANTHORD_TOKEN` or `KANTHORD_ENDPOINT`. [Run a worker on another host](../how-to-guides/run-in-a-container.md#8-run-a-worker-on-another-host) shows the steps.
