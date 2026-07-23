# Story C — broker: daemon-only home integration (`approve objective`)

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
Depends on: Story A, B, D.

## Change

Add `ApproveObjective` use case (`src/app/objective/approve-objective.ts`,
mirror `src/app/task/approve-task.ts`) — `execute({ objectiveId }):
Promise<ApproveObjectiveOutcome>`:

1. Objective must be `awaiting_confirmation` (Story D) else throw
   `ObjectiveNotAwaitingConfirmationError`. Already `integrated` → no-op success.
2. `git --git-dir=<home> fetch <clonePath> <objectiveCommitOID>` (clone path +
   OID from Story B). Objects only.
3. Validate one-commit-after-parent:
   `git --git-dir=<home> rev-list --count <recordedParentOID>..<objectiveCommitOID>`
   == 1, and the commit's first parent == `<recordedParentOID>`. Else objective →
   `conflict` (Story E). No force.
4. CAS-advance under the home lock:
   `git --git-dir=<home> update-ref refs/heads/kanthord/init/<initId>
<objectiveCommitOID> <recordedParentOID>`. CAS mismatch → typed error
   (reuse `LandingCASMismatchError` shape) → conflict path.
5. Record `integrated` (+ integrated OID); append `objective.integrated` event.

CLI `src/apps/cli/commands/approve/objective.ts` + register in the `approve`
group (`src/apps/cli/commands/approve.ts`): `--id <objId>` required; stderr
`objective integrated: <id>`; contract per `src/apps/cli/resource.ts:87-91`.
Add `approveObjective` to `CliDeps` (`src/apps/cli/deps.ts`).

## Constraints

- Broker runs in the daemon/use-case only; the clone has no origin, so the agent
  cannot do steps 2–4.
- Reuse git CAS from `src/landing/git.ts` behind a port — use case calls the
  port, never inline `git`.
- Leave `ApproveTask` intact; do not fold objective brokering into it.

## Verify

- `node --test src/app/objective/approve-objective.test.ts` (fake broker) +
  adapter test (real git bare home + clone):
  - clean one-commit objective → home branch advances by exactly one commit;
    objective → `integrated`; `objective.integrated` event appended.
  - stale parent (branch moved) → CAS mismatch → `conflict`, home not advanced.
  - > 1-commit fetch → validation fails → `conflict`, no CAS.
  - already-`integrated` → no-op success.
- `npm run verify` exits 0.
- Proof B / B2 / C / C2 (obj-A → 1 commit ahead + `integrated`; obj-B → 2 linear
  commits).
