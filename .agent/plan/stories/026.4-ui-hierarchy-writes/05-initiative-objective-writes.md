# Story 05 — initiative and objective create and rename

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decisions 6, 7, 9)
Depends on: Stories 01, 02, 03, 04 (it reuses story 04's rename shape).

Implement the four tasks in the order written.

## Change

### 1. `ui/src/lib/api-client.ts` — six typed helpers

```ts
export async function createInitiative(
  projectId: string,
  name: string,
): Promise<Created<{ id: string }>>;
// apiPostCreated(`/api/project/${enc(projectId)}/initiative`, { name })
export async function renameInitiative(
  id: string,
  name: string,
  ifMatch: string,
): Promise<Etagged<InitiativeDetailDto>>;
export async function fetchInitiativeWithEtag(
  id: string,
): Promise<Etagged<InitiativeDetailDto>>;
export async function createObjective(
  initiativeId: string,
  name: string,
): Promise<Created<{ id: string }>>;
// apiPostCreated(`/api/initiative/${enc(initiativeId)}/objective`, { name })
export async function renameObjective(
  id: string,
  name: string,
  ifMatch: string,
): Promise<Etagged<ObjectiveDetailDto>>;
export async function fetchObjectiveWithEtag(
  id: string,
): Promise<Etagged<ObjectiveDetailDto>>;
```

**The create bodies carry `name` and nothing else.** `paused` and `after` are
never sent (epic decision 9): `paused` cannot be undone because
`PATCH /api/initiative/:id` takes `name` only, and `after` is an edge, which is
story 07's flow.

### 2. `ui/src/components/create-initiative.tsx` — new file

```ts
export interface CreateInitiativeProps {
  readonly projectId: string;
}
export function CreateInitiative(props: CreateInitiativeProps): ReactElement;
```

Same shape as story 04's `CreateProject`, with these ids:
`create-initiative` (trigger), `create-initiative-form`,
`create-initiative-name`, `create-initiative-submit`, `create-initiative-error`.
On success: `await invalidateFor(client, "initiative.create", {projectId})`,
close the Sheet, **do not navigate**.

Mount it on `ui/src/pages/project-overview.tsx` (F10 — the Overview is the
surface that lists initiative cards), in the header row of the initiative-card
section, above `overview-initiative-card`. Change nothing else on the Overview:
its polling, digest, counts and freshness stay as 026.2 built them.

### 3. `ui/src/components/create-objective.tsx` — new file

```ts
export interface CreateObjectiveProps {
  readonly projectId: string;
  readonly initiativeId: string;
}
export function CreateObjective(props: CreateObjectiveProps): ReactElement;
```

Ids: `create-objective`, `create-objective-form`, `create-objective-name`,
`create-objective-submit`, `create-objective-error`. On success:
`await invalidateFor(client, "objective.create", {projectId, initiativeId})`.

Mount it inside the **existing `objectives` tab panel** of
`ui/src/pages/entity-initiative.tsx`, above the objective list. **Add no tab** —
026.3 decision 5 fixes the tab set at `summary` / `objectives` / `dependencies`.

### 4. The two renames — entity-owned (epic decision 6)

`ui/src/components/rename-initiative.tsx` and
`ui/src/components/rename-objective.tsx`, each a copy of story 04's
`RenameProject` shape with its own load/save/onSaved wiring. They reuse the same
ids — `rename-open`, `rename-form`, `rename-input`, `rename-submit`,
`rename-error` — and the same `ConflictPanel` / `ClientDefectNotice` states.

```ts
export interface RenameInitiativeProps {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly name: string;
}
export interface RenameObjectiveProps {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly name: string;
}
```

- initiative: `load = () => fetchInitiativeWithEtag(initiativeId)`,
  `toDraft = i => i.name`, `save = (d, m) => renameInitiative(initiativeId, d.trim(), m)`,
  `onSaved = async ({data}) => { client.setQueryData(initiativeKeys.detail(initiativeId), data);
await invalidateFor(client, "initiative.rename", {projectId, id: initiativeId}); }`.
- objective: the same with `objectiveKeys.detail`, `"objective.rename"` and
  `{projectId, initiativeId, id: objectiveId}`.
- `describe` is `v => typeof v === "string" ? v : v.name`.

Mount each in its page's **`EntityWorkspace` actions area** — the W2 template's
actions slot (`docs/ui-design.md:207-236`) — on
`ui/src/pages/entity-initiative.tsx` and `ui/src/pages/entity-objective.tsx`.
The rename control renders only when the page's gate is resolved; a scope
mismatch or a missing entity shows no write control.

## Constraints

- **No task rename** (epic decision 12) and **no delete** anywhere.
- No `paused` toggle and no `after` field on any create form (epic decision 9).
- No new tab, no reordering of the fixed tab sets, no change to
  `ui-entities-proof.sh:152`'s five-tab count.
- Three separate rename components — the shared layer is the hook, the panel and
  the matrix, not a form abstraction (epic decision 7).
- Creates never navigate; the invalidated list is what shows the new row.

## Verify

`npm run test --workspace ui -- src/components/create-initiative.test.tsx` and
`… src/components/create-objective.test.tsx` — new files, each asserting:

- submit posts to the right path with body **exactly `{name}`** — assert the JSON
  body has one key, so a stray `paused` or `after` fails;
- blank name keeps the submit disabled and issues no request;
- a server error renders the `*-error` element with the server's message and keeps
  the Sheet open with the typed name;
- success calls `invalidateFor` with the matching mutation name and context, and
  performs no navigation (`useNavigate` spy not called).

`npm run test --workspace ui -- src/components/rename-initiative.test.tsx` and
`… src/components/rename-objective.test.tsx` — new files, each repeating story
04's rename assertion list for its entity: pre-fill from the detail `GET`,
byte-identical `if-match`, frozen validator across a cache write, `412` →
three-version conflict with the draft intact, `conflict-reload` → resubmit with
the recovery ETag, `428` → `client-defect`, success → `setQueryData` +
`invalidateFor` + Sheet closed, exactly one PATCH per submit.

`npm run test --workspace ui -- src/pages/project-overview.test.tsx` — extended:
`create-initiative` renders once; every 026.2 assertion still passes.

`npm run test --workspace ui -- src/pages/entity-initiative.test.tsx` and
`… src/pages/entity-objective.test.tsx` — extended: the tab set is unchanged and
still counted the same; `create-objective` renders inside the `objectives` panel
only (assert it is absent while the `summary` tab is active, since 026.3's
`EntityWorkspace` mounts exactly one panel); `rename-open` renders once in the
actions area and is absent when the gate reports a scope mismatch.

`npm run verify` exits 0.

Proof: `ui-writes-proof.sh:146-151` — `create-initiative`,
`create-initiative-name`, `create-initiative-submit` on
`#/project/<id>/overview`, and the new name visible on the page afterwards. The
objective and task creates that story 08 adds to phase C also land on this
story's `create-objective`.
