# Story 10 — End-to-end smoke — consolidates the epic Proof

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

One hermetic end-to-end test drives the whole import/export flow through the
real CLI against real SQLite — the runnable **Proof** from the epic file — and
`npm run verify` stays green. This is the consolidation slice (S1): the earlier
stories each carried their own e2e assertion; this one proves the full wiring
in a single pass and locks it as a regression anchor.

## Scope

- No new production behavior. If this story needs a code change beyond the test
  harness, an earlier story is incomplete — route the fix back there.
- The test mirrors the epic Proof step-for-step under `set -euo pipefail`
  semantics (each command asserts; expected failures checked with `if ! …`).

## Coverage (every leg of the epic Proof)

1. **Create mode** — author a graph as markdown, `import graph --create
--project`; assert exactly 1 initiative / 2 objectives / 2 tasks via JSON;
   assert SRC files rewritten in place with ULID `id:` (id handoff, RS1/RS3).
2. **Export** — `export initiative --out`; assert the cosmetic tree +
   `.kanthord-export.json`; a created file carries its ULID; capture a task id.
3. **Apply (update)** — edit a task ac, `--apply`; assert `1 updated` +
   `4 unchanged` (all-node summary, B14/RS2); new ac present, old ac kept, no
   dup.
4. **Id-less create during apply** — add a new task file, `--apply` →
   `1 created`, file rewritten with a ULID; re-apply → `0 created` (durable
   idempotency, no dup — RS1).
5. **Reparent** — edit `objective:` ref, `--apply` → `1 updated`, task moves to
   the new objective (B18).
6. **Guarded delete-missing** — `--dry-run` reports `missing` and changes
   nothing; `--delete-missing < /dev/null` (non-interactive, no flag) prints the
   plan and deletes nothing; `--delete-missing --confirm-delete` → `1 deleted`,
   count drops (TB4).
7. **Conflict via sha256 CAS** — drift the DB from a separate export, re-apply
   the stale package → exits 1, cites the node + `drift` + `sourcePath`, DB
   unchanged (preflight rejection — RS4; real rollback is proven by Story 06's
   late-failure integration test).

## Verification Gate

- `npm run verify` green (typecheck + full test suite + verify:handoff + lint +
  db status).
- The epic **Proof** block runs clean end-to-end and prints `PROOF OK`.

### Task T1 — e2e smoke test (real CLI + real SQLite)

**Requires:** Stories 01–09 complete.

**Input:** new `src/apps/cli/graph-import-export.e2e.test.ts` (follows the
`e2e-smoke.test.ts` precedent — temp DB via `mktemp`, `node src/main.ts …`
through the real dispatch).

**Action — RED:** write the test covering the 7 legs above with real
assertions (exact JSON counts, `grep` on rewritten frontmatter, `1 updated` /
`4 unchanged` / `1 created` / `0 created` / `1 deleted` anchored counts,
non-zero exit + cited `sourcePath` on the stale apply). Fails until every
earlier story is wired.

**Action — GREEN:** no production code here — a red leg means an earlier story
is incomplete; fix it there, not in the test.

**Action — REFACTOR:** none.

**Output:** the epic Proof as a committed, hermetic regression test.

**Verify:** `node --test src/apps/cli/graph-import-export.e2e.test.ts` green;
`npm run verify` green.

### Task T2 — run the epic Proof by hand + record it

**Requires:** T1.

**Input:** the epic `## Verification Gate` Proof block.

**Action:** paste-run the Proof block against a fresh temp DB; confirm it prints
`PROOF OK`. If any command needs interpretation to pass, that is a Proof defect
— fix the Proof text in the epic (it must stay copy-paste-runnable, AGENTS.md).

**Output:** the epic's `Proof:` shown working — "done" per AGENTS.md
(gates green AND the Proof shown working).

**Verify:** the Proof block exits 0 and prints `PROOF OK`; `npm run verify`
green.
