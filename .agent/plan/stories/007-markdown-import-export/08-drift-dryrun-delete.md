# Story 08 — Drift report, `--dry-run`, guarded `--delete-missing`

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

`--dry-run` runs the same preflight classifier as `--apply` and prints the plan
without writing. `--delete-missing` opts into removing nodes that were exported
as files but are now absent — but ONLY after REVIEW + explicit CONFIRMATION,
PENDING-ONLY, and only for nodes safe to delete (TB1/TB3/TB5). Omission never
auto-deletes (a non-goal made explicit). Deletion runs inside the same apply
UnitOfWork via the Story 06 conditional-delete CAS ops.

## Locked contracts

- **CLI flags on `import graph --apply`:** `--dry-run`, `--delete-missing`,
  `--confirm-delete`. `--dry-run` is mutually informative with `--delete-missing`
  (dry-run prints the deletion plan without executing).
- **Confirmation contract (ONE, TB4):** a delete executes iff
  `--confirm-delete` is passed OR a positive `y/N` answer is read from a TTY.
  Non-interactive (no TTY) WITHOUT `--confirm-delete` → prints the plan, deletes
  NOTHING. The Proof feeds `< /dev/null` to prove the non-interactive path.
- **Eligibility (locked):** a node is delete-eligible iff (a) it is in the
  manifest **`files`** set (it had a file — TB1), (b) its file is now absent,
  (c) its live DB `sha256` STILL equals its manifest baseline (a drifted missing
  node is NOT deletable), AND (d) it is a **pending task**, OR an objective that
  ends up EMPTY. The initiative is never deletable by an apply.
- **Deletion ops:** `conditionalDeleteTask(id, expectedSha)` and
  `conditionalDeleteObjective(id, expectedSha)` (with an atomic emptiness check
  — TB5), from Story 06.

## Behavior (locked)

- A **missing** node NOT in `files` (created after export / elsewhere) is "not
  in this package", never a delete candidate (TB1).
- A **drifted** delete-candidate (in `files`, file absent, but DB sha !=
  baseline) is **skipped-with-warning** — reported, NOT deleted, and does NOT
  abort the spec apply (delete is opt-in/advisory, TB3) — distinct from a
  drifted MUTATED node, which aborts (Story 07).
- A missing **objective** is deleted only if empty after its missing tasks are
  removed (or it had none); a non-empty objective is kept with a reason.
- Ineligible missing nodes are reported `missing (not deletable: <reason>)`
  (non-pending / drifted / no-baseline / non-empty).
- Deletions run in the SAME `UnitOfWork` as the spec apply, after the clean
  preflight; a delete CAS conflict aborts the whole apply.

## Constraints

- Reuse the Story 07 classifier + one UnitOfWork; do not add a second txn.
- CAS scope for the SPEC apply stays package-present nodes only (S2) — the
  delete path is the only place omitted nodes are touched, and only under
  confirmation.

## Verification Gate

- `node --test src/app/graph/apply-graph.test.ts
src/apps/cli/import-graph.test.ts` green; typecheck 0; lint clean.

### Task T1 — `--dry-run` (classifier, no writes)

**Requires:** Story 07 (classifier + CLI branch).

**Input:** `apply-graph.ts` (a `dryRun` path or a shared classify entrypoint)

- `import-graph.ts` + tests.

**Action — RED:** tests: (a) `--dry-run` on an edited + a removed-file package
prints created/updated/unchanged/missing/drifted/locked lines and writes
NOTHING (`list task` counts unchanged); (b) a removed pending-task file is
labeled `missing`, distinct from a non-pending task not exported which is
`missing (non-pending, expected)`. Fails today: no dry-run.

**Action — GREEN:** run the classifier and print; skip mutation when `dryRun`.

**Action — REFACTOR:** share the classify entrypoint between `--apply` and
`--dry-run` (one classifier).

**Output:** a no-write preview identical in classification to a real apply.

**Verify:** `node --test src/apps/cli/import-graph.test.ts` green.

### Task T2 — `--delete-missing` eligibility + plan + confirmation gate

**Requires:** T1; Story 06 delete ops.

**Input:** `apply-graph.ts` (eligibility) + `import-graph.ts` (confirmation)

- tests.

**Action — RED:** tests: (a) eligibility — a `files`-member pending task whose
file is gone and whose sha matches → eligible; a non-pending one → ineligible
`(non-pending)`; a drifted one → ineligible/skip `(drifted)`; a node never in
`files` → not a candidate at all; (b) `--delete-missing` WITHOUT confirmation
(stdin `/dev/null`, no `--confirm-delete`) prints `would delete`/`delete plan`
and deletes NOTHING (`list task` count unchanged); (c) supplying
`--confirm-delete` proceeds to execution (covered in T3). Fails today: flag
absent.

**Action — GREEN:** compute the eligibility set + reasons; print the plan; gate
execution on the TB4 confirmation contract.

**Action — REFACTOR:** none.

**Output:** review-first deletion with the correct eligibility rules.

**Verify:** `node --test src/apps/cli/import-graph.test.ts` green.

### Task T3 — confirmed delete execution + objective emptiness + slice e2e

**Requires:** T2.

**Input:** `apply-graph.ts` + `import-graph.ts` + tests (one real-SQLite for
the objective-emptiness delete).

**Action — RED:** tests exercising the epic Proof's delete legs: (a)
`--delete-missing --confirm-delete` removes exactly the eligible pending task
(`1 deleted`), leaving siblings; (b) a drifted delete-candidate is
skipped-with-warning and does NOT abort — the rest of the apply still commits
(TB3); (c) an emptied objective is deleted via `conditionalDeleteObjective`
(membership + sha + atomic emptiness — TB5); a non-empty one is kept; (d) the
initiative is never deleted. Fails today: execution absent.

**Action — GREEN:** execute eligible deletes via the CAS delete ops inside the
apply UnitOfWork; report skips.

**Action — REFACTOR:** none.

**Output:** guarded, pending-only deletion — the delete legs of the epic Proof.

**Verify:** `node --test src/apps/cli/import-graph.test.ts` green; typecheck 0;
lint clean.
