---
kind: task
parent: operations.md
bindings: []
verifications:
  - node --test test/operations-lifecycle.test.js
---
# Expose readiness and shut down within a deadline

## Requirement

Own the HTTP listener and injected resources in the process entrypoint. Expose readiness separately from public liveness. Configure request/header/keep-alive timeouts and handle termination signals through one idempotent drain operation.

## Criterion

- Liveness returns 200 independently of storage. Readiness returns 503 before initialization, on a failed bounded storage probe and during shutdown, without operational secrets.
- A process-level test sends SIGTERM with an in-flight request, confirms it finishes within the grace period, and observes resource closure and process exit.
- A deliberately stuck connection is terminated at the ten-second deadline; repeated signals do not close resources twice or start multiple drains.
- Startup errors fail before the process advertises readiness and close already-opened resources.
- Tests own their child processes, use explicit timeouts and always clean up listeners and resources.
