# Validate server configuration

[Reference index](../README.md)

## Function description

Read and validate the stored server configuration, including ownership, permissions, YAML structure, and every declared field. Defaults apply only to absent fields; explicit `null` values are invalid and appear in the field diagnostics.

### YAML constraints

- The document must be one mapping with unique scalar string keys. Dotted keys such as `gateway.port` are not substitutes for nested mappings and are rejected.
- Ordinary aliases are supported; cyclic aliases, unresolved aliases, unsupported value types, and parser warnings fail validation without exposing source text.
- YAML input is limited to 1 MiB of UTF-8 text, 4,096 expanded values (including mappings and arrays), and 32 nested collections. Shared alias values count on each traversal.

## Expected response

Success prints a confirmation to stdout and exits `0`:

```text
Valid configuration: <path>
```

| Output / property             | Purpose                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `Valid configuration: <path>` | Confirms validation and identifies the resolved configuration file path. |
| Exit code `0`                 | File safety, YAML structure, and declared fields passed validation.      |

Missing files, unsafe permissions, duplicate YAML keys, unknown fields, and invalid values produce a [diagnostic](../errors.md#cli-diagnostics) on stderr and exit `1`. Diagnostics identify fields without echoing their values. The command does not rewrite the file or print its properties; use [show configuration](show.md) to inspect masked effective values.

## API shape

Not available. Configuration validation is a local filesystem operation, with no API endpoint or cURL equivalent.

## CLI shape

```text
kanthord config validate [--config <path>]
```

```sh
kanthord config validate --config /absolute/path/kanthord.yaml
```

There are no positional arguments.

| Option            | Default / resolution                                      | Purpose                                              |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `--config <path>` | `KANTHORD_CONFIG` → XDG/default server configuration path | Selects the stored server configuration to validate. |

An explicit `--config` wins. See [initialize configuration](init.md#cli-shape) for the full path precedence.
