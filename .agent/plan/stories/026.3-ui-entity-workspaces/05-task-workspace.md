# Story 05 — task W2: five tabs, and evidence kept beside every interpretation

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decisions 5 and 6)
Depends on: Story 01, Story 02.

## Change

### 1. `ui/src/lib/entity-scope.ts` — one more pure helper

```ts
/**
 * The URL of a dependency that lives in the same objective, or `null`. Decision
 * 6: a blocking id is linked only when it is in the same chain.
 */
export function siblingTaskHref(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly siblingIds: readonly string[] | undefined;
}): string | null;
```

Returns
`"/project/" + projectId + "/initiative/" + initiativeId + "/objective/" + objectiveId + "/task/" + taskId`
when `siblingIds !== undefined && siblingIds.includes(taskId)`, else `null`.

### 2. `ui/src/app/entity-chain.ts` — the sibling list, ungated

Add to `useTaskChain` one query, and expose
`readonly siblingTaskIds: readonly string[] | undefined`:

```ts
useQuery({
  queryKey: taskKeys.list(initiativeId, objectiveId),
  queryFn: ({ signal }) => fetchTasks(initiativeId, objectiveId, { signal }),
  staleTime: Infinity,
});
```

`siblingTaskIds` is `data?.map(t => t.id)`. This query is **not** passed to
`resolveGate`: a failed sibling list must never blank the task page — it only
costs the dependency links, which fall back to unlinked ids. The key is the same
one Story 04's Tasks tab uses, so navigating objective → task reuses the cache.

### 3. Edit `ui/src/pages/entity-task.tsx`

Replace `tabs={[]}` with exactly these five tabs, in this order. The Proof counts
five (`ui-entities-proof.sh:152`).

```ts
const tabs = [
  { value: "summary", label: "Summary", panel: <TaskSummary … /> },
  { value: "instructions", label: "Instructions & AC", panel: <TaskInstructions … /> },
  { value: "dependencies", label: "Dependencies", panel: <TaskDependencies … /> },
  { value: "result", label: "Result", panel: <TaskResult … /> },
  { value: "landing", label: "Landing", panel: <TaskLanding … /> },
];
```

All five panel components live in this same file.

#### Summary panel

A `<dl>` with these rows, in this order:

| label        | content                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Status`     | `<EntityStatus axis="task" value={task.status} />`                                                                                         |
| `Agent`      | `<span data-testid="task-agent">{task.agent}</span>` when the key is present, else `<span data-testid="empty-agent">Not specified.</span>` |
| `Note`       | `<p data-testid="task-note">{task.note}</p>` when the key is present, else `<span data-testid="empty-task-note">Not specified.</span>`     |
| `Downstream` | `<span data-testid="task-downstream">{task.downstream}</span>`                                                                             |

`task-downstream` contains the number and **nothing else** — no label, no unit,
no separator, no sibling text inside the element. The Proof extracts it with
`.replace(/\D/g, "")` (`ui-entities-proof.sh:162`), so one stray digit fails the
phase. The word `Downstream` is the `<dt>`, outside the element.

Then, below the `<dl>`, decision 6's interpretation — each sentence keeps its
evidence beside it:

- `task.abandoning === true` →
  `<p data-testid="task-abandoning">This task is being abandoned. Its run is revoked but the status is still {task.status}.</p>`
  (`abandoning` coexists with `status: "running"` — index.md F5.) When `false`,
  render nothing.
- `task.blockedForever === true` →
  ```tsx
  <section data-testid="task-blocked-forever">
    <p>
      This task can never run: at least one dependency will never be satisfied.
    </p>
    {task.waiting
      .filter((w) => w.neverSatisfies)
      .map((w) => (
        <DependencyId key={w.id} id={w.id} />
      ))}
  </section>
  ```
  When `false`, render nothing.
- `<ActionInventory action={task.action} />` — a placeholder in this story:
  render nothing here yet and let **Story 06** insert it. Story 05 does not
  reference `ActionInventory`.

`DependencyId` is a small component in this file:

```tsx
function DependencyId({ id }: { readonly id: string }): ReactElement {
  const href = siblingTaskHref({
    projectId,
    initiativeId,
    objectiveId,
    taskId: id,
    siblingIds,
  });
  return href === null ? (
    <code data-testid="dependency-id" data-task-id={id}>
      {id}
    </code>
  ) : (
    <Link data-testid="dependency-id" data-task-id={id} to={href}>
      <code>{id}</code>
    </Link>
  );
}
```

The id text is always rendered verbatim, linked or not — the sentence never
replaces the fact (decision 6).

#### Instructions & AC panel

Four blocks, in this order, each with its own "not specified" (decision 5):

| block                 | present                                                                                  | absent                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Instructions`        | `<pre data-testid="task-instructions">{task.instructions}</pre>`                         | `<p data-testid="empty-instructions">Not specified.</p>` |
| `Acceptance criteria` | `<ul data-testid="task-ac">` one `<li>` per entry, API order                             | `<p data-testid="empty-ac">Not specified.</p>`           |
| `Verification`        | `<ul data-testid="task-verification">` one `<li>` per entry, API order                   | `<p data-testid="empty-verification">Not specified.</p>` |
| `Context`             | `<dl data-testid="task-context">` one `<dt>`/`<dd>` pair per key, in `Object.keys` order | `<p data-testid="empty-context">Not specified.</p>`      |

All four are **omitted keys** (index.md F5). "Absent" means
`x === undefined` **or** (for `ac`/`verification`) `x.length === 0`; `context` is
never `{}` on the wire but treat an empty object as absent too. `<pre>` keeps the
instruction text exactly as the daemon stored it.

#### Dependencies panel

Two sections, both always rendered:

- `<section data-testid="task-dependency-status">` — from
  `task.dependencyStatus`, an **omitted key** when the task has no dependencies
  (index.md F5).
  - key absent, or the array is empty →
    `<p data-testid="empty-task-dependencies">No dependencies.</p>`
  - otherwise a `Table` with `data-testid="dependency-table"`, header cells
    exactly `Task`, `Status`, one row per entry in API order:
    `Task` → `<DependencyId id={d.id} />`;
    `Status` → `<EntityStatus axis="task" value={d.status} />` — a dangling
    dependency's `"unknown"` is not in the union and must render as
    `status-raw`, not crash (index.md F7).
- `<section data-testid="task-waiting">` — from `task.waiting`
  (`{id, neverSatisfies}`, index.md F6).
  - `length === 0` → `<p data-testid="empty-waiting">Nothing is blocking this task.</p>`
  - otherwise one row per entry: `<DependencyId id={w.id} />` plus, when
    `w.neverSatisfies === true`,
    `<p data-testid="waiting-never">This dependency can never be satisfied: it is discarded or permanently blocked.</p>`

#### Result panel

- `task.result === null` (always-present nullable key, index.md F5) →
  `<p data-testid="empty-result">No result yet — this task has not run.</p>`
  and nothing else in the panel.
- otherwise a `<dl>` with one row per `TaskResultDto` field, in the declaration
  order of Story 01 §1, each value a `<span>` holding the string or the single
  character `—` when that field is `null`, with these exact test ids:

  | field                 | test id                       |
  | --------------------- | ----------------------------- |
  | `workspace`           | `result-workspace`            |
  | `branch`              | `result-branch`               |
  | `baseCommit`          | `result-base-commit`          |
  | `proposalCommit`      | `result-proposal-commit`      |
  | `commitSha`           | `result-commit-sha`           |
  | `summary`             | `result-summary`              |
  | `reason`              | `result-reason`               |
  | `rejectionResolution` | `result-rejection-resolution` |
  | `rejectionReason`     | `result-rejection-reason`     |

  Then evidence:
  - `result.evidence === null` or `length === 0` →
    `<p data-testid="empty-evidence">No evidence recorded.</p>`
  - otherwise one `<section data-testid="evidence-entry">` per entry with
    `<code data-testid="evidence-command">{command}</code>`,
    `<span data-testid="evidence-exit-code">{exitCode}</span>` (digits only) and
    `<pre data-testid="evidence-output">{output}</pre>`.

#### Landing panel

- `task.landingCandidate === null` →
  `<p data-testid="empty-landing">No candidate yet.</p>` and nothing else.
- otherwise a `<dl>` with `<span data-testid="landing-state">{state}</span>`
  (plain text — `pending`/`landed`/`conflict` is in no `StatusChip` axis),
  `<code data-testid="landing-base-sha">`, `<code data-testid="landing-candidate-sha">`
  and `<code data-testid="landing-target">`.

## Constraints

- Five tabs, fixed, in the pinned order; `Summary` is the default. The Proof
  counts exactly five and clicks by label — do not rename a label.
- `task-downstream` holds only the number (see above).
- Interpretation never replaces the exact fact (decision 6): every
  `blockedForever` / `neverSatisfies` sentence renders **with** the blocking id
  in the DOM, and the id text is present whether or not it is linked.
- The UI does not re-derive actionability. Do not compute "can retry", "is
  stuck", "is ready" from `status` — the daemon already answered in `action`, and
  Story 06 owns that rendering.
- Absent vs `null` follows index.md F5 exactly: `undefined` tests for `agent`,
  `note`, `instructions`, `ac`, `verification`, `context`, `dependencyStatus`;
  `=== null` tests for `result`, `landingCandidate`, `action`.
- No retry/approve/reject/abandon control and no dependency-removal control
  (decision 9). `DELETE /api/task/:id/dependency/:dependencyId` exists
  (index.md F9) and this epic still must not call it.
- The sibling-task query stays out of `resolveGate`.

## Verify

- New `ui/src/pages/entity-task.test.tsx` —
  `npm run test --workspace ui -- src/pages/entity-task.test.tsx`, rendering the
  real `ROUTE_TABLE` at `/project/p1/initiative/i1/objective/o1/task/t1` with
  `vi.mock("@/lib/api-client")`. Define one `pendingTask` fixture matching the
  Proof's seeded state (`status:"pending"`, `result:null`,
  `landingCandidate:null`, `dependencyStatus:[{id:"tB",status:"pending"}]`,
  `waiting:[]`, `blockedForever:false`, `abandoning:false`, `downstream:0`,
  `action:null`, no `agent`/`note`/`instructions`/`ac`/`verification`/`context`)
  and override per test:
  - the tab strip is exactly
    `["Summary","Instructions & AC","Dependencies","Result","Landing"]`, is
    length **5**, and `Summary` is initially selected.
  - `task-downstream` for `downstream: 7` has `textContent` exactly `"7"`, and
    `textContent.replace(/\D/g,"")` is `"7"`.
  - `abandoning: true, status: "running"` → `task-abandoning` text contains
    `running`; `abandoning: false` → the element is absent.
  - `blockedForever: true` with
    `waiting:[{id:"tB",neverSatisfies:true},{id:"tC",neverSatisfies:false}]` →
    `task-blocked-forever` is present, its text contains the sentence, and it
    contains a `dependency-id` with `data-task-id="tB"` and **no**
    `data-task-id="tC"`.
  - `blockedForever: false` → `task-blocked-forever` is absent.
  - dependency linking: with `fetchTasks` resolving
    `[{id:"tB",…},{id:"t1",…}]`, the `dependency-id` for `tB` is a link whose
    `href` ends with `/project/p1/initiative/i1/objective/o1/task/tB`; with
    `fetchTasks` resolving `[]`, the same element is **not** a link
    (`queryAllByRole("link")` excludes it) and still has `textContent === "tB"`;
    with `fetchTasks` rejecting, likewise unlinked and the page still renders
    `entity-header`.
  - Instructions & AC, absent: all four of `empty-instructions`, `empty-ac`,
    `empty-verification`, `empty-context` read `Not specified.`.
  - Instructions & AC, present: `instructions:"do it"`, `ac:["a","b"]`,
    `verification:["npm test"]`, `context:{repo:"x"}` → `task-instructions` text
    is `do it`, `task-ac` has two `<li>` in that order, `task-verification` has
    one, `task-context` contains `repo` and `x`, and no `empty-*` of these four
    is present.
  - `ac: []` → `empty-ac` renders (an empty array is "not specified").
  - Dependencies, no dependencies: `dependencyStatus` key **absent** →
    `empty-task-dependencies` reads `No dependencies.` and `dependency-table` is
    absent; `empty-waiting` reads `Nothing is blocking this task.`.
  - Dependencies, dangling: `dependencyStatus:[{id:"tB",status:"unknown"}]` →
    one row, `[data-testid="status-raw"]` reads `unknown`, no `status-chip` in
    that row, and nothing throws.
  - Dependencies, waiting: `waiting:[{id:"tB",neverSatisfies:true}]` →
    `waiting-never` renders its exact sentence and a `dependency-id` for `tB` is
    in the same section.
  - Result, empty: `result: null` → `empty-result` reads
    `No result yet — this task has not run.` and no `result-*` element exists.
  - Result, populated: a full `TaskResultDto` with `summary:"done"`,
    `reason:null`, `evidence:[{command:"npm test",exitCode:0,output:"ok"}]` →
    `result-summary` reads `done`, `result-reason` reads `—`, one
    `evidence-entry` with `evidence-command` `npm test`, `evidence-exit-code`
    `0`, `evidence-output` `ok`.
  - Result, `evidence: null` on an otherwise populated result → `empty-evidence`
    reads `No evidence recorded.`.
  - Landing, empty: `landingCandidate: null` → `empty-landing` reads
    `No candidate yet.`.
  - Landing, populated:
    `{state:"conflict",baseSHA:"b",candidateSHA:"c",target:"main"}` →
    `landing-state` reads `conflict`, and the three code elements read `b`, `c`,
    `main`.
  - decision 8's rare states each get a case over stubbed DTOs, asserting the
    page renders without throwing and that the pinned elements are right:
    `status:"awaiting_confirmation"` → a chip with
    `data-value="awaiting_confirmation"`; `status:"failed"` with a populated
    `result` carrying `rejectionReason:"gate failed"` → `result-rejection-reason`
    reads `gate failed`; `status:"running", abandoning:true` → `task-abandoning`
    present.
  - only one panel is mounted: after clicking `Landing`, no `result-*` element
    and no `dependency-table` is in the DOM.
  - no mutation: no accessible button or link named
    `/retry|approve|reject|abandon|remove|delete|edit|create/i`, and
    `document.querySelectorAll("form")` is empty.
- New `ui/src/lib/entity-scope.test.ts` cases (append to Story 01's file):
  `siblingTaskHref` with `siblingIds:["tB"]` and `taskId:"tB"` → the full path;
  with `siblingIds:[]` → `null`; with `siblingIds: undefined` → `null`.
- `npm run verify` exits 0.
- Proof: **phase E** in full — five tabs; `empty-result` and `empty-landing`
  visible for a pending task; the Dependencies tab naming the blocking task id;
  `task-downstream` matching the count the API returned for the blocker.
