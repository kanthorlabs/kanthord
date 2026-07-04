# Story 004 - YAML Registry Loader

Epic: `.agent/plan/epics/001-foundations-seams-and-storage.md`

## Goal

Load a yaml registry file (verb registry, repo config, provider registry) into a
typed object, with malformed yaml surfaced as a typed error that names the file so
a misconfiguration is diagnosable.

## Acceptance Criteria

- Loading a well-formed registry yaml returns a typed object with its fields
  readable (e.g. a verb entry's `verb`, `tier`, `timeout`, `retry` — PRD §5).
- Loading a directory of registry files returns each parsed entry keyed by a
  caller-named identity field read from inside each entry (e.g. `verb` for the verb
  registry). The key field is a parameter of the load call, not guessed — the
  filename is not used as the key.
- Malformed yaml throws a typed error whose message names the offending file path.
- A registry file missing a required key surfaces as a typed validation error
  naming the file and the missing key — not a runtime `undefined` later.

## Constraints

- Parse with the `yaml` runtime dependency (PRD §7.1.1 §2 — registries are yaml;
  same lib as frontmatter, Story 002). Dependency provisioned by the human.
- Loader is generic mechanism only — it validates presence of declared required
  keys but embeds no verb/repo-specific business rules (those live in their owning
  Epics, per PRD §10 "engine ships generic").
- Filesystem access injected through the same seam as Story 003 so tests use temp
  dirs.

## Verification Gate

- `npm test` green for `src/foundations/registry.test.ts`, using a temp dir.

### Task T1 - Load one registry file with typed access

**Input:** `src/foundations/registry.ts`, `src/foundations/registry.test.ts`

**Action - RED:** Write a test that writes a verb-registry yaml (PRD §5 example:
`verb`, `tier`, `timeout`, `idempotency`, `retry`) to a temp file, loads it, and
asserts each field reads back with the right value and type.

**Action - GREEN:** Implement `loadRegistryFile(path, requiredKeys)` that yaml-parses
the file and returns the typed object; throw a typed error naming the file on parse
failure.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Load a registry directory keyed by id

**Input:** `src/foundations/registry.ts`, `src/foundations/registry.test.ts`

**Action - RED:** Write a test that writes two verb yaml files into a temp dir and
asserts `loadRegistryDir(dir)` returns both entries keyed by their `verb` field.

**Action - GREEN:** Implement `loadRegistryDir(dir, keyField, requiredKeys)`
iterating files, loading each, and keying by the declared field.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T3 - Missing required key is a typed, named error

**Input:** `src/foundations/registry.ts`, `src/foundations/registry.test.ts`

**Action - RED:** Write a test loading a registry file that omits a required key and
asserting a typed validation error names both the file and the missing key.

**Action - GREEN:** After parse, check the `requiredKeys` list and throw a typed
`RegistryValidationError` carrying file + missing-key on the first gap.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
