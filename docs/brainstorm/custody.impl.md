---
title: Custody Implementation
---

# Custody Implementation

This file holds the mechanisms that realize [custody.md](custody.md).
This file is not a design document, and `custody.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## The credential store record

- Custody owns the shared `credential` table and the [credential envelope](architecture.impl.md#the-credential-table).
- A row holds `id`, `name`, `platform`, `holder`, `sealed_to`, `revision`, `secret`, `metadata`, `created_at`, `ended_at`, `available_at` and `strikes`. One row is one revision of one copy of a credential.
- The encrypted columns represent `secret`; no plaintext secret persists.
- The identity is `credential_<ulid>` under the [identity convention](architecture.impl.md#the-identity-and-the-time), and it names one revision.
- A name holds 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens.
- `holder` is `server` or the name of a worker instance, and it is never null. `sealed_to` is the fingerprint of the instance revision that the copy is sealed to, and it is null for `server`.
- The group key of a credential is `(name, holder)`, and neither part changes. A unique index holds `name`, `holder` and `revision`, and a new group starts at revision 1.
- Custody validates the fingerprint form of `sealed_to`. The [LLM component](llm.impl.md#instance-copies) validates that `holder` names a live instance.
- Custody refuses a `holder` other than `server` for a platform outside the LLM platforms with 400 `credential.sealed.invalid`.
- The names `login`, `platform`, `check` and `ssh` are refused, because the static segments of the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) hold them.
- Creation and login refuse a `(name, holder)` group that a row holds with 409 `credential.name.conflict` and the identity of its newest revision in `error.details`.
- A login checks the group at start and at commit.
- One name holds one platform over every holder. A creation of an existing name with another platform answers 409 `credential.name.platform_conflict`.
- Custody stores the platform value that the owning component supplies, and it validates no platform.
- The newest live revision is the row of the group with the greatest `revision` and a null `ended_at`.
- Every rule of this section on revisions, rotation, drain, revoke, metadata edit and archive applies to one `(name, holder)` group.
- A rotation inserts the next revision in one transaction. It copies the metadata of the newest live revision unless the request replaces it, and after the insert it drains every older live revision that no live execution pins in the same transaction.
- A drain and a revoke set `ended_at`.
- An OAuth refresh writes the pinned revision in place and adds no revision.
- Rotation and OAuth refresh change no binding revision.
- A metadata edit inserts the next revision in one transaction, with the secret of the newest live revision and the new metadata, and the older revisions stay live until custody drains them or a human revokes them.
- A rotation and a metadata edit name `expected_revision`, the newest live revision that the human read. A stale value answers 409 `credential.revision.conflict` with the current value in `details`.
- Every answer includes metadata and excludes the secret.
- An archive checks every dependent, including agent providers, in the transaction of the commit.
- An archive calls the Project collaboration `bindingsNaming(tx, credentialName)` in that transaction. It answers every binding revision that names the credential and that is a dependent.
- An archive calls the Intake collaboration `inboundsNaming(tx, credentialName)` in that transaction. It answers every inbound that names the credential.
- These dependents apply to the group of the holder `server`. An archive of an instance copy calls the Project collaboration `bindingsListingInstance(tx, instanceName, credentialName)` in that transaction. It answers every worker binding that lists the instance and whose agent configuration names the credential.
- An archive sets `ended_at` on every live revision of the group and keeps the rows, because an execution record references them.
- A group with no live revision is archived. A drain and a revoke never end the newest live revision, so only an archive produces that state.
- An archive is final. An archived group takes no rotation, metadata edit or second archive, answers 409 `credential.credential.archived`, and stays taken.
- A refusal lists the dependents.
- `archiveHeld(tx, holder)` ends every live revision of every group of that holder. The Worker Service calls it in the transaction of an [instance archive](worker-service.impl.md#worker-instances). It checks no dependent, because the instance archive refuses while a binding lists the instance.
- Creation and rotation validate the local schema of the owning component and make no remote call.
- Custody logs a human creation or update with the human identity and row identity, never the secret.
- A generated secret enters through a record function for a generated secret, beside `createLoginRevision`. Its rotation calls a rotate function for a generated secret. Neither function takes material from a request.

The [platform validator](architecture.vocabulary.md#platform-validator) of the owning component names the secret shape of a record. Custody holds one secret schema for each shape:

- `api_key`: `{ key }`.
- `oauth`: `{ refresh, access, expires }`; only a login session supplies initial material.
- `s3_access_key`: `{ access_key_id, secret_access_key }`; a session token is invalid.
- `ssh_key`: `{ private_key }`; only the generated create and the generated rotation of the owning component supply material. A generic create, rotation or metadata edit of a platform with `ssh_key` answers 400 `credential.entry.unsupported`. The schema checks the armor lines of the `openssh-key-v1` text and a size bound.

## The sealed object

- The plaintext under the credential envelope of an instance copy is the [sealed object](custody.vocabulary.md#sealed-object) `{ alg, enc, ciphertext }` in canonical JSON. `enc` and `ciphertext` are base64url.
- `alg` is `hpke-x25519-sha256-aes128gcm`: RFC 9180 base mode with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and AES-128-GCM.
- The recipient key is the X25519 public key of the instance revision that `sealed_to` names. The info is `kanthord/credential/v1`.
- The additional authenticated data is the canonical JSON `{ name, platform, holder, sealed_to }`.
- The sealed plaintext is the stored-secret form of the secret shape of the platform, as for a row of the holder `server`.
- The plaintext budget is 32,768 bytes. A ciphertext above 32,784 bytes answers 400 `credential.sealed.invalid`.
- The server, the CLI and the worker application seal and open through [the HPKE dependency](architecture.impl.md#the-hpke-dependency).

### The seal of a human entry

- A creation or a rotation under a human identity takes the plaintext secret and the holders. Custody validates the secret schema of the shape once.
- For each instance holder, custody reads the current public key and fingerprint of the instance through the Worker Service, seals the secret and sets `sealed_to`.
- Custody writes one row for each holder in one transaction. A holder `server` takes the credential envelope as today.
- Custody clears the plaintext buffer in a `finally` block after the seal, also after a failure.

### The entry of an instance

- A creation or a rotation under a [worker token](gateway-service.vocabulary.md#worker-token) takes `sealed` and `sealed_to`. Its holder is the instance of the token.
- Custody checks the form of the sealed object, the budget, and that `sealed_to` equals the current fingerprint of the holder. A failure answers 400 `credential.sealed.invalid`.
- Custody cannot check the secret schema of a sealed copy. The instance validates the secret before it seals.

### Rules of an instance copy

- An instance copy whose `sealed_to` is not the current fingerprint of its holder has no holder. The holder rule, the handover and the health of the instance refuse it.
- Custody decrypts a stored secret only through one private open function `openSecret(row)`. It refuses a row whose holder is not `server` with 409 `credential.credential.held_by_instance` before the decrypt.
- Every decrypt path calls `openSecret`: `release`, `releaseWorkbench`, the resource check of `resourceInventory`, `resourceCheck` and `verify`, `checkMaterial`, `updateMetadata` and `applyReport`.
- The refusal therefore covers the verify, the pre-save check, the provider check, the model check, the model list and a workbench session.
- `src/custody/secret.ts` holds `openSecret` and `storedSealed`, and no other custody module calls `decrypt`. `storedSealed` opens the credential envelope of an instance copy and answers its sealed object. It never opens the sealed object.
- `heldCopy(tx, set, name, holder)` answers the newest live revision of the copy of an instance holder, or null. `sealedCopy(tx, set, name, holder)` answers that revision with its sealed object for [the health of an instance copy](llm.impl.md#the-health-of-an-instance-copy), and it refuses a copy sealed to an ended key with 404 `credential.credential.not_found`.
- A record answer adds `holder`, `sealed_to` and `sealed_current`. `sealed_current` is true when `sealed_to` equals the current fingerprint of the holder, and it is true for `server`.

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
- A [sealed object](#the-sealed-object) uses the public key of a worker instance. The server holds no private key of an instance.
- A replacement of `master_key` refuses the start, as [the master_key record](#the-master_key-record) rules.
- [The verification secret](intake-service.impl.md#the-verification-secret) of the Intake Service owns the webhook secret derivation.

## The master_key record

- Custody owns the table `custody_master_key(id, verifier, created_at)`, and it holds one row with `id` 1.
- `verifier` holds `HKDF(master_key, info = "custody/key-check/v1")`, 32 bytes. The row holds no `master_key` and no cipher key, and the verifier derives neither.
- `enforceMasterKey(store, master_key, path)` runs in one transaction at the start of the server, after the migrations and before the construction of any service. It compares the stored verifier with the derived one in constant time. A match starts. A difference refuses the start with `system.config.master_key_mismatch`, and the transaction writes nothing. A database without the row records the verifier of the `master_key` that starts it.
- The message names the database path, the configuration path and the remedy: restore the configuration file that created this database, or restore the database backup that matches the configuration file. It prints no key.
- `verifyMasterKey(store, master_key, path)` is the read-only half. It answers `false` for a database without the table or the row, and it refuses a difference with the same diagnostic. [The upgrade](architecture.impl.md#the-upgrade) calls it after the history check and before any backup, with the `master_key` of the upgraded configuration.
- A database without the record accepts the first `master_key` that starts it. A database of an earlier binary gains the table through `kanthord upgrade`, and the next start records the key.
- No command rotates `master_key`. A new `master_key` starts with a new data directory.
- A change of `gateway.auth.version` changes no verifier, because the label holds no authentication version.
- The `worker` application holds no `master_key` and reads no database, so it holds no record.

## The protected facility

- The facility consumes the authorization result of the service that owns the entity of the release.
- Its authorization function accepts requester identity, entity and requested operation, and returns a grant or refusal. The requested operation names the kind of release, for example `poll`, `workbench` or `ssh_identity`.
- A module-private `WeakSet` records each frozen grant, so a caller cannot fabricate one.
- Custody consumes an operation grant at its first use.
- A consumed grant authorizes no second operation.
- A release for an inbound needs no Project decision. The facility checks that the requester is the Intake service identity and that the operation is `poll`, under [intake-service.impl.md](intake-service.impl.md#the-credential-release-of-an-inbound).
- A release for a workbench session names the human identity of the message that started the run as the requester, the workbench session as the entity and `workbench` as the operation.
- The Workbench Service grants that release while the workbench session exists, the enablement of its agent is enabled and the configuration of the session is valid.
- A release for an [`env@1` session](project-service.impl.md#the-agent-env1) names the service identity of the Project Service as the requester, the session as the entity and `environment_agent` as the operation. The Project Service grants it while the session runs and the enablement of `env@1` is enabled. A human or a machine requester is refused.
- A release for an environment secret names the service identity of the Project Service as the requester, the binding and the variable as the entity and `environment_secret` as the operation. It pins the revision that the digest of the run holds. The facility refuses another requester, an archived credential and a credential of another platform.
- A run whose human identity no longer passes the Gateway checks stops at its next release.
- Human and machine identities pass the checks of [Gateway identity verification](gateway-service.impl.md#the-jwt).
- A service identity passes `isServiceIdentity` of the kernel.
- An execution identity resolves through the Scheduler Service to the node of its live claim.
- The facility refuses another node and takes no association from the caller.
- For an external harness, the machine identity and execution identity prove the complete chain.
- The JWT names the client identity and worker binding; the registration is live.
- The live claim names that binding and registration, and its node is the node of the operation.
- A break in that chain refuses the operation before ciphertext access.
- A model inference call resolves through the worker binding and selected agent provider, never a credential relationship with a project.
- The requested operation `ssh_identity` releases the key of an `ssh` record under [the release of an SSH key](#the-release-of-an-ssh-key).

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

## The release of an SSH key

- Custody releases the key of an `ssh` record through the protected facility with the requested operation `ssh_identity`. The Project Service owns the binding, so it supplies the authorization function.
- A human identity passes for a binding of a project. It also passes for the draft configuration of a binding write, a binding check or a binding verify.
- The service identity of the Project Service passes for a live binding: the resource healthcheck and the instruction files read.
- A machine identity with a proven execution claim passes only for a repository binding of the pinned node revision of that claim. The Gateway proves the claim of `execution_id` in `src/gateway/invocation.ts`, as it does for `worker.handover` and `intake.action.perform`.
- At the `worker` placement, the material stays on the server. The [SSH signature relay](worker-service.impl.md#the-ssh-signature-relay) takes the same grant, signs on the server and drops the material.
- `CustodyComponent.sshSign` refuses a placement other than `worker` with 403 `worker.ssh.placement_refused`. It then opens the sealed request and authorizes the grant for its `binding_id`. `sshSignatureOf` of the Repository component checks the payload with the `public_key` metadata of the revision and the pinned host key. After the check, it releases the key through custody, signs, and drops the material. Custody seals the signature. A refused payload decrypts nothing and writes no release log line.
- `CustodyComponent.sshPublicKeyOf` answers the `public_key` metadata for the execution setup. It reads the pinned revision of the credential name, else the newest live revision, and it pins nothing.
- The service identity of the Mission Service passes for `intake.action.check`, through the pinned `FrozenAction`, under the Intake rule of that operation.
- A release under a machine identity with a proven execution claim pins the revision to the execution at first use. It calls `pinCredential` in the same transaction. Every other release reads the newest live revision.
- A release of a legacy `ssh` record answers 409 `repository.credential.ssh_key_legacy` under [the Repository rule](repository.impl.md#legacy-ssh-records).
- The holder builds `SshAccess` through `RepositoryComponent.sshAccessOf` and drops the material in `finally`.

## The credential store of an execution

- Custody implements `CredentialStore` of `@earendil-works/pi-ai` at 1.1.0.
- `src/custody/client.ts` exports `executionCredentialStore`, `ExecutionStoreError` and `ExecutionCredentials`; handover schemas remain in `contract.ts`.
- `src/custody/client.ts` also exports `openSealedCopy`, `sealedCopyReporter`, `InstanceCopyKey` and `OpenedCopy` of `src/custody/instance-copy.ts`. The worker unit opens a sealed item with them, and seals each refreshed credential to its own key.
- The methods are `read(providerId)`, `list()`, `modify(providerId, fn)` and `delete(providerId)`.
- The [Worker Service](worker-service.impl.md#the-credential-store-of-an-execution) defines the selection and visibility of the execution view.
- `list()` returns the selected non-secret pair of adapter id and credential type, and custody takes that type from the secret shape that the owning component declares for the platform of the record.
- The view reads the revision that the execution pins.
- `modify()` serializes on the pinned revision and writes the pi-ai result in place.
- The view refuses `delete()`.
- At every placement, the view reads the decrypted handover. The worker unit reads no custody record directly. At the `worker` placement, the worker unit opens the sealed item of the handover with the private key of its instance.
- Custody drops the view at execution end.
- A workbench view reads the newest live revision and pins no revision.

## The credential handover

- [Worker handover operations](worker-service.impl.md#the-credential-handover) transport the envelope and refresh report.
- The payload is canonical JSON. It holds the credential of the pinned agent selection of the execution and the SSH identities of the execution.
- `custody.handover` takes the placement of the pinned worker binding and the instance of the identity, and it chooses each item from those values.
- At the `server` and the `container` placements, its sole item is `{ credential_id, provider_id, credential }`. These are the record identity, the pi adapter id and the pi-ai credential of a row of the holder `server`.
- At the `worker` placement, its sole item is `{ credential_id, provider_id, name, platform, sealed }`: the sealed object of the copy of the instance of the identity. The server never opens it. The worker unit builds the additional authenticated data from `name`, `platform`, its instance name and its current fingerprint.
- At the `worker` placement, an item of the holder `server` answers 403 `custody.handover.holder_refused` with `details.reason` `server_held`. An item of another holder, or a copy sealed to a fingerprint that is not current, answers the same code with `reason` `held_elsewhere`.
- The payload holds `ssh_identities: [{ binding_id, credential_id, private_key }]` beside `items`, one entry for each repository binding of the pinned node revision, at the `server` and the `container` placements. An execution with no repository binding holds `[]`.
- At the `worker` placement, `ssh_identities` is always `[]`. The worker unit signs through the [SSH signature relay](worker-service.impl.md#the-ssh-signature-relay).
- `ssh_identities` stays out of `CredentialStore`. The execution store keeps its one pi-ai credential.
- The handover authorizes each `ssh_identities` entry through the `ssh_identity` grant under the machine identity with the proven claim, and it pins each revision.
- A refresh report never carries an SSH key. A report with a credential type other than `api_key` and `oauth` answers 400 `custody.handover.report_invalid`.
- The plaintext of a refresh report is `{ credential_id, digest, credential }` for a row of the holder `server`, and `{ credential_id, digest, sealed }` for an instance copy. The worker instance seals the refreshed credential to its own key.
- `applyReport` reads `holder` of the row before any other step.
  - For an instance copy, `digest` is the digest of the stored sealed object. Custody compares it with the stored sealed object and never decrypts.
  - For a row of the holder `server`, `applyReport` calls `openSecret` and compares `digest` with the digest of the stored credential value.
- AES-256-GCM uses the key of its direction, a random 12-byte nonce and a 16-byte tag. A handover uses the handover key, and a refresh report uses the refresh-report key.
- Additional authenticated data concatenates the length-prefixed execution identity and runtime identity.
- The worker application holds the client secret of its machine JWT and derives the same two keys. Custody derives the client secret again from the verified `sub`.
- At the `server` and the `container` placements, the envelope crosses only the slot channel on the server host. A `container` slot receives its client secret in the `init` frame of [the slot channel](worker-service.impl.md#the-slot-channel-of-a-container).
- At the `worker` placement, a worker instance receives the client secret of each registration in the sealed connection answer of [the instance exchange](worker-service.impl.md#the-instance-exchange). The envelope crosses the network, and its item stays sealed to the instance key inside it.
- A valid tag proves the sender and the direction, because only the server and that one worker application hold the client secret.
- A refresh report carries the digest of the credential value that it replaces. Custody writes the new value in place only when the stored value has that digest, in the same transaction, so a replayed earlier report writes nothing.
- The client secret protects the handover and the refresh report alone. Registration, the work pull and the MCP calls stay bearer-only.
- The envelope has no forward secrecy. A client secret that leaks later opens every recorded envelope of its client identity.
- The handover carries the revisions that the execution pins.
- Custody refreshes no pinned revision on the server while a live execution holds it.
- Two executions can hold one revision at once.
- The refresh-token rotation behaviour of concurrent holders remains a provider constraint.
- Custody logs the execution identity, the record identity, `client_id` and `runtime_identity` of each handover and report, and `instance_id` at the `worker` placement, never material.
- `pino` redacts the payload paths.

## The credential hold

- The columns `available_at` and `strikes` of the row of revision 1 of a `(name, holder)` group hold the cooldown of that copy. Each copy holds its own cooldown, because each copy can hold another key. The hold is a runtime value of the copy, as an OAuth refresh is a runtime value of a revision.
- Every port function below takes the holder beside the name. `listHolds(tx)` answers `holder` in each item.
- `available_at` is the Unix millisecond end of the hold, null while no hold exists. `strikes` is `NOT NULL` with the default 0.
- Revision 1 exists for the whole life of a name, so the hold has one home. A rotation inserts the next revision with no hold and copies none. An archive keeps the rows and the hold.
- A drain of revision 1 sets its `ended_at` and leaves the hold unchanged. `holdOf`, `hold`, `release` and `listHolds` ignore `ended_at`, so the hold stays readable and writable on an ended revision 1.
- Custody offers the Agent component the port `CredentialHolds`. Custody writes no hold by itself.
  - `holdOf(tx, name)` answers `{ available_at, strikes }`, or null when no row exists or `available_at` is null.
  - `hold(tx, name, availableAt, strikes)` sets both columns of the row of revision 1 and asserts that exactly one row changes.
  - `release(tx, name)` sets `available_at` to null and `strikes` to 0 when `strikes` is above 0, and it answers whether it changed the row.
  - `listHolds(tx)` answers `{ credential, strikes, available_at }` for each name with `strikes` above 0, ordered by name.
- The table also holds the credentials of the Repository and Storage components. Only the agent chain reads a hold, and `credential.get` and `credential.list` answer none.
- Tests assert that a hold survives a rotation and that `release` of a name with no strike changes nothing.

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
- Every record function takes a holder. A list and a get take an optional holder filter, and the other functions name one `(name, holder)` group.
- `rotate` adds a revision without a remote call.
- `revoke` ends one revision at once.
- `archive` checks every dependent, ends every live revision of the name and keeps the rows. A dependent answers 409 `credential.credential.in_use` with the dependents in `details`.
- A list leaves out an archived name unless the query `include_archived` is `true`. A get answers an archived name.
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
- Tests cover a handover with an SSH entry, an execution with no repository binding, and a report with the credential type `ssh_key`.
- Tests cover the sealed object against the test vectors of RFC 9180 appendix A.1. They cover the seal of a human entry for two holders in one transaction. They also cover a sealed entry of an instance and each refusal of `credential.sealed.invalid`.
- Tests cover `credential.name.platform_conflict`, a hold of one copy that leaves the other copies free, and `archiveHeld`.
- Tests assert that `release()` refuses an instance copy. At the `worker` placement, a handover refuses a server-held item, an item of another holder and an item sealed to an ended fingerprint. The handover answers `ssh_identities: []`.
- Tests assert that a generic create, rotate, metadata edit and check of `ssh` refuse. Tests assert that a generated create logs no key, and that the database file holds no key text.
- Tests cover each requester kind of `ssh_identity`, a fabricated grant and a consumed grant.
- Tests assert that `release` refuses a consumed grant, a fabricated grant and an inbound operation under another service identity, and that `drop()` clears the buffer after a success and after a failure.
- Tests cover store isolation, `undefined` for another adapter id, serialized refresh and refusal of deletion.
- Tests assert no secret in outputs, logs, transcripts or errors.
- Tests cover the master_key record: the first start records it once, the recorded key starts again, another key refuses `enforceMasterKey` and `verifyMasterKey` with `system.config.master_key_mismatch` and keeps the row, and `verifyMasterKey` answers `false` without the table.

## Serialized credential budget

- For `api_key` and `oauth`, the normalized pi-ai credential occupies at most 48,914 UTF-8 bytes of canonical JSON. This shared shape constraint excludes `s3_access_key`.
- The budget derives from the 65,536-byte body limit of the [credential report](worker-service.impl.md#the-credential-handover). For `C` credential bytes, the compact report body occupies `98 + 4 × ceil((C + 163) / 3)` bytes: 147 bytes of report metadata and JSON structure, a 16-byte authentication tag, base64 expansion and 98 bytes of outer JSON, execution identity and encoded nonce. A 48,914-byte credential produces 65,534 bytes; one additional credential byte produces 65,538 bytes.
- An instance copy also follows the 32,768-byte plaintext budget of [the sealed object](#the-sealed-object).
- Enforce the budget before creation or rotation commits, before OAuth login persistence, during execution-store construction and refresh normalization, and when accepting a decrypted refresh report. An oversized replacement changes neither stored material nor execution-store state.
- Creation and rotation use HTTP 400 `credential.input.invalid`. [OAuth completion](llm.impl.md#the-oauth-login) follows the existing sanitized failed-session path and stores nothing. Execution-store normalization rejects locally without material in the error. Custody rejects an oversized decrypted report with HTTP 400 `custody.handover.report_invalid`.
- Boundary tests cover both credential shapes, aggregate OAuth fields, multibyte UTF-8 and JSON escaping. They prove the maximum admitted credential completes handover and the mandatory release report through HTTP, and the next serialized byte refuses without a write or replacement. Gateway still refuses an oversized HTTP request with 413 before Custody validation.
