# Story 01 — the write transport and the frozen edit session

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decisions 1, 3, 7)

## Change

### 1. `ui/src/lib/api-client.ts` — append the write transport

Keep `ApiError`, `apiUrl`, `apiGet` and every 026.2/026.3 read helper untouched.
`apiGet` stays as it is. Append, after the last read helper:

```ts
export interface Etagged<T> {
  readonly data: T;
  readonly etag: string;
}

export interface Created<T> {
  readonly data: T;
  readonly location: string;
}

export async function apiGetWithEtag<T>(
  path: string,
  init?: RequestInitLike,
): Promise<Etagged<T>>;
export async function apiPatch<T>(
  path: string,
  body: unknown,
  ifMatch: string,
  init?: RequestInitLike,
): Promise<Etagged<T>>;
export async function apiPostCreated<T>(
  path: string,
  body: unknown,
  init?: RequestInitLike,
): Promise<Created<T>>;
export async function apiPostNoContent(
  path: string,
  body: unknown,
  init?: RequestInitLike,
): Promise<void>;
export async function apiDeleteNoContent(
  path: string,
  init?: RequestInitLike,
): Promise<void>;
```

Shared rules, identical in all five:

- one `fetch(apiUrl(path), …)` call, `credentials: "same-origin"`, `signal` spread
  from `init` only when present — copy the shape of `apiGet:60-66`;
- headers: `{ accept: "application/json" }`, plus
  `"content-type": "application/json"` when a body is sent, plus
  `{ "if-match": ifMatch }` for `apiPatch`. **No other header, ever** — R3;
- **`ifMatch` is passed through byte-for-byte**, quotes included. No trimming, no
  quoting, no `W/` handling, no `*`, and never a value recomputed from JSON;
- **status is checked exactly**, never `response.ok`: `apiGetWithEtag`/`apiPatch`
  require `200`, `apiPostCreated` requires `201`, `apiPostNoContent` /
  `apiDeleteNoContent` require `204`;
- any other status → read the body with `await response.json().catch(() => undefined)`,
  and throw `new ApiError(response.status, err?.code ?? "transport_error",
err?.message ?? \`${response.status} for ${path}\`, err?.requestId)`— the same
three lines as`apiGet:69-76`. **The `412`, `428`and`404` paths all go through
  here**; nothing special-cases them in the transport;
- `apiGetWithEtag`/`apiPatch`: read `response.headers.get("etag")`; an absent or
  empty value throws `new ApiError(500, "missing_etag", \`no ETag on ${path}\`)`;
- `apiPostCreated`: read `response.headers.get("location")`; an absent or empty
  value throws `new ApiError(500, "missing_location", \`no Location on ${path}\`)`;
- the two `204` helpers **do not parse a body** on success and return `undefined`;
- no retry anywhere in this module (F15).

### 2. `ui/src/lib/edit-session.ts` — new file, the frozen session

```ts
export type EditSessionStatus =
  | "closed"
  | "loading"
  | "editing"
  | "submitting"
  | "conflict"
  | "rearming"
  | "missing"
  | "client-defect"
  | "error";

export interface EditSessionOptions<T, D> {
  readonly load: () => Promise<Etagged<T>>;
  readonly toDraft: (data: T) => D;
  readonly save: (draft: D, ifMatch: string) => Promise<Etagged<T>>;
  readonly onSaved?: (saved: Etagged<T>) => void | Promise<void>;
}

export interface EditSession<T, D> {
  readonly status: EditSessionStatus;
  readonly base: Etagged<T> | null;
  readonly draft: D | null;
  readonly current: T | null;
  readonly error: ApiError | null;
  open(): void;
  close(): void;
  setDraft(draft: D): void;
  submit(): void;
  reload(): void;
  reset(): void;
}

export function useEditSession<T, D>(
  options: EditSessionOptions<T, D>,
): EditSession<T, D>;
```

Pinned state machine — implement exactly these transitions and no others:

| from                 | trigger                                | effect                                                                                                 | to                    |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- |
| `closed`             | `open()`                               | call `load()`                                                                                          | `loading`             |
| `loading`            | `load` resolves                        | freeze `base = {data, etag}`, `draft = toDraft(data)`, `current = null`, `error = null`                | `editing`             |
| `loading`            | `ApiError.status === 404`              | `error = err`                                                                                          | `missing`             |
| `loading`            | any other error                        | `error = err`                                                                                          | `error`               |
| `editing`            | `setDraft(d)`                          | `draft = d`; **`base` unchanged**                                                                      | `editing`             |
| `editing` \| `error` | `submit()`                             | call `save(draft, base.etag)`                                                                          | `submitting`          |
| `submitting`         | resolves                               | `await onSaved(saved)`, then `base = null`, `draft = null`                                             | `closed`              |
| `submitting`         | `status === 412`                       | call `load()`; on resolve set `current = fresh.data`; **`base` and `draft` unchanged**                 | `conflict`            |
| `submitting`         | `status === 428`                       | `error = err`                                                                                          | `client-defect`       |
| `submitting`         | `status === 404`                       | `error = err`                                                                                          | `missing`             |
| `submitting`         | any other error                        | `error = err`; `base` and `draft` unchanged                                                            | `error`               |
| `conflict`           | the recovery `load()` rejects with 404 | `error = err`                                                                                          | `missing`             |
| `conflict`           | `reload()`                             | call `load()`                                                                                          | `rearming`            |
| `rearming`           | resolves                               | `base = {data, etag}` (**the new validator**), `current = null`, `error = null`; **`draft` unchanged** | `editing`             |
| `rearming`           | `404` / other error                    | as `loading`                                                                                           | `missing` / `error`   |
| any                  | `close()`                              | `base = null`, `draft = null`, `current = null`, `error = null`                                        | `closed`              |
| any                  | `reset()`                              | call `load()`, then `draft = toDraft(data)` too                                                        | `loading` → `editing` |

Freeze mechanics — these are the point of the story:

- `base` lives in a `useRef<Etagged<T> | null>` and is mirrored into state for
  rendering. It is **written in exactly three places**: the `loading` resolve,
  the `rearming` resolve, and `reset()`. Nothing else assigns it;
- `submit()` reads `baseRef.current.etag`. It **never** calls
  `queryClient.getQueryData`, never reads a render-time prop, and never accepts an
  `etag` argument from a caller;
- `submit()` when `baseRef.current === null` is a no-op;
- **`load` must bypass the query cache**: callers pass `() => apiGetWithEtag(...)`
  directly. `useEditSession` imports no query client and never calls
  `fetchQuery`/`ensureQueryData`;
- **stale-response guard**: an `attemptRef` counter increments at the head of
  `open`, `submit`, `reload` and `reset`. Every promise resolution captures the
  counter and returns without touching state when
  `captured !== attemptRef.current`. `useEffect` cleanup on unmount bumps the
  counter so a late resolution cannot set state on an unmounted component;
- no `retry` on any call (F15).

## Constraints

- Surgical: do not change `apiGet`, `apiUrl`, `ApiError` or any read helper.
- No new dependency (F7). The hook is `useState` + `useRef` + `useCallback`.
- `ui/src/lib/edit-session.ts` imports from `@/lib/api-client` only — no React
  Router, no TanStack Query, no component import.
- No `Authorization` header appears anywhere in the diff (R3).

## Verify

`npm run test --workspace ui -- src/lib/api-client.test.ts` — append to the
existing file, keeping every current test green:

- `apiGetWithEtag` on `200` with `etag: '"abc"'` returns `{data, etag: '"abc"'}`;
  the request headers are exactly `["accept"]`.
- `apiGetWithEtag` on `200` with **no** `etag` header throws `ApiError` with
  `status === 500` and `code === "missing_etag"`.
- `apiPatch("/api/project/p1", {name:"x"}, '"abc"')` sends `method: "PATCH"`,
  header keys exactly `["accept","content-type","if-match"]`, and
  `headers["if-match"] === '"abc"'` — **byte-identical, quotes included**.
- `apiPatch` on `412` with body `{"error":{"code":"precondition_failed","message":"precondition failed","requestId":"r1"}}`
  throws `ApiError` with `status === 412`, `code === "precondition_failed"`,
  `requestId === "r1"`.
- `apiPatch` on `428` throws `ApiError` with `status === 428`,
  `code === "precondition_required"`.
- `apiPatch` on `404` throws `ApiError` with `status === 404`.
- `apiPostCreated` on `201` with `location: "/api/initiative/i1"` returns
  `{data: {id: "i1"}, location: "/api/initiative/i1"}`; on `201` with no
  `Location` throws `code === "missing_location"`; on `200` (wrong status) throws
  `ApiError` with `status === 200` — the status contract is exact.
- `apiPostNoContent` and `apiDeleteNoContent` on `204` resolve to `undefined` and
  **do not call `response.json()`** (assert with a spy on the stubbed
  `Response.prototype.json`, or a `Response` whose body would throw if parsed).
- `apiPostNoContent` on `409` with `{"error":{"code":"cycle_detected",…}}` throws
  `ApiError` with `code === "cycle_detected"`.
- Regression guard: none of the five helpers ever sets an `authorization` header
  — assert `Object.keys(headers)` for each.

`npm run test --workspace ui -- src/lib/edit-session.test.tsx` — new file, a
harness component that renders the session's status/base/draft/current and wires
buttons to `open/setDraft/submit/reload/reset`, with `load` and `save` as `vi.fn()`:

- **frozen validator**: `open()` resolves with `etag '"v1"'`; the test then calls
  `setDraft` twice and re-renders with new props; `submit()` must call `save`
  with `'"v1"'`. A test that has `load` resolve a _second_ time in the background
  (simulating a poll or focus refetch) must still submit `'"v1"'`.
- **412 → conflict**: `save` rejects `ApiError(412, "precondition_failed")`;
  status becomes `conflict`, `draft` is unchanged, `base.data` is unchanged,
  `current` equals the second `load` resolution's data, and `load` was called
  exactly twice in total.
- **reload re-arms**: from `conflict`, `reload()` resolves with `etag '"v2"'`;
  status returns to `editing`, `draft` is still the operator's, `base.etag ===
'"v2"'`, `current === null`; a following `submit()` calls `save` with `'"v2"'`
  — **not** `'"v1"'` and not a cached value.
- **second 412 repeats the cycle** with the draft intact.
- **428 → `client-defect`**, never `conflict`.
- **404 during recovery → `missing`**, and no further `load` call is scheduled
  (assert `load` call count stops growing after a `vi.advanceTimersByTime` tick
  or an awaited macrotask).
- **success**: `save` resolves; `onSaved` is called once with the saved
  `{data, etag}`; status is `closed` and `base` is `null`.
- **no retry**: after a `412`, `save` has been called exactly once.
- **stale guard**: `open()` twice with the first `load` resolving _after_ the
  second; the state reflects the second resolution only.

`npm run verify` exits 0.

Proof: none directly — this story is the substrate for phases C, D and E of
`scripts/e2e/ui-writes-proof.sh`.
