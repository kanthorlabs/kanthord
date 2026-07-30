# Story S1 — generic `Route` + `defineRoute`, no `present!` in dispatch

Epic: `.agent/plan/epics/020-http-reads.md` (decision 3)

## Change

1. `src/apps/http/routes.ts` — split the current `Route` interface (`:16-53`)
   into three declarations. Keep every existing doc comment on the field it
   documents; move nothing else.

```ts
export interface RouteMeta {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly successStatus: 200 | 201 | 204;
  readonly kind: "json" | "html";
  readonly cliCommands: readonly string[];
}

/** The typed row an author writes. Input/Output are inferred, never annotated. */
export interface RouteDefinition<Input, Output> extends RouteMeta {
  readonly decode: (input: RouteInput) => Input;
  readonly run: (deps: HttpDeps, input: Input) => Promise<Output>;
  readonly present?: (result: Output) => unknown;
}

/** The erased row the dispatcher and the policy tests iterate. */
export interface Route extends RouteMeta {
  readonly decode: (input: RouteInput) => unknown;
  readonly run: (deps: HttpDeps, input: unknown) => Promise<unknown>;
  readonly present?: (result: unknown) => unknown;
}

/**
 * The ONLY place a route row is cast. `run`'s Input is contravariant, so a
 * typed definition is not assignable to `Route` without this single erasure.
 */
export function defineRoute<Input, Output>(
  def: RouteDefinition<Input, Output>,
): Route {
  return def as unknown as Route;
}
```

2. `src/apps/http/routes.ts:55-78` — wrap both existing rows in `defineRoute`
   and delete their casts. `health.get`'s `present` becomes
   `present: (result) => healthView(result)` (drop `as HealthResult`);
   `ui.get`'s becomes `present: (result) => result` (drop `as string`).
   `ROUTES` keeps the type `readonly Route[]`.
3. `src/apps/http/app.ts:223-236` — replace the two `route.present!` uses:

```ts
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
ctx.status = route.successStatus;
ctx.body = dataEnvelope(present(result));
```

4. `src/apps/http/app.test.ts:41-43` — make `makeDeps` survive every later
   story's new required `HttpDeps` field with ONE cast (transport tests never
   call a read use case):

```ts
function makeDeps(): { deps: HttpDeps; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  // Transport tests exercise middleware, not reads: the read fields 020 adds
  // are never reached, so they are deliberately absent.
  return { deps: { logger } as unknown as HttpDeps, logger };
}
```

5. `src/apps/http/routes.test.ts:154-159` — same one-cast treatment for
   `fakeDeps`: `const fakeDeps = { logger: fakeLogger } as unknown as HttpDeps;`.

## Constraints

- No route is added, removed or renamed in this story. `ROUTES` still holds
  exactly `health.get` and `ui.get`.
- No behaviour change: every existing assertion in `app.test.ts`,
  `routes.test.ts`, `router.test.ts` and `ui.test.ts` must pass unedited apart
  from the two casts above.
- `defineRoute` is the only `as`-cast added. Do not add `any`.
- `matchRoute` (`src/apps/http/router.ts`) and `MatchOutcome` keep taking the
  erased `Route`; do not make the router generic.

## Verify

- New test file `src/apps/http/route-generics.test.ts` asserting:
  - `defineRoute` returns a row whose `decode`/`run`/`present` are the same
    function references it was given (`assert.equal(row.decode, def.decode)`);
  - a row whose `decode` returns `{ id: string }` and whose `run` takes
    `{ id: string }` typechecks and, when invoked, passes the decoded value
    through: `await row.run(deps, row.decode({params:{id:"x"},query:{},body:undefined}))`
    returns the value the fake produced;
  - a mismatched pair is a TYPE error, pinned with `@ts-expect-error` directly
    above the offending property:
    ```ts
    defineRoute({
      ...meta,
      decode: () => ({ id: "x" }),
      // @ts-expect-error decode returns { id: string }, run demands { taskId: string }
      run: async (_deps: HttpDeps, input: { taskId: string }) => input.taskId,
      present: (r) => ({ r }),
    });
    ```
    (`npm run verify`'s typecheck fails if the mismatch stops being an error.)
- New test in `src/apps/http/app.test.ts`: an injected non-204 row with
  `present` omitted returns `500` with code `internal` and a `requestId`, and
  the thrown value is not a `TypeError` (assert the response body's
  `error.code === "internal"`; assert the captured log line's `cause` does not
  contain `"is not a function"`).
- `node --test src/apps/http/route-generics.test.ts src/apps/http/app.test.ts src/apps/http/routes.test.ts src/apps/http/router.test.ts src/apps/http/ui.test.ts` passes.
- `npm run verify` exits 0.
- Proof: none directly — S1 is the refactor `scripts/e2e/http-serve-proof.sh`
  must keep passing unchanged (`019 ok: …`).
