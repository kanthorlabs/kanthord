# 08 Auth (single key, hashed verifier, secret files)

Goal:             Verify a single presented key id/secret against a hashed
                  verifier, store provider API keys + the verifier as owner-only
                  files, and fail closed on the REMOTE path when secrets are
                  missing/malformed/loose-perm.

Problem:          The credential's only job is **gating remote access** — on the
                  tailnet, stop anyone but the single user from reaching Core and
                  driving the agent (which has shell access). The VPN limits which
                  machines reach the port; the credential limits it to the secret
                  holder. **Local/loopback** access is already gated by OS isolation
                  (owner-only UDS / 127.0.0.1), so auth there adds little. So: auth
                  is **required on the remote/HTTP-serving path**; the credential is
                  **provisioned by the operator at setup** (no auto-generate); local
                  dev runs without it via the dev override.

Decision anchors: D6 (VPN-gated, single key id/secret, single user, no app-level
                  TLS), B4 (credential in data/state dir, versioned line file,
                  hashed verifier = salted SHA-256 + constant-time compare via Node
                  `crypto`, refuse-on-loose-perms, env = dev fallback only,
                  per-platform paths), B10 (provider keys stay plaintext), B8
                  (`version`), §4 Auth.

ACs:
- A presented credential whose **key id matches and secret is correct**
  authenticates; a wrong secret **or** a mismatched key id is rejected.
- Core stores **only a hashed verifier** `sha256$<salt>$<hash>` plus the key id
  (plaintext); the plaintext **secret is never written** by Core.
- **Provider API keys are stored plaintext** (they must be replayed to the
  provider) with perms **file `0600` / dir `0700`**, owner-only — same perms for
  the verifier/credential.
- **Fail closed on the remote path:** when Core serves the remote/HTTP transport,
  it **refuses to serve** if the verifier is missing, unreadable, malformed, has an
  unsupported `version`, or its file/dir perms are looser than `0600`/`0700`. The
  credential is **provisioned at setup** (operator writes the verifier) — not
  auto-generated. **Local/loopback dev** may run **without** a verifier via the
  **explicit dev override** (OS isolation already gates loopback/UDS).
- **Secrets are redacted from operational logs** (the auth secret and provider
  keys never appear in `logs/`) — this is the redaction epic 05 deferred here.
- The credential is a **versioned, ssh-style line file (not JSON)** carrying
  `version` starting at `1`, living in the **data/state dir**, not config.
- **Single** key id/secret, **single user** — no multi-user/multi-tenant.
- **Rotation:** after an atomic credential replace, the new secret verifies
  without restarting Core (dual-key rotation deferred).
- The auth secret may come from an env var **only as a dev/bootstrap fallback**,
  never the default precedence.
- **Credential path resolves per platform** (B4): macOS
  `~/Library/Application Support/Kanthor/auth/`, Linux user
  `${XDG_STATE_HOME:-~/.local/state}/kanthor/auth/`, Linux system/VPS + container
  `/var/lib/kanthor/auth/`.

Constraints:
- Hash = **salted SHA-256 + constant-time compare via Node built-in `crypto`**
  (`timingSafeEqual`) (B4); no bcrypt/scrypt/Argon2 (secret is high-entropy
  random) and **no native dep** (D2). Constant-time compare is a Constraint, not a
  unit-testable AC.
- **Verifier hashed, provider keys plaintext** (B4 vs B10) — the verifier is never
  replayed; provider keys must be.
- **No app-level TLS** (D6) — trust the VPN tunnel; auth is the credential only.
- Auth consumes the credential from the `authorization` metadata that the
  **transports forward** (epic 11); auth keeps no per-transport session. The
  `Basic base64(keyId:secret)` vs Bearer wire format is decided at build (§4).
- The **dev override** must be an explicit named CLI/config flag that emits a
  warning when used; it **cannot** be enabled by ambient env alone.
- The rotation **reload mechanism** (signal / watch / next-request re-read) is the
  engineer's choice — not mandated; only the no-restart behavior above is required.
- Files use the **epic-02 atomic replace + lock + perms**.

Spike?:           light — confirm (authoring rule 4) the Node `crypto` surface
                  (`timingSafeEqual`, salted SHA-256) and that the `0600`/`0700`
                  perms check behaves under rootless Podman uid mapping on the
                  `.data/auth` mount. Reuse dev-setup (`02-development-setup.md`) +
                  epic-02 perms findings; skip if covered.

Verification:     `node:test` in a throwaway temp dir (never `.data/`): correct
                  key-id+secret authenticates / wrong secret / wrong key-id
                  rejected; compare uses `timingSafeEqual` not `===`; stored
                  verifier contains only `sha256$salt$hash` + key id; refuse-to-
                  start on loose perms, missing, malformed, or bad-`version`
                  verifier (dev override bypasses with a warning); provider key
                  round-trips plaintext at `0600` and is **not** accepted from
                  config/env (ties to epic-03 no-secrets-in-config); secrets are
                  absent from emitted operational logs; rotation replaces
                  atomically and the new secret verifies without restart.

Dependencies:     01 (workspace), 02 (atomic write + lock + perms), 03 (dev-
                  override flag / paths; no-secrets-in-config). Pairs with 11
                  (transports forward `authorization` metadata) and 05 (redaction
                  owned here).

Findings out:     none new (reuses epic-02 / dev-setup perms findings).
