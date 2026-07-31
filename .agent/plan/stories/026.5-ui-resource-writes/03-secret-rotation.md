# Story 3 — the isolated secret-rotation control

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decisions 2, 3, 4, 5)
Depends on: Story 1, Story 2.

## Change

### New file `ui/src/components/rotate-secret.tsx`

```tsx
export type RotationOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "rejected";
      readonly code: string;
      readonly message: string;
    }
  | { readonly kind: "stale" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "done" };

export interface RotateSecretProps {
  readonly resourceId: string;
}
export function RotateSecret(props: RotateSecretProps): ReactElement;
```

State is exactly two `useState`s: `value: string` (initial `""`) and
`outcome: RotationOutcome` (initial `{kind:"idle"}`). Nothing else, and neither
one is lifted, memoised into a query, or written to any client.

DOM, always rendered — there is no disclosure toggle, so the control is present
the moment the credential page is loaded:

```
<section data-testid="rotate-secret">
  <h3>Rotate the secret</h3>
  <p>The API never returns a stored secret, so it cannot confirm a new one landed.</p>
  <form onSubmit={…}>
    <Label htmlFor="rotate-secret-input">New secret</Label>
    <Input id="rotate-secret-input" data-testid="rotate-secret-input"
           type="password" autoComplete="off" name="value"
           value={value} onChange={…} />
    <button type="submit" data-testid="rotate-secret-submit" disabled={outcome.kind === "stale"}>Send rotation</button>
    <button type="button" data-testid="rotate-secret-clear" onClick={clear}>Clear</button>
    {outcome.kind === "stale" ? <button type="button" data-testid="rotate-secret-refresh" onClick={refresh}>Refresh</button> : null}
    {outcome.kind === "idle" ? null : <p data-testid="rotate-secret-status" role="alert">{sentence}</p>}
  </form>
</section>
```

`rotate-secret-submit` is the **only** element inside
`[data-testid="rotate-secret"]` carrying `type="submit"`; `Clear` and `Refresh`
are `type="button"`. The Proof clicks the section itself
(`ui-resources-proof.sh:149`) before filling, so a click anywhere in the section
must be harmless — which is why a blank submit issues no request (below).

Submit handler, exactly these steps:

1. `event.preventDefault()`.
2. `if (outcome.kind === "stale") return;`
3. `const trimmed = value.trim(); if (trimmed === "") { setOutcome({kind:"invalid"}); return; }`
   — **no request**, the typed value is kept (decision 4, first bullet).
4. `const fresh = await fetchResourceWithEtag(resourceId);`
5. `await patchResource("credential", resourceId, credentialRotationBody(value), fresh.etag);`
6. Success → `setValue("")`, `setOutcome({kind:"done"})`, then
   `await invalidateFor(client, "credential.rotate", {})`. That row invalidates
   nothing by design (Story 1) — it exists so the write has a declared row.
7. A throw from step 4 or step 5 is classified by exactly this ladder, in order:
   - `err instanceof ApiError && err.status === 412` → `{kind:"stale"}`
   - `err instanceof ApiError && err.status >= 400 && err.status < 500` →
     `{kind:"rejected", code: err.code, message: resourceErrorMessage(err)}`
   - anything else — a non-`ApiError` throw, or an `ApiError` with
     `status >= 500` → `{kind:"ambiguous"}`
     In every failure branch the `value` state is left untouched.

`clear()` sets `value` to `""` and `outcome` to `{kind:"idle"}` — decision 4's
always-available Clear.

`refresh()` calls `fetchResourceWithEtag(resourceId)`, discards the result, and
sets `outcome` to `{kind:"idle"}`, re-enabling submit. It never resubmits — the
operator must click `Send rotation` again (decision 2: never replayed
automatically after a `412`).

Pinned sentences for `rotate-secret-status`, one per outcome, all distinct:

| outcome     | sentence                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- |
| `invalid`   | `Fill in: value`                                                                            |
| `rejected`  | `` `${message} (code: ${code})` ``                                                          |
| `stale`     | `Someone else changed this credential. Refresh, then send the rotation again.`              |
| `ambiguous` | `The rotation may already have succeeded. Check with the provider before sending it again.` |
| `done`      | `Rotation sent. The API cannot confirm the stored value.`                                   |

The `done` sentence is the whole success report — the UI never says the new value
is stored (decision 5).

### Edit `ui/src/pages/entity-resource.tsx`

One edit: in the `credential` branch of `ResourceSummary`, after
`<EditCredentialResource …/>` (Story 2), render
`<RotateSecret resourceId={resource.id} />`. No new tab.

## Constraints

- `RotateSecret` must not import `useEditSession`, `ConflictPanel` or
  `ClientDefectNotice`. The secret never enters `{base, draft, current}`
  (decision 2).
- No `useMutation`, no `useQuery` holding the value, no `setQueryData`, no
  `queryKey` containing the value, no `localStorage`/`sessionStorage`/cookie
  write, no `console.*` call with the value, no `data-*` attribute holding it,
  and no value in a URL or a `Link` (decision 3).
- `rotate-secret-input` is the only place the value is readable, and only as an
  `<input type="password">` value.
- Do not add a retry, a backoff or an auto-resubmit on any failure kind.
- Do not touch `scripts/e2e/**` or `ui/src/components/danger-confirm.tsx`.

## Verify

- New `ui/src/components/rotate-secret.test.tsx` —
  `npm run test --workspace ui -- src/components/rotate-secret.test.tsx`, with
  `vi.mock("@/lib/api-client", …)` and a real `QueryClient`. Use the single
  sentinel `const SENTINEL = "sentinel-secret-must-never-be-read-back";`
  throughout:
  - **success path**: fill `rotate-secret-input` with `SENTINEL`, submit →
    `fetchResourceWithEtag` called once, `patchResource` called once with
    `("credential","c1",{value:SENTINEL,type:"credential"},'"e1"')`; assert the
    body's `Object.keys(...).sort()` is exactly `["type","value"]`;
    `rotate-secret-input` `.value` is `""`; `rotate-secret-status` reads
    `Rotation sent. The API cannot confirm the stored value.`
  - **the owned-state boundary** (decision 3), asserted after the success path
    settles **and** again after a `500` failure path, in both cases:
    - `JSON.stringify(client.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]))`
      does not include `SENTINEL`;
    - `client.getQueryCache().getAll().every((q) => !JSON.stringify(q.queryKey).includes(SENTINEL))`;
    - `client.getMutationCache().getAll()` has length `0`;
    - every key and value of `globalThis.localStorage` and
      `globalThis.sessionStorage` is free of `SENTINEL`, and `document.cookie`
      is free of it;
    - spies on `console.log`, `console.info`, `console.warn`, `console.error` and
      `console.debug` received no argument whose `String(arg)` includes
      `SENTINEL`;
    - `document.body.innerHTML` does not include `SENTINEL` (the value lives in
      the input's `value` property, not in markup).
  - **retention, one test per failure kind** (decision 4):
    - blank value → `patchResource` and `fetchResourceWithEtag` both called zero
      times; status reads `Fill in: value`; the input still holds what was typed
      (test with `"   "`).
    - `new ApiError(409,"duplicate_name","x")` from `patchResource` → status
      contains `(code: duplicate_name)`; input still holds `SENTINEL`.
    - `new ApiError(412,"precondition_failed","x")` → status reads the pinned
      stale sentence; input still holds `SENTINEL`;
      `rotate-secret-submit` has the `disabled` attribute;
      `rotate-secret-refresh` exists; clicking submit again calls `patchResource`
      exactly once in total.
    - clicking `rotate-secret-refresh` calls `fetchResourceWithEtag` again,
      re-enables `rotate-secret-submit`, keeps the input value, and calls
      `patchResource` no further times; a following submit then calls
      `patchResource` a second time.
    - a rejected `patchResource` with a plain `new TypeError("network")` → status
      reads the pinned ambiguous sentence; input still holds `SENTINEL`.
    - an `ApiError` with `status: 503` → the same ambiguous sentence (not
      `rejected`).
    - `rotate-secret-clear` after any failure empties the input and removes
      `rotate-secret-status`.
    - unmounting the component after a failure and remounting it gives an empty
      input and no status.
  - **rotation never touches the conflict layer** (decision 2), in this file:
    render the credential resource page with `RotateSecret` and
    `EditCredentialResource` mounted, type `SENTINEL` into
    `rotate-secret-input`, then open the metadata edit and make its
    `patchResource` reject with `new ApiError(412,"precondition_failed","x")` →
    `[data-testid="conflict"]` renders, `conflict-base`, `conflict-draft` and
    `conflict-current` contain no `SENTINEL`, `rotate-secret-input` still holds
    `SENTINEL`, and no PATCH carrying a `value` key was ever issued.
  - `rotate-secret-submit` is the only `[data-testid="rotate-secret"] [type="submit"]`
    in the section (`querySelectorAll` length `1`).
- `npm run verify` exits 0.
- Proof: phase E of `scripts/e2e/ui-resources-proof.sh` (`:146-160`) — the
  isolated control, the `200`, the cleared input, the absent `provider` key and
  the `type: "credential"` probe; plus phase C2 (`:212-217`) confirming the
  secret is in no read response and not in the daemon log.
