# Story 9 — the discard path: no destruction without the dry run's digest

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Story 7 (the two rejection route rows exist with their decode).

`RejectTask` already carries the impact guard — `dryRun` early return
(`reject-task.ts:197-201`), pre-transaction `expectImpact` check (`:202-206`)
and an in-transaction re-check (`:211-219`). `RejectObjective` has the same
(`:145-152`, `:162-172`). Nothing enforces that a caller **used** it.

## Change

### 1. One precondition inserted into `task.rejection.create`'s `run`

Story 7 already landed the guard, the `execute` call and the return shape. This
story inserts the block below **between** the guard and the `execute` call, and
changes nothing else in the row:

```ts
run: async (deps, input) => {
  deps.assertDecisionOpen.execute({
    decisionId: input.decisionId,
    subject: { type: "task", id: input.taskId },
  });
  // ↓ the only lines this story adds
  if (
    input.resolution === "discard" &&
    input.dryRun !== true &&
    input.expectImpact === undefined
  ) {
    throw new HttpFailure(
      TRANSPORT_ERRORS.precondition_required.status,
      TRANSPORT_ERRORS.precondition_required.code,
      "a discard requires expectImpact from a dryRun response",
    );
  }
  // ↑ the only lines this story adds; the rest of the row is Story 7's.
  …
},
```

Pinned rules:

- The precondition applies to **`discard` only**. A `retry` rejection is
  recoverable and takes no digest — `RejectTask` ignores `expectImpact` for
  `retry` (`reject-task.ts:176-185`, `:197`).
- `428 precondition_required` is reused unchanged from
  `src/apps/http/error-registry.ts:139`; no new code and no new registry entry.
  It is the same status the PATCH path already uses for a missing `If-Match`
  (`app.ts:246-250`), and it means the same thing: the caller skipped a required
  precondition.
- The precondition is checked **after** the occurrence guard and **before** the
  use case, so a stale tab is refused for the more specific reason.
- A `dryRun: true` call writes nothing — that is `RejectTask`'s own early
  return, not something this row re-implements.

`HttpFailure` is imported from `src/apps/http/errors.ts` (already imported by
`error-registry.ts:33`).

### 2. The same insertion in `objective.rejection.create`'s `run`

Identical block, with the message unchanged. `RejectObjective` returns
`{ preview }` with no `skipped` (`reject-objective.ts:123`); Story 7's mapping
already supplies `skipped: []`.

### 3. Nothing else changes

No use case, no domain file, no CLI file. The CLI keeps its own
`--dry-run` / `--expect-impact` / `--yes` flags
(`src/apps/cli/commands/reject/task.ts:18-26`) and is not made to require the
digest: the operator at the terminal already sees the damage printed
(`src/apps/cli/task.ts:237-270`).

## Constraints

- Do not weaken the precondition to a warning, and do not default
  `expectImpact` to the freshly computed digest — that would make the guard a
  no-op and is exactly what epic decision 10 forbids.
- Do not add `expectedCommit` to the task rejection row (epic decision 9).
- Do not touch `RejectTask` or `RejectObjective`.

## Verify

- `node --test src/apps/http/routes.verdict.test.ts` — added to Story 7's file:
  - `POST /api/task/:id/rejection` with `resolution: "discard"` and **no**
    `expectImpact` and no `dryRun` answers `428`, code
    `precondition_required`, and **`rejectTask` was never called**;
  - the same body with `dryRun: true` answers `200`,
    `outcome === "previewed"`, and carries `preview.digest`;
  - the same body with `expectImpact: "<digest>"` answers `200` and
    `outcome === "rejected"`;
  - `resolution: "retry"` with no digest answers `200` — the precondition does
    not apply;
  - a `RejectTask` throwing `ImpactChangedError` answers `409 impact_changed`;
  - a `RejectTask` throwing `RejectionConflictError` answers
    `409 rejection_conflict`;
  - a `RejectTask` returning `undefined` still presents a body with
    `preview.digest === ""` and does not throw;
  - a closed occurrence answers `409 decision_closed` and the precondition is
    never reached (the `428` is not returned for a closed decision);
  - the same six axes for `POST /api/objective/:id/rejection`.
- `npm run verify` exits 0.
- Proof: phase F (`a discard with no impact digest is refused`, `subject 2 did
not move`, `the dry run answers 200`, `the dry run returns an impact digest`,
  `the dry run wrote nothing`, `the discard with the digest succeeds`,
  `subject 2 is really discarded`).
