# Run an application

[Reference index](README.md)

## Function description

Start an application and keep it running until cancellation, a shutdown signal, or a fatal failure. `server` is the default application; `worker` starts the remote worker application.

### Server

Startup opens the operational log and SQLite store, applies migrations, and binds the listener. Startup issues no JWT and requires no terminal. Obtain human or machine tokens explicitly with [JWT generation](jwt.md). The default listener is `127.0.0.1:31415`.

`SIGINT` and `SIGTERM` initiate graceful shutdown with a 10-second bound. Shutdown stops admission, cancels waiting work and streams, drains in-flight work, and releases server resources. `SIGHUP` reopens the log; reopen failure initiates shutdown. Use [healthchecks](gateway/healthcheck.md) to inspect the running server.

### Worker

The worker requires `rg` and `fd` (or `fdfind`) on the host. It reads the server's package version from the [OpenAPI root](gateway/openapi.md) and refuses an unavailable or different version. On a match, it calls [worker registration](worker/register.md), sends heartbeats, pulls work from the Scheduler, and executes each claim. It opens no database and reads no server configuration.

`SIGINT`, `SIGTERM`, or cancellation stops the pull loop and deregisters the worker instance. A stop during a live execution cancels that execution and fails with `worker.stop.execution_live`.

## Expected response

This is a long-running process, not a JSON-returning command. A clean run exits `0`; failure exits `1`.

| Output / property      | Purpose                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Server operational log | Startup, runtime, and shutdown diagnostics sent to the configured log destination.                                     |
| Worker operational log | `Worker application ready` with the runtime identity confirms that the version matched and the registration succeeded. |
| Exit code `0`          | Application completed a clean run and shutdown.                                                                        |
| Exit code `1`          | Startup or runtime failed; a [diagnostic](errors.md#cli-diagnostics) identifies the failure.                           |

A missing `rg` or `fd` reports `worker.start.tool_missing`. A worker version-read failure reports `worker.version.unavailable`; a mismatch reports `worker.version.mismatch`.

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
