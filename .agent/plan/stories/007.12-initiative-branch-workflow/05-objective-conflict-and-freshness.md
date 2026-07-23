# Story E — objective integration conflict + freshness

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
Depends on: Story C (broker), Story D (`conflict` state).

## Change

Handle an objective Story C routed to `conflict` (parent moved / CAS mismatch /
non-linear fetch).

- **Resolve in the isolated clone.** The daemon hands the agent the current
  initiative tip + the objective's work + conflict context, in the Story A clone
  (no origin). Agent rebases the objective's changes onto the moved tip and
  resolves conflicts. Reuse the existing agent-run + workspace machinery.
- **Re-squash to one commit** on `kanthord/init/<initId>`, parented on the
  **current** tip. Re-record the new objective-commit OID + new parent OID.
- **Re-run the full verification gate** (the same gate the objective's tasks used)
  in the clone. Pass → objective back to `awaiting_confirmation`. Fail → stays
  `conflict` with the reason recorded; never auto-integrate.
- **Re-broker on human approve.** A fresh `approve objective` (Story C) fetches
  the new OID, validates one-commit-after-current-parent, CAS `update-ref`
  against the moved parent.
- **Freshness:** before surfacing `awaiting_confirmation`, if the initiative
  base/tip moved under it, go to `conflict` instead of presenting a stale
  approval.
- Cross-initiative conflicts are out of scope (surface at PR time).

## Constraints

- Resolution in the disposable clone; daemon performs all home writes (Story C).
- Reuse Story D `conflict → awaiting_confirmation` + Story C broker; no second
  integration path.
- No auto re-broker without the human `approve objective`.

## Verify

- `node --test` (bare home + clone):
  - advance the tip under a squashed objective → `conflict`; resolution → one
    commit onto the new tip, gate passes, state → `awaiting_confirmation`.
  - fresh `approve objective` integrates it (home +1 commit, CAS against moved
    parent succeeds).
  - resolution with a failing gate → not integrated, stays `conflict`/failed with
    a recorded reason.
- `npm run verify` exits 0.
- Must not regress Proof C / C2 (linear history).
