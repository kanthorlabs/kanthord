# Get an agent declaration

[Reference index](../README.md)

## Function description

Read the catalog declaration of one agent, its composed prompt, its permitted tools, its global enablement and the fallback chain of that enablement. The API and `kanthord agent get` perform the same read and change no state.

The catalog holds the agents `swe@1`, `re@1` and `env@1`. An agent name outside the catalog fails. The answer contains `enablement: null` when the agent has no live [enablement](enablement.md).

The server composes the prompt at read time from the Agent prompt and the Binding prompt. The Agent prompt holds the files `base.md`, `<agent_name>.md` and, for a Workbench agent, `workbench.md`. The Binding prompt holds the text of `prompts[<agent_name>]` of each repository binding. The framing is KanthorD protocol and no part of either prompt.

A file of the same name in the directory `agent.prompt.agent_directory` of the server host replaces the shipped text. The default directory is `<data>/agents`. An empty value selects the shipped texts only. A file `<name>.md` in the subdirectory `prompts` of the agent directory replaces the shipped prompt template of that name, for example `prompts/framing-worker.md`.

An override file or a template file that is not a regular UTF-8 file, exceeds 32768 bytes or holds a control character other than a tab and a newline answers `409 agent.prompt.template_invalid` with `details.file`. No reader falls back to the shipped text. The execution setup, the Workbench session open and the `env@1` run refuse in the same way.

Without a binding, a Workbench agent answers the Workbench system prompt, and `env@1` answers the worker system prompt. With a project and a repository binding, `final` is the worker system prompt with the binding prompt of that binding. KanthorD reads no `AGENTS.md`, `CLAUDE.md` or `*.local.md` file of a repository or of a home directory.

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
    "parts": [
      {
        "part": "standard",
        "name": "base.md",
        "origin": "binary",
        "path": "/home/kanthord/.local/share/kanthord/agents/base.md",
        "digest": "fc0e6acdff4574d8a819453138969678876fe1ae87c3760b905e540b90d51caa",
        "text": "This text is the default standard. ..."
      }
    ],
    "final": "This text is the default standard. ..."
  },
  "tools": [{ "name": "read", "source": "builtin", "input_schema": {} }],
  "enablement": null,
  "chain": [],
  "active_position": null,
  "cooling": null
}
```

| Property               | Type            | Purpose                                                                                                                                                                                  |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_name`           | string          | Catalog key of the agent.                                                                                                                                                                |
| `configuration_schema` | object          | JSON Schema draft 2020-12 of the effective configuration. JSON Schema does not check that the model belongs to the provider or that the model supports the reasoning effort.             |
| `overridable_fields`   | string array    | Fields that a binding entry can override. For `swe@1` and `re@1` the value is `agent_provider`, `model_identifier`, `reasoning_effort` and `fallback_configurations`.                    |
| `prompt.parts`         | array           | The parts of the system prompt in reading order. Absent with `view=final`. See the part table below.                                                                                     |
| `prompt.final`         | string          | The composed system prompt: every part, then the framing. A `binding` part reads `Instructions of repository <name>:` and its text.                                                      |
| `tools`                | array           | Permitted tools. Each item holds `name`, `source` (`host`, `builtin` or `kanthord-mcp`) and `input_schema`.                                                                              |
| `enablement`           | object or null  | The live [enablement record](enablement.md#expected-response), or `null` when no live record exists.                                                                                     |
| `chain`                | array           | The fallback chain of the enablement: the default configuration, then its `fallback_configurations`. `[]` when the enablement is absent, disabled or invalid. See the chain table below. |
| `active_position`      | integer or null | The `position` of the first chain entry whose `cooldown` is `null` or ended. `null` when every chain entry has a live cooldown, and when `chain` is empty.                               |
| `cooling`              | object or null  | `{ code, available_at }` with `code` `agent.configuration.chain_cooling` and the earliest `available_at` of the chain, when every chain entry has a live cooldown. Otherwise `null`.     |

Each `chain` item holds these fields:

| Property           | Type           | Purpose                                                                                                                                                         |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position`         | integer        | Position in the chain. `0` is the head.                                                                                                                         |
| `level`            | string         | `enablement` or `binding`. This view holds only `enablement`.                                                                                                   |
| `agent_provider`   | string         | Name of the agent provider.                                                                                                                                     |
| `provider`         | string         | Provider kind of the agent provider.                                                                                                                            |
| `credential`       | string         | Credential name of the agent provider.                                                                                                                          |
| `model_identifier` | string         | Model of the chain entry.                                                                                                                                       |
| `reasoning_effort` | string         | Reasoning effort of the chain entry.                                                                                                                            |
| `cooldown`         | object or null | `null`, or `{ strikes, available_at }` of the [cooldown](cooldown.md) of the `server` copy of the credential. Every model of a credential shows the same value. |

A hold that expired still shows in `cooldown` with its `strikes` and a past `available_at` until a success or a clear. Selection treats an expired hold as free.

`prompt.parts` holds `standard` (`base.md`), `role` (`<agent_name>.md`), `workbench` (`workbench.md`, only in the Workbench system prompt) and one `binding` part for each repository binding with a nonblank prompt of the agent. Each part holds these fields:

| Property | Type           | Purpose                                                                                                          |
| -------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `part`   | string         | `standard`, `role`, `workbench` or `binding`.                                                                    |
| `name`   | string         | The file name, for example `base.md`, or the repository name for a `binding` part.                               |
| `origin` | string         | `binary` for a shipped text, `file` for an override file, `database` for a binding prompt.                       |
| `path`   | string or null | The override path that the server looked up, also for `binary`. `null` for `binding` and for an empty directory. |
| `digest` | string         | SHA-256 hex digest of `text`.                                                                                    |
| `text`   | string         | Text of the part.                                                                                                |

The precedence of the system prompt is the framing, then the binding parts, then `workbench.md`, then the role, then the standard. A later message governs an earlier one.

### Selection

- The claim selects the first chain entry whose credential is not cooling. It records each selection as the agent name, the enablement revision and the chain position.
- The execution record and the release rebuild the pinned selection from these pins.
- The pinned selection fixes the agent provider, the provider, the credential, the model and the reasoning effort. The authorization of custody and the execution setup of the Worker Service read them from it.
- An enablement edit during a live execution changes none of them. A disabled or removed current enablement still stops both with 400 `agent.enablement.unavailable`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Meaning                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Missing, invalid, expired or banned token, or a machine token.                                                      |
| `400 gateway.request.validation_failed`   | `view` is not `final`, or only one of `project_id` and `binding_id` is present.                                     |
| `404 agent.catalog.not_found`             | The agent name is not in the catalog.                                                                               |
| `404 project.binding.not_found`           | `binding_id` names no repository binding of the project `project_id`.                                               |
| `409 agent.prompt.template_invalid`       | An override file or a template file of the agent directory is invalid. `details` holds `file`, `path` and `reason`. |

The CLI checks some input before it sends the request:

| CLI code                                      | Meaning                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `cli.agent.get.invalid_view`                  | The `--view` value is not `final`.                                     |
| `cli.agent.get.project_binding_pair_required` | Only one of `--project` and `--binding-id` is present.                 |
| `cli.agent.get.token_required`                | No option, environment variable or client file supplies a token.       |
| `cli.agent.get.indeterminate`                 | A transport failure, timeout or malformed response. Retry the command. |

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr.

## API shape

| Item            | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Method and path | `GET /api/agent/:agent_name`                                           |
| Operation ID    | `agent.get`                                                            |
| Access          | `human` (human bearer JWT)                                             |
| Timeout         | 30 seconds                                                             |
| Mutation        | No                                                                     |
| Request body    | None; a nonempty body fails with `400 gateway.request.unexpected_body` |

| Parameter    | In    | Required                        | Purpose                                                          |
| ------------ | ----- | ------------------------------- | ---------------------------------------------------------------- |
| `agent_name` | path  | Yes                             | Catalog key, for example `swe@1`.                                |
| `view`       | query | No                              | The only value is `final`. The answer then omits `prompt.parts`. |
| `project_id` | query | Only together with `binding_id` | Project of the repository binding.                               |
| `binding_id` | query | Only together with `project_id` | Repository binding whose binding prompt joins `final`.           |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -s 'http://127.0.0.1:31415/api/agent/swe@1?view=final' \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord agent get <agent-name> [--view final] [--project <project-id> --binding-id <binding-id>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord agent get swe@1 --view final
kanthord agent get swe@1 --project <project-id> --binding-id <binding-id>
```

| Argument       | Required | Purpose                            |
| -------------- | -------- | ---------------------------------- |
| `<agent-name>` | Yes      | Catalog key; maps to `agent_name`. |

| Option                      | Default / resolution                                                        | Purpose                                       |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `--view <view>`             | None; the only value is `final`                                             | Answer `prompt.final` without `prompt.parts`. |
| `--project <project-id>`    | None; requires `--binding-id`                                               | Sets `project_id`.                            |
| `--binding-id <binding-id>` | None; requires `--project`                                                  | Sets `binding_id`.                            |
| `--token <jwt>`             | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.      |
| `--endpoint <url>`          | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                              |

The `agent` group declares `--token` and `--endpoint`. Put them before or after the leaf command. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline for this 30-second operation.
