# Story 007 - verify alignment (maintainer)

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

Maintainer story — touches lane-forbidden files (`scripts/`,
`package.json`); executed by the human + assistant directly, not through
/work.

### Task M1 - verify bundle realignment + `status` consumer sweep

**Requires:** S001-T5 (`status` removed, `db *` live).

**Input:** the EPIC 001 verify bundle (`npm run verify` /
`scripts/verify*`); repo-wide grep for `status` command consumers
(scripts, docs, README).

**Action:** grep for consumers of the old `status` command (debate
finding); update the verify bundle to run the EPIC 003 Proof block
(`db migrate` twice + `db status` on a temp `KANTHORD_DB`) and fix any
other consumer found. Also the fallback owner for a lint exemption if
S004-T2's test helper trips the import-boundary rule
(`*.test-helper.ts` joins the `*.test.ts` exemption class).

**Output:** `npm run verify` green on the new command surface; no
dangling `status` references.

**Verify:** `npm run verify` exit 0; grep for `main.ts status` (the old
invocation) finds nothing outside history/plan files.

### Task M2 - epic Proof run

**Requires:** all /work stories complete; M1.

**Action:** run the epic's exact Proof block on a fresh temp
`KANTHORD_DB`; confirm the first `db migrate` prints each applied
migration, the second prints `up to date`, and `db status` prints
`schema: 2`, `journal_mode: wal`, and a row count per table.

**Output:** the epic's Verification Gate is met (gates green + Proof
shown).

**Verify:** Proof output recorded in the epic discussion file; exit
codes 0.
