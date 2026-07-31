# Story 8 — the W3 review screen at `#/inbox/:decisionId/review`

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Story 6 (candidate routes), Story 7 + Story 9 (verdict routes),
EPIC 026.8 Story 7 (`ui/src/pages/decision.tsx`, `#/inbox/:decisionId`,
`decisionQueryOptions` / `useDecision`).

This is the UI workspace's first write. `ui/src/lib/api-client.ts` exports only
`apiGet`; there is no `useMutation` anywhere, no `useState` anywhere, and no
`<form>` anywhere. Everything below is therefore pinned, not left to taste.

**Stop and report if `ui/src/pages/decision.tsx` does not exist** — 026.8 is the
prerequisite and this story extends it rather than re-creating it.

## Change

### 1. `ui/src/lib/api-client.ts` — add the one write function

Append after `apiGet` (`:56-80`), same module, because this file is the only
one allowed to call `fetch` (rule R3, header comment `:1-7`):

```ts
/** POST a JSON body to a route and unwrap its `data`. Throws ApiError on non-2xx. */
export async function apiPost<T>(
  path: string,
  body: unknown,
  init?: { readonly signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  const parsed: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const err = (parsed as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }

  return (parsed as DataEnvelope<T>).data;
}
```

It never sets `Authorization` — same rule, same reason.

### 2. `ui/src/lib/queries.ts` — the candidate query and the verdict mutations

Add the wire interfaces (mirroring `views/candidate.ts` and `views/verdict.ts`
field for field), then:

```ts
export function candidateQueryOptions(
  subject: "task" | "objective",
  id: string,
) {
  return {
    queryKey: ["candidate", subject, id] as const,
    queryFn: (ctx?: { readonly signal?: AbortSignal }): Promise<Candidate> =>
      apiGet<Candidate>(`/api/${subject}/${encodeURIComponent(id)}/candidate`, {
        signal: ctx?.signal,
      }),
  };
}
export function useCandidate(
  subject: "task" | "objective",
  id: string,
): UseQueryResult<Candidate, Error>;

export function useApprove(
  subject: "task" | "objective",
  id: string,
): UseMutationResult<Approval, Error, ApproveBody>;
export function useReject(
  subject: "task" | "objective",
  id: string,
): UseMutationResult<Rejection, Error, RejectBody>;
```

Pinned mutation convention — this is the workspace's first, so it is fixed here
and every later epic follows it:

- `useMutation({ mutationFn: (body) => apiPost<T>(path, body) })` with an
  explicit `UseMutationResult<T, Error, Body>` return annotation, matching the
  `UseQueryResult` annotation style at `queries.ts:37-41`.
- **No `onSuccess` cache invalidation inside the hook.** The screen re-renders
  from the mutation's own `data` (epic decision 12: the resolved state renders
  in place). A list the server has not re-stated is never mutated client-side —
  the Inbox stays manual-refresh (026.7 decision 6).
- `ApproveBody` is `{ decisionId: string; expectedCommit: string | null }` for a
  task and `{ decisionId: string; expectedCommit: string }` for an objective;
  `RejectBody` is
  `{ decisionId: string; resolution: "retry" | "discard"; reason?: string; dryRun?: boolean; expectImpact?: string; expectedCommit?: string }`.

### 3. New page `ui/src/pages/review.tsx` — `export function ReviewPage(): ReactElement`

Layout, top to bottom — **evidence first, response last**
(`docs/ui-design.md:219`):

1. `<div data-testid="review-shell">` wrapping everything.
2. The decision header: `useDecision(decisionId)` (026.8) gives the subject
   type, subject id and names. While it is not `resolved`, render
   `<AsyncBoundary state={…} what="decision" />` and **nothing else** — no
   controls before the subject is known.
3. Evidence: `useCandidate(subject, subjectId)`.
   - non-`resolved` → `<AsyncBoundary state={…} what="candidate" />`.
   - `available === false` →
     `<div data-testid="review-diff-unavailable" data-reason={unavailableReason}>`
     with the sentence
     `No diff to show (<reason>). You are approving without seeing the change.`
     plus `<CommandHandoff command={…} reason="the daemon cannot read this candidate's objects." />`
     when `inspect` is non-null. The command string is built **only** by joining
     `[inspect.executable, ...inspect.args]` with a space and POSIX-quoting any
     token containing whitespace — no token the UI chose (026.7 decision 10, as
     amended).
   - `available === true` → one `<div data-testid="review-file" data-path={f.path} data-status={f.status}>`
     per file, in the DTO's order, each showing path, `+additions`,
     `−deletions`, and:
     - `omitted !== null` → `<div data-testid="review-file-omitted" data-omitted={f.omitted}>`
       with `too-large` → "patch not shown: over the size limit",
       `binary` → "binary file", `budget` → "patch not shown: response size limit".
     - else `<pre>{f.patch}</pre>`.
   - `truncated === true` → `<div data-testid="review-truncated">Showing {files.length} of {totalFiles} files.</div>`
     above the file list.
4. Response, last: `<div data-testid="review-response">` holding
   - `<button data-testid="review-approve">` — `disabled` while
     `approve.isPending`. On click it posts
     `{ decisionId, expectedCommit: candidate.head }` for a task, and
     `{ decisionId, expectedCommit: candidate.head }` for an objective. When
     `candidate.head` is `null` (a task escalation with no commit) it posts
     `expectedCommit: null`. **The value always comes from the candidate DTO's
     own `head`** — never from the queue, never typed by the operator.
   - `<button data-testid="review-reject">` with a `<Textarea>` for the optional
     reason (`ui/src/components/ui/textarea.tsx`, currently imported by nothing)
     for the `retry` resolution.
   - The `discard` control is wrapped in `<DangerConfirm>`
     (`ui/src/components/danger-confirm.tsx`), whose `trigger` carries
     `data-testid="review-discard"`, `title` "Discard this work?",
     `confirmLabel` "Discard".
5. Result, in place: when a verdict mutation succeeds, replace the response
   region with `<div data-testid="review-resolved" data-outcome={data.outcome}>`
   naming the outcome, plus a "Next open item" link as the primary action and
   "Back to inbox" (`#/inbox`) as secondary. **Never call `navigate()`**
   (epic decision 12).
   An `outcome` of `"conflict"` renders `review-resolved` with
   `data-outcome="conflict"` and a link to the conflict route — it is a real
   result, not a success banner (epic decision 11).
6. Refusals: a mutation error that is an `ApiError` with status `409` renders
   `<div data-testid="review-stale" data-code={error.code}>` carrying the
   server's message and a "Refresh" button that refetches the decision and the
   candidate. Any other error renders `<AsyncBoundary state="error" …/>`.

State is held with `useState` (the workspace's first): the reason text, the
dry-run digest, and nothing else. The two mutation results come from
react-query, not from state.

### 4. The discard round trip (epic decision 10)

`review-discard`'s confirm handler runs **two** requests, in order:

1. `reject.mutateAsync({ decisionId, resolution: "discard", dryRun: true, … })`
   → store `data.preview.digest` in state and render
   `<div data-testid="review-damage">` listing every `preview.damage` entry.
2. Only after the operator confirms the damage does the second call go out, with
   `expectImpact: <the stored digest>` and no `dryRun`.

The component must be **unable** to send a discard without a digest: the second
call is guarded by `digest !== null`, and the test below asserts it.

### 5. `ui/src/app/routes.tsx`

- `ROUTE_TABLE` (`:31-42`): add `{ path: "/inbox/:decisionId/review", kind: "screen" }`
  immediately after 026.8's `/inbox/:decisionId` row. `kind: "screen"` takes no
  `epic` field (`routes.test.tsx:73-82`).
- The router: add a child of the `GlobalShellLayout` branch (`:80-96`) with
  `path: "/inbox/:decisionId/review"`, `element: <ReviewPage />`.

### 6. `ui/src/app/routes.test.tsx`

026.8 Story 7 already rewrites the `/inbox/` prohibition at `:84-93`; extend the
`EXPECTED_PATHS` list (`:43-58`) with the new path in its table position.

## Constraints

- `apiPost` is the only new `fetch` call site in the workspace.
- No `Authorization` header in any ui/ module, ever.
- No optimistic update, no `invalidateQueries`, no `navigate()` after a verdict.
- The approve control renders even when the diff is unavailable (epic
  decision 13). Do not disable it on `available === false`.
- The UI assembles no CLI tokens; it only joins and quotes the server's argv.

## Verify

- `node --test` is not used here; the workspace uses Vitest —
  `npm --prefix ui run test`.
- `ui/src/lib/api-client.test.ts` — `apiPost` sends `method: "POST"`, a
  `content-type: application/json` header, the exact JSON body, and **no**
  `authorization` key in `headers`; a `409` response throws `ApiError` carrying
  the envelope's `code` and `status`; a non-JSON error body still throws with
  the fallback code.
- `ui/src/lib/queries.test.ts` — `candidateQueryOptions("objective", "o 1")`
  produces `queryKey ["candidate","objective","o 1"]` and calls
  `apiGet("/api/objective/o%201/candidate", { signal })`; the two mutation hooks
  call `apiPost` with the right path and body and declare **no** `onSuccess`.
- `ui/src/pages/review.test.tsx` — mocking `@/lib/api-client` at module level
  per `operations.test.tsx:18-26`, `renderWithQuery` per `:28-37`:
  - the file list renders one `review-file` per DTO file, **in the DTO's
    order**, with the `data-path`/`data-status` attributes;
  - a file with `omitted: "too-large"` renders `review-file-omitted` and no
    `<pre>`; a `binary` file likewise; a `budget` file likewise;
  - `truncated: true` renders `review-truncated` naming `totalFiles`;
  - `available: false` renders `review-diff-unavailable` with the reason, and
    `review-approve` is **still present and enabled**;
  - `inspect` non-null renders `command-handoff` whose command is exactly
    `[executable, ...args].join(" ")` with quoting, and contains no token absent
    from the DTO;
  - clicking `review-approve` calls `apiPost` once with
    `/api/objective/<id>/approval` and the body
    `{ decisionId, expectedCommit: <the candidate DTO's head> }` — asserted
    against a head value that differs from every other oid in the fixture, so a
    wrong-source bug cannot pass;
  - a task candidate whose `head` is `null` posts `expectedCommit: null`;
  - a `200` with `outcome: "approved"` renders `review-resolved` and
    `window.location.hash` is **unchanged**;
  - a `200` with `outcome: "conflict"` renders `review-resolved` with
    `data-outcome="conflict"`, not a success wording;
  - an `ApiError(409, "decision_closed", …)` renders `review-stale` with
    `data-code="decision_closed"`, the file list stays on screen, and no
    `async-error` is rendered;
  - an `ApiError(500, …)` renders `async-error`, not `review-stale`;
  - the discard flow: confirming `review-discard` issues **one** request with
    `dryRun: true`, renders `review-damage` from its preview, and issues no
    second request until the confirm; the second request carries
    `expectImpact` equal to the first response's digest and no `dryRun`;
  - **the guard**: a test that confirms discard twice without the dry-run
    response resolving issues no request carrying `resolution: "discard"`
    without `expectImpact`. Collect every `apiPost` call and assert none
    matches "discard without expectImpact".
- `ui/src/app/routes.test.tsx` — `#/inbox/<id>/review` renders `review-shell`
  inside `global-shell`; `EXPECTED_PATHS` matches the table exactly.
- `npm run verify` exits 0 (it runs `ui` typecheck, `ui` eslint, vitest and
  `build:ui`).
- Proof: phase G, every label.
