---
kind: task
ref: oauth-ui
objective: oauth-web
title: Implement OAuth UI
agent: generic@1
context:
  source: source
---

# Instructions

Add the sign-in screen that starts the OAuth flow, plus the post-callback
state: a signed-in view showing the account, and a sign-out control.

# Acceptance Criteria

- [ ] A sign-in control starts the OAuth flow
- [ ] After callback the signed-in account is displayed
- [ ] A sign-out control ends the session
