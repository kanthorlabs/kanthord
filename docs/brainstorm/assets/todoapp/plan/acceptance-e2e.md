---
kind: task
parent: acceptance.md
bindings: []
verifications:
  - npm run test:e2e
---
# Exercise the running API as independent clients

## Requirement

Build `test/e2e/todo-api.test.js` and its owned fixtures around the actual production entrypoint, actual HTTP calls and a real temporary SQLite database. Use Alice and Bob plus a provisioned administrator to test full lifecycle and access separation. The `test:e2e` script runs this explicit file and any additional required end-to-end files without silently tolerating their absence.

## Criterion

- Alice registers, logs in, creates and completes a TODO, lists it through pagination and deletes it with the current ETag. Bob and the administrator cannot access Alice's TODO.
- Anonymous requests fail on all private endpoints. A user receives 403 for admin stats; an administrator receives aggregate stats only.
- Two requests sharing a version produce one success and one 412. Invalid bodies, malformed JSON and bad cursors produce safe errors without data changes.
- Restart preserves committed accounts, live sessions and TODOs. A logged-out token remains invalid after restart. Expiry uses a bounded deterministic test mechanism, not an exposed production clock endpoint.
- Captured process logs contain correlated results but no secret or private-content sentinels. Tests always stop children and remove temporary resources, including on failure.
