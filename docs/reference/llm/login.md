# Log in to a subscription LLM platform

[Reference index](../README.md)

## Function description

The login flow creates an LLM credential for a platform with the secret shape `oauth`. The human signs in to the platform account; the server stores the OAuth tokens. No answer and no session status exposes a token.

The flow has three commands:

- `login` starts a login session and returns an address, an optional user code, and an expiry.
- `login-code` supplies a value that the session awaits, for example a code or a redirect URL.
- `login-status` reads the state of a session. It does not wait for completion and does not change the session.

### Platforms and modes

| Platform         | Login modes         | Default mode |
| ---------------- | ------------------- | ------------ |
| `github-copilot` | `device`            | `device`     |
| `openai-codex`   | `browser`, `device` | `browser`    |

A platform with one mode ignores the requested mode. In `browser` mode, the address is an authorization URL and the code is `null`. In `device` mode, the address is a verification URL and the code is the user code.

### Session rules

- A session expires 15 minutes after its start.
- One human has at most one `pending` session for each platform.
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

| Property     | Type                   | Purpose                                                      |
| ------------ | ---------------------- | ------------------------------------------------------------ |
| `session_id` | `login_session_<ulid>` | [Identity](../identities.md) of the login session.           |
| `address`    | string                 | URL that the human opens.                                    |
| `code`       | string or `null`       | User code to enter at the address; `null` in `browser` mode. |
| `expires_at` | integer                | Session expiry in Unix milliseconds.                         |

The CLI writes five lines to stdout, not JSON, and exits `0`: the session ID, the address, the code (an empty line when `null`), the expiry, and the idempotency key.

```text
login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W
<verification-url>
<user-code>
1791418500000
01M34JC4BJ66JHP41M4MYY6PST
```

### login-code

The API returns HTTP `200` with `{ "session_id": "<login-session-id>" }`. The CLI adds the retry key and writes one JSON line:

```json
{
  "session_id": "login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W",
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property          | Type                   | Surface     | Purpose                                  |
| ----------------- | ---------------------- | ----------- | ---------------------------------------- |
| `session_id`      | `login_session_<ulid>` | API and CLI | Session that received the value.         |
| `idempotency_key` | canonical ULID string  | CLI only    | Key of the request; keep it for a retry. |

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

| HTTP status / code                       | Commands                     | Meaning                                                                    |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `400 credential.platform.unsupported`    | `login`                      | The platform is not an LLM platform.                                       |
| `400 credential.entry.unsupported`       | `login`                      | The platform has the secret shape `api_key`; use `llm credential create`.  |
| `400 credential.input.invalid`           | `login`                      | Invalid or reserved name, or a `mode` other than `browser` or `device`.    |
| `409 credential.name.conflict`           | `login`                      | The name is taken. `details.id` holds the identity of its newest revision. |
| `409 credential.login.pending`           | `login`                      | The human already has a `pending` session for this platform.               |
| `503 credential.login.failed`            | `login`                      | The flow failed before an address.                                         |
| `503 llm.lifecycle.stopped`              | `login`                      | The LLM component stopped and accepts no login.                            |
| `504 gateway.invocation.timeout`         | `login`                      | The platform supplied no address within the 30-second timeout.             |
| `404 credential.login.not_found`         | `login-code`, `login-status` | The session is unknown, or a restart lost it.                              |
| `409 credential.login.value_not_awaited` | `login-code`                 | The session does not await a value, or the session is no longer `pending`. |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. For `login` and `login-code`, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. A transport failure, timeout or malformed response exits `1` with `cli.llm.credential.login.indeterminate`, `cli.llm.credential.login_code.indeterminate` or `cli.llm.credential.login_status.indeterminate`.

Local CLI failures exit `1` before a request:

| Code                                                                                                                                        | Meaning                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `cli.llm.credential.login.invalid_mode`                                                                                                     | `--mode` is neither `browser` nor `device`.  |
| `cli.llm.credential.login.token_required`, `cli.llm.credential.login_code.token_required`, `cli.llm.credential.login_status.token_required` | No nonblank token resolves.                  |
| `cli.idempotency_key.invalid`                                                                                                               | `--idempotency-key` is not a canonical ULID. |
| `cli.option.duplicate`                                                                                                                      | A single-use option appears twice.           |

## API shape

| Command        | Method and path                                   | Operation ID                  | Mutation | Body limit |
| -------------- | ------------------------------------------------- | ----------------------------- | -------- | ---------- |
| `login`        | `POST /api/llm/credential/login`                  | `llm.credential.login`        | Yes      | 16 KiB     |
| `login-code`   | `POST /api/llm/credential/login/:session_id/code` | `llm.credential.login_code`   | Yes      | 16 KiB     |
| `login-status` | `GET /api/llm/credential/login/:session_id`       | `llm.credential.login_status` | No       | No body    |

Every operation uses human access and has a 30-second timeout.

| Header            | Required              | Purpose                                                            |
| ----------------- | --------------------- | ------------------------------------------------------------------ |
| `Authorization`   | Yes                   | `Bearer <human-jwt>`.                                              |
| `Content-Type`    | `login`, `login-code` | `application/json`.                                                |
| `Idempotency-Key` | `login`, `login-code` | Fresh canonical ULID for a new request; reuse it only for a retry. |

A retry with the same key, caller and request replays the recorded answer within the process-local idempotency TTL. A replay of `login` returns the recorded session and starts no new session.

### login

The body is `{ platform, name, mode? }`. `platform` and `name` are required strings. `mode` is `browser` or `device`.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/login \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"platform":"openai-codex","name":"team-codex","mode":"device"}'
```

### login-code

The path parameter `session_id` is required. The body is `{ value }`, a nonempty string.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/login/login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W/code \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
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
kanthord llm credential login <platform> --name <name> [--mode browser|device] [--idempotency-key <ulid>]
kanthord llm credential login-code <session> <value> [--idempotency-key <ulid>]
kanthord llm credential login-status <session>
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord llm credential login github-copilot --name team-copilot
kanthord llm credential login-status login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W
kanthord llm credential login-code login_session_01K6ZB3Q8X2M4N5P6R7S8T9V0W '<redirect-url-or-code>'
```

| Positional argument | Commands                     | Purpose                                                    |
| ------------------- | ---------------------------- | ---------------------------------------------------------- |
| `<platform>`        | `login`                      | OAuth platform: `github-copilot` or `openai-codex`.        |
| `<session>`         | `login-code`, `login-status` | Login session ID; sent as the `session_id` path parameter. |
| `<value>`           | `login-code`                 | Code or redirect URL that the session awaits.              |

| Option                     | Commands              | Default / resolution                                                        | Purpose                                                             |
| -------------------------- | --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--token <jwt>`            | All                   | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                            |
| `--endpoint <url>`         | All                   | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                    |
| `--name <name>`            | `login`               | Required                                                                    | Name of the new credential.                                         |
| `--mode <mode>`            | `login`               | Absent; the platform default applies                                        | `browser` or `device`.                                              |
| `--idempotency-key <ulid>` | `login`, `login-code` | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key for a retry. |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. Each option is single-use. `login-status` rejects `--idempotency-key` as an unknown option. No command prompts for input or waits for completion; call `login-status` again to follow the session.

The HTTP client has a 31-second deadline for these 30-second operations.
