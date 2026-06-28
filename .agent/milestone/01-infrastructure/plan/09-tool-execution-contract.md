# 09 Tool Execution Contract (v1 subset)

Goal:             A daemon-first tool contract: every tool declares a fixed field
                  set, and every invocation runs the validate → `canRun` →
                  execute-with-timeout/abort → exactly-one-`ToolFinished` →
                  append-only-event pipeline.

Decision anchors: B9 (tool contract + the explicit v1 subset), §6 Tool Execution
                  Contract, S5 (Zod for tool input schemas, not RPC), D4/B3
                  (`canRun` gate), N1 (locks), D3 (pi-agent-core retries → why
                  `retryPolicy` exists).

ACs (the v1 subset only — `streaming`, `maxOutputBytes`, artifacts, `auditPolicy`,
per-tool `concurrency` are deferred):
- Every tool declares: `name`, `version`, `inputSchema` (canonical **JSON
  Schema**), a **result-envelope** schema, `capabilities`, `timeoutMs`,
  `retryPolicy`, `cancellation`.
- **`timeoutMs` is a required per-tool field** (each tool sets its own); config/
  policy may override it; the **model never can**. No global default/ceiling is
  invented (B9 fixes none).
- The **result-envelope** has a minimal contract: an `ok` vs `error` discriminator,
  and on `error` an error **reason/code** field; the payload itself may be loose
  (per B9 "payload may be loose"). So a `failed` result carries a cause, not just
  a status.
- An invocation carries `runId` / `stepId` / `callId` and produces **exactly one**
  terminal `ToolFinished` with status in **`{ succeeded | failed | timed_out |
  cancelled | denied }`**.
- **Event order:** an executed tool emits `ToolExecuting` then exactly one
  `ToolFinished`. A **denied** (`canRun`) or **invalid-args** (`failed`) case
  emits **only** the terminal `ToolFinished` — no `ToolExecuting`, because it never
  executed.
- Args are validated against `inputSchema` **before execution**; invalid args →
  `failed` (with an envelope reason), tool not executed.
- **Every invocation passes through `canRun`** (epic 07); deny → `denied`, tool
  not executed. (Chokepoint coverage is proven here.)
- `timeoutMs` exceeded → aborted → `timed_out`; signal-abort → `cancelled`.
- Each invocation appends a JSONL audit event (`runId`/`stepId`/`callId`/`seq`/
  `ts`/`status`) to append-only history.
- At the **model boundary** the contract maps to Anthropic `tool_use` /
  `tool_result`, keyed by `callId`.
- **`retryPolicy` is declared per tool** (retryable / idempotent / never-retry).
  Its *enforceability* against pi-agent-core's transient retries is **determined
  by the spike** (see below) — the brief does not assert a re-run is preventable
  until the spike confirms Core controls the invocation point.
- **Durable idempotency (in v1).** A side-effecting call carries `callId` as a
  **durable idempotency key**. Before execution the call-record is checked: a
  `completed` record **returns the stored result without re-executing** (dedup); a
  `started` record left by a crashed run is **not blindly re-run** — an
  idempotent/retryable tool may re-run, a `never-retry` tool is reported as
  **indeterminate** (surfaced, not silently repeated). This covers BOTH transient
  retry and epic-06 crash-replay.

Constraints:
- Daemon-first contract; Anthropic `tool_use`/`tool_result` only at the **model
  boundary** (B9). Build the **v1 subset only**; defer `streaming`,
  `maxOutputBytes`, artifacts, `auditPolicy`/output-redaction, and per-tool
  `concurrency` (B9). Because `auditPolicy` is deferred, sensitive-output
  redaction in the jsonl audit is **not** in scope here.
- `inputSchema` is canonical **JSON Schema**; Zod is an impl detail emitted as JSON
  Schema (S5 — never Zod on RPC wire messages).
- **Locking:** with per-tool `concurrency` out of v1, a tool uses only the
  **existing epic-02 workspace/file lock** (N1) — no per-tool lock-class field is
  introduced.
- Reuse epic-07 `canRun`, epic-02 jsonl append, epic-04 event emission. No second
  persistence/event path. Cancellation uses an `AbortSignal` (the running-job abort
  epic 06 deferred lands here).

Idempotency mechanism (file-based — Ulrich's decision: in v1):
- A durable **call-record store keyed by `callId`** records `started →
  {completed | failed}`. The `started` marker is created with **`O_EXCL`** (epic-02
  atomic create) — it is both the **execution lease** (only one executor per key)
  and a **write-ahead intent**: write `started` before the side effect, write
  `completed` (with the result envelope) after.
- The `callId` is **persisted with the job** (epic 06) so a reclaimed replay reuses
  the same key. On restart, an orphan `started` record is resolved by the tool's
  `retryPolicy`: idempotent → re-run; non-idempotent → mark indeterminate +
  surface (never silently repeated).
- **Honest limit:** exactly-once is impossible without a transactional side effect
  (crash between effect and `completed` is indeterminate). Guaranteed contract:
  **at-most-once for non-idempotent tools**, **dedup'd at-least-once for
  idempotent ones**. This resolves the epic-06 crash-replay gap.

Spike?:           YES — `pi-agent-core@0.80.2` real surface (authoring rules 3+4):
                  confirm **how it invokes tools** and **its transient-error retry
                  semantics**, and crucially **whether Core can intercept/suppress
                  a retry** (enforced `retryPolicy`) or whether it is advisory. The
                  retry ACs above are contingent on this result. Read the pinned
                  dep's actual source.

Verification:     `node:test` in a throwaway temp dir (never `.data/`): each
                  terminal status path; exactly-one `ToolFinished`; event order
                  (executed = ToolExecuting+ToolFinished; denied/invalid = terminal
                  only); invalid args → failed-with-reason, not executed; `canRun`
                  deny → denied, not executed; timeout → timed_out; signal →
                  cancelled; jsonl event appended; `tool_result` keyed by `callId`.
                  The retry-enforcement test is written to the spike's confirmed
                  behavior (enforced vs advisory), not assumed. **Idempotency:** a
                  `completed` call-record dedupes (no re-exec, returns the stored
                  result); a simulated crash leaving a `started` record → a
                  non-idempotent tool is surfaced as indeterminate (not re-run), an
                  idempotent tool re-runs. The recorded spike does NOT close the
                  task; the tests do (rule 8).

Dependencies:     01, 02 (jsonl events + workspace lock), 04 (event emission), 07
                  (`canRun`). Paired with 12 (pi-agent-core wiring uses this
                  contract + the retry findings) and 06 (crash-replay idempotency).

Findings out:     `.agent/milestone/01-infrastructure/plan/findings/09-pi-agent-core-tool-surface.md`
                  — pi-agent-core@0.80.2 tool-invocation + retry semantics and
                  whether retries are interceptable. Epic 12 needs it.
