# Story 06 — the objective conflict variant

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decisions 7, 9, 10)
Depends on: Story 05.

## Change

Create `ui/src/pages/objective-conflict.tsx` exporting
`export function ObjectiveConflictPage(): ReactElement`. It reuses
`ConflictWorkspace`, `EvidenceBlock` and `VerdictList` unchanged — no second
shell, no second evidence renderer, no second verdict renderer.

- Read `projectId`, `initiativeId`, `objectiveId` with `useParams`.
- Chain and scope come from `useObjectiveChain(...)` (EPIC 026.3). Pass its `gate`
  through as `chainGate` and use its `projectName`. Do not call `resolveGate`.
- The conflict query:

```ts
const conflict = useQuery({
  queryKey: conflictKeys.objective(objectiveId!),
  queryFn: ({ signal }) => fetchObjectiveConflict(objectiveId!, { signal }),
  staleTime: Infinity,
  retry: false,
});
```

- `gone` uses the same reader with **this route's** code:
  `conflictGoneCode(conflict.error, "objective_not_in_conflict")`, with
  `backHref = /project/${projectId}/initiative/${initiativeId}/objective/${objectiveId}`
  and `backLabel = "Back to the objective"`. A `404 unknown_reference` is **not** a
  gone state: it flows through `asyncStateOf` to `conflictState: "missing"` and
  renders `async-missing` (`src/app/objective/get-objective-conflict.ts:100-103`
  makes 404 reachable on this route, unlike the task route).
- Pass `chainGate`, `gone`, `conflictState`, `conflictMessage` and
  `what="objective conflict"` exactly as Story 05's task variant does. The shell's
  four-step precedence is unchanged: the chain outranks the 409.
- `what` is `"objective conflict"`; `segments` are
  `[projectName ?? projectId, initiativeName ?? initiativeId, objectiveName ?? objectiveId, "Conflict"]`
  using whatever names `useObjectiveChain` already provides — never a new fetch.
- **`stale`** (decision 7's stale state): when
  `conflict.data?.tipMovedSinceAnchor === true`, pass

```tsx
<p data-testid="conflict-stale" role="status" data-role="attention">
  The branch tip moved after this conflict was recorded, so the evidence below
  may be out of date.
</p>
```

and `null` when it is `false`. Never suppress the evidence because of staleness.

- **Evidence**, in this order:
  1. `<dl data-testid="conflict-oid-chain">` with four rows —
     `Parent` → `parentOid` (`data-testid="conflict-oid-parent"`),
     `Objective commit` → `commitOid` (`conflict-oid-commit"`),
     `Observed tip` → `observedTipOid` (`conflict-oid-observed`),
     `Current tip` → `currentTip` (`conflict-oid-current`). A `null` value renders
     the exact word `not recorded` in that `<dd>` and nothing else — never an
     empty cell, never a dash, never a fabricated oid (decision 9).
  2. `<p data-testid="conflict-status">` with `status` verbatim.
  3. `<p data-testid="conflict-cause">` with `conflictCause` verbatim, or
     `<p data-testid="conflict-no-cause">No cause recorded.</p>` when it is `null`.
  4. `<p data-testid="conflict-reason">` with `conflictReason` verbatim, or
     `<p data-testid="conflict-no-reason">No reason recorded.</p>` when `null`.
  5. `<p data-testid="conflict-note">` with `note` verbatim, or
     `<p data-testid="conflict-no-note">No note recorded.</p>` when `null`.
  6. `<EvidenceBlock evidence={conflict.data.evidence} />`.
     There is no file list and no diff on this variant: `ObjectiveConflictView`
     carries no `files` (`src/apps/http/views/conflict.ts:26-47`). Do not render an
     empty `conflict-files`, and do not fetch a task conflict to fill the gap.
- **Response** (decision 10): the same queue-derived rule as Story 05, matched on
  the objective instead of the task —

```ts
const verdicts = (queue.data?.items ?? [])
  .filter((i) => i.objectiveId === objectiveId && i.taskId === undefined)
  .flatMap((i) => i.verdicts);
```

The `taskId === undefined` clause is required: a task item inside the same
objective also carries `objectiveId`, and its `approve task` verdict is not a
response to an objective conflict. Use Story 05's four-branch response rule
verbatim — `conflict-response-pending`, `conflict-response-unavailable`,
`conflict-response-no-match` (with `objective` in place of `task` in the
sentence), then `VerdictList`. A failed queue query is never surfaced as this
page's async state and never rendered as the daemon having nothing to offer.

## Constraints

- Do not duplicate `ConflictWorkspace`, `EvidenceBlock` or `VerdictList` — import
  them. A second shell or a copied evidence block is a rejected design (decision 7).
- Do not render a `files` section, a diff, or a placeholder for one.
- Do not use the testids `objective-conflict-cause` or `objective-conflict-reason`:
  EPIC 026.3's objective workspace Summary owns them.
- Do not add a resolve/retry/approve/reject control; do not call any write helper.
- Do not register routes here — Story 07 owns them.

## Verify

- `npm test --workspace ui -- src/pages/objective-conflict.test.tsx` — create this
  file. Stub `globalThis.fetch` and route by URL, as Story 05 does; do not mock
  `@/lib/api-client`. Assert:
  - `/api/objective/o1/conflict` is requested exactly once even after a 409;
  - a fully-populated DTO renders all four oid cells verbatim, `conflict-status`,
    `conflict-cause`, `conflict-reason`, `conflict-note`, and one `evidence`
    element; and renders **zero** `conflict-files` and zero `conflict-file`;
  - a DTO with `parentOid: null`, `commitOid: null`, `observedTipOid: null`,
    `currentTip: null` renders `not recorded` in all four cells;
  - `conflictCause: null`, `conflictReason: null` and `note: null` render
    `conflict-no-cause`, `conflict-no-reason`, `conflict-no-note` and none of the
    populated variants;
  - `tipMovedSinceAnchor: true` renders `conflict-stale` **and** the evidence
    below it; `false` renders no `conflict-stale`;
  - `409 objective_not_in_conflict` renders `conflict-gone` with
    `data-code="objective_not_in_conflict"`, zero `async-error`, and a
    `conflict-gone-link` to the canonical objective route;
  - `404 unknown_reference` renders `async-missing` and **zero** `conflict-gone` —
    the two states are mutually exclusive;
  - a 500 renders `async-error`; a pending query renders `async-loading`;
  - the response region: a queue item with the matching `objectiveId` and **no**
    `taskId` contributes its verdicts; a queue item with the same `objectiveId`
    **and** a `taskId` contributes none, rendering `conflict-response-no-match`;
    a settled-without-data queue renders `conflict-response-unavailable` with no
    `verdict-none` and no `async-error`;
  - a wrong-chain URL renders `scope-mismatch` and zero `conflict-gone`;
  - exactly one `project-shell` in every branch above.
- `npm run verify` exits 0.
- Proof: none directly. Reaching a real objective in `conflict` state needs a
  runner result, which no HTTP or CLI path creates — the epic's Verification Gate
  assigns these branches to the hermetic tests above, and phase F proves the same
  409 mechanism on the task route.
