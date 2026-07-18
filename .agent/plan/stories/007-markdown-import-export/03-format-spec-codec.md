# Story 03 — Format spec + CommonMark codec → `GraphPackage` DTO

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

A committed format spec + a CommonMark-AST codec (parse + serialize) living in
the CLI adapter (B8) that turns a directory of markdown files into a
transport-neutral `GraphPackage` DTO and back. Frontmatter is authoritative for
identity + parentage; the on-disk layout is cosmetic (B18). Refs are typed and
case-disjoint from ULIDs (B6). The use case NEVER imports the codec — it takes
and returns `GraphPackage`. This story ships the golden codec tests (byte-stable
round-trip + non-canonical → correct semantic graph, B9/B16).

## Locked contracts (exact names — tests assert verbatim)

### DTO — `src/app/graph/graph-package.ts` (transport-neutral, zero I/O)

```ts
export interface PkgTask {
  id?: string; // present iff frontmatter carries a ULID (exported / post-handoff)
  ref: string; // package-local id: a lowercase slug (created) OR the ULID (exported — the ULID is the ref)
  objectiveRef: string; // frontmatter `objective:` — a ULID (exported) or a slug (created)
  title: string;
  instructions: string;
  ac: string[];
  agent: string; // codec defaults absent → "generic@1"
  verification: string[] | null | undefined; // undefined = no `# Verification`; null/[] = empty section
  dependsOn: string[]; // ULIDs or refs
  sourcePath: string; // B7 provenance, relative to package root
}
export interface PkgObjective {
  id?: string;
  ref: string;
  initiativeRef: string;
  name: string;
  sourcePath: string;
}
export interface PkgInitiative {
  id?: string;
  ref: string;
  name: string;
  sourcePath: string;
}
export interface ExportManifest {
  initiativeId: string;
  packageId: string;
  formatVersion: number;
  digestAlgorithm: "sha256";
  nodes: Record<string, string>; // id → sha256 — FULL snapshot: initiative+objectives+tasks (TS1)
  files: string[]; // ids written as files — delete-eligibility set (TB1), SEPARATE from nodes
  refToId: {
    // kind-scoped (B6) — namespaces never collide
    objectives: Record<string, string>;
    tasks: Record<string, string>;
  };
}
export interface GraphPackage {
  packageId: string; // ULID minted at --create; read from manifest on --apply
  formatVersion: number;
  initiative: PkgInitiative;
  objectives: PkgObjective[];
  tasks: PkgTask[];
  manifest?: ExportManifest; // present when the package was exported (.kanthord-export.json)
}
```

### Codec — `src/apps/cli/graph-md/` (adapter-only, imports a markdown/AST lib)

```ts
// parse.ts
export function parseGraphPackage(rootDir: string): Promise<GraphPackage>;
// serialize.ts
export function serializeNode(
  node: PkgTask | PkgObjective | PkgInitiative,
): string; // canonical bytes
export function writePackage(rootDir: string, pkg: GraphPackage): Promise<void>; // Story 04 uses this
// refs.ts
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // case-SENSITIVE uppercase Crockford
export const REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/; // lowercase only — disjoint from ULID by case
export type RefKind = "ulid" | "ref";
export function classifyRef(value: string): RefKind; // throws MalformedReferenceError if neither
```

### Format (committed spec doc — `docs/formats/graph-md.md`, new)

- **Frontmatter (fixed key order):** `kind` (`initiative`|`objective`|`task`),
  then EITHER `id: <ULID>` (exported — the ULID is the ref) OR `ref: <slug>`
  (hand-authored `--create`; a post-handoff created file carries both), parent
  ref (`initiative:` on an objective, `objective:` on a task — a ULID for
  exports, a slug for authored), `name`/`title`, `agent` (task, absent →
  `generic@1`), `depends-on: [ULID|slug…]` (task). Effective ref = `ref` if
  present else `id` (Ulrich ruling 2026-07-18: export = ULID-as-ref, create =
  slug-ref).
- **Body sections (task only):** `# Instructions` (multi-line prose),
  `# Acceptance Criteria` (`- [ ] <single line>` items), `# Verification` (ONE
  ` ```sh ` fence, one command per line; adaptive fence length; empty
  fence = explicit clear; **absent section = unset**, B11/B12).
- **Layout is cosmetic (B18):** file/dir names + locations are IGNORED on
  import; identity = frontmatter `id`, parentage = frontmatter parent ref.
- **Canonical bytes (B9):** fixed frontmatter key order, LF line endings,
  `- [ ] ` checklist prefix, single trailing newline. `dependsOn` serializes
  as a sorted set; `ac`/`verification` as ordered lists.

## Constraints

- Codec lives ONLY in `src/apps/cli/graph-md/`; nothing under `src/app/` or
  `src/domain/` imports it (eslint boundaries). The DTO in `src/app/graph/`
  imports nothing with I/O.
- Prefer a hardened CommonMark/AST + YAML-frontmatter lib over hand-rolled body
  parsing (B3, AGENTS.md Principle 6) — pin the choice in T1 and justify.
- Refs are decided by SHAPE alone, no DB lookup (case disjointness, B6).

## Verification Gate

- `node --test src/apps/cli/graph-md/*.test.ts` green; typecheck 0; lint clean
  (boundaries prove the use-case layer cannot import the codec).

### Task T1 — spec doc + ref grammar + frontmatter parse

**Requires:** Story 01 (single-line rule informs ac/verification validation
messaging); DTO file.

**Input:** new `docs/formats/graph-md.md`, `src/app/graph/graph-package.ts`,
`src/apps/cli/graph-md/refs.ts` + test, `parse.ts` (frontmatter only) + test.

**Action — RED:** tests: (a) `classifyRef` returns `"ulid"` for a 26-char
uppercase Crockford string, `"ref"` for a lowercase slug, and throws
`MalformedReferenceError` for a mixed-case / wrong-length value (a lowercase
26-char Crockford string classifies as `"ref"`, never `"ulid"` — case
disjointness); (b) parsing an EXPORTED task file (only `id: <ULID>`, no `ref:`) yields a
`PkgTask` whose `id` is the ULID and whose effective `ref` equals that ULID;
parsing an AUTHORED file (only `ref: <slug>`, no `id:`) yields `id` undefined
and `ref` = the slug; `objectiveRef` carried verbatim; `agent` defaults to
`generic@1` when absent. Fails today: modules absent.

**Action — GREEN:** commit the spec doc; implement `refs.ts` + frontmatter
parsing into the DTO.

**Action — REFACTOR:** none.

**Output:** typed refs + frontmatter → partial DTO.

**Verify:** `node --test src/apps/cli/graph-md/refs.test.ts` green.

### Task T2 — body sections parse (instructions / ac / verification)

**Requires:** T1.

**Input:** `src/apps/cli/graph-md/parse.ts` + test; a small fixtures dir.

**Action — RED:** tests: (a) `# Instructions` prose captured multi-line; (b)
`- [ ]` items → `ac: string[]`, one per item; (c) a ` ```sh ` fence →
`verification: string[]` one command per line; (d) NO `# Verification` section
→ `verification: undefined`; an EMPTY fence → `verification: []` (clear); (e)
an ac item spanning two lines is a parse error citing `sourcePath` (single-line
rule, Story 01). Fails today: body parsing absent.

**Action — GREEN:** parse the three sections off the CommonMark AST.

**Action — REFACTOR:** none.

**Output:** full `PkgTask` from a task file; `undefined`-vs-`[]` verification
distinction preserved.

**Verify:** `node --test src/apps/cli/graph-md/parse.test.ts` green.

### Task T3 — directory walk → whole `GraphPackage` + manifest read

**Requires:** T1, T2.

**Input:** `parse.ts` (`parseGraphPackage`) + test; a multi-file fixture
(initiative + 2 objectives + tasks in nested dirs).

**Action — RED:** tests: (a) `parseGraphPackage(dir)` returns one initiative,
the objectives, and tasks with correct parent refs REGARDLESS of directory
nesting (move a task file to a different dir → same parentage, B18); (b) a
present `.kanthord-export.json` populates `pkg.manifest` + `pkg.packageId`;
(c) absent manifest → `manifest` undefined and `packageId` unset (create mode
mints one later). Fails today: walk absent.

**Action — GREEN:** implement the recursive walk + manifest read.

**Action — REFACTOR:** none.

**Output:** a full `GraphPackage` from any package directory.

**Verify:** `node --test src/apps/cli/graph-md/parse.test.ts` green.

### Task T4 — serialize + GOLDEN round-trip (B9/B16)

**Requires:** T1–T3.

**Input:** `src/apps/cli/graph-md/serialize.ts` + test.

**Action — RED:** tests: (1) **codec idempotence** — for a canonical package
`x` (exporter output shape), `serializeNode(parse(x))` byte-equals `x` for
every node (fixed key order, LF, `- [ ] `, trailing newline); (2) **semantic**
— a hand-authored NON-canonical file (reordered frontmatter keys, `* ` bullets,
extra blank lines) parses to the CORRECT `GraphPackage` (deep-equal on the DTO,
NOT byte-equal), and re-serializing yields the canonical form. `.kanthord-
export.json` + a generated `INDEX.md` are EXCLUDED from the byte assertion
(B16). Fails today: serializer absent.

**Action — GREEN:** implement `serializeNode` + `writePackage` (temp file +
atomic rename per node, S3).

**Action — REFACTOR:** share the frontmatter key-order table between parse +
serialize so the two can never drift.

**Output:** byte-stable codec proven both directions.

**Verify:** `node --test src/apps/cli/graph-md/serialize.test.ts` green;
typecheck 0; lint clean (use-case layer cannot import `graph-md/`).
