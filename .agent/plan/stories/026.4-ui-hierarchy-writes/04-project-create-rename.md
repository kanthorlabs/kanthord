# Story 04 — project create and rename on the Projects collection

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decisions 6, 7)
Depends on: Stories 01, 02, 03.

## Change

### 1. `ui/src/lib/api-client.ts` — two typed helpers

```ts
export async function createProject(
  name: string,
): Promise<Created<{ id: string }>>;
// apiPostCreated("/api/project", { name })
export async function renameProject(
  id: string,
  name: string,
  ifMatch: string,
): Promise<Etagged<ProjectDto>>;
// apiPatch(`/api/project/${encodeURIComponent(id)}`, { name }, ifMatch)
export async function fetchProjectWithEtag(
  id: string,
): Promise<Etagged<ProjectDto>>;
// apiGetWithEtag(`/api/project/${encodeURIComponent(id)}`)
```

### 2. `ui/src/components/create-project.tsx` — new file

```ts
export function CreateProject(): ReactElement;
```

- A `Button` with `data-testid="create-project"`, label `New project`, that opens
  a shadcn `Sheet` (epic decision 8: name-only forms are Sheets).
- Inside: `<form data-testid="create-project-form" onSubmit={…}>` with
  `preventDefault` (F8), an `Input` `data-testid="create-project-name"` bound to
  one `useState<string>`, and a submit `Button`
  `data-testid="create-project-submit"`.
- The submit is `disabled` while the name is blank after `trim()`, and while a
  request is in flight. **No client-side name rules beyond blank** — the daemon
  owns validation.
- On submit call `createProject(name.trim())`. On success:
  `await invalidateFor(client, "project.create", {})`, clear the field, close the
  Sheet. On `ApiError`: render the server's `message` in
  `<p data-testid="create-project-error" role="alert" data-role="danger">` and
  keep the Sheet open with the typed name intact.
- No toast, no navigation on success.

### 3. `ui/src/components/rename-project.tsx` — new file

```ts
export interface RenameProjectProps {
  readonly projectId: string;
  readonly name: string;
}
export function RenameProject(props: RenameProjectProps): ReactElement;
```

- Trigger: `Button` `data-testid="rename-open"`, `variant="ghost"`, `size="sm"`,
  label `Rename`, `aria-label={\`Rename ${name}\`}`. It opens the `Sheet`.
- The Sheet's body is `<form data-testid="rename-form">` with `Input`
  `data-testid="rename-input"` and submit `Button` `data-testid="rename-submit"`.
- Wire `useEditSession<ProjectDto, string>` (story 01) with:
  - `load: () => fetchProjectWithEtag(projectId)`,
  - `toDraft: (p) => p.name`,
  - `save: (draft, ifMatch) => renameProject(projectId, draft.trim(), ifMatch)`,
  - `onSaved: async ({data}) => { client.setQueryData(projectKeys.detail(projectId), data);
await invalidateFor(client, "project.rename", {id: projectId}); }`.
- `open()` fires when the Sheet opens; `close()` when it closes. **The Sheet's
  open state never resets `base` on a re-render** — only `close()` does.
- Render by `session.status`:
  - `loading` / `rearming` → the form with the input `disabled`;
  - `editing` / `submitting` → the form; `rename-submit` `disabled` while
    `submitting` or the trimmed draft is blank;
  - `conflict` → the form **plus** `<ConflictPanel base={session.base.data}
draft={session.draft} current={session.current} describe={v => typeof v ===
"string" ? v : v.name} onReload={session.reload}
reloading={false} />`, rendered **below the still-editable input**, which
    still holds the operator's draft;
  - `client-defect` → `<ClientDefectNotice requestId={session.error?.requestId} />`
    instead of the conflict panel;
  - `missing` → `<AsyncBoundary state="missing" what="project" />` inside the
    Sheet;
  - `error` → the form plus the server `message` in
    `<p data-testid="rename-error" role="alert">`.
- After a successful save the Sheet closes.

### 4. `ui/src/pages/projects.tsx` — mount the two controls

- Render `<CreateProject />` in the collection toolbar, next to
  `collection-search`.
- Add one trailing `<TableCell>` per row of `project-table` holding
  `<RenameProject projectId={row.id} name={row.name} />`, and a matching
  `<TableHead>` with an `sr-only` label `Actions`. The row keeps its
  `data-project-id`, so the Proof's
  `tr[data-project-id="…"] [data-testid="rename-open"]` resolves.
- Change nothing else on the page: search, detail pane, async states and
  polling behaviour stay as 026.2 built them.

### 5. Amend 026.2 story 03's no-write assertion (F16)

In `ui/src/pages/projects.test.tsx`, the assertion that
`queryAllByRole("button", { name: /new|create|rename|delete/i })` is empty is now
false by design. Replace it with: the page exposes exactly one
`create-project` button and exactly one `rename-open` per rendered row, and
**no** button matching `/delete|remove/i` — no delete route exists. If the
prerequisite landed that assertion in a different form, adapt to what is in the
tree; do not delete the guard.

## Constraints

- Two separate components, no generic `<RenameForm entity=…>` (epic decision 7).
- `rename-open` is per row; there is no bulk rename and no inline edit-in-place.
- The rename must issue **exactly one PATCH per submit** and never retry (F15) —
  the Proof counts them.
- Do not add a delete control anywhere (epic non-goals).

## Verify

`npm run test --workspace ui -- src/components/create-project.test.tsx` — new file:

- typing a name and submitting calls `createProject` once with the trimmed name;
- a blank or whitespace-only name leaves `create-project-submit` disabled and
  issues no request;
- a `409 duplicate_name` renders `create-project-error` with the server's
  message, the Sheet stays open, and the typed name is still in the input;
- on success `invalidateFor` is called with `"project.create"`.

`npm run test --workspace ui -- src/components/rename-project.test.tsx` — new file:

- opening the Sheet calls the detail `GET` once and pre-fills `rename-input` with
  the current name;
- submitting sends `if-match` equal to the `ETag` from that `GET`, byte-identical;
- **the frozen validator end to end**: after the Sheet is open and the input is
  dirty, a `setQueryData(projectKeys.detail(id), {id, name:"changed"})` on the
  shared client does not change the `if-match` the submit sends;
- a stubbed `412` renders `conflict`, keeps `rename-input`'s draft, and fills
  `conflict-base` / `conflict-draft` / `conflict-current` from the base, the
  draft and the recovery `GET`;
- clicking `conflict-reload` then submitting sends the **recovery** `GET`'s ETag;
- a stubbed `428` renders `client-defect` and no `conflict`;
- on success: `setQueryData` wrote the response's data to
  `projectKeys.detail(id)`, `invalidateFor` was called with `"project.rename"`,
  and the Sheet closed;
- exactly one PATCH per submit — assert the call count after a `412` is 1.

`npm run test --workspace ui -- src/pages/projects.test.tsx` — extended:

- `create-project` renders once; each `tr[data-project-id]` holds exactly one
  `rename-open`;
- the amended write-control guard above;
- every 026.2 assertion still passes unchanged.

`npm run verify` exits 0.

Proof: `ui-writes-proof.sh:154-156` (`rename-open` inside the project row,
`rename-input`), `:160-177` (the 412 and the recovery resubmit), `:179`
(`project-table` shows the new name), `:202-203` (exactly two project PATCHes).
