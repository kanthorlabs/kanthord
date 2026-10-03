---
kind: task
parent: acceptance.md
bindings: []
verifications:
  - node --test test/acceptance-delivery.test.js
---
# Make deployment and maintenance reproducible

## Requirement

Provide a developer README, operations runbook and Node 24 CI workflow. Keep the application a single API process on one host with local durable SQLite storage. Document future scaling boundaries without adding distributed infrastructure to this fixture.

## Criterion

- CI installs the lockfile and runs `npm run verify`. Tests inspect script/workflow wiring and prove that a deliberately failing fixture returns nonzero rather than being swallowed.
- Startup instructions cover migrations, explicit production configuration, HTTPS termination, allowed origins, trusted proxies and operator-only initial administrator creation.
- The runbook describes readiness/liveness, structured request-ID investigation and the ten-second shutdown deadline. Errors and example logs disclose no secrets.
- A disposable test stops the app, checkpoints/closes SQLite, backs up the consistent database, restores to a separate path and verifies accounts/TODOs after restart. It never copies a live main file without its WAL state.
- Document that backups contain sensitive hashes and session digests and require restricted permissions, protected storage and operator-managed retention. Restoring an old backup can restore old session records; the recovery procedure removes all sessions before reopening access.
- Tests execute documented commands where practical and validate their artifacts; merely asserting that documentation files exist is insufficient.
