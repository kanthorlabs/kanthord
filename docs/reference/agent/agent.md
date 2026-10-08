# Get an agent declaration

[Reference index](../README.md)

## Function description

Read the catalog declaration of one agent, its composed prompt, its permitted tools and its global enablement. The API and `kanthord agent get` perform the same read and change no state.

The catalog holds the agents `swe@1` and `re@1`. An agent name outside the catalog fails. The answer contains `enablement: null` when the agent has no live [enablement](enablement.md).

The server composes the prompt at read time from three layers: the system layer, the agent layer and the working layer. Without a binding, the working layer is the workbench layer of the agent. It reads `AGENTS.md`, `AGENTS.local.md`, `CLAUDE.md` and `CLAUDE.local.md` from the workbench directory of the agent. With a project and a repository binding, the working layer is the layer of that binding. Its workspace files have the state `deferred`, because only the worker application reads a workspace.

The [prompt settings](prompt.md) control the switches and the custom text of each layer. The server configuration `agent.prompt.system_file`, `agent.prompt.agent_directory` and `agent.prompt.host_file` control the file sources.

## Expected response

The API returns HTTP `200` with the declaration. The CLI writes the same object as one JSON line to stdout and exits `0`. The example below is shortened.

```json
{
  "agent_name": "re@1",
  "configuration_schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "agent_provider": { "type": "string", "minLength": 1 },
      "provider": {
        "type": "string",
        "enum": ["openai-compatible", "anthropic", "..."]
      },
      "credential": { "type": "string", "minLength": 1 },
      "model_identifier": { "type": "string", "minLength": 1 },
      "reasoning_effort": {
        "type": "string",
        "enum": ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
      }
    },
    "required": [
      "agent_provider",
      "provider",
      "credential",
      "model_identifier",
      "reasoning_effort"
    ],
    "additionalProperties": false,
    "description": "The Agent component validates the whole configuration. ..."
  },
  "overridable_fields": [
    "agent_provider",
    "model_identifier",
    "reasoning_effort"
  ],
  "prompt": {
    "layers": [
      {
        "layer": "system",
        "enabled": true,
        "sources": [
          {
            "source": "base",
            "origin": "binary",
            "path": null,
            "enabled": true,
            "state": "present",
            "digest": "fc0e6acdff4574d8a819453138969678876fe1ae87c3760b905e540b90d51caa",
            "text": "This text is the default standard. ..."
          }
        ]
      }
    ],
    "final": "This text is the default standard. ..."
  },
  "tools": [{ "name": "read", "source": "builtin", "input_schema": {} }],
  "enablement": null
}
```

| Property               | Type           | Purpose                                                                                                                                                                      |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_name`           | string         | Catalog key of the agent.                                                                                                                                                    |
| `configuration_schema` | object         | JSON Schema draft 2020-12 of the effective configuration. JSON Schema does not check that the model belongs to the provider or that the model supports the reasoning effort. |
| `overridable_fields`   | string array   | Fields that a binding entry can override. For `swe@1` and `re@1` the value is `agent_provider`, `model_identifier` and `reasoning_effort`.                                   |
| `prompt.layers`        | array          | The system, agent and working layers, in composition order. Absent with `view=final`.                                                                                        |
| `prompt.final`         | string         | The composed prompt: the `present` texts of the system and agent layers, a framing paragraph, then each `present` working text as `Instructions of <source label>:`.         |
| `tools`                | array          | Permitted tools. Each item holds `name`, `source` (`host`, `builtin` or `kanthord-mcp`) and `input_schema`.                                                                  |
| `enablement`           | object or null | The live [enablement record](enablement.md#expected-response), or `null` when no live record exists.                                                                         |

Each layer holds `layer` (`system`, `agent` or `working`), `enabled` and `sources`. A disabled layer resolves every source as `off`. Each source holds these fields:

| Property  | Type           | Purpose                                                                                                                                                                 |
| --------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`  | string         | Source name, for example `host_file`, `base`, `custom`, `agent_file`, `shipped`, `agents_md` or `project_prompt`.                                                       |
| `origin`  | string         | `binary`, `file` or `database`.                                                                                                                                         |
| `path`    | string or null | Path of a `file` source, relative to the home directory with `~/` when the file is below it. `null` for other origins and for an unset file path.                       |
| `enabled` | boolean        | The switch of the source.                                                                                                                                               |
| `state`   | string         | `present`, `absent`, `invalid`, `off` or `deferred`. `invalid` marks a text that is too large, is not UTF-8, holds a control character, or that the server cannot read. |
| `digest`  | string or null | SHA-256 hex digest of the text when `state` is `present`, else `null`.                                                                                                  |
| `text`    | string or null | Text of the source when `state` is `present`, else `null`.                                                                                                              |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Meaning                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Missing, invalid, expired or banned token, or a machine token.                  |
| `400 gateway.request.validation_failed`   | `view` is not `final`, or only one of `project_id` and `binding_id` is present. |
| `404 agent.catalog.not_found`             | The agent name is not in the catalog.                                           |
| `404 project.binding.not_found`           | `binding_id` names no repository binding of the project `project_id`.           |

The CLI checks some input before it sends the request:

| CLI code                                      | Meaning                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `cli.agent.get.invalid_view`                  | The `--view` value is not `final`.                                     |
| `cli.agent.get.project_binding_pair_required` | Only one of `--project` and `--binding` is present.                    |
| `cli.agent.get.token_required`                | No option, environment variable or client file supplies a token.       |
| `cli.agent.get.indeterminate`                 | A transport failure, timeout or malformed response. Retry the command. |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr.

## API shape

| Item            | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Method and path | `GET /api/agent/:agent_name`                                           |
| Operation ID    | `agent.get`                                                            |
| Access          | `human` (human bearer JWT)                                             |
| Timeout         | 30 seconds                                                             |
| Mutation        | No                                                                     |
| Request body    | None; a nonempty body fails with `400 gateway.request.unexpected_body` |

| Parameter    | In    | Required                        | Purpose                                                           |
| ------------ | ----- | ------------------------------- | ----------------------------------------------------------------- |
| `agent_name` | path  | Yes                             | Catalog key, for example `swe@1`.                                 |
| `view`       | query | No                              | The only value is `final`. The answer then omits `prompt.layers`. |
| `project_id` | query | Only together with `binding_id` | Project of the repository binding.                                |
| `binding_id` | query | Only together with `project_id` | Repository binding that supplies the working layer.               |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -s 'http://127.0.0.1:31415/api/agent/swe@1?view=final' \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord agent get <agent-name> [--view final] [--project <project-id> --binding <binding-id>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord agent get swe@1 --view final
kanthord agent get swe@1 --project <project-id> --binding <binding-id>
```

| Argument       | Required | Purpose                            |
| -------------- | -------- | ---------------------------------- |
| `<agent-name>` | Yes      | Catalog key; maps to `agent_name`. |

| Option                   | Default / resolution                                                        | Purpose                                        |
| ------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------- |
| `--view <view>`          | None; the only value is `final`                                             | Answer `prompt.final` without `prompt.layers`. |
| `--project <project-id>` | None; requires `--binding`                                                  | Sets `project_id`.                             |
| `--binding <binding-id>` | None; requires `--project`                                                  | Sets `binding_id`.                             |
| `--token <jwt>`          | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.       |
| `--endpoint <url>`       | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                               |

The `agent` group declares `--token` and `--endpoint`. Put them before or after the leaf command. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline for this 30-second operation.
