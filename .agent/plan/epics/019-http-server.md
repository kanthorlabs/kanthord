# EPIC 019 — HTTP server skeleton: koa + Basic auth + `/healthz` + UI shell

> Authored 2026-07-29. Supersedes the discarded `019-http-api-skeleton`
> (find-my-way + hand-rolled HS256 JWT + HttpOnly cookie + CSRF claim + a key
> file beside the database). Ulrich replaced that design with: koa + pino +
> supertest, HTTP Basic auth against `API_KEY` from `.env`, `@koa/bodyparser`
> and `@koa/cors` for body parsing and CORS. The REST decisions from the old
> epic survive unchanged; the session/JWT/CSRF-token machinery is gone.
>
> Design went through the debate engine (`pi`, read-only) and eight findings were
> merged; the three that changed the shape are marked **[debate]** inline. The
> largest: the koa error boundary must be the FIRST middleware, not the last;
> `ROUTES` rows take `deps` as a `run` parameter, because a static const cannot
> close over composition-built use cases; and the CLI-retirement inventory drops
> its one-route-per-CLI-leaf assumption.
>
> The CLI is retired only when the UI covers it. 019 starts the inventory that
> tracks that migration; it removes no CLI command.

## Goal

`kanthord serve` runs a koa server on loopback that answers `GET /healthz` with
the same version `kanthord --version` prints, gated by HTTP Basic auth against
`API_KEY` from `.env`, logged as JSON through pino, and serves a one-page UI
shell that fetches `/healthz` and renders that version. Every transport seam a
later epic needs is in place — route table with dependency injection, JSON
envelope, error registry with a safe fallback, JSON body parsing, CORS, request
ids, structured logging, graceful shutdown — so a later epic adds route-table
rows plus the use cases behind them, never another server.

## Verified stack facts (checked on this tree, 2026-07-29)

Do not re-litigate these at build time; they were measured, not assumed.

- Installed exact: `koa@3.2.1`, `pino@10.3.1`, `@koa/bodyparser@6.1.0`,
  `@koa/cors@5.0.0` (dependencies); `supertest@7.2.2`, `@types/koa@3.0.3`,
  `@types/koa__cors`, `@types/supertest` (devDependencies). `koa@3` and
  `@koa/cors@5` ship no typings of their own — hence the two `@types` packages.
  `find-my-way` was removed from `package.json`.
- `import Koa from "koa"`, `import { bodyParser } from "@koa/bodyparser"`,
  `import cors from "@koa/cors"`, `import pino from "pino"` and
  `import request from "supertest"` all typecheck under the repo `tsconfig.json`
  (`module: nodenext`, `verbatimModuleSyntax: true`, `strict`).
  `ctx.request.body` typechecks — `@koa/bodyparser` augments koa's `Request`.
- The same stack runs under Node 24 direct TypeScript execution: a
  `supertest(app.callback()).post().send({a:1})` round trip returned the parsed
  body and pino wrote one JSON line to stdout.

## Decisions (binding; do not re-open at build time)

1. **Approved packages only.** `koa`, `pino`, `@koa/bodyparser`, `@koa/cors`,
   `supertest`. No koa-router (the matcher is hand-rolled), no koa-static, no
   pino-pretty, no dotenv (Node's `process.loadEnvFile()`). The matcher supports
   literal segments and `:param` segments only — no wildcards, no regex, no
   optional segments.
2. **REST, resource-oriented, no RPC** (inherited decision, unchanged). Plural
   noun collections, ids in the path, `200` / `201` + `Location` / `204`, no verb
   in any path. The CLI is the coverage reference, not the URL map:
   `kanthord get project --id X` becomes `GET /api/projects/X`. A non-CRUD CLI
   verb becomes a sub-resource named after the outcome
   (`POST /api/tasks/:id/approval`, `POST /api/repositories/:id/publication`),
   never `/approve`. Pausing is state: `PATCH /api/initiatives/:id
{"paused":true}`.
3. **Auth is HTTP Basic, one shared secret.** `Authorization: Basic
base64(<any-username>:<API_KEY>)`; the username is ignored. Comparison is
   `crypto.timingSafeEqual` over `sha256` digests, so length never leaks. Failure
   is `401` with `WWW-Authenticate: Basic realm="kanthord"` — that header is what
   makes the browser prompt, which is why the UI needs no login page, no cookie,
   no JWT and no CSRF token. **[debate] The scheme token is matched
   case-insensitively** (RFC 7617: `basic` = `Basic` = `BASIC`) **and the base64
   payload is validated explicitly** by re-encoding the decode and comparing —
   Node's base64 decoder is permissive and silently accepts junk.
4. **Every route requires auth, including `/healthz` and `/`.** Auth runs before
   routing, so an unauthenticated request to any path — known or unknown — is
   `401` and never reveals which routes exist. Settled by Ulrich, 2026-07-29.
   **[debate] Stated cost, not dismissed:** a `/healthz` behind auth cannot serve
   an anonymous process supervisor, and a successful socket bind is not the same
   fact as application health. Accepted because kanthord is a single-user local
   daemon with no supervisor today, and one gate with no exceptions is the rule
   least likely to be got wrong. If a supervisor appears, the fix is one row
   moved to a small public list — not a redesign.
5. **`API_KEY` comes from `.env`, and `serve` refuses to start without it.**
   `main.ts` calls `process.loadEnvFile()` only when `.env` exists, before
   `buildDeps`. A missing, blank, or shorter-than-16-character `API_KEY` exits
   non-zero with a message naming `API_KEY`, and never opens a listener. The key
   is never logged and never appears in a response body. **Binding: an
   already-set `process.env` value wins over the `.env` file value**, matching
   `--env-file`; a test asserts this directly rather than trusting Node's docs.
   Loading applies to every CLI command, which is intended: one env source for
   the whole program.
6. **CSRF defence is implemented in 019** (Ulrich, 2026-07-29 — the debate's
   proposal to defer it was overruled once `@koa/bodyparser` came in). Browsers
   replay cached Basic credentials cross-site, so Basic is no safer than a cookie
   here. Two rules, with deliberately different scopes (Ulrich, 2026-07-29):
   - **Media type — `POST`, `PUT`, `PATCH` only.** The `Content-Type` must be
     `application/json`, which blocks HTML-form CSRF outright. `DELETE` is
     exempt: it carries no body, so demanding a body's media type would reject
     every correct client.
   - **`Origin` — every unsafe method, `DELETE` included.** When the header is
     present it must equal the server's own origin. `DELETE` is exactly as
     CSRF-exposed as the others, so it keeps this gate.

   019 ships no unsafe route, so both gates are proved through injected test
   routes (decision 18).

7. **`@koa/cors` is configured closed, and it is not a security boundary.**
   `origin` is a function that echoes the request `Origin` only when it is
   `http://127.0.0.1:<port>` or `http://localhost:<port>`, and returns `""`
   (no header) otherwise; `credentials: false`; `allowMethods: ["GET", "POST",
"PATCH", "DELETE"]`; `allowHeaders: ["Content-Type", "Authorization"]`.
   **Binding: `@koa/cors` only ADDS response headers — it never rejects a
   request**, so the decision-6 `Origin` gate stays. A wildcard origin, or
   `credentials: true`, is forbidden: with ambient Basic credentials that would
   let any web page read kanthord data.
8. **The route table is the contract, and it takes its dependencies as a
   parameter.** **[debate] changed from a static closure table** —
   `src/apps/http/routes.ts` exports `ROUTES: readonly Route[]`, each row
   `{ id, method, path, successStatus, decode, run, present, cliCommands }` with
   `run(deps: HttpDeps, input): Promise<unknown>`. Deps arrive at dispatch time,
   so the table stays a static, grep-able, directly-iterable const while its
   handlers still reach composition-built use cases. `HttpDeps`
   (`src/apps/http/deps.ts`) is an interface declared by the HTTP app listing
   only what its routes need — it starts as `{ logger: HttpLogger }` and grows
   one field per epic. It is not `CliDeps` and not a god bag. `id` is the stable
   key the UI codes against (`"health.get"`). Rejected alternative:
   `buildRoutes(deps)` returning rows closing over use cases — it works, but the
   route policy test then needs a fake deps bundle to see the table at all.
9. **Three layers, no CLI reuse.** `decode` maps path params + query + parsed
   body → typed use-case input; `run` calls the use case; `present` maps the
   result → an explicit DTO with a literal field list. HTTP never calls a CLI
   handler and never parses CLI text. CLI-only compact grammar (e.g.
   `--context type=id`, `src/apps/cli/task.ts:80`) stays in the CLI; HTTP takes
   structured JSON. A presenter is mandatory, not stylistic: `GetProject` returns
   a `domain/` entity and eslint `boundaries` forbids `apps/` → `domain/`, so a
   DTO is the only legal answer.
10. **Fixed middleware order, documented in one place** (`src/apps/http/app.ts`).
    **[debate] corrected — the error boundary is OUTERMOST, registered first:**

    1. error boundary — `try { await next() } catch (e) { … }`
    2. requestId (ULID, echoed in every error body and every log line)
    3. request log — `try/finally` around `await next()`, so a thrown request is
       still logged with its status and duration
    4. Host check (`403 host_not_allowed`)
    5. `@koa/cors` — answers an `OPTIONS` preflight itself and does not call
       `next()`. It must sit BEFORE auth: a preflight carries no credentials, so
       an auth-first order would `401` the preflight and the browser would block
       the real request.
    6. Basic auth (`401 unauthenticated`)
    7. unsafe-method gate: media type on `POST`/`PUT`/`PATCH` (`415`) and
       `Origin` on `POST`/`PUT`/`PATCH`/`DELETE` (`403`)
    8. `@koa/bodyparser` (`enableTypes: ["json"]`, `jsonLimit: "1mb"`)
    9. dispatch: route match → `404 unknown_route` / `405 method_not_allowed`
       with `Allow`, then `decode` → `run` → `present` → envelope

    Registered last, as a naive koa app does, the boundary sees nothing thrown by
    auth, routing, the body parser or a handler — which would make the promised
    "the process stays alive" claim false.

11. **Errors are an envelope with stable codes.** `{"data":…}` on success (`204`
    is the one exemption — no body at all);
    `{"error":{"code":"…","message":"…","requestId":"<ulid>"}}` on failure.
    `src/apps/http/error-registry.ts` maps an error class to `{ code, status }`;
    class names are internal, so renaming one must not break the UI. An unmapped
    error is `500 internal`: the original message never reaches the client, the
    cause is logged once with the same requestId, and the process survives. This
    fallback cannot wait — `toResult` (`src/apps/cli/error-map.ts`) RE-THROWS an
    unmapped error, which in a long-running server kills it.
    **[debate] The registry is seeded with two domain conventions only** —
    `UnknownReferenceError` → `404 unknown_reference`, `DuplicateNameError` →
    `409 duplicate_name` — plus the transport codes 019 itself raises
    (`unauthenticated`, `unknown_route`, `method_not_allowed`,
    `host_not_allowed`, `origin_not_allowed`, `unsupported_media_type`,
    `malformed_body`, `body_too_large`, `invalid_input`, `internal`). The old
    "map all ~14 classes `error-map.ts` handles" requirement is dropped:
    `MissingFlagError` and `InvalidNumericFlagError` are CLI-parse concerns that
    may never be reachable over HTTP, and a mapping with no route to exercise it
    is a guess. Each later epic maps the errors its own routes can raise.
    **Binding: the boundary also recognises `http-errors`-shaped errors thrown by
    `@koa/bodyparser`** (`err.status` / `err.statusCode`): `400` →
    `malformed_body`, `413` → `body_too_large`, `415` →
    `unsupported_media_type`, and it never forwards their raw message, which can
    echo request bytes.
12. **Version has exactly one source.** `src/apps/version.ts` exports
    `packageVersion`, read from `package.json`. `src/apps/cli/index.ts` stops
    reading `package.json` itself and imports it. `/healthz` returns that same
    constant, so "the API version equals the CLI version" is true by
    construction — and asserted over the wire anyway.
13. **pino writes JSON to stdout; the bound port arrives as a log field.**
    `serve` prints no plain text; the server logs
    `{"msg":"listening","port":<n>,"address":"127.0.0.1"}` and the Proof reads
    the port from that line. One stdout format is parseable; a plain line mixed
    into JSON lines is not. Request lines carry `requestId`, `method`, `path`,
    `status`, `durationMs` — never headers, never the key.
14. **`apps/http` declares its own logger interface.** eslint `boundaries`
    forbids `apps/` → an adapter port, which is why `src/apps/cli/deps.ts:159`
    already re-declares `Logger`. `src/apps/http/logger.ts` declares the
    structured shape (`info(message, fields?)`, `warn`, `error`),
    `src/logger/pino.ts` implements both it and the existing `Logger` port
    (`src/logger/port.ts`), and `composition.ts` — the only legal importer —
    injects it. `StdoutLogger` and `NullLogger` are not touched.
15. **Loopback and DNS-rebinding hardening.** Bind `127.0.0.1` only. Reject a
    `Host` that is not `127.0.0.1[:port]` or `localhost[:port]` → `403
host_not_allowed`.
16. **`GET /` serves a UI shell from 019.** One hand-written HTML document
    (`src/apps/http/ui.ts`, no bundler, no framework, inline script) that fetches
    `/healthz` and renders the version. It is the UI's walking skeleton, so
    "serve a UI" is real in the first epic instead of a promise. Bundled assets
    and a framework are a later decision.
17. **`--port` defaults to `4100`; `--port 0` is supported** so tests and the
    Proof never guess a port. **[debate] Signal ownership is separated from the
    server:** `startHttpServer(app, opts)` returns `{ port, close() }` and
    registers NO process listeners; `src/apps/cli/commands/serve.ts` is the only
    place that attaches `SIGTERM`/`SIGINT`. Otherwise every test that starts a
    server leaks a signal listener.
18. **`buildHttpApp(deps, opts)` takes an injectable `routes`**, defaulting to
    `ROUTES`. This is how tests prove what no 019 route can reach — the `500`
    catch-all, `415`, `413`, malformed body, the `Origin` gate — without
    polluting the real contract with a fake row.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **Route policy test, iterating `ROUTES`** so it grows automatically: every row
  has a unique non-empty `id`, a `method` in `{GET, POST, PATCH, DELETE}`, a path
  starting `/`, a `successStatus` in `{200, 201, 204}`, a `run` function, and a
  `cliCommands` array (possibly empty). `present` is required unless
  `successStatus` is `204`, and forbidden when it is. `method`+`path` is unique.
  `PUT` is absent from the allowed method set, consistently with the non-goals.
  **Binding: the test iterates the table, so a later epic cannot add an
  under-declared row.**
- **REST-shape test, iterating `ROUTES`:** no static path segment matches the
  banned verb list. **[debate] narrowed** to unambiguous verbs — `get`, `create`,
  `list`, `find`, `add`, `remove`, `approve`, `reject`, `land`, `publish`,
  `pause`, `resume`, `retry`, `abandon`, `assign`, `unassign`, `register`,
  `login`, `logout`, `update`, `rename`, `run`, `setup`, `ack`, `check`,
  `set-default`. `import`, `export`, `test` and `commands` are deliberately NOT
  banned: each is a legitimate resource noun, and a blacklist that rejects a
  valid noun teaches people to disable the test. **Binding: this is the machine
  check that keeps decision 2 true** as later epics add rows — `approval` and
  `publication` are nouns and pass, `/approve` and `/publish` fail.
- **Basic auth table, over supertest**, one case per row: correct key → pass;
  absent header, `Bearer <key>`, wrong key of equal length, wrong key of
  different length, non-base64 payload, base64 without a colon, empty password →
  `401` with `WWW-Authenticate: Basic realm="kanthord"` and an
  `unauthenticated` envelope; `basic` and `BASIC` casing with the right key →
  pass.
- **Auth precedes routing:** an unknown path without credentials is `401`, not
  `404`; and `GET /healthz` without credentials must not reach the handler —
  asserted with a spy recording zero calls, so a leak cannot hide behind a
  correct status.
- **Version identity:** the `/healthz` body's `version` is `===`
  `packageVersion`, and `buildProgram(deps).version()` returns the same value.
  One constant, two callers, one test.
- **The catch-all works from the outermost position:** an injected route whose
  `run` throws `Error("boom")` gives `500 internal` with a `requestId`; `"boom"`
  appears nowhere in the response bytes; the cause is logged once with that same
  `requestId`; the process stays alive. **Plus a middleware-order test: an error
  thrown by the auth middleware itself is also caught** — the assertion that pins
  decision 10.
- **Body and CSRF gates, via injected routes:** invalid JSON body → `400
malformed_body`; `Content-Type: text/plain` on `POST` → `415
unsupported_media_type`; a body over 1 MiB → `413 body_too_large`; a foreign
  `Origin` on `POST` → `403 origin_not_allowed`; a matching `Origin` on `POST` →
  pass. Scope split asserted both ways: a `DELETE` with NO `Content-Type` passes
  the media-type gate, and the same `DELETE` with a foreign `Origin` is still
  `403 origin_not_allowed`. None of these responses may contain any request
  bytes.
- **CORS headers:** a `GET` with `Origin: http://127.0.0.1:<port>` echoes that
  origin; a `GET` with `Origin: https://evil.example` carries NO
  `Access-Control-Allow-Origin`; no response ever carries
  `Access-Control-Allow-Credentials`; an `OPTIONS` preflight from the allowed
  origin succeeds WITHOUT credentials (proving cors sits before auth).
- **Routing gates over the real table:** unknown path (authenticated) → `404
unknown_route`; `POST /healthz` → `405 method_not_allowed` with an `Allow: GET`
  header computed from the table's rows for that path.
- **Path params:** `requirePathParam` rejects a value blank after `.trim()` →
  `400 invalid_input` naming the field, so a single-space id can never reach a
  use case. (No 019 route takes a param; the unit rules are tested directly, and
  the first param route in a later epic inherits them.)
- **Error-registry hygiene:** every entry has a unique `snake_case` code and a
  status in `{400, 403, 404, 405, 409, 412, 413, 415, 500}`; no two classes share
  a code.
- **`serve` refuses a bad key:** missing `API_KEY`, blank, and a 15-character key
  each exit non-zero with a message naming `API_KEY`, and no listener is opened.
  A 16-character key starts.
- **Bind address:** `startHttpServer` reports address `127.0.0.1` — asserted
  directly, because a `0.0.0.0` bind is the one mistake a loopback test cannot
  catch.
- **Logging redaction:** a captured pino stream over a full request cycle
  contains no `authorization` value and no `API_KEY` substring.
- **Tests never read the real `.env`:** every HTTP test injects an explicit key,
  and `buildHttpApp` throws when given none rather than falling back to
  `process.env`.
- **No leaked listeners:** a test starts and closes a server twice and asserts
  `process.listenerCount("SIGTERM")` is unchanged.
- **`serve` is a normal CLI leaf:** wired in `buildProgram`
  (`src/apps/cli/index.ts`) and present in `kanthord commands` output.
- **CLI-retirement inventory (diagnostic, not the contract).** **[debate]
  reshaped** — a test walks the Commander tree the way
  `src/apps/cli/commands/commands.ts:11` does, collects every leaf path, and
  prints which leaves no `ROUTES` row claims through its `cliCommands` array. The
  old one-route-per-leaf assumption is dropped: `cliCommands` is an array, one
  leaf may need several routes (`get project` needs a collection and an item
  route) and one route may cover several leaves, so **no uniqueness assertion**.
  The test asserts only that every named leaf really exists in the Commander tree
  (typo guard). **The roadmap lives in
  `.agent/plan/stories/019-http-server/retirement.md`, not in an assertion** —
  hard-coding a target epic per leaf into a test makes every re-plan a red build.
  **Binding: this is an inventory report, never proof that a route works** — a
  row wired to the wrong use case passes it.

Proof: `scripts/e2e/http-serve-proof.sh` — deterministic, no model, no outbound
network (loopback only), no server left running. Run from the repo root:

```bash
scripts/e2e/http-serve-proof.sh
```

It must print `019 ok: …`. Phases:

- **A** — a temp `KANTHORD_DB` is migrated; a temp `.env` carrying a 32-hex-char
  `API_KEY` is placed in the working directory `serve` runs from; `serve
--port 0` starts in the background and the bound port is read from its
  `listening` JSON log line.
- **B** — `GET /healthz` with Basic auth is `200` and `data.version` equals
  `kanthord --version` output — the equality this epic exists to prove.
- **C** — no `Authorization` header → `401` with `WWW-Authenticate: Basic
realm="kanthord"` and code `unauthenticated`; a wrong key → `401`; lower-case
  `basic` with the right key → `200`.
- **D** — `GET /` with Basic auth is `200` with `Content-Type: text/html` and the
  body references `/healthz`. **Stated limit:** no browser runs in the Proof, so
  this proves the shell is served, not that a DOM renders. The Proof therefore
  also performs the exact request the shell's script makes and asserts the same
  version comes back, so the shell's data path IS proved.
- **E** — `GET /nope` (authenticated) → `404 unknown_route`; `POST /healthz` →
  `405` with `Allow: GET`.
- **F** — hardening over the wire: `Host: evil.example` → `403`; a `GET` with
  `Origin: https://evil.example` carries no `Access-Control-Allow-Origin`; no
  response carries `Access-Control-Allow-Credentials`; the `API_KEY` bytes appear
  in no response body and in no captured log line.
- **G** — `serve` with `API_KEY` unset exits non-zero, names `API_KEY`, and
  nothing listens on the chosen port.
- **H** — `SIGTERM` shuts the server down and the port stops accepting.

Against the CURRENT tree the proof fails in phase A at `serve --port 0` with
`unknown command 'serve'`; `src/apps/http/` does not exist. Phase A's setup lines
up to that point (migrate) pass today, so the first failure is the missing
capability and not a broken fixture.

## Stories

- **S0 — dependencies + env sample (maintainer, ALREADY DONE, not `/work`).**
  `koa@3.2.1`, `pino@10.3.1`, `@koa/bodyparser@6.1.0`, `@koa/cors@5.0.0` as
  dependencies; `supertest@7.2.2`, `@types/koa@3.0.3`, `@types/koa__cors`,
  `@types/supertest` as devDependencies; `find-my-way` removed; `.env.example`
  carrying `API_KEY=` with a generation hint. `package.json`, the lockfile and
  `.env.example` are lane-forbidden, so Ulrich + Aelita did this in a normal
  session before dispatch. Every later story assumes them present.
- **S1 — version constant + `.env` loading.** `src/apps/version.ts`,
  `src/apps/cli/index.ts` switched to it, `process.loadEnvFile()` in `main.ts`
  guarded by an existence check, plus the process-env-wins precedence test.
- **S2 — envelope + error registry.** `src/apps/http/envelope.ts`,
  `src/apps/http/error-registry.ts`, the `204` no-body exemption, the
  `http-errors` recognition rule, the hygiene test.
- **S3 — route table + matcher + the `health.get` row.**
  `src/apps/http/routes.ts` (`Route`, `ROUTES`), `src/apps/http/deps.ts`
  (`HttpDeps`), `src/apps/http/router.ts` (segment matcher, `Allow`
  computation), `src/apps/http/decode.ts` (`requirePathParam` and the query
  coercion rules), `src/apps/http/views/health.ts`. Ships the route policy and
  REST-shape tests.
- **S4 — Basic auth + the pino logger.** `src/apps/http/basic-auth.ts`,
  `src/apps/http/logger.ts` (`HttpLogger`), `src/logger/pino.ts`, the auth table,
  the redaction test.
- **S5 — the koa app.** `src/apps/http/app.ts` — `buildHttpApp(deps, opts)` with
  the decision-10 middleware order, `@koa/cors` and `@koa/bodyparser` configured
  per decisions 6–7, the injectable `routes` seam — and
  `src/apps/http/server.ts` — `startHttpServer` binding `127.0.0.1`, `--port 0`,
  `close()`, no signal listeners.
- **S6 — the UI shell.** `src/apps/http/ui.ts` and its `GET /` row.
- **S7 — the `serve` CLI leaf.** `src/apps/cli/commands/serve.ts` (`--port`,
  `API_KEY` validation, `SIGTERM`/`SIGINT`), wiring in `buildProgram`, and the
  `composition.ts` pino + `HttpDeps` injection.
- **S8 — the CLI-retirement inventory test** plus
  `.agent/plan/stories/019-http-server/retirement.md`.
- **S9 — the proof.** `scripts/e2e/http-serve-proof.sh` with a `curl`-free
  request helper (`node --eval` + `fetch`) so status, headers and parsed body are
  all assertable, and a `trap` that kills the server on every exit path.

## Non-goals

- Every resource except `/healthz` and `/`. Reads, the event feed, planning
  writes, state-transition sub-resources and high-impact operations each land in
  their own later epic. The breadth-first "all reads in one epic" plan is
  rejected: a defect in decoding, auth or status mapping would land across the
  whole surface at once.
- A UI framework, a bundler, or serving built assets from disk. 019's shell is
  one inline HTML document.
- Retiring any CLI command. 019 starts the inventory; removal happens only when a
  resource's routes exist and are proved.
- A logout path. Basic auth has none — the browser caches credentials until it
  restarts. Accepted as a temporary constraint of "Basic auth for now"; the epic
  that adds real sessions owns it.
- Multi-user accounts, roles, authorization, key rotation endpoints, TLS,
  SSE/WebSocket (notifications stay pull-based per AGENTS.md), OpenAPI
  generation, client codegen, a `/v1` prefix, `PUT` (updates are `PATCH`),
  content negotiation beyond `application/json`, and `If-Match`/`ETag`
  optimistic concurrency (the convention is recorded for the epic that ships the
  first versioned write: mismatch → `412 precondition_failed`).
