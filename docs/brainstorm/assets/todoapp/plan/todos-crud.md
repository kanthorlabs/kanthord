---
kind: task
parent: todos.md
bindings: []
verifications:
  - node --test test/todos-crud.test.js
---
# Provide validated TODO lifecycle operations

## Requirement

Expose owner-scoped creation, retrieval, partial update and hard deletion. Use the domain's exact snake_case field names in HTTP and repository objects. Set server-owned IDs, ownership, version and UTC timestamps internally.

## Criterion

- Tests assert create 201 with Location and ETag, get 200, patch 200 with one version increment, and delete 204 with no response body.
- Defaults are `description: ""`, `completed: false`, `version: 1`; only title is required on create.
- Strict body schemas reject unknown/server-owned fields, invalid types, whitespace-only titles, field-length violations and empty patches.
- Completing and reopening a TODO toggles only permitted content plus server-maintained version/time fields.
- Deleted rows cannot be retrieved; invalid UUIDs yield 400 and valid absent UUIDs yield 404. Failures preserve prior data.
