---
kind: task
parent: persistence.md
bindings: []
verifications:
  - node --test test/persistence-durability.test.js
---
# Preserve committed data and bound write contention

## Requirement

Make persistence behavior observable under reopen, rollback and concurrent writes. Keep transactions synchronous and short around SQLite work; translate lock exhaustion to an explicit repository error for the HTTP layer.

## Criterion

- A real file-backed test writes accounts, sessions and TODOs, closes the connection, reopens it and verifies identical committed values.
- A failed multi-write transaction leaves none of its partial rows.
- Two updates with the same expected version yield one winner, one conflict and a single version increment.
- An independent connection/process holding a write lock causes bounded failure with no partial write. Tests have explicit deadlines and release locks in cleanup.
- Every test closes connections before removing temporary directories.
