---
title: Gateway Service Implementation
---

# Gateway Service Implementation

This file holds the implementation rulings for the mechanisms that realize [gateway-service.md](viewer.html?p=gateway-service.md).
This file is not a design document, and `gateway-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the API surface, the account store or the forwarding contract.

## RESTful API

The daemon uses `hono` at 4.13.3 for the RESTful API and `@hono/node-server` at 2.1.1 to serve it on Node.js.
It uses `pino` at 10.3.1 for structured logging and `zod` at 4.4.3 for request validation.
Each request enters the daemon at one Hono application instance.
The Hono router dispatches each request to the handler of the service that owns the requested operation.
The handler is a module-level function, and each service registers its routes on that application at startup.
A `zod` schema validates the body and the path parameters of each route before the handler runs.
A validation failure returns a 400 before the handler runs.
A request with no matching route returns a 404 before any service handler runs.
`pino` logs each request at the entry point and each response at the exit point.
Each log record names the route, the method, the status and the latency.

## Entry paths

The work pull of the Worker Service is a registered route on the Hono application.
The registration of a worker instance is a registered route on the Hono application.
The MCP server of the Worker Service occupies its own path prefix on the same Hono application.
The Hono application passes each request of that prefix to the MCP server, which [worker-service.impl.md](viewer.html?p=worker-service.impl.md) owns.
A platform delivery enters through a registered route, and the handler passes it to the Scheduler Service.

## Human authentication

A human presents a username and a password at the login route.
The Gateway Service checks them against the account store.
A successful check produces a JWT that the Gateway Service issues to the caller.
Subsequent requests from the CLI and from any other client present the JWT as a bearer token in the Authorization header.
The JWT carries the human identity claim and a signature.
The Gateway Service verifies the signature on every request that requires authentication.
A failed verification returns a 401 before the handler runs.
The Gateway Service resolves the human identity from the claim of the verified JWT.
The JWT is long lived, so a human authenticates once and reuses the token.
The revocation mechanism is an open decision for an epic.
The machine path uses no JWT.

## Account store

The account store is a table in a SQLite database.
Whether it uses the database file of the system or its own file is an open decision for an epic.
[tracking-service.impl.md](viewer.html?p=tracking-service.impl.md) states the reason that the primary store of telemetry uses its own file, and the account store states no such reason today.
Each row holds the account identifier as the key, the hashed credential and the account metadata.
The credential of a human account sits at rest as a password hash.
The hashing algorithm is an open decision for an epic.
The Gateway Service holds the JWT signing key separate from the per-account records.
The signing key is the secret material of the Gateway Service, not a credential of a human account.
Whether the account store reuses the protected facility that the Project Service uses for secret material is an open decision for an epic.
A candidate is one shared secret-material facility for both, with separate record namespaces, so that one rotation or audit covers both.

## Forwarding contract

The services run in one process.
The Gateway Service passes the resolved human identity to the target service handler as an in-process value.
The human identity is an opaque object.
The constructor is not exported; only the Gateway Service module creates a human identity value through an internal factory.
No other module in the process constructs a human identity value.
A value in existence was created by the Gateway Service module, which establishes its provenance.
A downstream service receives the identity as a read-only value and reads its kind field to confirm its type.
Forgery of a human identity requires a code-level change.
The JWT does not travel beyond the Gateway Service: downstream services receive the in-process identity value, not the token.

## Design revision

This sibling realizes the Gateway Service design at revision `96920897667ccc74ff043cd7eab0f3262ddb1ee1`.
