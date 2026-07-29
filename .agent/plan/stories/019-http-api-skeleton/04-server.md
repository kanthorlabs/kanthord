# Story 04 — the server: `buildServer` and the middleware chain

Epic: `.agent/plan/epics/019-http-api-skeleton.md`
Depends on: Stories 01, 02, 03.

## Change

### New file `src/apps/http/session.ts`

```ts
import { randomBytes } from "node:crypto";
import { signJwt, verifyJwt, JwtInvalidError } from "./jwt.ts";
import type { JwtClaims } from "./jwt.ts";
import type { HttpKey } from "./key.ts";
import type { SessionService } from "./deps.ts";

export const SESSION_TTL_SECONDS = 43200; // 12h

export function buildSessionService(
  key: HttpKey,
  now: () => number = () => Date.now(),
): SessionService;
```

Pinned behaviour:

- `create()` — `iat = Math.floor(now() / 1000)`, `exp = iat + SESSION_TTL_SECONDS`,
  `jti = randomBytes(16).toString("hex")`, `csrf = randomBytes(32).toString("hex")`,
  `sub = "local"`. Returns
  `{ token: signJwt(claims, key.jwtSecret), csrf, expiresAt: new Date(exp * 1000).toISOString(), jti }`.
- `verify(token)` — `verifyJwt(token, key.jwtSecret, Math.floor(now() / 1000))`,
  then throws `new JwtInvalidError("revoked")` if the `jti` is in the revoked set.
- `revoke(jti)` — adds to a module-private `Set<string>` held in the closure.
  **Binding: revocation is in-memory and process-scoped.** A restart clears it;
  that is accepted because tokens expire in 12h and deleting the key file
  invalidates every token.
- `pairing` is `key.pairing`.
- `now` is injectable so tests can drive expiry without sleeping.

### New file `src/apps/http/server.ts`

```ts
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import Router from "find-my-way";
// … routes, envelope, error-registry, decode, session, key, deps
export interface ServeOptions {
  port: number;
  keyPath: string;
  /** Defaults to a ULID-shaped id via `ulid`; injectable for tests. */
  newRequestId?: () => string;
  /** Defaults to a no-op; the CLI passes a pino child logger. */
  logError?: (requestId: string, err: unknown) => void;
}

export interface RunningServer {
  readonly port: number;
  /** The bound address, read from `server.address()`. Always "127.0.0.1". */
  readonly address: string;
  close(): Promise<void>;
}

export function buildServer(
  deps: CliDeps,
  opts: ServeOptions,
): Promise<RunningServer>;
```

`buildServer`:

1. `const key = loadOrCreateKey(opts.keyPath);` — a `KeyPermissionsError` here
   rejects the returned promise (the CLI turns it into exit 1).
2. `const session = buildSessionService(key);`
   `const httpDeps: HttpDeps = { ...deps, session };` — **binding: build the
   intersection by spread once, here.** No other module composes `HttpDeps`.
3. Build the router: `Router({ ignoreTrailingSlash: true, caseSensitive: true })`,
   then `for (const route of ROUTES) router.on(route.method, route.path, () => {})`
   — the handler argument is a required but unused placeholder, because dispatch
   uses `router.find(...)` and reads `store`. Register each row with its `Route`
   as the `store` argument (`router.on(method, path, noop, route)`), so
   `find(...).store` is the row.
4. `createServer((req, res) => { void handle(req, res); })`, then
   `server.listen(opts.port, "127.0.0.1", cb)` wrapped in a `Promise<number>`
   resolving the port from `server.address()` guarded by
   `typeof addr === "object" && addr !== null` (mirror
   `src/agent-runner/pi-session.custom.test.ts:205-211`).
   **Binding: the host argument is the literal `"127.0.0.1"`.** Never `0.0.0.0`,
   never `opts.host`.
5. `close()` returns a promise that resolves on `server.close(cb)`.

### The middleware chain — this exact order, in one `handle` function

Any step that fails throws the matching transport error from
`error-registry.ts`; a single `try/catch` around the whole chain converts a
thrown error into a response via `lookupError`.

1. **Host.** `req.headers.host` must equal `127.0.0.1:<port>` or
   `localhost:<port>`; otherwise `HostNotAllowedError`. A missing `Host` header is
   rejected too.
2. **Method.** `req.method` must be one of `GET`/`POST`/`PATCH`/`DELETE`;
   otherwise `MethodNotAllowedError` with `allow: []` (no `Allow` header emitted
   when the list is empty).
3. **Body.** For every method, read the request stream, accumulating into a
   `Buffer[]` and a running byte count; the moment the count exceeds
   `1_048_576`, throw `BodyTooLargeError` and `req.destroy()`. Result is a string,
   `""` when there was no body.
4. **Media type.** When the raw body is non-empty, the `content-type` header's
   value before any `;` must be exactly `application/json`; otherwise
   `UnsupportedMediaTypeError`. **A method with no body is never media-checked**
   (`DELETE /api/sessions/current` sends none).
5. **Origin.** When the method is not `GET` and an `origin` header is present, it
   must equal `http://127.0.0.1:<port>` or `http://localhost:<port>`; otherwise
   `OriginNotAllowedError`. An absent `Origin` is allowed (non-browser clients).
6. **Route match.** `const url = new URL(req.url ?? "/", "http://127.0.0.1");`
   then `router.find(req.method, url.pathname)`. On `null`: if any other method in
   the four has a route for that pathname (`router.hasRoute(m, pathname)`), throw
   `MethodNotAllowedError` with `allow` = those methods sorted alphabetically;
   otherwise `UnknownRouteError`.
7. **Auth.** From `route.auth`:
   - `"none"` — skip.
   - `"pairing"` — the `authorization` header must be `Bearer <session.pairing>`,
     compared with `crypto.timingSafeEqual` over equal-length buffers (length
     mismatch fails without calling it); otherwise `UnauthenticatedError`.
   - `"required"` — take the token from `authorization: Bearer <t>` if present,
     else from the `kanthord_session` cookie parsed out of the `cookie` header;
     no token, or `session.verify` throwing `JwtInvalidError`, is
     `UnauthenticatedError`. On success keep the claims for step 8 and for
     `ctx.claims`.
     **Binding: the use case must not run when auth fails** — step 7 precedes step
   10.
8. **CSRF.** When the method is not `GET` **and** `route.auth === "required"`, the
   `x-kanthord-csrf` header must equal the verified token's `csrf` claim;
   otherwise `CsrfFailedError`. A `pairing` row is exempt
   (`POST /api/sessions` authenticates with a credential a page cannot read).
9. **Body parse.** When the raw body is non-empty, `JSON.parse` it; a throw
   becomes `MalformedBodyError`. Empty body → `body: undefined`.
10. **Decode → run → present.** Build
    `ctx: RouteContext = { params: found.params, searchParams: found.searchParams, body, ...(claims ? { claims } : {}) }`,
    then `route.decode(ctx)`, then `await route.run(httpDeps, input)`.
11. **Respond.** `route.successStatus === 204` → `res.writeHead(204, headers)` with
    **no `Content-Type` and no body**, then `res.end()`. Otherwise
    `res.writeHead(route.successStatus, { "Content-Type": "application/json", ...headers })`
    and `res.end(okBody(route.present!(result)))`, where `headers` is
    `route.headers?.(result) ?? {}`.

### Error responses

- `lookupError(err)` hit → `res.writeHead(status, { "Content-Type": "application/json", ...(err instanceof MethodNotAllowedError && err.allow.length > 0 ? { Allow: err.allow.join(", ") } : {}) })`
  and `errorBody(code, err.message)`.
- `lookupError` miss → `requestId = (opts.newRequestId ?? ulid)()`;
  `opts.logError?.(requestId, err)` exactly once; respond `500` with
  `errorBody("internal", "internal error", requestId)`. **Binding: the original
  message must not appear in the response bytes.**
- **No response ever carries a CORS header.** Do not set
  `Access-Control-Allow-Origin` anywhere, and do not handle `OPTIONS` (it falls to
  step 2's `MethodNotAllowedError`).

## Constraints

- `src/apps/http/server.ts` may import `src/app/**`, anything under
  `src/apps/**`, and node builtins — **never `src/domain/**` and never a
  `*/port.ts`** (eslint `boundaries`, verified).
- `ulid` is already a dependency (`package.json`); import it as
  `import { ulid } from "ulid";`.
- No route logic in this file: it dispatches, it does not decide status per
  resource. The only statuses it originates are the transport errors and
  `route.successStatus`.
- Never log the pairing credential, a token, or a `Set-Cookie` value.

## Verify

New test file `src/apps/http/server.test.ts`,
`describe("src/apps/http/server.ts")`. Shape for every test: a
`mkdtempSync(join(tmpdir(), "kanthord-019-server-"))` key path, a deps double
(`{ getProject: { execute: async (i: unknown) => … } } as unknown as CliDeps`),
`const s = await buildServer(deps, { port: 0, keyPath });`, requests via global
`fetch` against `` `http://127.0.0.1:${s.port}` ``, and
`finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }`.

Assertions required:

- **Bind address.** `s.address === "127.0.0.1"` — asserted directly from the
  value `buildServer` read out of `server.address()`. This is the guard against a
  `0.0.0.0` bind, which a loopback request would not catch.
- **Health.** `GET /api/health` → 200, body `{"data":{"status":"ok"}}`, no
  `access-control-allow-origin` response header, and it works with no
  credential.
- **Auth gate does not run the use case.** `GET /api/projects/p1` with no
  credential → 401 `unauthenticated`, and the `getProject.execute` spy recorded
  **zero** calls.
- **Session lifecycle.** `POST /api/sessions` with
  `Authorization: Bearer <raw key file content>` → 201, `location` header
  `/api/sessions/current`, `set-cookie` containing `HttpOnly` and
  `SameSite=Strict`, body carrying `token`/`csrf`/`expiresAt` and **not** `jti`.
  A wrong credential → 401. A missing `Authorization` → 401.
- **Read by both credentials.** With the token as a bearer, and again as a
  `Cookie: kanthord_session=<token>`, `GET /api/projects/p1` → 200 with
  byte-identical bodies.
- **204 shape.** `DELETE /api/sessions/current` with the CSRF header → 204, the
  response text is `""`, and `res.headers.get("content-type")` is `null`.
  Afterwards the same token on `GET /api/projects/p1` → 401 (revoked).
- **CSRF.** `DELETE /api/sessions/current` without `X-Kanthord-Csrf` → 403
  `csrf_failed`; with a wrong value → 403; `POST /api/sessions` with no CSRF
  header → 201 (the pairing exemption).
- **405 + Allow.** `DELETE /api/projects/p1` → 405 `method_not_allowed` with
  `allow: "GET"`. `PUT /api/health` → 405 (unsupported method, step 2) with no
  `allow` header.
- **404s.** `GET /api/nope` → 404 `unknown_route`. A `getProject.execute` that
  throws `new UnknownReferenceError("project", "p1")` → 404 `unknown_reference`.
- **Catch-all.** A `getProject.execute` that throws `new Error("boom")` → 500,
  body code `internal`, message `internal error`, a non-empty `requestId`, the
  string `boom` absent from the whole response text, and `logError` called
  exactly once with that same `requestId`.
- **Malformed / media / size.** `POST /api/sessions` with body `"not json"` and
  `Content-Type: application/json` → 400 `malformed_body`; with
  `Content-Type: text/plain` → 415 `unsupported_media_type`; with a
  1 MiB + 1 byte body → 413 `body_too_large`.
- **Host.** Any request with `Host: evil.example` → 403 `host_not_allowed`,
  including `GET /api/health` (step 1 precedes everything).
- **Origin.** `DELETE /api/sessions/current` with a valid token + CSRF and
  `Origin: http://evil.example` → 403 `origin_not_allowed`; the same request with
  `Origin: http://127.0.0.1:<port>` → 204; a `GET` with a foreign `Origin` → 200
  (only unsafe methods are checked).
- **Decode error.** A registry row is not needed: assert
  `GET /api/projects/` (empty id, which `ignoreTrailingSlash` maps to
  `/api/projects`) → 404 `unknown_route`, and that a request to
  `/api/projects/%20` (a blank id) → 400 `invalid_input`.
- **Key permissions.** With a pre-created key file at mode `0o644`,
  `buildServer` rejects; assert with `assert.rejects(…, { name: "KeyPermissionsError" })`.
- **close().** After `await s.close()`, a `fetch` to the same port rejects.

New test file `src/apps/http/session.test.ts`:

- `create()` returns a token that `verify` accepts, with `csrf` 64 hex chars and
  `expiresAt` an ISO string 43200s after `now`.
- `revoke(jti)` makes `verify` throw `JwtInvalidError` with reason `revoked`,
  while a second session's token still verifies.
- With an injected `now` advanced past `SESSION_TTL_SECONDS`, `verify` throws
  reason `expired`.

Commands:

- `node --test src/apps/http/server.test.ts src/apps/http/session.test.ts` exits 0.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-api-proof.sh` phases B, C, D, E, F, G.
