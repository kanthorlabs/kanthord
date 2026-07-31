# Story 2 — the create shell, credential create, credential metadata edit

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decisions 1, 2, 10)
Depends on: Story 1, EPIC 026.4 (`useEditSession`, `ConflictPanel`,
`invalidateFor`), EPIC 026.2 (`ProjectResourcesPage`), EPIC 026.3
(`entity-resource.tsx`).

The secret typed into the credential **create** form is a plain component
`useState` string. It goes into no query cache, no query key and no mutation —
there is no `useMutation` in this codebase (index F18). The isolated **rotation**
control is Story 3; this story does not build it.

## Change

### New file `ui/src/components/resource-create.tsx`

```tsx
export const RESOURCE_SINGULAR: Readonly<Record<ResourceTypeKey, string>> = {
  repository: "repository",
  credential: "credential",
  notification: "notification",
  filesystem: "filesystem",
};
export interface ResourceCreateProps {
  readonly projectId: string;
  readonly type: ResourceTypeKey;
}
export function ResourceCreate(props: ResourceCreateProps): ReactElement;
```

- Owns one piece of state: `open: boolean`, initially `false`.
- Always renders
  `<button type="button" data-testid="resource-create">{`New ${RESOURCE_SINGULAR[type]}`}</button>`,
  which toggles `open` to `true`.
- When `open`, renders exactly one of the four per-type create components,
  chosen by a `switch` on `type` closed with a `never` check and no `default`.
  Story 2 adds the `credential` case; Story 4 adds `repository`; Story 6 adds
  `notification` and `filesystem`. Until a case exists, that branch renders
  `null` — never a placeholder form.
- Each per-type component is given `projectId` and `onCancel={() => setOpen(false)}`.
- Renders nothing else. The permanence notice and the two honesty notes belong
  to Story 7.

### New file `ui/src/components/create-credential-resource.tsx`

```tsx
export interface CreateCredentialResourceProps {
  readonly projectId: string;
  readonly onCancel: () => void;
}
export function CreateCredentialResource(
  props: CreateCredentialResourceProps,
): ReactElement;
```

- `const [draft, setDraft] = useState<CredentialDraft>(EMPTY_CREDENTIAL_DRAFT);`
  and `const [error, setError] = useState<string | null>(null);`
- Renders `<form data-testid="resource-create-form" onSubmit={…}>` holding, in
  this order, three `Input`s with **native `name` attributes** and a `Label` each:

  | `name`     | label      | type       |
  | ---------- | ---------- | ---------- |
  | `name`     | `Name`     | `text`     |
  | `provider` | `Provider` | `text`     |
  | `value`    | `Secret`   | `password` |

  `provider` is a free-text input, not a select — the server accepts any
  non-blank string (index F10). `value` uses `type="password"` and
  `autoComplete="off"`.

- Then `<button type="submit" data-testid="resource-create-submit">Create</button>`
  and `<button type="button" onClick={onCancel}>Cancel</button>`.
- Then, when `error !== null`,
  `<p data-testid="resource-create-error" role="alert" data-role="danger" className={ROLE_CLASS.danger}>{error}</p>`.
- Submit handler, in exactly these steps:
  1. `event.preventDefault()`.
  2. `const missing = blankFields(draft, CREDENTIAL_CREATE_REQUIRED);` — when
     non-empty, `setError(\`Fill in: ${missing.join(", ")}\`)` and **return**.
     No request is issued (decision 4, client-side validation keeps the typed
     value).
  3. `const created = await createResource(projectId, "credential", credentialCreateBody(draft));`
  4. `await invalidateFor(client, "resource.create", { projectId, resourceType: "credential" });`
  5. `navigate(\`/project/${projectId}/resource/credential/${created.data.id}\`);`
(`useNavigate`, path without the `#`).
  6. On a thrown `ApiError`: `setError(resourceErrorMessage(err))` and keep the
     draft. On any other throw, rethrow.
- No `try`/`finally` that clears `draft`: unmount by navigation is what clears it
  (decision 4, success clears).

### New file `ui/src/components/edit-credential-resource.tsx`

```tsx
export interface EditCredentialResourceProps {
  readonly projectId: string;
  readonly resource: CredentialResourceDto;
}
export function EditCredentialResource(
  props: EditCredentialResourceProps,
): ReactElement;
```

- One `useEditSession<ResourceDto, CredentialMetadataDraft>`:
  ```ts
  useEditSession({
    load: () => fetchResourceWithEtag(resource.id),
    toDraft: (data) => ({ name: data.name }),
    save: (draft, ifMatch) =>
      patchResource(
        "credential",
        resource.id,
        credentialPatchBody(draft),
        ifMatch,
      ),
    onSaved: async (saved) => {
      client.setQueryData(resourceKeys.detail(resource.id), saved.data);
      await invalidateFor(client, "resource.edit", {
        projectId,
        resourceType: "credential",
        id: resource.id,
      });
    },
  });
  ```
- `status === "closed"` → only
  `<button type="button" data-testid="resource-edit-open" onClick={session.open}>Edit</button>`.
- `status === "loading"` or `"rearming"` → `AsyncBoundary` `loading`.
- `status === "missing"` → `AsyncBoundary` `missing`.
- `status === "editing" | "submitting" | "conflict" | "error"` → a
  `<form data-testid="resource-edit-form" onSubmit={…}>` with one `Input`
  `name="name"` bound to `session.draft.name` through `session.setDraft`, a
  `<button type="submit" data-testid="resource-edit-submit" disabled={status==="submitting"}>Save</button>`,
  and a Cancel button calling `session.close`.
- `status === "conflict"` → render 026.4's `ConflictPanel` inside the form, with
  `base`, `draft` and `current` mapped to the `name` field. Never auto-resubmit.
- `status === "client-defect"` → 026.4's `ClientDefectNotice`.
- `status === "error"` →
  `<p data-testid="resource-edit-error" role="alert" data-role="danger">{resourceErrorMessage(session.error)}</p>`
  inside the form; the draft stays.
- Submit is blocked (no request) when
  `blankFields(session.draft, CREDENTIAL_EDIT_REQUIRED)` is non-empty; show the
  same `Fill in: …` sentence in `resource-edit-error`.
- The form contains **no `provider` field and no secret field** (decision 1,
  decision 2).

### Edit `ui/src/pages/project-resources.tsx` (026.2 story 06)

One edit: inside the known-type branch, immediately after `<CollectionToolbar …/>`
and **outside** the `AsyncBoundary`, mount
`<ResourceCreate projectId={projectId} type={type} />`. It must render for a
known type even when the collection is empty or still loading. For an unknown
type (the `async-missing` branch) it must **not** render.

### Edit `ui/src/pages/entity-resource.tsx` (026.3 story 07)

Two edits, no new tab (index F15):

1. `ResourceSummary` gains a required prop `projectId: string`; the call site
   passes the `:projectId` route param.
2. In the `credential` branch, after the `<dl>`, render
   `<EditCredentialResource projectId={projectId} resource={resource} />`.

The tab list stays exactly `["Summary"]` and `getAllByRole("tab")` stays length
`1`.

### Edit `ui/src/pages/project-resources.test.tsx` (index F16)

Replace 026.2 story 06's assertion that no control is named
`/new|create|rename|delete|rotate|reclone/i` with the narrower pair:

- `[data-testid="resource-create"]` exists exactly once on a known type and zero
  times on an unknown type;
- there is still **no** control named `/delete|remove/i` anywhere on the page
  (index F13 — no delete route exists).

### Edit `ui/src/pages/entity-resource.test.tsx` (index F16)

Replace 026.3 story 07's `/edit|rename|delete|rotate|reclone|publish|create|new/i`
assertion and its `document.querySelectorAll("form")`-is-empty assertion with:

- no control named `/delete|remove|publish|land|reclone/i` anywhere on the page;
- `[data-testid="resource-edit-open"]` exists exactly once on a credential.

Every other assertion in both files stays byte-identical.

## Constraints

- The secret never leaves `CreateCredentialResource`'s own `useState`. Do not put
  it in a query key, `setQueryData`, a ref shared with another module, a URL, a
  `data-*` attribute, `localStorage` or `sessionStorage`, and do not log it
  (decision 3).
- No `useMutation`, no `sonner` toast, no `DangerConfirm` in this story.
- `useEditSession` is used **only** for the metadata edit. The credential's
  `value` never appears in `{base, draft, current}` (decision 2).
- Do not add a second tab to the resource workspace and do not touch
  `EntityWorkspace`.
- Do not change `ui/src/lib/query-keys.ts`, `ui/src/components/danger-confirm.tsx`
  or `scripts/e2e/**`.

## Verify

- New `ui/src/components/create-credential-resource.test.tsx` —
  `npm run test --workspace ui -- src/components/create-credential-resource.test.tsx`,
  with `vi.mock("@/lib/api-client", …)` over a `vi.importActual` spread and a real
  `QueryClient`:
  - submitting with a blank `name` calls `createResource` **zero** times and
    renders `resource-create-error` reading `Fill in: name`.
  - a full draft calls `createResource` once with
    `("p1","credential",{name:"c1",provider:"github",value:"s3cr3t"})` — assert
    the third argument's `Object.keys(...).sort()` is exactly
    `["name","provider","value"]`.
  - on success, `invalidateFor` targets
    `["project","p1","resource","credential"]` and `useNavigate`'s mock is called
    with `/project/p1/resource/credential/<newId>`.
  - a rejected `createResource` with
    `new ApiError(409,"duplicate_name","…")` renders
    `That name is already used by another resource in this project.` in
    `resource-create-error`, and the `value` input still holds `s3cr3t`
    (decision 4, definite server rejection keeps the typed value).
  - the `value` input has `type="password"` and `autoComplete="off"`.
  - after the failed submit, `JSON.stringify(client.getQueryCache().getAll().map(q => [q.queryKey, q.state.data]))`
    contains no `s3cr3t`, and `client.getMutationCache().getAll()` is empty.
- New `ui/src/components/resource-create.test.tsx`:
  - `type="credential"` renders `resource-create` with text `New credential` and
    **no** `resource-create-form` until the button is clicked; after the click
    exactly one `resource-create-form` exists.
  - `type="repository"` (no case yet) renders `resource-create` and, after the
    click, zero `resource-create-form` — assert this exact behaviour so Story 4
    has a failing-to-passing target.
- New `ui/src/components/edit-credential-resource.test.tsx`:
  - at rest only `resource-edit-open` renders; no `resource-edit-form`.
  - clicking it calls `fetchResourceWithEtag` once and then renders
    `resource-edit-form` with the `name` input holding the loaded name.
  - saving calls `patchResource` once with
    `("credential", "c1", {name:"c2",type:"credential"}, '"e1"')` — assert the
    body's `Object.keys(...).sort()` is exactly `["name","type"]` and
    `"provider" in body === false`; assert the `if-match` argument is byte-identical
    to the etag the load returned.
  - a `412` from `patchResource` renders `[data-testid="conflict"]`, keeps the
    typed draft, and calls `patchResource` exactly **once** (no retry, no
    auto-resubmit).
  - a `428` renders `[data-testid="client-defect"]`.
  - the form contains no input named `provider` and no input of
    `type="password"`.
- `npm run verify` exits 0.
- Proof: phase C of `scripts/e2e/ui-resources-proof.sh` (`:110-125`) — the
  `resource-create` control, the `resource-create-form` with `name`/`provider`/
  `value`, the `201`, the no-blank-string body check, and the secret rendering
  nowhere after create.
