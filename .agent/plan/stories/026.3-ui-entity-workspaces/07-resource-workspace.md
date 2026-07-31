# Story 07 — resource W2, Summary only

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decision 5, resource row)
Depends on: Story 01, Story 02.

## Change

### Edit `ui/src/pages/entity-resource.tsx`

Replace `tabs={[]}` with exactly one tab. **"Edit" is an action, not a tab**, and
it belongs to EPIC 026.5 (decision 5) — do not add a second tab, a second
`role="tab"`, or an edit control.

```ts
const tabs = [
  { value: "summary", label: "Summary", panel: <ResourceSummary resource={resource} /> },
];
```

`ResourceSummary` lives in this same file and switches on the DTO's `type`
discriminant. Field grammar per type, matching EPIC 026.2 Story 06's column
grammar so the collection and the entity page cannot drift:

| type           | `<dl>` rows, in this order                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `repository`   | `Name` · `Remote` (`remoteUrl`) · `Branch` (`branch`) · `Path` (`path`) · `Auth` · `Publication` |
| `credential`   | `Name` · `Provider` (`provider`)                                                                 |
| `notification` | `Name` · `Provider` (`provider`) · `Destination` (`destination`)                                 |
| `filesystem`   | `Name` · `Path` (`path`)                                                                         |

Pinned value rendering:

- `Name` → `<span data-testid="resource-name">{resource.name}</span>`
- `Remote` → `<code data-testid="resource-remote-url">`,
  `Branch` → `<code data-testid="resource-branch">`,
  `Path` → `<code data-testid="resource-path">`,
  `Provider` → `<span data-testid="resource-provider">`,
  `Destination` → `<span data-testid="resource-destination">`
- `Auth` → `<span data-testid="resource-auth-kind">{auth.kind}</span>` plus, when
  `auth.kind === "https-token"`,
  `<code data-testid="resource-auth-credential">{auth.credentialId}</code>`.
  `auth` is normalized server-side to one of three shapes and silently downgrades
  to `{kind:"ambient"}` for anything unrecognised
  (`src/apps/http/views/shared.ts:93-104`) — render `auth.kind` verbatim, do not
  re-interpret it.
- `Publication` →
  `<span data-testid="resource-publication">{resource.publication === null ? "—" : publicationLabel(resource.publication)}</span>`.
  `publicationLabel` is EPIC 026.1's
  (`ui/src/lib/status-role.ts:115`) — never re-implement the `published@<oid>`
  format. `GET /api/resource/:id` is the **only** route that fills `publication`
  (index.md F3 / EPIC 026.2 index.md F5), and this page reads exactly that route,
  so a real state shows here even though the list row always says `—`.
- An unhandled `type` cannot reach the panel: Story 01's `resourceScope` turns a
  URL type that disagrees with the DTO into a `resource-type` mismatch, and the
  DTO's own union is exhaustive. Close the `switch` with a `never` check and no
  catch-all `default`.

A `credential` renders `name` and `provider` and nothing else. There is no
`value` on the wire (`src/app/resource/resource-view.ts` builds an explicit field
list) and none may be rendered — the Proof asserts the seeded secret appears
nowhere in the document (`ui-entities-proof.sh:175`).

## Constraints

- One tab. No Edit tab, no edit form, no rotate/delete/reclone/publish control
  (decision 5, decision 9, 026.2 decision 8).
- No `ETag` capture and no `If-Match` handling — 026.5 owns writes.
- Reuse `resourceKeys.detail` and `fetchResource` from EPIC 026.2 Story 02; add no
  second key and no second helper.
- Reuse `RESOURCE_TYPE_LABEL` (Story 02) for the breadcrumb level; do not add a
  second label map.
- Do not touch `ui/src/pages/project-resources.tsx` (026.2 Story 06). Its route
  `/project/:id/resource/:type` and this story's
  `/project/:projectId/resource/:type/:resourceId` are independent flat patterns,
  and `scripts/e2e/ui-collections-proof.sh` still expects the list to render when
  no id is present.

## Verify

- New `ui/src/pages/entity-resource.test.tsx` —
  `npm run test --workspace ui -- src/pages/entity-resource.test.tsx`, rendering
  the real `ROUTE_TABLE` through `createMemoryRouter` with
  `vi.mock("@/lib/api-client")`:
  - `/project/p1/resource/repository/r1` with
    `{type:"repository",id:"r1",projectId:"p1",name:"repo-1",remoteUrl:"https://example.invalid/x.git",branch:"main",path:"/m/r1",auth:{kind:"ambient"},publication:null}`
    → `[data-testid="entity-header"]` contains `repo-1`; the tab strip is exactly
    `["Summary"]` and `getAllByRole("tab")` has length **1**; the six rows render
    with `resource-branch` reading `main`, `resource-auth-kind` reading
    `ambient`, `resource-publication` reading `—`, and no
    `resource-auth-credential`.
  - the same resource with
    `auth:{kind:"https-token",credentialId:"c1"}` → `resource-auth-kind` reads
    `https-token` and `resource-auth-credential` reads `c1`.
  - `publication:{state:"published",remoteOID:"abc123"}` →
    `resource-publication` reads `published@abc123`;
    `{state:"unpublished",remoteOID:null}` → reads `unpublished`.
  - `/project/p1/resource/credential/c1` with
    `{type:"credential",id:"c1",projectId:"p1",name:"cred-1",provider:"github"}`
    → `resource-name` reads `cred-1`, `resource-provider` reads `github`, and
    `resource-branch`, `resource-path`, `resource-publication` and
    `resource-auth-kind` are all absent.
  - a credential fixture carrying an extra `value:"s3cr3t"` key renders nothing
    containing `s3cr3t` (`document.body.textContent`).
  - `/project/p1/resource/notification/n1` renders `resource-provider` and
    `resource-destination`; `/project/p1/resource/filesystem/f1` renders
    `resource-path` and no `resource-provider`.
  - breadcrumb: `/project/p1/resource/credential/c1` → the breadcrumb is exactly
    `alpha`, `Credentials`, `cred-1` in that order and contains no id.
  - missing: `fetchResource` rejects with
    `new ApiError(404,"unknown_reference","no resource")` →
    `[data-testid="async-missing"]` and **zero**
    `[data-testid="scope-mismatch"]`.
  - no mutation: no accessible button or link named
    `/edit|rename|delete|rotate|reclone|publish|create|new/i`, and
    `document.querySelectorAll("form")` is empty.
- `npm run verify` exits 0.
- Proof: **phase G** in full — the resource entity URL renders the repository
  summary under `entity-header`, and the credential's secret appears nowhere in
  the document.
