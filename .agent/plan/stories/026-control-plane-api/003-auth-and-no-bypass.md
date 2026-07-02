# Story 003 - Auth & No-Bypass

Epic: `.agent/plan/epics/026-control-plane-api.md`

## Goal

The exposed server runs Basic auth over TLS on the VPN-interface bind and can
never be configured onto `0.0.0.0`; the control plane has no privileged path
around the three rings.

## Acceptance Criteria

- The server serves TLS with the SU5 material; a plaintext request is refused;
  a request without credentials or with wrong credentials gets an
  unauthenticated error and no method executes; the credential check is
  **timing-safe** against custody-stored values and credentials never appear in
  logs (Basic auth over TLS — PRD §9; debate finding).
- Bind policy by mode (debate finding): **production mode** accepts only the
  configured VPN-interface address; **dev/test mode** (explicit config flag)
  additionally allows loopback; `0.0.0.0`, `::`, or any other address fails
  startup with a typed error naming the rule in either mode (PRD §9 — never
  `0.0.0.0`; asserted at the config seam so tests need no real VPN).
- The 2A loopback-only control methods (Epic 017) fold into this auth regime
  when TLS exposure is enabled — one auth path, no legacy unauthenticated
  method left in the descriptor (checked).
- No-bypass behavioral probe: a control-triggered path attempting an
  out-of-scope write is blocked by ring 1 exactly as an agent's would be; a
  control-triggered broker submit passes the ring-1 scan; nothing in the RPC
  modules imports ring-1 internals to disable them (module-boundary
  assertion); and a **config-mutation sweep** proves no RPC-reachable seam —
  including injected dependencies — can change ring-1 policy/config outside
  the budget-override flow (debate finding; phases.md — no privileged bypass).
- Auth failures are journaled (actor-less, source-tagged) — brute-force
  visibility without a lockout mechanism (VPN is the perimeter, PRD §9 knob).

## Constraints

- TLS server setup per the SU5 findings; certificates from custody config —
  paths, not embedded PEM, in daemon config.
- Tests run TLS on loopback with test certificates; the VPN-address case is
  exercised via the config-validation seam (no real VPN in CI).

## Verification Gate

- `npm test` green for `src/rpc/auth.test.ts`.

### Task T1 - TLS + Basic auth + bind policy

**Input:** `src/rpc/auth.ts`, `src/rpc/auth.test.ts`

**Action - RED:** Write tests: (a) TLS round-trip with valid credentials
succeeds; (b) plaintext refused; (c) wrong/missing credentials ⇒
unauthenticated, no method side effect; (d) `0.0.0.0`/`::`/foreign-address
binds ⇒ startup error; loopback + configured VPN address accepted; (e) auth
failures journaled.

**Action - GREEN:** Implement TLS + Basic auth middleware + bind validation on
the Connect server.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - No-bypass probes

**Input:** `src/rpc/auth.ts`, `src/rpc/auth.test.ts`

**Action - RED:** Write tests: (a) a control-path out-of-scope write is ring-1
blocked; (b) a control-path broker submit passes the secret scan; (c) RPC
modules import no ring-1 internal mutation surface (boundary check); (d) the
descriptor holds no unauthenticated method once exposure is enabled.

**Action - GREEN:** Close any gap the probes expose (in owning modules).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
