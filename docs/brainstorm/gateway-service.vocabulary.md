---
title: Gateway Service Vocabulary
---

# Gateway Service Vocabulary

This file holds the values and the examples of the terms that [gateway-service.md](gateway-service.md) owns.
This file is not a design document, and `gateway-service.md` stays the single source of truth.

## health report

The resource report that the [Gateway Service](gateway-service.md#health-report-and-liveness-answer) answers to a human.

A human requests a health report and reads the entry for `openai-main` under the shared LLM component.

## liveness answer

The internal component report that the [Gateway Service](gateway-service.md#health-report-and-liveness-answer) answers without authentication.

A supervisor reads a liveness answer that reports a failure of the store component of the server.
The container healthcheck runs `kanthord gateway liveness`. The command receives that liveness answer as HTTP 503 `gateway.liveness.unhealthy` and exits 1.

## logged-in account

The human account that the Gateway Service authenticates.

The Gateway Service verifies a JWT whose subject is `kanthorlabs` and establishes that logged-in account without reading an account row.

## human authentication

The act by which the Gateway Service verifies the credentials of a human and establishes the human identity.

`kanthorlabs` presents the JWT generated from the server configuration as a bearer token.
The Gateway Service verifies its signature, expiry and subject and establishes the human identity of `kanthorlabs`.

`kanthord auth jwt generate` generates a token for the default username `kanthorlabs`.
`kanthord auth jwt generate ulrich` generates a token whose subject is `ulrich`. When that token authenticates a request, the Gateway Service establishes the human identity of `ulrich`.

## machine identity

What the Gateway Service establishes from the credential of a machine, and what it passes to the service that the request targets.

An instance of the worker binding `claude-main` presents the JWT of the client identity `client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X6`.
That JWT holds `sub` = `client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X6`, `name` = `Claude Code on ulrich-mbp`, `kind` = `client`, `project_id` = the identity of the project, `resource_identity` = `worker:kanthord:claude-main`, and `iat`, `exp` and `jti`.
The Gateway Service verifies that JWT and establishes the machine identity, which names the client identity, the worker binding `claude-main`, the project `Billing` and the runtime identity of its live registration.
The Project Service receives that value, and it takes no association from the caller.
The worker instance `box-coder` presents a [worker token](#worker-token). The Gateway Service establishes a machine identity of kind `worker` that names the instance revision and the instance name `box-coder`.

## client secret

The secret that the server derives for one `client` JWT. A worker instance at the `worker` placement receives it sealed in the connection answer and holds it in memory only.

The worker instance `box-coder` opens the connection answer and reads the client secret of its registration under the binding `coder`.
It derives the handover key from that client secret. No other worker instance opens that handover.
`kanthord auth jwt generate --project project_01J8Z3N5K7Q2W4E6R8T0Y2V4X5 --binding tdd-main` prints only `token: eyJhbGciOi...`, because an external harness takes no handover.

## worker token

The JWT of kind `worker` that names one worker instance revision. The instance receives it sealed to its public key, so only the holder of the private key opens it.

The worker instance `box-coder` calls `worker.instance.token` with its `instance_id` and opens the sealed answer.
It presents the worker token on `worker.instance.connect` and `worker.instance.heartbeat`.
The token lives `WORKER_TOKEN_LIFETIME`, 3600 s, and it opens no work pull and no registration.

A non-secret decoded worker payload:

```json
{
  "sub": "worker_instance_01J8Z3N5K7Q2W4E6R8T0Y2V4XA",
  "name": "box-coder",
  "kind": "worker",
  "iat": 1758700000,
  "exp": 1758703600,
  "jti": "01J8Z3N5K7Q2W4E6R8T0Y2V4XB"
}
```

## JWT claim set

The closed set of claims of a kanthord JWT.

A non-secret decoded human payload:

```json
{
  "sub": "ulrich",
  "name": "Ulrich",
  "kind": "human",
  "iat": 1758700000,
  "exp": 1790236000,
  "jti": "01J8Z3N5K7Q2W4E6R8T0Y2V4X6"
}
```

A non-secret decoded machine payload:

```json
{
  "sub": "client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X7",
  "name": "Claude Code on ulrich-mbp",
  "kind": "client",
  "project_id": "project_01J8Z3N5K7Q2W4E6R8T0Y2V4X8",
  "resource_identity": "worker:kanthord:claude-main",
  "iat": 1758700000,
  "exp": 1790236000,
  "jti": "01J8Z3N5K7Q2W4E6R8T0Y2V4X9"
}
```

A `client` JWT of an instance at the `worker` placement adds `instance_id` = `worker_instance_01J8Z3N5K7Q2W4E6R8T0Y2V4XA` and `connection_id` = `connection_01J8Z3N5K7Q2W4E6R8T0Y2V4XC`.
A `client` JWT of an instance at the `server` or the `container` placement adds only `instance_id`.

A token with an `aud` claim or without `jti` fails verification.

## forwarding contract

The guarantee that the identity the Gateway Service passes to a downstream service is authentic and that no caller substitutes a different identity.

The Mission Service receives the human identity of `kanthorlabs`.
It names that identity in its authorization call to the Project Service and does not re-authenticate `kanthorlabs`.
The Project Service receives the machine identity of a registration, and it authenticates no machine of its own.
