---
title: Gateway Service Vocabulary
---

# Gateway Service Vocabulary

This file holds the values and the examples of the terms that [gateway-service.md](viewer.html?p=gateway-service.md) owns.
This file is not a design document, and `gateway-service.md` stays the single source of truth.

## logged-in account

The human account that the Gateway Service authenticates.

The Gateway Service authenticates `ulrich` and establishes the logged-in account of `ulrich`.

## human authentication

The act by which the Gateway Service verifies the credentials of a human and establishes the human identity.

`ulrich` presents credentials at the CLI.
The Gateway Service checks them against the account store and establishes the human identity of `ulrich`.

## account store

The store that holds the accounts of the humans that the server serves, and the credentials of those accounts.

The Gateway Service checks the account store and finds the account of `ulrich` with its credential.
The account of `ulrich` names no project, because every authenticated human carries the same authority over every project of the server.

## forwarding contract

The guarantee that the human identity the Gateway Service passes to a downstream service is authentic and that no caller substitutes a different identity.

The Mission Service receives the human identity of `ulrich`.
It names that identity in its authorization call to the Project Service and does not re-authenticate `ulrich`.
