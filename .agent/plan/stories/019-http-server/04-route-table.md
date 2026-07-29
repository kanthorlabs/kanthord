# Story 04 — route table, matcher, decode helpers, the `health.get` row

Epic: `.agent/plan/epics/019-http-server.md` (bullet S3)
Depends on: Story 03 (`HttpLogger`).

## Change

1. **New file `src/apps/http/deps.ts`**:

   ```ts
   import type { HttpLogger } from "./logger.ts";

   /**
    * What the HTTP routes need. One field per capability, added by the epic that
    * adds the route using it. Not CliDeps, not a god bag.
    */
   export interface HttpDeps {
     readonly logger: HttpLogger;
   }
   ```

2. **New file `src/apps/http/routes.ts`** — the contract. Exact types:

   ```ts
   export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

   /** Raw request material handed to a row's `decode`. */
   export interface RouteInput {
     readonly params: Readonly<Record<string, string>>;
     /** Koa's ctx.query shape: a value may be absent. */
     readonly query: Readonly<Record<string, string | string[] | undefined>>;
     readonly body: unknown;
   }

   export interface Route {
     /** Stable key the UI codes against, e.g. "health.get". */
     readonly id: string;
     readonly method: HttpMethod;
     readonly path: string;
     readonly successStatus: 200 | 201 | 204;
     /** "json" → envelope; "html" → `present` returns the document body. */
     readonly kind: "json" | "html";
     /** CLI leaf paths this row covers, e.g. ["get project"]. May be empty. */
     readonly cliCommands: readonly string[];
     readonly decode: (input: RouteInput) => unknown;
     readonly run: (deps: HttpDeps, input: unknown) => Promise<unknown>;
     readonly present?: (result: unknown) => unknown;
   }

   export const ROUTES: readonly Route[];
   ```

   `ROUTES` holds exactly one row in this story:

   ```ts
   {
     id: "health.get",
     method: "GET",
     path: "/healthz",
     successStatus: 200,
     kind: "json",
     cliCommands: [],
     decode: () => ({}),
     run: async () => ({ status: "ok" as const, version: packageVersion }),
     present: (result) => healthView(result as HealthResult),
   }
   ```

   `packageVersion` comes from `../version.ts` (Story 01).

3. **New file `src/apps/http/views/health.ts`** — an explicit DTO, no spread:

   ```ts
   export interface HealthResult {
     readonly status: "ok";
     readonly version: string;
   }

   export interface HealthView {
     readonly status: "ok";
     readonly version: string;
   }

   export function healthView(result: HealthResult): HealthView {
     return { status: result.status, version: result.version };
   }
   ```

4. **New file `src/apps/http/router.ts`** — the hand-rolled matcher:

   ```ts
   export type MatchOutcome =
     | {
         readonly kind: "match";
         readonly route: Route;
         readonly params: Record<string, string>;
       }
     | {
         readonly kind: "method_not_allowed";
         readonly allow: readonly string[];
       }
     | { readonly kind: "not_found" };

   export function matchRoute(
     routes: readonly Route[],
     method: string,
     path: string,
   ): MatchOutcome;
   ```

   Fixed rules:
   - Normalise: strip exactly one trailing `/` unless the path IS `/`. Split on
     `/` and drop the leading empty segment.
   - A route path matches when segment counts are equal, every literal segment is
     byte-equal (case-sensitive), and every `:name` segment captures
     `decodeURIComponent(segment)` under key `name`.
   - Collect all path-matching routes in `ROUTES` array order. If none →
     `not_found`.
   - Among them, the first whose `method` equals the request method (upper-cased)
     → `match`. If none → `method_not_allowed` with `allow` = the path-matching
     routes' methods, de-duplicated, sorted ascending (lexicographic), so the
     `Allow` header is deterministic.
   - On a `:param` collision between two rows, the earlier row in `ROUTES` wins.
     The policy test forbids duplicate `method`+`path`, so this only matters for
     literal-vs-param overlap.

5. **New file `src/apps/http/decode.ts`** — the shared decoding rules, all
   throwing `InvalidInputError` (`src/apps/http/errors.ts`, Story 02):

   ```ts
   export function requirePathParam(
     params: Readonly<Record<string, string>>,
     name: string,
   ): string;

   export function optionalQueryInt(
     query: Readonly<Record<string, string | string[] | undefined>>,
     name: string,
     bounds: { readonly min: number; readonly max: number },
   ): number | undefined;

   export function queryList(
     query: Readonly<Record<string, string | string[] | undefined>>,
     name: string,
   ): readonly string[];
   ```

   - `requirePathParam`: missing, `""`, or blank after `.trim()` →
     `InvalidInputError(name, …)`. Returns the trimmed value.
   - `optionalQueryInt`: absent → `undefined`; an array value → `InvalidInputError`;
     a value that is not an integer per `/^-?\d+$/` → `InvalidInputError`; outside
     `[bounds.min, bounds.max]` inclusive → `InvalidInputError`. Returns the
     number.
   - `queryList`: absent → `[]`; a string → split on `,`, `.trim()` each, drop
     empties; an array → the same per element, flattened in the given order.

## Constraints

- No koa import in this story. `routes.ts`, `router.ts`, `decode.ts` and
  `views/health.ts` are transport-agnostic and unit-testable without a server.
- `present` for a `json` row returns a DTO built field by field. A spread of a
  use-case result is forbidden — that is how a future secret leaks.
- `ROUTES` is a module-level `const` array. No function builds it, nothing
  mutates it, and nothing outside `routes.ts` adds a row.

## Verify

- New test `src/apps/http/routes.test.ts`
  (`node --test src/apps/http/routes.test.ts`) — both policy suites iterate
  `ROUTES` so they grow automatically:
  - policy: for every row — `id` non-empty and unique; `method` ∈
    `{GET, POST, PATCH, DELETE}` (`PUT` therefore rejected); `path` starts with
    `/`; `successStatus` ∈ `{200, 201, 204}`; `kind` ∈ `{json, html}`;
    `cliCommands` is an array of non-empty strings; `decode` and `run` are
    functions; `present` is a function unless `successStatus === 204`, and is
    `undefined` when it is; `kind === "html"` implies `successStatus === 200` and
    `present` present; every `method`+`path` pair unique.
  - REST shape: no static (non-`:param`) path segment, lower-cased, is in the
    banned verb list `["get","create","list","find","add","remove","approve",
"reject","land","publish","pause","resume","retry","abandon","assign",
"unassign","register","login","logout","update","rename","run","setup",
"ack","check","set-default"]`. Include a negative control asserting the same
    predicate REJECTS a synthetic row with path `/api/tasks/approve`.
  - the `health.get` row: `decode({params:{},query:{},body:undefined})` deep-equals
    `{}`; `await run(fakeDeps, {})` deep-equals `{ status: "ok", version:
packageVersion }`; `present(...)` key set is exactly `["status","version"]`.
- New test `src/apps/http/router.test.ts`:
  - `matchRoute(ROUTES, "GET", "/healthz")` → `kind: "match"`, route id
    `health.get`, `params` `{}`.
  - `"/healthz/"` matches too (one trailing slash stripped); `"/healthz//"` does
    NOT match.
  - `matchRoute(ROUTES, "POST", "/healthz")` → `method_not_allowed` with `allow`
    deep-equal `["GET"]`.
  - `matchRoute(ROUTES, "GET", "/nope")` → `not_found`;
    `matchRoute(ROUTES, "GET", "/healthz/extra")` → `not_found`;
    `matchRoute(ROUTES, "GET", "/HEALTHZ")` → `not_found` (case-sensitive).
  - with a synthetic table `[{…path:"/api/projects/:id", method:"GET"…},
{…path:"/api/projects/:id", method:"PATCH"…}]`: `GET` matches and captures
    `params.id`; `DELETE` → `method_not_allowed` with `allow` deep-equal
    `["GET","PATCH"]` (sorted); a percent-encoded segment `p%20x` decodes to
    `p x`; the method argument is upper-cased (`"get"` matches).
- New test `src/apps/http/decode.test.ts`:
  - `requirePathParam({ id: "x" }, "id")` → `"x"`; `{ id: " x " }` → `"x"`;
    `{}`, `{ id: "" }` and `{ id: " " }` each throw `InvalidInputError` whose
    `field` is `"id"`.
  - `optionalQueryInt({}, "limit", {min:1,max:100})` → `undefined`;
    `{limit:"10"}` → `10`; `{limit:"abc"}`, `{limit:"1.5"}`, `{limit:"0"}`,
    `{limit:"101"}` and `{limit:["1","2"]}` each throw `InvalidInputError` with
    `field === "limit"`.
  - `queryList({}, "ids")` → `[]`; `{ids:"a, b ,,c"}` → `["a","b","c"]`;
    `{ids:["a","b,c"]}` → `["a","b","c"]`.
- New test `src/apps/http/views/health.test.ts`: `healthView` output key set is
  exactly `["status","version"]` even when given an object carrying an extra
  field (cast through `as HealthResult`), proving it is not a spread.
- `npm run verify` exits 0.
- Proof: prerequisite for phases B and E (`/healthz` body, `404 unknown_route`,
  `405` + `Allow: GET`).
