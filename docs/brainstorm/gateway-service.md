---
title: Gateway Service
---

# Gateway Service

## Scope

This document describes the Gateway Service.
It describes the RESTful API of the server, the authentication of a human and of a machine, and the identity that the system passes to a service when a caller makes a request.
It describes no mechanism of another service.

## The RESTful API

- Every request enters the server through the Gateway Service.
- The request source is a human or a machine.
- The Gateway Service routes each request to the service that owns the requested operation.
- The CLI is a client of the same RESTful API. No separate entry path exists.
- The Gateway Service publishes a machine-readable contract of the RESTful API, and every client derives from that contract.
- The work pull, the registration of a worker instance and the MCP server sit behind the Gateway Service.
- A webhook delivery of an external platform enters through the Gateway Service, which passes it to the [Intake Service](intake-service.md#deliveries).

## Health report and liveness answer

- The Gateway Service answers a [health report](gateway-service.vocabulary.md#health-report) to a human.
- The report lists every resource that the [resource healthcheck rule](architecture.md#resource-healthcheck) names.
- It groups resources first by the owning service, then by [health scope](architecture.vocabulary.md#health-scope).
- It lists every resource on every request and pages or drops no entry.
- The health report answers success when every owning service returns its inventory.
- Each resource carries its [resource status](architecture.vocabulary.md#resource-status).
- The health report answers unavailable only when an owning service cannot supply its inventory.
- A resource status changes no answer status.
- The Gateway Service answers a [liveness answer](gateway-service.vocabulary.md#liveness-answer) to any caller without authentication.
- It reports the internal components of the server and of the Gateway Service only.
- No external resource changes it.

## Human authentication

- The Gateway Service authenticates a human before it forwards the request.
- It verifies a signed credential and establishes the human username named by that credential.
- It holds no human account row, no password and no credential of a human in a database. Its authority to issue and verify the credential comes from the server configuration.
- A credential of a human account authorizes no operation at a remote, so it is no credential of a resource.
- A failed authentication stops the request before it reaches any other service.
- A successful authentication establishes the [human identity](overview.vocabulary.md#human-identity) as the [logged-in account](gateway-service.vocabulary.md#logged-in-account).
- A human obtains an expiring credential only through an explicit local generation command. Server startup issues no human credential.
- The system holds no user management. A human shares a generated credential outside the system.
- A change of the server configuration revokes every issued credential at once. The system revokes no single credential.
- The CLI exposes no human login or logout flow.
- Human authentication establishes no registration record.

## Human identity

- The Gateway Service passes the [human identity](overview.vocabulary.md#human-identity) to the service that the human's request targets.
- This transfer satisfies the [forwarding contract](gateway-service.vocabulary.md#forwarding-contract).
- A downstream service confirms that the Gateway Service established the identity.
- No caller nominates itself as a human.
- The human identity states its kind, so a downstream service distinguishes it from a machine identity.
- A downstream service names the human identity and the target when it requests authorization from the [Project Service](project-service.md#authorization-and-credential-custody).
- The Gateway Service performs no authorization.

## Machine identities

- The Gateway Service authenticates a machine.
- A human obtains the expiring credential of a machine only through an explicit local generation command, and that credential is the only credential of the machine.
- The credential names one [client identity](project-service.vocabulary.md#client-identity) and the worker binding that groups its instances. A client identity is never reused, and it never moves to another worker binding.
- No database of the server holds a credential of a machine, a secret of a client identity or a list of the client identities of a worker binding.
- The machine presents that credential on every request, including the registration of its instance.
- A registration of a machine establishes a registration record, and it returns the [runtime identity](worker-service.vocabulary.md#runtime-identity) of the instance and no credential.
- The Gateway Service establishes the [machine identity](gateway-service.vocabulary.md#machine-identity) from that credential, and it passes the machine identity to the service that the request targets.
- This transfer satisfies the [forwarding contract](gateway-service.vocabulary.md#forwarding-contract), a downstream service confirms that the Gateway Service established the identity, and no caller nominates itself as a machine.

## Human authority

- Every authenticated human carries the same authority over every project of the server.
- The human identity serves attribution and the human-only restriction of the [unblock](mission-service.md#the-unblock).
- No per-project role binding governs a human operation.

## Boundary

- The [Project Service](project-service.md#authorization-and-credential-custody) owns system authorization.
- [Custody](custody.md) owns resource credentials.
- The [Mission Service](mission-service.md#criterion-and-authority) owns node writes and their authority.
- The [Scheduler Service](scheduler-service.md#work-pulls) owns claim and scheduling.
- The [Tracking Service](tracking-service.md) owns telemetry.
- The Gateway Service owns the RESTful API surface, [human authentication](gateway-service.vocabulary.md#human-authentication), the human identity, the credentials of a human account, and the [forwarding contract](gateway-service.vocabulary.md#forwarding-contract).
