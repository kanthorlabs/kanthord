# Story B — No-provider resolution fails loudly

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: Story A (chain resolution in the daemon).

## Change

- **run-next-task** (`src/app/task/run-next-task.ts`): after computing `chain`
  (Story A), if `chain.length === 0`, do NOT call the runner. Instead fail the
  task in tx2 with a typed reason string exactly matching
  `no AI provider available for project <projectId>` (resolve `projectId` via the
  `providerChainFor` closure — pass it out, or add a sibling
  `projectIdFor(initiativeId)` opt). Emit `task.failed` with
  `payload.reason = "no AI provider available for project " + projectId` and
  `payload.reasonCode = "no_provider_available"`. Use the existing failure/tx2
  path (mirror `:390-395`); the daemon must not hang or throw.

## Constraints

- The message must contain the literal `no AI provider available for project`
  (the epic Proof greps for it).
- No workspace is prepared and no runner is invoked when the chain is empty —
  resolution failure precedes any I/O.

## Verify

- Extend `src/app/task/run-next-task.test.ts`: a fake `providerChainFor` returning
  `[]` → the task result is `{outcome:"failed", taskId}`, a `task.failed` event is
  emitted whose `payload.reason` contains `no AI provider available for project`
  and `payload.reasonCode === "no_provider_available"`, and the fake runner's
  `run` was **never** called.
- `npm run verify` exits 0.
- Proof (008.3 Proof block): delivers **PASS B-neg** (empty registry ⇒ task fails
  with the exact typed provider-resolution error).
