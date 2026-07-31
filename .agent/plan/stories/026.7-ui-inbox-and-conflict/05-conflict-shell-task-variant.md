# Story 05 — the W3 conflict shell and the task conflict variant

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decisions 7, 8, 9, 10)
Depends on: Story 03.

## Change

### The shell

Create `ui/src/components/conflict-workspace.tsx`:

```ts
export interface ConflictGoneInfo {
  /** The API error code, e.g. "no_conflict_candidate". */
  readonly code: string;
  /** Router path, no leading `#`. */
  readonly backHref: string;
  readonly backLabel: string;
}
export interface ConflictWorkspaceProps {
  readonly projectId: string;
  readonly segments: readonly string[];
  /**
   * The chain's already-resolved gate, straight from `useTaskChain` /
   * `useObjectiveChain` (EPIC 026.3). Never recomputed here.
   */
  readonly chainGate: Gate;
  readonly gone: ConflictGoneInfo | null;
  /** `asyncStateOf(conflictQuery)`. */
  readonly conflictState: AsyncState;
  readonly conflictMessage: string | undefined;
  /** The noun AsyncBoundary names, e.g. "task conflict". */
  readonly what: string;
  readonly stale: ReactNode;
  readonly evidence: ReactNode;
  readonly response: ReactNode;
}
export function ConflictWorkspace(props: ConflictWorkspaceProps): ReactElement;
```

- The chain's `gate` arrives **already resolved**. `useTaskChain` /
  `useObjectiveChain` return `{gate, …entities, projectName}` and expose neither
  their `GateQuery` entries nor their `mismatch`
  (EPIC 026.3 Story 01 §`entity-chain.ts`), and `resolveGate` accepts exactly one
  `role: "entity"` query — which the chain has already spent on the task or
  objective. **Do not call `resolveGate` in this epic**, do not re-derive a
  `ScopeMismatchInfo`, and do not widen 026.3's chain contract. The conflict query
  is a second, separate state, composed by the precedence below.

- Renders `ProjectShell` exactly once in **every** state, with
  `projectId` and `segments` passed through. Its child is always
  `<div data-testid="conflict-shell" data-variant={props.what}>`.
- Inside that div, resolve the state with this fixed precedence, first match
  wins, and render nothing else:
  1. `props.chainGate !== null` → `chainGate.kind === "async"` renders
     `<AsyncBoundary state={chainGate.state} what={chainGate.what} message={chainGate.message} />`;
     `chainGate.kind === "mismatch"` renders `<ScopeMismatch info={chainGate.info} />`.
  2. `props.gone !== null` → the gone state, and **no** `AsyncBoundary`, **no**
     `ScopeMismatch`, no evidence, no response.
  3. `props.conflictState !== "resolved"` →
     `<AsyncBoundary state={props.conflictState} what={props.what} message={props.conflictMessage} />`.
  4. otherwise → the body.
- **The chain outranks the 409.** `GET /api/task/:id/conflict` is keyed by the task
  id alone, so a URL naming the wrong project, initiative or objective still gets
  a well-formed 409. If `gone` came first, a wrong-chain deep link would read
  "This conflict is no longer present" instead of EPIC 026.3's scope mismatch, and
  the operator would be told a falsehood about the entity they actually asked for.
  The locked Proof uses a valid chain and cannot catch this, so the hermetic test
  below pins it.
- `conflictState` never reaches step 3 as `"error"` for one of the two gone codes —
  step 2 already caught it. An `"error"` at step 3 is a real transport or server
  failure.
- The gone state (decision 9):

```tsx
<section
  data-testid="conflict-gone"
  data-code={props.gone.code}
  data-role="attention"
>
  <p data-testid="conflict-gone-note">This conflict is no longer present.</p>
  <Link data-testid="conflict-gone-link" to={props.gone.backHref}>
    {props.gone.backLabel}
  </Link>
</section>
```

- The body is **evidence first, response last** (W3, `docs/ui-design.md:219`), in
  this order and no other: `props.stale`, then
  `<section data-testid="conflict-evidence">{props.evidence}</section>`, then

```tsx
<section data-testid="conflict-response">
  <p data-testid="conflict-response-note">
    Resolving a conflict happens through the CLI. The browser has no route that
    resolves it.
  </p>
  {props.response}
</section>
```

- The shell renders no button, no form, no `DangerConfirm` and no `onClick`
  anywhere.

### The 409 reader

Append to `ui/src/lib/decision-queue.ts`:

```ts
/** Decision 9: the route's own 409 is a state, not an error. */
export function conflictGoneCode(
  error: unknown,
  expected: string,
): string | null;
```

Returns `expected` when
`error instanceof ApiError && error.status === 409 && error.code === expected`;
otherwise `null`. The caller passes the code **its own** route can emit —
`"no_conflict_candidate"` for the task route, `"objective_not_in_conflict"` for the
objective route (`src/apps/http/error-registry.ts:47-62`). A shared "either code
is fine" reader would let the task route silently accept an objective code, hiding
a server contract regression as a normal gone state. Any other 409 falls through
to the shell's error state.

### The task variant

Create `ui/src/pages/task-conflict.tsx` exporting
`export function TaskConflictPage(): ReactElement`.

- Read `projectId`, `initiativeId`, `objectiveId`, `taskId` with
  `useParams<{...}>()`.
- Chain and scope come from EPIC 026.3: `useTaskChain(...)`. Pass its `gate`
  straight through as `chainGate` and use its `projectName`; do not re-implement
  scope validation, do not build a `ScopeMismatchInfo`, and do not call
  `resolveGate`.
- The conflict query:

```ts
const conflict = useQuery({
  queryKey: conflictKeys.task(taskId!),
  queryFn: ({ signal }) => fetchTaskConflict(taskId!, { signal }),
  staleTime: Infinity,
  retry: false,
});
```

`retry: false` is required: a 409 is a settled answer, not a transient failure.

- `const gone = conflictGoneCode(conflict.error, "no_conflict_candidate");` and

```ts
const goneInfo =
  gone === null
    ? null
    : {
        code: gone,
        backHref: `/project/${projectId}/initiative/${initiativeId}/objective/${objectiveId}/task/${taskId}`,
        backLabel: "Back to the task",
      };
```

- Pass `chainGate={chain.gate}`, `gone={goneInfo}`,
  `conflictState={asyncStateOf(conflict)}`, `conflictMessage` from
  `conflict.error instanceof Error ? conflict.error.message : undefined`,
  `what="task conflict"`, and `stale={null}`.
- `segments` are `[projectName ?? projectId, initiativeId, objectiveId, taskId, "Conflict"]`
  — ids, not names, for the middle three: the DTO for this page carries no names
  and decision 2's no-fan-out rule applies here too. Where `useTaskChain` already
  provides a name for a level, use it.
- **Evidence**: a `<dl data-testid="task-conflict-facts">` with rows
  `Branch` → `branch`, `Target commit` → `targetOID`, `Candidate commit` →
  `candidateOID`, each value verbatim in
  `<dd data-testid="task-conflict-branch|task-conflict-target|task-conflict-candidate">`.
  Then the files:
  - `files.length === 0` →
    `<p data-testid="conflict-no-files">The daemon reported a conflict but named no file.</p>`
  - otherwise `<ul data-testid="conflict-files">` with one
    `<li data-testid="conflict-file" data-path={f.path}>` per file in server
    order, each containing `<p data-testid="conflict-file-path">{f.path}</p>` and
    then:
    - `f.hunks !== ""` →
      `<pre data-testid="conflict-file-body">{f.hunks}</pre>`, styled
      `max-h-[32rem] overflow-auto whitespace-pre text-xs`. The body is rendered
      verbatim, conflict markers included, never truncated, never re-parsed into
      hunk headers — `hunks` is the whole conflict-marked file
      (`src/landing/git.ts:161-177`).
    - `f.hunks === ""` (decision 9) →
      `<p data-testid="conflict-file-unreadable">The conflict body could not be read.</p>`,
      with the path still shown.
- **Response** (decision 10): the only command offered is one the queue already
  supplied for the same task.

```ts
const queue = useQuery({
  queryKey: queueKeys.list(QUEUE_LIMIT),
  queryFn: ({ signal }) => fetchQueue(QUEUE_LIMIT, { signal }),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
});
const verdicts = (queue.data?.items ?? [])
  .filter((i) => i.taskId === taskId)
  .flatMap((i) => i.verdicts);
```

- The response region must not report the queue's own failure as the daemon
  having nothing to offer. `VerdictList`'s `verdict-none` says "The daemon named
  nothing it can do for this item yet" — false when the client simply could not
  read the queue, and false when the matching item fell outside the 500-item
  window. Branch on the queue query, in this order, and pass exactly one node as
  `response`:
  1. `queue.isPending` →
     `<p data-testid="conflict-response-pending">Looking for a command the daemon can name…</p>`
  2. `queue.data === undefined` (the query settled without data) →
     `<p data-testid="conflict-response-unavailable">The decision queue could not be read, so no command can be offered here.</p>`
  3. `verdicts.length === 0` →
     `<p data-testid="conflict-response-no-match">{`The decision queue's newest ${String(QUEUE_LIMIT)} items name no action for this task.`}</p>`
  4. otherwise → `<VerdictList verdicts={verdicts} />`
- Branches 1–3 render **no** `AsyncBoundary`, so the queue's state never becomes
  this page's async state. The page assembles no git command of its own.

## Constraints

- The page renders `ProjectShell` exactly once, via the shell. Do not wrap it in
  `ProjectRoute` and do not add a second `ProjectShell`.
- Do not use the testids `conflict`, `conflict-base`, `conflict-draft`,
  `conflict-current` or `conflict-reload`: EPIC 026.4's `ConflictPanel` owns them
  for HTTP 412 write conflicts, which are unrelated to this screen.
- Do not add a resolve, approve, reject, retry, abort or "mark resolved" control —
  no route exists (`src/apps/http/routes.ts` has only the two conflict GETs).
- Do not register routes here — Story 07 owns them.
- Do not extend `AsyncBoundary`'s state union.

## Verify

- `npm test --workspace ui -- src/components/conflict-workspace.test.tsx` — create
  this file. Assert:
  - exactly one `project-shell` in each of: chain loading, chain mismatch, gone,
    conflict loading, conflict error, and resolved;
  - `conflict-shell` present in all six, carrying `data-variant`;
  - **precedence, all four steps**: a non-null `chainGate` **plus** a non-null
    `gone` renders the chain state and **zero** `conflict-gone` — the wrong-chain
    deep link the Proof cannot reach; `chainGate: null` with `gone` set renders
    `conflict-gone` and zero `async-*`; `chainGate: null`, `gone: null`,
    `conflictState: "error"` renders `async-error` carrying `conflictMessage`;
    all-clear renders the body;
  - `chainGate.kind === "async"` with `state:"missing"` renders `async-missing` and
    zero `scope-mismatch`; `chainGate.kind === "mismatch"` renders `scope-mismatch`
    and zero `async-missing` (mirrors EPIC 026.3's exclusivity rule);
  - the resolved body renders `conflict-evidence` before `conflict-response` in DOM
    order, with `conflict-response-note` verbatim;
  - `conflict-gone` carries `data-code` and one `conflict-gone-link` with the
    given href and label;
  - no `button` and no `form` element anywhere in any state.
- `npm test --workspace ui -- src/lib/decision-queue.test.ts` — extend. Assert
  `conflictGoneCode(new ApiError(409,"no_conflict_candidate",…), "no_conflict_candidate")`
  returns that code; the same error with `expected: "objective_not_in_conflict"`
  returns `null` (route-specific, not "either code"); and `null` is returned for
  `ApiError(409,"duplicate_name")`, `ApiError(404,"unknown_reference")`,
  `ApiError(500,"transport_error")`, a plain `Error`, `null` and `undefined`.
- `npm test --workspace ui -- src/pages/task-conflict.test.tsx` — create this
  file. Stub `globalThis.fetch` (Story 02's helper convention) and route by URL, so
  `useTaskChain`'s real queries run against the stub; do **not** mock
  `@/lib/api-client`, whose `fetchX` helpers call their module-local `apiGet`.
  Assert:
  - the recorded request set contains `/api/task/t1/conflict` and
    `/api/queue?limit=500` plus exactly the chain's four entity requests, and
    nothing else; and a 409 is not retried (that URL appears once);
  - a resolved conflict with two files renders two `conflict-file` elements in DTO
    order with `data-path`, and `conflict-file-body` text equal to the `hunks`
    string including a `<<<<<<<` marker;
  - a file with `hunks: ""` renders `conflict-file-path` **and**
    `conflict-file-unreadable`, and no `conflict-file-body`;
  - `files: []` renders `conflict-no-files`;
  - the three fact cells carry `branch`, `targetOID`, `candidateOID` verbatim;
  - a 409 `no_conflict_candidate` renders `conflict-gone` with
    `data-code="no_conflict_candidate"`, zero `async-error`, and a
    `conflict-gone-link` pointing at the canonical task route;
  - a 500 renders `async-error`; a pending query renders `async-loading`;
  - a wrong-chain URL (the task's `objectiveId` differs from the URL's) renders
    `scope-mismatch` and **zero** `conflict-gone`, even when the conflict route
    answered 409 — the precedence rule, end to end;
  - the response region, one case per branch: pending queue →
    `conflict-response-pending`; settled-without-data queue →
    `conflict-response-unavailable` and zero `verdict-none` and zero `async-error`;
    resolved queue with only another task's item →
    `conflict-response-no-match`; resolved queue with a matching `taskId` → one
    `verdict` per verdict with the verbatim command and none of the three
    branch-1–3 elements;
  - the rendered DOM contains no `button` that is not `command-handoff-copy` or
    `verdict-button`.
- `npm run verify` exits 0.
- Proof: phase F (the task conflict route renders `conflict-gone` against the
  API's real `409 no_conflict_candidate`, and not as a transport error).
