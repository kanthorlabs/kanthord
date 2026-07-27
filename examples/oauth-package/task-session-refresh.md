---
kind: task
ref: session-refresh
objective: oauth-backend
title: Refresh expired OAuth sessions
agent: generic@1
dependencies: [google-oauth-api]
context:
  source: source
---

# Instructions

Refresh an expired access token from its stored refresh token when a request
arrives with an expired session, and reject the request when the refresh token
is itself invalid.

# Acceptance Criteria

- [ ] An expired access token is refreshed transparently on the next request
- [ ] An invalid refresh token clears the session and returns 401
