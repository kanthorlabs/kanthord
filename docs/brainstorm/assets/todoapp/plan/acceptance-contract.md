---
kind: task
parent: acceptance.md
bindings: []
verifications:
  - node --test test/acceptance-contract.test.js
---
# Publish and verify the complete REST contract

## Requirement

Write OpenAPI 3.1 for every public, private and admin route. Define schemas, bearer authentication, owner-only access, pagination and strong ETag preconditions. Keep HTTP fields identical to the domain's snake_case fields and exclude internal password/session-digest fields.

## Criterion

- Tests validate the OpenAPI document and compare documented method/path coverage to the application's route inventory without adding a public route-list endpoint.
- Real HTTP examples validate against response schemas for success and representative errors, including 401 versus 403 versus owner-hiding 404, stale 412 and missing-precondition 428.
- Public operations explicitly require no authentication. Every private operation declares bearer authentication; admin stats additionally documents the admin policy.
- The contract documents JSON size limits, strict input fields, 429/503 retry headers, response ETag/Location and the error request_id.
- Examples contain no usable credentials or tokens and do not imply cross-owner admin access.
