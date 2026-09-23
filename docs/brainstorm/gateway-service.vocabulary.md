---
title: Gateway Service Vocabulary
---

# Gateway Service Vocabulary

This file holds the values and the examples of the terms that [gateway-service.md](gateway-service.md) owns.
This file is not a design document, and `gateway-service.md` stays the single source of truth.

## logged-in account

The human account that the Gateway Service authenticates.

The Gateway Service verifies a JWT whose subject is `kanthorlabs` and establishes that logged-in account without reading an account row.

## human authentication

The act by which the Gateway Service verifies the credentials of a human and establishes the human identity.

`kanthorlabs` presents the JWT generated from the server configuration as a bearer token.
The Gateway Service verifies its signature, expiry, subject and denylist status and establishes the human identity of `kanthorlabs`.

`kanthord jwt` generates a token for the default username `kanthorlabs`.
`kanthord jwt ulrich` generates a token whose subject is `ulrich`. When that token authenticates a request, the Gateway Service establishes the human identity of `ulrich`.

## machine identity

What the Gateway Service establishes from the credential of a machine, and what it passes to the service that the request targets.

An instance of the worker binding `claude-main` presents the JWT of the client identity `client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X6`.
That JWT holds `sub` = `client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X6`, `name` = `Claude Code on ulrich-mbp`, `kind` = `client`, `binding` = the identity of `claude-main`, and `iat`, `exp` and `jti`.
The Gateway Service verifies that JWT and establishes the machine identity, which names the client identity, the worker binding `claude-main`, the project `Billing` and the runtime identity of its live registration.
The Project Service receives that value, and it takes no association from the caller.

## forwarding contract

The guarantee that the identity the Gateway Service passes to a downstream service is authentic and that no caller substitutes a different identity.

The Mission Service receives the human identity of `kanthorlabs`.
It names that identity in its authorization call to the Project Service and does not re-authenticate `kanthorlabs`.
The Project Service receives the machine identity of a registered instance, and it authenticates no machine of its own.
