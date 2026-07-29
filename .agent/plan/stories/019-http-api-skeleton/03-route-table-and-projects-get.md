# Story 03 — the route table, the decoder, and the `projects.get` row

Epic: `.agent/plan/epics/019-http-api-skeleton.md`
Depends on: Story 02 (`error-registry.ts` registers `InvalidInputError` from
this story's `decode.ts`).

## Change

### New file `src/apps/http/deps.ts`

```ts
import type { CliDeps } from "../cli/deps.ts";
import type { JwtClaims } from "./jwt.ts";

export interface SessionService {
  /** The raw key-file credential a client must present to POST /api/sessions. */
  readonly pairing: string;
  /** Mints a 12h session. */
  create(): { token: string; csrf: string; expiresAt: string; jti: string };
  /** Verifies a token and rejects a revoked jti. Throws JwtInvalidError. */
  verify(token: string): JwtClaims;
  revoke(jti: string): void;
}

export type HttpDeps = CliDeps & { session: SessionService };
```

`CliDeps` has `[key: string]: unknown` (`src/apps/cli/deps.ts:168`), so the
intersection is assignable from a `{} as unknown as CliDeps` double plus a
`session` field.

### New file `src/apps/http/decode.ts`

```ts
export class InvalidInputError extends Error {
  readonly field: string;
  constructor(field: string, detail: string);
  // name = "InvalidInputError", message = `invalid input for ${field}: ${detail}`
}

export interface RouteContext {
  readonly params: Record<string, string | undefined>;
  readonly searchParams: Record<string, string>;
  readonly body: unknown; // parsed JSON, or undefined when there was no body
}

export function requirePathParam(ctx: RouteContext, name: string): string;
export function requireBodyString(ctx: RouteContext, name: string): string;
export function optionalQueryString(
  ctx: RouteContext,
  name: string,
): string | undefined;
export function optionalQueryInt(
  ctx: RouteContext,
  name: string,
  min: number,
  max: number,
): number | undefined;
export function optionalQueryStringArray(
  ctx: RouteContext,
  name: string,
): string[] | undefined;
```

Pinned behaviour:

- `requirePathParam` — missing, `""`, or blank after `.trim()` throws
  `InvalidInputError(name, "required")`. The trim rule is load-bearing: a URL of
  `/api/projects/%20` decodes to a single space, which must be a 400
  `invalid_input` and never reach the use case as an id.
- `requireBodyString` — `ctx.body` must be a non-null non-array object and
  `body[name]` a non-empty string, else `InvalidInputError(name, "required")`.
- `optionalQueryInt` — absent returns `undefined`; a value that is not
  `/^-?\d+$/` throws `InvalidInputError(name, "must be an integer")`; out of
  `[min, max]` throws `InvalidInputError(name, \`must be between ${min} and ${max}\`)`.
- `optionalQueryStringArray` — `find-my-way`'s `searchParams` collapses repeats
  into a single value, so **the array form is a comma-separated list**:
  `?ac=a,b` → `["a", "b"]`. Empty segments are dropped; an all-empty value throws
  `InvalidInputError(name, "must not be empty")`. Binding: this is the one
  repeatable-flag encoding for the whole API; no `?x=1&x=2` handling exists.
- Every thrown error is `InvalidInputError`, so Story 02's registry answers 400
  `invalid_input`.

### New file `src/apps/http/views/project.ts`

```ts
export interface ProjectView {
  readonly id: string;
  readonly name: string;
}

/** Explicit field-by-field construction — never a spread. */
export function projectView(project: {
  id: string;
  name: string;
}): ProjectView {
  return { id: project.id, name: project.name };
}
```

Binding: exactly two fields. The parameter is **structural**, not the domain
`Project` type — `apps/http` may not import `src/domain/**`. Do not add
`projectId`; a root project has none, and the Proof compares this body with
`kanthord get project --json`, which emits `{"id":…,"name":…}`
(`src/apps/cli/get.ts:19-21`).

### New file `src/apps/http/routes.ts`

```ts
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type RouteAuth = "required" | "pairing" | "none";
export type SuccessStatus = 200 | 201 | 204;

export interface Route {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly auth: RouteAuth;
  readonly successStatus: SuccessStatus;
  /** The CLI leaf this row covers, e.g. "get project"; "none" for HTTP-only rows. */
  readonly cliCommand: string;
  decode(ctx: RouteContext): unknown;
  run(deps: HttpDeps, input: unknown): Promise<unknown>;
  present?(result: unknown): unknown;
  headers?(result: unknown): Record<string, string>;
}

/** Type-safe row builder; erases I/R so ROUTES stays a homogeneous array. */
export function defineRoute<I, R>(spec: {
  id: string;
  method: HttpMethod;
  path: string;
  auth: RouteAuth;
  successStatus: SuccessStatus;
  cliCommand: string;
  decode(ctx: RouteContext): I;
  run(deps: HttpDeps, input: I): Promise<R>;
  present?(result: R): unknown;
  headers?(result: R): Record<string, string>;
}): Route;

export const ROUTES: readonly Route[];
```

`defineRoute` casts the erased callbacks once, inside itself
(`decode: (ctx) => spec.decode(ctx)`,
`run: (deps, input) => spec.run(deps, input as I)`, and the same for
`present`/`headers`). No call site casts.

**The four rows of 019, in this order:**

| id                | method | path                    | auth       | status | cliCommand    |
| ----------------- | ------ | ----------------------- | ---------- | ------ | ------------- |
| `health.get`      | GET    | `/api/health`           | `none`     | 200    | `none`        |
| `sessions.create` | POST   | `/api/sessions`         | `pairing`  | 201    | `none`        |
| `sessions.delete` | DELETE | `/api/sessions/current` | `required` | 204    | `none`        |
| `projects.get`    | GET    | `/api/projects/:id`     | `required` | 200    | `get project` |

- `health.get` — `decode` returns `{}`; `run` returns `{ status: "ok" }`;
  `present` returns it unchanged.
- `sessions.create` — `decode` returns `{}`; `run` returns
  `deps.session.create()`; `present` returns
  `{ token, csrf, expiresAt }` (an explicit literal — `jti` must NOT be exposed);
  `headers` returns
  `{ Location: "/api/sessions/current", "Set-Cookie": \`kanthord_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200\` }`.
- `sessions.delete` — the caller's `jti` reaches `run` through `ctx.claims`, which
  the server sets after authentication. `decode` returns
  `{ jti: ctx.claims?.jti ?? "" }`; `run` calls `deps.session.revoke(input.jti)`
  and returns `undefined`; no `present` (status is 204).
  `headers` returns
  `{ "Set-Cookie": "kanthord_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" }`.
- `projects.get` — `decode` returns `{ id: requirePathParam(ctx, "id") }`;
  `run` is `(deps, input) => deps.getProject.execute(input)`; `present` is
  `projectView`.

Add `readonly claims?: JwtClaims` to `RouteContext` in `decode.ts` as part of
this story, so Story 04 does not change the type.

## Constraints

- `ROUTES` is the only export that registers a route. No route is created
  anywhere else.
- A row with `successStatus: 204` must not declare `present`. A row with
  `successStatus: 201` must declare `headers` returning a `Location`.
- No path segment may be a CLI verb (see Story 06's banned list) — the four paths
  above already comply.
- `run` never touches `req`/`res`; it receives only decoded input.

## Verify

New test file `src/apps/http/routes.test.ts`, `describe("src/apps/http/routes.ts")`:

- **Policy test, iterating `ROUTES`** — for every row: `id` non-empty; `method` in
  the four; `path` starts with `/api/`; `auth` in the three; `successStatus` in
  `{200,201,204}`; `cliCommand` non-empty; `decode` and `run` are functions;
  `present` is a function unless `successStatus === 204`, and is `undefined` when
  it is; `headers` is a function whenever `successStatus === 201`.
- **Uniqueness** — `id` values are unique; `` `${method} ${path}` `` pairs are unique.
- **REST shape, iterating `ROUTES`** — no static path segment (a segment not
  starting with `:`) equals any entry of the banned verb list from Story 06.
- **201 declares a Location** — for every `successStatus === 201` row,
  `row.headers!(<a stub result>)` contains a `Location` key.
- **`sessions.create` present drops `jti`** — given
  `{ token: "t", csrf: "c", expiresAt: "e", jti: "j" }`, the presented object
  deep-equals `{ token: "t", csrf: "c", expiresAt: "e" }`.
- **`projects.get` contract test** —
  `row.decode({ params: { id: "p1" }, searchParams: {}, body: undefined })`
  deep-equals `{ id: "p1" }`; the same call with `params: {}` throws
  `InvalidInputError`; `row.run(deps, { id: "p1" })` calls
  `deps.getProject.execute` **once** with exactly `{ id: "p1" }` (capture the
  input in a `let received: unknown` and `assert.deepEqual`); `row.present!({ id: "p1", name: "alpha", extra: "leak" })`
  deep-equals `{ id: "p1", name: "alpha" }`.

New test file `src/apps/http/decode.test.ts`:

- `requirePathParam` — present returns the value; missing, `""`, and `" "` all
  throw `InvalidInputError` with `field === "id"`.
- `requireBodyString` — object with the key returns it; `undefined` body, an
  array body, a `null` body, a missing key and an empty string each throw.
- `optionalQueryInt` — `undefined` when absent; `"5"` → `5`; `"x"` throws;
  `"-1"` with `min 0` throws; boundary values `min` and `max` are accepted.
- `optionalQueryStringArray` — `"a,b"` → `["a","b"]`; `"a"` → `["a"]`;
  `"a,,b"` → `["a","b"]`; `","` throws; absent → `undefined`.

New test file `src/apps/http/views/project.test.ts`:

- `Object.keys(projectView({ id: "p", name: "n" }))` deep-equals `["id","name"]`.
- Given an object with extra fields, the result has exactly those two keys — the
  regression guard for "never spread".

Commands:

- `node --test src/apps/http/routes.test.ts src/apps/http/decode.test.ts src/apps/http/views/project.test.ts` exits 0.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-api-proof.sh` phase D (the `GET /api/projects/:id`
  body matching the CLI) and the `Location` / `Set-Cookie` assertions in phase C.
