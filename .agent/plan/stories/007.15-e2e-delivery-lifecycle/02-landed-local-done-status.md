# Story B — `landed` local-done status; remove `awaiting_pr`/`delivered`

Epic: `.agent/plan/epics/007.15-e2e-delivery-lifecycle.md`

Collapse the initiative lifecycle to `building → landed`. `landed` = local work
done (all objectives integrated), reached automatically at integration with an
`initiative.landed` event. `awaiting_pr` and `delivered` are removed entirely
(defined-but-undriven); a future `pr@1` agent will define its own states.

## Change

1. **Domain statuses + transitions.** `src/domain/initiative.ts`:
   - `INITIATIVE_STATUSES` (lines 4-8): replace `"awaiting_pr"` and `"delivered"`
     with `"landed"`. Final set: `["building", "landed"]`.
   - `LEGAL_INITIATIVE_TRANSITIONS` (lines 58-61): replace the two entries
     `"building->awaiting_pr"` and `"awaiting_pr->delivered"` with the single
     entry `"building->landed"`.
   - Do not change the `transitionInitiative` body.

2. **Event types.** `src/domain/event.ts` (`EVENT_TYPES`, lines 3-28): remove
   `"initiative.awaiting_pr"` (line 25) and `"initiative.delivered"` (line 26);
   add `"initiative.landed"`. (Story A adds `"repository.published"` to the same
   array.)

3. **Integration transition + event.** `src/app/objective/approve-objective.ts`
   lines 100-111 — change `transitionInitiative(initiative, "awaiting_pr")` to
   `"landed"` and `newEvent("initiative.awaiting_pr", …)` to
   `newEvent("initiative.landed", { initiativeId: objective.initiativeId })`.

4. **Daemon post-integration check.** `src/app/task/run-daemon.ts:148` — change
   `initiative?.status === "awaiting_pr"` to `=== "landed"`. Update the comment
   at `run-daemon.ts:33` (mentions "awaiting PR (`awaiting_pr`)") to say
   `landed`. Keep the behavior identical otherwise.

5. **Migration — initiatives status CHECK.** Add a new migration to
   `src/storage/sqlite/migrations.ts` (append after version 16 — the highest
   today; use the next integer version, `007.15-*` name). Rebuild the
   `initiatives` table so `status` CHECK is
   `CHECK (status IN ('building','landed'))` — follow the events rebuild pattern
   (migration 16, lines 356-379: CREATE `initiatives_new` with the full current
   column set + new CHECK, `INSERT ... SELECT` all columns, `DROP`, `RENAME`).
   Preserve every existing `initiatives` column. Dev DBs are not expected to hold
   `awaiting_pr`/`delivered` rows; if any exist, the copy would fail the new
   CHECK — acceptable under local-dev (no backward-compat), but the migration may
   map any legacy `awaiting_pr` → `landed` in the `SELECT` to be safe.

6. **Migration — events type CHECK.** In the same new migration (or the next
   version), rebuild `events` exactly like migration 16 (lines 358-379), with the
   type CHECK list **dropping** `'initiative.awaiting_pr'` and
   `'initiative.delivered'` and **adding** `'initiative.landed'` and
   `'repository.published'` (Story A). Copy all columns
   (`id, type, taskId, payload, objectiveId, initiativeId`). Legacy rows of the
   dropped types are not expected in dev DBs.

## Constraints

- Remove `awaiting_pr`/`delivered` cleanly — no lingering references in
  `src/` (grep confirms only: `initiative.ts`, `event.ts`, `approve-objective.ts`,
  `run-daemon.ts`, `migrations.ts` in production).
- Surgical: only the integration branch of `approve-objective.ts` changes; the
  conflict path is untouched. `run-daemon.ts` behavior is identical apart from
  the status string.
- No backward-compat concerns (local dev only) — table-rebuild migration is fine.

## Verify

Update every test that references the removed states (grep found:
`src/app/objective/approve-objective.test.ts`, `src/events/sqlite.test.ts`,
`src/storage/sqlite/migrations.test.ts`, `src/domain/event.test.ts`,
`src/storage/sqlite/sqlite-initiative-repository.test.ts`,
`src/domain/initiative.test.ts`). Concretely:

- `src/domain/initiative.test.ts` — replace the `building -> awaiting_pr ->
delivered` test (lines 77-83) with `transitionInitiative(building, "landed")`
  → status `landed`; add `assert.throws` for `transitionInitiative(building,
"awaiting_pr")` and `(building, "delivered")` (both no longer valid statuses /
  transitions).
- `src/app/objective/approve-objective.test.ts` — the all-integrated assertion:
  saved initiative has `status: "landed"`; exactly one `initiative.landed` event
  appended; no `initiative.awaiting_pr`.
- `src/domain/event.test.ts`, `src/events/sqlite.test.ts` — swap any
  `initiative.awaiting_pr`/`initiative.delivered` fixtures for
  `initiative.landed` (and `repository.published` where relevant).
- `src/storage/sqlite/migrations.test.ts` — assert the new version applies on a
  fresh DB and that inserting `initiatives.status='landed'` and events of type
  `initiative.landed` / `repository.published` succeed, while `awaiting_pr` /
  `initiative.awaiting_pr` are now rejected by the CHECK.
- `src/storage/sqlite/sqlite-initiative-repository.test.ts` — swap any
  `awaiting_pr` status fixture for `landed`.
- `npm run verify` exits 0 (this is the guard that catches any missed reference).
- Proof: delivers EPIC Proof lines 1-3 (`get initiative` = `landed`, one
  `initiative.landed` event, zero `initiative.awaiting_pr`).

## Docs

Update `docs/git-workflow.md` to the `building → landed` model in the same
change (the doc has already been updated to describe it — keep it in sync if the
implementation diverges): the Initiative state machine (§4), the flowchart node
(§3, "All objectives integrated → initiative landed"), and the sequence notes in
§5 that say "initiative awaiting_pr".
