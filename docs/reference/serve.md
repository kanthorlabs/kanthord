# Run an application

[Reference index](README.md)

## Function description

Start an application and keep it running until cancellation, a shutdown signal, or a fatal failure. `server` is the default application; `worker` starts the remote worker application.

### Server

Startup opens the operational log and SQLite store, applies every migration to a new database, and binds the listener. A configuration version or a pending migration stops the start; run [upgrade](upgrade.md). A history that the binary does not hold stops the start with `system.database.migration.incompatible_history`; install the matching binary or restore the backups. A database schema that differs from its migration text stops the start with `system.database.migration.schema_mismatch`; run the [reset procedure](upgrade.md#reset-a-pre-release-database). A `master_key` that does not match an existing database stops the start with `system.config.master_key_mismatch`; restore the configuration file that created the database, or the matching database backup. The first start records the `master_key` of a new database. Startup issues no JWT and requires no terminal. Obtain human or machine tokens explicitly with [JWT generation](auth/jwt.md). The default listener is `127.0.0.1:31415`. Startup also installs the pinned `rg` and `fd` into `pi/bin/` of the state directory for the pi tools of a workbench session; a tool that cannot be installed or run stops the start with `worker.start.tool_missing`. The server host needs `bash`, `git` 2.40 or later, and OpenSSH 9.0 or later with `ssh`, `ssh-agent`, `ssh-add` and `ssh-keyscan`. A missing tool stops the start with `repository.connector.tool_missing`, and an older tool with `repository.connector.tool_version`. The server keeps each SSH key in custody and needs no file under `~/.ssh`; see [SSH keys](repository/ssh-key.md).

Each network git operation of the server or a worker creates its SSH agent socket in the temporary directory of the host. A temporary directory path above 75 bytes makes every SSH operation fail with `repository.connector.ssh_agent_failed`, step `socket_path`. Set `TMPDIR` to a short path such as `/tmp`; see [the temporary directory limit](repository/ssh-key.md#the-temporary-directory-limit).

`SIGINT` and `SIGTERM` initiate graceful shutdown with a 10-second bound. Shutdown stops admission, cancels waiting work and streams, drains in-flight work, and releases server resources. `SIGHUP` reopens the log; reopen failure initiates shutdown. Use [liveness](gateway/liveness.md) to inspect the running server.

### Worker

The worker first installs its pinned `rg` and `fd` into `pi/bin/` of the state directory. It takes neither from `PATH`. It reads the server's package version from the [OpenAPI root](gateway/openapi.md) and refuses an unavailable or different version. On a match, it calls [worker registration](worker/register.md), sends heartbeats, pulls work from the Scheduler, and executes each claim. It opens no database and reads no server configuration.

The worker host needs `bash`, `git` 2.40 or later, and OpenSSH 9.0 or later with `ssh`, `ssh-agent` and `ssh-add`. A missing tool stops the start with `repository.connector.tool_missing`, and an older tool with `repository.connector.tool_version`. The worker host needs no SSH key, no SSH configuration and no `known_hosts` entry. For each execution, the [credential handover](worker/handover.md) carries the SSH key of each repository binding, and the execution setup carries the pinned host key. The worker keeps the key in memory and writes no private key file. The worker host must reach the SSH port of each repository address host. The SSH port is 443 for `ssh.github.com`, `altssh.gitlab.com` and `altssh.bitbucket.org`, and 22 for every other host. See [SSH host keys](repository/host-key.md#function-description). No binding check proves that path from the worker host.

`SIGINT`, `SIGTERM`, or cancellation stops the pull loop and deregisters the worker instance. A stop during a live execution cancels that execution and fails with `worker.stop.execution_live`.

## Expected response

This is a long-running process, not a JSON-returning command. A clean run exits `0`; failure exits `1`.

| Output / property      | Purpose                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Server operational log | Startup, runtime, and shutdown diagnostics sent to the configured log destination.                                     |
| Worker operational log | `Worker application ready` with the runtime identity confirms that the version matched and the registration succeeded. |
| Exit code `0`          | Application completed a clean run and shutdown.                                                                        |
| Exit code `1`          | Startup or runtime failed; a [diagnostic](errors.md#cli-diagnostics) identifies the failure.                           |

A pi tool that cannot be installed or run reports `worker.start.tool_missing` on the server and on the worker. A worker version-read failure reports `worker.version.unavailable`; a mismatch reports `worker.version.mismatch`.

## API shape

Not available. Starting a local process has no API endpoint or cURL equivalent. The worker application calls `GET /api/openapi.yaml` and the Worker and Scheduler routes during its run, but no route starts an application.

## CLI shape

```text
kanthord serve [server] [--config <path>]
kanthord serve worker [--endpoint <url>] [--token <jwt>]
```

```sh
kanthord serve
kanthord serve server --config /absolute/path/kanthord.yaml
kanthord serve worker --endpoint http://127.0.0.1:31415 --token '<machine-jwt>'
```

| Argument / option  | Applies to  | Default / resolution                                                  | Purpose                                                                |
| ------------------ | ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `[application]`    | `serve`     | `server`; supported choices are `server` and `worker`                 | Selects the application to start.                                      |
| `--config <path>`  | Server only | `KANTHORD_CONFIG` → XDG/default server configuration path             | Server configuration; see [path precedence](config/init.md#cli-shape). |
| `--endpoint <url>` | Worker only | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL for the version check and every worker call.           |
| `--token <jwt>`    | Worker only | `KANTHORD_TOKEN` → client-file token                                  | Machine credential for registration, heartbeat, and work pull.         |

Explicit options take precedence. The worker rejects `--config`; use its client options or private `cli.yaml` instead. The worker reads `client_secret` from `cli.yaml` alone, and it refuses to start with `worker.start.client_secret_absent` or `worker.start.client_secret_invalid`. See [client configuration](README.md#client-configuration).
