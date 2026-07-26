# Story 6 — Observability: `after:` / `waiting on:` rendering

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: Stories 1-5 (all of them — this story is the Proof surface)

> **Lane note.** `scripts/*` is forbidden to both `/work` roles
> (`scripts/lane-check.sh:12`). `scripts/e2e/sequencing-proof.sh`,
> `scripts/e2e/make-sequencing-graph.sh` and the `e2e-status.sh` edit are
> **maintainer artifacts, already committed with the epic** — do not write or edit
> them in this story. The first two exist and already run: the proof's setup
> completes and it currently fails at the first unimplemented verb, which is the
> correct pre-implementation state. This story's `/work` scope is 6a-6c only.

## Change

### 6a. `GetInitiative` — `src/app/initiative/get-initiative.ts`

Extend the narrow `InitiativeSource` (`get-initiative.ts:4`) and add a second
narrow port:

```ts
interface InitiativeSource {
  get(id: string): Initiative | undefined;
}

interface InitiativeSequencingSource {
  listInitiativeAfter(initiativeId: string): string[];
}
```

`GetInitiativeOutput` gains two fields, both always present:

```ts
  /** The `after` prerequisite ids, sorted ascending. */
  after: string[];
  /** Prerequisites that do not yet satisfy their edge, in `after` order. */
  waiting: Array<{ id: string; neverSatisfies: boolean }>;
```

`execute` computes them after the existing `undefined` guard:

```ts
const after = this.#sequencing.listInitiativeAfter(input.id);
const waiting = unsatisfiedInitiativeEdges(
  after.map((id) => ({ id, status: this.#initiatives.get(id)?.status })),
);
```

`sequencing` is the second constructor parameter. Wiring at
`src/composition.ts:619-621`:

```ts
const getInitiative = new GetInitiative(
  { get: (id) => initiativeRepository.get(id) },
  { listInitiativeAfter: (id) => sequencingRepository.listInitiativeAfter(id) },
);
```

### 6b. `GetObjective` — `src/app/objective/get-objective.ts`

Same treatment: `ObjectiveSource` (`get-objective.ts:4`) keeps
`getObjective(id)`; add `ObjectiveSequencingSource` with
`listObjectiveAfter(objectiveId): string[]` as a **third** constructor parameter
(after `repos`). `GetObjectiveOutput` gains the same `after` / `waiting` fields,
computed with `unsatisfiedObjectiveEdges` and
`this.#objectives.getObjective(id)?.status`. Wiring at
`src/composition.ts:622-625`.

### 6c. Renderers

`src/apps/cli/initiative.ts:71-94` (`runGetInitiative`) — insert between the
`status:` line and the `branch:` line:

```ts
if (output.after.length > 0) {
  lines.push(`after: ${output.after.join(" ")}`);
}
for (const w of output.waiting) {
  lines.push(
    w.neverSatisfies
      ? `waiting on: ${w.id} (discarded — will never satisfy)`
      : `waiting on: ${w.id}`,
  );
}
```

Final non-JSON field order: `id`, `name`, `status`, `after` (omitted when empty),
zero or more `waiting on`, `branch`, `workspace` (optional).

`src/apps/cli/objective.ts:60-82` (`runGetObjective`) — the identical block
inserted between the `status:` line and the `integration:` lines. Field order:
`id`, `name`, `status`, `after`, `waiting on`…, `integration`….

The em dash and the exact words `(discarded — will never satisfy)` are
load-bearing (epic decision record). `--json` output carries `after` and
`waiting` verbatim from the DTO — no formatting.

### 6d-6f. Moved out of `/work` scope

The `e2e-status.sh` blocked-reason line, `make-sequencing-graph.sh` and
`sequencing-proof.sh` are maintainer artifacts (lane note above). They are
specified and committed with the epic; nothing to do here.

## Constraints

- No new status is rendered as a status. `status:` still prints only a real
  persisted value; `waiting on:` is a separate derived line.
- A `discarded` prerequisite renders and blocks; it never cascades.
- Do not touch anything under `scripts/` — the lane check rejects it.

## Verify

`src/app/initiative/get-initiative.test.ts`:

1. No edges → `after` deep-equals `[]` and `waiting` deep-equals `[]`.
2. `after: [X]` with X `landed` → `after` is `[X]`, `waiting` is `[]`.
3. `after: [X]` with X `building` → `waiting` deep-equals
   `[{ id: X, neverSatisfies: false }]`.
4. `after: [X]` with X `discarded` → `waiting` deep-equals
   `[{ id: X, neverSatisfies: true }]`.
5. `after: [B, A]` from the repo (already sorted `[A, B]`) → `after` and
   `waiting` both preserve that order.

`src/app/objective/get-objective.test.ts` — the same 1-5 matrix with `integrated`
as the satisfying status and `awaiting_confirmation` / `conflict` as blocking.

`src/apps/cli/get-initiative.test.ts`:

6. `after: []` → stdout has **no** line starting `after:` and none starting
   `waiting on:`.
7. `after: [X]`, X `building` → stdout contains exactly `after: X` and exactly
   `waiting on: X`, and the `after:` line appears **before** the `branch:` line
   (assert index order).
8. X `discarded` → stdout contains
   `waiting on: X (discarded — will never satisfy)` exactly.
9. `after: [A, B]` → stdout contains exactly `after: A B` (space-joined).
10. `--json` → parsed stdout has `after` and `waiting` matching the DTO.

`src/apps/cli/get-objective.test.ts` — the same 6-10 matrix, additionally
asserting the `after:` / `waiting on:` lines appear **before** any
`integration:` line.

Commands:

- `node --test src/app/initiative/get-initiative.test.ts src/app/objective/get-objective.test.ts src/apps/cli/get-initiative.test.ts src/apps/cli/get-objective.test.ts`
- `npm run verify` exits 0
- `scripts/e2e/sequencing-proof.sh` prints `007.17 PROOF OK (sequencing)` and
  exits 0 — the epic's whole Proof, green only once this story lands.

Proof: delivers the rendering claims 1, 2 and 7 depend on (`after:` and
`waiting on:` on both `get initiative` and `get objective`).
