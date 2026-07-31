# Story 6 — notification and filesystem forms

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decisions 1, 8, 10)
Depends on: Story 1, Story 2.

## Change

### New file `ui/src/components/create-notification-resource.tsx`

```tsx
export interface CreateNotificationResourceProps {
  readonly projectId: string;
  readonly onCancel: () => void;
}
export function CreateNotificationResource(
  props: CreateNotificationResourceProps,
): ReactElement;
```

Same shape as Story 2's `CreateCredentialResource`, with this field set inside
`<form data-testid="resource-create-form">`, in this order:

| element                                               | `name`        | label         | detail           |
| ----------------------------------------------------- | ------------- | ------------- | ---------------- |
| `Input`                                               | `name`        | `Name`        | text             |
| native `<select data-testid="notification-provider">` | `provider`    | `Provider`    | two options only |
| `Input`                                               | `destination` | `Destination` | text             |

The provider select renders **exactly two** options, values and labels equal to
`NOTIFICATION_PROVIDERS`' literals in that order:

```tsx
<select data-testid="notification-provider" name="provider" value={draft.provider} onChange={…}>
  <option value="slack">slack</option>
  <option value="telegram">telegram</option>
</select>
```

`EMPTY_NOTIFICATION_DRAFT.provider` is `"slack"`, so the field is never blank and
`provider` is never in `blankFields`' required list (Story 1). A native
`<select>` — not `@/components/ui/select` — so the option set is directly
assertable and the server's enum (index F10) cannot be exceeded from the UI.

Validation: `blankFields(draft, NOTIFICATION_CREATE_REQUIRED)`; non-empty →
`resource-create-error` reads `` `Fill in: ${missing.join(", ")}` `` and no
request. Submit calls
`createResource(projectId, "notification", notificationCreateBody(draft))`, then
`invalidateFor(client, "resource.create", {projectId, resourceType:"notification"})`,
then `navigate(\`/project/${projectId}/resource/notification/${created.data.id}\`)`.

### New file `ui/src/components/edit-notification-resource.tsx`

```tsx
export interface EditNotificationResourceProps {
  readonly projectId: string;
  readonly resource: NotificationResourceDto;
}
export function EditNotificationResource(
  props: EditNotificationResourceProps,
): ReactElement;
```

`useEditSession<ResourceDto, NotificationEditDraft>` with
`load: () => fetchResourceWithEtag(resource.id)`,
`toDraft: (d) => ({ name: d.name, destination: d.destination })`,
`save: (draft, ifMatch) => patchResource("notification", resource.id, notificationPatchBody(draft), ifMatch)`,
and the same `onSaved` pair as Story 2 with
`resourceType: "notification"`.

Status-to-DOM mapping and `resource-edit-*` test ids are identical to Story 2.
Fields: `name` and `destination` only. The form contains **no provider control**
— `provider` is create-only (index F10) and never appears in a patch payload
(decision 1). Submit is blocked when
`blankFields(session.draft, NOTIFICATION_EDIT_REQUIRED)` is non-empty.

### New file `ui/src/components/create-filesystem-resource.tsx`

```tsx
export interface CreateFilesystemResourceProps {
  readonly projectId: string;
  readonly onCancel: () => void;
}
export function CreateFilesystemResource(
  props: CreateFilesystemResourceProps,
): ReactElement;
```

Fields: `Input name="name"` labelled `Name`, `Input name="path"` labelled `Path`.
Both required (`FILESYSTEM_CREATE_REQUIRED`). Submit calls
`createResource(projectId, "filesystem", filesystemCreateBody(draft))`, then
`invalidateFor(client, "resource.create", {projectId, resourceType:"filesystem"})`,
then `navigate(\`/project/${projectId}/resource/filesystem/${created.data.id}\`)`.

### New file `ui/src/components/edit-filesystem-resource.tsx`

```tsx
export interface EditFilesystemResourceProps {
  readonly projectId: string;
  readonly resource: FilesystemResourceDto;
}
export function EditFilesystemResource(
  props: EditFilesystemResourceProps,
): ReactElement;
```

`useEditSession<ResourceDto, FilesystemDraft>` with
`toDraft: (d) => ({ name: d.name, path: d.path })`,
`save: (draft, ifMatch) => patchResource("filesystem", resource.id, filesystemPatchBody(draft), ifMatch)`,
`resourceType: "filesystem"` in `onSaved`, fields `name` and `path`, both in
`FILESYSTEM_EDIT_REQUIRED`.

### Edit `ui/src/components/resource-create.tsx`

Add the `notification` and `filesystem` cases to the `switch`. After this edit
all four cases exist and the `never` check compiles with no branch left over.

### Edit `ui/src/pages/entity-resource.tsx`

In `ResourceSummary`'s `notification` branch, after the `<dl>`, render
`<EditNotificationResource projectId={projectId} resource={resource} />`; in the
`filesystem` branch, `<EditFilesystemResource projectId={projectId} resource={resource} />`.

## Constraints

- Native `<select>` for the provider. Never send a provider outside
  `NOTIFICATION_PROVIDERS`, and never render a third option.
- No provider field on either edit form (decision 1).
- Do not touch `rotate-secret.tsx`, `remote-url-change.tsx`, `auth-control.tsx`
  or `danger-confirm.tsx`.
- Do not touch `scripts/e2e/**`.

## Verify

- New `ui/src/components/create-notification-resource.test.tsx` —
  `npm run test --workspace ui -- src/components/create-notification-resource.test.tsx`:
  - `notification-provider` renders exactly two options with values
    `["slack","telegram"]` in that order and no third option; its initial value
    is `slack`.
  - selecting `telegram` and submitting a full draft calls `createResource` once
    with `("p1","notification",{name:"n1",provider:"telegram",destination:"#ops"})`;
    assert `Object.keys(body).sort()` is exactly
    `["destination","name","provider"]`.
  - a blank `destination` calls `createResource` zero times and
    `resource-create-error` reads `Fill in: destination`.
  - `new ApiError(400,"invalid_input",'invalid provider: must be "slack" or "telegram"')`
    renders the pinned `invalid_input` sentence.
  - on success `useNavigate`'s mock is called with
    `/project/p1/resource/notification/<newId>`.
- New `ui/src/components/edit-notification-resource.test.tsx`:
  - the form has inputs named `name` and `destination` and **no** control named
    `provider` and no `[data-testid="notification-provider"]`.
  - saving calls `patchResource` once with
    `("notification","n1", body, '"e1"')` where `Object.keys(body).sort()` is
    exactly `["destination","name","type"]`, `body.type === "notification"` and
    `"provider" in body === false`.
  - a `412` renders `[data-testid="conflict"]` and calls `patchResource` exactly
    once.
- New `ui/src/components/create-filesystem-resource.test.tsx`:
  - a blank `path` calls `createResource` zero times and reads `Fill in: path`;
    a full draft sends `Object.keys(body).sort()` exactly `["name","path"]`.
  - a `path` of `"  /srv/data  "` is sent as `/srv/data`.
- New `ui/src/components/edit-filesystem-resource.test.tsx`:
  - saving sends `Object.keys(body).sort()` exactly `["name","path","type"]` with
    `body.type === "filesystem"`.
- Extended `ui/src/components/resource-create.test.tsx`: each of the four types
  renders exactly one `resource-create-form` after the click, and the button text
  is `New repository` / `New credential` / `New notification` /
  `New filesystem` respectively.
- Extended `ui/src/pages/entity-resource.test.tsx`: a notification and a
  filesystem resource each render exactly one `resource-edit-open`; the
  notification page renders no `notification-provider` control.
- `npm run verify` exits 0.
- Proof: no phase — the Proof exercises credential and repository only. This
  story delivers the epic's hermetic requirement that the notification provider
  accepts `slack` and `telegram` only.
