# Story 2 — A4: wire `--note <text>` into the `retry task` command

Epic: `.agent/plan/epics/007.8-approve-persists-candidate-state.md`

## Goal

The conflict guidance `approve` prints tells the user to run
`retry task --id <id> --note "<guideline>"`, and the recovery use case already
accepts a note — `RetryTask.execute({ taskId, note })` persists it so it surfaces
on `get task --json` and feeds the rebuild prompt. But the commander command
`retry task` (`src/apps/cli/commands/retry/task.ts`) declares only `--id`, so the
advertised command fails with `unknown option '--note'`. The handler
`runRetryTask` (`src/apps/cli/task.ts:114`) _already_ reads `args["note"]` and
passes it through — the gap is purely the missing option on the command. This
story adds it.

## Contract (tests assert this)

- `buildRetryTaskCommand` (`src/apps/cli/commands/retry/task.ts`) gains
  `.option("--note <text>", "guidance note for the retried task")` and passes it
  into the handler call: `runRetryTask({ id: opts.id, note: opts.note }, …)`.
- `retry task --id X --note "g"` parses without error, and `RetryTask.execute`
  receives `{ taskId: "X", note: "g" }`.
- `retry task --id X` (no `--note`) still works and passes `note: undefined`
  (regression guard — `runRetryTask` already maps a missing/`non-string` note to
  `undefined`).
- End-to-end on a `state='conflict'` candidate: after
  `retry task --id X --note "g"`, the task returns to `pending` and the note
  surfaces on `get task --json` (`{"note":"g"}`).

## Constraints

- Surgical: only `src/apps/cli/commands/retry/task.ts` changes (add the option +
  thread it through). Do **not** modify `runRetryTask` (it already handles
  `note`) or `RetryTask` (the use case already accepts and persists it).
- Update the command's `addHelpText` example to show `--note` so help and the
  conflict message agree.
- Apps stay thin: no note validation/formatting in the command beyond passing the
  string through (AGENTS.md apps rule).

## Verification Gate

- A CLI command-tree test (drive the **built** command, not just the handler —
  debate S2): parse `retry task --id t1 --note "hi"` and assert the injected
  `RetryTask` fake received `{ taskId: "t1", note: "hi" }`; parse
  `retry task --id t1` and assert `note` is `undefined`. A handler-only test on
  `runRetryTask` would pass while the CLI command stayed broken, so the test
  MUST go through `buildRetryTaskCommand` (mirror the existing
  `src/apps/cli/*.test.ts` command-tree style).
- `npm run verify` exits 0.
- Contributes the `retry … --note` step + the `get task --json` note assertion
  the epic's end-to-end `Proof:` exercises.
