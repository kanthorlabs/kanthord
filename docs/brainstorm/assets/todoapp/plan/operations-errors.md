---
kind: task
parent: operations.md
bindings: []
verifications:
  - node --test test/operations-errors.test.js
---
# Normalize failures into safe, correlated API errors

## Requirement

Maintain one final Express error middleware and a typed application error catalog. Map parser, validation, service and storage failures to the shared JSON error envelope without passing internal exception text to clients.

## Criterion

- Tests cover 400, 401, 403, 404, 409, 412, 413, 415, 428, 429, 500 and 503 mappings through test routes/adapters, without adding production debug routes.
- Error codes are stable and distinct where clients need different recovery behavior. Validation details name safe field paths, not submitted values or raw Zod input.
- Errors correlate their request_id with X-Request-Id. Async rejection and synchronous throw share the same safe 500 response.
- Storage contention exhaustion returns 503 with Retry-After; stack, filesystem paths, SQL, passwords and tokens do not enter the response.
- Already-started responses follow Express's safe termination path rather than attempting a second JSON response.
