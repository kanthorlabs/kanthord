# Story 08 — the locked browser Proof

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md`
Depends on: Stories 01–07.

## Change

- Edit no file. Run the tracked executable `scripts/e2e/ui-inbox-proof.sh:48-225`
  unchanged.
- Do not edit assertions, selectors, seed data, the fixture recipe, the browser
  helper, the cleanup, or the final success line. Fix any failure only in the
  Story 01–07 UI owner.
- The script must build the production UI, use an isolated temporary SQLite
  database, create a project, a bare local git remote and a repository resource,
  register a provider whose key is never read, import `make-landing-graph.sh`, run
  `run daemon --until-idle` with a no-op `KANTHORD_FAKE_AGENT`, assert straight
  from SQLite that the root task really reached `failed` **before** any UI
  assertion, serve the build on an ephemeral loopback port, run browser phases
  C–G, terminate the daemon, remove its temporary directory, and leave no process
  running.

### Phase → story map

| phase | asserts                                                                    | owner    |
| ----- | -------------------------------------------------------------------------- | -------- |
| A     | `build:ui` exists and builds; Chromium present                             | EPIC 026 |
| B     | the fixture reaches a real `failed` task                                   | fixture  |
| B2    | the daemon serves the build; `/api/queue` really has an item               | EPIC 026 |
| C     | one row per item; `kindLabel`/`projectName`/`downstream`; no per-row fetch | 02       |
| D     | the order statement, free of `impact` and `priority`                       | 02       |
| E     | `inbox-pane`, one `verdict` per API verdict, verbatim command              | 03       |
| F     | `conflict-gone` on a real `409 no_conflict_candidate`, no `async-error`    | 05       |
| G     | no page request carried an `Authorization` header                          | 01       |
|       | `#/inbox` and the conflict hash resolve as cold deep links                 | 07       |

- If the run needs a selector or a behaviour no story specifies, that is a
  planning defect: raise an `OPEN:` blocker. Do not invent it, and do not edit the
  script to route around it.

### Sibling proofs must stay green

Run each unchanged; none may be edited:
`scripts/e2e/ui-shell-proof.sh`, `scripts/e2e/ui-system-proof.sh`,
`scripts/e2e/ui-collections-proof.sh`, `scripts/e2e/ui-entities-proof.sh`,
`scripts/e2e/ui-writes-proof.sh`, `scripts/e2e/ui-resources-proof.sh`,
`scripts/e2e/ui-graph-proof.sh`.

The one tripwire this epic moves is `scripts/e2e/ui-system-proof.sh:121-126`: `#/`
now lands on a real Inbox instead of a placeholder. Confirm it still passes with
exactly one `global-shell`, three nav links and zero console errors — do not edit
it.

## Constraints

- Do not edit `scripts/e2e/ui-inbox-proof.sh` or `scripts/e2e/ui-browser.mjs`.
- Do not install Chromium inside the Proof. If absent, preserve the exact
  `npx playwright install chromium` instruction and stop.
- Do not weaken a preceding story test to satisfy the browser run.
- Do not add a fixture that produces a conflicted candidate. The Proof states
  plainly that it does not render a real diff; that limit is disclosed, not fixed.

## Verify

- `scripts/e2e/ui-inbox-proof.sh` exits 0 and prints exactly one line beginning
  `026.7 ok:`. With the fixed fixture, that line reports the real failed task's
  `kindLabel` (`operational-failure`), its `downstream` count and its verdict
  count, rows carrying no per-row fetch, the order stated literally, and the
  conflict route honest about a 409.
- `git diff --stat scripts/e2e/ui-inbox-proof.sh scripts/e2e/ui-browser.mjs
scripts/e2e/ui-system-proof.sh` produces no output.
- The seven sibling proofs above each exit 0.
- `npm run verify` exits 0.
- Proof: phases A–G and the final `026.7 ok: …` marker in full.
