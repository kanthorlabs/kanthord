# Story 1 — Detect and refuse at preflight

Epic: `.agent/plan/epics/007.19-refuse-uncreatable-objective.md`
Depends on: EPIC 007.18 (its hoisted `resolveObjectiveId` at `apply-graph.ts:247-251`
is the resolution mechanism this story reuses; do not add a second one).

## Change

### 1. `src/app/graph/import-errors.ts` — new error class

Append after `StaleManifestError` (which ends at `:150`). Mirror that class's shape
exactly: `extends Error`, `readonly` fields first, positional args, `super(<message>)`,
then `this.name`, then field assignments. Every class in this file extends plain
`Error` — there is no shared base class.

```ts
// ---------------------------------------------------------------------------
// UncreatableObjectiveError — a task's `objective:` names an objective that does
// not exist, and `--apply` cannot create objectives (EPIC 007.19 Story 1).
// ---------------------------------------------------------------------------

export class UncreatableObjectiveError extends Error {
  readonly initiativeId: string;
  readonly unresolvable: ReadonlyArray<{
    objectiveRef: string;
    taskRefs: string[];
  }>;

  constructor(
    initiativeId: string,
    unresolvable: ReadonlyArray<{ objectiveRef: string; taskRefs: string[] }>,
  ) {
    const parts = unresolvable.map(
      (u) => `${u.objectiveRef} (blocks ${u.taskRefs.join(", ")})`,
    );
    super(
      `cannot apply: ${parts.length} objective ref(s) do not exist and ` +
        `--apply cannot create objectives: ${parts.join("; ")} — ` +
        `create each first with: kanthord create objective ` +
        `--initiative ${initiativeId} --name <name>`,
    );
    this.name = "UncreatableObjectiveError";
    this.initiativeId = initiativeId;
    this.unresolvable = unresolvable;
  }
}
```

The remedy string is exact: `--initiative` and `--name` are both `requiredOption`
on `src/apps/cli/commands/create/objective.ts:12-13`.

### 2. `src/app/graph/apply-graph.ts` — import the class

Add `UncreatableObjectiveError` to the existing `./import-errors.ts` import group
at `:32-36` (which already imports `CrossInitiativeError`, `UnknownNodeError`,
`StaleManifestError`).

### 3. `src/app/graph/apply-graph.ts` — preflight detection + throw

Insert **immediately after the `summary` object literal ends at `:665`** and
**before the write gate at `:673`** (`if (conflicts.length === 0 && … && !input.dryRun)`).

That position is load-bearing and is fixed by two requirements:

- After `:665` — all classification is complete, so nothing later can add a node.
- Before `:673` — the gate is what `--dry-run` skips. Placing the throw before it
  makes `--dry-run` and `--apply` take the same path, which Proof case 1 requires
  (`--dry-run` must exit non-zero). Placing it inside or after the gate would leave
  `--dry-run` silent and exiting 0 — the exact bug this epic fixes.

```ts
// --- Uncreatable-objective refusal (EPIC 007.19 S1) ---
// `--apply` creates tasks but never objectives, so a task whose
// `objective:` resolves to nothing can never be parented. Refuse the whole
// package here — before the write gate, so --dry-run reports it too.
// A ULID objectiveRef absent from package and DB already threw
// UnknownNodeError at :464, so only non-ULID refs reach this point.
const unresolvableByRef = new Map<string, string[]>();
for (const task of pkg.tasks) {
  const resolved = resolveObjectiveId(task.objectiveRef);
  if (this.#deps.initiatives.getSha256(resolved) === undefined) {
    const existing = unresolvableByRef.get(task.objectiveRef);
    if (existing === undefined) {
      unresolvableByRef.set(task.objectiveRef, [task.ref]);
    } else {
      existing.push(task.ref);
    }
  }
}
if (unresolvableByRef.size > 0) {
  throw new UncreatableObjectiveError(
    input.initiativeId,
    [...unresolvableByRef].map(([objectiveRef, taskRefs]) => ({
      objectiveRef,
      taskRefs,
    })),
  );
}
```

## Constraints

- **Existence probe is `initiatives.getSha256(id)`**, not `getObjective(id)`.
  `getSha256` is already this file's objective-existence idiom (`:281`, `:427`, and
  `:462` inside the `UnknownNodeError` check) and the test fakes already implement
  it. Do not introduce a new port call or a new port method.
- **Reuse `resolveObjectiveId` (`:250-251`).** There must remain exactly one
  resolution mechanism in this file. Do not read `objRefToId` directly and do not
  write a second resolver.
- **Order is pinned and must not change:** iterate `pkg.tasks` in array order;
  group by the task's raw `objectiveRef`; emit groups in first-encounter order;
  emit `taskRefs` within a group in encounter order. `Map` preserves insertion
  order, which is what makes the aggregated message deterministic. Same package →
  same message, byte for byte.
- **Aggregate — never throw on the first unresolvable ref.** Collect every one, so
  a user with three new objectives learns all three in one run.
- **`input.initiativeId`, not `manifest.initiativeId`.** This is the opposite of
  007.18 Story 3's `StaleManifestError`, deliberately: the remedy is to create the
  objective on the initiative the user is applying to. Do not "fix" this to match
  the manifest.
- Do not touch the existing ULID validation at `:449-481`. It runs earlier and must
  keep throwing `UnknownNodeError` for a bogus ULID objectiveRef — this story only
  covers refs that survive it.
- Do not add an objective-creation path. Explicit epic non-goal.

## Verify

`node --test src/app/graph/apply-graph.test.ts`

New tests in `src/app/graph/apply-graph.test.ts`, using `new ApplyGraph(makeDeps())`
(`:551-567`) and the `assert.rejects` + `instanceof` + field-assertion idiom of the
007.18 `StaleManifestError` test at `:985-1006`. Build the fixture by taking
`makeBasePackage()` (`:451-501`) and adding an objective with **no `id`** plus a task
whose `objectiveRef` is that objective's `ref` — the nearest existing shape is
`:1770-1800`, which has an id-bearing objective with a slug ref, so it must be
adapted, and `makeTwoObjPackage` (`:3559-3581`) shows the append-an-objective idiom.

1. **The refusal fires.** Package with objective `{ ref: "orphan-obj" }` (no `id`)
   and task `{ ref: "orphan-task", objectiveRef: "orphan-obj" }` →
   `assert.rejects` with `err instanceof UncreatableObjectiveError`,
   `err.initiativeId === INIT_ID`, and
   `assert.deepEqual(err.unresolvable, [{ objectiveRef: "orphan-obj", taskRefs: ["orphan-task"] }])`.
2. **`--dry-run` throws too.** Same package, `execute({ pkg, initiativeId, dryRun: true })`
   → rejects with the same class. This is the unit equivalent of Proof case 1 and the
   assertion that fails first against the pre-story tree.
3. **Nothing is written.** Same package, using the CAS spy `FakeTaskRepositoryWithCas`
   (`:381`) and `FakeGraphImportMapWithSpy` (`:409-422`) → assert the spy's call count
   is `0` after the rejection. Mirrors the 007.18 test at `:1060-1100`.
4. **Aggregation and order.** Package with two id-less objectives (`ref: "orphan-a"`,
   `ref: "orphan-b"`) and three id-less tasks in `pkg.tasks` order
   `[t1→orphan-a, t2→orphan-b, t3→orphan-a]` → one rejection whose
   `err.unresolvable` deep-equals
   `[{ objectiveRef: "orphan-a", taskRefs: ["t1", "t3"] }, { objectiveRef: "orphan-b", taskRefs: ["t2"] }]`
   — groups in first-encounter order, task refs in encounter order.
5. **The message names the ref and the remedy.** Assert `err.message` contains
   `"orphan-obj"` and `"kanthord create objective --initiative"`. This is what Proof
   case 3's `grep -q 'orphan-obj'` depends on.
6. **Regression — a fully resolvable package does not throw.** Unmodified
   `makeBasePackage()` → `execute` resolves normally, no rejection, and the result's
   `summary.unchanged` is unchanged from today. The gate must not become a blanket
   refusal (Proof case 4).
7. **Regression — a live DB objective not in the package still resolves.** Task whose
   `objectiveRef` is a ULID present in the seeded fake DB (`makeBaseDb`, `:504`) but
   absent from `pkg.objectives` → no rejection.
8. **Ordering vs `UnknownNodeError`.** Task whose `objectiveRef` is a ULID absent from
   both package and DB → rejects with `UnknownNodeError` (from `:464`), **not**
   `UncreatableObjectiveError`. Pins that the earlier validation still wins.
   Compare `src/app/graph/boundary-cases.test.ts:508-562`.

`npm run verify` exits 0.

Proof: delivers the `ApplyGraph` half of Proof cases 1, 2 and 4 — `--dry-run` exits
non-zero naming `orphan-obj`, `--apply` writes nothing, and a resolvable package
still applies. Case 3's "no stack frames" half needs Story 2.
