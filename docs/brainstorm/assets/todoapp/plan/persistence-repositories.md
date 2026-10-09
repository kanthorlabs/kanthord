---
kind: task
parent: persistence.md
bindings: []
verifications:
  - node --test test/persistence-repositories.test.js
  - npm ci && npm run test:persistence
  - npm run test:foundation
---
# Isolate validated, owner-scoped repository operations

## Requirement

Implement account, session and TODO repositories with prepared statements and explicit results for absent rows, uniqueness conflicts and stale versions. Repositories expose domain objects with the same snake_case field names that the API will use, without allowing clients to choose ownership. Provide the `test:persistence` script, which runs the three persistence suites.

## Criterion

- Duplicate normalized emails and token digests fail deterministically without duplicate rows.
- Injection-like email and TODO text is treated as data. Unknown roles and invalid value types are rejected before a write.
- Owner-scoped list, get, update and delete never return or modify another user's TODO.
- Conditional update and delete compare both owner and expected version in the write, not only in an earlier read.
- Public projections omit `password_hash` and `token_hash`. Session lookup returns only what authentication needs.
