# Story 05 — the koa app + `startHttpServer`

Epic: `.agent/plan/epics/019-http-server.md` (bullet S5)
Depends on: Story 04.

## Change

1. **New file `src/apps/http/app.ts`**:

   ```ts
   export interface HttpAppOptions {
     /** Already validated by requireApiKey; buildHttpApp never reads process.env. */
     readonly apiKey: string;
     /** Injectable so tests can prove gates no real row reaches. */
     readonly routes?: readonly Route[];
     /** Injectable for deterministic ids in tests. Defaults to ulid(). */
     readonly newRequestId?: () => string;
   }

   export function buildHttpApp(deps: HttpDeps, opts: HttpAppOptions): Koa;
   ```

   `buildHttpApp` calls `requireApiKey(opts.apiKey)` first and therefore throws
   `MissingApiKeyError` for a blank/short key. `routes` defaults to `ROUTES`,
   `newRequestId` to `ulid` from the `ulid` package (already a dependency).

   Middleware are registered in EXACTLY this order — the order is the contract:

   1. **error boundary (outermost)** —
      `try { await next(); } catch (err) { … }`. On catch:
      `const m = mapError(err);` set `ctx.status = m.status`,
      `ctx.body = errorEnvelope(m.code, m.message, ctx.state.requestId)`; log once
      via `deps.logger.error("request failed", { requestId, method, path, status:
m.status, code: m.code, cause: String(err) })`. It must be registered
      before every other middleware, so it also catches throws from auth,
      routing, and `@koa/bodyparser`.
   2. **requestId** — `ctx.state.requestId = (opts.newRequestId ?? ulid)()`.
   3. **request log** — capture `const startedAt = Date.now()`, then
      `try { await next(); } finally { deps.logger.info("request", { requestId,
method: ctx.method, path: ctx.path, status: ctx.status, durationMs:
Date.now() - startedAt }); }`. No headers, no body, ever.
   4. **Host check** — parse `ctx.get("host")`; strip an optional `:<port>`
      suffix; the hostname must be `127.0.0.1` or `localhost`, else respond with
      `TRANSPORT_ERRORS.host_not_allowed` (throw an `HttpFailure` so the boundary
      formats it). A missing `Host` header is rejected the same way.
   5. **`@koa/cors`** — `cors({ origin: (ctx) => isAllowedOrigin(ctx.get("origin"))
? ctx.get("origin") : "", credentials: false, allowMethods: ["GET","POST",
"PATCH","DELETE"], allowHeaders: ["Content-Type","Authorization"] })`.
      It must sit before auth: a browser preflight carries no credentials, and
      `@koa/cors` answers `OPTIONS` itself without calling `next()`.
   6. **Basic auth** — `if (!checkBasicAuth(ctx.get("authorization"),
opts.apiKey))` then `ctx.set("WWW-Authenticate", BASIC_CHALLENGE)` and throw
      an `HttpFailure` built from `TRANSPORT_ERRORS.unauthenticated`. Runs before
      routing, so an unknown path without credentials is `401`, not `404`.
   7. **unsafe-method gate**, two rules with different method sets:
      - media type — for `POST`, `PUT`, `PATCH` ONLY: `ctx.request.type` (the
        media type with parameters stripped) must be `application/json`, else
        `unsupported_media_type`. `DELETE` is exempt: it carries no body.
      - `Origin` — for `POST`, `PUT`, `PATCH` and `DELETE`: when the header is
        present it must satisfy `isAllowedOrigin`, else `origin_not_allowed`.
        `DELETE` is as CSRF-exposed as the rest, so it keeps this check.
   8. **`@koa/bodyparser`** — `bodyParser({ enableTypes: ["json"], jsonLimit:
"1mb" })`. Its `400` / `413` throws are mapped by the boundary
      (Story 02, branch 3).
   9. **dispatch** — `matchRoute(routes, ctx.method, ctx.path)`:
      - `not_found` → throw `HttpFailure` from `TRANSPORT_ERRORS.unknown_route`.
      - `method_not_allowed` → `ctx.set("Allow", allow.join(", "))` then throw
        `HttpFailure` from `TRANSPORT_ERRORS.method_not_allowed`.
      - `match` → `const input = route.decode({ params, query: ctx.query, body:
ctx.request.body })`; `const result = await route.run(deps, input)`;
        then:
        - `successStatus === 204` → `ctx.status = 204; ctx.body = null;` (no
          `present`, no body, no `Content-Type`).
        - `kind === "html"` → `ctx.status = route.successStatus; ctx.type =
"text/html; charset=utf-8"; ctx.body = route.present!(result) as string;`
        - `kind === "json"` → `ctx.status = route.successStatus; ctx.body =
dataEnvelope(route.present!(result));`

   Export the two method-set predicates the gate uses, so the scopes are unit
   testable without a route per method (the middleware must call these, not
   inline the method lists):

   ```ts
   /** true for POST, PUT, PATCH — the methods that carry a JSON body. */
   export function requiresJsonContentType(method: string): boolean;

   /** true for POST, PUT, PATCH, DELETE — every unsafe method. */
   export function requiresOriginCheck(method: string): boolean;
   ```

   Both upper-case their argument before comparing.

   Also export the origin predicate so tests and the CORS option share one rule:

   ```ts
   /** true for http://127.0.0.1[:port] and http://localhost[:port] only. */
   export function isAllowedOrigin(origin: string | undefined): boolean;
   ```

   It parses with `new URL(origin)` inside a `try`, requires `protocol === "http:"`
   and `hostname` ∈ `{127.0.0.1, localhost}`, any port, and returns `false` for
   `undefined`, `""` or an unparsable value. **The port is deliberately not
   checked**, because `--port 0` means the bound port is unknown when the app is
   built.

2. **New file `src/apps/http/server.ts`**:

   ```ts
   export interface StartedHttpServer {
     readonly port: number;
     /** The bound address, so a test can prove the loopback bind directly. */
     readonly address: string;
     close(): Promise<void>;
   }

   /** Bind the app to 127.0.0.1. Registers NO process signal handlers. */
   export async function startHttpServer(
     app: Koa,
     opts: { readonly port: number; readonly logger: HttpLogger },
   ): Promise<StartedHttpServer>;
   ```

   It calls `app.listen(opts.port, "127.0.0.1")`, resolves on the `listening`
   event with the port read from `server.address()`, logs exactly
   `opts.logger.info("listening", { port, address: "127.0.0.1" })`, rejects on an
   `error` event before `listening`, and `close()` wraps `server.close` in a
   promise. Signal handling belongs to the CLI leaf (Story 07).

## Constraints

- `buildHttpApp` reads no environment variable and no file.
- No response may carry a CORS header for a disallowed origin, and no response
  may ever carry `Access-Control-Allow-Credentials`.
- The `500` path never forwards the original error message; that is `mapError`'s
  job and must not be bypassed.
- Do not add a router package. `matchRoute` is the only dispatcher.
- The middleware order above is binding. A reordering that puts the boundary
  anywhere but first is a defect even if the tests happen to pass.

## Verify

- New test `src/apps/http/app.test.ts` (`node --test src/apps/http/app.test.ts`),
  using `supertest(buildHttpApp(deps, opts).callback())` — no real socket needed.
  Shared fixtures: `KEY = "0123456789abcdef0123456789abcdef"`, `AUTH = "Basic " +
Buffer.from("kanthord:" + KEY).toString("base64")`, a capture logger
  `{ lines: [], info(m,f){…}, warn(){}, error(m,f){…} }` as `deps.logger`, and
  `newRequestId: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV"`.
  - **happy path:** `GET /healthz` with `AUTH` → `200`, body deep-equals
    `{ data: { status: "ok", version: packageVersion } }`,
    `content-type` starts `application/json`.
  - **auth:** no header → `401`, `www-authenticate` exactly
    `Basic realm="kanthord"`, body
    `{ error: { code: "unauthenticated", message: <string>, requestId:
"01ARZ3NDEKTSV4RRFFQ69G5FAV" } }`. Wrong key → `401`. Lower-case `basic`
    scheme → `200`.
  - **auth precedes routing:** `GET /nope` with no header → `401` (not `404`).
  - **no handler leak:** with an injected route whose `run` increments a counter,
    an unauthenticated request leaves the counter at `0`.
  - **routing:** `GET /nope` with `AUTH` → `404` code `unknown_route`;
    `POST /healthz` with `AUTH` and `Content-Type: application/json` → `405`,
    header `allow` exactly `GET`, code `method_not_allowed`.
  - **host:** `Host: evil.example` → `403` code `host_not_allowed`;
    `Host: localhost:4100` → `200`; `Host: 127.0.0.1:4100` → `200`.
  - **CORS:** `GET /healthz` with `Origin: http://127.0.0.1:4100` →
    `access-control-allow-origin` equals that origin;
    with `Origin: https://evil.example` → no `access-control-allow-origin`
    header; no response has `access-control-allow-credentials`;
    `OPTIONS /healthz` with `Origin: http://localhost:5173` and
    `Access-Control-Request-Method: GET` and NO `Authorization` header →
    status `204` or `200` (a preflight is never `401`).
  - **unsafe-method gates**, driven through an injected route
    `{ id: "test.post", method: "POST", path: "/api/test", successStatus: 200,
kind: "json", cliCommands: [], decode: (i) => i.body, run: async (_d, i) => i,
present: (r) => ({ echo: (r as { echo?: unknown }).echo ?? null }) }`:
    - `Content-Type: text/plain` → `415` code `unsupported_media_type`.
    - valid JSON body → `200` and the echoed field.
    - invalid JSON (`send("{")` with a JSON content type) → `400` code
      `malformed_body`, and the response text contains none of the sent bytes.
    - a body over 1 MiB (`JSON.stringify({ echo: "x".repeat(1_200_000) })`) →
      `413` code `body_too_large`.
    - `Origin: https://evil.example` with a valid JSON body → `403` code
      `origin_not_allowed`.
    - `Origin: http://127.0.0.1:9999` with a valid JSON body → `200`.
  - **the gates' method scopes**, driven through a second injected route
    `{ id: "test.delete", method: "DELETE", path: "/api/test", successStatus: 204,
kind: "json", cliCommands: [], decode: () => ({}), run: async () => undefined }`
    (no `present`, per the `204` rule):
    - `DELETE /api/test` with `AUTH` and NO `Content-Type` header → `204` with an
      empty body. The media-type gate must NOT apply to `DELETE`.
    - the same `DELETE` with `Origin: https://evil.example` → `403` code
      `origin_not_allowed`. The `Origin` gate DOES apply to `DELETE`.
    - the same `DELETE` with `Origin: http://localhost:5173` → `204`.
  - **method sets asserted directly** (no `PUT` row exists and none may be added —
    `PUT` is a non-goal), over the two exported predicates:
    - `requiresJsonContentType`: `true` for `POST`, `PUT`, `PATCH`; `false` for
      `DELETE`, `GET`, `HEAD`, `OPTIONS`. Lower-case input (`"post"`) behaves the
      same.
    - `requiresOriginCheck`: `true` for `POST`, `PUT`, `PATCH`, `DELETE`; `false`
      for `GET`, `HEAD`, `OPTIONS`.
  - **`204` row:** an injected route with `successStatus: 204`, no `present` →
    status `204`, `res.text` is `""`, and no `content-type` header.
  - **`500` catch-all:** an injected route whose `run` throws `new Error("boom")`
    → `500`, body `{ error: { code: "internal", message: "internal error",
requestId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" } }`; `"boom"` does not appear in
    `res.text`; the capture logger recorded exactly one `error` call carrying that
    same `requestId`.
  - **boundary is outermost:** build the app with
    `newRequestId: () => { throw new Error("id boom"); }` — middleware 2, i.e. the
    earliest step after the boundary and long before routing. `GET /healthz` with
    `AUTH` → `500`, the body parses as JSON with `error.code === "internal"`, and
    `res.text` is neither `"Internal Server Error"` (koa's default) nor contains
    `"id boom"`. A boundary registered anywhere but first fails this test.
    (`requestId` is absent from `ctx.state` in this path, so the envelope's
    `requestId` must be the empty string rather than throwing again — implement
    the catch as `ctx.state.requestId ?? ""`.)
  - **redaction:** after running the happy path plus the `401` case, the joined
    capture-logger output contains neither `KEY` nor the string `authorization`.
  - **`buildHttpApp` refuses a bad key:** `assert.throws(() => buildHttpApp(deps,
{ apiKey: "" }), MissingApiKeyError)` and the same for a 15-character key.
    There is no `process.env` fallback: with `process.env["API_KEY"]` set to a
    valid key in the test and `apiKey: ""` passed, it still throws.
- New test `src/apps/http/server.test.ts`:
  - `startHttpServer(app, { port: 0, logger })` resolves with a `port > 0`, the
    capture logger has one `listening` line whose fields are
    `{ port, address: "127.0.0.1" }`, and a real `fetch` to
    `http://127.0.0.1:<port>/healthz` with `AUTH` returns `200`.
  - the returned `address` equals `"127.0.0.1"` — the direct assertion that
    catches a `0.0.0.0` bind, which a loopback request cannot catch.
  - `close()` resolves and a subsequent `fetch` to the same port rejects.
  - start + close twice: `process.listenerCount("SIGTERM")` and
    `process.listenerCount("SIGINT")` are unchanged from before the first start.
- `npm run verify` exits 0.
- Proof: delivers phases C, E, F (over-the-wire status/header/envelope
  assertions) and the `listening` line phase A parses.
