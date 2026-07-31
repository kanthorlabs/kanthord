# Story 4 — the queue DTO: `id`, machine `kind`, `state`, real names

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Story 3.

## Change

1. **Domain item carries the names it already reads** —
   `src/domain/decision-queue.ts`:

- `DecisionItem` (`:79-97`) gains, after `projectName`:
  `initiativeName?: string`, `objectiveName?: string`, `taskTitle?: string`.
- `DecisionItem` also gains `kind: DecisionKind`, assigned from `decisionKind`
  (Story 1) at the same three sites that assign `kindLabel` (`:171`, `:203`,
  `:234`), and `verdictLookupId?: string` set **only** on the initiative branch
  (`:221-246`) to that initiative's repository id. That requires
  `QueueInitiativeInput` (`:33-44`) to gain `repositoryId?: string`, populated in
  `get-decision-queue.ts` where the publication is already built from `repoId`
  (`:249-259`). `verdictLookupId` stays **internal** — it is added to no HTTP
  view.
- In `projectDecisions` (`:145-249`):
  - task branch (`:154-192`): set `taskTitle: t.title`,
    `objectiveName: obj.name`, and `initiativeName` from the `initiatives` entry
    whose `id === obj.initiativeId`. If that entry is absent, **omit**
    `initiativeName` — never `""` (mirrors the skip at `:157`).
  - objective branch (`:194-219`): set `objectiveName: o.name` and
    `initiativeName` the same way.
  - initiative branch (`:221-246`): set `initiativeName: init.name`.
  - Use conditional assignment so an absent value omits the key, matching the
    existing `expectedCommit` handling at `:217`.
- `rankDecisions` is untouched; the new fields never participate in the sort.

2. **`counts.byKind` is keyed by the machine kind** —
   `src/app/project/get-decision-queue.ts:364-370`: key on the item's machine
   `kind` instead of `kindLabel`. The five values are identical strings today, so
   no wire value changes; the point is that the filter parameter and the counts
   map share one vocabulary.

3. **HTTP view** — `src/apps/http/views/queue.ts`:

- `DecisionItemView` (`:11-32`) gains `id: string`, `kind: string`,
  `state: "open"`, and the three optional names `initiativeName?`,
  `objectiveName?`, `taskTitle?`.
- `decisionItemView` (`:34-63`) copies them, optionals through the existing
  conditional-spread idiom.
- Add the kind vocabulary for the decoder (this layer may not import
  `src/domain/`, see the note at `:9`):

```ts
export const DECISION_KIND_VALUES = [
  "task-review",
  "operational-failure",
  "objective-conflict",
  "objective-candidate",
  "publication",
] as const;
```

mirroring `TASK_STATUS_VALUES` in `src/apps/http/views/task.ts`.

- `DecisionQueueView` (`:65-74`) is unchanged in shape; `counts` keeps
  `{ total, byKind }`.

4. **CLI** — `src/apps/cli/queue.ts` is not changed.

## Constraints

- `kindLabel` stays on the DTO and keeps its meaning; no consumer may treat it
  as identity.
- No new per-item fan-out: every name comes from data
  `projectDecisions` already receives.

## Verify

- `node --test src/domain/decision-queue.test.ts` — task items carry
  `taskTitle`, `objectiveName`, `initiativeName`; an objective item carries
  `objectiveName` + `initiativeName` and no `taskTitle`; an initiative item
  carries only `initiativeName`; a task whose initiative row is missing omits
  `initiativeName` (key absent, asserted with `"initiativeName" in item`);
  `(017-S5-kind-not-a-sort-key)` at `:462` still passes and a new case asserts
  the name fields do not affect `rankDecisions`.
- `node --test src/apps/http/views/queue.test.ts` — the exact key set at
  `:46-83` grows to include `id`, `kind`, `state` and the present names; absent
  names are omitted; a test asserts `DECISION_KIND_VALUES` deep-equals
  `DECISION_KINDS` imported from `src/domain/decision-occurrence.ts` (tests are
  exempt from the boundaries rule).
- `node --test src/app/project/get-decision-queue.test.ts` — `counts.byKind` is
  keyed by machine kind and still counted **before** truncation (the
  `(017-S6-counts-before-truncation)` case at `:262` keeps passing).
- `node --test src/apps/cli/queue.test.ts` passes unchanged.
- `npm run verify` exits 0.
- Proof: phase C (`the queue item carries no entity name` must not fire;
  `it.taskTitle` is the field the script reads).
