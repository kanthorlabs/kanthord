# Story 6 — Docs + small surface fixes

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`

Three unrelated small items. Keep them in one commit; they share no code.

## Change

### A — `--note` on `retry objective`

`src/apps/cli/objective.ts:105-117` (`runRetryObjective`) reads only `args["id"]`
and calls `retryObjective.execute({ objectiveId: id })`. Add an optional
`--note <text>`:

- Read `args["note"]`; when it is a non-empty string, pass it through as
  `execute({ objectiveId: id, note })`.
- `src/app/objective/retry-objective.ts` — accept the optional `note` and set it
  on **every** task it re-queues, using the same field `Task.note`
  (`src/domain/task.ts:24`) that `retry task` already writes. Do not invent a
  separate objective-level note field.
- Register the `--note` option in the `retry objective` entry of the CLI command
  table in `src/apps/cli/index.ts` so `--help` lists it.

### B — correct the `list event --json` help text

The `--json` option's description currently says "print events as newline-delimited
JSON", but the command emits a single `{"events":[…],"nextCursor":"…"}` object.
Fix the **text only** — the envelope is the better contract and must not change.
Find the string with
`grep -rn "newline-delimited" src/apps/cli/` and replace it with:
`print the events page as a single JSON object: {"events":[…],"nextCursor":"…"}`.

### C — fix three `/e2e` skill-doc drifts

In the `e2e` skill document (locate with
`grep -rln "e2e-status.sh" ~/.claude/skills .claude/skills 2>/dev/null`):

1. `retry objective --id [--note "…"]` — after item A above this becomes correct,
   so leave it and instead verify it matches the shipped flags.
2. The gotcha "`list event` … caps at ~100 rows without `--limit`" is wrong: the
   default page is **5** rows, followed by a
   `more available — pass --after <cursor>` sentinel line. Correct the number and
   name the sentinel.
3. The setup step claims the OAuth account lands in `~/.kanthord/accounts.json`
   (provider `openai-codex`). It does not: `login provider` creates a **credential
   row in the kanthord DB** and prints its id; no `accounts.json` is ever written.
   Rewrite the step to say so, and keep the note that this store is isolated from
   any company github-copilot pi CLI.

## Constraints

- Do **not** change the `list event --json` output shape (epic non-goal).
- `--note` must reuse `Task.note`; no new column, no migration.
- Item C edits a skill document only — no `src/` changes from it.

## Verify

- `node --test src/apps/cli/objective.test.ts` — `retry objective --id X --note "guidance"`
  exits 0 and the fake `RetryObjective` receives `{objectiveId: "X", note: "guidance"}`;
  omitting `--note` passes no `note` key.
- `node --test src/app/objective/retry-objective.test.ts` — when a note is given,
  every re-queued task's `note` equals it; when absent, task `note` is unchanged.
- `node --test src/apps/cli/index.test.ts` — `retry objective --help` output
  contains `--note`.
- `node --test src/apps/cli/events.test.ts` — assert the `--json` help string
  contains `nextCursor` and does **not** contain `newline-delimited`.
- `grep -c "accounts.json" <skill-doc>` returns 0 occurrences that claim the file
  is written by `login provider`.
- `npm run verify` exits 0.
- Proof: delivers Proof line 4's precondition only indirectly; no dedicated Proof
  line. Item A is exercised by the epic's `reject objective --help` check.
