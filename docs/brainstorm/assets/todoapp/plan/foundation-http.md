---
kind: task
parent: foundation.md
bindings: []
verifications:
  - node --test test/foundation-http.test.js
---
# Establish public routing and safe JSON responses

## Requirement

Use Express Router and bounded JSON parsing. Supply public liveness, JSON route-not-found handling and central synchronous/asynchronous error forwarding. Generate a server request identifier for every request and echo it as `X-Request-Id`.

## Criterion

- `GET /health/live` returns 200 with `{ status: "ok" }` without authentication.
- Errors use `{ error: { code, message, request_id, details } }` and correlate with the response header. Arbitrary incoming request IDs are not trusted or copied into logs.
- Tests cover malformed JSON 400, payload too large 413, unsupported media type 415, unmatched route 404 and unexpected async exception 500.
- JSON write routes reject arrays, null and primitive bodies with 400. Internal errors expose neither a stack nor a SQL statement.
- Middleware ordering and response behavior are exercised through HTTP requests, not only mocked handler calls.
