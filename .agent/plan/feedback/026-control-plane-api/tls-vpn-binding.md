# SU5 — TLS material + VPN-interface bind policy (Epic 020 SU5, unblocks Epic 026 Story 003)

Status: **PASS — 6/6.** Date: 2026-07-14.
Probe: `scripts/dev/probes/su5-tls-vpn-probe.mjs`.

## TLS material (scratch; Ulrich swaps real later)

- Generated a **scratch self-signed** RSA-2048 cert+key with `openssl`:
  - `.data/kanthord/tls/cert.pem` (mode `0644`)
  - `.data/kanthord/tls/key.pem` (mode **`0600`**)
  - CN `kanthord-daemon-scratch`; SAN `DNS:localhost, DNS:kanthord.vpn.local,
    IP:127.0.0.1, IP:::1`; 365-day validity.
- **Both files are git-ignored** (`.data/` is ignored) — nothing sensitive is
  tracked. `git check-ignore` confirms both paths.
- **Config carries paths, not embedded PEM** (Story 003 constraint). Daemon
  config points at the cert/key files; the material is loaded at boot with the
  same custody posture as other secrets (0600 key, owner check).
- The TLS material verified in a real `node:tls` server: a handshake completes
  and the app echo round-trips; a **plaintext** TCP request does **not** complete
  a TLS handshake (plaintext refused).
- **Ulrich's action later:** replace these two files with real cert+key (same
  paths, or repoint config). No code change needed — paths are config.

## VPN-interface detection — the answer to SU5's question

**How the daemon finds the VPN interface address on the host, never `0.0.0.0`:**

1. **Config names the interface, not the address.** The operator sets the VPN
   interface *name* (e.g. `utun3`, `wg0`, `tailscale0`) in global daemon config —
   the live address is dynamic, so we never hard-code it.
2. **Resolve via `os.networkInterfaces()`** at bind time: look up the named
   interface, pick its address for the configured family (IPv4 default). Absent
   interface / no matching family ⇒ a **typed error** (startup fails — fail-closed).
   The probe resolved a real interface on this host:
   `utun0 → fe80::…` (host has `utun0..utun5` — macOS VPN/tunnel interfaces).
3. **Bind policy (PRD §9), asserted at the config seam so tests need no real VPN:**
   - `0.0.0.0`, `::`, `::0`, empty ⇒ **always rejected**, both prod and dev, with
     a typed `BindPolicyError` naming the rule.
   - **loopback** (`127.0.0.1`/`::1`) ⇒ allowed **only in dev/test mode behind an
     explicit config flag**; rejected in production (debate finding — loopback must
     not become a production loophole).
   - any **specific interface address** (the resolved VPN address) ⇒ allowed in
     production. Production should additionally confirm the address belongs to the
     configured VPN interface (the resolution step already guarantees this).

The probe's `resolveInterfaceAddress()` + `assertBindAllowed(addr, mode)` are a
**spike demonstration** of this rule (6/6 green). **Story 003 owns the production
seam** — wire these into the Connect server's listen path + config validation.

## Carried into Epic 026 Story 003 (not SU5's job)

- **Basic auth over TLS**, credentials from custody (env-style `credentials`
  file — reuse `loadCredentialsFile`), checked **timing-safe** (`crypto.timingSafeEqual`),
  never logged (value-based redaction).
- **Auth failures journaled** (actor-less, source-tagged) for brute-force
  visibility; no lockout (VPN is the perimeter — PRD §9 knob).
- **No-bypass:** a control-triggered out-of-scope write is ring-1 blocked exactly
  as an agent's; RPC modules import no ring-1 mutation surface (module-boundary
  assertion); config-mutation sweep proves no RPC-reachable seam changes ring-1
  policy outside the budget-override flow.
- The 2A loopback-only inbox methods fold into this auth regime once TLS exposure
  is enabled — one auth path, no unauthenticated method left in the descriptor.
