# Deferred refactors — the ledger for EPIC 026.16

Opened 2026-07-31 by Ulrich. This replaces the stale `AGENTS.local.md` line that
sent refactors to EPIC 026.9; 026.9 is candidate review.

**This file is a ledger, not an epic.** AGENTS.md binds every epic to a
program-level `Proof:` command, and a bucket with unknown content cannot have
one. Findings accumulate here while the 026.x family runs. **EPIC 026.16 is
authored from this ledger when the family finishes**, and it is authored the
normal way: a Goal, a real Proof over the entries that survive, and stories.

## How to add an entry

An agent that finds a refactor or code change during a 026.x epic — one that is
real but outside that epic's scope — appends an entry here instead of doing it.
It does not silently widen its own epic, and it does not silently drop the
finding.

```
### <short title>
- Found: <epic> — <date>
- Where: <file:line>
- What: <one sentence: the change, not the story behind it>
- Why deferred: <why it did not belong to the finding epic>
- Blocking: <what breaks or stays awkward until it is done, or "nothing">
```

## Entries

### Radix Tabs force-mounts hidden tabpanels

- Found: EPIC 026.3 — 2026-07-31
- Where: `index.md` F13, Story 01 §7 Verify, EPIC `[data-testid="tab-panel"]` row
- What: Radix `Tabs` force-mounts the hidden `role="tabpanel"` element and unmounts only its children; `count('[data-testid="tab-panel"]')` equals the tab count, not 1.
- Why deferred: requires EPIC/Story text amendment (B2 from 026.3 review); proof-script helpers (`activePanelText`, `waitForEntity`) need extraction to `ui-browser.mjs`
- Blocking: every "exactly one panel in the DOM" claim in 026.3's stories and EPIC table is wrong
- **Resolved 2026-08-01 (maintainer session).** F13, Story 01 §7, the EPIC selector table and Story 08 are corrected; `waitVisible()` and `activeText()` now live in `scripts/e2e/ui-browser.mjs` and the proof script calls them. Nothing left for 026.16.

### `ui/src/lib/api-client.ts` gained dead exports

- Found: EPIC 026.3 — 2026-07-31
- Where: `ui/src/lib/api-client.ts:162-226`
- What: `fetchInitiatives`, `fetchInitiative`, `fetchObjectives`, `fetchObjective`, `fetchTask` are now used by entity-chain.ts (B7 landed), but `apiGet` is still the only `fetch` caller. No dead exports remain after B7.
- Why deferred: resolved by B7 — no action needed unless the helpers become unused again
- Blocking: nothing

### `ui-system-proof.sh`'s `026.2` `not-built-yet` phase is stale

- Found: EPIC 026.3 — 2026-07-31
- Where: `scripts/e2e/ui-system-proof.sh:146-147`
- What: the proof waits for `[data-testid="not-built-yet"]` naming `026.2`, but 026.2 delivered those pages; no `ROUTE_TABLE` entry carries `epic: "026.2"` at the base either.
- Why deferred: belongs to a 026.2 follow-up or maintainer session, not 026.3 (lane forbids it)
- Blocking: `ui-system-proof.sh` exits 1
- **Resolved 2026-08-01 (maintainer session).** Phase D now loads the Graph leaf and expects `026.6`, which still has no page. Proof exits 0. Nothing left for 026.16.

### `:id` vs `:projectId` param split

- Found: EPIC 026.3 — 2026-07-31
- Where: `ui/src/app/routes.tsx` (`ProjectRoute` uses `:id`, entity routes use `:projectId`)
- What: two different param names for the same concept; both resolve safely because the branches are separate
- Why deferred: recorded in `index.md` F11 for EPIC 026.9
- Blocking: nothing

### `ui-system-proof.sh` placeholder retag `026.2` → `026.6`

- Found: EPIC 026.4 — 2026-08-01
- Where: `scripts/e2e/ui-system-proof.sh:146-147`
- What: the proof waits for `[data-testid="not-built-yet"]` naming `026.2`, but EPIC 026.2 delivered those pages; Graph leaf is owned by `026.6` and has no page yet.
- Why deferred: Story 08 declares the proof scripts read-only; this retag belongs to the proof-script maintainers.
- Blocking: `ui-system-proof.sh` exits 1 at the placeholder phase.

### `ui-entities-proof.sh` Radix Tabs `activePanelText` / `waitForEntity`

- Found: EPIC 026.4 — 2026-08-01
- Where: `scripts/e2e/ui-entities-proof.sh` — `[data-testid="tab-panel"]` reads and entity-header waits
- What: Radix Tabs force-mounts hidden `role="tabpanel"` elements; `text()` reads the first (hidden, empty) match. Entity header is visible only after the chain hook resolves. The proof needs `activeText()` (polls the visible panel until content stabilizes) and `waitVisible()` (waits for `entity-header` / `task-downstream` / `scope-mismatch` / `async-missing`). Also: absent-task load generates a browser-emitted 404 console error; carve out the 404 from `consoleErrors` before the zero assertion.
- Why deferred: the helpers `activeText()` and `waitVisible()` were added to `ui-browser.mjs` but the proof script itself must adopt them; Story 08 declares proofs read-only.
- Blocking: `ui-entities-proof.sh` exits 1 on Radix Tabs reads and entity-header timing.

### `ui-browser.mjs` driver capability gap: `waitVisible`/`activeText`/`serviceWorkers:block`

- Found: EPIC 026.4 — 2026-08-01
- Where: `scripts/e2e/ui-browser.mjs`
- What: The main proof (`ui-writes-proof.sh`) needs `waitVisible` and `activeText` helpers to handle React 19 + Playwright timing issues where `networkidle` resolves before `invalidateFor`'s async refetch lands. Also needs `serviceWorkers: "block"` to prevent the service worker from caching stale API responses. These were added to `ui-browser.mjs` but Story 08 declares it read-only.
- Why deferred: The driver changes are necessary for the main proof to pass but are out-of-scope for 026.4. They should be added deliberately with their own story in a maintainer session.
- Blocking: `ui-writes-proof.sh` exits 1 without the `waitVisible` waits.
