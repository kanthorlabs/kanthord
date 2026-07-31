# Story 08 — the locked browser Proof

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md`
Depends on: Stories 01–07.

## Change

- Edit no file. Run the tracked executable `scripts/e2e/ui-graph-proof.sh:49-277` unchanged.
- Do not edit assertions, selectors, seed data, expected counts, browser helper, cleanup, or the final success line. Fix any failure only in the Story 01–07 UI owner.
- The script must build the production UI, use an isolated temporary SQLite database, bind loopback on an ephemeral port, seed two objectives and three tasks, bind one repository resource into lane one's task context only, add the readiness configuration that makes `next.command` exactly `kanthord run daemon`, run browser phases C–H, terminate the daemon, remove its temporary directory, and leave no process running.

## Constraints

- Do not edit `scripts/e2e/ui-graph-proof.sh` or `scripts/e2e/ui-browser.mjs`.
- Do not install Chromium inside the Proof. If absent, preserve the exact `npx playwright install chromium` instruction and stop.
- Do not weaken a preceding story test to satisfy the browser run.

## Verify

- `scripts/e2e/ui-graph-proof.sh` exits 0 and prints exactly one line beginning `026.6 ok:`. With the fixed seed, that line reports 2 objective lanes with `proof-repo` resolved on one and no binding on the other, 3 positioned nodes, 2 edges, a real-task inspector, API critical path, 6 readiness checks with `next.command 'kanthord run daemon'` verbatim, and Plan unavailable.
- `npm run verify` exits 0.
- Proof: phases A–H and the final `026.6 ok: …` marker in full.
