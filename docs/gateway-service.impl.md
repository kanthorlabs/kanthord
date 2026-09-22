---
title: Gateway Service Implementation
---

# Gateway Service Implementation

This file holds the implementation rulings for the mechanisms that realize [gateway-service.md](viewer.html?p=gateway-service.md).
This file is not a design document, and `gateway-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the API surface, the account store or the forwarding contract.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.
The installed set provides `node:sqlite` `DatabaseSync`, `node:crypto` `argon2` and `timingSafeEqual`, `hono/jwt`, and `hono/testing` `testClient`.
It also provides `zod` `toJSONSchema` and the `hono` middleware `cors`, `body-limit`, `request-id`, `timeout` and `http-exception`.

## Transport

`@hono/node-server` at 2.1.1 serves one Hono application from `hono` at 4.13.3.
The server binds the loopback address and the port that `convict` at 6.2.5 resolves.
It uses no TLS.
Every service is a module of one process.
The Hono router dispatches each request to the handler of the service that owns the requested operation.
The handler is a module-level function, and each service registers its routes on the Hono application at startup.

## Configuration

[architecture.impl.md](viewer.html?p=architecture.impl.md) holds the configuration file, its field index, and the rule that the file is the only source of a value.
The Gateway Service owns the section `gateway`, and it declares the fields below.

- `gateway.bind` holds the bind address, as a string, it defaults to `127.0.0.1`, and the format accepts a loopback address only.
- `gateway.port` holds the port, in the `port` format of `convict`, and it defaults to `31415`.
- `gateway.allowedHosts` holds the host allowlist, as an array of strings, and it defaults to `127.0.0.1:31415` and `localhost:31415`.
- `gateway.allowedOrigins` holds the origin allowlist, as an array of strings, and it defaults to an empty array.

## Access policy

Every registered route declares one access policy value: `human`, `client`, `public` or `delivery`.
Registration throws at startup when a route declares none.
A request that matches no route returns 404.
The policy value lives in the operation registry, so one declaration drives the authentication middleware and the emitted contract.

## Identity on the wire

One `Authorization` header carries two schemes.
`Bearer` carries the JWT of a human.
`Basic` carries the client identity as `base64(clientId:clientSecret)`.
The Gateway Service parses the Basic credentials and verifies none of them.
The Project Service verifies the client secret when it resolves the worker binding.

## Human authentication

A human presents a username and a password at the login route under `/auth/*`.
The Gateway Service checks them against the account store.
A successful check produces the JWT that the Gateway Service issues to the caller.
The CLI and every other client present that JWT as a bearer token on a later request.
A request that carries a missing or an invalid credential on a route that requires one returns 401 before the handler runs.

## The JWT

`hono/jwt` signs and verifies with HS256, and the algorithm is pinned explicitly.
The claims are `sub`, `kind`, `iat`, `jti` and `ver`.
The token carries no `exp`, because one local human account reuses one token from the CLI.
Verification checks the signature and `kind` equal to `human`.
It checks the existence of the account named by `sub`.
It checks `ver` equal to the `token_version` of that account row.
An increment of `token_version` invalidates every earlier token of the account, and it cancels no request that already passed verification.

## The signing key

The signing key is `HKDF(masterKey, info = "gateway/jwt-hs256/v1")`, derived with `crypto.hkdfSync` and SHA-256 over an empty salt.
[architecture.impl.md](viewer.html?p=architecture.impl.md) holds the field `masterKey` of the configuration file and the rule that a service derives its keys from it.
The Gateway Service derives the key at startup, and it writes no secret material to the account store.
[architecture.impl.md](viewer.html?p=architecture.impl.md) rules the mode of the configuration file, of its directory, of the data directory and of every database file.
A copy of the configuration file carries the signing key, so that copy permits the forgery of a token.

## Password hashing

`crypto.argon2` of `node:crypto` hashes with argon2id, memory 65536 KiB, passes 3, parallelism 1, tag length 32 and a 16-byte nonce.
The stored record is `argon2id$v=19$m=65536,t=3,p=1$<nonce-b64>$<tag-b64>`.
The check compares with `timingSafeEqual`.
`@types/node` at 26.6.2 declares `argon2`, `Argon2Algorithm` and `Argon2Parameters`, so the implementation needs no local declaration.

## The account store

The account store sits in the operational database, and [architecture.impl.md](viewer.html?p=architecture.impl.md) rules that file and its driver.
The Gateway Service owns one table, `gateway_account(id, username, credential, token_version, created_at)`.
It reads no table of another service.
`DatabaseSync` performs synchronous input and output, so the check of each authenticated request is one lookup by primary key.
This sibling states no latency figure.

## The bootstrap seed

At each start the server reads the `gateway_account` table in one `BEGIN IMMEDIATE` transaction.
When the table is empty, the server creates exactly one human account.
It first applies the terminal check of [architecture.impl.md](viewer.html?p=architecture.impl.md), because the seed displays a secret value.
A failed check stops the start, and the seed generates no password and inserts no row.
It generates the password with `crypto.randomBytes` and stores the argon2id record.
It prints the username and password once to standard output.
The seed reads no input, so it requires no terminal on standard input.
The server prints the password at no later start.
The server exposes no registration route and no account management route, and it holds exactly one human account.
A human who loses the password deletes the account row and restarts the server, which seeds the account again.

## Request validation

One `zod` schema at 4.4.3 covers the path parameters, the query and the body of each route.
A `validate()` middleware parses each part before the handler runs and returns 400 with the issue list.
A route with a body requires the `application/json` content type.

## Delivery bytes and body limits

The `/hooks/*` handler reads `arrayBuffer()`.
It passes the exact bytes and headers to the Scheduler Service.
A re-serialized body breaks the signature of the platform.
It parses no JSON and validates no schema.
The `hono/body-limit` middleware permits 10 MiB on `/api/*`, 50 MiB on `/hooks/*` and 40 KiB on `/auth/*`.
A username holds at most 64 characters and a password at most 256 characters.
The length check runs before any hashing.

## The forwarding contract

A factory inside one Gateway Service module creates the frozen human identity value, and the module exports that factory to nobody.
The module records each value in a module-private `WeakSet` and exports `isHumanIdentity(value)` alone.
A downstream service calls `isHumanIdentity` and rejects a value that it does not recognize.
The route handler passes the identity to the service function as an explicit caller argument, so a service module imports no Hono symbol.
The JWT never leaves the Gateway Service module.

## Errors and logging

One `respondError()` function produces every failure body, in the shape `{"error":{"code","message","details"},"requestId"}`.
`app.onError`, `app.notFound`, the authentication middleware, the host check, the body limit, the validation middleware and the timeout return through it.
`app.onError` covers no middleware that returns its own response.
`hono/request-id` assigns the request identity.
`pino` binds a child logger to the request identity, the method and the route.
It logs one record at entry and one at exit with the status and the latency.
`pino` redacts an enumerated list of paths, and a test asserts each path.

## The operation registry

Each route registers its method, path, access policy, timeout, parameter locations, request content type and whether it is a mutation.
It registers response status codes and schemas, error responses and its security scheme.
The server emits an OpenAPI 3.1 document from the registry with `z.toJSONSchema()` of `zod` at 4.4.3.
A test validates the document with `@apidevtools/swagger-parser` at 12.1.0.
It asserts a real response against its declared schema.
The server emits the document once at startup and holds it in memory, because the registry is fixed at startup.
It serves the document at `GET /openapi.json`, which declares the public access policy and answers with `application/json`.
A client of the server generates its own client code from that route.

## Host and origin

A middleware rejects a request whose `Host` header sits outside the configured allowlist before authentication.
It does so because a browser page resolves a hostname to the loopback address.
`hono/cors` permits the configured origins, and it uses no credentialed mode.
The server adds no CSRF middleware, because no cookie authenticates a request.

## Cancellation

The Gateway Service builds one `AbortSignal` for each request.
It derives the signal from the client disconnect and the process shutdown controller.
It passes the signal in the caller context.
Every route takes a timeout, and the value differs by route.
The operation registry holds the timeout of a route beside its access policy, so one declaration drives both.
The default timeout is 30 s, and a route of `/auth/*` takes 10 s.
The work pull route takes 120 s, and its wait window is 90 s, so the handler answers before the timeout.
A route of the MCP prefix takes 900 s, because a call of the MCP server runs a tool of the Worker Service.
`hono/timeout` returns 504 and cancels no work, so a mutation route is idempotent or it completes.
[architecture.impl.md](viewer.html?p=architecture.impl.md) holds the stop of the server, which cancels every waiting work pull and every MCP stream through the process shutdown controller.

## Idempotency of a mutation

Every mutation route requires the `Idempotency-Key` header, which holds a ULID that the client generates.
`ulid` generates that value, and that identity is no identity that the server generates for an entity of its own.
The operation registry declares a route as a mutation, so the middleware runs on that route alone.
The Gateway Service owns the table `gateway_idempotency(key, route, fingerprint, status, response, created_at)`.
The fingerprint is the digest of the canonical JSON of one envelope, and [architecture.impl.md](viewer.html?p=architecture.impl.md) rules that form and that digest.
The envelope names the operation of the registry, the path parameters, the query and the body, each one after its validation, and it states the treatment of an absent field, of a default and of a repeated query value.
It holds exactly the validated data that determines the operation, so an input that changes the effect sits inside the envelope or the contract of that route is forbidden.
The middleware inserts the key with the state in progress before the handler runs.
A repeat of a key that holds the state in progress returns 409.
A repeat of a completed key returns the recorded status and the recorded body, and the handler runs never.
A repeat of a key with another route or another fingerprint returns 409.
The middleware records the status and the body after the handler completes.
A handler that writes the operational database records the status and the body inside the transaction of its own write, so one commit holds the change and its recorded answer.
A route that returns a secret records a redacted body, and a repeat of its key returns 409 and no secret.
A timeout leaves the key in progress, so a retry of the client receives 409 until the operation completes.
The server runs as one process, which [architecture.impl.md](viewer.html?p=architecture.impl.md) enforces with the exclusive locking mode of each database file, so a record that holds the state in progress after a restart names a dead operation.
A sweep at startup deletes such a record, and the operation of that record never committed, because a commit records its answer.

## Tests

`testClient` of `hono/testing` covers the logic of each handler.
A real ephemeral loopback listener covers the `Host` and `Origin` checks with the preflight.
It covers the body limits and a streaming body.
It covers a timeout against a mutation that completes and a client disconnect.
It covers the shutdown drain and the exact bytes of a delivery.
It covers the single-row property of the seed under two concurrent starts.
It covers the work bound of the login.
`supertest` at 7.2.2 and `@types/supertest` at 7.2.1 have no use after this.
The implementation epic assesses their removal.

## The work bound of the login

One password verification runs at a time behind a queue of depth 4.
A request beyond that queue receives 503.
A failed login returns a uniform response after a fixed minimum time.
The server holds no rule per address, because every caller reaches it at the loopback address.

## Ingress

An external platform reaches no loopback listener, so a delivery arrives through a tunnel or a reverse proxy.
The server serves one listener on one port, and the delivery ingress uses the dedicated path group `/hooks/*`.
The operator supplies the tunnel or the reverse proxy, and the server starts none.
The ingress forwards the path group `/hooks/*`, and it forwards no other path.
The server distinguishes no request of the ingress from a local request.
The path restriction therefore lives in the configuration of the ingress.
The ingress is an untrusted transport.
The signature of the platform over the exact bytes is the only proof of authenticity of a delivery.
The Gateway Service reads no `Forwarded` header, no `X-Forwarded-*` header and no client-address header for a decision.
The operator adds the public hostname of the ingress to the host allowlist.

## Entry paths

The work pull and the registration of a worker instance are registered routes.
The MCP server of the Worker Service occupies its own path prefix, and [worker-service.impl.md](viewer.html?p=worker-service.impl.md) owns it.
A platform delivery enters through a registered route whose handler passes it to the Scheduler Service.
The prefixes are `/auth/*`, `/healthz` and `/openapi.json` with the public policy, and `/api/*` with the human policy.
They are `/worker/*` and `/mcp/*` with the client policy, and `/hooks/*` with the delivery policy.

## The command group `gateway`

[architecture.impl.md](viewer.html?p=architecture.impl.md) rules the command surface and the client configuration.
This sibling declares the command table of the group `gateway`.
A row names the command, the operation that it calls, and the access policy of that route.

- `login` calls the login route of `/auth/*`, which carries the public policy.
- `logout` calls no route.

`kanthord gateway login` reads the username and the password on the terminal, and it requires a terminal on the standard input.
It calls the login route, and it writes the endpoint and the issued JWT into the client configuration file.
`kanthord gateway logout` removes the client configuration file.
It calls no route and it revokes no token, because a revocation increments the `token_version` of the account row and no route performs that increment today.

The client configuration file holds the two fields below.

- `endpoint` holds the absolute URL of the server. It defaults to `http://127.0.0.1:31415`, which the defaults of `gateway.bind` and `gateway.port` give.
- `token` holds the JWT of a human, and the client presents it as a bearer token.

The environment carries the same values and the client identity.

- `KANTHORD_ENDPOINT` carries the endpoint.
- `KANTHORD_TOKEN` carries the JWT of a human.
- `KANTHORD_CLIENT_ID` and `KANTHORD_CLIENT_SECRET` carry the client identity, and the client presents that pair as the Basic credential.

A resolved client identity takes precedence over a resolved JWT, so an instance of an external harness needs no client configuration file.
A client sends the `Host` header of its endpoint, so an endpoint outside `gateway.allowedHosts` fails the check of the host allowlist.

## Repository layout, build, test and release

The Gateway Service source sits under `src/gateway/` of the `engine` repository.
A test file sits beside its source as `*.test.ts`.
`node --test` runs the tests.
`tsc -p tsconfig.build.json` builds into `dist/`.
The `kanthord` bin of `package.json` releases it.
