# SSH host keys

[Reference index](../README.md)

## Function description

A host key pin is the one ed25519 host key that KanthorD trusts for an SSH host. The Repository component stores one pin for each host in the table `repository_host_key`. Each network git operation writes the pin of its address host into the `known_hosts` file of its [SSH agent](ssh-key.md#the-agent-of-one-operation), and ssh checks the host against that file only. ssh reads no `~/.ssh/known_hosts`.

A pin serves every binding whose address names its host. A host with no pin refuses each network git operation with `409 repository.host_key.unpinned` before any process starts. A binding apply refuses the same way, and a binding check or verify answers `failure_reason` `host_key_unknown`.

Only the hosts of the SSH host sets have a pin. A host compares without regard to case, and the answers hold it in lower case. A fixed table in the engine gives the SSH port of each host. You cannot set a port.

| Platform    | SSH host set                            | Source of the key                                            |
| ----------- | --------------------------------------- | ------------------------------------------------------------ |
| `github`    | `github.com`, `ssh.github.com`          | `github_meta`: `GET https://api.github.com/meta`             |
| `gitlab`    | `gitlab.com`, `altssh.gitlab.com`       | `keyscan`: `ssh-keyscan -T 5 -t ed25519 -p <port> -- <host>` |
| `bitbucket` | `bitbucket.org`, `altssh.bitbucket.org` | `keyscan`: `ssh-keyscan -T 5 -t ed25519 -p <port> -- <host>` |

| Host                                        | SSH port | `known_hosts` line   |
| ------------------------------------------- | -------- | -------------------- |
| `altssh.gitlab.com`, `altssh.bitbucket.org` | 443      | `[<host>]:443 <key>` |
| every other host of the table above         | 22       | `<host> <key>`       |

`altssh.gitlab.com` and `altssh.bitbucket.org` answer SSH on port 443 only. Use them when a network blocks the outbound port 22. The address keeps the form `git@<host>:<owner>/<repository>.git` and takes no port, for example `git@altssh.gitlab.com:acme/app.git`. The scan, the `known_hosts` line and each git operation use the port of the table. The pin stores the bare host name, so `list`, `scan` and `pin` answer `host` without a port.

### list

`list` returns one page of pins in ascending `host` order. The server derives `fingerprint` and `source` from the stored key and the host on each read.

### scan

`scan` reads the current ed25519 key of one host and writes nothing. For a GitHub host, the server reads the `ssh_keys` list of the GitHub meta answer over TLS and takes the entry that starts with `ssh-ed25519 `. For every other host, the server runs `ssh-keyscan` on the port of the host, skips its comment lines, and takes the `ssh-ed25519` line of the host. On port 443 that line starts with `[<host>]:443`. `ssh-keyscan` reads no SSH configuration file. The read has a 10-second deadline.

### pin

`pin` stores the key of a host after a human confirms its fingerprint:

1. Run `scan`, or read the fingerprint from the dashboard.
2. Compare it with the fingerprint that the provider publishes.
3. Send the confirmed fingerprint to `pin`.

The server reads the source again with a 10-second deadline. It pins only when the new read gives the confirmed fingerprint. Another fingerprint refuses the pin with `409 repository.host_key.changed`, and the earlier pin of the host stays. A successful pin replaces the earlier pin of the host: one transaction deletes the old row and inserts the new one. No operation removes the pin of a host without a replacement. The server logs the human identity, the host, the fingerprint and the source.

The workbench agent has no tool for `pin`, so only a human confirms a host key. The agent can call `list` and `scan`.

### A changed host key

When a host presents a key other than its pin, ssh writes "REMOTE HOST IDENTIFICATION HAS CHANGED". A binding check then answers `failure_reason` `host_key_changed`. A changed key can mean an interception. Compare the published fingerprint of the provider before you pin again. KanthorD never pins a new key without a human.

### Dashboard

- The binding sheet pins `github.com` and `ssh.github.com` without a confirmation, because the GitHub meta answer arrives over TLS. It shows "Host key pinned from api.github.com" with the fingerprint.
- For every other host, the binding sheet shows the scanned fingerprint, a link to the published fingerprints of the provider and `Confirm host key`. Save stays off until the pin exists.
- Credentials > Git holds the `Host keys` panel: one row for each pin, with its host, fingerprint, source, pin time and `Pin again`. `Pin again` scans the host and shows the scanned and the pinned fingerprint before `Confirm host key`.

## Expected response

Every API success returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`. The CLI `pin` adds `idempotency_key`, the canonical ULID that it sent.

### list

```json
{
  "items": [
    {
      "host": "github.com",
      "public_key": "ssh-ed25519 <base64>",
      "fingerprint": "SHA256:<43-base64-characters>",
      "source": "github_meta",
      "created_at": 1791441600000
    }
  ],
  "next_cursor": null
}
```

| Property              | Type             | Purpose                                                                         |
| --------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `items`               | array            | Pins of this page, in ascending `host` order.                                   |
| `items[].host`        | string           | SSH host in lower case.                                                         |
| `items[].public_key`  | string           | Pinned key, `ssh-ed25519 <base64>`.                                             |
| `items[].fingerprint` | string           | `SHA256:` fingerprint of the key, the form of `ssh-keygen -l`.                  |
| `items[].source`      | string           | `github_meta` for `github.com` and `ssh.github.com`; `keyscan` for other hosts. |
| `items[].created_at`  | integer          | Pin time in Unix milliseconds.                                                  |
| `next_cursor`         | string or `null` | Cursor of the next page; `null` on the last page.                               |

### scan

```json
{
  "host": "gitlab.com",
  "public_key": "ssh-ed25519 <base64>",
  "fingerprint": "SHA256:<43-base64-characters>",
  "source": "keyscan"
}
```

The properties are those of a `list` item without `created_at`.

### pin

The answer is the `list` item of the host after the pin.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Commands      | Meaning                                                                                                                    |
| -------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | All           | Missing, invalid, expired or banned token, or a machine token.                                                             |
| `400 gateway.request.validation_failed`      | All           | Params, query or body fail the schema, for example a `fingerprint` that is not `SHA256:` and 43 base64 characters.         |
| `400 gateway.request.invalid_json`           | `scan`, `pin` | The body is not valid JSON with unique object members.                                                                     |
| `415 gateway.request.unsupported_media_type` | `scan`, `pin` | The body is not `application/json`.                                                                                        |
| `413 gateway.request.body_too_large`         | `scan`, `pin` | The body exceeds 1 KiB.                                                                                                    |
| `400 gateway.request.unexpected_body`        | `list`        | The operation accepts no body.                                                                                             |
| `400 gateway.idempotency.invalid_key`        | `pin`         | Absent or malformed `Idempotency-Key`.                                                                                     |
| `409 gateway.idempotency.conflict`           | `pin`         | The key cannot be replayed for this request.                                                                               |
| `504 gateway.invocation.timeout`             | All           | The 30-second operation timeout expired.                                                                                   |
| `400 system.pagination.cursor_invalid`       | `list`        | The cursor is not a cursor of this list.                                                                                   |
| `400 repository.host_key.host_unsupported`   | `scan`, `pin` | The host is in no SSH host set; `details.host` holds it.                                                                   |
| `422 repository.host_key.scan_failed`        | `scan`, `pin` | The GitHub meta read or `ssh-keyscan` fails, reaches its deadline, or gives no ed25519 key; `details.host` holds the host. |
| `409 repository.host_key.changed`            | `pin`         | The second read gives another fingerprint; `details` holds `host` and the `fingerprint` of that read.                      |

The CLI exits `1` for every failure and writes a diagnostic line `<code>: <message>` to stderr, as [CLI diagnostics](../errors.md#cli-diagnostics) states.

| CLI code                                           | Commands | Meaning                                                                             |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `cli.repository.host_key.<command>.token_required` | All      | The resolved token is absent or blank. The CLI sends no request.                    |
| `cli.repository.host_key.<command>.indeterminate`  | All      | Transport failure, timeout or malformed response. For `pin`, retry with the key.    |
| `cli.repository.host_key.pin.fingerprint_invalid`  | `pin`    | `--fingerprint` is not `SHA256:` and 43 base64 characters. The CLI checks it first. |
| `cli.idempotency_key.invalid`                      | `pin`    | `--idempotency-key` is not a canonical ULID.                                        |
| `cli.option.duplicate`                             | All      | An option occurs more than once.                                                    |

## API shape

Every operation uses the `human` access policy and a 30-second timeout. `scan` and `pin` also apply a 10-second read deadline.

| Header            | Required    | Purpose                                                       |
| ----------------- | ----------- | ------------------------------------------------------------- |
| `Authorization`   | Yes         | `Bearer <human-jwt>`.                                         |
| `Content-Type`    | With a body | `application/json`.                                           |
| `Idempotency-Key` | `pin`       | Canonical ULID; reuse the same key to retry the same request. |

### list

| Item            | Value                          |
| --------------- | ------------------------------ |
| Method and path | `GET /api/repository/host-key` |
| Operation ID    | `repository.host_key.list`     |
| Mutation        | No                             |
| Request body    | None                           |

| Query parameter | Required | Value                                              |
| --------------- | -------- | -------------------------------------------------- |
| `limit`         | No       | Positive integer, at most `1000`; default `100`.   |
| `cursor`        | No       | Nonempty `next_cursor` value of the previous page. |

```sh
curl -i http://127.0.0.1:31415/api/repository/host-key \
  -H 'Authorization: Bearer <human-jwt>'
```

### scan

| Item            | Value                                |
| --------------- | ------------------------------------ |
| Method and path | `POST /api/repository/host-key/scan` |
| Operation ID    | `repository.host_key.scan`           |
| Mutation        | No; no `Idempotency-Key`             |
| Body limit      | 1 KiB                                |

| Body field | Required | Value                      |
| ---------- | -------- | -------------------------- |
| `host`     | Yes      | A host of an SSH host set. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/host-key/scan \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"host":"gitlab.com"}'
```

### pin

| Item            | Value                                |
| --------------- | ------------------------------------ |
| Method and path | `PUT /api/repository/host-key/:host` |
| Operation ID    | `repository.host_key.pin`            |
| Mutation        | Yes                                  |
| Parameters      | `host`, a host of an SSH host set    |
| Body limit      | 1 KiB                                |

| Body field    | Required | Value                                                          |
| ------------- | -------- | -------------------------------------------------------------- |
| `fingerprint` | Yes      | The confirmed fingerprint: `SHA256:` and 43 base64 characters. |

```sh
curl -i -X PUT http://127.0.0.1:31415/api/repository/host-key/gitlab.com \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"fingerprint":"SHA256:<43-base64-characters>"}'
```

## CLI shape

```text
kanthord repository host-key list [--token <jwt>] [--endpoint <url>]
kanthord repository host-key scan <host> [--token <jwt>] [--endpoint <url>]
kanthord repository host-key pin <host> --fingerprint <SHA256:...> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord repository host-key list
kanthord repository host-key scan gitlab.com
kanthord repository host-key pin gitlab.com --fingerprint 'SHA256:<43-base64-characters>'
```

Invoke `kanthord repository host-key` without a command to show its help.

| Argument | Commands      | Value                                                           |
| -------- | ------------- | --------------------------------------------------------------- |
| `<host>` | `scan`, `pin` | SSH host; sent as `body.host` by `scan` and as `host` by `pin`. |

| Option                       | Commands | Default / resolution                                                  | Purpose                                                                |
| ---------------------------- | -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--fingerprint <SHA256:...>` | `pin`    | Required; no default                                                  | Sets `body.fingerprint`.                                               |
| `--idempotency-key <ulid>`   | `pin`    | A generated canonical ULID                                            | Sets the `Idempotency-Key` header; supply the same key when you retry. |
| `--token <jwt>`              | All      | `KANTHORD_TOKEN` → client-file token; a nonblank token is required    | Human JWT sent in the `Authorization` header.                          |
| `--endpoint <url>`           | All      | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL.                                                       |

Each option is single-use. The CLI `list` sends no `limit` and no `cursor`, so it prints the first page of at most 100 pins. Use the API for a later page. See [client configuration](../README.md#client-configuration).
