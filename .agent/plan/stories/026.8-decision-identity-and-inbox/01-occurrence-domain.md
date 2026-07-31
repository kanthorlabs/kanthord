# Story 1 — the occurrence in the domain

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`

## Change

New pure module `src/domain/decision-occurrence.ts`. Zero I/O, zero imports
outside `src/domain/`.

1. The machine-kind vocabulary, mirroring the `SAFE_FACTS_KINDS` pattern at
   `src/domain/safe-facts.ts:3-10`:

```ts
export const DECISION_KINDS = Object.freeze([
  "task-review",
  "operational-failure",
  "objective-conflict",
  "objective-candidate",
  "publication",
] as const);
export type DecisionKind = (typeof DECISION_KINDS)[number];
```

The five members are the five `DecisionKindLabel` members at
`src/domain/actionability.ts:382-387`, in that order. `kindLabel` stays the
presentation string at `actionability.ts:389-420`; nothing in this file imports
it.

1b. **The machine kind is produced, never cast from the label.** In
`src/domain/actionability.ts`, add

```ts
export function decisionKind(context: DecisionContext): DecisionKind | null;
const KIND_LABEL: Record<DecisionKind, DecisionKindLabel> = { … };
```

`decisionKind` carries the condition ladder currently in `decisionKindLabel`
(`:389-420`), in the same order. `decisionKindLabel` becomes
`const k = decisionKind(context); return k === null ? null : KIND_LABEL[k];`.
Identity and filtering read `decisionKind`; nothing casts `kindLabel` into
`DecisionKind`, so the label stays free to change.

2. Subject and key:

```ts
export type DecisionSubjectType = "task" | "objective" | "initiative";
export interface DecisionSubject {
  readonly type: DecisionSubjectType;
  readonly id: string;
}
export function decisionSubject(item: {
  taskId?: string;
  objectiveId?: string;
  initiativeId: string;
}): DecisionSubject;
export function subjectKey(subject: DecisionSubject): string; // `${type}:${id}`
```

`decisionSubject` precedence is exactly `taskId` → `objectiveId` →
`initiativeId` (the same precedence `rankDecisions` already uses at
`src/domain/decision-queue.ts:263-264`).

3. The occurrence shapes:

```ts
export type DecisionOccurrenceState = "open" | "resolved" | "expired";
export type DecisionClosedReason = "verdict" | "superseded" | "vanished";

export interface DecisionNames {
  readonly projectId: string;
  readonly projectName: string;
  readonly initiativeId: string;
  readonly initiativeName: string | null;
  readonly objectiveId: string | null;
  readonly objectiveName: string | null;
  readonly taskId: string | null;
  readonly taskTitle: string | null;
}

export interface OpenOccurrence {
  readonly id: string;
  readonly subject: DecisionSubject;
  readonly kind: DecisionKind;
  readonly openingEventId: string | null;
  readonly verdictLookupId: string | null;
}
```

`verdictLookupId` is the extra entity whose verdict event closes this
occurrence: the **repository id** for a `publication` occurrence, `null` for
every other kind. It is stored on the row so a close can be classified after the
item has disappeared.

4. The reconcile planner — the only decision-making function in this story:

```ts
export interface ReconcileInput {
  readonly open: readonly OpenOccurrence[];
  readonly items: readonly ReconcileItem[]; // one per decision, UNFILTERED
  // key -> latest verdict event id, keys typed: `task:<id>`, `objective:<id>`,
  // `initiative:<id>`, `repository:<id>`
  readonly verdictEventIds: ReadonlyMap<string, string>;
  readonly newId: () => string;
}
export interface ReconcileItem {
  readonly subject: DecisionSubject;
  readonly kind: DecisionKind;
  readonly openingEventId: string | null;
  readonly verdictLookupId: string | null;
  readonly names: DecisionNames;
}
export interface ReconcilePlan {
  readonly opened: readonly {
    id: string;
    subject: DecisionSubject;
    kind: DecisionKind;
    openingEventId: string | null;
    names: DecisionNames;
  }[];
  readonly refreshed: readonly {
    id: string;
    kind: DecisionKind;
    names: DecisionNames;
  }[];
  readonly closed: readonly {
    id: string;
    state: "resolved" | "expired";
    closedReason: DecisionClosedReason;
    closingEventId: string | null;
  }[];
  readonly idBySubjectKey: ReadonlyMap<string, string>;
}
export function reconcileOccurrences(input: ReconcileInput): ReconcilePlan;
```

Pinned rules — no other behaviour is permitted:

- **Identity is keyed by subject only, never by kind.** At most one occurrence
  per subject is open. An item whose subject already has an open occurrence and
  whose **opening event matches** reuses that id, even when `kind` differs from
  the stored kind — the kind is refreshed on the same row.
- **The opening event id is the generation marker.** For an item whose subject
  has an open occurrence with `stored.openingEventId !== item.openingEventId`
  **and both are non-null**, the stored occurrence is `closed` with
  `state: "expired"`, `closedReason: "superseded"`,
  `closingEventId: item.openingEventId`, and a **new** occurrence is `opened` in
  the same plan. This is the retry-then-fail-again recurrence: without it, one
  reconcile that never observed the gap would let a stale id address a new
  decision.
- When either side's `openingEventId` is `null` the generation cannot be
  compared, so the occurrence is refreshed, not superseded. State this limit in
  the module comment: an `actionableSince: null` decision cannot detect a
  recurrence it never saw close.
- An item whose subject has no open occurrence is `opened` with `input.newId()`.
- An open occurrence whose subject appears in **no** item is `closed`.
- Closed classification: let `bound = openingEventId ?? occurrence.id` (both are
  ULIDs, so `>` is plain string comparison), and let the lookup keys be
  `subjectKey(subject)` plus, when `verdictLookupId !== null`,
  `` `repository:${verdictLookupId}` ``. If the **greatest** verdict event id
  found under those keys is `> bound`, the close is `state: "resolved"`,
  `closedReason: "verdict"`, `closingEventId: <that event id>`. Otherwise it is
  `state: "expired"`, `closedReason: "vanished"`, `closingEventId: null`.
  A supersession (rule above) is classified `superseded` and never consults the
  verdict map.
- **Duplicate subjects are rejected deterministically**: two items with the same
  `subjectKey` are impossible from `projectDecisions` (a subject holds one
  status), so `reconcileOccurrences` keeps the **first** in input order and
  ignores the rest — never mints two ids for one key.
- **Deterministic order.** `opened`, `refreshed` and `closed` are each sorted
  ascending by `subjectKey`. `newId()` is called once per opened entry, in that
  sorted order, and never for a refreshed or closed entry.
- `idBySubjectKey` covers every item's subject (opened + refreshed), and nothing
  else.

## Constraints

- No import of `actionability.ts`'s `DecisionKindLabel` in this file.
- No `Date.now()`, no `newId()` import — ids arrive via `input.newId`.
- Do not touch `src/domain/decision-queue.ts` in this story (Story 4 does).

## Verify

- `node --test src/domain/decision-occurrence.test.ts`, asserting:
  - `DECISION_KINDS` deep-equals the five literals in the order above, and is
    frozen.
  - in `src/domain/actionability.test.ts`: the `(017-S4-kind-labels)` table at
    `:988-1084` gains a `decisionKind` column — the six cases return the machine
    kind and `null` — and a case asserts `decisionKindLabel` equals
    `KIND_LABEL[decisionKind(ctx)]` for all five kinds.
  - `decisionSubject` precedence: task id wins over objective id wins over
    initiative id.
  - reuse: one open occurrence + one item on the same subject → `opened` empty,
    `refreshed` names that id, `newId` not called.
  - kind change: same subject, stored kind `task-review`, item kind
    `operational-failure` → `refreshed` carries the **same id** and the new
    kind; `opened` and `closed` are empty.
  - recurrence **through an observed gap**: reconcile #1 opens id A; reconcile #2
    with no items closes A; reconcile #3 with the same subject again opens id B
    with `B !== A`.
  - recurrence **with no observed gap** (the retry-then-refail race): reconcile
    #1 opens A with `openingEventId: "E1"`; reconcile #2 sees the same subject
    with `openingEventId: "E2"` → A is closed `expired`/`superseded`/`"E2"` and a
    new id B is opened; `B !== A`.
  - a null opening event on either side refreshes instead of superseding.
  - duplicate subject keys in `items` → one `opened` entry, `newId` called once.
  - a `publication` item's `verdictLookupId` is consulted: a
    `repository:<id>` verdict event greater than the bound closes it
    `resolved`/`verdict`.
  - minting for `openingEventId: null` → `opened` entry with
    `openingEventId: null` and an id from `newId`.
  - close classification: verdict event id greater than the bound → `resolved` /
    `verdict` / that event id; verdict event id **less** than the bound →
    `expired` / `vanished` / `null`; no verdict event → `expired` / `vanished` /
    `null`.
  - determinism: three subjects supplied in shuffled order produce `opened`
    sorted by `subjectKey`, and a `newId` stub returning `"1","2","3"` assigns
    them in that sorted order.
- `npm run verify` exits 0.
- Proof: none directly (this story is the identity rule the Proof's phases C, D
  and E depend on).
