# Story 08 — the Proof

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (Verification Gate)
Depends on: Stories 01–07.

`scripts/e2e/ui-writes-proof.sh` is **complete and binding**. It already drives
phases A, B, C, C2, D, E, F and D2, including the objective and task created
through the UI and the API verification of all three. **This story edits no
assertion, renames no selector, adds no timeout and relaxes nothing.** It makes
the existing script pass.

Measured on the current tree (2026-07-31): phases A and B pass; the run exits `1`
in phase C at `[data-testid="create-initiative"]`.

## Change

Only what the run itself proves is missing, and only in `ui/**`:

- Run the script. Take the first failure. Fix it in the story-01–07 surface that
  owns that selector or behaviour. Repeat until the script prints
  `026.4 ok: …`.
- Every selector the script drives is already specified by a story:
  `create-initiative*` and `create-objective*` (story 05), `create-task` and
  `task-title` / `create-task-submit` (story 06), `rename-open` / `rename-form` /
  `rename-input` / `rename-submit` (story 04), `conflict*` (story 02),
  `dependency-add` / `dependency-option[data-task-id]` / `dependency-error`
  (story 07), `entity-tabs [role="tab"]`, `project-table` and `breadcrumb`
  (026.2 / 026.3).
- If the run needs a selector or behaviour **no story specifies**, that is a
  planning defect: raise an `OPEN:` blocker. Do not invent it, and do not edit
  the script to route around it.

## Constraints

- `scripts/e2e/ui-writes-proof.sh` and `scripts/e2e/ui-browser.mjs` are read-only
  for this story.
- The script's audits stay satisfied by design, not by adjustment: **exactly two**
  PATCHes to `/api/project/<id>` across the whole run (no retry, no second write
  path), **zero** console errors, and **zero** page-issued `Authorization`
  headers.
- No new package.

## Verify

- `bash scripts/e2e/ui-writes-proof.sh` exits 0 and prints the
  `026.4 ok: initiative, objective and task built through the UI …` line. The
  banners `A`, `B`, `C2` and `D2` all appear.
- `git diff --stat scripts/e2e/` shows **no change** to
  `ui-writes-proof.sh` or `ui-browser.mjs`.
- The four sibling UI proofs still exit 0, unedited (index F17):
  `ui-shell-proof.sh`, `ui-system-proof.sh`, `ui-collections-proof.sh`,
  `ui-entities-proof.sh`.
- `npm run verify` exits 0.

Proof: the whole of `scripts/e2e/ui-writes-proof.sh` — this story is the epic's
`Proof:` line.
