# Story B — new candidate identity + `retry task --refresh`

Epic: `.agent/plan/epics/007.14-deterministic-candidate-transplant.md`
Same change unit as Story A.

## Change

- On the transplant success path, persist a **new** `ChangeCandidate`
  (`src/domain/landing.ts:42-61`, ULID id, `state:"pending"`) with new candidate
  SHA + new base SHA. Never mutate the old row — `getCandidateByTask`
  (`src/storage/sqlite/landing.ts:60-69`, `ORDER BY id DESC LIMIT 1`) returns the
  transplanted one; old row stays for audit.
- Extend `RetryTask.execute` input to `{ taskId, note?, rebuild?, refresh? }`
  (`src/app/task/retry-task.ts:69-73`). `refresh:true` → transplant-first
  (Story A), model-fallback. `rebuild` unchanged (always model). Plain `retry`
  unchanged.
- Add `--refresh` flag beside `--note`/`--rebuild`
  (`src/apps/cli/commands/retry/task.ts:12-17`); thread through `runRetryTask`
  (`src/apps/cli/task.ts:114-127`) into `execute`.
- `--refresh` never model-only; `--rebuild` never transplants. If both passed,
  prefer `--rebuild` (or reject) — pick one, test it.

## Constraints

- Logic in the use case; CLI only forwards flags.
- Old candidate row not deleted/overwritten.
- Model-fallback reuses the existing note / prior-feedback path (`getPriorFeedback`,
  `src/composition.ts`).

## Verify

- `node --test src/app/task/retry-task.test.ts`:
  - `refresh:true` + clean transplant + gate green → new candidate row (new id +
    new base SHA + new candidate SHA); old row still present.
  - `refresh:true` + conflict/gate-fail → model-fallback (no new transplanted
    candidate).
  - `rebuild:true` → always model, no transplant attempt.
- `node --test` retry CLI: `--refresh` → `refresh:true`; `--rebuild` →
  `rebuild:true`.
- `npm run verify` exits 0.
- Proof A interface (`retry task --id … --refresh`).
