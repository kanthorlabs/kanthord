# Story S5 — query option factories, AsyncBoundary, and the query→state adapter

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md` decisions 2 and 3, `docs/ui-design.md:258-261`
Dispatch note: **S5 runs before S4** — S4's route table needs `AsyncBoundary` and `useProjectSummary`.

## Change

`QueryClientProvider` already wraps the app (`ui/src/main.tsx:15-27`, `retry: 1`, `refetchOnWindowFocus: false`). Do not add a second provider and do not change `main.tsx`.

### 1. New file `ui/src/lib/queries.ts`

Only `api-client.ts` may call `fetch` (rule R3); this module builds query options over `apiGet`.

```ts
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";

export interface Health {
  readonly status: string;
  readonly version: string;
}
export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
}

/** GET /healthz → {status, version} (src/apps/http/routes.ts:266-276, enveloped). */
export function healthQueryOptions(): {
  queryKey: readonly ["healthz"];
  queryFn: () => Promise<Health>;
};

/** GET /api/project/:id → {id, name} (src/apps/http/views/project.ts:21-23). */
export function projectQueryOptions(id: string): {
  queryKey: readonly ["project", string];
  queryFn: () => Promise<ProjectSummary>;
};

export function useProjectSummary(
  id: string,
): UseQueryResult<ProjectSummary, Error>;
```

Query keys are exactly `["healthz"]` and `["project", id]`. `useProjectSummary` is `useQuery(projectQueryOptions(id))` with no extra options.

### 2. New file `ui/src/lib/async-state.ts`

```ts
export type AsyncState =
  | "loading"
  | "empty"
  | "error"
  | "missing"
  | "resolved"
  | "expired"
  | "truncated";

/** The shape of a react-query result this adapter reads — nothing more. */
export interface QueryLike<T> {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly data: T | undefined;
}

export function asyncStateOf<T>(
  query: QueryLike<T>,
  options?: { readonly isEmpty?: (data: T) => boolean },
): AsyncState;
```

Branch order is binding — evaluate top to bottom, first match wins:

1. `query.isPending` → `"loading"`
2. `query.isError` and `query.error instanceof ApiError` and `query.error.status === 404` → `"missing"`
3. `query.isError` → `"error"`
4. `query.data === undefined` → `"loading"`
5. `options?.isEmpty?.(query.data) === true` → `"empty"`
6. otherwise → `"resolved"`

`"expired"` and `"truncated"` are never produced by this adapter — they are domain states the decision queue supplies in 026.7. `asyncStateOf` never returns them; `AsyncBoundary` still renders them.

### 3. New file `ui/src/components/async-boundary.tsx`

Purely presentational over its own union — not coupled to react-query's status enum (decision 3).

```ts
export interface AsyncBoundaryProps {
  readonly state: AsyncState;
  /** Domain noun used in the message, e.g. "project", "page", "queue". */
  readonly what: string;
  /** Detail shown in the `error` state only. */
  readonly message?: string;
  readonly children?: ReactNode;
}
export function AsyncBoundary(props: AsyncBoundaryProps): ReactElement;
```

Each state renders exactly one element, with these test ids, roles and texts:

| state       | test id           | `data-role`        | text                                                    |
| ----------- | ----------------- | ------------------ | ------------------------------------------------------- |
| `loading`   | `async-loading`   | `neutral`          | `Loading {what}…`                                       |
| `empty`     | `async-empty`     | `neutral`          | `No {what} yet.`                                        |
| `error`     | `async-error`     | `danger`           | `Could not load {what}.` + `message` when given         |
| `missing`   | `async-missing`   | `attention`        | `This {what} does not exist.`                           |
| `resolved`  | `async-resolved`  | — (no `data-role`) | `children`                                              |
| `expired`   | `async-expired`   | `attention`        | `This {what} expired. Refresh to get the current one.`  |
| `truncated` | `async-truncated` | `attention`        | `This {what} is truncated. Some entries are not shown.` |

Every non-`resolved` element carries `className={cn("…", ROLE_CLASS[role])}` from `@/lib/status-role`. The `loading` state uses `Skeleton` from `@/components/ui/skeleton` beside its text. The `error` state also sets `role="alert"`.

The `switch` over `state` is exhaustive with a `never` check and no catch-all `default`.

## Constraints

- `AsyncBoundary` renders **no** `<a>`, no `NavLink`, no `Navigate`, and calls no navigation hook in any state — a missing deep-linked item "renders an explicit state and never dumps the operator back to the list" (`docs/ui-design.md:260-261`).
- `empty` must not use the `danger` role or `role="alert"` — an empty collection is a successful operational state.
- `queries.ts` and `async-state.ts` never call `fetch`; only `ui/src/lib/api-client.ts` does (rule R3).
- No new dependency. `@tanstack/react-query@5.101.4` is already installed.
- Do not touch `ui/src/main.tsx`, `ui/src/lib/api-client.ts` or `ui/src/pages/health.tsx` in this story.

## Verify

- New test file `ui/src/components/async-boundary.test.tsx` (`npm run ui:test`):
  - A table-driven test over all seven states: each renders its own test id, and no other `async-*` test id is present. Each rendered element's text content is non-empty (assert `.textContent.trim().length > 0`) — for `resolved`, pass `children` and assert the child text appears.
  - `state="empty"` has `data-role="neutral"`, is not `role="alert"`, and its `className` does not contain `text-role-danger`.
  - `state="error"` has `data-role="danger"`, is reachable by `getByRole("alert")`, and with `message="boom"` its text contains `boom`.
  - `state="missing"` renders `[data-testid="async-missing"]` and `screen.queryAllByRole("link")` is length 0.
  - Text interpolation: `what="project"` appears in the `loading`, `empty`, `error`, `missing`, `expired` and `truncated` texts.
- New test file `ui/src/lib/async-state.test.ts` (`npm run ui:test`) — one test per branch, in the pinned order:
  - `{isPending:true, isError:false, error:null, data:undefined}` → `"loading"`.
  - `{isPending:false, isError:true, error:new ApiError(404,"not_found","gone"), data:undefined}` → `"missing"`.
  - `{isPending:false, isError:true, error:new ApiError(503,"unavailable","x"), data:undefined}` → `"error"`.
  - `{isPending:false, isError:true, error:new Error("plain"), data:undefined}` → `"error"`.
  - `{isPending:false, isError:false, error:null, data:undefined}` → `"loading"`.
  - `data:[]` with `isEmpty: (d) => d.length === 0` → `"empty"`; `data:["a"]` with the same predicate → `"resolved"`.
  - `data:[]` with **no** `isEmpty` → `"resolved"` (the adapter never guesses emptiness).
  - A pending **and** error result → `"loading"` (branch order is load-bearing).
- New test file `ui/src/lib/queries.test.ts` (`npm run ui:test`), using the `vi.spyOn(globalThis, "fetch")` stub convention of `ui/src/lib/api-client.test.ts:13-34`:
  - `healthQueryOptions().queryKey` equals `["healthz"]`; awaiting its `queryFn()` against a stubbed `{"data":{"status":"ok","version":"27.8.1"}}` resolves to `{status:"ok", version:"27.8.1"}` and the recorded request URL ends with `/healthz`.
  - `projectQueryOptions("p1").queryKey` equals `["project","p1"]`; its `queryFn()` against `{"data":{"id":"p1","name":"alpha"}}` resolves to `{id:"p1",name:"alpha"}` and the recorded URL ends with `/api/project/p1`.
  - No recorded request carries an `authorization` header (rule R3), in **both** modes: with `globalThis.kanthord` unset, and with `globalThis.kanthord = { apiBaseUrl: "http://127.0.0.1:4100" }` — use the `withRuntime` helper convention of `ui/src/lib/api-client.test.ts:36-45`. In the injected-base mode the recorded URL is `http://127.0.0.1:4100/healthz`.
- `npm run verify` exits 0.
- Proof: **phase E** (`[data-testid="async-missing"]` for an unknown hash, via S4) and the transport half of **phase G** (no `Authorization` header). Phase C's health query goes through `healthQueryOptions`.
