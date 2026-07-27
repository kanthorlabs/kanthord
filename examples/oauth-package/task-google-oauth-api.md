---
kind: task
ref: google-oauth-api
objective: oauth-backend
title: Implement Google OAuth API
agent: generic@1
context:
  source: source
---

# Instructions

Add the server-side Google OAuth 2.0 authorization-code flow: an endpoint that
redirects to Google's consent screen with the configured client id and scopes,
and a callback endpoint that exchanges the code for tokens and stores the
resulting session.

# Acceptance Criteria

- [ ] A login endpoint redirects to Google's consent screen
- [ ] The callback endpoint exchanges the authorization code for tokens
- [ ] An invalid or expired code returns a 4xx response, never a 5xx
