# Story 001 - Versioned File Store And Search

Epic: `.agent/plan/epics/002-file-db-and-search.md`

## Goal
Core can persist versioned markdown/json/jsonl store files safely, serialize
same-key writers, append jsonl safely, and query records through a deterministic
full-scan search seam.

## Acceptance Criteria
- Human-facing records default to markdown with YAML front matter carrying `version` plus body.
- Append-only event/audit/state streams use jsonl.
- Pure machine state where markdown adds nothing uses json.
- Every store file carries `version`, starting at `version: 1`.
- Markdown/json carry `version` as a top-level field.
- jsonl carries `version` as a file-level header record on the first line; appended data records do not repeat it.
- A write that would produce a versionless file fails.
- A process or container kill mid-write leaves readers seeing either the old complete file or the new complete file, never a partial file.
- A jsonl append writes one complete line; a torn final line is detected and skipped on read without corrupting earlier lines.
- Concurrent writers to the same key are serialized across same-process concurrency, subprocess, and restarted daemon cases.
- After a crashed lock holder is reclaimed, two writers never proceed at once.
- Search returns records matching a predicate with stable key/identity and deterministic order.
- Search v1 has no pagination and returns all matches.
- Missing store search returns an empty result, not an error.

## Constraints
- No SQL, SQLite, ORM, or external search engine (D1, N2).
- Atomic replace means write-temp-then-`rename()` in the same directory/filesystem as the target (N1).
- jsonl append means one `O_APPEND` write of a complete line.
- Every read-modify-write takes a file-based lock and releases it in `finally` (N1, D5).
- The lock primitive is file-based and has no native dependency (D2).
- v1 search implementation is full-scan only (N2).
- OS-crash / power-loss fsync durability is out of scope for v1.

## Verification Gate
- `npm run typecheck`
- `npm test`
- The primitive tests also pass inside the container against the Podman `.data/` mount.

### Task 002-SPIKE - Filesystem atomicity and lock findings

**Input:** `.agent/plan/findings/02-filedb-atomicity.md`, spike scratch files under `.agent/tdd/`.

**Action - RED:** none - spike.

**Action - GREEN:** Confirm on macOS-native and inside Podman `.data/` mount: atomic rename replace, torn write behavior, `O_APPEND` line writes under concurrency, lock mutual exclusion, and lock reclaim after kill without split-brain. Record findings.

**Action - REFACTOR:** none.

**Verify:** Findings file exists with the confirmed semantics and v1 crash model.

### Task 002-RED - Store primitive tests

**Input:** `packages/core/src/**/*.test.ts` or the storage package test home chosen by Epic 001 layout.

**Action - RED:** Add `node:test` coverage for version round-trip for markdown/json/jsonl-header, versionless write failure, atomic replace, jsonl append with torn-line skip, lock mutual exclusion/reclaim, and full-scan search key/order/empty-store behavior.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because storage primitives are missing.

### Task 002-GREEN - File store and search implementation

**Input:** `packages/core/src/**` or the storage package source home chosen by Epic 001 layout.

**Action - RED:** none - opened by Task `002-RED`.

**Action - GREEN:** Implement the file-store primitives and full-scan search seam so the Story ACs pass.

**Action - REFACTOR:** Keep format-specific code localized and remove any duplicated test-only write paths.

**Verify:** `npm run typecheck && npm test` exits 0, plus the same primitive tests pass in the container.
