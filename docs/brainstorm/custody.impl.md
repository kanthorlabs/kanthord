---
title: Custody Implementation
---

# Custody Implementation

This file holds the mechanisms that realize [custody.md](custody.md).
This file is not a design document, and `custody.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## The credential store record

- Custody owns the shared `credential` table and the [credential envelope](architecture.impl.md#the-credential-table).
- A row holds `id`, `name`, `platform`, `revision`, `secret`, `metadata`, `created_at` and `ended_at`, and one row is one revision of a credential.
- The encrypted columns represent `secret`; no plaintext secret persists.
- The identity is `credential_<ulid>` under the [identity convention](architecture.impl.md#the-identity-and-the-time), and it names one revision.
- A name holds 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens.
- The name is the group key of a credential and never changes. A unique index holds `name` and `revision`, and a new name starts at revision 1.
- The name `login` is refused, because the static route `/api/credential/login` holds that path segment.
- Creation and login refuse a name that a row holds with 409 `credential.name.conflict` and the identity of its newest revision in `error.details`.
- A login checks the name at start and at commit.
- The write code keeps one platform for every row of a name.
- The newest live revision is the row of the name with the greatest `revision` and a null `ended_at`.
- A rotation inserts the next revision in one transaction. It copies the metadata of the newest live revision unless the request replaces it, and the older revisions stay live.
- A drain and a revoke set `ended_at`.
- An OAuth refresh writes the pinned revision in place and adds no revision.
- Rotation and OAuth refresh change no binding revision.
- A metadata edit inserts the next revision in one transaction, with the secret of the newest live revision and the new metadata, and the older revisions stay live.
- A rotation and a metadata edit name `expectedRevision`, the newest live revision that the human read. A stale value answers 409 `credential.revision.conflict` with the current value in `details`.
- Every answer includes metadata and excludes the secret.
- Removal checks every dependent, including agent providers, in the transaction of the commit.
- Removal calls the Project collaboration `bindingsNaming(tx, credentialName)` in that transaction. It answers every binding revision that names the credential and that is a dependent.
- Removal revokes every live revision of the name and keeps the rows, because an execution record references them.
- A refusal lists the dependents.
- Creation and rotation validate the local schema and make no remote call.
- Custody logs a human creation or update with the human identity and row identity, never the secret.

The platform determines the secret shape of a record, and each shape has one secret schema:

- `api_key`: `{ key }`.
- `oauth`: `{ refresh, access, expires }`; only a login session supplies initial material.
- `s3_access_key`: `{ accessKeyId, secretAccessKey }`; a session token is invalid.

## Platform validators

Custody owns a dedicated platform validator for every [platform](custody.vocabulary.md#platform), including each LLM platform.
Each platform validator declares its secret shape, metadata schema and validation. A platform holds exactly one secret shape, and a second shape for the same remote is another platform, for example `anthropic-subscription`, `openai-codex` or `github-app`.
The platform validators use the credential contracts of `@earendil-works/pi-ai` at 0.86.0.

| Platform | Secret shape | Metadata | Validation |
| --- | --- | --- | --- |
| `github` | `api_key` | None | `GET https://api.github.com/rate_limit` |
| `github-copilot` | `oauth` | None | `GET https://api.github.com/copilot_internal/v2/token` with the stored GitHub token |
| `anthropic` | `api_key` | None | `GET https://api.anthropic.com/v1/models` |
| `openai-compatible` | `api_key` | `baseUrl`, `models` | `GET <baseUrl>/models` |
| `s3` | `s3_access_key` | `endpoint`, `bucket`, `region` | `HeadBucket` on the metadata bucket, signed for the metadata region |

- Every other platform refuses a record.
- An official OpenAI record is an `openai-compatible` record with `baseUrl` `https://api.openai.com/v1`.
- The Copilot probe writes no minted token back to the record.
- The S3 probe sends `HeadBucketCommand` of `@aws-sdk/client-s3` to the metadata `endpoint` and `region`, so it serves every S3-compatible provider, for example Cloudflare R2.
- `openai-compatible.baseUrl` uses `https` or `http`, with no query and no fragment.
- The base URL is fixed for the life of a revision. A metadata edit that changes it fails, and a rotation can set a new one.
- The first revision of an `openai-compatible` credential starts with `models: []`.
- Each approved model holds a required `id` and optional `contextWindow`, `maxTokens` and `reasoningLevels`.
- An omitted value takes the default of pi 0.86.0: `contextWindow` `128000`, `maxTokens` `16384` and `reasoningLevels` `["off"]`.
- `contextWindow` and `maxTokens` are positive integers, and `maxTokens` does not exceed `contextWindow` after the defaults apply.
- A metadata edit adds approved models to the next revision after the [provider check](worker-service.impl.md#the-provider-check).
- A metadata edit or a rotation that drops a model fails while a default configuration or an entry names it.
- The dependency check and metadata update commit in one transaction; a refusal lists the dependents.
- S3 metadata serves the healthcheck, not work destinations.
- [Storage configuration](project-service.impl.md#storage-configuration) owns work destinations.
- `HeadBucket` maps 200 to `ok`, 404 to a missing bucket and 403 to `unknown`.
- A write-only key can work despite a 403 from `HeadBucket`.

## Suitability

- The use request is `{ credential, platform }`.
- Custody compares the record platform with the requested platform before any remote call.
- It compares no metadata and reads no secret for this comparison.
- Remote validation uses the record's own platform validator.
- The use check performs no remote validation at creation or rotation.
- Services supply no secret-shape list and no capability wire value.

## The keys

- Custody uses the derived cipher key of the [credential table](architecture.impl.md#the-credential-table), never `masterKey` directly.
- The handover keys derive from the [client secret](gateway-service.impl.md#the-client-secret) of the machine JWT through `crypto.hkdfSync` with SHA-256 and an empty salt.
- The info of the handover key is `handover/server-to-worker/v1`, and the info of the refresh-report key is `handover/worker-to-server/v1`.
- A manual replacement of `masterKey` makes stored credentials unreadable.
- A human enters each secret again into its existing record; entity references stay valid.
- [Delivery verification](project-service.impl.md#the-verification-of-a-delivery) owns the webhook secret derivation.

## The protected facility

- The facility consumes the authorization result of the [Project Service](project-service.md#authorization-and-credential-custody).
- Its authorization function accepts requester identity, entity and requested operation, and returns a grant or refusal.
- A module-private `WeakSet` records each frozen grant, so a caller cannot fabricate one.
- Custody consumes an operation grant at its first use.
- A consumed grant authorizes no second operation.
- Acquisition grants follow [their own contract](project-service.impl.md#the-acquisition-grant) and cannot enter `release`.
- Human and machine identities pass the checks of [Gateway identity verification](gateway-service.impl.md#the-jwt).
- A service identity passes `isServiceIdentity` of the kernel.
- An execution identity resolves through the Scheduler Service to the node of its live claim.
- The facility refuses another node and takes no association from the caller.
- For an external harness, the machine identity and execution identity prove the complete chain.
- The JWT names the client identity and worker binding; the registration is live.
- The live claim names that binding and instance, and its node is the node of the operation.
- A break in that chain refuses the operation before ciphertext access.
- A model inference call resolves through the worker binding and selected agent provider, never a credential relationship with a project.

## The release of a secret

- Custody exposes `release(grant)`.
- It checks and consumes the grant, resolves the pinned or the newest live revision, checks suitability, decrypts the revision and returns `Material` inside the process.
- The holder of `Material` performs its own operation, and custody performs no operation of a service.
- A release is a call of the shared custody component inside the server process, so `Material` crosses no adapter.
- A server-owned child process remains inside the server boundary.
- Material enters no log, workspace file, transcript, tool result or error body, and this rule binds every holder of `Material`.
- `pino` redacts material paths; tests assert each path.
- The holder clears the buffer of `Material` through `drop()` in a `finally` block when its operation returns.
- This cleanup cannot clear parsed strings or cached tokens that outlive the buffer, so a holder builds its platform client for one call and caches no client and no token.
- The [host trust boundary](worker-service.impl.md#trust-boundary) includes each worker application.
- Custody protects system records, not a host that an adversary controls.
- The holder of the material reports a remote refusal to custody, and custody records it against the credential record.

## The credential store of an execution

- Custody implements `CredentialStore` of `@earendil-works/pi-ai` at 0.86.0.
- The methods are `read(providerId)`, `list()`, `modify(providerId, fn)` and `delete(providerId)`.
- The [Worker Service](worker-service.impl.md#the-credential-store-of-an-execution) defines the selection and visibility of the execution view.
- `list()` returns the selected non-secret pair of adapter id and credential type, and custody derives that type from the platform of the record.
- The view reads the revision that the execution pins.
- `modify()` serializes on the pinned revision and writes the pi-ai result in place.
- The view refuses `delete()`.
- At `server` placement, the view reads custody directly; plaintext stays inside the process.
- At `worker` placement, the view reads the decrypted handover.
- Custody drops the view at execution end.

## The credential handover

- [Worker handover operations](worker-service.impl.md#the-credential-handover) transport the envelope and refresh report.
- The payload is canonical JSON of the platform key and provider credential that the execution requires.
- Each item holds the record identity, pi adapter id or git platform, and pi-ai credential.
- AES-256-GCM uses the key of its direction, a random 12-byte nonce and a 16-byte tag. A handover uses the handover key, and a refresh report uses the refresh-report key.
- Additional authenticated data concatenates the length-prefixed execution identity and runtime identity.
- The worker application holds the client secret of its machine JWT and derives the same two keys. Custody derives the client secret again from the verified `sub`.
- A valid tag proves the sender and the direction, because only the server and that one worker hold the client secret.
- A refresh report carries the digest of the credential value that it replaces. Custody writes the new value in place only when the stored value has that digest, in the same transaction, so a replayed earlier report writes nothing.
- The client secret protects the handover and the refresh report alone. Registration, the work pull and the MCP calls stay bearer-only.
- The envelope has no forward secrecy. A client secret that leaks later opens every recorded envelope of its client identity.
- The handover carries the revisions that the execution pins.
- Custody refreshes no pinned revision on the server while a live execution at `worker` placement holds it.
- Two executions can hold one revision at once.
- The refresh-token rotation behaviour of concurrent holders remains a provider constraint.
- Custody logs the execution identity and record identity of each handover and report, never material.
- `pino` redacts the payload paths.

## The pin of an execution

- At the first use of a credential name in an execution, custody resolves the newest live revision and calls the Scheduler collaboration `pinCredential(tx, executionId, credentialId)` in the same transaction.
- The collaboration appends the row identity to `scheduler_execution.credentials`.
- A later use of that name in the execution reads the pinned revision.
- A use of a revoked revision answers 409 `credential.revision.revoked`.
- The drain check calls `liveExecutionsPinning(tx, credentialId)` for each live revision that is not the newest, and it drains a revision that no live execution pins.
- Custody runs the drain check at each pin, rotation, revoke and credential read.
- The list stays in the execution record after the execution ends.

## Operations

- Custody declares `credential.*` operations in its own `contract.ts`, under `/api/credential`.
- Credential management uses the `human` access policy.
- `credential.create` accepts a record of every platform whose secret shape is not `oauth`.
- `credential.login` obtains a record of a platform whose secret shape is `oauth`.
- `credential.rotate` adds a revision without a remote call.
- `credential.revoke` ends one revision at once.
- `credential.get` and `credential.list` return metadata and no secret.
- The resource healthcheck validates a record on demand.

## The OAuth login

- Custody calls `models.login(providerId, "oauth", interaction)` of pi-ai over its own credential store.
- The [platform table](#platform-validators) determines whether OAuth is accepted.
- A login session is a custody runtime record with identity `login_session_<ulid>`.
- It holds platform, mode, initial human identity, credential name, state, address, code, failure reason and expiry.
- Expiry falls 15 minutes after start.
- The interaction adapter answers `select` with `browser` or `device_code`; an unsupported option fails the session.
- It records `auth_url` as the address and `device_code` as the code and address.
- It records `info` and `progress` as the last message.
- The GitHub Copilot login of pi-ai first asks for a GitHub Enterprise domain with the placeholder `company.ghe.com`. While the session holds no address, the adapter answers that one prompt with the empty value, which selects github.com.
- Every other `manual_code`, `text` or `secret` prompt waits for a supplied value until expiry.
- `credential.login` is a unary mutation and answers session identity, address, code and expiry.
- `credential.login_code` is a unary mutation with session identity and value; it answers 409 when no value is awaited.
- `credential.login_status` is a unary read with session identity; it answers state, last message and failure reason.
- A platform with one mode ignores the requested mode.
- A browser callback listener belongs to pi-ai, not the Gateway, and lasts for the session.
- The server sets no `PI_OAUTH_CALLBACK_HOST` override.
- A remote browser can return its redirect URL or code through `credential.login_code` when its loopback callback fails.
- Device mode needs no listener; pi-ai polls until success, failure or expiry.
- Custody permits at most one pending session per platform and human identity; another start answers 409.
- `CustodyComponent` takes a required `store`, an optional `oauthProviders` that defaults to the built-in pi-ai GitHub Copilot provider, and an optional `now` clock.
- Completion writes the credential inside the pi-ai `CredentialStore.modify` call. The transaction checks the session state again, so an expired or failed session stores nothing. The session ends only after the commit.
- The session record holds no token, and a failed or expired session stores nothing.
- The login flow proves the OAuth record; no extra validation call follows it.
- Output exposes the address and code that the human needs, never a token.

## The resource healthcheck

- The [health report](gateway-service.impl.md#the-resource-healthcheck-report) supplies the deadline and concurrency bounds.
- The [platform validators](#platform-validators) supply the probes.
- A supported platform with no remote call reports `unknown`.
- A forbidden probe proves no invalid credential.
- No check refreshes an OAuth record; an expired access token reports `unknown` without a remote call.
- Credential and agent provider healthchecks share an implementation where appropriate, not ownership.
- Custody records each probe against the credential store record and stores no check result.
- The GitHub rate-limit probe reports `rate-limit read` and spends no rate limit.

## Tests

- Tests cover duplicate names at creation, login start and login commit, including creation retry after restart.
- Tests assert the secret shape of each platform, the entry method of each shape, metadata schemas, model defaults, fixed base URL and platform-only suitability.
- Tests assert no remote call on creation or rotation, and no secret in record answers.
- Tests cover model and credential removal with dependents and concurrent changes.
- Tests cover every platform probe, S3 status mapping, expired OAuth, forbidden probes and attribution without stored results.
- Tests preserve names and binding references across rotation.
- A test covers two rotations that name one expected revision, and it asserts that the second one answers 409 `credential.revision.conflict`. A test covers the same case for two metadata edits.
- Tests cover the rotation overlap, the pin at first use, the drain after the last pin, the revoke of a pinned revision, the refusal of a revoke of the newest live revision, the metadata copy and replacement at rotation, and a `baseUrl` change at rotation alone.
- Tests cover the handover round trip, another execution identity, truncated ciphertext and a refresh report without a live execution.
- Tests assert that `release` refuses a consumed, a fabricated and an acquisition grant, and that `drop()` clears the buffer after a success and after a failure.
- Tests cover store isolation, `undefined` for another adapter id, serialized refresh and refusal of deletion.
- Tests cover login completion, manual code, conflicting sessions and expiry without stored material.
- A test runs the built-in pi-ai GitHub Copilot provider offline to its first prompt and asserts the enterprise-domain placeholder.
- Tests assert no secret in outputs, logs, transcripts or errors.
