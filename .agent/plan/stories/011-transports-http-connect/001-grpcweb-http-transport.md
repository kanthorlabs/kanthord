# Story 001 - gRPC-Web HTTP Transport

Epic: `.agent/plan/epics/011-transports-http-connect.md`

## Goal
A browser gRPC-Web client can call Core health and receive streamed token messages over HTTP/Connect, while auth metadata is forwarded to Core auth.

## Acceptance Criteria
- A gRPC-Web browser client invokes the health RPC successfully.
- Server-to-client token streaming works over gRPC-Web.
- On the remote path, a valid `authorization` credential authenticates and an invalid one is rejected.
- Loopback dev may run without auth through the explicit dev override.
- The transport keeps no session of its own.
- HTTP transport dev default bind is `127.0.0.1:7777`.
- Remote/VPS bind address is configurable and deployment-owned.
- No app-level TLS; h2c is acceptable behind VPN.
- nginx serves the static SPA and may reverse-proxy `/api`; Core serves gRPC-Web only.
- UDS is not built in this milestone.

## Constraints
- One generated schema and one RPC handler implementation.
- HTTP transport is a Core module, not a separate tier (D8).
- Use a pure-JS Connect server with no native dependency.
- Auth checked at RPC start / stream open by passing `authorization` metadata to Epic 008 verifier.
- No per-transport session.
- Mid-stream revocation is out of scope.

## Verification Gate
- `npm run typecheck`
- `npm test`
- Integration test against `127.0.0.1:7777` for health and token stream.

### Task 011-SPIKE - gRPC-Web streaming behavior

**Input:** `.agent/plan/findings/11-grpcweb-streaming.md`.

**Action - RED:** none - spike.

**Action - GREEN:** Confirm chosen Connect server supports gRPC-Web server streaming from a browser, including local nginx reverse-proxy path, and is pure JS.

**Action - REFACTOR:** none.

**Verify:** Findings file records gRPC-Web streaming and nginx behavior.

### Task 011-RED - HTTP transport integration tests

**Input:** `packages/core/src/**/*.test.ts` or the transport package test home; integration harness files if needed.

**Action - RED:** Add integration coverage for gRPC-Web health, server token streaming, valid/invalid authorization, loopback dev override, and default bind `127.0.0.1:7777`.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** The integration check fails because the HTTP transport is missing.

### Task 011-GREEN - HTTP/Connect transport

**Input:** `package.json`, `package-lock.json`, `packages/core/src/**` or the rpc/transport package source home.

**Action - RED:** none - opened by Task `011-RED`.

**Action - GREEN:** Implement the HTTP/Connect transport, gRPC-Web health/stream handlers, auth forwarding, and loopback bind behavior.

**Action - REFACTOR:** Keep RPC handlers transport-neutral so UDS can be added later without schema change.

**Verify:** `npm run typecheck && npm test` plus the integration check exits 0.
