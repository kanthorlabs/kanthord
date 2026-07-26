# Story 5b — `after:` on the `--create` path (resolve, store, id handoff, export)

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: Story 1 (`validateDag`), Story 2 (`SequencingRepository`, `after` in the canonical form), Story 5a (`PkgInitiative.after` / `PkgObjective.after`)

Scope fence: `create-graph.ts`, `import-graph.ts` (create branch only) and
`export-initiative.ts`. Do **not** touch `apply-graph.ts` — that is Story 5c.

## Change

### 5b.1 Resolve + store — `src/app/graph/create-graph.ts`

`CreateGraph`'s deps gain `sequencing: SequencingRepository` (Story 2 already added
the member for the digest).

**Initiative `after` resolution.** A package holds exactly one initiative, so a
package-local initiative ref can never resolve. Every entry of
`pkg.initiative.after` must therefore be a **ULID naming an existing initiative in
`input.projectId`**:

- not matching `ULID_RE` → `UnknownNodeError(pkg.initiative.sourcePath, ref)`.
- `initiatives.get(ref)` undefined → `UnknownNodeError(pkg.initiative.sourcePath, ref)`.
- `initiatives.get(ref)!.projectId !== input.projectId` → `CrossInitiativeError`
  (reuse `src/app/graph/import-errors.ts:13-35`).

**Objective `after` resolution.** Resolve each entry in this order:

1. `objRefToId.get(ref)` — a package-local objective ref (the common case).
2. else, if it matches `ULID_RE` and `initiatives.getObjective(ref)` exists **and**
   its `initiativeId` equals the newly minted initiative id → use it as-is.
3. else → `UnknownNodeError(obj.sourcePath, ref)`.

Case 2 can only match an objective of the _new_ initiative, which cannot exist yet,
so in practice objective `after` entries are always package-local; keep the check so
a stray ULID errors instead of being written blind.

**Validation before the transaction**, beside the existing task `validateGraph`
call (`create-graph.ts:104-109`):

```ts
validateDag(pkg.objectives.map((o) => ({ id: o.ref, dependencies: o.after })));
```

(refs are the node ids here, exactly as the task check does.)

**Write**, inside the existing `uow.transaction` (`create-graph.ts:112-133`), after
the initiative and all objectives are saved:

```ts
this.#deps.sequencing.setInitiativeAfter(initiativeId, resolvedInitAfter);
for (const obj of pkg.objectives) {
  this.#deps.sequencing.setObjectiveAfter(
    objRefToId.get(obj.ref)!,
    resolvedObjAfter.get(obj.ref)!,
  );
}
```

`setInitiativeAfter` / `setObjectiveAfter` dedupe + sort internally (Story 2) and
re-stamp the owner sha — so the digest block (`create-graph.ts:194-232`) must run
**after** these writes, and must pass the resolved set instead of the `[]` that
Story 2 left there:

- initiative sha: `canonicalInitiative({ name, projectId, after: resolvedInitAfter })`
- objective sha: `canonicalObjective({ name, initiativeId, after: resolvedObjAfter.get(obj.ref)! })`

Both must equal what `SqliteSequencingRepository` stamped, so the manifest baseline
matches the live sha — otherwise the very next `--apply` reads `drifted` on an
untouched package.

### 5b.2 Create-mode id handoff — `src/apps/cli/import-graph.ts`

`--create` rewrites every source file with its assigned ULID. The objective rewrite
(`import-graph.ts:421-434`) currently passes `{ ...obj, id, initiativeRef }` and
does **not** touch `after`, while the task rewrite (`:437-453`) already resolves
`dependencies` slug→ULID via `taskRefToId[ref] ?? ref`. Add the same resolution:

```ts
const updatedObjective: PkgObjective = {
  ...obj,
  id: assignedId,
  initiativeRef: initiativeId,
  after: [...obj.after.map((ref) => objectiveRefToId[ref] ?? ref)].sort(),
};
```

The initiative rewrite (`:411-419`) keeps `after` as-is (its entries are already
ULIDs by 5b.1's rule) but must still emit it sorted.

**Without this the round trip is broken**, and it is the single most likely way this
epic ships silently wrong: the file keeps slugs (`after: [obj-1, obj-1b]`) while the
DB holds ULIDs, so the next `--apply` computes an intended sha from slugs,
mismatches the baseline, and reports drift on a package nobody edited. Verified on
the current tree: a `--create` import of a package carrying `after:` **drops the
line entirely**.

### 5b.3 Export — `src/app/graph/export-initiative.ts`

Populate `after` on the exported `PkgInitiative` / `PkgObjective` from
`sequencing.listInitiativeAfter(id)` / `listObjectiveAfter(id)` so an
export → edit → apply round trip is byte-stable. Add `sequencing` to its deps.

## Constraints

- Reuse `validateDag` (Story 1); do not write a second cycle detector.
- Objective `after` edges may not cross initiatives; initiative `after` edges may
  not cross projects.
- The digest write must happen **after** the edge write, or the manifest baseline
  and the live row sha disagree.
- Do not touch `apply-graph.ts`.

## Verify

`src/app/graph/create-graph.test.ts`:

1. A package whose objective `obj-2` declares `after: [obj-1]` →
   `setObjectiveAfter` is called for `obj-2`'s minted id with
   `[<obj-1's minted id>]`, and for `obj-1` with `[]`.
2. The manifest sha recorded for `obj-2` equals
   `sha256Hex(canonicalObjective({ name, initiativeId, after: [obj1Id] }))` —
   proving baseline and live sha agree after the write.
3. `after: [obj-1b, obj-1]` in the file yields the **sorted** resolved id array in
   the `setObjectiveAfter` call; assert the exact array.
4. Initiative `after: [<existing ULID in the same project>]` →
   `setInitiativeAfter` called with that ULID.
5. Initiative `after: [<ULID of an initiative in another project>]` →
   `CrossInitiativeError`, nothing created.
6. Initiative `after: [some-slug]` → `UnknownNodeError` naming `initiative.md`.
7. Objective `after: [no-such-ref]` → `UnknownNodeError` naming that objective's
   `sourcePath`.
8. Objectives `obj-1 after [obj-2]` and `obj-2 after [obj-1]` → `CycleError` before
   any write (assert the repository recorded zero saves).
9. A package with no `after:` anywhere calls `set*After` with `[]` and records the
   same shas as before this story (regression against existing expectations).

`src/apps/cli/import-graph.test.ts`:

10. Create-mode id handoff rewrites an objective's `after:` from slugs to sorted
    ULIDs (guards the `import-graph.ts:421-434` gap): import a package with
    `after: [obj-1, obj-1b]`, then re-read `objective-2.md` and assert both entries
    are ULIDs and sorted ascending.
11. The rewritten initiative file's `after:` is emitted sorted.
12. A package with no `after:` round-trips with no `after:` line added.

`src/app/graph/export-initiative.test.ts`:

13. An initiative with `after: [X]` and an objective with `after: [Y]` exports
    `initiative.md` / `objective.md` carrying those `after:` lines, and the written
    package re-parses to the same sets.
14. An initiative and objective with empty `after` export **no** `after:` line.

Commands:

- `node --test src/app/graph/create-graph.test.ts src/app/graph/export-initiative.test.ts src/apps/cli/import-graph.test.ts`
- `npm run verify` exits 0

Proof: delivers claim 7 (`get objective` shows an `after:` set that came from the
graph package) and the ULID handoff every later claim depends on.
