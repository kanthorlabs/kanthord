# Story 002 - Frontmatter & Markdown Section Parsing

Epic: `.agent/plan/epics/001-foundations-seams-and-storage.md`

## Goal

Parse a plan file's two layers — the `---`-fenced YAML frontmatter (machine layer)
and the `## `-headed body sections (agent layer) — into typed values, and
serialize a frontmatter object back so kanthord can write the `compile:` block at
sign-off round-trip stable.

## Acceptance Criteria

- Parsing a file with leading `---\n<yaml>\n---\n<body>` returns the frontmatter as
  a typed object and the raw body string.
- Parsed frontmatter preserves nested maps, arrays of maps, and inline objects —
  e.g. `source_of_truth: { system: jira, ref: ELSA-1234 }` and a `depends_on` list
  of `{ task, output, semantics }` objects (PRD §7.1.1 §5 task frontmatter).
- Body section extraction returns each `## Heading` section keyed by its heading
  text with the section's content, so a shape lint can assert presence + non-empty.
- A file with no frontmatter fence, or an unterminated fence, is a typed parse
  error naming the offending file — not a silent empty object.
- `serializeFrontmatter(obj)` emits a `---`-fenced block that `parse` reads back to
  an equal object (generic round-trip stable) for the task-file frontmatter shape,
  including an arbitrary nested object field (a `compile: { shape, hash, at }`
  block is used only as a sample nested shape — this Story does not decide *when* or
  *what* kanthord writes at sign-off; Epic 002 owns that).

## Constraints

- Frontmatter is YAML; parse it with the `yaml` runtime dependency, not a
  hand-rolled parser (PRD §7.1.1 §2 format rules; Principle 6 — use the ecosystem's
  hardened lib for a fragile task). The `yaml` dependency is provisioned by the
  human (Epic 001 Dependencies) because the lane forbids editing `package.json`.
- No prose parsing of the body beyond splitting on `## ` headings — the body is the
  agent layer; only section presence/content is machine-read (PRD §7.1.1 §2).
- Parser must not mutate or reflow the body content (byte-preserving passthrough)
  so `compile_hash` over the file set is stable (PRD §7.1.1 §7).

## Verification Gate

- `npm test` green for `src/foundations/plan-file.test.ts`.
- Round-trip test proves `parse(serialize(parse(x))) == parse(x)` for a sample task
  file frontmatter.

### Task T1 - Split frontmatter fence from body

**Input:** `src/foundations/plan-file.ts`, `src/foundations/plan-file.test.ts`

**Action - RED:** Write a test asserting a `---`-fenced document splits into a
frontmatter block and the exact remaining body string; and that a missing or
unterminated fence throws a typed error whose message names the file path.

**Action - GREEN:** Implement `parsePlanFile(path, text)` that locates the leading
`---` fence pair, hands the inner block to the yaml parser, and returns
`{ frontmatter, body }`; throw a typed `PlanFileParseError` on a malformed fence.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for the fence-split cases; `npm run typecheck` exits 0.

### Task T2 - Typed frontmatter with nested shapes

**Input:** `src/foundations/plan-file.ts`, `src/foundations/plan-file.test.ts`

**Action - RED:** Write a test parsing the PRD §7.1.1 §5 task frontmatter sample
(`ticket`, `write_scope` array, `depends_on` list of objects, `outputs` list) and
asserting each nested value is read back with correct types.

**Action - GREEN:** Ensure the yaml parse yields the nested maps/arrays; add the
frontmatter type declarations the consumer needs.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for the nested-shape case; `npm run typecheck` exits 0.

### Task T3 - Body section extraction

**Input:** `src/foundations/plan-file.ts`, `src/foundations/plan-file.test.ts`

**Action - RED:** Write a test on a body with `## Prerequisites`, `## Inputs`,
`## Outputs`, `## Tests` sections asserting `sections()` returns each keyed by
heading with its content, and that an empty section is reported as empty (not
missing).

**Action - GREEN:** Add a section splitter that partitions the body on `## `
headings, keying content by heading text.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for the section cases; `npm run typecheck` exits 0.

### Task T4 - Frontmatter serialize round-trip

**Input:** `src/foundations/plan-file.ts`, `src/foundations/plan-file.test.ts`

**Action - RED:** Write a test that serializes a frontmatter object with a nested
object field (use a `compile: { shape, hash, at }` block as the sample nested
shape) and asserts re-parsing yields an equal object.

**Action - GREEN:** Implement `serializeFrontmatter(obj)` emitting a `---`-fenced
yaml block via the yaml library's stringify.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for the round-trip case; `npm run typecheck` exits 0.
