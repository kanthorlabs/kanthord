# Story F — delivery hook + ergonomics + Proof harness

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
Land the harness half (parts 4–5) **early** — every Proof line needs it. Parts
1–3 after Story C.

## Change

**1. Delivery hook.** When all of an initiative's objectives are `integrated`,
transition it to `awaiting_pr` (Story D) + append `initiative.awaiting_pr`.
Register a **deferred `pr@1` agent stub** (discoverable, not implemented — raise
clearly if invoked; push+PR is EPIC 007.13). Document the manual push+PR path in
`README.md` (`git push <remote> kanthord/init/<initId>`).

**2. `get initiative` / `get objective`.** Add read commands (none exist). Mirror
`GetTask` (`src/app/task/get-task.ts:29-44`) + `src/apps/cli/commands/get/task.ts`;
register in `src/apps/cli/commands/get.ts:19-22`.

- `GetInitiativeOutput`: `{ id, name, status, workspace }` (`workspace` = Story A
  clone path).
- `GetObjectiveOutput`: `{ id, name, status, integrations: [{ repository, state }] }`.
- Human + `--json`.

**3. Daemon summary.** `runDaemon` reports only escalated task count
(`src/apps/cli/daemon.ts:74-77`). Add lines for objectives `awaiting_confirmation`
and initiatives `awaiting_pr`.

**4. `objectiveIds` export.** Add ordered `objectiveIds: string[]` to the
`.kanthord-export.json` manifest (`src/apps/cli/import-graph.ts:442-460` and
`:263-267`; in-memory manifest in `src/app/graph/export-initiative.ts`). Keep
`refToId.objectives`.

**5. `scripts/e2e/make-initiative-graph.sh`.** 1 initiative, 2 objectives (obj-A
then obj-B), 2 sequential tasks each, bindings `source/provider/cred`, plus a
`.fake-agent.json`. Mirror `scripts/e2e/make-landing-graph.sh` (layers on
`make-todo-graph.sh`).

- Fake-agent turns are served identically to every `.for()` call
  (`src/agent-runner/fake-session.ts:62-75`) — **not** keyed per task. Script the
  bash turns so sequential tasks append in order (as `make-landing-graph.sh`
  does), not by per-task identity.

## Constraints

- `pr@1` is a stub — no push/remote here.
- `scripts/` + docs are maintainer-lane; keep each part surgical.
- Don't regress existing export consumers or `list event`.

## Verify

- `node --test` import-graph/export-initiative: manifest carries ordered
  `objectiveIds`; existing fields intact.
- `node --test` `get initiative` / `get objective`: shapes above, human +
  `--json`.
- `node --test src/apps/cli/daemon.test.ts`: summary reports objectives awaiting
  brokering + initiatives awaiting PR.
- `bash scripts/e2e/make-initiative-graph.sh <tmp>` imports cleanly (1 init / 2
  obj / 2 tasks each) with a working `.fake-agent.json`.
- `npm run verify` exits 0.
- Proof E; supplies `objectiveIds` + `make-initiative-graph.sh` for Proof A–D.
