# SSH keys

[Reference index](../README.md)

## Function description

An SSH key is a [repository credential](credential.md) of the platform `ssh`. The server generates the key and keeps it. A repository binding names the credential in `ssh_credential`. KanthorD uses the key for every network git operation of that binding: the binding apply, check and verify, the instruction file read, the clone, fetch and push of a worker, and the `git.merge_push` action.

| Fact          | Value                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key type      | ed25519. The server generates the key; no command accepts a key.                                                                                                                                |
| Secret        | `{ "private_key" }`, an unencrypted `openssh-key-v1` text of at most 4096 bytes. Custody encrypts it with AES-256-GCM in the credential store. No answer and no log holds it.                   |
| Metadata      | `{ "public_key", "fingerprint" }`. The server derives both fields.                                                                                                                              |
| `public_key`  | `ssh-ed25519 <base64> kanthord-<credential name>`.                                                                                                                                              |
| `fingerprint` | `SHA256:` and 43 base64 characters: the SHA-256 of the key blob, the form of `ssh-keygen -l`.                                                                                                   |
| Host          | None. The record names no host. The [host key pin](host-key.md) of the address host and the deploy key of the repository decide the access.                                                     |
| Entry         | Only `ssh-key-create` creates an `ssh` credential, and only `ssh-key-rotate` adds a revision. `list`, `get`, `verify`, `revoke` and `archive` of [repository credentials](credential.md) apply. |

The generic `create`, `rotate` and `update-metadata` of an `ssh` credential answer `400 credential.entry.unsupported`. The generic `check` of the platform `ssh` answers `400 credential.check.unsupported`.

### ssh-key-create

`ssh-key-create` generates a key and stores it as revision 1 of a new `ssh` credential. The name follows the rule of [repository credentials](credential.md#function-description). The answer holds the public key and the fingerprint. Custody logs the human identity and the revision identity, never the key.

Add the public key to the repository as a deploy key:

1. In the repository, open Settings > Deploy keys > Add deploy key.
2. Paste the key.
3. Select Allow write access.

One deploy key serves one repository. Create one SSH key for each repository. An account SSH key serves every repository of the account and gives the server write access to all of them.

To connect a new repository, do these steps in order:

1. Create the SSH key with `ssh-key-create`, or with Create SSH key in the dashboard.
2. Add its public key as a deploy key with write access, as above.
3. Pin the host key of the address host with [`host-key pin`](host-key.md#pin). The dashboard binding sheet pins `github.com` and `ssh.github.com` itself.
4. Optional: run [`project binding check`](../project/binding.md#project-binding-check). Its `address` entry answers `healthy` when the host, the pin and the deploy key are correct.
5. Save the repository binding: [export](../project/binding.md#project-binding-export) the binding set, add the binding with the address `git@<host>:<owner>/<repository>.git` and the credential name in `ssh_credential`, then [apply](../project/binding.md#project-binding-apply) it with the exported version. The dashboard binding sheet does the same with Save.

In the dashboard, open Credentials > Git and select Create SSH key. The sheet asks for the name only. It then shows the public key with Copy, the fingerprint and the deploy key steps.

### ssh-key-rotate

`ssh-key-rotate` generates a new key and inserts the next revision in one transaction. The same transaction drains each older live revision that no live execution pins. A drained revision gets `ended_at` at once. An execution that pins an older revision keeps that key until the execution ends.

Every new operation uses the new key at once. Until the repository holds the new public key as a deploy key, the remote refuses the key. Between steps 1 and 2 below, every network git operation of those bindings fails, and the binding check answers `failure_reason` `key_refused`. Keep that window short. Rotate in this order:

1. Rotate the key and copy the new public key.
2. Add the new public key as a deploy key of each repository that a binding of the credential names. `get` lists the bindings.
3. Verify each binding.
4. Wait until the older revision shows `ended_at`. It shows it at once when no live execution pins it, else at the first drain after the last pinning execution ends, for example a `get` of the credential.
5. Delete the old deploy key at the repository host.

To end a compromised key, rotate it, [revoke](credential.md#revoke) the older revision if it is still live, then delete its deploy key. A revoke of a revision that the rotation already drained answers `409 credential.revision.ended`.

In the dashboard, the row of an `ssh` credential holds `Rotate key`. The dialog shows the new public key and the bindings of the credential.

### A legacy credential

A legacy credential is an `ssh` credential whose newest live revision holds no generated key, for example a credential of the earlier SSH alias model. A binding apply, the instruction file read, the handover and every git operation refuse a legacy credential with `409 repository.credential.ssh_key_legacy` and `details.credential`. A binding check or verify reports `failure_reason` `identity_unavailable` in the `address` entry. The `verify` of the credential answers `unhealthy` with `failure_reason` `identity_unavailable`. `ssh-key-rotate` accepts a legacy credential and replaces it with a generated key. Then add the new deploy key.

### The agent of one operation

Each network git operation runs its own SSH agent. Steps 2 to 8 run on the server and on a worker host:

1. The server reads the pinned host key of the address host. For a worker, the execution setup carries it. A host with no pin refuses with `409 repository.host_key.unpinned` before any process starts.
2. Delete each expired agent directory of the same user. A directory is expired when its deadline lies more than 60 seconds in the past and its socket accepts no connection.
3. Create the directory `kd-ssh-<deadline>-<6 characters>` in the temporary directory of the host, with mode `0700`. `<deadline>` is the deadline in Unix milliseconds, in base 36.
4. Write `id.pub` (the public key) and `known_hosts` (the pinned line), each with mode `0600`. The directory holds no private key file.
5. Start `ssh-agent -a <directory>/a cat`. The process runs `cat`, and the agent checks every 10 seconds that `cat` lives. KanthorD holds the standard input of `cat`, so a crash of KanthorD ends `cat` and then the agent within about 10 seconds.
6. Load the key through the standard input of `ssh-add -t <seconds> -`. `<seconds>` is the remaining deadline of the operation, rounded up, at least 1.
7. Run git with `GIT_SSH_COMMAND`. The command starts `ssh -F none` with `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`, `BatchMode=yes`, `GlobalKnownHostsFile=/dev/null` and the three files of the directory.
8. Remove the key from the agent, end the agent and delete the directory.

`-F none` stops the read of `~/.ssh/config` and `/etc/ssh/ssh_config`. ssh therefore reads no SSH configuration, no `~/.ssh/known_hosts` and no default key file of the host user. Every git child of KanthorD also runs without `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GIT_SSH` and `GIT_SSH_COMMAND` of the host. KanthorD reads and writes no file under `~/.ssh`. These rules cover the git children of KanthorD only. A `bash` command of an LLM agent keeps the SSH configuration of the host user; see [the agent can use git](../../explanation/coder-worker.md#limits).

A failure of steps 3 to 6 fails the operation with `repository.connector.ssh_agent_failed`. Its `step` field names the step, and its cause holds the text of the tool, never the key. A worker execution fails with this diagnostic. A binding operation reports only a `failure_reason`; see below.

| `step`        | Cause                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| `directory`   | The directory cannot be created, or its mode is not `0700`.                                |
| `socket_path` | The socket path is longer than 100 bytes, or it holds a character outside `A-Za-z0-9/._-`. |
| `files`       | `id.pub` or `known_hosts` cannot be written.                                               |
| `agent`       | The agent socket does not appear within 5 seconds or before the deadline.                  |
| `load`        | `ssh-add` refuses the key.                                                                 |

A binding apply reports this failure as `422 project.bindings.repository.ssh_unreachable` with `details.failure_reason` `identity_unavailable`. A binding check and verify report it in the `address` entry with the same value.

### The temporary directory limit

The socket path is the temporary directory, then `/kd-ssh-<8 characters>-<6 characters>/a`: 25 bytes more. `ssh-agent` fails without a message on a socket path above the `sun_path` limit of the host, 104 bytes on macOS. KanthorD therefore refuses a socket path above 100 bytes. A temporary directory path above 75 bytes makes every SSH operation fail with `repository.connector.ssh_agent_failed`, step `socket_path`. A binding check or verify then reports `failure_reason` `identity_unavailable` in the `address` entry, while the `ssh_credential` entry stays `healthy`. Today the answer and the server log name no step for a binding operation.

Node.js takes the temporary directory from `TMPDIR`, then `TMP`, then `TEMP`, else `/tmp`. It drops a trailing `/`. To repair a long path, set `TMPDIR` to a short path such as `/tmp` for the server or worker process, then restart it. The limit applies to the server host and to each worker host.

## Expected response

Both commands return HTTP `200` with a [credential answer](credential.md#credential-answer). The CLI writes the same object as one JSON line to stdout, adds `idempotency_key` and exits `0`.

```json
{
  "name": "deploy-api",
  "platform": "ssh",
  "revisions": [
    {
      "id": "credential_01M34JC4BJ66JHP41M4MYY6PST",
      "revision": 1,
      "metadata": {
        "public_key": "ssh-ed25519 <base64> kanthord-deploy-api",
        "fingerprint": "SHA256:<43-base64-characters>"
      },
      "created_at": 1791441600000,
      "ended_at": null
    }
  ],
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property                           | Type                  | Purpose                                                 |
| ---------------------------------- | --------------------- | ------------------------------------------------------- |
| `name`                             | string                | Credential name.                                        |
| `platform`                         | string                | Always `ssh`.                                           |
| `revisions`                        | array                 | Every revision, newest first.                           |
| `revisions[].metadata.public_key`  | string                | Public key of the revision. Add it as a deploy key.     |
| `revisions[].metadata.fingerprint` | string                | `SHA256:` fingerprint of the public key.                |
| `revisions[].ended_at`             | integer or `null`     | End time in Unix milliseconds; `null` while it is live. |
| `idempotency_key`                  | canonical ULID string | CLI only; key of the request, for a retry.              |

The other revision properties are those of the [credential answer](credential.md#credential-answer). After a rotation, `revisions` holds the new revision first. An older revision that no live execution pins shows `ended_at`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Commands         | Meaning                                                                                             |
| -------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Both             | Missing, invalid, expired or banned token, or a machine token.                                      |
| `400 gateway.request.validation_failed`      | Both             | The body is not `{ "name" }` or `{ "expected_revision" }` with a positive integer.                  |
| `400 gateway.request.invalid_json`           | Both             | The body is not valid JSON with unique object members.                                              |
| `415 gateway.request.unsupported_media_type` | Both             | The body is not `application/json`.                                                                 |
| `413 gateway.request.body_too_large`         | Both             | The body exceeds 1 KiB.                                                                             |
| `400 gateway.idempotency.invalid_key`        | Both             | Absent or malformed `Idempotency-Key`.                                                              |
| `409 gateway.idempotency.conflict`           | Both             | The key cannot be replayed for this request.                                                        |
| `504 gateway.invocation.timeout`             | Both             | The 30-second operation timeout expired; the write can still complete.                              |
| `400 credential.input.invalid`               | `ssh-key-create` | The name breaks the name rule or is reserved: `login`, `platform`, `check` or `ssh`.                |
| `409 credential.name.conflict`               | `ssh-key-create` | The name is taken, also by an archived credential; `details.id` holds the newest revision identity. |
| `404 credential.credential.not_found`        | `ssh-key-rotate` | The name is unknown, or its platform belongs to another component.                                  |
| `409 credential.credential.archived`         | `ssh-key-rotate` | The credential is archived.                                                                         |
| `409 credential.revision.conflict`           | `ssh-key-rotate` | `expected_revision` is not the newest live revision; `details.revision` holds it.                   |
| `400 credential.entry.unsupported`           | `ssh-key-rotate` | The credential is not an `ssh` credential, for example a `github` credential.                       |

The CLI exits `1` for every failure and writes a diagnostic line `<code>: <message>` to stderr, as [repository credentials](credential.md#failures) states.

| CLI code                                                    | Commands         | Meaning                                                               |
| ----------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `cli.repository.credential.<command>.token_required`        | Both             | The resolved token is absent or blank. The CLI sends no request.      |
| `cli.repository.credential.<command>.indeterminate`         | Both             | Transport failure, timeout or malformed response; retry with the key. |
| `cli.repository.credential.ssh_key_rotate.invalid_revision` | `ssh-key-rotate` | `--expected-revision` is not a positive safe integer.                 |
| `cli.idempotency_key.invalid`                               | Both             | `--idempotency-key` is not a canonical ULID.                          |
| `cli.option.duplicate`                                      | Both             | An option occurs more than once.                                      |

`<command>` is `ssh_key_create` or `ssh_key_rotate`.

## API shape

Both operations use the `human` access policy, a 30-second timeout and a 1 KiB body limit. Both are mutations and need `Idempotency-Key`. The workbench agent has no tool for either operation.

| Header            | Required | Purpose                                                       |
| ----------------- | -------- | ------------------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <human-jwt>`.                                         |
| `Content-Type`    | Yes      | `application/json`.                                           |
| `Idempotency-Key` | Yes      | Canonical ULID; reuse the same key to retry the same request. |

### ssh-key-create

| Item            | Value                                     |
| --------------- | ----------------------------------------- |
| Method and path | `POST /api/repository/credential/ssh/key` |
| Operation ID    | `repository.credential.ssh_key_create`    |
| Parameters      | None                                      |

| Body field | Required | Value            |
| ---------- | -------- | ---------------- |
| `name`     | Yes      | Credential name. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/ssh/key \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"name":"deploy-api"}'
```

The static path `/ssh/key` takes precedence over `/:credential_name`, so `ssh` is a reserved name.

### ssh-key-rotate

| Item            | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| Method and path | `POST /api/repository/credential/:credential_name/ssh/key` |
| Operation ID    | `repository.credential.ssh_key_rotate`                     |
| Parameters      | `credential_name`                                          |

| Body field          | Required | Value                                                            |
| ------------------- | -------- | ---------------------------------------------------------------- |
| `expected_revision` | Yes      | Positive integer; the newest live revision that the caller read. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/deploy-api/ssh/key \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":1}'
```

## CLI shape

```text
kanthord repository credential ssh-key-create <name> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential ssh-key-rotate <name> --expected-revision <n> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord repository credential ssh-key-create deploy-api
kanthord repository credential ssh-key-rotate deploy-api --expected-revision 1
```

| Argument | Commands | Value                                                                                                  |
| -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `<name>` | Both     | Credential name; sent as `body.name` by `ssh-key-create` and as `credential_name` by `ssh-key-rotate`. |

| Option                     | Commands         | Default / resolution                                                  | Purpose                                                                |
| -------------------------- | ---------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--expected-revision <n>`  | `ssh-key-rotate` | Required; no default                                                  | Sets `body.expected_revision`. The CLI checks it before the token.     |
| `--idempotency-key <ulid>` | Both             | A generated canonical ULID                                            | Sets the `Idempotency-Key` header; supply the same key when you retry. |
| `--token <jwt>`            | Both             | `KANTHORD_TOKEN` → client-file token; a nonblank token is required    | Human JWT sent in the `Authorization` header.                          |
| `--endpoint <url>`         | Both             | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL.                                                       |

Each option is single-use. The commands take no file and read no standard input. See [client configuration](../README.md#client-configuration).
