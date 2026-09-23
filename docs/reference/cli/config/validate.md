# `kanthord config validate`

Read and validate the stored server configuration, including ownership, permissions, YAML structure, and every declared field.

```sh
kanthord config validate --config /absolute/path/kanthord.yaml
```

Path precedence is `--config` → `KANTHORD_CONFIG` → the XDG/default server configuration path described in [config init](init.md). Success prints `Valid configuration: <path>` and exits `0`. Missing files, unsafe permissions, duplicate YAML keys, unknown fields, and invalid values produce a diagnostic and exit `1`. Diagnostics identify fields without echoing their values.

## YAML constraints

- The document must be one mapping with unique scalar string keys. Dotted keys such as `gateway.port` are not substitutes for nested mappings and are rejected.
- Ordinary aliases are supported; cyclic aliases, unresolved aliases, unsupported value types, and parser warnings fail validation without exposing source text.
- YAML input is limited to 1 MiB of UTF-8 text, 4,096 expanded values (including mappings and arrays), and 32 nested collections. Shared alias values count on each traversal.
- Defaults apply only to absent fields. Explicit `null` values are invalid and appear in the field diagnostics.

Related: [show](show.md). [Reference index](../../README.md).
