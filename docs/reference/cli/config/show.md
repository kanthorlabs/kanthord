# `kanthord config show`

Print the effective YAML configuration with sensitive fields masked.

```sh
kanthord config show --config /absolute/path/kanthord.yaml
```

The command uses the same path precedence and file/schema checks as [config validate](validate.md). It fills defaults and masks `masterKey` during serialization. Success writes YAML to stdout and exits `0`. A load or validation failure writes a diagnostic to stderr and exits `1`.

[Reference index](../../README.md).
