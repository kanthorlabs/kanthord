# 013 Capability Layer

## Outcome
Build the pure-TypeScript capability framework: one contract and registry per capability, ownership-aware host/client tags, runtime-mode selection, and unsupported defaults that throw.

## Decision Anchors
- D9: capability layer and unsupported-default throws.
- §7 Capability Layer.

## Stories
- `.agent/plan/stories/013-capability-layer/001-unsupported-capability-framework.md` - runtime-mode selection, registry manifest fields, host/client ownership, unsupported throws.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.

## Dependencies
- Epic 001.

## Non-Goals
- No concrete platform implementation in this milestone.
- No Swift-helper IPC spike in this milestone.
- No server-to-client capability invocation.

## Findings Out
- none
