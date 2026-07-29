# EPIC 019 — HTTP API skeleton: one REST resource, served end to end

> Authored 2026-07-29 after a `/debate` pass on the design (engine `pi`,
> read-only). The debate killed the original governing rule — "route = command
> path, method inferred from the English verb, no hand-written mapping table" —
> on two grounds. First, the rule contradicts itself: `run`, `setup`, `login`,
> `test` and interactive `import` have no request/response shape and were exempt
> in the same paragraph that called the rule load-bearing. Second, AGENTS.md
> requires apps to "register routes/commands in explicit, grep-able tables", and
> an inferred mapping deletes the one place where method, auth, input schema and
> response shape get reviewed.
>
> Ulrich then settled the shape (2026-07-29): **`apps/http` is REST, with no RPC
> anywhere in it.** The CLI is the _reference_ for coverage, not for URLs — the
> API adjusts the naming to fit REST. `GET /api/tasks/:id`, not
> `POST /api/operations/get-task`. `201` / `204` and resource semantics are in.
>
> The debate also proved a raw pass-through is impossible, not merely unwise:
> `GetProject.execute` returns a `domain/project.ts` entity
> (`src/app/project/get-project.ts:14`), and eslint `boundaries` forbids
> `apps/` → `domain/` (`eslint.config.js`, policy "apps/ calls use cases only").
> A presenter DTO is the only legal way for `apps/http` to answer.
>
> Consumer: a Preact dashboard, later wrapped by an Electron app.

## Goal

`kanthord serve --port <n>` runs a REST API on loopback that answers one real
resource read — `GET /api/projects/:id` — over the contract every later resource
will reuse: an explicit route table (path, method, auth, decoder, use case,
presenter, status), a JSON envelope, a stable error-code registry with HTTP
statuses, and JWT session auth delivered in an HttpOnly cookie for the browser
and as a bearer token for Electron and the CLI. After this epic a Preact page
fetches a project from the daemon and renders it, and every later HTTP epic adds
table rows only — never another transport decision.

## Decisions (binding; do not re-open at build time)

1. **REST, resource-oriented, no RPC.** Plural noun collections, ids in the path:
   `GET /api/projects`, `GET /api/projects/:id`, `POST /api/projects`,
   `PATCH /api/projects/:id`, `DELETE /api/resources/:id`. No verb ever appears
   in a path. The CLI command is the coverage reference, not the URL: `kanthord
get project --id X` becomes `GET /api/projects/X`.
2. **HTTP status carries the outcome.** `200` read or update with a body; `201`
   create, with a `Location` header pointing at the new resource **and** the
   created resource in the body; `204` for a successful delete or a transition
   with nothing to return, with an empty body; `202` reserved for the async job
   API in 025. `204` is the single exemption from the envelope — no body means no
   envelope.
3. **A CLI verb that is not CRUD becomes a sub-resource, never a path verb.**
   Binding convention so epics 023 / 024 inherit it instead of re-deciding: a
   state transition is a `POST` to a sub-resource named after the _outcome_ —
   `POST /api/tasks/:id/approval`, `POST /api/tasks/:id/rejection`,
   `POST /api/repositories/:id/publication`, `POST /api/projects/:id/acknowledgement`
   — returning `200` with the affected resource, or `204` when there is nothing
   to return. Pausing is state, so it is `PATCH /api/initiatives/:id`
   `{"paused":true}`, not a `/pause` path.
4. **The route table is the contract.** `src/apps/http/routes.ts` exports
   `ROUTES: readonly Route[]`, each row
   `{ id, method, path, auth, successStatus, decode, run, present, cliCommand }`.
   `id` is the stable key the Preact client codes against (`"projects.get"`).
   `cliCommand` names the CLI leaf the row covers (`"get project"`) — that field
   is what keeps CLI parity auditable now that paths no longer mirror commands.
   `find-my-way` is fed from this array; nothing registers a route outside it.
   `auth` and `successStatus` are **declared per row**, never inferred.
5. **Three layers, no CLI reuse.** HTTP never calls a `runXxx` CLI handler and
   never parses CLI text. `decode` maps path params + query + body → typed
   operation input; `run` calls the use case; `present` maps the result → an
   explicit DTO. CLI-only compact grammar (e.g. `--context type=id`,
   `src/apps/cli/task.ts:80`) stays in the CLI; HTTP takes structured JSON
   (`{"context":[{"type":"repository","id":"r1"}]}`).
6. **Error codes are stable constants, not class names.**
   `src/apps/http/error-registry.ts` maps each error class to
   `{ code: "unknown_reference", status: 404 }`. Class names are internal;
   renaming one must not break the UI.
7. **JWT, HS256, hand-rolled against `node:crypto`** in `src/apps/http/jwt.ts`
   (~40 lines: base64url, HMAC, `timingSafeEqual`). Reason for not adding
   `jose`: the classic JWT breaks (`alg: none`, alg confusion) come from generic
   multi-algorithm verifiers; a fixed-HS256 verifier that rejects every other
   `alg` has no such surface, and the epic already adds one dependency.
8. **One key file; the pairing credential is its content, the signing secret is
   derived.** `serve` reads or creates a key file **beside the database** —
   `dirname(KANTHORD_DB)/http-key`, so `.data/http-key` by default and a temp path
   under a temp `KANTHORD_DB`, which is what keeps the Proof hermetic — 32 random
   bytes, hex, written `O_EXCL` + `0600` + rename, never logged, never in a
   response. The **pairing credential is the raw file content**, so any local
   process that can read the file can pair by sending exactly those bytes. The JWT
   signing secret is `hkdfSync("sha256", <content>, "", "kanthord-jwt", 32)`, so a
   client holding the pairing credential still cannot forge a token.
   **Amended (Ulrich, 2026-07-29)** — was: "`hkdfSync` derives … the pairing
   credential (info `"kanthord-pair"`)". A second derivation was dropped because
   it protects nothing: a holder of the file can pair either way, so the only
   difference was that every client would have to reimplement HKDF to say hello.
   The committed Proof (`scripts/e2e/http-api-proof.sh:87`) reads the file and
   sends it verbatim, which is now the contract.
9. **Session as a resource.** `POST /api/sessions` with
   `Authorization: Bearer <pairing credential>` returns `201` with
   `{ data: { token, csrf, expiresAt } }`, a `Location` of `/api/sessions/current`,
   and `Set-Cookie: kanthord_session=<jwt>; HttpOnly; SameSite=Strict; Path=/`.
   Browser pages use the cookie and never hold the token in JavaScript;
   Electron's main process and the CLI use the bearer form. TTL 12h.
   `DELETE /api/sessions/current` → `204` and an expired cookie.
10. **CSRF is defined now, before any write resource exists.** The JWT carries a
    `csrf` claim; every unsafe method (`POST`, `PATCH`, `PUT`, `DELETE`) must send
    `X-Kanthord-Csrf` equal to it. `POST /api/sessions` is exempt — it
    authenticates with the pairing credential, which a hostile page cannot read.
11. **Transport hardening, all in 019.** Bind `127.0.0.1` only. Reject a `Host`
    header that is not `127.0.0.1[:port]` or `localhost[:port]` (DNS rebinding).
    Reject an unsafe-method body whose `Content-Type` is not `application/json`.
    Cap the body at 1 MiB. No CORS headers, ever. An `Origin` header on an unsafe
    method must match the server's own origin — defence in depth, not
    authentication.
12. **Optimistic concurrency is `If-Match` + `ETag`**, wherever a use case
    already carries a version (e.g. `credentialVersion`, the 018 CAS path). 019
    ships no such route; the convention is fixed here so 024 inherits it. A
    mismatch is `412 precondition_failed`.
13. **`--port 0` is supported and `serve` prints the bound port as its first
    stdout line**, so the Proof and the tests never guess a port.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **Route policy test.** Every row in `ROUTES` has a non-empty `id`, a `method`
  in `{GET, POST, PATCH, DELETE}`, a path starting `/api/`, an `auth` in
  `{required, pairing, none}`, a `successStatus` in `{200, 201, 204}`, a
  non-empty `cliCommand` (or the literal `"none"` for HTTP-only rows such as
  sessions and health), and `decode`/`run` functions. `present` is required
  unless `successStatus` is `204`, and **forbidden** when it is. Ids and
  `method+path` pairs are unique. **Binding: the test iterates `ROUTES`, so it
  grows automatically** — a later epic cannot add an under-declared row.
- **REST-shape test, iterating `ROUTES`.** No path segment is a verb: each
  static segment must not match a banned verb list built from the CLI's own
  top-level command names (`get`, `create`, `list`, `find`, `add`, `remove`,
  `approve`, `reject`, `land`, `publish`, `pause`, `resume`, `retry`, `abandon`,
  `assign`, `unassign`, `register`, `login`, `logout`, `update`, `rename`,
  `import`, `export`, `run`, `setup`, `test`, `ack`, `check`, `set-default`).
  **Binding: this is the machine check that keeps decision 1 true** as 020–025
  add rows — including the sub-resource convention, since `approval` and
  `publication` are nouns and pass, while `/approve` and `/publish` fail.
- **Status semantics per row.** A `201` row's response carries a `Location`
  header that a subsequent `GET` resolves to the same resource; a `204` row's
  response body is exactly zero bytes and carries no `Content-Type`. Asserted
  with `POST /api/sessions` and `DELETE /api/sessions/current` — the two rows 019
  actually ships — through the route table, not by special-casing them.
- **Error-registry completeness.** A test imports the same error classes
  `src/apps/cli/error-map.ts` handles and asserts each one is present in
  `error-registry.ts` with a code and a status. Reason: `toResult`
  (`src/apps/cli/error-map.ts`) re-throws unmapped errors, which in a server
  would kill the process instead of answering. This test is the link that stops
  the two maps drifting.
- **Codes and statuses are asserted per class, not by name family.**
  `UnknownReferenceError` → 404 `unknown_reference`; `DuplicateNameError`,
  `CycleError`, `StaleCandidateError`, `ImpactChangedError`,
  `DependenciesLockedError`, `DriftConflictError` → 409; `MissingFlagError`,
  `InvalidBaseUrlError`, `InvalidNumericFlagError`, `EmptyValueError` → 400;
  `CacheConflictError` and `StaleCredentialError` → 412. Guessing from the
  class-name family is forbidden — the table is explicit.
- **The catch-all answers.** A route whose `run` throws an error absent from the
  registry produces `500` with body
  `{"error":{"code":"internal","message":"internal error","requestId":"<ulid>"}}`
  — the original message never reaches the client — and the cause is logged once
  with the same `requestId`. Asserted with a fake deps bundle whose `getProject`
  throws a plain `Error("boom")`, plus an assertion that `"boom"` appears
  nowhere in the response bytes.
- **Malformed input is envelope-shaped, not a crash.** Separate tests for:
  invalid JSON body → 400 `malformed_body`; wrong `Content-Type` → 415
  `unsupported_media_type`; body over 1 MiB → 413 `body_too_large`; unknown path
  → 404 `unknown_route`; known path, wrong method → 405 `method_not_allowed`
  **with an `Allow` header listing the methods the table declares for that
  path**; a blank path param (`/api/projects/%20`) → 400 `invalid_input` naming
  the field.
  **Amended (Ulrich, 2026-07-29)** — was: "an unparsable query param → 400
  `invalid_input` naming the field". No 019 route takes a query param (`id` is a
  path param), so that line described a case the epic could not reach. The
  reachable equivalent is the blank path param, asserted over the wire; the query
  coercion rules (`optionalQueryInt` out of range, non-integer, and the
  comma-separated array form) keep their own rejection table in
  `src/apps/http/decode.test.ts`, and epic 020 is the first epic with a route that
  exercises them end to end. **Binding: `requirePathParam` rejects a value that is
  blank after `.trim()`**, so a single-space id can never reach a use case.
- **JWT verification is hostile-input tested**, table-driven: a valid token
  passes; a flipped signature byte, an `alg` of `none`, an `alg` of `RS256`, an
  `exp` in the past, a missing `exp`, a missing `csrf`, three-segment garbage and
  an empty string each fail with 401 `unauthenticated`. **Binding: the verifier
  accepts `HS256` only** and compares with `crypto.timingSafeEqual`.
- **Auth placement.** `GET /api/health` needs no session; `GET /api/projects/:id`
  without a session is 401 and **must not call the use case** (asserted with a
  spy that records zero calls, so a leak cannot hide behind a correct status).
  Cookie and bearer both work and yield identical bodies.
- **CSRF.** An unsafe-method row is 403 `csrf_failed` when `X-Kanthord-Csrf` is
  absent or does not match the JWT claim, and succeeds when it matches — driven
  through `DELETE /api/sessions/current`, a real 019 row. `POST /api/sessions`
  succeeds without the header.
- **Host / Origin / bind.** `Host: evil.example` → 403 `host_not_allowed`.
  An unsafe method with a foreign `Origin` → 403 `origin_not_allowed`.
  `server.address()` reports address `127.0.0.1` — asserted directly, because a
  `0.0.0.0` bind is the one mistake a loopback test cannot catch.
- **The key file.** First `serve` creates the key file with mode `0600`; a
  second `serve` reuses it and does not rewrite it; the file's bytes appear in no
  response and in no log line. A pre-existing file with mode `0644` is refused
  with a clear message rather than used.
- **The presenter is a DTO, not an entity.** `projectView` is declared with an
  explicit field list and a test asserts the response body's key set is exactly
  that list. Reason: `GetProject` returns a domain entity; a spread would leak
  every future field, which is how a secret escapes. The existing
  `toResourceView` redaction precedent is the same lesson.
- **`serve` is a normal CLI leaf.** `src/apps/cli/commands/serve.ts` is wired in
  `buildProgram` (`src/apps/cli/index.ts`) and appears in `kanthord commands`
  output. The server is built by a factory the tests can call without the process
  entrypoint, mirroring `buildDeps`.
- **CLI-coverage audit (diagnostic, not the contract).** A test walks the
  Commander tree the way `src/apps/cli/commands/commands.ts:11` does, collects
  every leaf command path, and reports which ones no `ROUTES` row claims through
  its `cliCommand` field, against an explicit `DEFERRED` list carrying a one-line
  reason and the target epic per entry. In 019 nearly every leaf is deferred.
  **Binding: this test is an inventory report, never the proof that a route
  works** — a row wired to the wrong use case passes it. It also asserts no
  `cliCommand` value is claimed by two rows and that every non-`"none"` value
  names a leaf that really exists in the tree, so a typo cannot fake coverage.
- **Per-route contract test for `projects.get`:** `decode` rejects a missing path
  param, `run` calls `deps.getProject.execute` with exactly `{ id }`, and
  `present` produces the DTO. This is the pattern every later epic copies per row.

Proof: `scripts/e2e/http-api-proof.sh` — deterministic, no model, no outbound
network (loopback only), no server left running. Run from the repo root:

```bash
scripts/e2e/http-api-proof.sh
```

It must print `019 ok: …`. Phases:

- **A** — a temp `KANTHORD_DB` is migrated and a project is created with today's
  CLI. `serve --port 0` starts in the background and prints its bound port;
  the key file beside the temp database exists with mode `600`.
  `GET /api/health` returns `200` and `{"data":{"status":"ok"}}` with no session.
- **B** — `GET /api/projects/<P>` with no credential is `401` and the body is
  `{"error":{"code":"unauthenticated",…}}`.
- **C** — `POST /api/sessions` with the pairing credential returns `201`, a
  token, a `csrf` value, a `Location` of `/api/sessions/current` and an
  `HttpOnly` `Set-Cookie`. The same call with a wrong credential is `401`.
- **D** — **the 1:1 statement.** `GET /api/projects/<P>` with the bearer token is
  `200`, and `http.data` is compared **structurally** (parsed, key-order
  independent) with `kanthord get project --id <P> --json`. The same request
  authenticated by cookie returns the same body. Byte equality is deliberately
  NOT asserted: it would test whitespace and key order and would push HTTP into
  reusing CLI serialisation — the coupling decision 5 forbids.
- **E** — envelope and errors over the wire: unknown project id → `404`
  `unknown_reference`; `/api/nope` → `404` `unknown_route`;
  `DELETE /api/projects/<P>` → `405` with an `Allow: GET` header; a token with a
  flipped signature byte → `401`.
- **F** — REST semantics over the wire: `DELETE /api/sessions/current` with the
  CSRF header is `204` with a zero-byte body, and the token is rejected
  afterwards; the same call without the CSRF header is `403`.
- **G** — hardening over the wire: `Host: evil.example` → `403`; a `POST` with
  `Content-Type: text/plain` → `415`; no `Access-Control-Allow-Origin` header on
  any response; the pairing credential's bytes appear in no response body.
- **H** — the server shuts down on `SIGTERM` and the port stops accepting.

Against the CURRENT tree the proof fails in phase A at `serve --port 0` —
`unknown command 'serve'`; `src/apps/http/` does not exist and `find-my-way` is
not installed. Phase A's setup lines up to that point (migrate, create project)
pass today, so the first failure is the missing capability and not a broken
fixture.

## Stories

- **S0 — dependency (maintainer, NOT `/work`).** `npm i find-my-way` and the
  `package.json` / `package-lock.json` edit. `package.json` is lane-forbidden, so
  Ulrich + Aelita do this in a normal session **before** the epic is dispatched;
  every later story assumes the dependency is present.
- **S1 — transport primitives.** `src/apps/http/jwt.ts` (fixed HS256 sign +
  verify) and `src/apps/http/key.ts` (`0600` key file, `hkdfSync` derivation).
  Pure, no server, fully unit tested.
- **S2 — envelope + error registry.** `src/apps/http/envelope.ts` and
  `src/apps/http/error-registry.ts`, including the completeness test against
  `src/apps/cli/error-map.ts`'s class list, the `204` no-body exemption, and the
  `500` catch-all with `requestId`.
- **S3 — the route table types + the `projects.get` row.**
  `src/apps/http/routes.ts`, `src/apps/http/decode.ts` (path params + query +
  body → typed input, with array and number coercion rules), and
  `src/apps/http/views/project.ts` holding the explicit `projectView` DTO. Ships
  the route policy test and the REST-shape test.
- **S4 — the server.** `src/apps/http/server.ts`: a `buildServer(deps, opts)`
  factory over `node:http` + `find-my-way`, feeding routes from `ROUTES`,
  applying the Host / media-type / body-limit / auth / CSRF / Origin middleware
  chain in one documented order, emitting `Location`, `Allow` and `Set-Cookie`
  where the table calls for them, plus `GET /api/health`, `POST /api/sessions`
  and `DELETE /api/sessions/current`.
- **S5 — the CLI leaf.** `src/apps/cli/commands/serve.ts` (`--port`, default
  `4100`, `--port 0` allowed), wired into `buildProgram`, printing the bound port
  first and handling `SIGTERM`.
- **S6 — the CLI-coverage audit test.** The Commander-tree walk, the `DEFERRED`
  list with reasons and target epics, the duplicate/typo assertions, and the
  report output.
- **S7 — the proof.** `scripts/e2e/http-api-proof.sh`, with a `curl`-free request
  helper (`node --eval` + `fetch`) so status, headers and parsed body are all
  assertable, and a `trap` that kills the server on every exit path.

## Non-goals

- Every resource other than `projects/:id` (plus sessions and health). Reads land
  in 020, the event feed in 021, planning writes in 022, state-transition
  sub-resources in 023, high-impact operations (`land`, `publish`, `remove`,
  `update`) in 024, and an explicit async job API — `202` + a job resource — for
  `run` / `setup` / `login` / `test` / interactive `import` in 025. The
  breadth-first "all reads in one epic" plan was rejected: a defect in decoding,
  auth or status mapping would land across the whole surface at once.
- Serving the Preact bundle from the daemon. 019 keeps the browser same-origin
  through a Vite dev proxy; static serving is a 020+ decision.
- SSE and WebSocket. Notifications stay pull-based per AGENTS.md; the dashboard
  polls the event resource with a cursor once 021 lands.
- `PUT` (full replacement) anywhere — updates are `PATCH`. Content negotiation
  beyond `application/json`. HATEOAS link envelopes.
- OpenAPI generation, client codegen, a `/v1` prefix, multi-user accounts, roles
  or authorization (kanthord is single-user and local), and token revocation
  beyond `DELETE /api/sessions/current` or deleting `.data/http-key`.
