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
- `gateway.tokenGeneration` holds the generation of the signing key, as a positive integer in the `nat` format of `convict`, and it defaults to `1`.
- `gateway.idempotencyTtl` holds the record duration in seconds, as a positive safe integer, and it defaults to `86400`.

## Access policy

Every registered operation declares one access policy value: `human`, `client`, `public`, `delivery` or `service`.
Registration throws at startup when an operation declares none.
A request that matches no route returns 404.
A `service` operation has no route, so a request for it returns 404.
The policy value lives in the operation registry, so one declaration drives the authentication middleware and the emitted contract.

## Identity on the wire

One `Authorization` header carries one scheme.
`Bearer` carries the JWT of a human and the JWT of a machine, and the `kind` claim of the token states which one.
A machine presents its JWT on every request, including the registration route, and no request presents another credential.

## Human authentication

A human presents a JWT as a bearer token. The default username is `KANTHORD_AUTH_USERNAME = "kanthorlabs"`.
The Gateway Service verifies the signature using its key derived from `masterKey`, then checks the token claims.
The server creates no human account row and generates, hashes and stores no human password. It exposes no password-login route.
The local `kanthord jwt` command is the only token issuance entry point. For a human it accepts an optional username argument and defaults to the constant when it is omitted.
Server startup issues and displays no human token. The CLI exposes no human login or logout command.
A request that carries a missing or an invalid credential on a route that requires one returns 401 before the handler runs.
`GET /api/auth/verify` declares the human access policy and returns the verified JWT's business properties as `{"kind":"human","sub":"<username>","name":"<display name>"}` with HTTP 200. Property names and values are preserved from the JWT; the response adds no aliases.
It uses the same verification chain as every human-only operation, including signature, expiry and username checks. A machine token fails this route with HTTP 401.
The response contains no raw JWT, signing key or token metadata (`iat`, `exp`, `jti`) and writes no record.

## Worker-instance registration

An instance at the `worker` placement or hosted by an external harness presents its machine JWT as a bearer token on `POST /api/worker/register`, and the request holds an empty body.
The operation ID is `worker.register`, and the Worker Service owns its operation declaration and scoped OpenAPI file.
This operation creates a live worker-instance registration, not a human account, client identity or worker definition. Server-hosted instances are created internally.
That route declares the client access policy, and the verification of the JWT section authenticates it.
The request nominates no binding, no subject and no kind, and the server takes all three from the verified JWT.
The Worker Service creates the registration and checks the instance count of the binding inside one transaction, so two concurrent requests oversubscribe no binding.
A client identity holds at most one live registration, and a registration of a client identity that holds one answers 409.
The route answers with the runtime identity of the new instance and no token.

- A repeat of the idempotency key under the same client identity replays the recorded answer within one process and the TTL.
- The registration must remain live for that replay.
- Within the TTL, a repeat after the registration ends answers 409 with the stale-registration code.
- The caller registers with a new key.

## The JWT

`hono/jwt` signs and verifies with HS256, and verification pins the algorithm explicitly.

- The header is exactly `alg` `HS256` and `typ` `JWT`.
- Any other `alg`, any other `typ` and any `crit` header reject the token.
- `gateway.tokenLifetime` gives the lifetime of a token, and it defaults to one year.
- Each issuance generates a fresh ULID `jti`.
- A restart or another issuance revokes no earlier JWT.
- It remains valid until expiry, an increment of `gateway.tokenGeneration` or replacement of `masterKey`.
- For a machine, removal or unavailability of its worker binding also ends that validity.
- An expired token returns 401.
- A human obtains a fresh token from `kanthord jwt`.
- A worker instance receives a fresh token with a fresh client identity and registers again.

The claim set is closed, and the matrix below holds for both kinds.

- Both kinds require `sub`, a string of 1 to 64 nonblank characters.
- For `human`, `sub` is the username; for `client`, it is a client identity `client_identity_<ulid>` that issuance generates.
- For `human`, issuance and verification use the same username validation and preserve its exact value.
- Reissuance preserves that subject.
- The process-local caller identity stores it as `accountId`; this internal field is not a JWT claim or verification-response property.
- The response retains `sub`.
- The signing key authenticates the username in the token.
- Verification requires no account row or username allowlist.
- Both kinds require `name`, a string of 1 to 64 nonblank characters.
- It is a display name that groups nothing and authorizes nothing.
- Issuance defaults it to the username of a human and to the client identity of a machine.
- Both kinds require `kind`, with the value `human` or `client`.
- Both kinds require `iat` and `exp`, integers of JWT Unix seconds inside the safe NumericDate range.
- `iat` is not after the verification time, and `exp` is after it, with no clock-skew tolerance.
- Both kinds require `jti`, a canonical ULID.
- `client` requires `binding`, a `binding_<ulid>` identity of a worker binding; `human` forbids it.
- Both kinds forbid `iss`, `aud` and `nbf`.
- A claim outside this set, a claim of another type, a missing required claim and a present forbidden claim each reject the token with 401.
- Each cause has one error code under `gateway.jwt.<cause>`.
- The codes include `gateway.jwt.unknown_claim`, `gateway.jwt.missing_claim`, `gateway.jwt.forbidden_claim`, `gateway.jwt.invalid_type`, `gateway.jwt.expired` and `gateway.jwt.not_yet_issued`.
- Verification accepts the absence of a claim that a later version adds as optional, so an earlier token stays valid.

Verification runs in this order.

- Signature.
- Header.
- The closed claim set.
- `exp` and `iat`.
- `kind`.
- The per-kind rules.
- For `client`, the Project Service answers whether the worker binding exists and is available and resolves the project from it.
- Verification reads no list of client identities because the signed token states the membership.
- A machine identity names the runtime identity of the live registration of its client identity when one exists.
- The work pull and every execution operation refuse a machine identity that names no live registration.

`iss` and `aud` are absent because the signing key derives from the `masterKey` of one server under one label.
The key therefore binds a token to that server.
A `masterKey` that two servers share is an unsupported configuration, which [architecture.impl.md](architecture.impl.md#one-source-for-a-secret) states.

## The signing key

The signing key is `HKDF(masterKey, info = "gateway/jwt-hs256/v<tokenGeneration>")`, where `<tokenGeneration>` is the decimal value of `gateway.tokenGeneration`, derived with `crypto.hkdfSync` and SHA-256 over an empty salt.
[architecture.impl.md](architecture.impl.md) holds the field `masterKey` of the configuration file and the rule that a service derives its keys from it.
The Gateway Service derives the key at startup and persists neither the signing key nor the generated human JWT in its database.
[architecture.impl.md](architecture.impl.md) rules the mode of the configuration file, of its directory, of the data directory and of every database file.
A copy of the configuration file carries the signing key, so that copy permits the forgery of a token.
An increment of `gateway.tokenGeneration` and a restart of the server invalidate every issued JWT of both kinds. Every other key that derives from `masterKey` stays unchanged, so the credential store records and the webhook secrets stay readable.
A human then runs `kanthord jwt` again for each human token and each machine token.

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

- The Gateway Service owns no human account table and no client identity table.
- It owns no table of the operational database.
- The invocation chain holds idempotency records in memory.

## Request validation

One `zod` schema at 4.4.3 covers the path parameters, the query and the body of each route.
A `validate()` middleware parses each part before the handler runs and returns 400 with the issue list.
A route with a body requires the `application/json` content type.

## Delivery bytes and body limits

The `/hooks/*` handler reads `arrayBuffer()`.
It passes the exact bytes and headers to the Intake Service.
A re-serialized body breaks the signature of the platform.
It parses no JSON and validates no schema.
The `hono/body-limit` middleware permits 40 KiB on the worker registration operation and on `/api/auth/*`, 50 MiB on a delivery operation, and 10 MiB on other operations.

## The forwarding contract

- The factories in `src/kernel/caller-mint.ts` create frozen human and machine identity values.
- Only the Gateway imports that file.
- `src/kernel/service-mint.ts` creates a frozen service identity value, and only the composition root of the `server` application imports it.
- `src/kernel/caller.ts` holds the identity types and the predicates `isHumanIdentity`, `isMachineIdentity` and `isServiceIdentity`.
- It records each identity value in the corresponding module-private `WeakSet`.
- A downstream service calls `isHumanIdentity` and rejects a value that it does not recognize.

The machine identity names the client identity, its worker binding and its project, which the verification resolved, and the runtime identity of its live registration when one exists.
A direct call that supplies a machine identity passes the worker-binding check and the live-registration check again before the handler runs, so a removal reaches the direct adapter as it reaches the HTTP adapter.
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

- The registry class lives in `src/kernel/operation.ts` and performs structural validation.
- The owning service declares its operations in its `contract.ts`.
- The Gateway emitter validates the OpenAPI scope of every entry when it projects the registry.

Each route registers its method, path, access policy, timeout, parameter locations, request content type and whether it is a mutation.
It registers response status codes and schemas, error responses and its security scheme.
The server emits an OpenAPI 3.1 document from the registry with `z.toJSONSchema()` of `zod` at 4.4.3.
A test validates the document with `@apidevtools/swagger-parser` at 12.1.0.
It asserts a real response against its declared schema.

- `kanthord gateway openapi` emits one scoped OpenAPI 3.1 document from the `contract.ts` of each service into `static/openapi/<service>/` of the `engine` repository.
- It emits the entry document `static/openapi/index.yaml`, an OpenAPI 3.1 document that references every scoped document and declares no operation of its own.
- The entry document carries the `version` of `package.json` in its `info.version`.
- It prints the path of the directory.

`yaml` at 2.9.0 serializes the document, and [architecture.impl.md](architecture.impl.md) already names that package for the configuration file, so this command adds none.
It starts no server, and it reaches none.
A human runs that command after a change of a route, and the repository holds the emitted directory.
The server emits no document at its start, so the start of [architecture.impl.md](architecture.impl.md) holds no emission step.
The server serves `static/openapi/` of its own package with `hono/serve-static` under the path `/api/openapi/`.
It uses the public access policy and the `application/yaml` content type.
The entry document answers at `GET /api/openapi/index.yaml`, and every relative reference resolves the same on disk and over HTTP.
A client generates its own client code from that directory.
A build of a client copies the directory instead of calling a running server.

## Host and origin

A middleware rejects a request whose `Host` header sits outside the configured allowlist before authentication.
It does so because a browser page resolves a hostname to the loopback address.
`hono/cors` permits the configured origins, and it uses no credentialed mode.
The server adds no CSRF middleware, because no cookie authenticates a request.

## Cancellation

[architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) defines the lifetime of an operation.

- `unary` carries one request and one answer.
- `wait` ends on cancellation without ending an accepted obligation.
- `stream` carries one-way server-sent events in one open HTTP response, with every client message in a separate request.
- The Gateway owns the connection.
- The owning service owns the session under a stream.
- A close of the connection is no domain cancellation.

The Gateway Service builds one `CancellationContext` for each request under its shutdown context, following [architecture.impl.md](architecture.impl.md#the-service-lifecycle-and-context).
It cancels that context on a client disconnect or process shutdown and releases it when the response ends.
It passes the `Context` interface in the caller context and through direct clients, authentication and component collaborators. Native request signals remain at the HTTP boundary.
Every route takes a timeout, and the value differs by route.
The operation registry holds the timeout of a route beside its access policy, so one declaration drives both.
The default timeout is 30 s. Human verification and worker registration each take 10 s.
`GET /api/healthcheck` takes 120 s.
The work pull route takes 120 s, and its wait window is 90 s, so the handler answers before the timeout.
A route of the MCP prefix takes 900 s, because a call of the MCP server runs a tool of the Worker Service.
`hono/timeout` returns 504 and cancels no work, so a mutation route is idempotent or it completes.
[architecture.impl.md](architecture.impl.md#the-start-and-the-stop) holds the four shutdown phases.

- The Gateway closes the listener and cancels waiting work pulls and MCP streams during quiescence.
- Its handlers and dependencies stay available during the drain.
- The invocation chain then joins handlers and streams before rejecting every new call.
- The Gateway releases resources in the release phase.

## Component healthchecks

`GET /api/liveness` carries the [liveness answer](gateway-service.md#health-report-and-liveness-answer).
The [entry paths](gateway-service.impl.md#entry-paths) declare its access policy.
The server owns the shared `HealthRegistry` and passes it to the Gateway Service.
The registry holds only the `server` and `gateway` maps.

- The `server` map contains `gateway`, `store` and `log`.
- The `store` probe checks the SQLite database with `SELECT 1`.
- The `log` probe checks the operational log descriptor.
- The Gateway Service supplies `gateway` through `Service.healthcheck()`.
- Its map contains `listener`, `authentication`, `idempotency`, `registry` and `invocation`.
- The `gateway` component of `server` summarizes that map.
- The `idempotency` probe checks the in-memory component of the invocation chain, not a database table.

The success body is `{"status":"ok","services":{"server":{"gateway":200,"store":200,"log":200},"gateway":{"listener":200,"authentication":200,"idempotency":200,"registry":200,"invocation":200}}}`.
A component code of `200` means healthy, and `503` means unavailable.
HTTP 200 requires a nonempty, entirely healthy map from each owner.
An unavailable component produces HTTP 503 with code `UNHEALTHY` through the shared error envelope.
`error.details` holds both complete maps, including healthy components, with the same structure as `services` on success.
A probe that throws, rejects, returns an empty or malformed map, or exceeds its deadline contributes `{"healthcheck":503}` under its name.
This marker reports probe failure, not a state of its individual components.
The public response includes no exception text or credentials.

Each request snapshots the registry and starts the probes concurrently.
Each probe reads the current component state.
The registry rejects an unknown name, a duplicate name and a probe that is not a function.
Each probe receives a child `Context` with a deadline of 5 s, or the earlier caller deadline.
The registry releases its timer and cancellation subscription on completion, failure or cancellation.
Each owner cancels the work that its probe starts when the caller cancels.
Caller cancellation cancels the collection and produces no success answer.
The readiness middleware returns `503 NOT_READY` before the handler when the Gateway Service is not ready.
The health registry owns no service lifetime and starts or stops no service.

## The resource healthcheck report

`GET /api/healthcheck` carries the [health report](gateway-service.md#health-report-and-liveness-answer).
The [entry paths](gateway-service.impl.md#entry-paths) declare its access policy.
HTTP 200 implements success, and HTTP 503 implements unavailable under that rule.

- The 200 body holds only `services`.
- `services` holds exactly `project`, `intake` and `worker`, one for each owner in the [inventory](architecture.md#resource-healthcheck).
- Each service holds `global` and `projects`, including empty maps.
- `global` maps a resource name to an entry.
- `projects` maps a project name to a resource map.
- Each resource map maps a resource name to an entry.
- Each entry holds exactly `status` and `capability`.
- `status` takes a [resource status](architecture.vocabulary.md#resource-status): `healthy`, `unhealthy` or `unknown`.
- `capability` is a nonempty string that names the capability of the check, not a claim about other capabilities.
- A global resource name is its credential name.
- A project-scoped resource name of the Project Service is its binding name.
- An Intake Service resource name is `<source binding name>/<subscription kind>`.
- A Worker Service resource name is `<worker binding name>/<runtime identity>`.
- Each name segment uses percent encoding, including any literal `/` or `%`, so distinct names remain distinct.
- No entry name, capability or error detail holds secret material or a private endpoint URL with credentials.

The body therefore places entries at `services.<service>.global.<resource>` or `services.<service>.projects.<project>.<resource>`.
HTTP 503 uses the shared error envelope with code `UNHEALTHY`.
Its `error.details` holds `{"missingInventories":["<service>"]}`, with each owner that cannot supply its inventory.

- The Gateway Service collects the inventories before it starts the checks.
- It deduplicates checks by target under the [resource healthcheck rule](architecture.md#resource-healthcheck), not by entry name.
- The request runs at most 32 checks concurrently across all owners.
- Each check receives a child `Context` with a deadline of 10 s from its start.
- A check that exceeds its deadline reports `unknown`.
- The [route timeout](gateway-service.impl.md#cancellation) bounds the whole request.
- Before that timeout, the report includes `unknown` for every entry whose check has no result, including a check without a start.
- The Gateway Service cancels the checks that have no result before it answers.
- Caller cancellation cancels all checks and produces no success answer.
- Each check releases its timer and cancellation subscription on completion, failure or cancellation.

The [Project Service](project-service.impl.md#the-resource-healthcheck), [custody](custody.impl.md#the-resource-healthcheck) and [Worker Service](worker-service.impl.md#agent-provider-healthcheck) own their check methods.
[Registration heartbeat](worker-service.impl.md#registration-heartbeat) defines the registered-instance check.
[HANDOFF.md](HANDOFF.md#architecture) holds the open check method of a subscription.

## Idempotency of a mutation

- Every mutation route requires the `Idempotency-Key` header, which holds a ULID that the client generates.
- `ulid` generates that value.
- The key is no identity that the server generates for an entity of its own.
- The operation registry declares a route as a mutation.
- The idempotency component runs on mutation routes alone.
- Both entry adapters enter the same invocation chain, as [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) describes.
- Both adapters reserve the same key, meet the same 409 and replay the same recorded answer.
- The idempotency component runs in memory inside the invocation chain.
- Each record carries a TTL from `gateway.idempotencyTtl`.
- An expired record disappears.
- The component owns no table, no migration and no sweep at the start.
- A replay holds inside one process and inside the TTL.
- A restart empties the component.
- A retry after a restart runs the handler again.
- Every mutation handler is idempotent by a natural key of its own, for example a registration by its client identity.
- The `caller` field holds the account of a human or the client identity of a machine.
- The component compares the verified caller with that field before it replays.
- A repeat under another caller reserves its own record and runs the handler.
- The registration route replays a recorded answer only while its registration is live.
- [gateway-service.impl.md](gateway-service.impl.md#worker-instance-registration) holds that restriction.
- The fingerprint is the digest of the canonical JSON of one envelope.
- [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest) defines that form and digest.
- The envelope names the registry operation, path parameters, query and body after validation.
- It states the treatment of an absent field, a default and a repeated query value.
- It holds exactly the validated data that determines the operation.
- Every input that changes the effect sits inside the envelope.
- The component inserts the key with the state in progress before the handler runs.
- A repeat of a key that holds the state in progress returns 409.
- A repeat of a completed key returns the recorded status and body without running the handler.
- A repeat of a key with another route or another fingerprint returns 409.
- `caller.commit` opens its transaction on the store that the operation declares.
- The component completes the record in memory after the commit and handler completion.
- It records the status and body.
- A route that returns a secret records a redacted body.
- A repeat of that key returns 409 and no secret within the TTL.
- A timeout leaves the key in progress.
- A retry receives 409 until the operation completes or the record expires.

## Tests

`testClient` of `hono/testing` covers the logic of each handler.
A real ephemeral loopback listener covers the `Host` and `Origin` checks with the preflight.
It covers the body limits and a streaming body.
It covers a timeout against a mutation that completes and a client disconnect.
It covers the shutdown drain and the exact bytes of a delivery.
It checks the liveness response for both `server` and `gateway`, including SQLite and log health, through HTTP and direct clients.
It covers unhealthy components, a closed SQLite database, failed log health, and probes that throw or reject.
It covers empty or malformed maps, deadlines, cancellation, current component state, registry snapshots, duplicate names and unknown names.
An unavailable probe retains every healthy component in the complete 503 details map.
It asserts the failed-probe marker and the public access policy of the liveness route.
It asserts that an external resource changes no liveness answer.

- A test covers the resource report across every owner and health scope, including empty maps and every resource status.
- It asserts every entry, its capability, its name encoding and the absence of pagination.
- A test shares each target across entries and projects and asserts one check and the same result in every entry.
- A test exceeds a check deadline and asserts `unknown` without loss of the entry.
- A test exhausts the route time with queued checks and asserts a complete report before the timeout.
- A test asserts the concurrency bound across owners and cancellation of all checks on a client disconnect.
- A test asserts that an anonymous caller and a machine identity each receive 401 on the human-only health report.
- A test covers a missing owner inventory and asserts 503 and the missing owner name.
- A test supplies every inventory with unhealthy and unknown entries and asserts 200.
- A test asserts no secret material or private endpoint URL with credentials in any response.
- A test asserts that checks store no result and change no disablement, instance healthcheck, worker binding or execution.

It covers concurrent starts and restarts without token issuance or display, including redirected standard output.
It verifies that a locally generated human JWT remains valid after a restart.
It verifies the default and explicitly supplied subjects and derived-key signature, rejects an invalid subject and another master key, and asserts that no password or account row is stored.
It covers the removed password-login route and its absence from OpenAPI.
It covers a registration with a machine JWT whose worker binding is absent or unavailable, and it asserts 401 and no registration.
It covers two concurrent registrations against a binding of one instance, and it asserts one registration and one refusal.
It covers a second registration of a client identity that holds a live registration, and it asserts 409.

- A test repeats the registration key within the TTL while the registration is live and asserts the recorded runtime identity without another slot.
- A test repeats the registration key after a restart and asserts that the handler runs again with its natural key.
- A test repeats a key after its TTL expires and asserts that the handler runs again.

It covers a repeat of a completed key under another caller, and it asserts that the handler runs and that no recorded answer is returned.
It covers an expired token and a token signed under an earlier `gateway.tokenGeneration`, and it asserts 401 for each one.
It covers an increment of `gateway.tokenGeneration`, and it asserts that a credential store record stays readable.
It covers a work pull of a machine identity whose registration ended, and it asserts the refusal.
It emits the directory from the registry and compares it with the committed directory, and a difference fails the test.
`supertest` at 7.2.2 and `@types/supertest` at 7.2.1 have no use after this.
The implementation epic assesses their removal.

## Ingress

An external platform reaches no loopback listener, so a delivery arrives through a tunnel or a reverse proxy.
The server serves the RESTful API on one listener on one port, and the delivery ingress uses the dedicated path group `/hooks/*`.
A loopback callback listener that pi-ai opens for an OAuth login session belongs to no Gateway listener. [custody.impl.md](custody.impl.md#the-oauth-login) rules that listener, and the ingress forwards nothing to it.
The operator supplies the tunnel or the reverse proxy, and the server starts none.
The ingress forwards the path group `/hooks/*` for a delivery.
It forwards `POST /api/worker/register`, `POST /api/worker/heartbeat`, `POST /api/worker/handover` and `POST /api/worker/credential` for a worker instance.
It forwards the registered work-pull, claim inspection, lease renewal, release and MCP paths for an instance that runs outside the host of the server.
It forwards no other path.
A delivery needs no confidentiality of the ingress, because the signature of the platform over the exact bytes proves it.
An instance presents its long-lived JWT on every request, so the ingress provides confidentiality for registration, heartbeat, work-pull and MCP traffic.
A credential handover uses encryption under `masterKey`.
It needs no confidentiality of the ingress beyond that of the JWT that carries it.
The server distinguishes no request of the ingress from a local request.
The path restriction therefore lives in the configuration of the ingress.
The ingress is an untrusted transport.
The signature of the platform over the exact bytes is the only proof of authenticity of a delivery.
The Gateway Service reads no `Forwarded` header, no `X-Forwarded-*` header and no client-address header for a decision.
The operator adds the public hostname of the ingress to the host allowlist.

## Entry paths

The work pull and the registration of a worker instance are registered routes.
The MCP server of the Worker Service occupies its own path prefix, and [worker-service.impl.md](worker-service.impl.md) owns it.
A webhook delivery enters through a registered route whose handler passes it to the [Intake Service](intake-service.md#deliveries).
Each operation declares its own access policy; a path prefix grants no policy.
`GET /api/liveness` and the OpenAPI routes declare the `public` policy.
`GET /api/healthcheck` declares the `human` policy.
`GET /api/auth/verify` declares the human policy. `POST /api/worker/register` and the other worker operations declare the client policy, and delivery operations declare the delivery policy.

## The client configuration file

[architecture.impl.md](architecture.impl.md) rules the command surface and the client configuration. The engine CLI specification [gateway page](https://github.com/kanthorlabs/kanthord-engine/blob/main/docs/cli/gateway.md) declares the command table of the group `gateway`.
The CLI provides no login, logout or automatic credential-saving flow. An operator may supply a private client configuration file manually. Saving a token establishes no authenticated identity; the Gateway Service authenticates it on a later API request.
The JWT and signing key sections govern revocation.

The client configuration file holds the three fields below.

- `endpoint` holds the absolute URL of the server. It defaults to `http://127.0.0.1:31415`, which the defaults of `gateway.bind` and `gateway.port` give.
- `token` holds the JWT of a human or of a machine, and the client presents it as a bearer token.
- `masterKey` holds the 32-byte key of the server encoded in base64, and only `kanthord serve worker` reads it. It has no environment variable and no option. A CLI command of a service group ignores it.

The environment carries the endpoint and token values.

- `KANTHORD_ENDPOINT` carries the endpoint.
- `KANTHORD_TOKEN` carries the JWT of a human or of a machine.

Worker registration presents the machine JWT that this order resolves, and it saves nothing in the client configuration file.
Human verification accepts a human JWT alone, and a machine JWT fails it with HTTP 401.
A client sends the `Host` header of its endpoint, so an endpoint outside `gateway.allowedHosts` fails the check of the host allowlist.

## Repository layout, build, test and release

The Gateway Service source sits under `src/gateway/` of the `engine` repository.

- The three public files are `contract.ts`, `client.ts` and `index.ts`.
- Private files include `service.ts`, `authentication.ts`, `invocation.ts`, `idempotency.ts` and `openapi.ts`.
- The remaining private files are `migrations.ts`, `errors.ts`, `request-id.ts`, `json.ts` and `constants.ts`.
- `migrations.ts` holds no table.
- `src/gateway/` is the one importer of `src/kernel/caller-mint.ts`.

`static/openapi/` of that repository holds the emitted OpenAPI directory, and the released package ships the `static` directory.
A test file sits beside its source as `*.test.ts`.
`node --test` runs the tests.
`tsc -p tsconfig.build.json` builds into `dist/`.
The `kanthord` bin of `package.json` releases it.

`pnpm run test:e2e:jwt` builds the engine and runs `scripts/e2e-jwt.py` with Python 3 and its standard-library PTY support.
The acceptance runner uses the compiled launcher, a fresh loopback server and disposable configuration and data. It exercises CLI token generation, API verification, CLI verification, rejected tokens and graceful cleanup.
It writes sanitized process, command and HTTP evidence to a new `.dev/e2e/<YYMMdd>-jwt-verification/` directory of the root repository, with a numeric suffix when necessary. It records no raw token or master key.
