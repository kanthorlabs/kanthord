# Story 003 - JSONL Append-Only Event Log

Epic: `.agent/plan/epics/001-foundations-seams-and-storage.md`

## Goal

An append-only jsonl seam for journals and event streams (compile/lint/gate/
escalation events, feature and task journals), where each record is one JSON
object on one line and reads return records in append order. Phase 1 assumes the
single daemon writer (PRD §6.1) and does **not** test concurrent-writer atomicity
— locking is out of scope here.

## Acceptance Criteria

- `append(record)` writes exactly one line: the JSON encoding of the record
  followed by a single `\n`.
- `readAll()` returns the records in the order they were appended.
- Appending N records produces N lines; a record containing a newline in a string
  value does not break line framing (it is JSON-escaped, not raw).
- Reading a file that does not yet exist returns an empty list, not an error
  (a journal is created on first append).
- A malformed line (manually corrupted) is reported as a typed error identifying
  the line number, not silently skipped.

## Constraints

- One JSON object per line, append-only (PRD §7.1.1 §2 — journals/events are
  jsonl, append-only; §6.1 — JOURNAL is append-only, trivially mergeable).
- Writes go through the single daemon writer; no locking scheme beyond
  open-for-append is required for Phase 1 (PRD §6.1 single-writer invariant).
- File I/O is injected through a small filesystem seam so tests use a temp dir
  they create and remove (PROFILE.md test conventions — hermetic temp dirs).

## Verification Gate

- `npm test` green for `src/foundations/jsonl.test.ts`, using a temp dir.

### Task T1 - Append and read back in order

**Input:** `src/foundations/jsonl.ts`, `src/foundations/jsonl.test.ts`

**Action - RED:** Write a test that appends three distinct objects to a temp-dir
file and asserts `readAll()` returns them in append order, and that the raw file
has exactly three newline-terminated lines.

**Action - GREEN:** Implement `JsonlLog` with `append(record)` (serialize + `\n`,
open-for-append) and `readAll()` (split on `\n`, drop the trailing empty, parse
each). Create the temp dir in the test's setup; remove it in teardown.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Missing file reads empty; embedded newline stays framed

**Input:** `src/foundations/jsonl.ts`, `src/foundations/jsonl.test.ts`

**Action - RED:** Write a test that `readAll()` on a not-yet-created path returns
`[]`, and that appending a record whose string field contains `"\n"` still yields
exactly one line and reads back equal.

**Action - GREEN:** Handle ENOENT in `readAll` as empty; rely on `JSON.stringify`
escaping to keep one logical record per physical line.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T3 - Malformed line is a typed, located error

**Input:** `src/foundations/jsonl.ts`, `src/foundations/jsonl.test.ts`

**Action - RED:** Write a test that pre-writes a file with a valid line then a
corrupt (non-JSON) line and asserts `readAll()` throws a typed error naming the
1-based line number of the corrupt line.

**Action - GREEN:** Wrap per-line `JSON.parse` and throw a typed `JsonlParseError`
carrying the line number on failure.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
