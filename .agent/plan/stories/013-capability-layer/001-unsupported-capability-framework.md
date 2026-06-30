# Story 001 - Unsupported Capability Framework

Epic: `.agent/plan/epics/013-capability-layer.md`

## Goal
Core has a pure TypeScript capability framework where callers use one contract, selection uses runtime mode plus probes, and unsupported implementations throw explicitly.

## Acceptance Criteria
- Calling a capability with no implementation for the current platform throws an explicit `unsupported` error.
- Selection behaves by named runtime modes: `macos-native`, `macos-podman`, `linux-container`, `linux-vps`, `ci`.
- With platform implementations deferred, every named mode resolves to unsupported for now.
- Selection uses runtime-mode plus feature probing, not bare `process.platform`.
- Registry returns `exists`, `available`, `unavailableReason`, and `enableAction` per capability.
- Capabilities carry an ownership tag `host` or `client`.
- Client entries are client-side only; Core never runs on iOS.

## Constraints
- Adopt Flutter's shape, not method channels or federated registration.
- Use names `host capabilities` and `client capabilities`, distinct from plugins.
- Unsupported default throws until implementation exists (D9).
- Pure TypeScript and no native `.node` dependency.
- Web-first scope: macOS Swift-helper host capability and IPC spike are deferred.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 013-RED - Capability framework tests

**Input:** `packages/core/src/**/*.test.ts` or the capability package test home.

**Action - RED:** Add `node:test` coverage for unsupported throws, runtime-mode/probe selection across the named modes, registry fields, and host/client ownership tags.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because capability framework is missing.

### Task 013-GREEN - Capability framework

**Input:** `packages/core/src/**` or the capability package source home.

**Action - RED:** none - opened by Task `013-RED`.

**Action - GREEN:** Implement the capability contracts, registry, runtime-mode selection seam, ownership tags, and unsupported default behavior.

**Action - REFACTOR:** Keep runtime detection injectable so tests fake modes without depending on host OS.

**Verify:** `npm run typecheck && npm test` exits 0.
