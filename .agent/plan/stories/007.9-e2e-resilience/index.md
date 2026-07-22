# EPIC 007.9 — E2E resilience — stories

Epic: `.agent/plan/epics/007.9-e2e-resilience.md`
Findings + debate: `.agent/plan/epics/007.9-e2e-findings.md` (run `e2e-0079`),
debate hardening folded into the epic ("Debate deltas").

Three stories that make the daemon survive the two failure modes the
real-model E2E hit, plus a papercut bundle:

- **01 — Workspace-prep inspects the checkout root, not "inside a repo"
  (keystone for Proof A).** `src/workspace/local.ts` stops misreading an empty,
  pre-created checkout dir nested in another repo as "an existing repo with the
  wrong origin". A structured inspection (`root-checkout` | `enclosing-checkout`
  | `bare` | `not-a-repo` | `git-error`) drives clone-fresh / reuse / clear-error
  / re-throw. Delivers the epic's **Proof A**.
- **02 — Provider transient-retry at the execution loop (keystone for
  Proof B).** A transient provider failure no longer aborts a task. Adapters
  classify their errors and flag `transient` on the failed `TaskResult`;
  `RunNextTask` (`run-next-task.ts:123`) retries the whole run on a fresh
  workspace with bounded, jittered backoff, emits a `provider.retry` event per
  attempt, and fails with full history only on exhaustion. Delivers **Proof B**.
- **03 — Ergonomics + smoke bundle (minors).** `list
credential|ai-provider|repository`; consistent `create` output; `get conflict`
  shows target-vs-candidate hunks; `e2e-smoke-todo.sh` `realpath`s its argument.
  Independent papercuts, each with its own test.

Dependency order: **01, 02, 03 are independent** (disjoint files:
`src/workspace/` vs `src/app/task/` + adapters vs `src/apps/cli/` + `scripts/`).
Land in any order. The epic's `npm run verify` gate needs all three; **Proof A**
goes green after 01, **Proof B** after 02.

Retry boundary (settled by the seam, consistent with the debate): retry lives in
`RunNextTask`, not inside the pi adapter's session loop — because (a) it must be
exercised by `FakeRunner` for the hermetic Proof, and (b) a loop-level re-run of
`runner.run()` starts from a freshly-prepared workspace, which is the
proven-safe "whole-task retry from a clean state" boundary. No mid-session
resume is assumed. Story 02's investigation step only calibrates the attempt cap
(so we don't stack on top of any retry the Codex SDK already does).
