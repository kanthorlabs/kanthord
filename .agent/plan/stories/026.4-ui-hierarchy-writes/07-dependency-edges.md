# Story 07 — dependency add and remove on the three aggregates

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decisions 4, 10, 11)
Depends on: Stories 01, 03, 06.

## Change

### 1. `ui/src/lib/api-client.ts` — the edge helpers

```ts
export type DependencyKind = "task" | "initiative" | "objective";
export async function addDependency(
  kind: DependencyKind,
  id: string,
  dependencyId: string,
): Promise<void>;
// apiPostNoContent(`/api/${kind}/${enc(id)}/dependency`, { dependencyId })
export async function removeDependency(
  kind: DependencyKind,
  id: string,
  dependencyId: string,
): Promise<void>;
// apiDeleteNoContent(`/api/${kind}/${enc(id)}/dependency/${enc(dependencyId)}`)
```

Both are `204` — **no `If-Match`, no representation, no `ETag`**. They are
outside the conditional-edit layer entirely (epic decision 4) and must not be
routed through `useEditSession`.

### 2. `ui/src/lib/write-errors.ts` — new file, the code→message table

```ts
export const DEPENDENCY_ERROR_CODES = [
  "cycle_detected",
  "unknown_reference",
  "wrong_type_reference",
  "unknown_dependency",
  "sequencing_scope",
  "sequencing_locked",
  "dependencies_locked",
] as const;
export type DependencyErrorCode = (typeof DEPENDENCY_ERROR_CODES)[number];
export const DEPENDENCY_ERROR_MESSAGE: Readonly<
  Record<DependencyErrorCode, string>
>;
export function dependencyErrorMessage(error: ApiError): string;
```

Pinned messages, one per code, each distinct and each naming what actually
happened (`src/apps/http/error-registry.ts:42-91` is the source of the codes):

| code                   | message                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `cycle_detected`       | `That edge would close a cycle.`                             |
| `unknown_reference`    | `That item no longer exists.`                                |
| `wrong_type_reference` | `That id is a different kind of item.`                       |
| `unknown_dependency`   | `That task is not in this initiative.`                       |
| `sequencing_scope`     | `Both items must be in the same parent.`                     |
| `sequencing_locked`    | `Work already started, so the order is locked.`              |
| `dependencies_locked`  | `This task already started, so its dependencies are locked.` |

`dependencyErrorMessage(error)` returns, in this order:

1. `DEPENDENCY_ERROR_MESSAGE[error.code]` when the code is a known dependency
   code — the client-authored sentence for that specific code;
2. otherwise `error.message` when it is a non-blank string — the server's own
   text, never a generic replacement;
3. otherwise `` `The server refused this edge (${error.status}).` `` — the
   transport-defect fallback, used only when the envelope carried no message.

**No generic toast, ever** (epic decision 10). `sonner` stays unmounted.

### 3. `ui/src/components/dependency-editor.tsx` — new file

```ts
export interface DependencyCandidate {
  readonly id: string;
  readonly label: string;
}
export interface DependencyEditorProps {
  readonly kind: DependencyKind;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly dependencies: readonly string[];
  readonly candidates: readonly DependencyCandidate[];
  readonly labelOf: (id: string) => string;
  readonly onWritten: () => void | Promise<void>;
}
export function DependencyEditor(props: DependencyEditorProps): ReactElement;
```

Add flow:

- `Button` `data-testid="dependency-add"`, label `Add dependency`, toggles an
  inline `Popover` list — not a Sheet, not a Dialog.
- Each candidate renders as a button with `data-testid="dependency-option"`,
  `data-option-id={id}`, and — when `kind === "task"` — also `data-task-id={id}`
  (the Proof selects on that). The label is the candidate's `label`.
- Candidates are `props.candidates` **in the given order**, minus `sourceId` and
  minus every id already in `props.dependencies`. No sort, no search.
- Clicking an option calls `addDependency(kind, sourceId, id)`. On success:
  close the list and `await onWritten()`. On `ApiError`: keep the list open and
  render `<p data-testid="dependency-error" role="alert" data-role="danger"
data-code={error.code}>{dependencyErrorMessage(error)}</p>` next to the add
  control. The element is cleared on the next successful write.

Remove flow (epic decision 11 — no `DangerConfirm`, no `AlertDialog`):

- Each existing dependency row carries a `Button`
  `data-testid="dependency-remove"`, `data-dependency-id={id}`, label `Remove`.
- The first click replaces that button, in place, with
  `data-testid="dependency-remove-confirm"` whose visible text is
  `` `Remove ${labelOf(id)} from ${sourceLabel}?` `` plus a `Confirm` and a
  `Cancel` (`data-testid="dependency-remove-cancel"`) button. Only one row can be
  in confirm state at a time.
- `Confirm` calls `removeDependency(kind, sourceId, id)` and then `onWritten()`.
  `Cancel` restores the plain button. Errors render in the same
  `dependency-error` element.
- The confirm text names the source and the dependency and **claims nothing
  about what the removal unblocks** — no read model proves that.

Below the add control, render the fixed sentence
`<p data-testid="dependency-precondition-note">Dependency edits are not
version-checked. They apply immediately.</p>` — epic decision 4 requires the
operator to see it.

### 4. Mount on the three W2 pages

| page                                 | tab panel                                         | `kind`       | candidates                                                                                 | `onWritten`                                                                                  |
| ------------------------------------ | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `ui/src/pages/entity-task.tsx`       | `dependencies`                                    | `task`       | `fetchTasks(initiativeId)` via `taskKeys.list(initiativeId)`, labelled by `title`          | `invalidateFor(client, "dependency.write", {projectId, entityKey: taskKeys.detail(taskId)})` |
| `ui/src/pages/entity-initiative.tsx` | `dependencies`                                    | `initiative` | `fetchInitiatives(projectId)` via `initiativeKeys.list(projectId)`, labelled by `name`     | `… {projectId, entityKey: initiativeKeys.detail(initiativeId)}`                              |
| `ui/src/pages/entity-objective.tsx`  | new rows in the `summary` panel's `after` section | `objective`  | `fetchObjectives(initiativeId)` via `objectiveKeys.list(initiativeId)`, labelled by `name` | `… {projectId, entityKey: objectiveKeys.detail(objectiveId)}`                                |

- The objective page's tab set is `summary` / `tasks` / `integration` — it has no
  `dependencies` tab, and **this story adds none** (026.3 decision 5). The editor
  goes in the existing `summary` panel where `after` is already displayed.
- The task page's `dependency-table` and its `dependency-id` rows (026.3 story 05) keep their markup; this story appends the remove control to each row.
- An initiative or objective edge changes the parent's detail ETag (F5), which is
  why `dependency.write` invalidates that detail key.

### 5. `ui/src/components/action-inventory.tsx` — remove the deferral (F16)

Delete the `"remove-dependency": "026.4"` entry from
`ACTION_KINDS_DEFERRED_TO_LATER_EPICS`, as 026.3 story 06 instructs. Leave
`ACTION_KIND_LABEL` and every other entry untouched. If the map becomes empty,
keep it exported as an empty object — later epics add to it.

## Constraints

- No `If-Match` on any call in this story; do not import `useEditSession` here.
- No `DangerConfirm`, no `AlertDialog`, no toast.
- No optimistic update: the list re-renders from the invalidated query, so the
  screen never shows an edge the server did not accept.
- No new tab on any W2 page.

## Verify

`npm run test --workspace ui -- src/lib/write-errors.test.ts` — new file:

- one assertion per code: `dependencyErrorMessage(new ApiError(s, code, "raw"))`
  returns that code's pinned message;
- **the messages are distinct**: `new Set(Object.values(DEPENDENCY_ERROR_MESSAGE)).size === 7`;
- **the guard**: every member of `DEPENDENCY_ERROR_CODES` has a key in
  `DEPENDENCY_ERROR_MESSAGE` and vice versa;
- an unknown code returns the server's `message` verbatim, not a generic string;
- an unknown code with a blank message returns the `(status)` fallback.

`npm run test --workspace ui -- src/components/dependency-editor.test.tsx` — new file:

- `dependency-add` reveals the option list; options exclude `sourceId` and
  already-present dependencies, and keep the given order;
- for `kind: "task"` each option carries both `data-option-id` and
  `data-task-id`; for the other two kinds it carries `data-option-id` only;
- clicking an option calls `addDependency("task", sourceId, optionId)` once and
  then `onWritten` once;
- a stubbed `409 cycle_detected` renders `dependency-error` with
  `That edge would close a cycle.` and `data-code="cycle_detected"`, and
  `onWritten` was **not** called;
- a stubbed `400 sequencing_scope` renders its own distinct message — assert the
  two error texts differ, so no code falls through to a shared string;
- `dependency-remove` swaps to `dependency-remove-confirm` whose text contains
  both the source label and the dependency label; the DELETE fires only on
  `Confirm`; `Cancel` restores the button and issues no request;
- only one row is in confirm state at a time;
- `dependency-precondition-note` is present;
- no `danger-confirm-dialog` and no `sonner` toast is rendered anywhere.

`npm run test --workspace ui -- src/pages/entity-task.test.tsx`,
`… src/pages/entity-initiative.test.tsx`, `… src/pages/entity-objective.test.tsx`
— extended: the editor mounts in the named panel with the right `kind`; the tab
sets and counts are unchanged; `onWritten` invalidates the entity's detail key
and the project overview key and nothing else.

`npm run test --workspace ui -- src/components/action-inventory.test.tsx` —
extended: `ACTION_KINDS_DEFERRED_TO_LATER_EPICS` no longer has
`remove-dependency`, and the task page no longer renders `disabled-action` for it.

`npm run verify` exits 0.

Proof: `ui-writes-proof.sh:187-200` — the Dependencies tab of task B,
`dependency-add`, `[data-testid="dependency-option"][data-task-id="<taskA>"]`,
the `>= 400` response, and a non-empty, non-generic `dependency-error`.
