# Story 2 — S2: conflict overview surface (honest labels, version-bound)

Epic: `.agent/plan/epics/007.6-guided-conflict-resolution.md`

## Goal

After 007.5 the `approve` conflict line names `retry task --id <id>` and the
conflicting files (`src/apps/cli/task.ts:148`). But the user still cannot **see**
what clashes. This story adds a read-only overview — `kanthord get conflict --id
<task>` — that recomputes the conflict **on demand** from the retained candidate
OID + the current target and prints the files, the hunks, and **honest OID
labels**. "Honest" matters: it must say `target <branch>@<OID>` and `candidate
<taskId>@<OID>`, not "main after task X" — several commits may have moved the base,
so naming a single task as the target is false (debate S4). Nothing new is stored;
the overview is derived from S1's `preview` each time it is asked for.

## Contract (tests assert this)

- New query use case `src/app/task/get-conflict.ts` exporting `GetConflict` with
  one `execute({ taskId }): Promise<ConflictOverview>`. CQRS-lite query: it reads
  the retained landing candidate (`LandingRepository.getCandidateByTask(taskId)`,
  `src/storage/port.ts:173`), resolves the repository's current target OID, and
  calls `RepositoryLanding.preview(homeDir, candidate, targetOID)` (S1). It does
  **not** mutate and does **not** go through the domain (`AGENTS.md` query rule).
- `ConflictOverview` carries: `taskId`, `branch`, `targetOID`, `candidateOID`,
  and `files: { path: string; hunks: string }[]` (from the `preview` conflict
  outcome). It binds to and reports the **exact** `targetOID` + `candidateOID` it
  was computed against (debate S2 — version-bound).
- If the task has no retained `state === "conflict"` candidate (nothing to
  explain), `GetConflict` raises a typed error the CLI maps to a clear message +
  non-zero exit (not a stack trace).
- CLI: a new `get conflict` subcommand — `buildGetConflictCommand(deps, io)` in
  `src/apps/cli/commands/get/conflict.ts`, registered in
  `src/apps/cli/commands/get.ts` beside `buildGetTaskCommand`. `--id <id>` is
  required. It prints, in a sanitized human block:
  - each conflicting file path (e.g. `src/todo.mjs`),
  - the `<<<<<<<`/`>>>>>>>` hunk text for each file,
  - the honest labels `target <branch>@<targetOID>` and `candidate
<taskId>@<candidateOID>`,
  - the target OID it computed against (so the Proof `grep -q "$BEFORE"` passes).
- Enrich the 007.5 `approve` conflict line (`src/apps/cli/task.ts:138-148`
  `outcome.kind === "conflict"` branch): keep naming the files + `retry task --id`,
  and additionally point at `get conflict --id <id>` (to inspect) and the
  `retry task --id <id> --note "<guideline>"` hint (S3). Still one sanitized
  block, exit code **0** (a conflict stays an expected, recoverable outcome).

## Constraints

- Recompute-on-demand: `get conflict` stores nothing. It reads the candidate row
  007.4/007.5 already persist and re-derives the overview via `preview`. Do NOT
  add a durable overview column/table.
- Formatting lives in the CLI adapter only; `GetConflict` returns structured data,
  no ANSI/prose (AGENTS.md apps rule).
- Sanitized: no raw stack, no absolute temp/workspace paths beyond the
  repo-relative conflicting files (match the 007.5 S1 sanitization bar).
- Honest labels are load-bearing — do NOT reintroduce a "main after task X" style
  label. The branch name + short OID is the truth.
- Surgical: touch the new use case, the new CLI subcommand, its registration, and
  the approve conflict formatter. Do not alter `approved`/`landing_failed` lines.

## Verification Gate

- `node --test src/app/task/get-conflict.test.ts` (hermetic — fake
  `LandingRepository` + fake `RepositoryLanding` whose `preview` returns a
  `conflict` outcome): `execute({ taskId })` returns a `ConflictOverview` naming
  the file(s), carrying non-empty hunks, and the `targetOID`/`candidateOID` it was
  computed against; a task with no conflict candidate → typed error.
- `node --test src/apps/cli/task.test.ts` (or the get-conflict CLI test file):
  - `get conflict --id <task>` → exit 0; stdout contains the file path,
    `<<<<<<<`, `target <branch>@`, `candidate <taskId>@`, and the target OID.
  - The `approve` conflict outcome line now contains `get conflict --id` and
    `--note`; still exit 0; still no stack-trace substring.
- `npm run typecheck` 0; `npm run lint` clean.
