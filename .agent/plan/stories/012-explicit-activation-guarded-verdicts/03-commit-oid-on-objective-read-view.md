# Story 3 — `commitOid` on the objective read view

Epic: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`

## Change

### `src/app/objective/get-objective.ts`

- `:16-23` — `GetObjectiveOutput` gains two **optional** fields, immediately
  after `status: string;`:

  ```ts
    /** The squashed candidate commit a client must echo back on a verdict. */
    commitOid?: string;
    /** The parent the candidate was built on (the broker's CAS anchor). */
    parentOid?: string;
  ```

- `:59-69` — the returned object gains two conditional spreads, placed right
  after `status,`, mirroring the `workspace` convention at
  `src/app/initiative/get-initiative.ts:53-55`:

  ```ts
        ...(objective.commitOid !== undefined
          ? { commitOid: objective.commitOid }
          : {}),
        ...(objective.parentOid !== undefined
          ? { parentOid: objective.parentOid }
          : {}),
  ```

  Pinned rule: when the domain value is `undefined` the **key is absent** from
  the JSON — never `null`, never `""`. A `building` objective genuinely has no
  candidate yet; `commitOid`/`parentOid` are set when it reaches
  `awaiting_confirmation` (`src/app/objective/settle-objectives.ts:59-61`).

- The human (non-`--json`) rendering in `src/apps/cli/objective.ts:71-90` is
  **unchanged**.

## Constraints

- No storage change: `getObjective` already selects both columns
  (`src/storage/sqlite/sqlite-initiative-repository.ts:112`) and maps them only
  when non-NULL (`:131-132`).
- No change to `src/apps/cli/objective.ts:61-94` beyond nothing — the `--json`
  branch already stringifies the use-case output verbatim (`:68-70`).
- Do not surface `conflictReason` (it is not persisted).

## Verify

- `node --test src/app/objective/get-objective.test.ts`
  - an objective with `commitOid` and `parentOid` set → output carries both,
    equal to the domain values.
  - an objective with neither set → `"commitOid" in output === false` and
    `"parentOid" in output === false`.
- `node --test src/apps/cli/get-objective.test.ts`
  - `--json` stdout parses to an object whose `commitOid` equals the fake
    objective's value; with no candidate, the parsed object has no `commitOid`
    key.
  - regression: the non-`--json` line list is byte-identical to today's.
- `node --test src/apps/cli/commands/read.test.ts` — `get objective --json` shape
  test updated.
- `node --test src/composition.test.ts` — the full-stack
  `["get","objective","--id",…,"--json"]` test at `:587` stays green.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/activation-verdict-proof.sh:89-90` —
  `GOOD=$(… get objective --id "$OBJ" --json | jv 'v.commitOid')` and
  `test -n "$GOOD"`. Without this story Story 4's guard is unusable from any
  client, and Story 5's scripts have nothing to echo back.
