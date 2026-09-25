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

One global record for a secret, with its platform, type, metadata, remote identity, times and revision.
Record `credential_01J8Z3N5K7Q2W4E6R8T0Y2V4X6` has name `copilot-login`, platform `github-copilot` and remote identity `github:user:ulrich`.
Its type is `oauth`.
The closed set of credential types is:

- `api_key`
- `oauth`
- `s3_access_key`

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
- `openai`
- `anthropic`
- `openai-compatible`
- `s3`

A repository binding names `github` explicitly; an address proves no platform.
Each provider of an agent provider maps to one platform.
The pi adapter id `openai-compatible` names no platform.
The credential's platform and metadata identify the external system.

## remote identity

The identity at the remote that a credential acts as.
Its form is `<namespace>:<identity kind>:<identifier>`.
The namespace names where the identity exists, not necessarily the platform of the record.
The term names no closed set.

- `copilot-login` has platform `github-copilot` and remote identity `github:user:ulrich`.
- A GitHub organization key names `github:organization:kanthorlabs`.
- An OpenAI key names `openai:organization:org-kanthorlabs`.

## suitability

Custody's check that the credential platform equals the platform of its use.
A repository binding requests `github` with an `openai` record, so suitability fails.
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
