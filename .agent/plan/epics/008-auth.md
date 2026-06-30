# 008 Auth

## Outcome
Verify a single presented key id/secret against a hashed verifier, store provider API keys and the verifier as owner-only files, and fail closed on the remote path when secrets are missing/malformed/loose-perm.

## Decision Anchors
- D6: VPN-gated, single key id/secret, single user, no app-level TLS.
- B4: data/state credential, versioned line file, salted SHA-256, constant-time compare, perms, env fallback.
- B10: provider keys stay plaintext.
- B8: `version`.
- §4 Auth.

## Stories
- `.agent/plan/stories/008-auth/001-single-user-remote-auth.md` - hashed verifier, plaintext provider keys, perms, remote fail-closed, dev override, rotation, redaction.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.

## Dependencies
- Epic 001.
- Epic 002 for atomic write, lock, and perms.
- Epic 003 for dev override/config boundaries.
- Pairs with Epic 011 for forwarded authorization metadata.

## Non-Goals
- No multi-user or multi-tenant auth.
- No app-level TLS.
- No dual-key rotation.
- No per-transport session.

## Findings Out
- none
