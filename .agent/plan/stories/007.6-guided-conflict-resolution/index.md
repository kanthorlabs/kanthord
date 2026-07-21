# EPIC 007.6 — guided conflict resolution — stories

Epic: `.agent/plan/epics/007.6-guided-conflict-resolution.md`
Evidence + debate: folded into the epic (Appendix A/B, two read-only debates).

Five stories that turn the approve/land path from a **dirty mutating merge** into
a **predict → explain → guide → rebuild-clean** loop: predict the conflict with a
pure in-memory `merge-tree` preview against a pinned target OID, explain it with an
on-demand honest-labelled overview, let the user guide the fix with a free-text
note, and rebuild the task on a clean base with a **marker-free** structured
context so the agent never edits `<<<<<<<`/`>>>>>>>` markers.

- **01 — Landing conflict preview (`merge-tree`, pinned, returns merged tree).**
  Add a read-only `RepositoryLanding.preview(candidate, targetOID)` to
  `GitRepositoryLanding` returning `fast-forward | mergeable | conflict`; assert
  refs/HEAD/index/worktree unchanged (debate B1).
- **02 — Conflict overview surface (honest labels, version-bound).** A `GetConflict`
  query + `get conflict --id <task>` CLI recompute the overview on demand from the
  retained candidate OID + current target; print files, hunks, honest OID labels,
  and the OIDs computed against. Enrich the 007.5 `approve` conflict line.
- **03 — Guided note + marker-free agent context + snapshot.** `retry task --note
<text>` persists the note; generalize `getPriorRejection → getPriorFeedback`
  ({ note?, conflictContext?, priorSummary? }) injecting a **marker-free** conflict
  context; durably snapshot `{candidateOID, targetOID, conflictContext}` on the
  recovery attempt (debate B3/B4/B5/S1).
- **04 — Predict-before-mutate + land-the-previewed-tree via atomic CAS.**
  `ApproveTask` previews (pinned OID); conflict → typed `conflict`, zero mutation;
  clean → land the **previewed tree** via `update-ref … <expectedOld=targetOID>`;
  branch moved → bounded re-preview then typed `target_moved` (debate B6/B7).
- **05 — Recovery candidate re-enters the gate.** The clean-base rebuild's
  candidate is previewed before it can land — no blind land of the recovery output.

## Dependency order

```
S1 (preview port)  ─┬─▶  S2 (overview reads preview)
                    ├─▶  S4 (ApproveTask previews + lands the tree)
                    └─▶  S3 (guided note + context)  ──▶  S5 (recovery re-enters S4 gate)
```

S1 is foundational (both S2 and S4 call `preview`). Land S1 first, then S2/S4 in
either order, then S3, then S5 (S5 asserts the S3 rebuild flows through the S4
gate). Each story is one `/work` Task unit; the epic's `## Verification Gate`
S1–S5 items are the binding acceptance tests, one per story.
