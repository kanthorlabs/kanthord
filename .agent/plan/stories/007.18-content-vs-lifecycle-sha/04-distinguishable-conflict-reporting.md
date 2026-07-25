# Story 4 — Distinguishable conflict reporting

Epic: `.agent/plan/epics/007.18-content-vs-lifecycle-sha.md`
Depends on: Story 1 (the `TaskCasResult.reason` discriminator).

## Change

### 1. `src/app/graph/apply-graph.ts:38-46` — a typed CAS reason field

`reason?: string` already carries **preflight** diagnostics for missing nodes
(`"non-pending"` / `"drifted"`, set at `:301-303`, printed as
`missing (<reason>): <label>` at `:193-194`). CAS failures are a different
category — which predicate failed during the write attempt — so they get their own
typed field instead of a string convention inside `reason`:

```ts
  /** Set only when a write-phase task CAS failed; says which predicate refused. */
  casReason?: { kind: "sha" } | { kind: "status"; currentStatus: string };
```

Leave `reason?: string` and every existing use of it untouched.

### 2. `apply-graph.ts:96-102` — a helper next to `LateCasConflict`

`LateCasConflict` itself is unchanged. Add:

```ts
/**
 * Turn a task CAS conflict into the classification reported to the caller.
 * A failed status predicate is a lifecycle refusal (`locked`); a failed sha
 * predicate is an out-of-band content change (`drifted`).
 */
function casConflictClassification(
  cls: ApplyClassification,
  conflict: { reason: "sha" | "status"; currentStatus: string },
): ApplyClassification {
  return conflict.reason === "status"
    ? {
        ...cls,
        class: "locked",
        casReason: { kind: "status", currentStatus: conflict.currentStatus },
      }
    : { ...cls, class: "drifted", casReason: { kind: "sha" } };
}
```

### 3. Use it at both task CAS sites

- `apply-graph.ts:493-495`:

  ```ts
  if (casResult.status === "conflict") {
    throw new LateCasConflict(casConflictClassification(cls, casResult));
  }
  ```

- `apply-graph.ts:608-610` — the `conditionalDeleteTask` branch, identically.

The `conditionalReparent` throws at `:476-478` and `:504-506` keep
`throw new LateCasConflict(cls)`; `conditionalReparent` still returns plain
`CasResult` with no reason (Story 1 B2).

### 4. `src/apps/cli/import-graph.ts:294-299` — per-node refusal lines

```ts
if (!dryRun && result.conflicts.length > 0) {
  const casConflicts = result.conflicts.filter(
    (c) => c.kind === "task" && c.casReason !== undefined,
  );
  if (casConflicts.length > 0) {
    for (const c of casConflicts) {
      stderr.push(
        c.casReason!.kind === "status"
          ? `refused: task ${c.id} is no longer pending (status: ${c.casReason!.currentStatus})`
          : `refused: task ${c.id} changed outside this package`,
      );
    }
  } else {
    const clauses: string[] = [];
    if (driftedCount > 0) clauses.push(`${driftedCount} drifted node(s)`);
    if (lockedCount > 0) clauses.push(`${lockedCount} locked node(s)`);
    stderr.push(`refused: ${clauses.join(" and ")}`);
  }
}
```

The two strings verbatim from the epic's decision record:

- `refused: task <id> is no longer pending (status: running)`
- `refused: task <id> changed outside this package`

## Constraints

- Preflight conflicts keep today's aggregate wording exactly
  (`refused: 1 drifted node(s)`, `refused: 2 locked node(s)`,
  `refused: 1 drifted node(s) and 1 locked node(s)`) — existing tests pin them.
- Do not overload `reason?: string` with CAS values, and do not parse any string
  prefix.
- Do not change the exit-code logic at `:292`
  (`dryRun || result.applied ? 0 : 1`), the classification-line formatting at
  `:185-200`, or the summary line at `:211-213` (a late-CAS `locked` conflict still
  contributes `, 1 locked`, which the proof script greps).

## Verify

`node --test src/app/graph/apply-graph.test.ts`

- Reuse Story 1's race fake: a status conflict from `compareAndApply` yields
  `applied === false`, one conflict, shaped
  `{ kind: "task", class: "locked", casReason: { kind: "status", currentStatus: "running" } }`
  with the task's id.
- New: a sha conflict from `compareAndApply` yields
  `{ class: "drifted", casReason: { kind: "sha" } }`.
- New: both cases again for `conditionalDeleteTask`
  (`deleteMissing: true, confirmDelete: true`).
- New regression guard: a **missing** node's `reason` is still `"non-pending"` /
  `"drifted"` and its `casReason` is `undefined` — the two channels stay separate.
- Existing test at `:2185` (late-CAS rollback → `applied: false`) still passes;
  update its conflict-shape assertion if it asserts `class`/`reason`.

`node --test src/apps/cli/import-graph.test.ts`

- New: a status CAS conflict prints exactly
  `refused: task <ID> is no longer pending (status: running)` and **not** the
  aggregate `node(s)` wording.
- New: a sha CAS conflict prints exactly
  `refused: task <ID> changed outside this package`.
- New: a **preflight** drifted conflict still prints `refused: 1 drifted node(s)`
  (regression guard on the fallback branch).
- New: a `missing (non-pending): <label>` line is unaffected.
- Existing aggregate-string tests pass unchanged.

`npm run verify` exits 0.

Proof: delivers step 4 of `scripts/e2e/sha-classification-proof.sh` —
`grep -q "locked: $RAN"`.
