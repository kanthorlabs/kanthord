---
title: Custody
---

# Custody

## Scope

[Custody](custody.vocabulary.md#custody) is a shared component that every service uses, not a service.
It owns resource credentials and their protection.
The [Project Service](project-service.md#authorization-and-credential-custody) owns system authorization.
Custody grants no authority through possession of a credential reference.

## Credential records

- A [credential store](custody.vocabulary.md#credential-store) holds a credential as one [credential store record](custody.vocabulary.md#credential-store-record) for each [credential revision](custody.vocabulary.md#credential-revision) of its secret.
- A human chooses its [credential name](custody.vocabulary.md#credential-name), which is unique on the server, and every revision of the credential holds that name.
- A record belongs to no project and can serve more than one project.
- A credential reaches an operation through the entity that performs it, never through a direct relationship with a project.
- That entity holds a [credential reference](custody.vocabulary.md#credential-reference).
- Each record names its [platform](custody.vocabulary.md#platform), and its name is its only human label.
- Its platform defines its secret shape, its metadata and its validation. Each platform holds exactly one secret shape, and a second shape for the same remote is another platform.
- Custody refuses an unsupported platform.
- A human enters a credential into custody behind the [protected facility](custody.vocabulary.md#protected-facility).
- An OAuth credential enters only through a [login session](custody.vocabulary.md#login-session) on the server.
- Creation and rotation make no remote call.
- A rotation adds the next revision under the same name and keeps the older revisions live.
- A reference names the credential by its name and never a revision.
- An execution pins the newest live revision at its first use of a credential and uses that revision until the execution ends.
- An operation outside an execution uses the newest live revision.
- An older revision takes no new pin, and custody [drains](custody.vocabulary.md#drain) it when no live execution pins it.
- A human [revokes](custody.vocabulary.md#revoke) a revision to end it at once, and every pinned use of that revision is refused.
- Custody refuses a revoke of the newest live revision.
- Each revision holds its own metadata. A rotation copies the metadata of the newest live revision, and the human can replace it in that rotation.
- Custody refuses removal while dependents exist and lists those dependents in the refusal.
- Dependents include every agent provider that names the record.
- The dependency check and removal are atomic.
- Every record answer contains metadata and no secret.

## Suitability and authority

- [System authorization](project-service.vocabulary.md#system-authorization) is what kanthord permits an identity to access.
- [Credential authority](custody.vocabulary.md#credential-authority) is what the remote permits any holder.
- The Project Service enforces system authorization, and custody records credential authority.
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
- Custody checks a model inference call through the worker binding of the claim and its effective agent provider.
- The [Worker Service](worker-service.md#agent-configuration) resolves that selection.
- A refusal reaches no secret material.
- A credential leaves the server only through a [credential handover](custody.vocabulary.md#credential-handover) to a kanthord worker application.
- The handover lasts for the execution.
- The worker application reports a refreshed credential to custody.
- Custody refreshes no revision while a handover of that revision remains outstanding.
- Disablement takes effect at the next resolution and recalls no handover in flight.
- No credential reaches an external harness, agent context, tool result, log record or workspace file.
- An execution holds no credential itself.
- The [execution store view](custody.impl.md#the-credential-store-of-an-execution) supplies the native runtime.
- The [Project Service](project-service.impl.md#the-acquisition-grant) owns acquisition grants.
- The [Project Service](project-service.impl.md#presigned-storage-grants) owns presigned storage grants.

## Login sessions

- A login session offers the interaction modes that its platform supports.
- It states the address and code that the human needs.
- The human completes the interaction and returns a provider code when necessary.
- A failed or expired session stores nothing.

## Resource healthcheck

Custody owns the [resource healthcheck](architecture.vocabulary.md#resource-healthcheck) of a credential store record.
Its [platform validator](custody.vocabulary.md#platform-validator) validates the record on demand.
The [implementation](custody.impl.md#the-resource-healthcheck) defines each remote probe and its limits.
A healthcheck changes no credential and authorizes no operation.
