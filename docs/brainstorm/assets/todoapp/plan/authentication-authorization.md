---
kind: task
parent: authentication.md
bindings: []
verifications:
  - node --test test/authentication-authorization.test.js
---
# Separate public, authenticated and administrator routes

## Requirement

Mount explicit public and authenticated routers, with role checks after authentication for administrator routes. Implement `GET /api/v1/admin/stats` as an admin-only aggregate read, not a user-data browsing endpoint.

## Criterion

- Liveness, registration and login are reachable without a token. Private authentication endpoints and admin stats are not.
- An anonymous stats request returns 401, a normal user's request returns 403 and an administrator's request returns 200 with only `user_count` and `todo_count`.
- Header/body/query attempts to supply a role cannot override the stored account role.
- Tests show role authorization reads current account state rather than trusting token content or a stale process-local role cache.
- Shared authentication middleware exposes a server-derived user identity for later TODO routes, with a deny-by-default private-router pattern.
