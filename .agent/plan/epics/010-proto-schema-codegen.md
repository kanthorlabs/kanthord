# 010 Proto Schema & Codegen

## Outcome
Define one gRPC proto schema whose shapes map to named pi-agent-core types, with TypeScript codegen for Core and Web. Swift codegen is deferred.

## Decision Anchors
- S5: proto owns RPC wire contract, no Zod on RPC.
- S7: buf for TypeScript, connect-swift for Swift later.
- §3 RPC/Transport.
- D8: one schema, many clients.

## Stories
- `.agent/plan/stories/010-proto-schema-codegen/001-typescript-proto-codegen.md` - minimal health and token-stream schema, TS codegen, pi type mapping, round-trip test.

## Verification Gate
- `buf generate` runs in the build.
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- Native guard remains green.

## Dependencies
- Epic 001.
- Shares Epic 009 pi-agent-core findings.

## Non-Goals
- No Swift codegen in this milestone.
- No serving schema over transports; Epic 011 owns that.
- No full agent API.

## Findings Out
- `.agent/plan/findings/10-schema-derivation.md`
