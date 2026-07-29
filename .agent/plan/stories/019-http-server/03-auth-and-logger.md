# Story 03 — Basic auth + `HttpLogger` + `PinoLogger`

Epic: `.agent/plan/epics/019-http-server.md` (bullet S4)
Depends on: Story 02.

## Change

1. **New file `src/apps/http/logger.ts`** — the structured logger interface the
   HTTP app owns. `apps/` may not import `src/logger/port.ts`, exactly as
   `src/apps/cli/deps.ts:159-163` re-declares `Logger`:

   ```ts
   /**
    * The structured logger the HTTP app needs. Declared here, not imported from
    * src/logger/port.ts, because eslint `boundaries` forbids apps/ -> an adapter
    * port. `PinoLogger` (src/logger/pino.ts) satisfies both this and the port.
    */
   export interface HttpLogger {
     info(message: string, fields?: Record<string, unknown>): void;
     warn(message: string, fields?: Record<string, unknown>): void;
     error(message: string, fields?: Record<string, unknown>): void;
   }
   ```

2. **New file `src/logger/pino.ts`** — an adapter implementing the existing
   `Logger` port (`src/logger/port.ts`) with the optional second `fields`
   argument, so it structurally satisfies `HttpLogger` too:

   ```ts
   import pino from "pino";
   import type { DestinationStream, Logger as Pino } from "pino";

   import type { Logger } from "./port.ts";

   /** JSON-line logger for the HTTP app. `base: undefined` drops pid/hostname. */
   export class PinoLogger implements Logger {
     readonly #log: Pino;

     constructor(stream?: DestinationStream) {
       this.#log = pino({ base: undefined }, stream ?? process.stdout);
     }

     info(message: string, fields?: Record<string, unknown>): void { … }
     warn(message: string, fields?: Record<string, unknown>): void { … }
     error(message: string, fields?: Record<string, unknown>): void { … }
   }
   ```

   Each method calls `this.#log.<level>(fields ?? {}, message)`, so the emitted
   line is `{"level":30,"time":…,"<field>":…,"msg":"<message>"}`.

3. **New file `src/apps/http/basic-auth.ts`**:

   ```ts
   /** RFC 7617 check against one shared secret. Returns true only on an exact match. */
   export function checkBasicAuth(
     header: string | undefined,
     apiKey: string,
   ): boolean;
   ```

   The algorithm is fixed, in this order; any step failing returns `false`:
   1. `header` is a non-empty string.
   2. Split at the FIRST space into `scheme` and `payload`; `scheme.toLowerCase()
=== "basic"` (RFC 7617 makes the scheme case-insensitive); `payload` is
      non-empty and contains no space.
   3. Canonical base64: `const decoded = Buffer.from(payload, "base64");` and
      `decoded.toString("base64") === payload`. Node's decoder is permissive, so
      this round-trip is what rejects junk.
   4. `const text = decoded.toString("utf8");` contains `":"`; the password is
      everything AFTER the first colon (the username is ignored, may be empty,
      and may itself contain no colon by construction).
   5. The password is non-empty and
      `crypto.timingSafeEqual(sha256(password), sha256(apiKey))` is true, where
      `sha256(s) = createHash("sha256").update(s, "utf8").digest()`. Hashing
      first keeps both buffers 32 bytes, so length never leaks and
      `timingSafeEqual` never throws.

   Also export the challenge header value as a constant:

   ```ts
   export const BASIC_CHALLENGE = 'Basic realm="kanthord"';
   ```

4. **New file `src/apps/http/api-key.ts`** — the one place the key is validated:

   ```ts
   export const API_KEY_MIN_LENGTH = 16;

   export class MissingApiKeyError extends Error {} // message: see below

   /** Validate a candidate API key. Throws MissingApiKeyError when unusable. */
   export function requireApiKey(value: string | undefined): string;
   ```

   Rules: `undefined`, `""`, a value that is blank after `.trim()`, or a value
   shorter than `API_KEY_MIN_LENGTH` after `.trim()` all throw
   `MissingApiKeyError` whose message is exactly
   `API_KEY must be set to at least 16 characters (see .env.example)`. Otherwise
   the trimmed value is returned. **This function never reads `process.env`** —
   the caller passes the value in.

## Constraints

- `checkBasicAuth` must not throw for any input, including a header of `"Basic"`
  with no payload, a payload that is not valid base64, or a `Buffer`-hostile
  string. Return `false`.
- No log call in this story's code may receive the API key, the `Authorization`
  header, or `process.env` in its `fields` argument.
- `PinoLogger` must not be imported by anything under `src/apps/**` — only
  `src/composition.ts` (Story 07) may construct it.
- `src/logger/stdout.ts`, `src/logger/null.ts` and `src/logger/port.ts` are NOT
  modified. The optional `fields` parameter is additive and only `PinoLogger`
  declares it.

## Verify

- New test `src/apps/http/basic-auth.test.ts`
  (`node --test src/apps/http/basic-auth.test.ts`). Table-driven with
  `KEY = "0123456789abcdef0123456789abcdef"` and
  `enc = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64")`:
  - `true`: `enc("kanthord", KEY)`; the same with scheme `basic`; the same with
    scheme `BASIC`; `enc("", KEY)` (empty username is allowed).
  - `false`: `undefined`; `""`; `"Basic"`; `"Basic "`; `"Bearer " + KEY`;
    `"Basic " + Buffer.from("kanthord:" + KEY.slice(0, -1) + "0").toString("base64")`
    (same-length wrong key); `"Basic " + Buffer.from("kanthord:short").toString("base64")`
    (different-length wrong key); `"Basic !!!not-base64!!!"`;
    `"Basic " + Buffer.from("no-colon-here").toString("base64")`;
    `"Basic " + Buffer.from("kanthord:").toString("base64")` (empty password).
  - `BASIC_CHALLENGE` is exactly `Basic realm="kanthord"`.
- New test `src/apps/http/api-key.test.ts`:
  - `requireApiKey(undefined)`, `requireApiKey("")`, `requireApiKey("   ")` and
    `requireApiKey("0123456789abcde")` (15 chars) each
    `assert.throws(..., MissingApiKeyError)` and the message contains `API_KEY`.
  - `requireApiKey("0123456789abcdef")` (16 chars) returns that value.
  - `requireApiKey("  0123456789abcdef  ")` returns the trimmed value.
- New test `src/logger/pino.test.ts`, mirroring the convention in
  `src/logger/logger.test.ts` but writing into an injected stream instead of
  mocking `process.stdout`:
  - Build `const lines: string[] = []` and a `DestinationStream`
    `{ write: (s: string) => { lines.push(s); } }`; `new PinoLogger(stream)`.
  - `info("listening", { port: 4100 })` pushes one line; `JSON.parse` of it has
    `msg === "listening"`, `port === 4100`, `level === 30`, and NO `pid` or
    `hostname` key.
  - `warn(...)` yields `level === 40`, `error(...)` yields `level === 50`.
  - `info("plain")` with no fields parses and has `msg === "plain"`.
  - A compile-time conformance line — `const asHttp: HttpLogger = new
PinoLogger(stream);` — so `npm run typecheck` fails if the shapes drift.
- `npm run verify` exits 0.
- Proof: prerequisite for phase A (the `listening` JSON line the script parses),
  phase C (the `WWW-Authenticate` challenge and `401`s) and phase G
  (`API_KEY` refusal message).
