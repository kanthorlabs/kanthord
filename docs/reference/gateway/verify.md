# Verify a human JWT

[Reference index](../README.md)

## Function description

Verify a human bearer JWT and return its business properties under their original claim names. The API and `kanthord gateway verify` perform the same read operation; neither creates an idempotency record.

Authentication checks the signature, expiry, claim types, username and display-name validity, and session bans. Human tokens cannot carry `binding` or `reg`. Generate a token locally with [JWT generation](../jwt.md).

## Expected response

The API returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`; redirected stdout is allowed.

```json
{ "kind": "human", "sub": "ulrich", "name": "ulrich" }
```

| Property | Type      | Purpose                                                          |
| -------- | --------- | ---------------------------------------------------------------- |
| `kind`   | `"human"` | Identifies the verified token as a human identity.               |
| `sub`    | string    | Signed username, preserved exactly without trimming or renaming. |
| `name`   | string    | Signed display name, preserved exactly; grants no authority.     |

There are no aliases such as `accountId`, raw token, signing key, or token metadata (`iat`, `exp`, `jti`) in the response.

### Failures

Missing, malformed, tampered, expired, banned, or wrong-key tokens receive HTTP `401 gateway.authentication.unauthorized`; a valid machine identity also fails the human access policy. API failures use the shared [error envelope](../errors.md#api-failures).

A declared API failure makes the CLI exit `1` with its error code and HTTP status in a diagnostic. A transport failure, timeout, or invalid response produces an indeterminate-result diagnostic and exits `1`.

## API shape

| Item                  | Value                  |
| --------------------- | ---------------------- |
| Method and path       | `GET /api/auth/verify` |
| Operation ID          | `gateway.verify`       |
| Access                | Human bearer JWT       |
| Timeout               | 10 seconds             |
| Path/query parameters | None                   |
| Request body          | None                   |

| Header          | Required | Purpose                                         |
| --------------- | -------- | ----------------------------------------------- |
| `Authorization` | Yes      | `Bearer <jwt>` containing the human credential. |

```sh
curl -i http://127.0.0.1:31415/api/auth/verify \
  -H 'Authorization: Bearer <jwt>'
```

## CLI shape

```text
kanthord gateway verify [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord gateway verify --token '<jwt>' --endpoint http://127.0.0.1:31415
kanthord gateway verify
```

There are no positional arguments.

| Option             | Default / resolution                                                  | Purpose                                       |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token                                  | Human JWT sent in the `Authorization` header. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL.                              |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. There is no login or credential-saving command. Missing credentials are submitted without an Authorization header and receive HTTP `401` from a ready server. The HTTP client has an 11-second deadline for this 10-second operation.
