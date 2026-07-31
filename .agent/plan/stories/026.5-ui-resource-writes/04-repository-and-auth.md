# Story 4 — repository create/edit and the discriminated auth control

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decisions 1, 6, 8, 10)
Depends on: Story 1, Story 2.

## Change

### New file `ui/src/components/auth-control.tsx`

```tsx
export interface AuthControlProps {
  readonly projectId: string;
  readonly authKind: AuthKind;
  readonly credentialId: string;
  readonly onChange: (next: {
    authKind: AuthKind;
    credentialId: string;
  }) => void;
}
export function AuthControl(props: AuthControlProps): ReactElement;
```

- A **native `<select>`**, not shadcn/Radix `Select`: the Proof calls
  `selectOption` (`ui-resources-proof.sh:133,135`), which only drives a real
  `<select>`.

  ```tsx
  <select data-testid="auth-kind" name="authKind" value={authKind} onChange={…}>
    <option value="ambient">ambient</option>
    <option value="ssh-agent">ssh-agent</option>
    <option value="https-token">https-token</option>
  </select>
  ```

  Option order and values are exactly `AUTH_KINDS`' three literals. Changing the
  kind away from `https-token` calls
  `onChange({authKind: next, credentialId: ""})`; changing it **to**
  `https-token` calls `onChange({authKind: "https-token", credentialId: ""})`.

- The credential picker renders **only** when `authKind === "https-token"`:

  ```tsx
  <select data-testid="auth-credential" name="credentialId" value={credentialId} onChange={…}>
    <option value="">Choose a credential</option>
    {credentials.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
  </select>
  ```

  `credentials` comes from
  `useQuery({ queryKey: projectKeys.resources(projectId, "credential"), queryFn: ({signal}) => fetchResources(projectId, "credential", undefined, {signal}), staleTime: Infinity })`,
  sorted by `name` with `a.name.localeCompare(b.name)` so the option order is
  deterministic. The query is **not created** while `authKind !== "https-token"`
  — gate it with `enabled: authKind === "https-token"`.

- Directly under the picker, always when the picker renders:

  ```tsx
  <p data-testid="auth-credential-note">
    This is a credential this project can see. The server does not check that
    the reference is valid.
  </p>
  ```

  That sentence is decision 6's accurate guarantee. Do not soften it and do not
  add a provider-compatibility rule of any kind.

### New file `ui/src/components/create-repository-resource.tsx`

```tsx
export interface CreateRepositoryResourceProps {
  readonly projectId: string;
  readonly onCancel: () => void;
}
export function CreateRepositoryResource(
  props: CreateRepositoryResourceProps,
): ReactElement;
```

Same shape as `CreateCredentialResource` (Story 2) with these differences:

- `useState<RepositoryDraft>(EMPTY_REPOSITORY_DRAFT)`, whose `authKind` starts at
  `"ambient"` and `credentialId` at `""`.
- `<form data-testid="resource-create-form">` holds, in this order, four `Input`s
  with native `name` attributes, then `<AuthControl …/>`:

  | `name`      | label                   | required |
  | ----------- | ----------------------- | -------- |
  | `name`      | `Name`                  | yes      |
  | `remoteUrl` | `Remote URL`            | yes      |
  | `branch`    | `Branch`                | yes      |
  | `path`      | `Local path (optional)` | no       |

  The `path` input's placeholder is
  `left empty, the daemon derives it from the remote URL`. A blank `path` is
  **omitted** from the body by `repositoryCreateBody` — the UI never sends `""`
  (index F2).

- Validation before any request:
  `[...blankFields(draft, REPOSITORY_CREATE_REQUIRED), ...authIssues(draft)]`.
  Non-empty → `resource-create-error` reads `` `Fill in: ${missing.join(", ")}` ``
  and no request is issued.
- Submit calls
  `createResource(projectId, "repository", repositoryCreateBody(draft))`, then
  `invalidateFor(client, "resource.create", {projectId, resourceType:"repository"})`,
  then `navigate(\`/project/${projectId}/resource/repository/${created.data.id}\`)`.
- `ApiError` → `setError(resourceErrorMessage(err))`, draft kept.

### New file `ui/src/components/edit-repository-resource.tsx`

```tsx
export interface EditRepositoryResourceProps {
  readonly projectId: string;
  readonly resource: RepositoryResourceDto;
}
export function EditRepositoryResource(
  props: EditRepositoryResourceProps,
): ReactElement;
```

- One `useEditSession<ResourceDto, RepositoryDraft>`:
  - `load: () => fetchResourceWithEtag(resource.id)`
  - `toDraft`: `name`, `branch`, `path` from the DTO; `remoteUrl` from the DTO
    (carried in the draft so the field grammar stays one type, but **never sent** —
    `repositoryPatchBody` omits it, Story 1); `authKind = data.auth.kind`;
    `credentialId = data.auth.kind === "https-token" ? data.auth.credentialId : ""`.
  - `save: (draft, ifMatch) => patchResource("repository", resource.id, repositoryPatchBody(draft), ifMatch)`
  - `onSaved`: `setQueryData(resourceKeys.detail(resource.id), saved.data)` then
    `invalidateFor(client, "resource.edit", {projectId, resourceType:"repository", id: resource.id})`.
- Status-to-DOM mapping, `resource-edit-*` test ids, `ConflictPanel`,
  `ClientDefectNotice` and the blocked-submit rule are **identical** to Story 2's
  `EditCredentialResource`; the only difference is the field set:
  `name`, `branch`, `path`, plus `<AuthControl …/>`. There is **no `remoteUrl`
  field in this form** — Story 5 owns that operation.
- Submit is blocked when
  `[...blankFields(session.draft, REPOSITORY_EDIT_REQUIRED), ...authIssues(session.draft)]`
  is non-empty.

### Edit `ui/src/components/resource-create.tsx`

Add the `repository` case to the `switch`, rendering
`<CreateRepositoryResource projectId={projectId} onCancel={onCancel} />`.

### Edit `ui/src/pages/entity-resource.tsx`

In the `repository` branch of `ResourceSummary`, after the `<dl>`, render
`<EditRepositoryResource projectId={projectId} resource={resource} />`.

## Constraints

- Native `<select>` only, for both `auth-kind` and `auth-credential`. No
  `@/components/ui/select`, no `Popover`, no `Command`.
- A partial auth object is impossible: the only builder is
  `repositoryAuthOf`, which throws on a blank `credentialId` under
  `https-token` (Story 1). Never assemble an auth object inline.
- `repositoryPatchBody` must stay the only patch builder used here, so no edit
  can ever send `remoteUrl` or `reclone` (decision 7).
- Do not validate the remote URL, the branch name or the path in the UI. Do not
  reject a remote URL with embedded userinfo client-side — let the server answer
  `embedded_credential` and render `resourceErrorMessage`.
- Do not touch `rotate-secret.tsx`, `danger-confirm.tsx` or `scripts/e2e/**`.

## Verify

- New `ui/src/components/auth-control.test.tsx` —
  `npm run test --workspace ui -- src/components/auth-control.test.tsx`:
  - with `authKind="ambient"`, `auth-kind` renders three options with values in
    the exact order `["ambient","ssh-agent","https-token"]`, and
    `auth-credential` is absent and `fetchResources` is called **zero** times.
  - selecting `https-token` calls `onChange` with
    `{authKind:"https-token", credentialId:""}`.
  - with `authKind="https-token"` and two credentials named `zeta` and `alpha`,
    `auth-credential` renders four options: `["", "<alpha id>", "<zeta id>"]`
    values with the first option's label `Choose a credential` and the remaining
    labels sorted `alpha`, `zeta`.
  - `auth-credential-note` renders the pinned sentence verbatim, and no text on
    the control matches `/valid|verified|checked and/i` other than that sentence.
  - selecting `ambient` from `https-token` calls `onChange` with
    `{authKind:"ambient", credentialId:""}`.
- New `ui/src/components/create-repository-resource.test.tsx`:
  - a draft with `authKind:"https-token"` and no credential chosen calls
    `createResource` zero times and `resource-create-error` reads
    `Fill in: credentialId`.
  - a full draft with a blank `path` calls `createResource` once; assert the body
    `Object.keys(...).sort()` is exactly `["auth","branch","name","remoteUrl"]`,
    `body.auth` deep-equals `{kind:"https-token",credentialId:"c1"}`, and
    `JSON.stringify(body)` does not match `/:\s*""/`.
  - the same draft with `path:" /m/r "` sends `path === "/m/r"`.
  - `authKind:"ambient"` sends `body.auth` deep-equal to `{kind:"ambient"}` with
    one key.
  - `new ApiError(400,"embedded_credential","…")` renders
    `Put the token in a credential, not in the URL.` and keeps the typed
    `remoteUrl`.
  - on success, `useNavigate`'s mock is called with
    `/project/p1/resource/repository/<newId>`.
- New `ui/src/components/edit-repository-resource.test.tsx`:
  - opening the session calls `fetchResourceWithEtag` once; the form has inputs
    named `name`, `branch`, `path` and **no** input named `remoteUrl`.
  - saving calls `patchResource` once with
    `("repository","r1", body, '"e1"')` where `Object.keys(body).sort()` is
    exactly `["auth","branch","name","path","type"]`, `body.type === "repository"`,
    `"remoteUrl" in body === false` and `"reclone" in body === false`.
  - a DTO with `auth:{kind:"https-token",credentialId:"c1"}` opens with
    `auth-kind` reading `https-token` and `auth-credential` reading `c1`.
  - a `412` renders `[data-testid="conflict"]` and calls `patchResource` exactly
    once.
  - a blank `branch` blocks submit: `patchResource` called zero times,
    `resource-edit-error` reads `Fill in: branch`.
- Extended `ui/src/components/resource-create.test.tsx`: `type="repository"`
  now renders exactly one `resource-create-form` after the click, containing
  `auth-kind`.
- Extended `ui/src/pages/entity-resource.test.tsx`: a repository resource renders
  exactly one `resource-edit-open`, and still zero controls named
  `/delete|remove|publish|land|reclone/i`.
- `npm run verify` exits 0.
- Proof: phase D of `scripts/e2e/ui-resources-proof.sh` (`:127-144`) — the
  repository form, `auth-kind` selectable to `https-token`, `auth-credential`
  appearing only then and pickable by the credential's label, the `201`, the
  complete `auth` object with a `credentialId`, and no blank `path`.
