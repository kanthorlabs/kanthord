# Check resource health

[Reference index](../README.md)

## Function description

Check every remote resource that KanthorD uses, on demand, and report one entry for each resource. A resource is a repository binding, a credential, an agent provider, a registered worker instance or an Intake inbound identity. The report stores no result and changes no binding, credential or execution.

The report does not tell whether the server process runs. Use [liveness](liveness.md) for that question, for example in a container healthcheck.

Seven owners supply the resources. The server reads all inventories in one transaction before it starts the checks:

| Group      | Owner        | Resource name                              | Scope      | Resource                                  |
| ---------- | ------------ | ------------------------------------------ | ---------- | ----------------------------------------- |
| `services` | `project`    | Binding name                               | `projects` | A current repository binding.             |
| `services` | `intake`     | Inbound ID                                 | `projects` | An Intake inbound.                        |
| `services` | `worker`     | `<worker binding name>/<runtime identity>` | `projects` | A registered worker instance.             |
| `shared`   | `llm`        | Credential name                            | `global`   | A live LLM credential.                    |
| `shared`   | `repository` | Credential name                            | `global`   | A live repository credential.             |
| `shared`   | `storage`    | Credential name                            | `global`   | A live storage credential.                |
| `shared`   | `agent`      | `<agent name>/<agent provider name>`       | `global`   | An agent provider of an agent enablement. |

Each name segment is percent-encoded, a literal `/` or `%` included.

The checks run under these rules:

1. The server checks each target once. Two entries with the same target, for example two bindings of one address, show the same result.
2. At most 32 checks run at the same time across all owners.
3. Each check has a deadline of 10 seconds from its start. A check that exceeds its deadline reports `unknown` with `deadline_exceeded`, for every kind of check.
4. The report has a deadline of 115 seconds after the start: the route timeout of 120 seconds minus a margin of 5 seconds. At that deadline, every entry without a result reports `unknown` with `deadline_exceeded`, a check that did not start included.
5. A failure of a check is not a failure of the request. The request answers HTTP `200` with `unhealthy` and `unknown` entries.

## Expected response

The API returns HTTP `200` with JSON. This report holds one project `shop` with the repository binding `app`, one LLM credential and one GitHub credential:

```json
{
  "services": {
    "project": {
      "global": {},
      "projects": {
        "shop": {
          "app": {
            "status": "unhealthy",
            "capability": "network git read",
            "failure_reason": "key_refused"
          }
        }
      }
    },
    "intake": { "global": {}, "projects": {} },
    "worker": { "global": {}, "projects": {} }
  },
  "shared": {
    "llm": {
      "global": {
        "team-openai": {
          "status": "healthy",
          "capability": "model-list read",
          "failure_reason": null
        }
      },
      "projects": {}
    },
    "repository": {
      "global": {
        "github-main": {
          "status": "unknown",
          "capability": "rate-limit read",
          "failure_reason": "unclassified"
        }
      },
      "projects": {}
    },
    "storage": { "global": {}, "projects": {} },
    "agent": { "global": {}, "projects": {} }
  }
}
```

| Property                                        | Type           | Purpose                                                                                                        |
| ----------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `services`                                      | object         | Holds exactly `project`, `intake` and `worker`.                                                                |
| `shared`                                        | object         | Holds exactly `llm`, `repository`, `storage` and `agent`.                                                      |
| `<group>.<owner>.global`                        | object         | Maps a resource name to an entry. The object can be empty.                                                     |
| `<group>.<owner>.projects`                      | object         | Maps a project name to a resource map. The object can be empty.                                                |
| `<group>.<owner>.projects.<project>.<resource>` | object         | One entry of a project-scoped resource.                                                                        |
| `<entry>.status`                                | string         | `healthy`, `unhealthy` or `unknown`.                                                                           |
| `<entry>.capability`                            | string         | The capability that the check proves, for example `network git read`. It is no claim about other capabilities. |
| `<entry>.failure_reason`                        | string or null | `null` only when `status` is `healthy`. Every other entry carries a value.                                     |

`failure_reason` is a value of one closed list. The [failure reason table](../errors.md#failure-reasons-of-a-health-entry) defines each value. The value of an entry depends on its resource:

| Entry                             | Values                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A repository binding of `project` | A git value of the [binding check](../project/binding.md#failure-reasons-of-the-address-entry).                                                |
| A credential of `llm`             | A value of the [LLM credential check](../llm/credential.md#check-and-verify-answer). The report lists only `server` copies.                    |
| A credential of `repository`      | A value of the [repository credential check](../repository/credential.md#verify-and-check).                                                    |
| A credential of `storage`         | A value of the [storage credential check](../storage/credential.md#verify-and-check).                                                          |
| An agent provider of `agent`      | A value of the LLM credential check of its credential. A credential that only worker instances hold reports `unknown` with `held_by_instance`. |
| An entry of `intake` or `worker`  | `deadline_exceeded` or `unclassified`.                                                                                                         |

Every entry whose check exceeds its deadline carries `deadline_exceeded`. The answer holds no remote text, no secret and no endpoint URL with credentials. The server log record `resource.health.check` keeps the redacted remote text of each failed check under `reason`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                         | Meaning                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`  | Absent, invalid, expired or banned token, or a machine token.                                           |
| `503 gateway.healthcheck.inventory_failed` | One or more owners cannot supply their inventory. `error.details.missing_inventories` names each owner. |
| `503 gateway.lifecycle.not_ready`          | The Gateway Service is not ready.                                                                       |
| `504 gateway.invocation.timeout`           | The request exceeded 120 seconds.                                                                       |

```json
{
  "error": {
    "code": "gateway.healthcheck.inventory_failed",
    "message": "One or more resource owners failed to supply their inventory.",
    "details": { "missing_inventories": ["intake"] }
  },
  "request_id": "request_01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

A client disconnect or a server stop cancels every check, and the server sends no `200` answer.

## API shape

| Item                  | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Method and path       | `GET /api/healthcheck`                                                           |
| Operation ID          | `gateway.healthcheck`                                                            |
| Access                | Human bearer JWT                                                                 |
| Timeout               | 120 seconds for the route; 115 seconds for the report; 10 seconds for each check |
| Path/query parameters | None                                                                             |
| Request body          | None                                                                             |

| Header          | Required | Purpose                                         |
| --------------- | -------- | ----------------------------------------------- |
| `Authorization` | Yes      | `Bearer <jwt>` containing the human credential. |

```sh
curl -i http://127.0.0.1:31415/api/healthcheck \
  -H 'Authorization: Bearer <jwt>'
```

The host check and the readiness check apply.

## CLI shape

No CLI command reads the resource report. Use the cURL request above. To check one resource from the CLI, use `kanthord project binding verify`, or the `verify` command of the [LLM](../llm/credential.md), [repository](../repository/credential.md) or [storage](../storage/credential.md) credential group. To check whether the server runs, use [`kanthord gateway liveness`](liveness.md#cli-shape).
