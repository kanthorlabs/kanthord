# Story S9 — wiring audit, retirement roadmap, Proof green

Epic: `.agent/plan/epics/021-http-planning-writes.md`
Depends on: Stories S1–S8 (all 28 rows landed, `ROUTES.length === 52`).

No row lands in this story. It closes the epic: the id inventory, the CLI
coverage record, the retirement roadmap, and the Proof printing `021 ok: …`.

## Change

### 1. `src/apps/http/routes.test.ts:251-280` — the full id inventory

Extend the `expected` array with all 28 new ids, in the EPIC's route-table order,
and rename the test to
`"every route id from the EPIC 020 and 021 route tables is present in ROUTES"`:

```ts
      "project.create",
      "project.patch",
      "project.initiative.create",
      "initiative.patch",
      "initiative.objective.create",
      "objective.patch",
      "objective.task.create",
      "project.repository.create",
      "project.credential.create",
      "project.notification.create",
      "project.filesystem.create",
      "repository.patch",
      "credential.patch",
      "notification.patch",
      "filesystem.patch",
      "project.resource.create",
      "task.dependency.create",
      "task.dependency.delete",
      "initiative.dependency.create",
      "initiative.dependency.delete",
      "objective.dependency.create",
      "objective.dependency.delete",
      "project.graph.create",
      "initiative.graph.apply",
      "initiative.package.get",
      "initiative.diagnostic.export",
      "graph.readiness.check",
      "project.readiness.get",
```

### 2. `src/apps/http/cli-coverage.test.ts` — the 27 claimed leaves as one test

Stories S4–S8 each appended their leaves to `expectedCovered`. Consolidate the
021 leaves into their own test so the record is greppable, leaving the 020 test
untouched:

```ts
test("the 27 CLI leaves claimed by EPIC 021 all appear across ROUTES' cliCommands", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const expectedCovered = [
    "create project",
    "create initiative",
    "create objective",
    "create task",
    "create credential",
    "create filesystem",
    "create notification",
    "create repository",
    "rename project",
    "rename initiative",
    "rename objective",
    "add dependency",
    "add initiative-dependency",
    "add objective-dependency",
    "remove dependency",
    "remove initiative-dependency",
    "remove objective-dependency",
    "update credential",
    "update filesystem",
    "update notification",
    "update repository",
    "import resource",
    "import graph",
    "export initiative",
    "export diagnostic",
    "check graph",
    "check project",
  ];
  assert.equal(expectedCovered.length, 27);
  for (const cliCommand of expectedCovered) {
    assert.ok(
      covered.has(cliCommand),
      `expected "${cliCommand}" to be covered by ROUTES' cliCommands`,
    );
  }
});
```

Also add the shrink assertion the EPIC's Verification Gate names:

```ts
test("the uncovered set shrank by the 27 leaves EPIC 021 claims", () => {
  const covered = new Set(ROUTES.flatMap((route) => route.cliCommands));
  const uncovered = leaves.filter(
    (leaf) => !covered.has(leaf) && leaf !== "serve" && leaf !== "commands",
  );
  // 78 retirable leaves, 25 claimed by 020, 27 claimed by 021.
  assert.equal(uncovered.length, 26);
});
```

The existing "uncovered set is non-empty" test stays and still passes.

### 3. `src/apps/http/deps.ts` + `src/apps/cli/commands/serve.ts` — the wiring audit

`HttpDeps` must now hold 46 fields: the 20 from 019/020 plus the 26 this epic
added (7 + 6 + 6 + 4 + 3). Read both files and confirm every `HttpDeps` field is
populated in the `httpDeps` literal, in the same order the interface declares
them. Fix any drift here rather than in an earlier story.

### 4. `scripts/e2e/http-writes-proof.sh` — two corrections

The script is already written and already failing for the right reason; it is in
the software-engineer's lane (only `scripts/lane-check.sh`,
`scripts/verify-handoff.mjs` and `scripts/memory-append-only.sh` are locked).
Two lines are wrong about the CODE, not about the capability:

- the phase-H assertion
  `eq "diagnostic carries records" "true" "$(jv "$DIAG" 'Array.isArray(v.records)&&typeof v.schemaVersion==="number"')"`
  demands a numeric `schemaVersion`, but the document's value is the string
  `"007.1"` (`src/domain/safe-facts.ts:602`). Change `"number"` to `"string"`.
  **Do not change the document to satisfy the old assertion.**
- the phase-E comment `# The other five item PATCHes.` precedes six
  `patch_item` calls. Change `five` to `six`.

Nothing else in the script changes: every other assertion must pass against the
implementation, not the other way round. If any other line fails, the
implementation is wrong.

### 5. HUMAN HAND-OFF — the locked plan-tree edits

`scripts/lane-check.sh` exits `1` for anything under `.agent/plan/**`, for every
role. **Do not attempt these writes.** Name them in the turn and let the human
apply them. Two files:

**(a) `.agent/plan/epics/021-http-planning-writes.md`** — the three EPIC
amendments `index.md` records: phase H's `schemaVersion` type, decision 5/7's
`type` probe on the four resource PATCH rows, and `invalid_package` → `400` in the
error registry plus decision 6's server-side package validation. The stories are
already written to the resolved reading, so `/work` is not blocked on this — but
the EPIC and the stories disagree until the human applies it.

**(b) `.agent/plan/stories/019-http-server/retirement.md`** — mark Target 021
covered

Under `### Target 021 — planning writes`, append, mirroring how Target 020 was
closed:

```
Implemented: `.agent/plan/epics/021-http-planning-writes.md` (28 rows covering
these 27 leaves), proved by `scripts/e2e/http-writes-proof.sh`. Nothing is
removed: 021 claims the leaves, it does not retire them.

Two capabilities stay CLI-only and are NOT claimed by any 021 row:

- `check project --probe-repositories` / `--probe-provider`. The route
  `GET /api/project/:id/readiness` binds both flags `false`: a probe makes a real
  billable model call or runs `git ls-remote`, and hanging outbound I/O off a GET
  would break the read/write split. Probing belongs with Target 024, which
  already owns `POST /api/ai-provider/:id/probe`.
- `import graph`'s interactive form and its markdown-package parsing, manifest
  rewriting and `--bind alias=name` resolution. Over HTTP the body is an
  already-parsed package and `bindings` is an alias → resource **id** map.

Conventions 022 and later inherit from 021: `POST` on a collection answers `201`
with a `Location` that is a real, readable route; `PATCH` on an item REQUIRES
`If-Match` (`428` without, `412` when stale) and answers `200` with the item DTO
and a fresh `ETag`; every `200` json response carries an `ETag`; a toggle with no
representation of its own is a sub-resource answering `204`.
```

## Constraints

- `leaves.length === 80` stays true: 021 adds and removes no CLI leaf. Do not
  touch `src/apps/cli/architecture.test.ts:40`.
- No CLI leaf is deleted in this epic. `retirement.md` is a planning document,
  not an assertion.
- Both plan-tree files in section 5 are lane-forbidden (verified: `lane-check.sh`
  exits `1`). The story is complete without them; the human applies them.
- Do not weaken any assertion in `http-writes-proof.sh` beyond the two
  corrections above, and do not touch `http-serve-proof.sh` or
  `http-reads-proof.sh`.

## Verify

- `node --test src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Boundary lint (part of `npm run verify`): no file under `src/apps/http/`
  imports from `src/domain/` or `src/apps/cli/` — including
  `views/graph-package.ts`, `views/graph-apply.ts`, `views/readiness.ts` and
  `views/diagnostic.ts`. Confirm with
  `grep -rnE 'from "\.\.(/\.\.)*/(domain|apps/cli)/' src/apps/http --include='*.ts' | grep -v '\.test\.ts'`
  printing nothing.
- The three sibling proofs, all green:
  - `scripts/e2e/http-serve-proof.sh` prints `019 ok: …`
  - `scripts/e2e/http-reads-proof.sh` prints `020 ok: …`
  - `scripts/e2e/http-writes-proof.sh` prints `021 ok: …`
- Proof (the epic's): `scripts/e2e/http-writes-proof.sh` — all phases A–J, ending
  with the line beginning `021 ok: planning writes on 127.0.0.1:`. Paste the real
  output.
