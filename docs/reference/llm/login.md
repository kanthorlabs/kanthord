# Log in to a subscription LLM platform

[Reference index](../README.md)

## Function description

The login flow creates an LLM credential for a platform with the secret shape `oauth`. The human signs in to the platform account; the server stores the OAuth tokens. No answer and no session status exposes a token.

The flow has three commands:

- `login` starts a login session and returns an address, an optional user code, and an expiry.
- `login-code` supplies a value that the session awaits, for example a code or a redirect URL.
- `login-status` reads the state of a session. It does not wait for completion and does not change the session.

### Login on a worker instance

`login --holder <instance>` runs the flow on a worker instance, not on the server. The new credential is the copy of that holder. The default holder is `server`.

- The instance must hold a current connection: its last heartbeat is at most 60 seconds old. Start `kanthord serve worker --instance <instance>` first.
- The instance receives the session in its next heartbeat answer, at most 15 seconds later. While a session is pending, the instance sends a heartbeat every 2 seconds.
- `anthropic-subscription` uses `copy_code` mode. `openai-codex` and `github-copilot` use `device` mode. An instance session never uses `browser` mode.
- The instance reports the address and the code. The human submits the `code#state` value with `login-code`, and the value reaches the instance in its next heartbeat.
- The instance seals the OAuth tokens to its own key. The server stores only the sealed copy, with `sealed_to` set to the instance key fingerprint. The server never holds the plaintext tokens.
- A new copy gets revision 1. A copy sealed to an ended key, for example after Reset key, gets the next revision. The older revisions then end as after a rotation.
- A copy that holds a live revision sealed to the current key refuses a new login. An archived copy refuses a new login.
- The instance refreshes its own copy in an execution and reports the refreshed copy sealed.

### Platforms and modes

| Platform                 | Login modes         | Default mode |
| ------------------------ | ------------------- | ------------ |
| `github-copilot`         | `device`            | `device`     |
| `openai-codex`           | `browser`, `device` | `browser`    |
| `anthropic-subscription` | `copy_code`         | `copy_code`  |

A platform with one mode ignores the requested mode. In `browser` mode, the address is an authorization URL and the code is `null`. In `device` mode, the address is a verification URL and the code is the user code. In `copy_code` mode, the address is an authorization URL, the code is `null`, and the human submits the `code#state` value that the provider shows.

### Session rules

- A session expires 15 minutes after its start.
- One human has at most one `pending` session for each platform, over every holder.
- The credential name follows the [credential name rules](credential.md#credential-names). The name must be free at the start and again at completion.
- Sessions live in the memory of the server process. A restart or a shutdown ends them; a shutdown fails every `pending` session.
- The `login` request returns when the platform supplies the address. The session then continues on the server.

On completion, the server stores the credential as revision 1 with `metadata: null`, and the session state becomes `completed`. A failed or expired session stores nothing. The new credential then appears in [`llm credential get`](credential.md).

### Session states

| State       | Meaning                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `pending`   | The session waits for the human to finish the platform interaction.                                   |
| `completed` | The server stored the credential.                                                                     |
| `failed`    | The flow stopped without a credential. `failure_reason` holds an engine error code or `login failed`. |
| `expired`   | The session reached its expiry while `pending`. The server stored nothing.                            |

A session that a restart lost answers `404 credential.login.not_found`.

## Expected response

### login

The API returns HTTP `200`:

```json
{
  "session_id": "login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W",
  "address": "<verification-url>",
  "code": "<user-code>",
  "expires_at": 1791418500000
}
```

| Property     | Type                   | Purpose                                                                      |
| ------------ | ---------------------- | ---------------------------------------------------------------------------- |
| `session_id` | `login_session_<ulid>` | [Identity](../identities.md) of the login session.                           |
| `address`    | string                 | URL that the human opens.                                                    |
| `code`       | string or `null`       | User code to enter at the address; `null` in `browser` and `copy_code` mode. |
| `expires_at` | integer                | Session expiry in Unix milliseconds.                                         |

The CLI writes `name: value` rows to stdout, not JSON, and exits `0`. The rows are `session_id`, `code`, `expires_at` and `idempotency_key`. The row `code` is absent when the code is `null`. The value of `expires_at` is an ISO 8601 UTC time. The rows align. After one empty line, the label row `address:` follows, and the next line holds the bare URL.

```text
session_id:      login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W
code:            <user-code>
expires_at:      2026-10-08T00:15:00.000Z
idempotency_key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST

address:
<verification-url>
```

### login-code

The API returns HTTP `200` with `{ "session_id": "<login-session-id>" }`. The CLI adds the retry key and writes one JSON line:

```json
{
  "session_id": "login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W",
  "idempotency_key": "idempotency_key_01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property          | Type                            | Surface     | Purpose                                  |
| ----------------- | ------------------------------- | ----------- | ---------------------------------------- |
| `session_id`      | `login_session_<ulid>`          | API and CLI | Session that received the value.         |
| `idempotency_key` | `idempotency_key_<ulid>` string | CLI only    | Key of the request; keep it for a retry. |

### login-status

The API returns HTTP `200`. The CLI writes the same object as one JSON line:

```json
{
  "session_id": "login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W",
  "state": "pending",
  "last_message": null,
  "failure_reason": null
}
```

| Property         | Type                   | Purpose                                                      |
| ---------------- | ---------------------- | ------------------------------------------------------------ |
| `session_id`     | `login_session_<ulid>` | Session identity.                                            |
| `state`          | string                 | `pending`, `completed`, `failed` or `expired`.               |
| `last_message`   | string or `null`       | Last progress or information message from the platform flow. |
| `failure_reason` | string or `null`       | Reason of a `failed` session; otherwise `null`.              |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). The shared gateway failures of the [credential page](credential.md#failures) also apply: authentication, request validation, body limit, media type, timeout, and the idempotency failures of `login` and `login-code`.

| HTTP status / code                          | Commands                     | Meaning                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 credential.platform.unsupported`       | `login`                      | The platform is not an LLM platform.                                                                                                                                               |
| `400 credential.entry.unsupported`          | `login`                      | The platform has the secret shape `api_key`; use `llm credential create`.                                                                                                          |
| `400 credential.input.invalid`              | `login`                      | Invalid or reserved name, or a `mode` other than `browser`, `device` or `copy_code`.                                                                                               |
| `400 credential.login.browser_unavailable`  | `login`                      | `browser` mode through a non-loopback `Host`, or for an instance holder.                                                                                                           |
| `400 llm.credential.instance_unknown`       | `login`                      | `holder` names no live worker instance.                                                                                                                                            |
| `409 credential.login.instance_unavailable` | `login`                      | The instance holds no current connection, or its last heartbeat is older than 60 seconds.                                                                                          |
| `409 credential.name.conflict`              | `login`                      | The name is taken. For an instance holder: the copy holds a live revision sealed to the current key. `details.id` holds the identity of that revision.                             |
| `409 credential.credential.archived`        | `login`                      | The copy of the instance holder is archived. An archive is final.                                                                                                                  |
| `409 credential.login.pending`              | `login`                      | The human already has a `pending` session for this platform.                                                                                                                       |
| `503 credential.login.failed`               | `login`                      | The flow failed before an address.                                                                                                                                                 |
| `503 llm.lifecycle.stopped`                 | `login`                      | The LLM component stopped and accepts no login.                                                                                                                                    |
| `504 gateway.invocation.timeout`            | `login`                      | The platform supplied no address within the 30-second timeout. For an instance holder, the 30 seconds include the wait for the next heartbeat of the instance.                     |
| `404 credential.login.not_found`            | `login-code`, `login-status` | The session is unknown, or a restart lost it.                                                                                                                                      |
| `409 credential.login.value_not_awaited`    | `login-code`                 | The session does not await a value, or the session is no longer `pending`. An instance session takes one value, in `copy_code` mode only, after the instance reported the address. |

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr. For `login` and `login-code`, the CLI prints `<code>: request failed` and the rows `status: <status>` and `idempotency_key: <key>` instead. A transport failure, timeout or malformed response exits `1` with `cli.llm.credential.login.indeterminate`, `cli.llm.credential.login_code.indeterminate` or `cli.llm.credential.login_status.indeterminate`.

Local CLI failures exit `1` before a request:

| Code                                                                                                                                        | Meaning                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `cli.llm.credential.login.invalid_mode`                                                                                                     | `--mode` is not `browser`, `device` or `copy_code`.           |
| `cli.llm.credential.login.token_required`, `cli.llm.credential.login_code.token_required`, `cli.llm.credential.login_status.token_required` | No nonblank token resolves.                                   |
| `cli.idempotency_key.invalid`                                                                                                               | `--idempotency-key` is not an `idempotency_key_<ulid>` value. |
| `cli.option.duplicate`                                                                                                                      | A single-use option appears twice.                            |

## API shape

| Command        | Method and path                                     | Operation ID                  | Mutation | Body limit |
| -------------- | --------------------------------------------------- | ----------------------------- | -------- | ---------- |
| `login`        | `POST /api/llm/credential/login`                    | `llm.credential.login`        | Yes      | 16 KiB     |
| `login-code`   | `POST /api/llm/credential/login/:session_id/code`   | `llm.credential.login_code`   | Yes      | 16 KiB     |
| `login-status` | `GET /api/llm/credential/login/:session_id`         | `llm.credential.login_status` | No       | No body    |
| none           | `POST /api/llm/credential/login/:session_id/report` | `llm.credential.login_report` | Yes      | 64 KiB     |

Every command uses human access and has a 30-second timeout. `llm.credential.login_report` uses `worker` access: only the worker instance of the session calls it, and it answers `204`. Its failures are `404 credential.login.not_found` for an unknown, ended or expired session or a session of another instance, and `400 credential.input.invalid` for a `completed` report without `sealed`, another report with `sealed`, an address that is no `https:` URL, or a second address. A refused write fails the session with its code, for example `400 credential.sealed.invalid`.

| Header            | Required              | Purpose                                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------------------------- |
| `Authorization`   | Yes                   | `Bearer <human-jwt>`.                                                        |
| `Content-Type`    | `login`, `login-code` | `application/json`.                                                          |
| `Idempotency-Key` | `login`, `login-code` | Fresh `idempotency_key_<ulid>` for a new request; reuse it only for a retry. |

A retry with the same key, caller and request replays the recorded answer within the process-local idempotency TTL. A replay of `login` returns the recorded session and starts no new session.

### login

The body is `{ platform, name, mode?, holder? }`. `platform` and `name` are required strings. `mode` is `browser`, `device` or `copy_code`. `holder` is `server` or a worker instance name, and defaults to `server`.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/login \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"platform":"openai-codex","name":"team-codex","mode":"device"}'
```

### login-code

The path parameter `session_id` is required. The body is `{ value }`, a nonempty string.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/login/login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W/code \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"value":"<redirect-url-or-code>"}'
```

### login-status

The path parameter `session_id` is required.

```sh
curl -i http://127.0.0.1:31415/api/llm/credential/login/login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord llm credential login <platform> --name <name> [--mode browser|device|copy_code] [--holder <name>] [--idempotency-key <key>]
kanthord llm credential login-code <session> <value> [--idempotency-key <key>]
kanthord llm credential login-status <session>
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord llm credential login github-copilot --name team-copilot
kanthord llm credential login anthropic-subscription --name claude --holder e2e-coder-1
kanthord llm credential login-status login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W
kanthord llm credential login-code login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W '<redirect-url-or-code>'
```

| Positional argument | Commands                     | Purpose                                                                       |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `<platform>`        | `login`                      | OAuth platform: `github-copilot`, `openai-codex` or `anthropic-subscription`. |
| `<session>`         | `login-code`, `login-status` | Login session ID; sent as the `session_id` path parameter.                    |
| `<value>`           | `login-code`                 | Code, redirect URL or `code#state` value that the session awaits.             |

| Option                    | Commands              | Default / resolution                                                        | Purpose                                                             |
| ------------------------- | --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--token <jwt>`           | All                   | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                            |
| `--endpoint <url>`        | All                   | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                    |
| `--name <name>`           | `login`               | Required                                                                    | Name of the new credential.                                         |
| `--mode <mode>`           | `login`               | Absent; the platform default applies                                        | `browser`, `device` or `copy_code`.                                 |
| `--holder <name>`         | `login`               | `server`                                                                    | Holder of the new copy: `server` or a worker instance name.         |
| `--idempotency-key <key>` | `login`, `login-code` | A generated `idempotency_key_<ulid>`                                        | Sets the `Idempotency-Key` header; supply the same key for a retry. |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. Each option is single-use. `login-status` rejects `--idempotency-key` as an unknown option. No command prompts for input or waits for completion; call `login-status` again to follow the session.

The HTTP client has a 31-second deadline for these 30-second operations.
