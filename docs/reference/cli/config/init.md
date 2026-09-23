# `kanthord config init`

Create a validated server configuration with a fresh 32-byte base64 master key and the configured defaults.

```sh
kanthord config init
kanthord config init --config /absolute/path/kanthord.yaml
```

The path resolves from `--config`, then `KANTHORD_CONFIG`, then `$XDG_CONFIG_HOME/kanthord/kanthord.yaml` (fallback: `~/.config/kanthord/kanthord.yaml`). The command creates an owned `0700` parent directory and publishes a `0600` file atomically. An existing destination causes failure.

Success prints `Created <path>` and exits `0`; failures exit `1` with a diagnostic.

Next: [validate](validate.md), [serve](../serve.md). [Reference index](../../README.md).
