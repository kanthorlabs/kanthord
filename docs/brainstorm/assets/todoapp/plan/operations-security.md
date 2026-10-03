---
kind: task
parent: operations.md
bindings: []
verifications:
  - node --test test/operations-security.test.js
---
# Apply secure middleware and secret-safe request logging

## Requirement

Configure Helmet, explicit-origin CORS, bounded request-rate middleware and structured Pino request logging. Register logging before parsing so rejected bodies still receive correlation. Respect only explicitly trusted proxy addresses.

## Criterion

- HTTP tests assert security headers, allowed/disallowed origin behavior and preflight support for bearer and conditional-write headers.
- General API and stricter login/registration limiters return 429 with Retry-After at their limits; liveness/readiness remain available. Fake forwarded IPs cannot bypass limits when proxy trust is false.
- Each request produces one completion log with method, route template, status, duration and server request_id; unknown routes use a constant fallback template.
- Captured logs contain none of the sentinels placed in authorization, cookies, passwords, tokens, email, TODO content or query strings, even on parsing/error paths.
- In-memory limiters are documented as single-process controls, not cross-replica protection.
