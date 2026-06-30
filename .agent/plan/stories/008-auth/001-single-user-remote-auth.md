# Story 001 - Single User Remote Auth

Epic: `.agent/plan/epics/008-auth.md`

## Goal
The remote HTTP-serving path authenticates one operator credential using a hashed verifier, while local/loopback dev can explicitly bypass auth.

## Acceptance Criteria
- Matching key id and correct secret authenticates.
- Wrong secret or mismatched key id is rejected.
- Core stores only hashed verifier `sha256$<salt>$<hash>` plus plaintext key id.
- Core never writes the plaintext auth secret.
- Provider API keys are stored plaintext with file `0600` and dir `0700`.
- Verifier/credential files also use file `0600` and dir `0700`.
- Remote HTTP serving refuses to serve if verifier is missing, unreadable, malformed, unsupported `version`, or has loose perms.
- Credential is provisioned by the operator at setup and is not auto-generated.
- Local/loopback dev can run without a verifier only through an explicit dev override.
- Auth secret and provider keys never appear in operational logs.
- Credential is a versioned ssh-style line file, not JSON, with `version` starting at `1`.
- Single key id/secret and single user only.
- After atomic credential replace, the new secret verifies without restarting Core.
- Auth secret may come from env only as a dev/bootstrap fallback.
- Credential path resolves per B4 platform paths.

## Constraints
- Hash uses salted SHA-256 plus Node `crypto.timingSafeEqual` (B4).
- No bcrypt, scrypt, Argon2, or native dependency.
- Verifier hashed, provider keys plaintext.
- Auth consumes `authorization` metadata forwarded by transports.
- Dev override must be an explicit named CLI/config flag and emit a warning.
- Rotation reload mechanism is the engineer's choice.
- Files use Epic 002 atomic replace, lock, and perms.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 008-SPIKE - Crypto and Podman perms

**Input:** spike note under `.agent/tdd/`.

**Action - RED:** none - spike.

**Action - GREEN:** Confirm Node `crypto` salted SHA-256 and `timingSafeEqual` surface, and confirm `0600`/`0700` checks under rootless Podman uid mapping on `.data/auth`.

**Action - REFACTOR:** none.

**Verify:** Spike note records the crypto and permission behavior.

### Task 008-RED - Auth behavior tests

**Input:** `packages/core/src/**/*.test.ts` or the auth package test home.

**Action - RED:** Add `node:test` coverage for correct/wrong credentials, stored verifier shape, no plaintext auth secret, loose/missing/malformed/bad-version refusal, explicit dev override warning, provider key plaintext storage, no config/env provider-key acceptance, log redaction, and rotation without restart.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because auth is missing.

### Task 008-GREEN - Auth implementation

**Input:** `packages/core/src/**` or the auth package source home.

**Action - RED:** none - opened by Task `008-RED`.

**Action - GREEN:** Implement single-user verifier auth, provider key storage, permission checks, dev override, rotation, and redaction hooks so the Story ACs pass.

**Action - REFACTOR:** Keep verifier, provider-key, and remote-serving policy seams separate.

**Verify:** `npm run typecheck && npm test` exits 0.
