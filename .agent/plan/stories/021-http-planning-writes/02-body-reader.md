# Story S2 — the request-body reader, and four new path segments

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decisions 2 and 8)
Depends on: Story S1 (nothing structural — S2 only needs `verify` green).

No row lands in this story. `ROUTES.length` stays `24`.

## Change

### 1. `src/apps/http/body.ts` (new) — sibling to `decode.ts`

`decode.ts` holds the params/query readers and is NOT edited by this epic.
Every helper below throws the existing `InvalidInputError(field, reason)` →
`400 invalid_input`. The 1 MiB limit stays as 019 configured it
(`app.ts:200`); `415`, `413` and malformed-JSON `400` already exist and are not
rebuilt here.

```ts
// src/apps/http/body.ts — request-body readers (EPIC 021 decision 2). Sibling to
// decode.ts, which owns the params/query readers: splitting by input location
// keeps both files small and leaves decode.ts untouched by this epic.
import { InvalidInputError } from "./errors.ts";

/** Every helper starts here: the body must be a plain JSON object. */
function bodyRecord(body: unknown, field: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InvalidInputError(field, "request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/**
 * Trims and rejects blank, mirroring `requirePathParam`
 * (`decode.ts:9-12`) — `{"name":"   "}` never reaches a use case, several of
 * which have no name validation of their own.
 */
export function requireBodyString(body: unknown, field: string): string {
  const raw = bodyRecord(body, field)[field];
  if (typeof raw !== "string") {
    throw new InvalidInputError(field, "must be a string");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidInputError(field, "must not be blank");
  }
  return trimmed;
}

export function optionalBodyString(
  body: unknown,
  field: string,
): string | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  return requireBodyString(body, field);
}

export function optionalBodyStringArray(
  body: unknown,
  field: string,
): string[] | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an array of strings");
  }
  return raw.map((entry) => {
    if (typeof entry !== "string") {
      throw new InvalidInputError(field, "must be an array of strings");
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new InvalidInputError(field, "entries must not be blank");
    }
    return trimmed;
  });
}

export function optionalBodyBool(
  body: unknown,
  field: string,
): boolean | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "boolean") {
    throw new InvalidInputError(field, "must be a boolean");
  }
  return raw;
}

export function requireBodyObject(
  body: unknown,
  field: string,
): Record<string, unknown> {
  const raw = bodyRecord(body, field)[field];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an object");
  }
  return raw as Record<string, unknown>;
}

export function requireBodyObjectArray(
  body: unknown,
  field: string,
): Array<Record<string, unknown>> {
  const raw = bodyRecord(body, field)[field];
  if (!Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an array of objects");
  }
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new InvalidInputError(field, "must be an array of objects");
    }
    return entry as Record<string, unknown>;
  });
}

export function optionalBodyRecord(
  body: unknown,
  field: string,
): Record<string, string> | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInputError(field, "must be an object of strings");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new InvalidInputError(field, "must be an object of strings");
    }
    out[key] = value;
  }
  return out;
}
```

There is deliberately **no** generic `requireBodyShape<T>` helper. A helper whose
only runtime check is "non-null, non-array object" but whose return type is an
arbitrary `T` is an unchecked assertion wearing a validator's name; centralising
it makes the unsoundness easy to reuse and hard to notice. The `pkg` field of the
two graph rows is validated by a real app-layer decoder instead — Story S3 adds
`parseGraphPackageDocument`. "The client already parsed it" is not a server trust
boundary: any caller can post arbitrary JSON.

### 2. `src/apps/http/routes.test.ts:42-68` — four segments and the first `NOT_PLURAL` entry

```ts
const PATH_SEGMENTS = [
  "api",
  "healthz",
  "project",
  "initiative",
  "objective",
  "task",
  "resource",
  "repository",
  "credential",
  "notification",
  "filesystem",
  "ai-provider",
  "model",
  "queue",
  "overview",
  "graph",
  "conflict",
  "dependency",
  "package",
  "diagnostic",
  "readiness",
];
```

```ts
const NOT_PLURAL: string[] = ["readiness"];
```

`readiness` is the first use of 020 decision 2's escape hatch: it ends in `s`
and is genuinely singular. None of the four new segments is in `BANNED_VERBS`,
and no segment is ever `import`, `export`, `check`, `create`, `update`,
`rename`, `add` or `remove` — those live in the method, or in the row `id`.

## Constraints

- `decode.ts` is NOT edited by this story or this epic.
- The `jsonLimit` at `app.ts:200` stays `"1mb"`.
- Every helper takes `(body: unknown, field: string)` in that order and reads
  `body[field]` — the field name in the error message is always the field the
  caller asked for, so `400 invalid_input` always names it.
- `optionalBodyString` delegates to `requireBodyString` after the presence
  check, so "present but blank" is a `400` and "absent" is `undefined`. It never
  returns `""`.
- A `null` body, an array body and a scalar body are rejected by `bodyRecord` in
  every helper, including the `optional*` ones.
- No helper mutates its input and none returns the caller's array or object by
  reference: `optionalBodyStringArray` and `requireBodyObjectArray` return the
  result of `.map`, `optionalBodyRecord` builds a fresh object.
- Adding a segment to `PATH_SEGMENTS` or a name to `NOT_PLURAL` is the intended
  reviewed discipline — do not loosen either test.

## Verify

- New `src/apps/http/body.test.ts`, one `test(...)` per bullet:
  - happy path for each of the seven helpers.
  - `requireBodyString`: missing field → `InvalidInputError` whose `field` is the
    asked-for name and whose message matches `/must be a string/`; `"   "` →
    `/must not be blank/`; a number → `/must be a string/`; trims `" a "` to
    `"a"`.
  - `optionalBodyString`: absent → `undefined`; `"   "` → throws; trims.
  - `optionalBodyStringArray`: absent → `undefined`; `["a"," b "]` →
    `["a","b"]`; a scalar `"a"` → throws `/must be an array of strings/`;
    `[1]` → throws; `[""]` → throws `/entries must not be blank/`; `[]` → `[]`.
  - `optionalBodyBool`: absent → `undefined`; `true` → `true`; `"true"` →
    throws `/must be a boolean/`.
  - `requireBodyObject`: `{}` → `{}`; missing → throws; an array → throws
    `/must be an object/`; `null` → throws.
  - `requireBodyObjectArray`: `[{},{"a":1}]` passes; missing → throws; `[1]` →
    throws; `[[]]` → throws; `[]` → `[]`.
  - `optionalBodyRecord`: absent → `undefined`; `{"a":"b"}` → `{"a":"b"}` and is
    a DIFFERENT object reference from the input; `{"a":1}` → throws; an array →
    throws.
  - body-level rejection, asserted for at least `requireBodyString`,
    `optionalBodyBool` and `requireBodyObjectArray`: a `null` body, a `[]` body
    and a `"str"` body each throw `InvalidInputError` matching
    `/request body must be a JSON object/`.
  - every thrown error satisfies `err instanceof InvalidInputError` and
    `mapError(err)` gives `{ code: "invalid_input", status: 400 }` — assert this
    once, importing `mapError` from `./error-registry.ts`.
- `src/apps/http/routes.test.ts` — the existing four path-vocabulary tests pass
  with the enlarged `PATH_SEGMENTS` and the one `NOT_PLURAL` entry; add a test
  asserting `NOT_PLURAL` contains exactly `["readiness"]` and that every
  `NOT_PLURAL` entry is also in `PATH_SEGMENTS`.
- `node --test src/apps/http/body.test.ts src/apps/http/routes.test.ts src/apps/http/decode.test.ts` passes.
- `npm run verify` exits 0.
- Proof: none directly.
