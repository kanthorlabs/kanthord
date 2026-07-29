# Story 01 — transport primitives: `jwt.ts` + `key.ts`

Epic: `.agent/plan/epics/019-http-api-skeleton.md`

## Change

### New file `src/apps/http/jwt.ts`

Imports: `import { createHmac, timingSafeEqual } from "node:crypto";` only.

```ts
export interface JwtClaims {
  sub: "local";
  jti: string;
  csrf: string;
  iat: number;
  exp: number;
}

export class JwtInvalidError extends Error {
  readonly reason: string;
  constructor(reason: string); // name = "JwtInvalidError", message = `invalid token: ${reason}`
}

export function signJwt(claims: JwtClaims, secret: Buffer): string;
export function verifyJwt(
  token: string,
  secret: Buffer,
  nowSeconds: number,
): JwtClaims;
```

Pinned behaviour:

- Header is the fixed literal object `{ alg: "HS256", typ: "JWT" }`, serialised
  with `JSON.stringify` and base64url-encoded. No `kid`, no `crit`.
- base64url = `Buffer.from(s).toString("base64url")`; decode =
  `Buffer.from(seg, "base64url")`. No padding is emitted and none is accepted.
- Signature = `createHmac("sha256", secret).update(`${h}.${p}`).digest()`,
  base64url-encoded.
- `verifyJwt` rejects, in this order, each with `JwtInvalidError(<reason>)`:
  1. `"segments"` — `token.split(".").length !== 3`, or any segment is empty.
  2. `"header"` — the decoded header is not JSON, or its `typ !== "JWT"`, or its
     **`alg !== "HS256"`**. `alg: "none"` and `alg: "RS256"` land here.
  3. `"signature"` — the recomputed digest differs. Compare with
     `timingSafeEqual`, **guarded by an explicit length check first** (it throws
     on unequal lengths): if the two buffers differ in length, reject as
     `"signature"` without calling `timingSafeEqual`.
  4. `"payload"` — the decoded payload is not a JSON object.
  5. `"claims"` — `sub !== "local"`, or `jti` / `csrf` is not a non-empty string,
     or `iat` / `exp` is not an integer.
  6. `"expired"` — `exp <= nowSeconds`.
- Verification order is binding: the signature is checked **before** any claim,
  so an unsigned token can never influence a claim decision.

### New file `src/apps/http/key.ts`

Imports: `node:crypto` (`randomBytes`, `hkdfSync`), `node:fs`
(`readFileSync`, `writeFileSync`, `renameSync`, `mkdirSync`, `statSync`,
`existsSync`, `unlinkSync`), `node:path` (`dirname`).

```ts
export class KeyPermissionsError extends Error {
  readonly path: string;
  readonly mode: string; // octal, e.g. "644"
  constructor(path: string, mode: string);
}

export interface HttpKey {
  /** The raw hex file content — the credential a client sends to POST /api/sessions. */
  pairing: string;
  /** HKDF-SHA256 of `pairing`, info "kanthord-jwt", 32 bytes — the JWT signing secret. */
  jwtSecret: Buffer;
}

export function loadOrCreateKey(path: string): HttpKey;
```

Pinned behaviour:

- **Missing file:** `mkdirSync(dirname(path), { recursive: true })`, then
  `value = randomBytes(32).toString("hex")`, then write to
  `` `${path}.tmp-${randomBytes(6).toString("hex")}` `` with
  `writeFileSync(tmp, value, { mode: 0o600, flag: "wx" })`, then
  `renameSync(tmp, path)`. On any throw after the temp file exists, `unlinkSync`
  it and rethrow.
- **Existing file:** `(statSync(path).mode & 0o777) !== 0o600` throws
  `KeyPermissionsError(path, (mode & 0o777).toString(8))` with message
  `key file <path> must be mode 600, found <mode>`. Otherwise read it and
  `.trim()` the content.
- `jwtSecret = Buffer.from(hkdfSync("sha256", Buffer.from(pairing, "utf8"), Buffer.alloc(0), "kanthord-jwt", 32))`
  — `hkdfSync` returns an `ArrayBuffer`, so the `Buffer.from` wrap is required.
- **Binding: the pairing credential is the raw file content, NOT a derived
  value.** Only the signing secret is derived. This is the epic's amended
  decision 8 (amended by Ulrich, 2026-07-29) — do not reintroduce a
  `"kanthord-pair"` derivation. `scripts/e2e/http-api-proof.sh:87` reads the file
  and sends it verbatim.

## Constraints

- Both files are pure: no `node:http`, no server, no `deps`, no logging.
- No new dependency. `node:crypto` only — do not add `jose`.
- `verbatimModuleSyntax`: `JwtClaims` / `HttpKey` are imported elsewhere with
  `import type`.

## Verify

New test file `src/apps/http/jwt.test.ts`, `describe("src/apps/http/jwt.ts")`:

- Round trip: `verifyJwt(signJwt(claims, secret), secret, claims.exp - 1)`
  deep-equals `claims`.
- **Table-driven rejection table**, each case asserting `assert.throws(…, { name: "JwtInvalidError" })`
  and the expected `reason`:
  | input                                                          | reason      |
  | -------------------------------------------------------------- | ----------- |
  | `""`                                                           | `segments`  |
  | `"a.b"`                                                        | `segments`  |
  | `"a.b.c.d"`                                                    | `segments`  |
  | `".."` (three empty segments)                                  | `segments`  |
  | `"a.b.c"` (garbage base64url)                                  | `header`    |
  | a token re-encoded with header `alg: "none"`                   | `header`    |
  | a token re-encoded with header `alg: "RS256"`                  | `header`    |
  | a token re-encoded with header `typ: "JWS"`                    | `header`    |
  | a valid token with its **last signature character flipped**    | `signature` |
  | a valid token signed with a different secret                   | `signature` |
  | a valid token whose signature segment is truncated by one char | `signature` |
  | claims with `exp` one second in the past                       | `expired`   |
  | claims with `exp` deleted                                      | `claims`    |
  | claims with `csrf` deleted                                     | `claims`    |
  | claims with `jti: ""`                                          | `claims`    |
  | claims with `sub: "other"`                                     | `claims`    |
- A case where the payload is tampered with but the signature is left alone
  asserts reason `signature`, proving signature-before-claims order.

New test file `src/apps/http/key.test.ts`, `describe("src/apps/http/key.ts")`,
each test in its own `mkdtempSync(join(tmpdir(), "kanthord-019-key-"))` with
`finally { rmSync(dir, { recursive: true, force: true }); }`:

- First call creates the file; `statSync(path).mode & 0o777 === 0o600`; content is
  64 lowercase hex chars.
- Second call returns the **same** `pairing` and an equal `jwtSecret`, and the
  file's `mtimeMs` is unchanged (no rewrite).
- `jwtSecret.length === 32` and `jwtSecret.toString("hex") !== pairing`.
- A pre-existing file written with mode `0o644` makes `loadOrCreateKey` throw
  `KeyPermissionsError` whose `mode` is `"644"` and whose message contains the
  path.
- The parent directory is created when absent (`join(dir, "nested", "http-key")`).
- No `*.tmp-*` file remains in the directory after a successful create.

Commands:

- `node --test src/apps/http/jwt.test.ts src/apps/http/key.test.ts` exits 0.
- `npm run verify` exits 0.
- Proof: none directly; `scripts/e2e/http-api-proof.sh` phase A's `mode 600`
  assertion and phase E's flipped-signature `401` depend on this story.
