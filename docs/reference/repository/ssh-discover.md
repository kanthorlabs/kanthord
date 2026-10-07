# Discover SSH aliases

[Reference index](../README.md)

## Function description

List the SSH aliases of the server host that resolve to a git platform host. Use the result to prepare the metadata of an `ssh` [repository credential](credential.md). The operation writes nothing and creates no credential.

The server reads the top-level `~/.ssh/config` of its own user and follows no `Include`. It reads the names of each `Host` line and skips each name with `*`, `?` or `!`. It also skips each name that does not match `^[A-Za-z0-9][A-Za-z0-9.-]*$`.

For each alias, the server runs `ssh -G -- <host>` with a 10-second deadline. It drops an alias that fails to resolve. It keeps an alias whose resolved `hostname` contains `github`, `gitlab` or `bitbucket`, without regard to case.

Each kept alias receives a state:

- `present`: the newest live revision of an `ssh` credential holds this `host`.
- `ready`: the alias resolves with `identitiesonly yes` and exactly one `identityfile`.
- `refused`: the alias resolves without `identitiesonly yes` or without exactly one `identityfile`.

## Expected response

The API returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "items": [
    {
      "host": "github-deploy",
      "hostname": "github.com",
      "port": 22,
      "identity_file": "<identity-file-path>",
      "state": "ready",
      "reason": null
    },
    {
      "host": "gitlab-work",
      "hostname": "gitlab.com",
      "port": 22,
      "identity_file": null,
      "state": "refused",
      "reason": "repository.credential.ssh_identity_ambiguous"
    }
  ]
}
```

| Property        | Type             | Purpose                                                                                 |
| --------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `host`          | string           | Alias of `~/.ssh/config`.                                                               |
| `hostname`      | string           | Resolved `hostname` of the alias.                                                       |
| `port`          | integer          | Resolved `port` of the alias.                                                           |
| `identity_file` | string or `null` | The one resolved `identityfile`; `null` when the identity is ambiguous.                 |
| `state`         | string           | `ready`, `refused` or `present`.                                                        |
| `reason`        | string or `null` | `repository.credential.ssh_identity_ambiguous` for a `refused` alias; `null` otherwise. |

The `host`, `hostname`, `port` and `identity_file` of a `ready` item form valid `ssh` credential metadata.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                                | Meaning                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`         | Missing, invalid, expired or banned token, or a machine token. |
| `400 gateway.request.validation_failed`           | The request has a query parameter.                             |
| `400 gateway.request.unexpected_body`             | The request has a body.                                        |
| `422 repository.credential.ssh_config_unreadable` | The server cannot read `~/.ssh/config`.                        |
| `504 gateway.invocation.timeout`                  | The 30-second operation timeout expired.                       |

The CLI exits `1` for every failure and writes one diagnostic line to stderr in the form `<code>: <message>`. A declared API failure prints `<code>: request failed (HTTP <status>).` An absent or blank token gives `cli.repository.credential.ssh_discover.token_required`, and the CLI sends no request. A transport failure, timeout or malformed response gives `cli.repository.credential.ssh_discover.indeterminate: retry the command`.

## API shape

| Item                  | Value                                         |
| --------------------- | --------------------------------------------- |
| Method and path       | `GET /api/repository/credential/ssh/discover` |
| Operation ID          | `repository.credential.ssh_discover`          |
| Access                | `human` (human bearer JWT)                    |
| Timeout               | 30 seconds                                    |
| Mutation              | No                                            |
| Path/query parameters | None                                          |
| Request body          | None                                          |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i http://127.0.0.1:31415/api/repository/credential/ssh/discover \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord repository credential ssh-discover [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord repository credential ssh-discover --endpoint http://127.0.0.1:31415
```

There are no positional arguments.

| Option             | Default / resolution                                                  | Purpose                                       |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank token is required    | Human JWT sent in the `Authorization` header. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL.                              |

Each option is single-use, and the command rejects `--idempotency-key`. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The command reads the `~/.ssh/config` of the server, not of the CLI host. The HTTP client has a 31-second deadline for this 30-second operation.
