# Read worker binding agents

[Reference index](../README.md)

## Function description

A worker binding selects a worker. A worker declares zero or more agents. For each declared agent, the Project Service shows the effective agent configuration of the binding. The view combines the agent defaults from the Agent Service with the `entries` override of the binding. These operations read only; they change nothing.

The binding ID can identify any revision of a worker binding in the project. A tombstone is also valid. The view uses the configuration of that revision and the current agent enablement.

### project agent list

List the agents that the worker of the binding declares, sorted by agent name, lowest first. A worker that declares no agent gives an empty list.

### project agent get

Read the view of one declared agent by its name.

## Expected response

Both operations return HTTP `200`. The CLI writes the API body as one JSON line to stdout and exits `0` (shown formatted here).

### project agent get

```json
{
  "agent": "<agent-name>",
  "worker": "<worker-name>",
  "worker_binding_id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4",
  "binding_set_version": 5,
  "defaults": {
    "agent_provider": "<agent-provider-name>",
    "model_identifier": "<model-identifier>",
    "reasoning_effort": "<reasoning-effort>"
  },
  "entry": { "reasoning_effort": "<reasoning-effort>" },
  "effective": {
    "agent_provider": "<agent-provider-name>",
    "provider": "<provider>",
    "credential": "<credential-name>",
    "model_identifier": "<model-identifier>",
    "reasoning_effort": "<reasoning-effort>"
  },
  "valid": true,
  "issues": []
}
```

| Property              | Type             | Purpose                                                                                                                                       |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`               | string           | Agent name.                                                                                                                                   |
| `worker`              | string           | Worker name from the binding configuration.                                                                                                   |
| `worker_binding_id`   | string           | Binding ID from the request.                                                                                                                  |
| `binding_set_version` | positive integer | Current binding set version of the project.                                                                                                   |
| `defaults`            | object or null   | Default `agent_provider`, `model_identifier` and `reasoning_effort` of the agent. `null` when the agent is not enabled or is disabled.        |
| `entry`               | object or null   | Override fields of the binding entry for this agent, without `agent`. `null` when the binding has no entry for the agent.                     |
| `effective`           | object or null   | Defaults merged with the entry, plus the `provider` and `credential` of the agent provider. `null` when the view is not valid.                |
| `valid`               | boolean          | `true` when the effective configuration passes validation.                                                                                    |
| `issues`              | array            | Validation issues as `{ "path": [...], "code": "<error-code>" }`. An agent that is not enabled gives the code `agent.enablement.unavailable`. |

### project agent list

```json
{
  "items": [
    {
      "agent": "<agent-name>",
      "worker": "<worker-name>",
      "worker_binding_id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4",
      "binding_set_version": 5,
      "defaults": null,
      "entry": null,
      "effective": null,
      "valid": false,
      "issues": [{ "path": [], "code": "agent.enablement.unavailable" }]
    }
  ],
  "next_cursor": null
}
```

| Property      | Type           | Purpose                                                   |
| ------------- | -------------- | --------------------------------------------------------- |
| `items`       | array          | Agent views with the fields of `project agent get`.       |
| `next_cursor` | string or null | Opaque cursor for the next page; `null` on the last page. |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                                                                                                             |
| ----------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Both     | Absent, invalid, expired or banned token, or a machine token.                                                                                       |
| `400 gateway.request.validation_failed`   | Both     | A parameter or query value fails the schema.                                                                                                        |
| `400 system.pagination.cursor_invalid`    | `list`   | The cursor does not decode to an agent name.                                                                                                        |
| `404 project.project.not_found`           | Both     | No project has this ID.                                                                                                                             |
| `404 project.binding.not_found`           | Both     | No revision with this ID belongs to the project, or the binding is not a worker binding. For `get`, also an agent that the worker does not declare. |
| `400 gateway.request.unexpected_body`     | Both     | The request has a body.                                                                                                                             |
| `504 gateway.invocation.timeout`          | Both     | The operation exceeded 30 seconds.                                                                                                                  |

The CLI checks its input before it sends a request. Each local failure exits `1` and writes `<code>: <message>` to stderr.

| Code                                             | Commands | Meaning                                         |
| ------------------------------------------------ | -------- | ----------------------------------------------- |
| `cli.project.agent.<command>.invalid_project_id` | Both     | The project argument is not a valid project ID. |
| `cli.project.agent.<command>.invalid_binding_id` | Both     | The binding argument is not a valid binding ID. |
| `cli.pagination.limit_invalid`                   | `list`   | `--limit` is not a positive decimal integer.    |
| `cli.pagination.limit_out_of_range`              | `list`   | `--limit` is more than `1000`.                  |
| `cli.option.duplicate`                           | Both     | An option occurs more than once.                |
| `cli.project.agent.<command>.token_required`     | Both     | No nonblank token resolves.                     |

A declared server failure exits `1`. The CLI writes the server code, then the error object as JSON. A transport failure, a timeout or a malformed response exits `1` with `cli.project.agent.<command>.indeterminate`. Retry the command; there is no automatic retry.

## API shape

| Item             | `project agent list`                                     | `project agent get`                                                  |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| Method and path  | `GET /api/project/:project_id/binding/:binding_id/agent` | `GET /api/project/:project_id/binding/:binding_id/agent/:agent_name` |
| Operation ID     | `project.agentConfiguration.list`                        | `project.agentConfiguration.get`                                     |
| Access           | `human` (human bearer JWT)                               | `human` (human bearer JWT)                                           |
| Timeout          | 30 seconds                                               | 30 seconds                                                           |
| Mutation         | No                                                       | No                                                                   |
| Path parameters  | `project_id`, `binding_id`                               | `project_id`, `binding_id`, `agent_name`                             |
| Query parameters | `limit`, `cursor`                                        | None                                                                 |
| Request body     | None                                                     | None                                                                 |

| Parameter    | In    | Default | Rule                                     |
| ------------ | ----- | ------- | ---------------------------------------- |
| `project_id` | path  | None    | Project ID.                              |
| `binding_id` | path  | None    | Binding ID of a worker binding revision. |
| `agent_name` | path  | None    | Nonempty agent name.                     |
| `limit`      | query | `100`   | Integer from `1` to `1000`.              |
| `cursor`     | query | None    | Nonempty `next_cursor` value.            |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding/binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4/agent?limit=20' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding/binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4/agent/<agent-name> \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord project agent list <project-id> <worker-binding-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord project agent get <project-id> <worker-binding-id> <agent-name> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord project agent list project_01JD3W8QF4Q7J8M9N0P1R2S3T4 binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4
kanthord project agent get project_01JD3W8QF4Q7J8M9N0P1R2S3T4 binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4 <agent-name>
```

`kanthord project agent` without a subcommand displays help.

| Argument              | Commands | Purpose                                                              |
| --------------------- | -------- | -------------------------------------------------------------------- |
| `<project-id>`        | Both     | Project ID.                                                          |
| `<worker-binding-id>` | Both     | Binding ID of a worker binding revision.                             |
| `<agent-name>`        | `get`    | Agent name. The CLI does not validate it and encodes it in the path. |

### project agent list

| Option              | Default / resolution | Purpose                                              |
| ------------------- | -------------------- | ---------------------------------------------------- |
| `--limit <count>`   | `100`                | Maximum agents per page, from `1` to `1000`.         |
| `--cursor <cursor>` | None                 | Continues from the `next_cursor` of a previous page. |

### project agent get

There are no command options.

### Shared options

Both commands accept these `project` group options.

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline for these 30-second operations.
