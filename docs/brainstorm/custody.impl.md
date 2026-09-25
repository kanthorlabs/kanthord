---
title: Custody Implementation
---

# Custody Implementation

This file holds the mechanisms that realize [custody.md](custody.md).
This file is not a design document, and `custody.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## The credential store record

- Custody owns the shared `credential` table and the [credential envelope](architecture.impl.md#the-credential-table).
- A record holds `id`, `name`, `platform`, `type`, `secret`, `metadata`, `remote_identity`, `created_at`, `updated_at` and `revision`.
- The encrypted columns represent `secret`; no plaintext secret persists.
- The identity is `credential_<ulid>` under the [identity convention](architecture.impl.md#the-identity-and-the-time).
- A name holds 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens.
- A unique index holds `name`, the natural key of creation and login.
- A taken name answers 409 `credential.name_conflict` with the holder identity in `error.details`.
- A login checks the name at start and at commit.
- Rotation updates one row in one transaction; the last write wins.
- Rotation and OAuth refresh change no binding revision.
- A metadata change increments the record revision.
- Every record answer includes metadata and excludes the secret.
- Removal checks every dependent, including agent providers, in the transaction of the commit.
- A refusal lists the dependents.
- Creation and rotation validate the local schema and make no remote call.
- Custody logs a human creation or update with the human identity and record identity, never the secret.

The secret schemas are:

- `api_key`: `{ key }`.
- `oauth`: `{ refresh, access, expires }`; only a login session supplies initial material.
- `s3_access_key`: `{ accessKeyId, secretAccessKey }`; a session token is invalid.

## Platform implementations

Custody owns a dedicated implementation for every [platform](custody.vocabulary.md#platform), including each LLM platform.
Each implementation declares its accepted types, metadata schema and validation.
The implementations use the credential contracts of `@earendil-works/pi-ai` at 0.86.0.

| Platform | Accepted type | Metadata | Validation |
| --- | --- | --- | --- |
| `github` | `api_key` | None | `GET https://api.github.com/rate_limit` |
| `github-copilot` | `oauth` | None | `GET https://api.github.com/copilot_internal/v2/token` with the stored GitHub token |
| `openai` | `api_key` | None | `GET https://api.openai.com/v1/models` |
| `anthropic` | `api_key` | None | `GET https://api.anthropic.com/v1/models` |
| `openai-compatible` | `api_key` | `baseUrl`, `models` | `GET <baseUrl>/models` |
| `s3` | `s3_access_key` | `endpoint`, `bucket`, `region` | `HeadBucket` on the metadata bucket, signed for the metadata region |

- Every other platform refuses a record.
- Creation refuses a type outside the accepted type of its platform.
- The Copilot probe writes no minted token back to the record.
- `openai-compatible.baseUrl` uses `https` or `http`, with no query and no fragment.
- The base URL is fixed; an update that changes it fails.
- An `openai-compatible` record starts with `models: []`.
- Each approved model holds `id`, `contextWindow`, `maxTokens` and `reasoningLevels`.
- `contextWindow` and `maxTokens` are positive integers, and `maxTokens` does not exceed `contextWindow`.
- A metadata revision adds approved models after the [provider check](worker-service.impl.md#the-provider-check).
- A model removal fails while a default configuration or an entry names it.
- The dependency check and metadata update commit in one transaction; a refusal lists the dependents.
- S3 metadata serves the healthcheck, not work destinations.
- [Storage configuration](project-service.impl.md#storage-configuration) owns work destinations.
- `HeadBucket` maps 200 to `ok`, 404 to a missing bucket and 403 to `unknown`.
- A write-only key can work despite a 403 from `HeadBucket`.

## Suitability

- The use request is `{ credential, platform }`.
- Custody compares the record platform with the requested platform before any remote call.
- It compares no metadata and reads no secret for this comparison.
- Remote validation uses the record's own platform implementation.
- The use check performs no remote validation at creation or rotation.
- Services supply no accepted-type list and no capability wire value.

## The remote identity of a record

- `remote_identity` uses the form in [remote identity](custody.vocabulary.md#remote-identity).
- The identifier is the login, slug or path that the remote displays, not a numeric identity.
- Custody asks no remote to confirm this human-entered value.
- It never routes validation by that value and never treats it as authorization.
- A rotation preserves the remote identity.

## The keys

- Custody uses the derived cipher key of the [credential table](architecture.impl.md#the-credential-table), never `masterKey` directly.
- The handover key derives through `crypto.hkdfSync` with SHA-256 and an empty salt.
- Its info is `handover/aes-256-gcm/v1`.
- A manual replacement of `masterKey` makes stored credentials unreadable.
- A human enters each secret again into its existing record; entity references stay valid.
- [Delivery verification](project-service.impl.md#the-verification-of-a-delivery) owns the webhook secret derivation.

## The protected facility

- The facility consumes the authorization result of the [Project Service](project-service.md#authorization-and-credential-custody).
- Its authorization function accepts requester identity, entity and requested operation, and returns a grant or refusal.
- A module-private `WeakSet` records each frozen grant, so a caller cannot fabricate one.
- Custody consumes an operation grant at its first use.
- A consumed grant authorizes no second operation.
- Acquisition grants follow [their own contract](project-service.impl.md#the-acquisition-grant) and cannot enter `use`.
- Human and machine identities pass the checks of [Gateway identity verification](gateway-service.impl.md#the-jwt).
- A service identity passes `isServiceIdentity` of the kernel.
- An execution identity resolves through the Scheduler Service to the node of its live claim.
- The facility refuses another node and takes no association from the caller.
- For an external harness, the machine identity and execution identity prove the complete chain.
- The JWT names the client identity and worker binding; the registration is live.
- The live claim names that binding and instance, and its node is the node of the operation.
- A break in that chain refuses the operation before ciphertext access.
- A model inference call resolves through the worker binding and selected agent provider, never a credential relationship with a project.

## The use of a secret

- Custody exposes `use(grant, request)`.
- The request names the operation and its parameters, not a destination.
- Custody derives the destination from the authorized entity.
- It performs the operation and returns its result, never material.
- A server-owned child process remains inside the server boundary.
- Material enters no log, workspace file, transcript, tool result or error body.
- `pino` redacts material paths; tests assert each path.
- Custody clears its plaintext buffer when the operation returns.
- This cleanup cannot clear parsed strings or cached tokens that outlive the buffer.
- The [host trust boundary](worker-service.impl.md#trust-boundary) includes each worker application.
- Custody protects system records, not a host that an adversary controls.
- For a platform action, custody attaches the API key in the `Authorization` header inside `use`.
- It returns no header, mints no token and caches no token for that action.
- A remote refusal fails the operation closed and records the failure against the credential record.

## The credential store of an execution

- Custody implements `CredentialStore` of `@earendil-works/pi-ai` at 0.86.0.
- The methods are `read(providerId)`, `list()`, `modify(providerId, fn)` and `delete(providerId)`.
- The [Worker Service](worker-service.impl.md#the-credential-store-of-an-execution) defines the selection and visibility of the execution view.
- `list()` returns the selected non-secret pair of adapter id and credential type.
- `modify()` serializes on the record and writes the pi-ai result in place.
- The view refuses `delete()`.
- At `server` placement, the view reads custody directly; plaintext stays inside the process.
- At `worker` placement, the view reads the decrypted handover.
- Custody drops the view at execution end.

## The credential handover

- [Worker handover operations](worker-service.impl.md#the-credential-handover) transport the envelope and refresh report.
- The payload is canonical JSON of the platform key and provider credential that the execution requires.
- Each item holds the record identity, pi adapter id or git platform, and pi-ai credential.
- AES-256-GCM uses the handover key, a random 12-byte nonce and a 16-byte tag.
- Additional authenticated data concatenates the length-prefixed execution identity and runtime identity.
- The worker application holds the same `masterKey` and derives the same key.
- A refresh report uses the same envelope; custody writes its record in place.
- Custody marks a record while a live execution at `worker` placement holds it.
- Custody refreshes no marked record, and the mark ends with the execution.
- Two executions can hold one record at once.
- The refresh-token rotation behaviour of concurrent holders remains a provider constraint.
- Custody logs the execution identity and record identity of each handover and report, never material.
- `pino` redacts the payload paths.

## Operations

- Custody declares `credential.*` operations in its own `contract.ts`, under `/api/credential`.
- Credential management uses the `human` access policy.
- `credential.create` accepts `api_key` and `s3_access_key` records.
- `credential.login` obtains an `oauth` record.
- `credential.rotate` updates secret material without a remote call.
- `credential.get` and `credential.list` return metadata and no secret.
- The resource healthcheck validates a record on demand.

## The OAuth login

- Custody calls `models.login(providerId, "oauth", interaction)` of pi-ai over its own credential store.
- The [platform table](#platform-implementations) determines whether OAuth is accepted.
- A login session is a custody runtime record with identity `login_session_<ulid>`.
- It holds platform, mode, initial human identity, credential name, remote identity, state, address, code, failure reason and expiry.
- Expiry falls 15 minutes after start.
- The interaction adapter answers `select` with `browser` or `device_code`; an unsupported option fails the session.
- It records `auth_url` as the address and `device_code` as the code and address.
- It records `info` and `progress` as the last message.
- A `manual_code`, `text` or `secret` prompt waits for a supplied value until expiry.
- `credential.login` is a unary mutation and answers session identity, address, code and expiry.
- `credential.login_code` is a unary mutation with session identity and value; it answers 409 when no value is awaited.
- `credential.login_status` is a unary read with session identity; it answers state, last message and failure reason.
- A platform with one mode ignores the requested mode.
- A browser callback listener belongs to pi-ai, not the Gateway, and lasts for the session.
- The server sets no `PI_OAUTH_CALLBACK_HOST` override.
- A remote browser can return its redirect URL or code through `credential.login_code` when its loopback callback fails.
- Device mode needs no listener; pi-ai polls until success, failure or expiry.
- Custody permits at most one pending session per platform and human identity; another start answers 409.
- Completion writes the credential through `modify` and ends the session.
- The session record holds no token, and a failed or expired session stores nothing.
- The login flow proves the OAuth record; no extra validation call follows it.
- Output exposes the address and code that the human needs, never a token.

## The resource healthcheck

- The [health report](gateway-service.impl.md#the-resource-healthcheck-report) supplies the deadline and concurrency bounds.
- The [platform implementations](#platform-implementations) supply the probes.
- A supported platform with no remote call reports `unknown`.
- A forbidden probe proves no invalid credential.
- No check refreshes an OAuth record; an expired access token reports `unknown` without a remote call.
- Credential and agent provider healthchecks share an implementation where appropriate, not ownership.
- Custody records each probe against the credential store record and stores no check result.
- The GitHub rate-limit probe reports `rate-limit read` and spends no rate limit.

## Tests

- Tests cover duplicate names at creation, login start and login commit, including creation retry after restart.
- Tests assert platform/type acceptance, metadata schemas, fixed base URL and platform-only suitability.
- Tests assert no remote call on creation or rotation, and no secret in record answers.
- Tests cover model and credential removal with dependents and concurrent changes.
- Tests cover every platform probe, S3 status mapping, expired OAuth, forbidden probes and attribution without stored results.
- Tests preserve names, remote identities and binding references across rotation.
- Tests cover the handover round trip, another execution identity, truncated ciphertext and a refresh report without a live execution.
- Tests cover store isolation, `undefined` for another adapter id, serialized refresh and refusal of deletion.
- Tests cover login completion, manual code, conflicting sessions and expiry without stored material.
- Tests assert no secret in outputs, logs, transcripts or errors.
