# Initialize server configuration

[Reference index](../README.md)

## Function description

Create a validated server configuration with a fresh 32-byte base64 master key and the configured defaults. The command creates an owned `0700` parent directory and publishes a `0600` file atomically. An existing destination causes failure; initialization never overwrites it.

## Expected response

Success prints a confirmation to stdout and exits `0`:

```text
Created <path>
```

| Output / property  | Purpose                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Created <path>`   | Confirms creation and identifies the resolved configuration file path.                                                                                          |
| Configuration file | Contains the generated `masterKey` and defaults; see [configuration properties](show.md#expected-response). Unlike `config show`, the stored key is not masked. |
| Exit code `0`      | Configuration was created successfully.                                                                                                                         |

Failures exit `1` with a [diagnostic](../errors.md#cli-diagnostics). The confirmation does not print the master key.

## API shape

Not available. Configuration initialization is a local filesystem operation, with no API endpoint or cURL equivalent.

## CLI shape

```text
kanthord config init [--config <path>]
```

```sh
kanthord config init
kanthord config init --config /absolute/path/kanthord.yaml
```

There are no positional arguments.

| Option            | Default / resolution                                                                                                 | Purpose                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `--config <path>` | `KANTHORD_CONFIG` → `$XDG_CONFIG_HOME/kanthord/kanthord.yaml` → `~/.config/kanthord/kanthord.yaml` when XDG is unset | Destination for the private server configuration. |

An explicit `--config` wins over environment and default paths. The command reads no interactive input.

Next: [validate configuration](validate.md), [serve](../serve.md).
