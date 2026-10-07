# Prompt settings

[Reference index](../README.md)

## Function description

Read and change the prompt settings of one scope. The settings control the sources that [the agent declaration](agent.md) composes into the prompt. Three commands use these settings:

- `prompt get` reads the settings of a scope.
- `prompt put` replaces the custom text of a scope.
- `prompt switch` turns one source of a scope on or off, or sets the system layer override of an `agent` scope.

The server holds one settings row for each scope and agent:

| Scope       | Agent name | Switches                                                                            |
| ----------- | ---------- | ----------------------------------------------------------------------------------- |
| `system`    | None       | `host_file`, `base`, `custom`, and the layer switch `layer`                         |
| `agent`     | Required   | `agent_file`, `shipped`, `custom`                                                   |
| `workbench` | Required   | `agents_md`, `agents_local_md`, `claude_md`, `claude_local_md`, `shipped`, `custom` |

The `system` scope applies to every agent. The `agent` and `workbench` scopes apply to the named catalog agent only. The `workbench` scope controls the workbench working layer. The working switches of a repository binding belong to the Project service.

The `system_layer` override of an `agent` scope decides the system layer for that agent. `inherit` takes the `layer` switch of the `system` scope. `on` and `off` override it.

A scope without a row answers every switch on, an empty custom text and revision `0`. The first write creates the row at revision `1`. Each later write adds `1`. Every write requires the revision that the caller read. Omit `expected_revision` only when the scope has no row.

The server configuration `agent.prompt.host_file: false` locks the `host_file` switch of the `system` scope. The composer then resolves `host_file` as `off` for every agent, and the stored switch stays unchanged.

**Current limitation:** the server rejects a custom text above 32768 UTF-8 bytes. It accepts a control character other than tab and line feed, for example the carriage return of a CRLF file. The composer then reports that custom source as `invalid` and leaves it out of the prompt.

## Expected response

Each operation returns HTTP `200` with the settings of the scope. The CLI writes one JSON line to stdout and exits `0`. `prompt put` and `prompt switch` add the retry key on the CLI only.

```json
{
  "scope": "agent",
  "agent_name": "swe@1",
  "switches": { "agent_file": true, "shipped": false, "custom": true },
  "custom_text": "Answer in English.\n",
  "system_layer": "inherit",
  "revision": 2,
  "locked_switches": [],
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property          | Type                  | Surface                  | Purpose                                                                   |
| ----------------- | --------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `scope`           | string                | API and CLI              | `system`, `agent` or `workbench`.                                         |
| `agent_name`      | string                | API and CLI              | Agent of the scope; an empty string for the `system` scope.               |
| `switches`        | object of booleans    | API and CLI              | Every switch of the scope.                                                |
| `custom_text`     | string                | API and CLI              | Text of the `custom` source; an empty text is an `absent` source.         |
| `system_layer`    | string or null        | API and CLI              | `inherit`, `on` or `off` for an `agent` scope; `null` for other scopes.   |
| `revision`        | integer               | API and CLI              | Current revision; `0` when the scope has no row.                          |
| `locked_switches` | string array          | API and CLI              | Switches that the server configuration locks; empty when no lock applies. |
| `idempotency_key` | canonical ULID string | CLI only, mutations only | Key used for this request; reuse it to retry the same request.            |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands    | Meaning                                                                                                       |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | All         | Missing, invalid, expired or banned token, or a machine token.                                                |
| `400 gateway.request.validation_failed`   | All         | The input breaks the schema, for example an agent name with the `system` scope or a switch outside the scope. |
| `400 gateway.idempotency.invalid_key`     | put, switch | Missing or malformed idempotency key, checked after schema validation.                                        |
| `409 gateway.idempotency.conflict`        | put, switch | The key belongs to a different request of the same caller.                                                    |
| `404 agent.catalog.not_found`             | All         | The agent name of an `agent` or `workbench` scope is not in the catalog.                                      |
| `409 agent.prompt.revision_conflict`      | put, switch | `expected_revision` differs from the current revision. `details.current` holds the current settings.          |
| `400 agent.prompt.too_large`              | put         | The custom text exceeds 32768 UTF-8 bytes.                                                                    |
| `409 agent.prompt.switch_locked`          | switch      | The switch is in `locked_switches`.                                                                           |
| `409 agent.prompt.agent_layer_empty`      | switch      | The change turns off every switch of an `agent` scope.                                                        |
| `413 gateway.request.body_too_large`      | put, switch | The body exceeds 64 KiB.                                                                                      |

The CLI checks the target before it sends the request. `<command>` is `get`, `put` or `switch`.

| CLI code                                       | Commands    | Meaning                                                                        |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `cli.agent.prompt.<command>.invalid_scope`     | All         | `--scope` is not `system`, `agent` or `workbench`.                             |
| `cli.agent.prompt.<command>.agent_required`    | All         | The scope is `agent` or `workbench`, and `--agent` is absent.                  |
| `cli.agent.prompt.<command>.agent_refused`     | All         | The scope is `system`, and `--agent` is present.                               |
| `cli.agent.prompt.<command>.invalid_revision`  | put, switch | `--expected-revision` is not a positive safe integer.                          |
| `cli.agent.prompt.switch.target_required`      | switch      | None or both of `--switch` and `--system-layer` are present.                   |
| `cli.agent.prompt.switch.invalid_switch`       | switch      | `--switch` names no switch of the scope.                                       |
| `cli.agent.prompt.switch.state_required`       | switch      | None or both of `--on` and `--off` are present.                                |
| `cli.agent.prompt.switch.invalid_system_layer` | switch      | `--system-layer` is not `inherit`, `on` or `off`, or the scope is not `agent`. |
| `cli.agent.prompt.<command>.token_required`    | All         | No option, environment variable or client file supplies a token.               |
| `cli.idempotency_key.invalid`                  | put, switch | `--idempotency-key` is not a canonical ULID.                                   |
| `cli.file.invalid_path`                        | put         | `--file` is `-`; the command does not read stdin.                              |
| `cli.file.not_found`                           | put         | The `--file` path does not exist.                                              |
| `cli.file.not_regular`                         | put         | The `--file` path is not a regular file.                                       |
| `cli.file.encoding_invalid`                    | put         | The file is not valid UTF-8.                                                   |
| `cli.agent.prompt.<command>.indeterminate`     | All         | A transport failure, timeout or malformed response.                            |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. For `put` and `switch`, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. An indeterminate `put` or `switch` prints the retry key. Retry with the same key and the same input. The server replays the recorded answer, a failure included, for the same caller and key within `gateway.idempotency_ttl` (default 86400 seconds).

## API shape

All three operations use `human` access, a 30-second timeout, and the header `Authorization: Bearer <human-jwt>`. The HTTP client of the CLI has a 31-second deadline.

### Get the settings of a scope

| Item            | Value                   |
| --------------- | ----------------------- |
| Method and path | `GET /api/agent/prompt` |
| Operation ID    | `agent.prompt.get`      |
| Mutation        | No                      |
| Request body    | None                    |

| Parameter    | In    | Required                         | Purpose                              |
| ------------ | ----- | -------------------------------- | ------------------------------------ |
| `scope`      | query | Yes                              | `system`, `agent` or `workbench`.    |
| `agent_name` | query | For `agent` and `workbench` only | Catalog agent; refused for `system`. |

```sh
curl -s 'http://127.0.0.1:31415/api/agent/prompt?scope=agent&agent_name=swe@1' \
  -H 'Authorization: Bearer <human-jwt>'
```

### Replace the custom text

| Item                  | Value                   |
| --------------------- | ----------------------- |
| Method and path       | `PUT /api/agent/prompt` |
| Operation ID          | `agent.prompt.put`      |
| Mutation              | Yes                     |
| Body limit            | 64 KiB                  |
| Path/query parameters | None                    |

| Body field          | Type    | Required                         | Purpose                                     |
| ------------------- | ------- | -------------------------------- | ------------------------------------------- |
| `scope`             | string  | Yes                              | `system`, `agent` or `workbench`.           |
| `agent_name`        | string  | For `agent` and `workbench` only | Catalog agent; refused for `system`.        |
| `expected_revision` | integer | Yes when the row exists          | Positive revision that the caller read.     |
| `custom_text`       | string  | Yes                              | New custom text, at most 32768 UTF-8 bytes. |

| Header            | Required | Purpose                                      |
| ----------------- | -------- | -------------------------------------------- |
| `Content-Type`    | Yes      | `application/json`.                          |
| `Idempotency-Key` | Yes      | Fresh canonical ULID; retain it for retries. |

```sh
curl -s -X PUT http://127.0.0.1:31415/api/agent/prompt \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"scope":"agent","agent_name":"swe@1","expected_revision":1,"custom_text":"Answer in English.\n"}'
```

### Set a switch or the system layer override

| Item                  | Value                           |
| --------------------- | ------------------------------- |
| Method and path       | `POST /api/agent/prompt/switch` |
| Operation ID          | `agent.prompt.switch`           |
| Mutation              | Yes                             |
| Body limit            | 64 KiB                          |
| Path/query parameters | None                            |

| Body field          | Type    | Required                          | Purpose                                           |
| ------------------- | ------- | --------------------------------- | ------------------------------------------------- |
| `scope`             | string  | Yes                               | `system`, `agent` or `workbench`.                 |
| `agent_name`        | string  | For `agent` and `workbench` only  | Catalog agent; refused for `system`.              |
| `expected_revision` | integer | Yes when the row exists           | Positive revision that the caller read.           |
| `switch`            | string  | With `enabled`                    | One switch of the scope.                          |
| `enabled`           | boolean | With `switch`                     | New value of the switch.                          |
| `system_layer`      | string  | Instead of `switch` and `enabled` | `inherit`, `on` or `off`; the `agent` scope only. |

The headers are the headers of `PUT /api/agent/prompt`.

```sh
curl -s -X POST http://127.0.0.1:31415/api/agent/prompt/switch \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"scope":"workbench","agent_name":"swe@1","expected_revision":2,"switch":"claude_md","enabled":false}'
```

## CLI shape

```text
kanthord agent prompt get --scope <scope> [--agent <agent-name>]
kanthord agent prompt put --scope <scope> [--agent <agent-name>] [--expected-revision <revision>] --file <path> [--idempotency-key <ulid>]
kanthord agent prompt switch --scope <scope> [--agent <agent-name>] [--expected-revision <revision>] (--switch <source> (--on | --off) | --system-layer <override>) [--idempotency-key <ulid>]
```

Each command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord agent prompt get --scope agent --agent swe@1
kanthord agent prompt put --scope system --file system.md
kanthord agent prompt put --scope agent --agent swe@1 --expected-revision 1 --file swe.md
kanthord agent prompt switch --scope system --expected-revision 3 --switch layer --off
kanthord agent prompt switch --scope agent --agent swe@1 --expected-revision 1 --system-layer on
```

There are no positional arguments.

| Option                           | Commands    | Default / resolution                                                        | Purpose                                                            |
| -------------------------------- | ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--scope <scope>`                | All         | Required                                                                    | `system`, `agent` or `workbench`.                                  |
| `--agent <agent-name>`           | All         | None; required for `agent` and `workbench`, refused for `system`            | Sets `agent_name`.                                                 |
| `--expected-revision <revision>` | put, switch | None; omit only when the scope has no row                                   | Sets `expected_revision`.                                          |
| `--file <path>`                  | put         | Required                                                                    | UTF-8 text file whose whole content becomes `custom_text`.         |
| `--switch <source>`              | switch      | None; exactly one of `--switch` and `--system-layer`                        | Sets `switch`.                                                     |
| `--on`, `--off`                  | switch      | None; exactly one with `--switch`                                           | Sets `enabled` to `true` or `false`.                               |
| `--system-layer <override>`      | switch      | None; the `agent` scope only                                                | Sets `system_layer`.                                               |
| `--idempotency-key <ulid>`       | put, switch | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key on a retry. |
| `--token <jwt>`                  | All         | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                           |
| `--endpoint <url>`               | All         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                   |

The `agent` group declares `--token` and `--endpoint`. Each option with a value, except `--endpoint`, accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration).
