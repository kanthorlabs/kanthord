---
title: Gateway Service
---

# Gateway Service

## Scope

This document describes the Gateway Service.
It describes the RESTful API of the server, the authentication of a human, and the [human identity](overview.vocabulary.md#human-identity) that the system passes to a service when a human makes a request.
It describes no mechanism of another service.

## The RESTful API

- Every request enters the server through the Gateway Service.
- The request source is a human or a machine.
- The Gateway Service routes each request to the service that owns the requested operation.
- The CLI is a client of the same RESTful API. No separate entry path exists.
- The Gateway Service publishes a machine-readable contract of the RESTful API, and every client derives from that contract.
- The work pull, the registration of a worker instance and the MCP server sit behind the Gateway Service.
- A delivery of an external platform enters through the Gateway Service, which passes it to the [Scheduler Service](scheduler-service.md#intake-and-observation).

## Human authentication

- The Gateway Service authenticates a human before it forwards the request.
- It checks the credentials that a human presents against the [account store](gateway-service.vocabulary.md#account-store).
- The Gateway Service holds the credentials of a human account in the [account store](gateway-service.vocabulary.md#account-store).
- A credential of a human account authorizes no operation at a remote, so it is no credential of a resource.
- A failed authentication stops the request before it reaches any other service.
- A successful authentication establishes the [human identity](overview.vocabulary.md#human-identity) as the [logged-in account](gateway-service.vocabulary.md#logged-in-account).

## Human identity

- The Gateway Service passes the [human identity](overview.vocabulary.md#human-identity) to the service that the human's request targets.
- This transfer satisfies the [forwarding contract](gateway-service.vocabulary.md#forwarding-contract).
- A downstream service confirms that the Gateway Service established the identity.
- No caller nominates itself as a human.
- The human identity states its kind, so a downstream service distinguishes it from a machine identity.
- A downstream service names the human identity and the target when it requests authorization from the [Project Service](project-service.md#authorization-and-credential-custody).
- The Gateway Service performs no authorization.

## Machine identities

- The Gateway Service authenticates no machine.
- It carries the [client identity](project-service.vocabulary.md#client-identity) of an instance of an external harness inward, unchanged.
- The [Project Service](project-service.md#authorization-and-credential-custody) verifies the client secret when it resolves the worker binding.

## Human authority

- Every authenticated human carries the same authority over every project of the server.
- The human identity serves attribution and the human-only restriction of the [unblock](mission-service.md#the-unblock).
- No per-project role binding governs a human operation.

## Boundary

- The [Project Service](project-service.md#authorization-and-credential-custody) owns system authorization, and it owns the custody of the credential of a resource that a project binds.
- The [Mission Service](mission-service.md#validation-criteria-and-authority) owns node writes and their authority.
- The [Scheduler Service](scheduler-service.md#work-pulls) owns claim and scheduling.
- The [Tracking Service](tracking-service.md) owns telemetry.
- The Gateway Service owns the RESTful API surface, [human authentication](gateway-service.vocabulary.md#human-authentication), the human identity, the credentials of a human account, and the [forwarding contract](gateway-service.vocabulary.md#forwarding-contract).
