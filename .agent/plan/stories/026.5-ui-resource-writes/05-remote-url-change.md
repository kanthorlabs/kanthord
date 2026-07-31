# Story 5 — the "Change remote URL" flow and its DangerConfirm continuation

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decisions 7, 8)
Depends on: Story 1, Story 4.

This story is `DangerConfirm`'s **first production consumer** (epic verified fact,
026.4 decision 11). A hand-rolled dialog here is a defect.

## Change

### Edit `ui/src/components/danger-confirm.tsx` (026.1)

Four additive props. Every default reproduces today's DOM byte-for-byte, so
`ui/src/components/danger-confirm.test.tsx` keeps passing unchanged.

```ts
export interface DangerConfirmProps {
  readonly trigger?: ReactNode; // was required
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly bodyTestId?: string;
  readonly confirmInnerTestId?: string;
}
```

- `<AlertDialog>` receives `open` and `onOpenChange` **only when `open !== undefined`**
  (spread a conditional object). With `open` absent the component stays
  uncontrolled, exactly as today.
- `<AlertDialogTrigger data-testid="danger-confirm-trigger">` renders only when
  `trigger !== undefined`.
- Inside `AlertDialogContent`, when `bodyTestId !== undefined`, wrap the header
  and footer in `<div data-testid={bodyTestId}>`. When it is `undefined`, render
  them directly with no extra element.
- `AlertDialogAction` keeps `data-testid="danger-confirm-accept"`,
  `variant="destructive"` and `onClick={onConfirm}`. Its child is
  `confirmLabel` when `confirmInnerTestId === undefined`, else
  `<span data-testid={confirmInnerTestId}>{confirmLabel}</span>`. The accept
  button's `innerText` is `confirmLabel` in both cases.
- `AlertDialogCancel data-testid="danger-confirm-cancel"` is unchanged.

Because `AlertDialogContent` is portalled (index F20), `bodyTestId` gives the
Proof the descendant it needs: `[data-testid="cache-conflict-confirm"]
[data-testid="confirm"]`.

### New file `ui/src/components/remote-url-change.tsx`

```tsx
export interface RemoteUrlChangeProps {
  readonly projectId: string;
  readonly resource: RepositoryResourceDto;
}
export function RemoteUrlChange(props: RemoteUrlChangeProps): ReactElement;
```

State, exactly four `useState`s:
`remoteUrl: string` (initial `resource.remoteUrl`),
`phase: "idle" | "submitting" | "conflict" | "error"` (initial `"idle"`),
`error: string | null`, `pendingUrl: string | null`.

DOM:

```tsx
<section data-testid="remote-url-change">
  <h3>Change remote URL</h3>
  <form onSubmit={onSubmit}>
    <Label htmlFor="remote-url-input">Remote URL</Label>
    <Input id="remote-url-input" name="remoteUrl" value={remoteUrl} onChange={…} />
    <button type="submit" data-testid="remote-url-submit"
            disabled={phase === "submitting"}>Change remote URL</button>
    {error === null ? null : (
      <p data-testid="remote-url-error" role="alert" data-role="danger">{error}</p>
    )}
  </form>
  <DangerConfirm
    open={phase === "conflict"}
    onOpenChange={(next) => { if (!next) { setPhase("idle"); setPendingUrl(null); } }}
    bodyTestId="cache-conflict-confirm"
    confirmInnerTestId="confirm"
    title="Change the remote URL?"
    description={`This repository has a cached local home at ${resource.path}. Continuing discards the stored home pointer. Nothing on disk is deleted, fetched or copied.`}
    confirmLabel="Change the remote URL"
    onConfirm={() => { void attempt(pendingUrl ?? "", true); }}
  />
</section>
```

`remote-url-submit` must be the only element inside
`[data-testid="remote-url-change"]` carrying `type="submit"` (the Proof clicks
`[data-testid="remote-url-change"] [type="submit"]` at
`ui-resources-proof.sh:167`).

No text rendered by this component — title, description, confirm label, cancel
label, error sentences — may match `/reclone/i` (decision 7; the Proof asserts it
at `:171-173`). The server's own message does say `--reclone`
(`src/app/resource/update-resource.ts:54-56`), which is why the `cache_conflict`
branch renders the **pinned** description above and never `error.message`.

`onSubmit`:

1. `event.preventDefault()`.
2. `const url = remoteUrl.trim();` blank → `setError("Fill in: remoteUrl")`,
   `setPhase("error")`, **no request**.
3. `void attempt(url, false)`.

`attempt(url: string, reclone: boolean)`, exactly these steps:

1. `if (url === "") return;`
2. `setPhase("submitting"); setError(null);`
3. `const fresh = await fetchResourceWithEtag(resource.id);`
4. `const saved = await patchResource("repository", resource.id, remoteUrlPatchBody(url, reclone), fresh.etag);`
5. Success → `client.setQueryData(resourceKeys.detail(resource.id), saved.data)`;
   `await invalidateFor(client, "resource.edit", {projectId, resourceType:"repository", id: resource.id})`;
   `setPendingUrl(null); setPhase("idle");`
6. Catch, in this order:
   - `err instanceof ApiError && err.status === 409 && err.code === "cache_conflict"`
     → `setPendingUrl(url); setPhase("conflict");` — this opens `DangerConfirm`
     with no operator click, which is what the Proof's
     `visible('[data-testid="cache-conflict-confirm"]')` check at `:169`
     observes.
   - otherwise → `setError(resourceErrorMessage(err)); setPhase("error");`

The continuation resends **the same URL** from `pendingUrl` and adds
`reclone: true` — `remoteUrlPatchBody` is the only builder that can emit
`reclone`, and it always emits `remoteUrl` beside it (Story 1), so a lone
`reclone` is unconstructable. Cancel calls `onOpenChange(false)`, which returns
to `idle` and issues **no** request.

### Edit `ui/src/pages/entity-resource.tsx`

In the `repository` branch of `ResourceSummary`, after
`<EditRepositoryResource …/>` (Story 4), render
`<RemoteUrlChange projectId={projectId} resource={resource} />`.

## Constraints

- `RemoteUrlChange` must not import `useEditSession` — this is a single-field
  operation with its own two-step protocol, not an edit session, and its second
  attempt must not go through a rearmed session.
- No `AlertDialog`, `Dialog`, `Sheet` or `sonner` used directly here; the only
  dialog is `DangerConfirm`.
- The word `reclone` appears in no user-visible string in `ui/**`.
- Never issue `patchResource` with `reclone` from anywhere except this
  component's confirmed continuation.
- Do not add `postData` recording to `scripts/e2e/ui-browser.mjs` — that array
  would then hold the rotation secret (index F19). Story 8 captures repository
  PATCH bodies inside the steps module instead; this story's job is to make the
  invariant true, and to assert it hermetically.

## Verify

- Extended `ui/src/components/danger-confirm.test.tsx` —
  `npm run test --workspace ui -- src/components/danger-confirm.test.tsx`. All six
  existing tests stay byte-identical; add:
  - with no `trigger`, `danger-confirm-trigger` is absent and `open={true}`
    renders `danger-confirm-dialog`, `danger-confirm-accept` and
    `danger-confirm-cancel`.
  - `open={false}` renders no `danger-confirm-dialog`.
  - `bodyTestId="x"` puts `danger-confirm-accept` and `danger-confirm-cancel`
    inside `[data-testid="x"]`; omitting `bodyTestId` renders no element with a
    wrapper test id.
  - `confirmInnerTestId="confirm"` renders `[data-testid="confirm"]` inside the
    accept button, and the accept button's `textContent` still equals
    `confirmLabel`.
  - `onOpenChange` fires with `false` when `danger-confirm-cancel` is clicked.
- New `ui/src/components/remote-url-change.test.tsx` —
  `npm run test --workspace ui -- src/components/remote-url-change.test.tsx`:
  - a blank field calls `patchResource` zero times and renders
    `remote-url-error` reading `Fill in: remoteUrl`.
  - a happy path (no conflict) calls `patchResource` once with body
    `Object.keys(...).sort()` exactly `["remoteUrl","type"]`,
    `"reclone" in body === false`, and renders no
    `danger-confirm-dialog`.
  - **the four steps of decision 7**, in one test, with `patchResource` stubbed to
    reject the first call with
    `new ApiError(409,"cache_conflict","repository r1 has a cached home clone; pass --reclone to force update")`
    and resolve the second:
    1. the initial submit issues exactly one `patchResource` whose body has no
       `reclone`;
    2. `[data-testid="danger-confirm-dialog"]` and
       `[data-testid="cache-conflict-confirm"]` both render with no operator
       click, and `cache-conflict-confirm`'s `textContent` contains the
       repository's `path` and the phrase `discards the stored home pointer`, and
       does **not** match `/reclone/i`;
    3. clicking `[data-testid="danger-confirm-cancel"]` issues **no** further
       `patchResource` and closes the dialog;
    4. re-triggering the conflict and clicking `[data-testid="danger-confirm-accept"]`
       issues exactly one further `patchResource`, whose body has
       `remoteUrl` byte-identical to the first attempt's and `reclone === true`,
       and `Object.keys(...).sort()` exactly `["reclone","remoteUrl","type"]`.
  - across the whole test file, every `patchResource` call is asserted to satisfy
    `!("reclone" in body) || typeof body.remoteUrl === "string"` — nothing ever
    sends `reclone` alone. Story 8 edit 5 checks the same invariant in the browser;
    this assertion is the hermetic half (index F19).
  - a `new ApiError(400,"invalid_input","invalid remoteUrl: must not be blank")`
    renders `remote-url-error` with the pinned `invalid_input` sentence and no
    dialog.
  - `[data-testid="remote-url-change"] [type="submit"]` has length `1`.
  - a grep-style guard: the component's rendered `document.body.textContent` after
    the conflict does not match `/reclone/i`.
- `npm run verify` exits 0.
- Proof: phase F of `scripts/e2e/ui-resources-proof.sh` (`:162-192`) and phase F2
  (`:219-223`) — the conflict surfaced, the confirmation naming the discarded home
  pointer without the word `reclone`, the continuation resending the same
  `remoteUrl` with `reclone: true`, and the stored `path` ending up empty.
