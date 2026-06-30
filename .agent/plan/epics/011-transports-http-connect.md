# 011 Transport HTTP/Connect

## Outcome
Serve the one gRPC schema over HTTP/Connect with gRPC-Web for the Web client, forwarding authorization metadata to Core auth with no per-transport session. UDS is deferred.

## Decision Anchors
- D8: one schema; HTTP transport is a Core module, not a separate tier.
- B4: auth metadata forwarded; no per-transport session; no app-level TLS.
- §2 Architecture.
- §9.D Web hosting.
- Client/Transport Architecture in `01-plan-revise.md`.

## Stories
- `.agent/plan/stories/011-transports-http-connect/001-grpcweb-http-transport.md` - gRPC-Web health and token stream over HTTP/Connect, auth forwarding, loopback default bind.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- Integration check proves gRPC-Web health and token streaming on `127.0.0.1:7777`.

## Dependencies
- Epic 001.
- Epic 008 for auth verifier.
- Epic 010 for schema and generated handlers.
- `.agent/milestone/01-infrastructure/02-development-setup.md` for port/local-run findings.

## Non-Goals
- UDS transport is deferred.
- No nginx config ownership.
- No app-level TLS, session, or revocation design.

## Findings Out
- `.agent/plan/findings/11-grpcweb-streaming.md`
