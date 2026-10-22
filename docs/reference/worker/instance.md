# Manage worker instances

[Reference index](../README.md)

## Function description

A worker instance is the registered unit of the `worker` [placement](placement.md). One `kanthord serve worker` process is one instance. An instance belongs to one worker that kanthord hosts, for example `coder@1`, and that worker never changes. A [worker binding](../project/binding.md#binding-configuration) at the `worker` placement lists its instances in `worker_instances`.

The X25519 key pair of the instance is its only machine credential. The server stores only the public key. The private key stays in the instance configuration on the host of the instance:

- The instance configuration holds `name`, `endpoint`, `instance_id` and `private_key`. Its value is the unpadded base64url form of its canonical JSON, with no prefix.
- The instance file `$XDG_CONFIG_HOME/kanthord/workers/<name>.yaml` holds the same four keys, with mode `0600`. Without `XDG_CONFIG_HOME`, the directory is `~/.config/kanthord/workers/`.
- On a host without a writable configuration, the env value `KANTHORD_WORKER_CONFIG` holds the instance configuration. See [Run an application](../serve.md) for the start of `kanthord serve worker`.

Each instance has revisions. Each revision has its own `worker_instance_<ulid>` identity, key and fingerprint. The live revision of a name is its newest revision with `ended_at` `null`. A name with no live revision is archived.

- `worker instance create` stores revision `1` of a new name. The name follows the binding name form: 1 to 63 characters, `^[a-z][a-z0-9-]*$`. The names `server`, `token`, `connect` and `heartbeat` are reserved. An archived name stays taken.
- `worker instance list` pages the newest revision of each name in ascending name order. By default it leaves out archived instances.
- `worker instance get` reads the newest revision of one name, live or archived, with its bindings, its connection, its live registrations and its credential copies.
- `worker instance rotate` is the Reset key. In one transaction, it ends the live revision and stores the next revision with a new key. It also ends every live registration of the old revision. Each worker token, connection and client token of the old revision then fails its next request.
- `worker instance archive` ends the live revision for good. It refuses while a binding lists the instance, or while a registration of the instance holds an execution that has not ended. In one transaction, it ends the registrations of the instance and archives every [credential copy](../llm/credential.md#instance-copies) that the instance holds.

Create and rotate take `public_key` or `endpoint`, never both and never neither:

- With `public_key`, the server stores that key. The CLI generates the key pair on its own host and sends only `public_key`.
- With `endpoint`, the server generates the key pair and stores only the public key. The answer adds `instance_configuration` once, with the header `Cache-Control: no-store`. The server keeps no copy of the private key.

A Reset key gives a new instance configuration. Replace the instance file with `kanthord worker join --force`, or replace the env value. A credential copy that is sealed to the old key has `sealed_current` `false`. Rotate each listed credential with a new secret, and rotate the key at the provider. The old configuration still opens these credentials.

### The instance exchange

`kanthord serve worker` calls three operations. A human does not call them:

1. `worker.instance.token` sends the `instance_id` and receives a worker token sealed to the public key of the live revision. Only the holder of the private key opens it. The call changes no state.
2. `worker.instance.connect` sends the worker token. The answer holds, sealed, a `client` JWT and a `client_secret` for each binding that lists the instance.
3. `worker.instance.heartbeat` renews the connection once at the start, then every 15 seconds, and every 2 seconds while a [login on the instance](../llm/login.md#login-on-a-worker-instance) is pending.

The seal is HPKE base mode with the suite `hpke-x25519-sha256-aes128gcm`. HPKE does not authenticate the server. TLS or the same host authenticates the server to an instance.

The server keeps only the current connection of each instance in memory, with its last heartbeat. A connect without `connection_id` creates a new connection, and the previous connection ends at once. A connect or a heartbeat with another `connection_id` fails with `409 worker.instance.connection_superseded`. After a server start, no connection is current. The first connect, heartbeat or `client` request with a valid `connection_id` makes that connection current.

The dashboard shows an instance as connected while its last heartbeat is at most 60 seconds old.

## Expected response

### Instance record

`create`, `rotate` and `archive` answer HTTP `200` with an instance record. `list` and `get` add fields to the same record.

```json
{
  "id": "worker_instance_01M34JC4BJ66JHP41M4MYY6PST",
  "name": "builder-1",
  "worker": "coder@1",
  "revision": 1,
  "public_key": "<43-base64url-characters>",
  "fingerprint": "SHA256:<43-base64-characters>",
  "created_at": 1791467996322,
  "ended_at": null
}
```

| Property      | Type             | Purpose                                                                                 |
| ------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `id`          | string           | Identity of the revision, `worker_instance_<ulid>`. Each revision has its own identity. |
| `name`        | string           | Instance name. It never changes.                                                        |
| `worker`      | string           | Worker of the instance, for example `coder@1`. It never changes.                        |
| `revision`    | positive integer | Revision number of the name, from `1`. Each Reset key adds `1`.                         |
| `public_key`  | string           | Base64url form of the 32-byte X25519 public key of the revision.                        |
| `fingerprint` | string           | `SHA256:<unpadded base64 of the SHA-256 of the key>`. No two revisions share one.       |
| `created_at`  | integer          | Creation time of the revision in Unix milliseconds.                                     |
| `ended_at`    | integer or null  | End time of the revision in Unix milliseconds. `null` while the revision is live.       |

The `archive` answer is the archived revision, with `ended_at` set. The `rotate` answer is the new revision.

### `worker instance create` and `worker instance rotate`

With `endpoint` in the request, the API answer adds one field and the header `Cache-Control: no-store`:

| Property                 | Type   | Purpose                                                                                     |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| `instance_configuration` | string | The instance configuration with the generated private key. The server answers it only once. |

With `public_key`, the answer is the instance record only. No other answer of this page holds a secret, except the sealed objects.

The CLI generates the key pair on its own host and builds the instance configuration with the private key. It writes one JSON line to stdout and exits `0`:

| Output                   | Purpose                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Instance record          | The answer of the server.                                                                                         |
| `instance_configuration` | Without `--output`: the instance configuration. Give it to `kanthord worker join` or to `KANTHORD_WORKER_CONFIG`. |
| `created`                | With `--output`: the path of the instance file that the CLI wrote. The line then holds no private key.            |

The success line holds no `idempotency_key`.

### `worker instance list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "id": "worker_instance_01M34JC4BJ66JHP41M4MYY6PST",
      "name": "builder-1",
      "worker": "coder@1",
      "revision": 2,
      "public_key": "<43-base64url-characters>",
      "fingerprint": "SHA256:<43-base64-characters>",
      "created_at": 1791467996322,
      "ended_at": null,
      "connection": {
        "connection_name": "build-host",
        "connected_at": 1791468000000,
        "last_heartbeat_at": 1791468015000
      },
      "binding_count": 1,
      "holder_mismatch": false
    }
  ],
  "next_cursor": null
}
```

| Property                       | Type           | Purpose                                                                                                                                                                                                           |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`                        | array          | The newest revision of each name, with the fields of the [instance record](#instance-record) and the fields below.                                                                                                |
| `connection`                   | object or null | Current connection of the revision; `null` when the revision holds no current connection, or when its last heartbeat is more than 60 seconds old.                                                                 |
| `connection.connection_name`   | string         | Host name that the process sent. `""` when a `client` request made the connection current before a connect or a heartbeat named it.                                                                               |
| `connection.connected_at`      | integer        | Time in Unix milliseconds when the connection became current.                                                                                                                                                     |
| `connection.last_heartbeat_at` | integer        | Time in Unix milliseconds of the last connect or heartbeat.                                                                                                                                                       |
| `binding_count`                | integer        | Number of current bindings at the `worker` placement, over every project, that list the instance.                                                                                                                 |
| `holder_mismatch`              | boolean        | `true` when an agent of a binding that lists the instance gives the issue `agent.configuration.credential_holder_mismatch` for this instance. A chain credential then has no live copy sealed to the current key. |
| `next_cursor`                  | string or null | Opaque cursor for the next page; `null` on the last page.                                                                                                                                                         |

The connection state is process-local. A server start clears every connection.

### `worker instance get`

The API returns HTTP `200` with the newest revision of the name, live or archived. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "id": "worker_instance_01M34JC4BJ66JHP41M4MYY6PST",
  "name": "builder-1",
  "worker": "coder@1",
  "revision": 2,
  "public_key": "<43-base64url-characters>",
  "fingerprint": "SHA256:<43-base64-characters>",
  "created_at": 1791467996322,
  "ended_at": null,
  "connection": null,
  "bindings": [
    { "project_id": "project_01M34JC4BJ66JHP41M4MYY6PSA", "binding": "general" }
  ],
  "registrations": [],
  "credentials": [
    {
      "name": "claude",
      "revision": 1,
      "platform": "anthropic-subscription",
      "sealed_current": true,
      "health": {
        "status": "unhealthy",
        "capability": "model call",
        "failure_reason": "unauthorized",
        "models": null,
        "reported_at": 1791468011422
      }
    }
  ]
}
```

| Property                       | Type            | Purpose                                                                                                                                              |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection`                   | object or null  | Current connection, as in `worker instance list`.                                                                                                    |
| `bindings`                     | array           | One `{ project_id, binding }` item for each current binding at the `worker` placement, over every project, that lists the instance.                  |
| `registrations`                | array           | Live registrations of every revision of the instance. Each item is a record of [`worker registration get`](registration.md#worker-registration-get). |
| `credentials`                  | array           | Live credential copies that the instance holds, in ascending name order. Each item describes the newest live revision of one name.                   |
| `credentials[].name`           | string          | Credential name.                                                                                                                                     |
| `credentials[].revision`       | integer         | Newest live revision of the copy.                                                                                                                    |
| `credentials[].platform`       | string          | Platform of the credential.                                                                                                                          |
| `credentials[].sealed_current` | boolean         | `true` when the copy is sealed to the current key of the instance. `false` after a Reset key; rotate the copy with a new secret.                     |
| `credentials[].health`         | object          | The last check that the instance reported for this revision. See [health of an instance copy](../llm/credential.md#health-of-an-instance-copy).      |
| `health.status`                | string          | `healthy`, `unhealthy` or `unknown`.                                                                                                                 |
| `health.capability`            | string          | The capability that the check proves, as in [the check answer](../llm/credential.md#check-and-verify-answer).                                        |
| `health.failure_reason`        | string or null  | `null` for `healthy` only. `held_by_instance` when no report is held.                                                                                |
| `health.models`                | array or null   | The model list of a check that reads one, else `null`.                                                                                               |
| `health.reported_at`           | integer or null | Time of the report in Unix milliseconds. `null` when the server holds no report of this revision.                                                    |

The server holds no report after its start, after a new revision of the copy, or for a copy with `sealed_current` `false`. Such a copy shows `status` `unknown`, `failure_reason` `held_by_instance`, `models` `null` and `reported_at` `null`.

The record fields are the fields of the [instance record](#instance-record).

### `worker.instance.token`

The API returns HTTP `200` with the header `Cache-Control: no-store`. No CLI command calls this operation.

```json
{
  "server_version": "0.1.0",
  "sealed": {
    "alg": "hpke-x25519-sha256-aes128gcm",
    "enc": "<base64url>",
    "ciphertext": "<base64url>"
  }
}
```

| Property         | Type   | Purpose                                                                                                                                        |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `server_version` | string | Package version of the server.                                                                                                                 |
| `sealed`         | object | The worker token, sealed to the public key of the revision, with the info `kanthord/worker-token/v1` and the `instance_id` as additional data. |

`sealed` opens to `{ token, expired_at, name, worker, fingerprint }`. `token` is a JWT of the kind `worker` with a lifetime of 3600 seconds. `expired_at` is its expiry in Unix milliseconds.

### `worker.instance.connect`

The API returns HTTP `200` with the header `Cache-Control: no-store`. No CLI command calls this operation.

```json
{
  "connection_id": "connection_01M34JC4BJ66JHP41M4MYY6PSE",
  "binding_version": 3,
  "sealed": {
    "alg": "hpke-x25519-sha256-aes128gcm",
    "enc": "<base64url>",
    "ciphertext": "<base64url>"
  }
}
```

| Property          | Type    | Purpose                                                                                                                                               |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_id`   | string  | Current connection, `connection_<ulid>`. Send it with each heartbeat and each later connect.                                                          |
| `binding_version` | integer | Version of the bindings that list the instance. A heartbeat with another value tells the process to connect again.                                    |
| `sealed`          | object  | The binding entries, sealed with the info `kanthord/instance-connection/v1` and the `instance_id` followed by the `connection_id` as additional data. |

`sealed` opens to `{ bindings: [...] }`, one entry for each binding that lists the instance:

| Entry field         | Purpose                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `project_id`        | Project of the binding.                                                                                                      |
| `resource_identity` | Worker binding, `worker:kanthord:<binding-name>`.                                                                            |
| `client_id`         | Client identity of the instance for this binding. A new binding generation or a Reset key changes it.                        |
| `token`             | `client` JWT with the claims `instance_id` and `connection_id`, with a lifetime of 3600 seconds.                             |
| `expired_at`        | Expiry of `token` in Unix milliseconds.                                                                                      |
| `client_secret`     | Client secret of `client_id`.                                                                                                |
| `state`             | `serving`, or `draining` for a binding that no longer lists the instance while the instance holds a live registration in it. |

The `binding_version` is process-local and starts at `0` at each server start. Each binding-set write of a project adds `1` for each instance that the previous or the new set of that project lists.

### `worker.instance.heartbeat`

The API returns HTTP `200`. No CLI command calls this operation.

```json
{
  "server_version": "0.1.0",
  "binding_version": 3,
  "credential_version": 0,
  "login_sessions": [
    {
      "session_id": "<session-id>",
      "name": "claude",
      "platform": "anthropic-subscription",
      "mode": "copy_code",
      "code": null
    }
  ]
}
```

| Property                      | Type           | Purpose                                                                                                                                                                                                    |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server_version`              | string         | Package version of the server. A process with another version stops with `worker.version.mismatch`.                                                                                                        |
| `binding_version`             | integer        | Current binding version of the instance, as in the connect answer.                                                                                                                                         |
| `credential_version`          | integer        | Version of the credential copies of the instance. Each server start and each copy write give a new value. A changed value starts a [check of the copies](../llm/credential.md#health-of-an-instance-copy). |
| `login_sessions`              | array          | Pending [logins on the instance](../llm/login.md#login-on-a-worker-instance). An empty list when none is pending.                                                                                          |
| `login_sessions[].session_id` | string         | Login session.                                                                                                                                                                                             |
| `login_sessions[].name`       | string         | Name of the credential that the login creates.                                                                                                                                                             |
| `login_sessions[].platform`   | string         | Platform of the login.                                                                                                                                                                                     |
| `login_sessions[].mode`       | string         | `copy_code` or `device`.                                                                                                                                                                                   |
| `login_sessions[].code`       | string or null | The value that the human submitted with `login-code`; `null` until then.                                                                                                                                   |

A heartbeat also sets the `connection_name` of a current connection that holds none.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Commands                                                       | Meaning                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | All except `token`                                             | Missing or invalid token, or a token of the wrong kind. Create, list, get, rotate and archive require a human token. Connect and heartbeat require a worker token.                                                                  |
| `401 gateway.jwt.*`                          | All except `token`                                             | A claim of the token fails, for example `gateway.jwt.expired`. A worker token of an ended revision answers `gateway.jwt.instance_ended`.                                                                                            |
| `400 gateway.request.validation_failed`      | All                                                            | A query value or a body field fails the schema, for example an unknown field, a malformed `instance_id`, or a `connection_name` above 255 characters.                                                                               |
| `400 gateway.request.unexpected_body`        | `list`, `get`                                                  | The request has a body.                                                                                                                                                                                                             |
| `400 system.pagination.cursor_invalid`       | `list`                                                         | The cursor is not a cursor that this operation issued.                                                                                                                                                                              |
| `400 worker.instance.name_invalid`           | `create`                                                       | The name breaks the binding name form, or it is `server`, `token`, `connect` or `heartbeat`.                                                                                                                                        |
| `400 worker.instance.worker_invalid`         | `create`                                                       | The worker is unknown, or it is a worker of an external harness.                                                                                                                                                                    |
| `400 worker.instance.key_invalid`            | `create`, `rotate`                                             | `public_key` is no base64url 32-byte value, or all its bytes are zero. Also a body with both `public_key` and `endpoint`, or with neither.                                                                                          |
| `404 worker.instance.not_found`              | `get`, `rotate`, `archive`, `token`, `connect`                 | No instance has the name. For `token`, the `instance_id` is unknown or its revision ended. For `connect`, the revision ended during the request. A revision that ended before the request answers `401 gateway.jwt.instance_ended`. |
| `409 worker.instance.name_conflict`          | `create`                                                       | A live or an archived instance holds the name.                                                                                                                                                                                      |
| `409 worker.instance.key_conflict`           | `create`, `rotate`                                             | A revision of any instance holds the fingerprint of the key.                                                                                                                                                                        |
| `409 worker.instance.archived`               | `rotate`, `archive`                                            | The instance is archived.                                                                                                                                                                                                           |
| `409 worker.instance.revision_conflict`      | `rotate`, `archive`                                            | `expected_revision` is not the live revision. `details.revision` holds the live revision.                                                                                                                                           |
| `409 worker.instance.in_use`                 | `archive`                                                      | A current binding lists the instance; `details.bindings` lists `{ project_id, binding }`. Or a registration of the instance holds an execution; `details.executions` lists the execution IDs.                                       |
| `409 worker.instance.connection_superseded`  | `connect`, `heartbeat`                                         | Another connection of the instance is current. `details.connection_name` holds the name of the current connection.                                                                                                                  |
| `400 gateway.idempotency.invalid_key`        | `create`, `rotate`, `archive`, `connect`, `heartbeat`          | Missing or malformed idempotency key.                                                                                                                                                                                               |
| `409 gateway.idempotency.conflict`           | `create`, `rotate`, `archive`, `connect`, `heartbeat`          | Conflicting reuse of an idempotency key. For `create`, `rotate` and `connect`, also every repeated key, because the server never replays an answer that holds a secret.                                                             |
| `413 gateway.request.body_too_large`         | `create`, `rotate`, `archive`, `token`, `connect`, `heartbeat` | The body exceeds 10 MiB.                                                                                                                                                                                                            |
| `415 gateway.request.unsupported_media_type` | `create`, `rotate`, `archive`, `token`, `connect`, `heartbeat` | The request body is not `application/json`.                                                                                                                                                                                         |
| `504 gateway.invocation.timeout`             | All                                                            | The operation exceeded 30 seconds. A mutation can still complete.                                                                                                                                                                   |

Within the replay TTL, a repeated `archive` or `heartbeat` key with the same request and caller returns the recorded response.

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status` to stderr. For `create`, `rotate` and `archive`, the CLI also prints the row `idempotency_key`. A transport failure, timeout or malformed response exits `1` with an indeterminate code:

| Command   | Code                                        | Recovery                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`  | `cli.worker.instance.create.indeterminate`  | Run `worker instance get <name>`. When the name is free, run the create again. When the name holds a revision that this host did not receive, run `kanthord worker instance rotate <name> --expected-revision <revision> --output`. `<revision>` is the `revision` of the `get` answer. When the instance file exists, add `--force`. |
| `list`    | `cli.worker.instance.list.indeterminate`    | Run the command again.                                                                                                                                                                                                                                                                                                                |
| `get`     | `cli.worker.instance.get.indeterminate`     | Run the command again.                                                                                                                                                                                                                                                                                                                |
| `rotate`  | `cli.worker.instance.rotate.indeterminate`  | Run `worker instance get <name>`. When the revision did not change, run the rotate again. When the revision changed, no host holds the new private key. Run the rotate again with `--expected-revision <revision>`, the new revision. With `--output` and an existing instance file, add `--force`.                                   |
| `archive` | `cli.worker.instance.archive.indeterminate` | Run again with the reported `--idempotency-key`.                                                                                                                                                                                                                                                                                      |

A repeated key for `create` or `rotate` answers `409 gateway.idempotency.conflict`, so a retry with the same key does not recover the answer. A new create or rotate generates a new key pair.

## API shape

| Command     | Method and path                                     | Operation ID                | Access                     | Mutation |
| ----------- | --------------------------------------------------- | --------------------------- | -------------------------- | -------- |
| `create`    | `POST /api/worker/instance`                         | `worker.instance.create`    | `human` (human bearer JWT) | Yes      |
| `list`      | `GET /api/worker/instance`                          | `worker.instance.list`      | `human` (human bearer JWT) | No       |
| `get`       | `GET /api/worker/instance/:instance_name`           | `worker.instance.get`       | `human` (human bearer JWT) | No       |
| `rotate`    | `POST /api/worker/instance/:instance_name/revision` | `worker.instance.rotate`    | `human` (human bearer JWT) | Yes      |
| `archive`   | `POST /api/worker/instance/:instance_name/archive`  | `worker.instance.archive`   | `human` (human bearer JWT) | Yes      |
| `token`     | `POST /api/worker/instance/token`                   | `worker.instance.token`     | `public` (no token)        | No       |
| `connect`   | `POST /api/worker/instance/connect`                 | `worker.instance.connect`   | `worker` (worker JWT)      | Yes      |
| `heartbeat` | `POST /api/worker/instance/heartbeat`               | `worker.instance.heartbeat` | `worker` (worker JWT)      | Yes      |

Every operation has a timeout of 30 seconds. The body limit is 10 MiB. The Gateway skips the Host allowlist for the `token`, `connect` and `heartbeat` routes.

| Parameter          | In    | Operations                 | Default | Rule                                                       |
| ------------------ | ----- | -------------------------- | ------- | ---------------------------------------------------------- |
| `instance_name`    | path  | `get`, `rotate`, `archive` | None    | Instance name. An unknown name answers not found.          |
| `worker`           | query | `list`                     | None    | Returns the instances of this worker only.                 |
| `include_archived` | query | `list`                     | `false` | `true` or `false`. `true` also returns archived instances. |
| `limit`            | query | `list`                     | `100`   | Integer from `1` to `1000`.                                |
| `cursor`           | query | `list`                     | None    | `next_cursor` of the previous page.                        |

| Operation     | Request body                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `create`      | `{ "name", "worker", "public_key"? , "endpoint"? }`. `endpoint` is an absolute URL. Send exactly one of `public_key` and `endpoint`. |
| `rotate`      | `{ "expected_revision", "public_key"?, "endpoint"? }`. `expected_revision` is the live revision.                                     |
| `archive`     | `{ "expected_revision" }`.                                                                                                           |
| `token`       | `{ "instance_id" }`, the `worker_instance` identity of the live revision.                                                            |
| `connect`     | `{ "connection_id"?, "connection_name" }`. `connection_name` is 1 to 255 characters, for display only.                               |
| `heartbeat`   | `{ "connection_id", "connection_name" }`.                                                                                            |
| `list`, `get` | None.                                                                                                                                |

| Header            | Required                                              | Purpose                                                                 |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `Authorization`   | All except `token`                                    | `Bearer <human-jwt>` or `Bearer <worker-jwt>`, as in the access column. |
| `Idempotency-Key` | `create`, `rotate`, `archive`, `connect`, `heartbeat` | Fresh `idempotency_key_<ulid>` for a new request.                       |
| `Content-Type`    | Operations with a body                                | `application/json`.                                                     |

```sh
curl -i -X POST http://127.0.0.1:31415/api/worker/instance \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"name":"builder-1","worker":"coder@1","endpoint":"https://kanthord.example.com"}'

curl -i 'http://127.0.0.1:31415/api/worker/instance?worker=coder@1&include_archived=true' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/worker/instance/builder-1 \
  -H 'Authorization: Bearer <human-jwt>'

curl -i -X POST http://127.0.0.1:31415/api/worker/instance/builder-1/archive \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PSD' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":2}'

curl -i -X POST http://127.0.0.1:31415/api/worker/instance/token \
  -H 'Content-Type: application/json' \
  -d '{"instance_id":"worker_instance_01M34JC4BJ66JHP41M4MYY6PST"}'
```

## CLI shape

```text
kanthord worker instance create <name> --worker <worker> [--worker-endpoint <url>] [--output [--force]] [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
kanthord worker instance list [--worker <worker>] [--include-archived] [--limit <count>] [--cursor <opaque>] [--token <jwt>] [--endpoint <url>]
kanthord worker instance get <name> [--token <jwt>] [--endpoint <url>]
kanthord worker instance rotate <name> --expected-revision <revision> [--worker-endpoint <url>] [--output [--force]] [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
kanthord worker instance archive <name> --expected-revision <revision> [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
kanthord worker join [--force]
```

```sh
kanthord worker instance create builder-1 --worker coder@1 --output
kanthord worker instance list --worker coder@1
kanthord worker instance get builder-1
kanthord worker instance rotate builder-1 --expected-revision 1 --output --force
kanthord worker instance archive builder-1 --expected-revision 2
```

`kanthord worker instance` without a subcommand displays help. No CLI command calls `token`, `connect` or `heartbeat`; `kanthord serve worker` calls them.

| Argument | Commands                             | Purpose        |
| -------- | ------------------------------------ | -------------- |
| `<name>` | `create`, `get`, `rotate`, `archive` | Instance name. |

The CLI refuses a malformed or reserved name with `worker.instance.name_invalid` before it sends a request.

### `worker instance create` and `worker instance rotate`

| Option                           | Default / resolution                 | Purpose                                                                                              |
| -------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `--worker <worker>`              | Required for `create`                | Hosted worker of the instance.                                                                       |
| `--expected-revision <revision>` | Required for `rotate`                | Live revision of the instance.                                                                       |
| `--worker-endpoint <url>`        | The resolved `--endpoint`            | Server address that the instance calls. The CLI writes it into the instance configuration.           |
| `--output`                       | Off                                  | Writes the instance file `workers/<name>.yaml` on this host in place of the configuration on stdout. |
| `--force`                        | Off                                  | With `--output`, overwrites an existing instance file.                                               |
| `--idempotency-key <key>`        | A generated `idempotency_key_<ulid>` | Sets the `Idempotency-Key` header.                                                                   |

Run the command with `--output` on the host of the instance. Without `--output`, stdout must be a terminal, because the line holds the private key.

The CLI checks the input before it sends a request:

| Code                                                                                     | Condition                                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `worker.instance.name_invalid`                                                           | The name breaks the binding name form or is reserved.                                      |
| `cli.worker.instance.force_without_output`                                               | `--force` without `--output`.                                                              |
| `cli.worker.instance.create.token_required`, `cli.worker.instance.rotate.token_required` | No nonblank token resolves.                                                                |
| `cli.config.invalid_endpoint`                                                            | `--worker-endpoint` is not an absolute HTTP(S) URL without credentials, query or fragment. |
| `cli.worker.join.config_exists`                                                          | `--output` without `--force`, and the instance file exists. The row `path` names it.       |
| `cli.output.terminal_required`                                                           | No `--output`, and stdout is not a terminal.                                               |
| `cli.idempotency_key.invalid`                                                            | `--idempotency-key` is not an `idempotency_key_<ulid>` value.                              |
| `cli.worker.instance.revision_invalid`                                                   | `rotate`: `--expected-revision` is absent or not a positive integer.                       |

### `worker instance list`

| Option               | Default / resolution | Purpose                                     |
| -------------------- | -------------------- | ------------------------------------------- |
| `--worker <worker>`  | None                 | Sets the query `worker`.                    |
| `--include-archived` | Off                  | Sets `include_archived=true`.               |
| `--limit <count>`    | `100`                | Page size; a positive integer up to `1000`. |
| `--cursor <opaque>`  | None (first page)    | `next_cursor` of the previous page.         |

`--limit` fails with `cli.pagination.limit_invalid` when it is not a positive decimal integer, and with `cli.pagination.limit_out_of_range` above `1000`. A missing token fails with `cli.worker.instance.list.token_required`.

### `worker instance get`

There are no command options. A missing token fails with `cli.worker.instance.get.token_required`.

### `worker instance archive`

| Option                           | Default / resolution                 | Purpose                                                             |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `--expected-revision <revision>` | Required                             | Live revision of the instance.                                      |
| `--idempotency-key <key>`        | A generated `idempotency_key_<ulid>` | Sets the `Idempotency-Key` header; supply the same key for a retry. |

The success line adds `idempotency_key` to the archived record. `--expected-revision` that is absent or not a positive integer fails with `cli.worker.instance.revision_invalid`. A missing token fails with `cli.worker.instance.archive.token_required`.

### `worker join`

`kanthord worker join` reads the instance configuration from stdin and writes the instance file `workers/<name>.yaml`, with mode `0600`. It sends no request. On success, it prints the row `created: <path>` and exits `0`.

| Option    | Default / resolution | Purpose                               |
| --------- | -------------------- | ------------------------------------- |
| `--force` | Off                  | Overwrites an existing instance file. |

```sh
kanthord worker join < builder-1.configuration
```

A value that is no base64url JSON of the configuration schema fails with `worker.instance.config_invalid`. An existing file without `--force` fails with `cli.worker.join.config_exists` and the row `path`.

### Shared options

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

A repeated value option other than `--endpoint` fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration) for the token and endpoint precedence. The HTTP client deadline is 31 seconds.
