---
title: Custody Vocabulary
---

# Custody Vocabulary

This file holds the values and the examples of the terms that [custody.md](custody.md) owns.
This file is not a design document, and `custody.md` stays the single source of truth.

## custody

The protection of resource credential material behind a protected facility.
For a GitHub read, custody uses the key that repository binding `kanthord-repo` references after authorization passes.

## credential store

The store of resource secrets.
The store holds one GitHub key that the repository bindings of `atlas` and `beacon` reference.

## credential store record

One revision of a credential: its secret, platform, metadata, times and revision number.
Record `credential_01J8Z3N5K7Q2W4E6R8T0Y2V4X6` has name `copilot-login` and platform `github-copilot`.
Its platform gives it the secret shape `oauth`.
The closed set of secret shapes is:

- `api_key`
- `oauth`
- `s3_access_key`

## credential revision

One version of the secret of a credential, stored as one credential store record.
A rotation adds the next revision and keeps the older revisions live until custody drains them or a human revokes them.
`github-main` holds revision 1 with key A. A rotation adds revision 2 with key B, an execution that pinned revision 1 finishes with key A, and a new execution takes key B.

## drain

The automatic end of an older credential revision when no live execution pins it.
Revision 1 of `github-main` drains after the last execution that pinned it ends, and a human then revokes key A at GitHub.

## revoke

The immediate end of a credential revision by a human.
Key A of `github-main` leaks, so a human revokes revision 1, and the next use of key A by a pinned execution is refused.

## credential name

The human-selected name of a credential store record, unique on the server.
A second creation with name `atlas-github` returns the identity of the record that holds that name.

## credential reference

The reference through which an entity reaches a credential store record.
Repository binding `kanthord-repo` and agent provider `openai-org` each name their own credential.

## platform

The external system at which a credential authenticates.
The set is closed:

- `github`
- `github-copilot`
- `anthropic`
- `openai-compatible`
- `s3`

A repository binding names `github` explicitly; an address proves no platform.
Each provider of an agent provider maps to one platform.
The pi adapter id `openai-compatible` names no platform.
The credential's platform and metadata identify the external system.

## platform validator

The custody part that declares the accepted types, the metadata schema and the validation of one platform.
The platform validator of `github` accepts `api_key` and validates a record with `GET https://api.github.com/rate_limit`.

## suitability

Custody's check that the credential platform equals the platform of its use.
A repository binding requests `github` with an `anthropic` record, so suitability fails.
An `s3` record for another endpoint passes the use check; its first upload fails at that endpoint.

## credential authority

What the remote permits any holder of a credential.
A GitHub key permits access to an entire account even when kanthord authorizes only repository `kanthorlabs/kanthord`.

## protected facility

The boundary that checks authorization before secret use.
An execution requests a GitHub read for another node, so the facility refuses it before custody reads ciphertext.

## credential handover

The encrypted transfer of execution credentials to the kanthord worker application that hosts the execution.
An execution on `build-02` receives the credential of its effective agent provider and its repository platform key.
The application reports refreshed OAuth material and discards the credentials at execution end.

## login session

One human attempt to obtain an OAuth credential on the server.
Its closed state set is:

- `pending`
- `completed`
- `failed`
- `expired`

Its closed mode set is:

- `browser`
- `device`

A platform offers only the modes that it supports.
Ulrich starts `copilot-login` in device mode and enters code `ABCD-1234` at `https://github.com/login/device`.
Custody stores the credential when the session completes.
