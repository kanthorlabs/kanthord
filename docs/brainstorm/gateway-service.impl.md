---
title: Gateway Service Implementation
---

# Gateway Service Implementation

This file holds the implementation rulings for the mechanisms that realize [gateway-service.md](gateway-service.md).
This file is not a design document, and `gateway-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the API surface, human authentication or the forwarding contract.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.
The installed set provides `node:sqlite` `DatabaseSync`, `node:crypto` `hkdfSync`, `hono/jwt`, and `hono/testing` `testClient`.
It also provides `zod` `toJSONSchema` and the `hono` middleware `cors`, `body-limit`, `request-id`, `timeout` and `http-exception`.

## Transport

`@hono/node-server` at 2.1.1 serves one Hono application from `hono` at 4.13.3.
The server binds the loopback address and the port that `convict` at 6.2.5 resolves.
It uses no TLS.
Every service is a module of one process.
The Hono router dispatches each request to the handler of the service that owns the requested operation.
The handler is a module-level function, and each service registers its routes on the Hono application at startup.

## Configuration

[architecture.impl.md](architecture.impl.md) holds the configuration file, its field index, and the rule that the file is the only source of a value.
The Gateway Service owns the section `gateway`, and it declares the fields below.

- `gateway.bind` holds the bind address, as a string, it defaults to `127.0.0.1`, and the format accepts a loopback address only.
- `gateway.port` holds the port, in the `port` format of `convict`, and it defaults to `31415`.
- `gateway.allowedHosts` holds the host allowlist, as an array of strings, and it defaults to `127.0.0.1:31415` and `localhost:31415`.
- `gateway.allowedOrigins` holds the origin allowlist, as an array of strings, and it defaults to an empty array.
- `gateway.tokenLifetime` holds the lifetime of a token in seconds, in the `nat` format of `convict`, and it defaults to 31536000, which is one year.

## Access policy

Every registered route declares one access policy value: `human`, `client`, `public` or `delivery`.
Registration throws at startup when a route declares none.
A request that matches no route returns 404.
The policy value lives in the operation registry, so one declaration drives the authentication middleware and the emitted contract.

## Identity on the wire

One `Authorization` header carries one scheme.
`Bearer` carries the JWT of a human and the JWT of a machine, and the `kind` claim of the token states which one.
A machine presents its JWT on every request, including the registration route, and no request presents another credential.

## Human authentication

A human presents a JWT as a bearer token. The default username is `KANTHORD_AUTH_USERNAME = "kanthorlabs"`.
The Gateway Service verifies the signature using its key derived from `masterKey`, then checks the token claims and denylist.
The server creates no human account row and generates, hashes and stores no human password. It exposes no password-login route.
The local `kanthord jwt` command is the only token issuance entry point. For a human it accepts an optional username argument and defaults to the constant when it is omitted.
Server startup issues and displays no human token. The CLI exposes no human login or logout command.
A request that carries a missing or an invalid credential on a route that requires one returns 401 before the handler runs.
`GET /api/auth/verify` declares the human access policy and returns the authenticated identity as `{"kind":"human","accountId":"<username>","name":"<display name>"}` with HTTP 200.
It uses the same verification chain as every human-only operation, including signature, expiry, username and denylist checks. A machine token fails this route with HTTP 401.
The response contains neither the JWT nor the signing key and writes no record.

## Worker-instance registration

An instance at the `worker` placement or hosted by an external harness presents its machine JWT as a bearer token on `POST /api/worker/register`, and the request holds an empty body.
The operation ID is `worker.register`, and the Worker Service owns its operation declaration and scoped OpenAPI file.
This operation creates a live worker-instance registration, not a human account, client identity or worker definition. Server-hosted instances are created internally.
That route declares the client access policy, and the verification of the JWT section authenticates it.
The request nominates no binding, no subject and no kind, and the server takes all three from the verified JWT.
The Worker Service creates the registration and checks the instance count of the binding inside one transaction, so two concurrent requests oversubscribe no binding.
A client identity holds at most one live registration, and a registration of a client identity that holds one answers 409.
The route answers with the runtime identity of the new instance and no token.
A repeat of the idempotency key of that route under the same client identity replays the recorded answer while that registration is live.
After the registration ends, the repeat answers 409 with the code of a stale registration, and the caller registers with a new key.

## The JWT

`hono/jwt` signs and verifies with HS256, and the algorithm is pinned explicitly.
The claims are `sub`, `name`, `kind`, `iat`, `exp` and `jti`. A machine token also carries `binding`.
`gateway.tokenLifetime` gives the lifetime of a token, and it defaults to one year.
Verification checks the signature, then `exp`, then `kind`, which holds `human` or `client`.
`name` is a nonblank display name of 1–64 characters for both kinds. It groups nothing and authorizes nothing. Issuance defaults it to the username of a human and to the client identity of a machine.
For `human`, `sub` is a nonblank username of 1–64 characters, and `binding` is absent. Issuance and verification use the same username validation and preserve its exact value. The verified human identity carries that username as its `accountId`, and reissuance preserves it.
The signing key authenticates the username in the token. Verification requires no account row or username allowlist.
For `client`, `sub` is a client identity of the form `client_identity_<ulid>` that the issuance generates, and `binding` is the identity of a worker binding.
Verification asks the Project Service whether that worker binding exists and is available, and it resolves the project from it. It reads no list of client identities, because the signed token states the membership.
Verification then checks that `jti` sits outside the denylist.
A machine identity names the runtime identity of the live registration of its client identity when one exists. The work pull and every execution operation refuse a machine identity that names no live registration.
Each issuance generates a fresh ULID `jti`. `iat` and `exp` use JWT Unix seconds.
A restart or another issuance revokes no earlier JWT. It remains valid until expiry, a denylist ban, the removal or the unavailability of its worker binding for a machine, or replacement of `masterKey`.
An expired token returns 401. A human obtains a new token from `kanthord jwt`, and a worker instance receives a new token with a new client identity and registers again.

## The session denylist

The Gateway Service owns the table `gateway_token_denylist(jti, expires_at, banned_at)` of the operational database.
A banned session fails its verification, whatever the kind of its token.
The process holds the whole table in memory, because one process owns that database, and it writes the row and the memory inside one transaction.
An entry is kept until the `expires_at` of its token, and a sweep at each start removes every expired entry.
A ban cancels no request that already passed verification.
The route that bans a session and the authority to issue it belong to the user management that the handoff holds.

## The signing key

The signing key is `HKDF(masterKey, info = "gateway/jwt-hs256/v1")`, derived with `crypto.hkdfSync` and SHA-256 over an empty salt.
[architecture.impl.md](architecture.impl.md) holds the field `masterKey` of the configuration file and the rule that a service derives its keys from it.
The Gateway Service derives the key at startup and persists neither the signing key nor the generated human JWT in its database.
[architecture.impl.md](architecture.impl.md) rules the mode of the configuration file, of its directory, of the data directory and of every database file.
A copy of the configuration file carries the signing key, so that copy permits the forgery of a token.

## Local JWT issuance

`kanthord jwt [username] [--name <display>] [--binding <worker binding>] [--config <path>]` reads the validated server configuration and generates a JWT locally.
[architecture.impl.md](architecture.impl.md) declares this top-level command and its configuration path resolution.
It uses the signing-key derivation and token contract above, with the configured lifetime.
Without `--binding` it generates a human JWT with the selected username as `sub`.
With `--binding` it generates a machine JWT with a fresh client identity as `sub` and the named worker binding as `binding`, and it rejects a `username` argument.
It opens no database, so it does not check that the worker binding exists. A token that names an absent or unavailable worker binding fails its verification.
It prints the JWT followed by a newline only when standard output is a terminal. A failed terminal check stops issuance and displays no token.
It prompts for nothing, requires no terminal on standard input, calls no route and saves no client configuration.
A human who loses a token runs this command again. Starting or restarting the server issues no token and requires no terminal.
The Gateway Service owns no human account table and no client identity table. Its operational tables hold the session denylist and idempotency records only.

## Request validation

One `zod` schema at 4.4.3 covers the path parameters, the query and the body of each route.
A `validate()` middleware parses each part before the handler runs and returns 400 with the issue list.
A route with a body requires the `application/json` content type.

## Delivery bytes and body limits

The `/hooks/*` handler reads `arrayBuffer()`.
It passes the exact bytes and headers to the Scheduler Service.
A re-serialized body breaks the signature of the platform.
It parses no JSON and validates no schema.
The `hono/body-limit` middleware permits 40 KiB on the worker registration operation and on `/api/auth/*`, 50 MiB on a delivery operation, and 10 MiB on other operations.

## The forwarding contract

A factory inside one Gateway Service module creates the frozen human identity value, and the module exports that factory to nobody.
The module records each value in a module-private `WeakSet` and exports `isHumanIdentity(value)` alone.
A downstream service calls `isHumanIdentity` and rejects a value that it does not recognize.
A second factory of the same module creates the frozen machine identity value, under its own `WeakSet`, and the module exports `isMachineIdentity(value)` alone.
The machine identity names the client identity, its worker binding and its project, which the verification resolved, and the runtime identity of its live registration when one exists.
A direct call that supplies a machine identity passes the denylist, the worker-binding check and the live-registration check again before the handler runs, so a ban or a removal reaches the direct adapter as it reaches the HTTP adapter.
The route handler passes the identity to the service function as an explicit caller argument, so a service module imports no Hono symbol.
The JWT never leaves the Gateway Service module.

## Errors and logging

One `respondError()` function produces every failure body, in the shape `{"error":{"code","message","details"},"requestId"}`.
`app.onError`, `app.notFound`, the authentication middleware, the host check, the body limit, the validation middleware and the timeout return through it.
`app.onError` covers no middleware that returns its own response.
`hono/request-id` assigns `X-Request-Id`, accepting only `request_<ulid>` in the form that [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules and generating a fresh identity with the `request_` prefix and `ulid()` when a request supplies no accepted identity.
The route used by request logging comes from `matchedRoutes(context)` of `hono/route`.
`pino` binds a child logger to the request identity, the method and the route.
It logs one record at entry and one at exit with the status and the latency.
`pino` redacts an enumerated list of paths, and a test asserts each path.

## The operation registry

Each route registers its method, path, access policy, timeout, parameter locations, request content type and whether it is a mutation.
It registers response status codes and schemas, error responses and its security scheme.
The server emits an OpenAPI 3.1 document from the registry with `z.toJSONSchema()` of `zod` at 4.4.3.
A test validates the document with `@apidevtools/swagger-parser` at 12.1.0.
It asserts a real response against its declared schema.
`kanthord gateway openapi` emits the document from the registry, writes it as YAML to `static/openapi.yaml` of the `engine` repository, and prints that path.
`yaml` at 2.9.0 serializes the document, and [architecture.impl.md](architecture.impl.md) already names that package for the configuration file, so this command adds none.
It starts no server, and it reaches none.
A human runs that command after a change of a route, and the repository holds the emitted file.
The server emits no document at its start, so the start of [architecture.impl.md](architecture.impl.md) holds no emission step.
The server serves the `static` directory of its own package with `hono/serve-static`, so `GET /openapi.yaml` answers with that file under the public access policy and the `application/yaml` content type.
A client generates its own client code from that file, and a build of a client copies the file instead of calling a running server.

## Host and origin

A middleware rejects a request whose `Host` header sits outside the configured allowlist before authentication.
It does so because a browser page resolves a hostname to the loopback address.
`hono/cors` permits the configured origins, and it uses no credentialed mode.
The server adds no CSRF middleware, because no cookie authenticates a request.

## Cancellation

The Gateway Service builds one `CancellationContext` for each request under its shutdown context, following [architecture.impl.md](architecture.impl.md#the-service-lifecycle-and-context).
It cancels that context on a client disconnect or process shutdown and releases it when the response ends.
It passes the `Context` interface in the caller context and through direct clients, authentication and component collaborators. Native request signals remain at the HTTP boundary.
Every route takes a timeout, and the value differs by route.
The operation registry holds the timeout of a route beside its access policy, so one declaration drives both.
The default timeout is 30 s. Human verification and worker registration each take 10 s.
The work pull route takes 120 s, and its wait window is 90 s, so the handler answers before the timeout.
A route of the MCP prefix takes 900 s, because a call of the MCP server runs a tool of the Worker Service.
`hono/timeout` returns 504 and cancels no work, so a mutation route is idempotent or it completes.
[architecture.impl.md](architecture.impl.md) holds graceful shutdown. The gateway stops admission, cancels its child contexts, joins handlers and streams, and releases its listener before the server closes the operational database.

## Component healthchecks

`GET /api/healthcheck` reports the owned component maps of every service registered in the shared `HealthRegistry`, not only Gateway internals.
The Server owns that registry and passes it to the Gateway. It registers `server`, whose component map contains `gateway`, `store` and `log`; `store` checks the SQLite database with `SELECT 1`, and `log` checks the operational log descriptor.
The Gateway registers `gateway`, whose map contains `listener`, `authentication`, `idempotency`, `registry` and `invocation` through the shared `Service.healthcheck()` contract. The server's `gateway` component summarizes that map.
A standalone Gateway registers only itself unless its owner supplies other probes.
Every additional service registers its own health probe beside its other startup wiring. Operation registration alone registers no health probe. A probe returns the current components of its owner, so an LLM provider or a worker instance belongs in that owner's map and needs no new API handler or schema.
The current engine implements no provider or worker service health probe; the endpoint reports no fictitious healthy entry for an absent service.

The success body is `{"status":"ok","services":{"<service>":{"<component>":200}}}`. `services` is an extensible dictionary, not a Gateway-only object, and the emitted OpenAPI contract describes it as such.
An integer code of `200` means healthy and `503` means unavailable. Success requires at least one registered service and a nonempty, entirely healthy map for each service.
An unavailable component produces HTTP 503 with code `UNHEALTHY` through the shared error envelope. `error.details` holds the complete service-to-component map, including healthy siblings, in the same nesting as `services` on success. This replaces the former Gateway-only failure details map.
A throwing, rejected, empty, malformed or timed-out probe contributes `{"healthcheck":503}` under its registered name instead of disappearing or preventing other probes from reporting. This marker reports probe failure, not a guessed state of its individual components. The public response includes no exception text or credentials.

Each request snapshots registrations and starts the probes concurrently. Later registrations appear on the next request; component maps are read anew on every request.
Registration accepts unique names matching `[a-z][a-z0-9-]*` and at most 128 service probes. Invalid names, non-function probes, duplicate names and capacity overflow fail explicitly. Component names are nonempty public identifiers, never credentials or private endpoint URLs.
Each probe receives a child `Context` with a deadline of five seconds, or the earlier caller deadline. That bound sits below the route's thirty-second timeout. The registry releases its timer and subscription on completion, failure or cancellation; service owners retain their resources and must honor cancellation for work they start.
Caller cancellation cancels the collection rather than reporting success. The readiness middleware still returns `503 NOT_READY` before invoking a handler when the Gateway is not ready.
The health registry owns no service lifetime and starts or stops no service.

## Idempotency of a mutation

Every mutation route requires the `Idempotency-Key` header, which holds a ULID that the client generates.
`ulid` generates that value, and that identity is no identity that the server generates for an entity of its own.
The operation registry declares a route as a mutation, so the middleware runs on that route alone.
The direct entry adapter of [architecture.impl.md](architecture.impl.md) enters this chain too, so a caller inside the server reserves the same key, meets the same 409 and replays the same recorded answer.
The Gateway Service owns the table `gateway_idempotency(key, route, fingerprint, caller, status, response, created_at)`.
The `caller` column holds the account of a human and the client identity of a machine.
The middleware compares the verified caller with that column before it replays, and a repeat under another caller reserves its own record and runs the handler.
The registration route replays a recorded answer only while its registration is live, which the worker-instance registration section states.
The fingerprint is the digest of the canonical JSON of one envelope, and [architecture.impl.md](architecture.impl.md) rules that form and that digest.
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
The server runs as one process, which [architecture.impl.md](architecture.impl.md) enforces with the exclusive locking mode of each database file, so a record that holds the state in progress after a restart names a dead operation.
A sweep at startup deletes such a record, and the operation of that record never committed, because a commit records its answer.

## Tests

`testClient` of `hono/testing` covers the logic of each handler.
A real ephemeral loopback listener covers the `Host` and `Origin` checks with the preflight.
It covers the body limits and a streaming body.
It covers a timeout against a mutation that completes and a client disconnect.
It covers the shutdown drain and the exact bytes of a delivery.
It checks the real server health response for both `server` and `gateway`, including SQLite and log health, and checks additional provider/worker probe maps through HTTP and direct clients.
It covers unhealthy components, a closed SQLite database, failed log health, throwing/rejected probes, empty or malformed maps, deadlines, cancellation, fresh component state, registration snapshots, duplicates and registry capacity. An unavailable probe retains every healthy sibling in the complete 503 details map.
It covers concurrent starts and restarts without token issuance or display, including redirected standard output.
It verifies that a locally generated human JWT remains valid after a restart.
It verifies the default and explicitly supplied subjects and derived-key signature, rejects an invalid subject and another master key, and asserts that no password or account row is stored.
It covers the removed password-login route and its absence from OpenAPI.
It covers a registration with a machine JWT whose worker binding is absent or unavailable, and it asserts 401 and no registration.
It covers two concurrent registrations against a binding of one instance, and it asserts one registration and one refusal.
It covers a second registration of a client identity that holds a live registration, and it asserts 409.
It covers a repeat of the registration key while the registration is live, and it asserts the recorded runtime identity and no second slot.
It covers a repeat of the registration key after a restart, and it asserts the stale-registration 409.
It covers a direct call with a machine identity after a ban of its `jti`, and it asserts the refusal.
It covers a repeat of a completed key under another caller, and it asserts that the handler runs and that no recorded answer is returned.
It covers an expired token and a banned `jti`, and it asserts 401 for each one.
It covers a work pull of a machine identity whose registration ended, and it asserts the refusal.
It covers the sweep of the denylist at a start, and it asserts that an entry beyond its `expires_at` is gone.
It emits the document from the registry and compares it with the committed file, and a difference fails the test.
`supertest` at 7.2.2 and `@types/supertest` at 7.2.1 have no use after this.
The implementation epic assesses their removal.

## Ingress

An external platform reaches no loopback listener, so a delivery arrives through a tunnel or a reverse proxy.
The server serves one listener on one port, and the delivery ingress uses the dedicated path group `/hooks/*`.
The operator supplies the tunnel or the reverse proxy, and the server starts none.
The ingress forwards the path group `/hooks/*` for a delivery, `POST /api/worker/register` for worker-instance registration, and the registered work-pull and MCP paths for an instance that runs outside the host of the server.
It forwards no other path.
A delivery needs no confidentiality of the ingress, because the signature of the platform over the exact bytes proves it.
An instance presents its long-lived JWT on every request, so the ingress provides confidentiality for registration, work-pull and MCP traffic.
The server distinguishes no request of the ingress from a local request.
The path restriction therefore lives in the configuration of the ingress.
The ingress is an untrusted transport.
The signature of the platform over the exact bytes is the only proof of authenticity of a delivery.
The Gateway Service reads no `Forwarded` header, no `X-Forwarded-*` header and no client-address header for a decision.
The operator adds the public hostname of the ingress to the host allowlist.

## Entry paths

The work pull and the registration of a worker instance are registered routes.
The MCP server of the Worker Service occupies its own path prefix, and [worker-service.impl.md](worker-service.impl.md) owns it.
A platform delivery enters through a registered route whose handler passes it to the Scheduler Service.
Each operation declares its own access policy; a path prefix grants no policy.
`GET /api/healthcheck` and the OpenAPI routes declare the public policy.
`GET /api/auth/verify` declares the human policy. `POST /api/worker/register` and the other worker operations declare the client policy, and delivery operations declare the delivery policy.

## The command group `gateway`

[architecture.impl.md](architecture.impl.md) rules the command surface and the client configuration.
This sibling declares the command table of the group `gateway`.
A row names the command, then the operation that it calls with the access policy of that route, or the statement that the command runs locally.

- `verify [--token <jwt>]` calls `GET /api/auth/verify` with the human access policy. It prints the verified identity as JSON and exits with zero on success; an authentication or transport failure exits with a non-zero status and prints a diagnostic without the token.
- `openapi` runs locally and calls no route.

`kanthord gateway verify` resolves the endpoint and token through the client configuration precedence. Its `--token` option overrides the environment and operator-supplied client file; `--endpoint` selects the target server. An invocation without a resolved token receives HTTP 401.
`kanthord gateway openapi` writes the OpenAPI files for every declared service operation, including `worker.register`, which the operation registry section rules.
The top-level issuance command is declared under local JWT issuance. [worker-service.impl.md](worker-service.impl.md#the-command-group-worker) declares `kanthord worker register`.
The CLI provides no login, logout or automatic credential-saving flow. An operator may supply a private client configuration file manually. Saving a token establishes no authenticated identity; the Gateway Service authenticates it on a later API request.
The JWT and denylist sections govern revocation.

The client configuration file holds the two fields below.

- `endpoint` holds the absolute URL of the server. It defaults to `http://127.0.0.1:31415`, which the defaults of `gateway.bind` and `gateway.port` give.
- `token` holds the JWT of a human or of a machine, and the client presents it as a bearer token.

The environment carries the same values.

- `KANTHORD_ENDPOINT` carries the endpoint.
- `KANTHORD_TOKEN` carries the JWT of a human or of a machine.

Worker registration presents the machine JWT that this order resolves, and it saves nothing in the client configuration file.
Human verification accepts a human JWT alone, and a machine JWT fails it with HTTP 401.
A client sends the `Host` header of its endpoint, so an endpoint outside `gateway.allowedHosts` fails the check of the host allowlist.

## Repository layout, build, test and release

The Gateway Service source sits under `src/gateway/` of the `engine` repository.
`static/openapi.yaml` of that repository holds the emitted OpenAPI document, and the released package ships the `static` directory.
A test file sits beside its source as `*.test.ts`.
`node --test` runs the tests.
`tsc -p tsconfig.build.json` builds into `dist/`.
The `kanthord` bin of `package.json` releases it.

`pnpm run test:e2e:jwt` builds the engine and runs `scripts/e2e-jwt.py` with Python 3 and its standard-library PTY support.
The acceptance runner uses the compiled launcher, a fresh loopback server and disposable configuration and data. It exercises CLI token generation, API verification, CLI verification, rejected tokens and graceful cleanup.
It writes sanitized process, command and HTTP evidence to a new `.dev/e2e/<YYMMdd>-jwt-verification/` directory of the root repository, with a numeric suffix when necessary. It records no raw token or master key.
