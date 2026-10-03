---
kind: task
parent: todos.md
bindings: []
verifications:
  - node --test test/todos-pagination.test.js
---
# Bound and filter private TODO collections

## Requirement

Provide keyset pagination for owner-scoped TODO collections, ordered by descending creation time then descending UUID. Validate every cursor component, limit and completion filter; return `{ items, next_cursor }` without an unbounded total-count scan.

## Criterion

- Default limit is 20; limits outside 1 through 100, fractions and nonnumeric values return 400. Boolean filters accept only literal `true` or `false`.
- Empty collections return an empty items array and null cursor. Full traversal of stable fixtures has neither duplicates nor missing records, including equal timestamps.
- Malformed and filter-mismatched cursors return 400. A cursor from another account exposes no foreign records.
- Unknown or repeated query parameters fail rather than being interpreted ambiguously.
- Insertion before the current cursor does not duplicate prior results. Document that concurrent completion edits need not yield snapshot-consistent pages.
