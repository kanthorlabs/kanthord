---
kind: task
parent: authentication.md
bindings: []
verifications:
  - node --test test/authentication-accounts.test.js
---
# Store password-protected accounts without role escalation

## Requirement

Implement strict registration and credential verification using normalized emails and asynchronous salted scrypt. Expose only safe user projections. Supply operator-only initial administrator provisioning without an HTTP elevation path.

## Criterion

- Successful registration returns 201 with `id`, `email`, `role`, `created_at`; the role is always `user` and no session is issued.
- Duplicate normalized email returns 409. Malformed email, password bounds, and extra fields return 400 without a partial write.
- The same password for two users produces distinct stored hashes. Tests verify actual password matching and mismatching, not mocked crypto success.
- Unknown-account login and wrong-password login share status, code and public message. Unknown accounts still perform a password derivation comparison.
- Administrator provisioning does not accept passwords in command arguments, does not log them and does not silently elevate an existing normal account.
