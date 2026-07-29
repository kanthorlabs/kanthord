# Story 02 — envelope, HTTP error classes, error registry

Epic: `.agent/plan/epics/019-http-server.md` (bullet S2)
Depends on: Story 01.

## Change

1. **New file `src/apps/http/errors.ts`** — the transport-level error classes the
   HTTP app raises itself. Exact shapes:

   ```ts
   export class HttpFailure extends Error {
     readonly code: string;
     readonly status: number;

     constructor(code: string, status: number, message: string) {
       super(message);
       this.name = "HttpFailure";
       this.code = code;
       this.status = status;
     }
   }

   export class InvalidInputError extends HttpFailure {
     readonly field: string;

     constructor(field: string, detail: string) {
       super("invalid_input", 400, `invalid ${field}: ${detail}`);
       this.name = "InvalidInputError";
       this.field = field;
     }
   }
   ```

2. **New file `src/apps/http/envelope.ts`**:

   ```ts
   export interface DataEnvelope<T> {
     data: T;
   }

   export interface ErrorEnvelope {
     error: { code: string; message: string; requestId: string };
   }

   export function dataEnvelope<T>(data: T): DataEnvelope<T>;
   export function errorEnvelope(
     code: string,
     message: string,
     requestId: string,
   ): ErrorEnvelope;
   ```

   Both are pure object constructors with exactly those keys and no extras.

3. **New file `src/apps/http/error-registry.ts`**:

   ```ts
   export interface ErrorMapping {
     code: string;
     status: number;
     message: string;
   }

   /** Domain/app error classes reachable from an HTTP route, mapped explicitly. */
   export const DOMAIN_ERROR_MAPPINGS: ReadonlyArray<{
     readonly type: new (...args: never[]) => Error;
     readonly code: string;
     readonly status: number;
   }>;

   export function mapError(err: unknown): ErrorMapping;
   ```

   `DOMAIN_ERROR_MAPPINGS` contains exactly two entries in this order:
   - `UnknownReferenceError` (`src/domain/errors.ts:19`, imported through
     `src/app/errors.ts` — `apps/` may not import `src/domain/**`) → code
     `unknown_reference`, status `404`.
   - `DuplicateNameError` (`src/domain/errors.ts:5`, same re-export route) → code
     `duplicate_name`, status `409`.

   `mapError` resolves in this fixed order, first match wins:
   1. `err instanceof HttpFailure` → `{ code: err.code, status: err.status,
message: err.message }`.
   2. a `DOMAIN_ERROR_MAPPINGS` entry whose `type` the error is an `instanceof`
      → that entry's code and status, `message: err.message`.
   3. an `http-errors`-shaped object (a non-null object whose `status` or
      `statusCode` is a number — what `@koa/bodyparser` throws), for the three
      recognised statuses ONLY, with a fixed message and never the thrown
      message:
      - `400` → `{ code: "malformed_body", status: 400, message: "malformed request body" }`
      - `413` → `{ code: "body_too_large", status: 413, message: "request body too large" }`
      - `415` → `{ code: "unsupported_media_type", status: 415, message: "unsupported media type" }`
   4. anything else → `{ code: "internal", status: 500, message: "internal error" }`.

   Also export the fixed transport codes as a frozen record so middleware never
   spells one by hand:

   ```ts
   export const TRANSPORT_ERRORS: {
     readonly unauthenticated: {
       code: "unauthenticated";
       status: 401;
       message: string;
     };
     readonly unknown_route: {
       code: "unknown_route";
       status: 404;
       message: string;
     };
     readonly method_not_allowed: {
       code: "method_not_allowed";
       status: 405;
       message: string;
     };
     readonly host_not_allowed: {
       code: "host_not_allowed";
       status: 403;
       message: string;
     };
     readonly origin_not_allowed: {
       code: "origin_not_allowed";
       status: 403;
       message: string;
     };
     readonly unsupported_media_type: {
       code: "unsupported_media_type";
       status: 415;
       message: string;
     };
     readonly malformed_body: {
       code: "malformed_body";
       status: 400;
       message: string;
     };
     readonly body_too_large: {
       code: "body_too_large";
       status: 413;
       message: string;
     };
     readonly invalid_input: {
       code: "invalid_input";
       status: 400;
       message: string;
     };
     readonly internal: {
       code: "internal";
       status: 500;
       message: "internal error";
     };
   };
   ```

## Constraints

- `mapError` never returns an unmapped error's own message except through
  branches 1 and 2. A plain `Error("boom")` must yield exactly
  `"internal error"`.
- No `catch` in these files; they are pure mapping code.
- Do not touch `src/apps/cli/error-map.ts`. The two maps are independent by
  design; only the `500` fallback protects the server.
- `apps/` may not import `src/domain/**`: import both error classes from
  `src/app/errors.ts`.

## Verify

- New test `src/apps/http/envelope.test.ts` (`node --test src/apps/http/envelope.test.ts`):
  - `dataEnvelope({ a: 1 })` deep-equals `{ data: { a: 1 } }` and
    `Object.keys(...)` is exactly `["data"]`.
  - `errorEnvelope("x", "y", "z")` deep-equals
    `{ error: { code: "x", message: "y", requestId: "z" } }` and the inner key
    set is exactly `["code", "message", "requestId"]`.
- New test `src/apps/http/error-registry.test.ts`:
  - hygiene: every `DOMAIN_ERROR_MAPPINGS` code and every `TRANSPORT_ERRORS`
    code matches `/^[a-z]+(_[a-z]+)*$/`, all codes across both are unique, and
    every status is in `{400, 401, 403, 404, 405, 409, 412, 413, 415, 500}`.
  - `mapError(new UnknownReferenceError("project", "P1"))` → code
    `unknown_reference`, status `404`, message equal to the error's own message.
  - `mapError(new DuplicateNameError("project", "global", "x"))` → code
    `duplicate_name`, status `409`.
  - `mapError(new InvalidInputError("id", "must not be blank"))` → code
    `invalid_input`, status `400`, message contains `id`.
  - `mapError(Object.assign(new Error("Payload Too Large"), { status: 413 }))` →
    code `body_too_large`, status `413`, message exactly
    `"request body too large"`, and the message does NOT contain `Payload`.
  - `mapError(Object.assign(new Error("x"), { statusCode: 400 }))` → code
    `malformed_body` (the `statusCode` spelling is honoured too).
  - `mapError(Object.assign(new Error("x"), { status: 418 }))` → code `internal`,
    status `500` (an unrecognised status is NOT passed through).
  - `mapError(new Error("boom"))` → `{ code: "internal", status: 500, message:
"internal error" }` and the message does not contain `boom`.
  - `mapError("a string")` and `mapError(undefined)` → code `internal`.
- `npm run verify` exits 0.
- Proof: prerequisite for phases C, E and F (every asserted `error.code`).
