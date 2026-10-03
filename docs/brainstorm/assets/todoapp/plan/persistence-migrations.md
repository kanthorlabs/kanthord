---
kind: task
parent: persistence.md
bindings: []
verifications:
  - node --test test/persistence-migrations.test.js
---
# Maintain transactional SQLite migrations

## Requirement

Provide a versioned migration runner and explicit database connection owner. Set foreign keys on every connection, use WAL for file-backed databases and bound lock waits. Keep migration code separate from HTTP routing.

## Criterion

- Tests cover empty database initialization, repeated migration, an older supported fixture, newer-version refusal and rollback of an injected failed migration.
- The migration ledger changes atomically with its migration. Existing rows remain unchanged by a no-op run.
- Tests inspect actual connection settings and prove orphan rows fail under foreign-key enforcement.
- No SQL CHECK constraint or non-unique index is declared. Startup cannot serve with a partially applied schema.
