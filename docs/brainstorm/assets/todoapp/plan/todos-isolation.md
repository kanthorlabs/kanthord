---
kind: task
parent: todos.md
bindings: []
verifications:
  - node --test test/todos-isolation.test.js
---
# Enforce ownership and atomic conditional writes

## Requirement

Authorize every TODO operation using the authenticated user's identity. Require a strong integer ETag in `If-Match` on patch and delete, and compare owner and version atomically in SQL. Administrators follow the same ownership rule.

## Criterion

- A route matrix exercises all five TODO endpoints without credentials and receives 401.
- Bob and an administrator cannot list Alice's TODO or access it by known UUID. Direct get/patch/delete return 404 without disclosing its version.
- Missing `If-Match` returns 428; invalid forms return 400; stale owned-row versions return 412, with no mutation.
- Concurrent updates with the same ETag produce exactly one success, one 412 and one version increment. A stale delete preserves the row.
- User identity supplied through body, query or headers never changes ownership; SQL injection-like inputs confer no access.
