# EPIC 008 — tdd@1 executor · story index

Epic: `.agent/plan/epics/008-tdd-workflow.md`

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. One story per file, per `AGENTS.md`.

**Authoring status (D5, 2026-07-18 — EPIC 006 shipped):** the code seams the
gated stories build on have ALL landed (PiAgentRunner `pi.ts`, PiAgentProfile /
genericProfile, ProviderSession, FakeSessionFactory, `renderTaskPrompt`,
InstructionLoader, `verification.ts` + TaskResult/`task_results`, escalation
use cases `approve-task`/`reject-task`/`retry-task`/`recover-interrupted-tasks`,
progress events, workspace manager, ref-keyed `RegistryRunnerResolver`). All
rulings are closed (D-A/B/D, D1/D2, S1/S2, D-DEC1/2/3, D4). So **every story
below is now authorable** against the target `executor` naming.

**The ONE prerequisite — the `agent → executor` rename (NOT yet landed), OWNED
BY EPIC 008 (D5-DEC resolved 2026-07-18).** EPIC 007 explicitly declined it
("Executor rename owned by EPIC 008" — 007 epic lines 26–32; 007 story index
line 84), so no other process delivers it. The tree is still `Task.agent`
(`domain/task.ts`), migration column `agent`, `AgentCatalog`/
`UnknownAgentError`, `AgentRunner`/`AgentRunnerResolver`, `--agent` CLI flag.
This is 008's **story 0** (first executable slice): `Task.agent → Task.executor`

- migration column + `AgentCatalog → ExecutorCatalog`/`UnknownExecutorError` +
  `AgentRunner → Executor`/`ExecutorResolver`/`PiExecutor` + `--executor` flag +
  007's `store-graph` frontmatter key. All other stories AUTHOR against `executor`
  naming; their EXECUTION follows story 0.

Dispatch note: while other epics share the working tree, commit selectively; do
not branch (see the concurrent-agents rule).

## Stories (dependency order)

0. `agent → executor` rename (prerequisite; D5-DEC) — AUTHORABLE NOW, and the
   first slice to EXECUTE. Renames the landed EPIC 006 surfaces + 007's
   frontmatter key (see the prerequisite note above). Touches a migration
   column + CLI flag + wide tests → part maintainer; unblocks stories 2–14.
1. [Pure tdd@1 definition (domain)](01-pure-tdd-definition.md) —
   **AUTHORED** (pending nothing; `source` field added to `ReviewFinding`).
2. Shared agent-core reuse (`GenericExecutor`) — AUTHORABLE. Reframes the landed
   `PiAgentRunner` as `GenericExecutor` + extracts the shared pi core. Prereq:
   rename. Foundational (regression anchor: generic@1 tests unchanged).
3. Role profiles + role registry — AUTHORABLE. Adapted personas + tool-enforced
   boundaries; consumes InstructionLoader (landed).
4. RoleStepRunner port — AUTHORABLE. Needs #2 (shared core).
5. Step contracts — AUTHORABLE. Mutation policy + witness selection; needs the
   `ProjectCapacity`/lane model (now defined) + #4.
6. Engine-owned verification (`ProjectCapacity` resolution + witness) —
   AUTHORABLE. Reuses `verification.ts` (landed); GREEN re-runs the witness.
7. Runtime capacity + `RuntimeController` (per-witness lifecycle) — AUTHORABLE.
   NEW (D4). Global lease + dirty-marker reconciliation; hermetic via fakes.
8. Project onboarding (agentic loop) → `Project.capacity` — AUTHORABLE. NEW
   (D4). Reuses the generic coding agent; needs #6/#7 (capacity + runtime).
9. Lane enforcement (immutable-base tree compare) — AUTHORABLE. Needs #5 +
   workspace (landed).
10. In-code run + re-run on crash (no ledger) — AUTHORABLE. Executor loop +
    workspace reset-to-base (no migration).
11. `TddExecutor` + executor registration — AUTHORABLE. Ties #2–#10 together;
    registers `tdd@1` in the resolver. Prereq: `ExecutorCatalog` (rename).
12. Reviewer structured output (`submit_review`, cited `source`, enforced
    verdict) — AUTHORABLE. Profile tool surface (landed).
13. Events surface (`executor.step.*`) — AUTHORABLE. Reuses the event feed
    (landed); needs a new event-type migration.
14. End-to-end smoke + Proof runbook — LAST. Depends on everything above.

## Locked decisions for the READY story

- The pure definition emits terminals as DATA (`review-complete`,
  `review-cycles-exhausted`, `step-attempt-limit`) and never names parking,
  approval, or escalation — mapping terminals to the EPIC 006 human gate is
  the executor story's job (D-B/D-D now ruled). That separation is what makes
  early authoring safe.
- Bounds are debate-merged (S6): `maxReviewCycles` default 2,
  `maxStepAttempts` default 3, injectable config.
- Exact contract literals are locked in the story file (exact-entity-names
  rule); `TDD_STEP_KINDS` is append-only; `ReviewFinding` now carries `source`
  (S2 — cited requirements).
