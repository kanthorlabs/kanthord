# 009 Tool Execution Contract

## Outcome
Implement a daemon-first tool contract where every tool declares the v1 field set and every invocation runs validate -> canRun -> execute with timeout/abort -> exactly one ToolFinished -> append-only event.

## Decision Anchors
- B9: tool contract and v1 subset.
- §6 Tool Execution Contract.
- S5: Zod for tool input schemas, not RPC.
- D4/B3: `canRun` gate.
- N1: locks.
- D3: pi-agent-core transient retry risk.

## Stories
- `.agent/plan/stories/009-tool-execution-contract/001-v1-tool-invocation-pipeline.md` - v1 declaration fields, terminal statuses, events, validation, canRun, timeout/cancel, model-boundary mapping, retry/idempotency findings.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- pi-agent-core tool/retry findings are recorded.

## Dependencies
- Epic 001.
- Epic 002 for jsonl events and locks.
- Epic 004 for event emission.
- Epic 007 for `canRun`.
- Pairs with Epic 006 and Epic 012.

## Non-Goals
- No streaming, maxOutputBytes, artifacts, auditPolicy/output redaction, or per-tool concurrency in v1.

## Findings Out
- `.agent/plan/findings/09-pi-agent-core-tool-surface.md`
