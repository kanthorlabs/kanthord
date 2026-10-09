---
kind: task
parent: authentication.md
bindings: []
verifications:
  - node --test test/authentication-sessions.test.js
  - npm ci && npm run test:authentication
  - npm run test:persistence
---
# Enforce expiring and revocable bearer sessions

## Requirement

Issue high-entropy opaque bearer tokens at successful login. Persist only SHA-256 digests and authenticate each private request by the persisted session, expiry and current account. Keep session creation separate from password hashing transactions. Provide the `test:authentication` script, which runs the three authentication suites.

## Criterion

- Login returns `access_token`, `token_type: "Bearer"` and `expires_at` with `Cache-Control: no-store`. The database and logs never contain the raw token.
- Missing, malformed, unknown and expired credentials return 401 with a Bearer challenge. At `now == expires_at`, access is refused.
- `/auth/me` returns the authenticated user's safe fields, not client-supplied identity values.
- Logout returns 204 and removes only the current session. Reusing that token, including after a process/database reopen, returns 401.
- Tests exercise actual signed-out and signed-in HTTP requests with separate tokens for two accounts and an injected clock, without sleeping to test expiry.
