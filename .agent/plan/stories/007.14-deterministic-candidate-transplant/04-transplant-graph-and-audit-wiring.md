# Story D — `make-transplant-graph.sh` + gate/audit wiring

Epic: `.agent/plan/epics/007.14-deterministic-candidate-transplant.md`
Land alongside Story A/B (the Proof needs it). Maintainer-lane.

## Change

**1. Event type.** Add `candidate.transplanted` to `EVENT_TYPES`
(`src/domain/event.ts:3-21`). Payload `Record<string,string>` (`:25-30`), e.g.
`{ oldCandidateSHA, newCandidateSHA, newBaseSHA }`. Round-trips through
`EventFeed.append` → `readAfter` → `list event` (`src/apps/cli/events.ts`).

**2. `scripts/e2e/make-transplant-graph.sh`.** Sibling tasks whose scripted
candidates edit **non-overlapping** regions of one file (top vs bottom of
`src/f.mjs`) plus one whose edit **overlaps** the first. Mirror
`scripts/e2e/make-landing-graph.sh` (layers on `make-todo-graph.sh`).

- Turns are served identically to every `.for()`
  (`src/agent-runner/fake-session.ts:62-75`). Solve per-sibling region edits with
  one of: a bash turn branching on env/cwd/task title; **or** extend the
  fake-agent runner to accept per-task turns (keyed by ref/title,
  backward-compatible with a plain array). Pick the smaller change; document it.
- Non-overlapping siblings must transplant cleanly; the third must conflict.
- Title siblings so the Proof selects by `/non-overlap/i` and `/overlap/i`.

## Constraints

- `scripts/` + event tuple are maintainer-lane; keep surgical.
- Don't break `make-landing-graph.sh` / `make-todo-graph.sh` or the current
  single-turns behavior.

## Verify

- `node --test src/events/*` + `src/apps/cli/events.test.ts`:
  `candidate.transplanted` round-trips (append → `readAfter` → `list event` human
  - `--json`).
- `bash scripts/e2e/make-transplant-graph.sh <tmp>` imports cleanly with a
  `.fake-agent.json`; siblings distinguishable by title and produce the intended
  region edits.
- `npm run verify` exits 0.
- Harness + event for Proof A/A2/A3/C.
