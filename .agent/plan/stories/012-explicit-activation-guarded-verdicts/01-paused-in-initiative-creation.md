# Story 1 — `paused` becomes part of initiative creation

Epic: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`

## Change

### Domain — `src/domain/initiative.ts`

- `:18-25` — add a **required** field to `Initiative`, after `name` and before
  `status?`:

  ```ts
  /** Explicit-activation gate; orthogonal to `status`. The column is NOT NULL
   * DEFAULT 0, so every persisted row has a value. */
  paused: boolean;
  ```

- `:40-42` — replace the positional factory

  ```ts
  export function newInitiative(projectId: string, name: string): Initiative {
    return { id: newId(), projectId, name, status: "building" };
  }
  ```

  with the options-object form the epic's Verification Gate names
  (`newInitiative({paused:true})`), with `paused` **required**:

  ```ts
  export function newInitiative(input: {
    projectId: string;
    name: string;
    paused: boolean;
  }): Initiative {
    return {
      id: newId(),
      projectId: input.projectId,
      name: input.name,
      paused: input.paused,
      status: "building",
    };
  }
  ```

- `newObjective` (`:44-46`), `LEGAL_INITIATIVE_TRANSITIONS` (`:58-61`) and
  `transitionInitiative` (`:103-113`) are **unchanged**. `transitionInitiative`
  already spreads `...initiative`, so `paused` carries through untouched.

### Use case — `src/app/initiative/create-initiative.ts`

- `:35-39` — add `paused: boolean;` (required, not `boolean | undefined`) to the
  inline input type, after `after?: string[]`.
- `:54` — `const initiative = newInitiative(input.projectId, input.name);`
  becomes
  `const initiative = newInitiative({ projectId: input.projectId, name: input.name, paused: input.paused });`
- The two save paths are **unchanged**: the sequencing branch's
  `this.#tx.run(() => { this.#repo.save(initiative); … })` (`:102-107`) and the
  plain `this.#repo.save(initiative)` (`:109`). The object already carries
  `paused`, so creation is one write on both paths. Do **not** add a `setPaused`
  call anywhere.

### Use case — `src/app/graph/create-graph.ts`

- `:41-46` — add `paused: boolean;` (required) to `CreateGraphInput`, after
  `packageId: string;`.
- `:149-153` — the inline initiative literal gains `paused: input.paused,`:

  ```ts
  const initiative: Initiative = {
    id: initiativeId,
    projectId: input.projectId,
    name: input.pkg.initiative.name,
    paused: input.paused,
  };
  ```

- `CreateGraph` must **not** call `CreateInitiative` and must **not** call
  `newInitiative`; the literal stays a literal. The write stays inside the
  existing `uow.transaction` opened at `:146`.

### Persistence — `src/storage/sqlite/sqlite-initiative-repository.ts`

- `save()` `:39-49` — add `paused` to the INSERT column list and bind
  `initiative.paused ? 1 : 0` in the new 4th position. The
  `ON CONFLICT DO UPDATE SET` list stays exactly as it is — `paused` is
  **excluded** from it:

  ```sql
  INSERT INTO initiatives (id, projectId, name, paused, sha256, status)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, sha256 = excluded.sha256, status = excluded.status
  ```

  Rule this pins: after creation, `setPaused` (`:200-204`) is the **only** writer
  of `paused`, so re-saving a stale in-memory snapshot can never resurrect or
  clear it.

- `get()` `:53-71` — add `paused` to the SELECT column list, add
  `paused: number;` to the row type, and set `paused: row.paused === 1` in the
  mapped `Initiative` literal.
- `listInitiatives()` `:162-186` — same three edits (SELECT, row type, mapper).
- `setPaused` `:200-204` and `listAllInitiatives` `:212-218` are **unchanged**.
- `src/storage/port.ts:70-101` (`InitiativeRepository`) needs **no** change.

### Callers that must gain the field (compile-breaking, exhaustive)

Production: only `create-initiative.ts:54` and `create-graph.ts:149-153` above.

Tests (the test engineer updates these as part of this story):

- `src/domain/initiative.test.ts` — `newInitiative` call sites `:17`, `:31`,
  `:32`, `:43`, `:82`, `:88`, `:96`, `:125`, `:131`.
- `src/app/graph/graph-roundtrip.integration.test.ts:37`, `:124`.
- `Initiative` object literals: `src/storage/sqlite/sqlite-initiative-repository.test.ts:43-48`,
  `src/app/initiative/pause-initiative.test.ts:28`.
- `CreateInitiative.execute` call sites in
  `src/app/initiative/create-initiative.test.ts` (suites at `:105` and `:232`).
- `CreateGraph.execute` call sites in `src/app/graph/create-graph.test.ts`.

## Constraints

- **No new migration.** The `paused` column already exists — added by migration
  4 (`src/storage/sqlite/migrations.ts:148`) and carried through the table
  rebuilds at `:452,457-458` (migration 17) and `:546,551-552` (migration 19).
  Do not append to `MIGRATIONS`; the last entry stays `version: 26`
  (`migrations.ts:763-796`). The column-order assertion
  `["id","projectId","name","paused","sha256","status","workspace"]` at
  `src/storage/sqlite/migrations.test.ts:120-128` must stay unchanged.
- `INITIATIVE_STATUSES` stays `building|landed|discarded`
  (`src/domain/initiative.ts:4`). No transition function reads or writes
  `paused`.
- `paused` is required on `Initiative` and on both use-case inputs. Do not weaken
  it to `paused?: boolean` — the optional form is what allows a two-write window.
- Do not change `enqueue-ready-tasks.ts` (`:57-60` already skips paused
  initiatives) or `src/queue/sqlite.ts:32` (already filters `i.paused = 0`).
- Do not add a CLI flag in this story (Story 2 owns the CLI).

## Verify

- `node --test src/domain/initiative.test.ts`
  - `newInitiative({projectId, name, paused: true}).paused === true` and
    `.status === "building"`.
  - `newInitiative({… paused: false}).paused === false`.
  - `transitionInitiative(newInitiative({… paused:true}), "landed")` returns
    `status === "landed"` **and** `paused === true` (paused survives a
    transition; the transition never reads it).
- `node --test src/app/initiative/create-initiative.test.ts`
  - `execute({projectId, name, paused: true})` → the fake repo's single saved
    initiative has `paused === true`, and the fake's `setPaused` was called
    **zero** times (the "no second write" gate). Extend
    `FakeInitiativeRepository` (`:20-70`) to count `setPaused` calls.
  - `execute({… paused: false})` → saved `paused === false`.
  - the `--after` sequencing branch (suite at `:232`) with `paused: true` →
    saved `paused === true`, `setPaused` still zero calls.
- `node --test src/app/graph/create-graph.test.ts`
  - `execute({…, paused: true})` → `repo.saved[0].paused === true`;
    `paused: false` → `false`.
- `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
  - `save({… paused: true})` then a direct
    `SELECT paused FROM initiatives WHERE id = ?` returns `1` — one write, no
    `setPaused`.
  - `get(id)` and `listInitiatives(projectId)` return `paused: true` / `false` as
    booleans; the round-trip `assert.deepEqual(loaded, initiative)` test at
    `:31-52` passes with `paused` in the literal.
  - regression on the conflict-update exclusion: `save({… paused:false})`,
    `setPaused(id, true)`, then `save()` the same `paused:false` snapshot again →
    `SELECT paused` still returns `1`.
- `node --test src/storage/sqlite/migrations.test.ts` — green, unchanged.
- `node --test src/app/task/enqueue-ready-tasks.test.ts` — green, unchanged
  (paused-skip test at `:232`).
- `npm run verify` exits 0.
- Proof: no `PASS` line alone; this story is the precondition for `A ok:` and
  `B ok:` in `scripts/e2e/activation-verdict-proof.sh`.
