# Story S1 — the write contract in dispatch: `location`, `readRow`, `ETag`, `428`/`412`

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decisions 1 and 3)

No row lands in this story. `ROUTES` still holds exactly 24 rows, all `GET`, so
`npm run verify` proves the refactor behaviour-preserving apart from the one
intended new response header (`ETag` on every `200` json response).

## Change

### 1. `src/apps/http/routes.ts:53-88` — two new fields on the row types

Append to `RouteDefinition<Input, Output>` after `present` (`:80`), keeping every
existing doc comment where it is:

```ts
  /**
   * Builds the `Location` header value for a create. Required iff
   * `successStatus === 201`, forbidden otherwise, and enforced by the
   * route-policy test exactly as `present` is. Never derived from `path`: two
   * rows point at a DIFFERENT resource than the one they posted to
   * (`project.credential.create` → `/api/resource/<id>`, `project.graph.create`
   * → `/api/initiative/<id>`), so string surgery on `path` would be wrong.
   */
  readonly location?: (result: Output) => string;
  /**
   * The `id` of the GET row that IS this item's representation. Required iff
   * `method === "PATCH"`, forbidden otherwise. The dispatcher runs that row's
   * `decode`/`run`/`present` over the SAME params to compute the `If-Match`
   * validator, then again after the write to answer `200` with the fresh DTO —
   * so a PATCH row declares no `present` of its own.
   */
  readonly readRow?: string;
```

Append the erased forms to `Route` (`:84-88`), after `present`:

```ts
  readonly location?: (result: unknown) => string;
  readonly readRow?: string;
```

### 2. `src/apps/http/etag.ts` (new)

```ts
// src/apps/http/etag.ts — the strong validator every 200 json response carries
// (EPIC 021 decision 3). No entity has a version column, so the validator is a
// hash of the PRESENTED DTO: both sides run the same view function with its
// literal field list, so key order is identical by construction and no
// canonicaliser is needed. Hashing the DTO (not the enveloped bytes) keeps the
// value stable across envelope changes.
import { createHash } from "node:crypto";

export function etagOf(dto: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(dto)).digest("hex");
  return `"${digest}"`;
}
```

### 3. `src/apps/http/error-registry.ts:39-90` — two transport codes

Insert into `TRANSPORT_ERRORS`, directly after `invalid_input` (`:80-84`):

```ts
  precondition_required: {
    code: "precondition_required",
    status: 428,
    message: "If-Match is required",
  },
  precondition_failed: {
    code: "precondition_failed",
    status: 412,
    message: "precondition failed",
  },
```

### 4. `src/apps/http/error-registry.test.ts:17-19` — allow `428`

```ts
const ALLOWED_STATUSES = new Set([
  400, 401, 403, 404, 405, 409, 412, 413, 415, 428, 500,
]);
```

### 5. `src/apps/http/app.ts:202-241` — the dispatcher

Add `import { etagOf } from "./etag.ts";` to the import block. Replace the whole
dispatch middleware body with:

```ts
// 9. dispatch
app.use(async (ctx) => {
  const outcome = matchRoute(routes, ctx.method, ctx.path);
  if (outcome.kind === "not_found") {
    const e = TRANSPORT_ERRORS.unknown_route;
    throw new HttpFailure(e.code, e.status, e.message);
  }
  if (outcome.kind === "method_not_allowed") {
    ctx.set("Allow", outcome.allow.join(", "));
    const e = TRANSPORT_ERRORS.method_not_allowed;
    throw new HttpFailure(e.code, e.status, e.message);
  }

  const route = outcome.route;
  const rawInput = {
    params: outcome.params,
    query: ctx.query,
    body: ctx.request.body,
  };

  // A row that declares `readRow` is a PATCH: pre-read → If-Match → run →
  // re-read (decision 3). Enforcement is declarative — never logic in `run`.
  if (route.readRow !== undefined) {
    const readRow = routes.find((r) => r.id === route.readRow);
    const readPresent = readRow?.present;
    if (readRow === undefined || readPresent === undefined) {
      const e = TRANSPORT_ERRORS.internal;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    // A missing entity 404s here, before any write.
    const readInput = readRow.decode(rawInput);
    const before = readPresent(await readRow.run(deps, readInput));
    const ifMatch = ctx.get("if-match");
    if (!ifMatch) {
      const e = TRANSPORT_ERRORS.precondition_required;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    if (ifMatch !== etagOf(before)) {
      const e = TRANSPORT_ERRORS.precondition_failed;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    await route.run(deps, route.decode(rawInput));
    const after = readPresent(await readRow.run(deps, readInput));
    ctx.status = route.successStatus;
    ctx.set("ETag", etagOf(after));
    ctx.body = dataEnvelope(after);
    return;
  }

  const input = route.decode(rawInput);
  const result = await route.run(deps, input);

  if (route.successStatus === 204) {
    ctx.status = 204;
    ctx.body = null;
    return;
  }
  const present = route.present;
  if (present === undefined) {
    const e = TRANSPORT_ERRORS.internal;
    throw new HttpFailure(e.code, e.status, e.message);
  }
  if (route.kind === "html") {
    ctx.status = route.successStatus;
    ctx.type = "text/html; charset=utf-8";
    ctx.body = present(result) as string;
    return;
  }

  const dto = present(result);
  if (route.successStatus === 201) {
    const location = route.location;
    if (location === undefined) {
      const e = TRANSPORT_ERRORS.internal;
      throw new HttpFailure(e.code, e.status, e.message);
    }
    ctx.set("Location", location(result));
  }
  ctx.status = route.successStatus;
  if (route.successStatus === 200) {
    ctx.set("ETag", etagOf(dto));
  }
  ctx.body = dataEnvelope(dto);
});
```

### 6. `src/apps/http/routes.test.ts:138-150` — the three contract assertions

Replace the existing `if (route.successStatus === 204) … else …` `present` block
with:

```ts
if (route.successStatus === 201) {
  assert.equal(
    typeof route.location,
    "function",
    `location required for 201 (${route.id})`,
  );
} else {
  assert.equal(
    route.location,
    undefined,
    `location forbidden unless 201 (${route.id})`,
  );
}

if (route.method === "PATCH") {
  assert.equal(
    typeof route.readRow,
    "string",
    `readRow required for PATCH (${route.id})`,
  );
  const target = ROUTES.find((r) => r.id === route.readRow);
  assert.ok(
    target !== undefined,
    `readRow "${route.readRow}" names no row (${route.id})`,
  );
  assert.equal(
    target.method,
    "GET",
    `readRow "${route.readRow}" must be a GET row (${route.id})`,
  );
} else {
  assert.equal(
    route.readRow,
    undefined,
    `readRow forbidden unless PATCH (${route.id})`,
  );
}

if (route.successStatus === 204 || route.readRow !== undefined) {
  assert.equal(
    route.present,
    undefined,
    `present forbidden for 204 and for readRow rows (${route.id})`,
  );
} else {
  assert.equal(
    typeof route.present,
    "function",
    `present required unless 204 or readRow (${route.id})`,
  );
}
```

## Constraints

- No route is added, removed or renamed. `ROUTES.length` stays `24` and the row
  count assertion (`routes.test.ts:248`) is untouched.
- `If-Match` is compared by **exact string equality** with the computed quoted
  validator. No weak-validator (`W/`) handling, no `*` wildcard, no comma list —
  a `*` therefore answers `412`. `If-None-Match` and `304` are out of scope.
- `route.decode` for a PATCH row runs **after** the `If-Match` check, so a
  missing or stale validator calls the write row's `decode` and `run` zero
  times.
- `ETag` is set only when `successStatus === 200` **and** the response goes
  through the json path. A `201`, a `204` and the `html` row carry none.
- `Location` is set from `route.location(result)` — the raw use-case result, not
  the DTO — because a create's result is the new id itself.
- The `readRow` lookup uses the SAME `routes` array `buildHttpApp` dispatches
  over (`opts.routes ?? ROUTES`), so an injected test row can name an injected
  read row.
- No middleware is added, removed or reordered.
- Keep every existing doc comment in `routes.ts` and `app.ts` on the field or
  branch it documents.

## Verify

- New `src/apps/http/etag.test.ts`:
  - `etagOf({ a: 1 })` is a quoted 64-hex-char string:
    `assert.match(etagOf({ a: 1 }), /^"[0-9a-f]{64}"$/)`.
  - two structurally identical DTOs hash equal:
    `assert.equal(etagOf({ id: "x", name: "n" }), etagOf({ id: "x", name: "n" }))`.
  - one changed field hashes different:
    `assert.notEqual(etagOf({ id: "x", name: "n" }), etagOf({ id: "x", name: "m" }))`.
- New tests in `src/apps/http/app.test.ts`, all using injected rows via
  `buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID, routes: [...] })`
  with fakes only (no sqlite, no server):
  - a `201` row whose `location` returns `/api/thing/abc` answers `201`, sets
    `Location: /api/thing/abc`, has **no** `ETag` header
    (`assert.equal(res.headers.etag, undefined)`), and its body is
    `{ data: { id: "abc" } }`.
  - a `201` row with `location` omitted answers `500` with code `internal`.
  - a `200` json row's `ETag` equals `etagOf(dto)` for the DTO in `res.body.data`,
    computed independently in the test.
  - a `204` row answers `204` with an empty body and no `ETag` and no
    `Content-Type`.
  - a `PATCH` row (`readRow` naming an injected `GET` row) with **no** `If-Match`
    answers `428` with code `precondition_required`, and the PATCH row's `run`
    spy counter is `0`.
  - the same row with `If-Match: "deadbeef"` answers `412` with code
    `precondition_failed`, and the `run` spy counter is `0`.
  - the same row with the `ETag` the paired `GET` returned answers `200`, calls
    the PATCH row's `run` exactly once, its body is the RE-READ DTO (the fake
    read row returns a mutated value on its second call, and the response shows
    the mutated one), and the response `ETag` differs from the sent `If-Match`.
  - a `PATCH` row whose read row's `run` throws
    `new UnknownReferenceError("project", "p1")` answers `404
unknown_reference` and the PATCH row's `run` spy counter is `0`.
  - a `PATCH` row whose `readRow` names a non-existent id answers `500 internal`.
- `src/apps/http/error-registry.test.ts` — add: `mapError` is not involved, but
  assert `TRANSPORT_ERRORS.precondition_required` is
  `{ code: "precondition_required", status: 428, message: "If-Match is required" }`
  and `TRANSPORT_ERRORS.precondition_failed.status === 412`; the existing
  registry-hygiene test must pass with `428` in `ALLOWED_STATUSES`.
- `src/apps/http/routes.test.ts` — the amended policy test passes over all 24
  existing rows (every one is a `GET` with a `present`, no `location`, no
  `readRow`).
- `node --test src/apps/http/etag.test.ts src/apps/http/app.test.ts src/apps/http/routes.test.ts src/apps/http/error-registry.test.ts src/apps/http/router.test.ts src/apps/http/ui.test.ts src/apps/http/routes.project.test.ts` passes.
- `npm run verify` exits 0.
- Proof: none directly. S1 is the refactor `scripts/e2e/http-serve-proof.sh`
  (`019 ok: …`) and `scripts/e2e/http-reads-proof.sh` (`020 ok: …`) must keep
  passing unchanged — run both.
