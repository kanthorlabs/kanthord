---
title: Custody
---

# Custody

## Scope

[Custody](custody.vocabulary.md#custody) is a shared component that every service uses, not a service.
It owns the protection of resource credentials.
Custody protects credentials: it stores their revisions, refreshes them and releases their material.
It knows no [platform](architecture.vocabulary.md#platform).
The component that owns a platform validates its records, under [architecture.md](architecture.md#shared-components).
Custody performs no operation of a service.
The service that owns the entity of a release enforces its [system authorization](project-service.vocabulary.md#system-authorization).
The human configuration of an [inbound](intake-service.vocabulary.md#inbound) authorizes the release of its credential, and the [Intake Service](intake-service.md#boundary) performs that release.
Custody grants no authority through possession of a credential reference.

## Credential records

- A [credential store](custody.vocabulary.md#credential-store) holds a credential as one [credential store record](custody.vocabulary.md#credential-store-record) for each [credential revision](custody.vocabulary.md#credential-revision) of its secret.
- A human chooses its [credential name](custody.vocabulary.md#credential-name), and every revision of the credential holds that name.
- Each record has one [holder](custody.vocabulary.md#holder): `server`, or the name of one [worker instance](overview.vocabulary.md#worker-instance) of the [`worker` placement](worker-service.md#worker-instances). Only an instance at the `worker` placement holds an X25519 key and is its own holder. An instance at the `server` or the `container` placement is no holder.
- A credential name holds one copy for each holder. Each copy keeps its own revisions, its own cooldown and its own archive.
- One credential name holds one platform over every holder.
- Only a record of an [LLM platform](llm.vocabulary.md#llm-platform) takes an instance holder. Every SSH key and every storage key has the holder `server`.
- The server stores an instance copy only as a [sealed object](custody.vocabulary.md#sealed-object) to the public key of its instance. The server holds no private key of an instance and never opens an instance copy.
- A human enters a secret once and names its holders. The server seals the secret to the current public key of each instance holder and drops the plaintext.
- A worker instance enters a copy of its own holder only, already sealed to its own key.
- A copy sealed to a key that is not the current key of its instance has no holder. No check accepts it until a human enters its secret again.
- A record belongs to no project and can serve more than one project.
- A credential reaches an operation through the entity that performs it, never through a direct relationship with a project.
- That entity holds a [credential reference](custody.vocabulary.md#credential-reference).
- Each record names its [platform](architecture.vocabulary.md#platform), and its name is its only human label.
- A dropdown of the dashboard shows a credential as `<name> (<platform>)`.
- The component that owns the platform defines its secret shape, its metadata and its validation. Each platform holds exactly one secret shape, and a second shape for the same remote is another platform.
- The component refuses a platform that it does not own.
- A human enters a credential into custody behind the [protected facility](custody.vocabulary.md#protected-facility).
- An OAuth credential enters only through a [login session](llm.vocabulary.md#login-session) of the LLM component. A login session of the holder `server` runs on the server. A login session of an instance holder runs on that instance.
- An SSH key enters only through `Create SSH key` of the [Repository component](repository.md#credential-records). The server generates the key, and no human enters a private key.
- Creation and rotation make no remote call.
- A rotation adds the next revision under the same name and, in the same transaction, drains every older live revision that no live execution pins. A pinned older revision stays live until custody drains it or a human revokes it.
- A reference names the credential by its name and never a revision.
- An execution pins the newest live revision at its first use of a credential and uses that revision until the execution ends.
- An operation outside an execution uses the newest live revision.
- An older revision takes no new pin, and custody [drains](custody.vocabulary.md#drain) it when no live execution pins it.
- A human [revokes](custody.vocabulary.md#revoke) a revision to end it at once, and every pinned use of that revision is refused.
- Custody refuses a revoke of the newest live revision.
- Each revision holds its own metadata. A rotation copies the metadata of the newest live revision, and the human can replace it in that rotation. A metadata edit inserts the next revision and copies the secret.
- A human archives a credential to end it for good. An archive ends every live revision, keeps the rows and is final.
- Custody refuses an archive while dependents exist and lists those dependents in the refusal.
- Dependents include every agent provider that names the record.
- Dependents include every inbound that names the record.
- Dependents include every binding revision that names the record and that no tombstone follows, while it is the latest revision of its binding or a node that is not terminal and not retired pins it. A binding edit that names another credential leaves a pinned older revision a dependent.
- These dependents apply to the copy of the holder `server`. The dependents of an instance copy are the worker bindings that list its instance and whose agent configuration names the credential.
- The archive of a worker instance archives every copy of that instance in the same transaction.
- The dependency check and the archive are atomic.
- Every record answer contains metadata and no secret.

## Suitability and authority

- [System authorization](project-service.vocabulary.md#system-authorization) is what kanthord permits an identity to access.
- [Credential authority](custody.vocabulary.md#credential-authority) is what the remote permits any holder.
- The service that owns the entity of an operation enforces system authorization, and custody records credential authority.
- The boundary is the authorization of an operation, not the custody of bytes.
- An agent that never reads a key still uses an authenticated tool.
- One API key authorizes a whole account.
- Unrestricted selection of a record is the danger, not central storage.
- A human selects the record that satisfies a use.
- Custody performs [suitability](custody.vocabulary.md#suitability).
- A service consumes only its result.
- A use check compares the platform of the record with the platform of the use, and compares no metadata.
- Custody refuses a platform mismatch before any remote call.
- A binding does not narrow [credential authority](custody.vocabulary.md#credential-authority) at the remote.
- Suitability establishes no scope or authorization.
- An OAuth credential does not imply a person.

## Secret use and handover

- The protected facility checks authorization before custody reads secret material.
- An execution identity under a live claim proves liveness, not authority for an operation.
- Custody releases the material of a model inference call through the worker binding of the claim.
- It uses the agent provider of the pinned [agent selection](agent.vocabulary.md#agent-selection).
- The claim pins that selection through the [Agent component](agent.md#selection).
- Custody releases the material of a model inference call of a workbench session through the workbench session and the agent provider of its configuration, under the human identity of the message that started the run, inside the server process.
- A refusal reaches no secret material.
- Custody releases the material of an authorized grant inside the server process, and the holder performs its own operation.
- A credential leaves the server only through a [credential handover](custody.vocabulary.md#credential-handover) to a kanthord worker application.
- One credential store serves the server and every placement. A human enters a secret once, and one entry writes a copy for each holder that the human names.
- An instance at every [placement](worker-service.vocabulary.md#placement) receives its credentials only through the credential handover, and it reads no record of the credential store.
- An instance at the `server` or the `container` placement uses the copy of the holder `server`. Its handover crosses only the slot channel on the server host.
- Custody never releases a server-held credential, LLM or SSH, to an identity of the `worker` placement, on any network.
- At the `worker` placement, the handover carries only the copies of the instance of the identity, sealed to the key of that instance. It carries no SSH key.
- The git operations of the `worker` placement sign through the [SSH signature relay](repository.md#repository-connector), so no SSH key leaves the server.
- kanthord has no server-side LLM proxy. A worker instance calls its provider directly.
- Custody refuses a release on the server of an instance copy, because the server cannot open it.
- The worker unit holds no `master_key` and no machine credential of the server. An instance at the `server` or the `container` placement holds only the `client_secret` that the pool host derives for each binding that lists it.
- A worker instance holds its own private key. It receives the `client_secret` of each of its registrations sealed to that key, under [the instance exchange](worker-service.impl.md#the-instance-exchange).
- `master_key` never leaves the server. The server derives each `client_secret` and sends only the derived value.
- A tool process at the `server` placement runs as the server OS user. It can read every credential, `master_key`, the JWT signing key and the database. kanthord accepts this reach in v1. See [Trust boundary](worker-service.impl.md#trust-boundary).
- `container` is the contained placement. A tool process at the `container` placement reads no file of the server.
- A tool process of any binding that a worker instance serves can read the key of that instance and open every copy of that instance. See [Trust boundary](worker-service.impl.md#trust-boundary).
- At the `server` and the `container` placements, the handover also carries the SSH identity of each repository binding of the execution. An instance at those placements therefore holds no SSH key of its own.
- The handover lasts for the execution.
- The worker application reports a refreshed credential to custody. A worker instance reports a refreshed copy sealed to its own key.
- Custody refreshes no revision while a handover of that revision remains outstanding.
- Disablement takes effect at the next resolution and recalls no handover in flight.
- No credential reaches an external harness, agent context, tool result, log record or workspace file.
- An execution holds no credential itself.
- The [execution store view](custody.impl.md#the-credential-store-of-an-execution) supplies the native runtime.
- The [Intake Service](intake-service.impl.md#the-credential-release-of-an-inbound) takes one release for each remote call of an inbound.
- The Mission Service authorizes a presigned storage grant, and the [Intake Service](intake-service.impl.md#presigned-storage-grants) signs it.
