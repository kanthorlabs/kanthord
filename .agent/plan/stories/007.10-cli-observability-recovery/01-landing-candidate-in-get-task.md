# Story A — landing-candidate visibility in `get task` (F1)

Epic: `.agent/plan/epics/007.10-cli-observability-recovery.md`

## Goal

`GetTaskOutput` (`src/app/task/get-task.ts:17-31`) returns
`id,title,status,agent,objectiveId,dependencies,note?,instructions?,ac?,
verification?,result,dependencyStatus?,context?` — **no** candidate/landing
field. `get-task` never touches the landing repo. So from the CLI alone you
cannot tell whether a `completed` task's candidate landed, or whether an
`awaiting_confirmation` candidate is built on a stale base. In run `e2e-0710`
the whole approve/retry loop was navigable only via the `e2e-status.sh` helper,
which reads `landing_candidates` directly.

This story adds a nullable `landingCandidate` projection to `get task`, in
**both** the human-readable and `--json` output, via the read-only query path.

## Contract (tests assert this)

Add to `GetTaskOutput` (`src/app/task/get-task.ts`):

```
landingCandidate: {
  state: "pending" | "landed" | "conflict";   // required
  baseSHA: string;
  candidateSHA: string;
  target: string;
} | null
```

- `null` when the task has no candidate row.
- Source the row from the landing read path. `SqliteLandingRepository.
getCandidateByTask(taskId)` already returns the latest candidate
  (`src/storage/sqlite/landing.ts:60-69`, `ORDER BY id DESC LIMIT 1`) with
  `state`, `baseSHA`, `candidateSHA`, `target` (`rowToCandidate` :72-83).
  Inject the landing read source into `GetTask` (new constructor dep, a
  read-only query port — CQRS-lite permits the one-row join) and map its result
  into the four named fields. Do **not** widen the source to expose the `ref`
  or repo internals — only the four fields.
- **Do not** add landing fields to the `Task` domain entity (`src/domain/
task.ts`) — this is a read-model projection only.

CLI (`src/apps/cli/task.ts` `runGetTask` :241-320, command `src/apps/cli/
commands/get/task.ts`):

- `--json`: `landingCandidate` appears in the serialized object (it is already
  `JSON.stringify(output)`, so once the field is on `GetTaskOutput` it flows
  through — assert it is present and correctly shaped, `null` when absent).
- Human default block (:295-316): when `landingCandidate` is non-null, print a
  line the Proof can grep, e.g. `landing candidate: <state> (<baseSHA>-><candidateSHA>) -> <target>`.
  Print nothing extra when it is `null`. Do not disturb the `--result` block.

## Constraints

- Surgical: add one read dependency + one output field + one human-output line.
  Do not change `dependencyStatus`, `result`, `context` assembly, or the
  `--result`/`--json` mutual-exclusion guard (:250-256).
- Read-only: no new write, no domain mutation, no change to the landing repo's
  write methods.

## Verification Gate

- `node --test src/app/task/get-task.test.ts` — extend with a fake landing
  read source:
  - task with a `pending` candidate → `landingCandidate` has
    `{state:"pending", baseSHA, candidateSHA, target}` (strings), reflected in
    `--json`.
  - task with a `landed` candidate → `state==="landed"`.
  - task with **no** candidate row → `landingCandidate === null`.
- `node --test` on the CLI formatter (`src/apps/cli/task.test.ts` or the
  existing get-task CLI test): human output shows the candidate line when
  present and omits it when `null`; `--json` round-trips the field.
- `npm run verify` exits 0.
- Delivers the epic's **Proof A / A2** (`get task --json` shows
  `landingCandidate{state=pending,baseSHA,candidateSHA,target}`; human output
  shows the candidate state).
