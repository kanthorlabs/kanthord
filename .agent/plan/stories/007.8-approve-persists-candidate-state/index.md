# EPIC 007.8 — conflict-recovery loop works end-to-end via `approve` — stories

Epic: `.agent/plan/epics/007.8-approve-persists-candidate-state.md`
Findings + debate: folded into the epic (Appendix A, post-007.7 real-model E2E).

Two stories that together make the guided conflict-recovery loop reachable
through documented commands (no DB surgery):

- **01 — `ApproveTask` persists candidate lifecycle state (keystone / A1).** The
  `approve` preview/CAS path writes the `landing_candidates.state` it currently
  never touches: `conflict` on a genuine conflict (atomic with the `task.conflict`
  event) and `landed` on a successful land (inside the existing completion
  transaction). Nothing on CAS-mismatch / `target_moved`. This alone unblocks
  `get conflict` and `retry`, which already gate on `state='conflict'`.
- **02 — wire `--note <text>` into the `retry task` command (A4).** The commander
  command exposes `--note` and passes it to `runRetryTask`, which already accepts
  it. Removes the `unknown option '--note'` error the conflict message triggers.

Dependency order: 01 and 02 are independent (different files: `src/app/task/`
vs `src/apps/cli/commands/retry/`). Land in either order. The epic's end-to-end
`Proof:` needs **both** (it recovers a conflict via `retry … --note` and asserts
the durable `conflict`/`landed` states), so it goes green only after both land.
