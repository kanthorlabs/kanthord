# Story 001 - V1 Tool Invocation Pipeline

Epic: `.agent/plan/epics/009-tool-execution-contract.md`

## Goal
Every tool invocation follows one observable pipeline with declared schemas, validation, `canRun`, timeout/cancellation, one terminal event, audit JSONL, model-boundary mapping, and durable idempotency.

## Acceptance Criteria
- Every tool declares `name`, `version`, `inputSchema`, result-envelope schema, `capabilities`, `timeoutMs`, `retryPolicy`, and `cancellation`.
- `timeoutMs` is required per tool; config/policy may override it; the model never can.
- Result envelope has `ok` vs `error` discriminator and an error reason/code on `error`.
- Invocation carries `runId`, `stepId`, and `callId`.
- Invocation produces exactly one terminal `ToolFinished` with status in `{succeeded | failed | timed_out | cancelled | denied}`.
- Executed tool emits `ToolExecuting` then exactly one `ToolFinished`.
- Denied or invalid-args case emits only terminal `ToolFinished`.
- Args validate against `inputSchema` before execution; invalid args fail with reason and tool is not executed.
- Every invocation passes through `canRun`; deny returns `denied` and tool is not executed.
- Timeout aborts and yields `timed_out`; signal abort yields `cancelled`.
- Each invocation appends JSONL audit event with `runId`, `stepId`, `callId`, `seq`, `ts`, and `status`.
- Model boundary maps to Anthropic `tool_use` / `tool_result`, keyed by `callId`.
- `retryPolicy` is declared per tool.
- A completed call-record dedupes by `callId` and returns stored result without re-executing.
- A crashed `started` call-record is not blindly re-run: idempotent/retryable may re-run; `never-retry` is surfaced as indeterminate.

## Constraints
- Anthropic `tool_use` / `tool_result` only at model boundary (B9).
- `inputSchema` is canonical JSON Schema; Zod is implementation detail emitted to JSON Schema (S5).
- Use Epic 002 workspace/file lock; no v1 per-tool concurrency field.
- Reuse Epic 007 `canRun`, Epic 002 jsonl append, and Epic 004 event emission.
- Call-record store is file-based and keyed by `callId`, with `started -> {completed | failed}`.
- `started` marker is created with atomic create (`O_EXCL` or equivalent from Epic 002).
- Exactly-once is not promised; guarantee is at-most-once for non-idempotent tools and deduped at-least-once for idempotent ones.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 009-SPIKE - pi-agent-core tool surface

**Input:** `.agent/plan/findings/09-pi-agent-core-tool-surface.md`.

**Action - RED:** none - spike.

**Action - GREEN:** Read `pi-agent-core@0.80.2` source to confirm tool invocation, transient-error retry semantics, and whether Core can intercept/suppress retry per `retryPolicy`.

**Action - REFACTOR:** none.

**Verify:** Findings file records tool invocation and retry semantics.

### Task 009-RED - Tool pipeline tests

**Input:** `packages/core/src/**/*.test.ts` or the tool package test home.

**Action - RED:** Add `node:test` coverage for every terminal status, exactly-one `ToolFinished`, event order, invalid args, `canRun` deny, timeout, signal cancel, JSONL audit append, `tool_result` keyed by `callId`, completed-call dedupe, crashed-started non-idempotent indeterminate, and idempotent re-run behavior per spike.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because the tool pipeline is missing.

### Task 009-GREEN - Tool pipeline implementation

**Input:** `packages/core/src/**` or the tool package source home.

**Action - RED:** none - opened by Task `009-RED`.

**Action - GREEN:** Implement the v1 tool declaration and invocation pipeline, audit append, model-boundary mapping, retry policy handling, and idempotency records.

**Action - REFACTOR:** Keep model-boundary mapping separate from daemon-first execution records.

**Verify:** `npm run typecheck && npm test` exits 0.
