# Story 06 — Conditional-write (CAS) repository port + real-SQLite rollback proof

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

The apply path expresses every mutation as an explicit **conditional
(compare-and-swap) repository operation** so a use case never issues raw SQL
(B8/RB4). Each op takes `(id, expectedSha[, payload])` and returns
`applied` (with the fresh token) or `conflict` (with the current token) — the
0-row `UPDATE … WHERE sha256=?` is encapsulated behind a named method. This
story also lands the real-SQLite late-failure test that proves the one
`BEGIN IMMEDIATE` UnitOfWork rolls back fully (B10) — fakes cannot prove
atomicity.

## Locked contracts

```ts
// src/storage/port.ts — result shape
export type CasResult =
  | { status: "applied"; freshSha: string }
  | { status: "conflict"; currentSha: string };

// On TaskRepository:
compareAndApply(id: string, expectedSha: string, spec: {
  title: string; instructions: string; ac: string[]; agent: string;
  verification: string[] | null; dependencies: string[];  // full dependency REPLACEMENT
}): CasResult;
conditionalReparent(id: string, expectedSha: string, objectiveId: string): CasResult;
conditionalDeleteTask(id: string, expectedSha: string): CasResult;

// On InitiativeRepository (Objective has no own repo — RB4):
conditionalRenameInitiative(id: string, expectedSha: string, name: string): CasResult;
conditionalRenameObjective(id: string, expectedSha: string, name: string): CasResult;
conditionalDeleteObjective(id: string, expectedSha: string): CasResult; // atomic emptiness check — Story 08
```

## Behavior (locked)

- Each op runs the write conditioned on `sha256 = expectedSha`, restamps the
  fresh token in the SAME statement (reusing the Story 02 canonicalizer), and
  `RETURNING sha256`. Zero rows affected → `{ status: "conflict", currentSha }`
  (read the current token to return it). Non-zero → `{ status: "applied",
freshSha }`.
- `compareAndApply` replaces the task spec AND its dependency set atomically
  (delete + re-insert `task_dependencies`), then restamps — the token now
  reflects the new deps (Story 02 write-hook path is reused, not bypassed).
- These ops assume the caller already holds an open `UnitOfWork.transaction`
  (the apply use case opens exactly one). They never open their own txn.
- Live-status/lifecycle checks are NOT in these ops — the apply preflight reads
  live status separately (B13, Story 07). CAS detects CHANGE; the preflight
  labels locked-vs-drifted.

## Constraints

- The apply use case calls only these port methods — no `db.prepare` in
  `src/app/`. The ops live on the existing repos (`sqlite-task-repository.ts`,
  `sqlite-initiative-repository.ts`).
- Fakes implementing the ops maintain an in-memory `sha256` per node so
  hermetic use-case tests can exercise applied/conflict without SQLite.

## Verification Gate

- `node --test src/storage/sqlite/sqlite-task-repository.test.ts
src/storage/sqlite/sqlite-initiative-repository.test.ts
src/storage/sqlite/cas-rollback.integration.test.ts` green; typecheck 0;
  lint clean.

### Task T1 — task CAS ops (compareAndApply / reparent / delete)

**Requires:** Story 02 (sha256 column + canonicalizer + write-hook).

**Input:** `src/storage/sqlite/sqlite-task-repository.ts` + test; port additions.

**Action — RED:** tests (real SQLite): (a) `compareAndApply` with the matching
sha applies the new spec + deps and returns `applied` with a fresh sha
different from `expectedSha`; (b) with a STALE sha returns `conflict` +
`currentSha`, and the row is UNCHANGED; (c) `compareAndApply` replacing deps
makes the fresh sha equal the recomputed aggregate (deps in SET order); (d)
`conditionalReparent` moves `objectiveId` on a match, conflicts on a stale sha;
(e) `conditionalDeleteTask` deletes on a match (row gone, `graph_import_map`
cascades), conflicts on a stale sha (row kept). Fails today: methods absent.

**Action — GREEN:** implement the three task ops.

**Action — REFACTOR:** share the "restamp fresh sha" step with the Story 02
write-hook helper (one canonicalization site).

**Output:** task-level CAS with correct applied/conflict semantics.

**Verify:** `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
green.

### Task T2 — initiative/objective CAS ops (rename / delete-objective)

**Requires:** Story 02.

**Input:** `src/storage/sqlite/sqlite-initiative-repository.ts` + test; port
additions.

**Action — RED:** tests (real SQLite): (a) `conditionalRenameInitiative` /
`conditionalRenameObjective` apply on a match (name changed, fresh sha),
conflict on a stale sha (unchanged); (b) `conditionalDeleteObjective` on a
match with NO child tasks deletes it (atomic emptiness check passes); (c) the
same op on an objective that STILL has a task returns a distinct
non-applied result (emptiness-check failure — the exact shape is pinned with
Story 08's delete flow; here assert it does NOT delete). Fails today: methods
absent.

**Action — GREEN:** implement the rename ops + the emptiness-guarded delete.

**Action — REFACTOR:** none.

**Output:** node-rename + guarded objective-delete CAS ops (RB4 coverage).

**Verify:** `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
green.

### Task T3 — real-SQLite late-failure rollback (B10)

**Requires:** T1, T2.

**Input:** new `src/storage/sqlite/cas-rollback.integration.test.ts`.

**Action — RED:** a test that, inside ONE `UnitOfWork.transaction`, performs a
successful `compareAndApply` on task A, then a `compareAndApply` on task B
followed by a thrown error (simulating a late failure), and asserts after the
rolled-back txn that BOTH A and B are byte-identical to their pre-txn state
(sha unchanged) — proving atomicity of the single `BEGIN IMMEDIATE` the apply
relies on. Fails today: no such coverage.

**Action — GREEN:** covered by T1/T2 + the existing `SqliteUnitOfWork`; the
test only asserts the guarantee.

**Action — REFACTOR:** none.

**Output:** the rollback leg of the epic's golden test (index item 3), proven
on real SQLite.

**Verify:** `node --test src/storage/sqlite/cas-rollback.integration.test.ts`
green; typecheck 0; lint clean.
