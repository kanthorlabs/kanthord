# Show server configuration

[Reference index](../README.md)

## Function description

Print the effective YAML configuration with sensitive fields masked. The command uses the same path precedence and file/schema checks as [validate configuration](validate.md), fills defaults, and masks `masterKey` during serialization. It does not change the stored configuration.

## Expected response

Success writes YAML to stdout and exits `0`. A configuration created with defaults is displayed as:

```yaml
masterKey: "[Sensitive]"
log:
  level: info
  destination: stderr
gateway:
  bind: 127.0.0.1
  port: 31415
  allowedHosts:
    - 127.0.0.1:31415
    - localhost:31415
  allowedOrigins: []
  tokenLifetime: 31536000
  idempotencyTtl: 86400
```

| Property                 | Type                | Purpose                                                                                               |
| ------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `masterKey`              | string              | 32-byte base64 server secret in the file; always displayed as `[Sensitive]`.                          |
| `log.level`              | string              | Operational log threshold: `trace`, `debug`, `info`, `warn`, `error`, or `fatal`; defaults to `info`. |
| `log.destination`        | string              | Sends operational logs to `stderr` (default) or `file`.                                               |
| `gateway.bind`           | string              | Loopback listener address; defaults to `127.0.0.1`.                                                   |
| `gateway.port`           | integer             | Listener port; defaults to `31415`.                                                                   |
| `gateway.allowedHosts`   | string array        | Accepted Host headers, including port; defaults to `127.0.0.1:31415` and `localhost:31415`.           |
| `gateway.allowedOrigins` | string array        | Allowed CORS origins; defaults to an empty list.                                                      |
| `gateway.tokenLifetime`  | nonnegative integer | JWT lifetime in seconds; defaults to `31536000`.                                                      |
| `gateway.idempotencyTtl` | positive integer    | Process-local replay record lifetime in seconds; defaults to `86400`.                                 |

A load or validation failure writes a [diagnostic](../errors.md#cli-diagnostics) to stderr and exits `1` instead of printing configuration.

## API shape

Not available. Configuration inspection is a local filesystem operation, with no API endpoint or cURL equivalent.

## CLI shape

```text
kanthord config show [--config <path>]
```

```sh
kanthord config show --config /absolute/path/kanthord.yaml
```

There are no positional arguments.

| Option            | Default / resolution                                      | Purpose                                             |
| ----------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `--config <path>` | `KANTHORD_CONFIG` → XDG/default server configuration path | Selects the stored server configuration to display. |

An explicit `--config` wins. See [initialize configuration](init.md#cli-shape) for the full path precedence.
