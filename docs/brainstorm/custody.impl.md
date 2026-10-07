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
- The names `login`, `platform`, `check` and `ssh` are refused, because the static segments of the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) hold them.
- Creation and login refuse a name that a row holds with 409 `credential.name.conflict` and the identity of its newest revision in `error.details`.
- A login checks the name at start and at commit.
- The write code keeps one platform for every row of a name.
- Custody stores the platform value that the owning component supplies, and it validates no platform.
- The newest live revision is the row of the name with the greatest `revision` and a null `ended_at`.
- A rotation inserts the next revision in one transaction. It copies the metadata of the newest live revision unless the request replaces it, and after the insert it drains every older live revision that no live execution pins in the same transaction.
- A drain and a revoke set `ended_at`.
- An OAuth refresh writes the pinned revision in place and adds no revision.
- Rotation and OAuth refresh change no binding revision.
- A metadata edit inserts the next revision in one transaction, with the secret of the newest live revision and the new metadata, and the older revisions stay live until custody drains them or a human revokes them.
- A rotation and a metadata edit name `expectedRevision`, the newest live revision that the human read. A stale value answers 409 `credential.revision.conflict` with the current value in `details`.
- Every answer includes metadata and excludes the secret.
- An archive checks every dependent, including agent providers, in the transaction of the commit.
- An archive calls the Project collaboration `bindingsNaming(tx, credentialName)` in that transaction. It answers every binding revision that names the credential and that is a dependent.
- An archive calls the Intake collaboration `inboundsNaming(tx, credentialName)` in that transaction. It answers every inbound that names the credential.
- An archive sets `ended_at` on every live revision of the name and keeps the rows, because an execution record references them.
- A name with no live revision is archived. A drain and a revoke never end the newest live revision, so only an archive produces that state.
- An archive is final. An archived name takes no rotation, metadata edit or second archive, answers 409 `credential.credential.archived`, and stays taken.
- A refusal lists the dependents.
- Creation and rotation validate the local schema of the owning component and make no remote call.
- Custody logs a human creation or update with the human identity and row identity, never the secret.

The [platform validator](architecture.vocabulary.md#platform-validator) of the owning component names the secret shape of a record. Custody holds one secret schema for each shape:

- `api_key`: `{ key }`.
- `oauth`: `{ refresh, access, expires }`; only a login session supplies initial material.
- `s3_access_key`: `{ accessKeyId, secretAccessKey }`; a session token is invalid.
- `none`: `{}`; the record holds no secret material, and a release answers no material.

## Suitability

- The use request is `{ credential, platform }`.
- Custody compares the record platform with the requested platform before any remote call.
- A differing platform answers 400 `credential.platform.mismatch`.
- It compares no metadata and reads no secret for this comparison.
- Remote validation uses the platform validator of the component that owns the record.
- The use check performs no remote validation at creation or rotation.
- Services supply no secret-shape list and no capability wire value.

## The keys

- Custody uses the derived cipher key of the [credential table](architecture.impl.md#the-credential-table), never `master_key` directly.
- The handover keys derive from the [client secret](gateway-service.impl.md#the-client-secret) of the machine JWT through `crypto.hkdfSync` with SHA-256 and an empty salt.
- The info of the handover key is `handover/server-to-worker/v1`, and the info of the refresh-report key is `handover/worker-to-server/v1`.
- A manual replacement of `master_key` makes stored credentials unreadable.
- A human enters each secret again into its existing record; entity references stay valid.
- [The verification secret](intake-service.impl.md#the-verification-secret) of the Intake Service owns the webhook secret derivation.

## The protected facility

- The facility consumes the authorization result of the service that owns the entity of the release.
- Its authorization function accepts requester identity, entity and requested operation, and returns a grant or refusal.
- A module-private `WeakSet` records each frozen grant, so a caller cannot fabricate one.
- Custody consumes an operation grant at its first use.
- A consumed grant authorizes no second operation.
- A release for an inbound needs no Project decision. The facility checks that the requester is the Intake service identity and that the operation is `poll`, under [intake-service.impl.md](intake-service.impl.md#the-credential-release-of-an-inbound).
- A release for a workbench session names the human identity of the message that started the run as the requester, the workbench session as the entity and `workbench` as the operation.
- The Workbench Service grants that release while the workbench session exists, the enablement of its agent is enabled and the configuration of the session is valid.
- A run whose human identity no longer passes the Gateway checks stops at its next release.
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
- When a handler releases material before a remote call, it commits any pin and drain of that release in its transaction before the call. Custody writes through the supplied transaction and commits none. A later failure of the handler keeps the pin and the drain.
- A release is a call of the shared custody component inside the server process, so `Material` crosses no adapter.
- A server-owned child process remains inside the server boundary.
- Material enters no log, workspace file, transcript, tool result or error body, and this rule binds every holder of `Material`.
- `pino` redacts material paths; tests assert each path.
- The holder clears the buffer of `Material` through `drop()` in a `finally` block when its operation returns.
- This cleanup cannot clear parsed strings or cached tokens that outlive the buffer, so a holder builds its platform client for one call and caches no client and no token.
- The [host trust boundary](worker-service.impl.md#trust-boundary) includes each worker application.
- Custody protects system records, not a host that an adversary controls.
- The holder of the material writes a remote refusal into the span of its operation, with the credential name and revision. Custody stores no refusal.

## The credential store of an execution

- Custody implements `CredentialStore` of `@earendil-works/pi-ai` at 0.86.0.
- `src/custody/client.ts` exports `executionCredentialStore`, `ExecutionStoreError` and `ExecutionCredentials`; handover schemas remain in `contract.ts`.
- The methods are `read(providerId)`, `list()`, `modify(providerId, fn)` and `delete(providerId)`.
- The [Worker Service](worker-service.impl.md#the-credential-store-of-an-execution) defines the selection and visibility of the execution view.
- `list()` returns the selected non-secret pair of adapter id and credential type, and custody takes that type from the secret shape that the owning component declares for the platform of the record.
- The view reads the revision that the execution pins.
- `modify()` serializes on the pinned revision and writes the pi-ai result in place.
- The view refuses `delete()`.
- At `server` placement, the view reads custody directly; plaintext stays inside the process.
- At `worker` placement, the view reads the decrypted handover.
- Custody drops the view at execution end.
- A workbench view reads the newest live revision and pins no revision.

## The credential handover

- [Worker handover operations](worker-service.impl.md#the-credential-handover) transport the envelope and refresh report.
- The payload is canonical JSON containing only the credential of the effective agent provider of the execution.
- Its sole item holds the record identity, the pi adapter id and the pi-ai credential.
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
- A refresh report that fails its tag, its envelope form or its schema, that names a revision that the execution does not pin, or whose credential type differs from the secret shape of the platform, answers 400 `custody.handover.report_invalid`.
- The drain check calls `liveExecutionsPinning(tx, credentialId)` for each live revision that is not the newest, and it drains a revision that no live execution pins.
- Custody runs the drain check at each pin, rotation, revoke and credential read.
- The list stays in the execution record after the execution ends.

## Operations

- Custody declares no route and no operation of its own.
- Custody exposes the record functions that the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) of each component calls: create, list, get, rotate, metadata edit, revoke and archive.
- A list and a get take the platform set of the calling component, so a component reads only its own records.
- `rotate` adds a revision without a remote call.
- `revoke` ends one revision at once.
- `archive` checks every dependent, ends every live revision of the name and keeps the rows. A dependent answers 409 `credential.credential.in_use` with the dependents in `details`.
- A list leaves out an archived name unless the query `includeArchived` is `true`. A get answers an archived name.
- A get and a list return metadata and no secret.

## Tests

- Tests cover duplicate names at creation and at the commit of a first revision, including creation retry after restart.
- Tests assert the refusal of the names `login`, `platform` and `check`.
- Tests assert platform-only suitability, and that a list and a get of one component answer no record of another component.
- Tests assert no remote call on creation or rotation, and no secret in record answers.
- Tests cover a credential archive with dependents and concurrent changes.
- Tests preserve names and binding references across rotation.
- A test covers two rotations that name one expected revision, and it asserts that the second one answers 409 `credential.revision.conflict`. A test covers the same case for two metadata edits.
- Tests cover the rotation overlap, the pin at first use, the drain after the last pin, the revoke of a pinned revision, the refusal of a revoke of the newest live revision, and the metadata copy and replacement at rotation.
- Tests cover the handover round trip, another execution identity, truncated ciphertext and a refresh report without a live execution.
- Tests assert that `release` refuses a consumed grant, a fabricated grant and an inbound operation under another service identity, and that `drop()` clears the buffer after a success and after a failure.
- Tests cover store isolation, `undefined` for another adapter id, serialized refresh and refusal of deletion.
- Tests assert no secret in outputs, logs, transcripts or errors.

## Serialized credential budget

- For `api_key` and `oauth`, the normalized pi-ai credential occupies at most 48,915 UTF-8 bytes of canonical JSON. This shared shape constraint excludes `s3_access_key`.
- The budget derives from the 65,536-byte body limit of the [credential report](worker-service.impl.md#the-credential-handover). For `C` credential bytes, the compact report body occupies `97 + 4 × ceil((C + 162) / 3)` bytes: 146 bytes of report metadata and JSON structure, a 16-byte authentication tag, base64 expansion and 97 bytes of outer JSON, execution identity and encoded nonce. A 48,915-byte credential produces 65,533 bytes; one additional credential byte produces 65,537 bytes.
- Enforce the budget before creation or rotation commits, before OAuth login persistence, during execution-store construction and refresh normalization, and when accepting a decrypted refresh report. An oversized replacement changes neither stored material nor execution-store state.
- Creation and rotation use HTTP 400 `credential.input.invalid`. [OAuth completion](llm.impl.md#the-oauth-login) follows the existing sanitized failed-session path and stores nothing. Execution-store normalization rejects locally without material in the error. Custody rejects an oversized decrypted report with HTTP 400 `custody.handover.report_invalid`.
- Boundary tests cover both credential shapes, aggregate OAuth fields, multibyte UTF-8 and JSON escaping. They prove the maximum admitted credential completes handover and the mandatory release report through HTTP, and the next serialized byte refuses without a write or replacement. Gateway still refuses an oversized HTTP request with 413 before Custody validation.
