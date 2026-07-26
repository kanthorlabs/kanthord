# Story 5a — `after:` in the graph codec (types, parse, serialize)

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: nothing in this epic (pure codec; no repository, no digest)

Scope fence: this story touches **only** `graph-package.ts`, `graph-codec.ts` and
`format.ts`. It does not touch `create-graph.ts` (Story 5b) or `apply-graph.ts`
(Story 5c).

## Change

### 5a.1 Parsed types — `src/app/graph/graph-package.ts`

Add to `PkgInitiative` (`graph-package.ts:52-59` region) and `PkgObjective`
(`:26-35` region) — **required**, always present, possibly empty:

```ts
  /** Resolved `after:` prerequisite ids/refs, sorted ascending (canonicalised at parse time). */
  after: string[];
```

`serializeNode`'s structural discrimination (`graph-codec.ts:450-460`) keys off
`"objectiveRef" in node` then `"initiativeRef" in node`; adding `after` to both
initiative and objective does not disturb it. Leave that function's dispatch
alone.

Making the field **required** is deliberate: the type checker then enumerates every
construction site, including the ones Stories 5b and 5c must update.

### 5a.2 Parse — `src/app/graph/graph-codec.ts`

In `buildInitiative` (`graph-codec.ts:152-170`) and `buildObjective`
(`:172-192`), add the same block `buildTask` uses for `dependencies`
(`graph-codec.ts:212-219`), plus the canonicalising sort:

```ts
let after: string[] = [];
const rawAfter = fm["after"];
if (Array.isArray(rawAfter)) {
  after = rawAfter.filter((a): a is string => typeof a === "string");
}
for (const ref of after) {
  classifyRef(ref);
}
after = [...new Set(after)].sort();
```

- Both YAML forms work (flow `after: [a, b]` and block `- a`) because
  `parseYaml` already handles them.
- Non-string entries are dropped, matching `dependencies`.
- Every entry must satisfy ULID-or-slug grammar via `classifyRef`
  (`src/app/graph/refs.ts:33-37`), else `MalformedReferenceError`.
- **The sort is load-bearing**, not cosmetic. Story 2 stores the set with no
  `position` column and puts the sorted set in the digest; sorting at parse time
  makes `after: [b, a]` byte-different but digest-identical to `after: [a, b]`, so
  a reordering classifies `unchanged` instead of forcing a spurious `updated`.

### 5a.3 Serialize — `src/app/graph/graph-codec.ts` + `src/app/graph/format.ts`

`serializeInitiative` (`graph-codec.ts:362-377`): emit `after:` **after** `name:`
and **before** `bindings:`. `serializeObjective` (`:379-395`): emit `after:` after
`name:` and before `context:`. Both use the exact form `serializeTask` uses for
`dependencies` (`graph-codec.ts:407-410`) — a single-line YAML flow sequence,
sorted, and **omitted entirely when empty**:

```ts
const sortedAfter = [...node.after].sort();
if (sortedAfter.length > 0) {
  fmLines.push(`after: [${sortedAfter.map(yamlScalar).join(", ")}]`);
}
```

`src/app/graph/format.ts:16-24` — add `"after"` to both key-order constants:

```ts
export const INITIATIVE_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "name",
  "after",
] as const;
export const OBJECTIVE_KEY_ORDER = [
  "kind",
  "id",
  "ref",
  "initiative",
  "name",
  "after",
] as const;
```

## Constraints

- `after` is canonicalised (deduped + sorted ascending) at parse time **and** at
  serialize time — both, so neither direction can emit an unsorted set.
- Do not add `after` to `PkgTask`, `canonicalTask`, or
  `TASK_FRONTMATTER_KEY_ORDER`. Task-level sequencing is a Non-goal.
- Do not touch `create-graph.ts`, `apply-graph.ts`, `import-graph.ts` or
  `export-initiative.ts` here. Where the required `after` field breaks their
  typecheck, satisfy it with `after: []` and nothing more — Stories 5b/5c replace
  those placeholders.

## Verify

`src/app/graph/graph-codec.test.ts`:

1. `initiative.md` with `after: [01J…B, 01J…A]` parses to `after` deep-equal to
   the **ascending-sorted** pair — assert the exact array.
2. `objective.md` with block form (`after:` / `  - obj-1`) parses to `["obj-1"]`.
3. An `initiative.md` / `objective.md` with no `after:` key parses to `after: []`.
4. `after: ['  BAD VALUE  ']` throws `MalformedReferenceError` (mirroring
   `src/apps/cli/graph-md/parse.test.ts:612-643`).
5. Duplicate entries (`after: [a, a]`) parse to `["a"]`.
6. `serializeInitiative` on `after: ["b","a"]` emits the single line
   `after: [a, b]` positioned after `name:` and before `bindings:`; on
   `after: []` emits **no** `after:` line at all. Same for `serializeObjective`,
   positioned after `name:` and before `context:`.
7. Round trip: parse → serialize → parse yields an identical `after` for both node
   kinds, for both YAML input forms.
8. `serializeNode` still dispatches correctly with `after` present on both kinds:
   an initiative node serializes as an initiative, an objective as an objective.

`src/apps/cli/graph-md/serialize.test.ts`:

9. Golden bytes: add `CANONICAL_INIT_AFTER` / `CANONICAL_OBJ_AFTER` constants and
   assert exact byte equality, as the existing `CANONICAL_TASK_DEPS` test does
   (`serialize.test.ts:221-253`), including that a reversed input array produces
   the sorted output line.

Commands:

- `node --test src/app/graph/graph-codec.test.ts src/apps/cli/graph-md/`
- `npm run verify` exits 0

Proof: none directly. Foundation for Proof claims 7, 8, 9 and 11.
