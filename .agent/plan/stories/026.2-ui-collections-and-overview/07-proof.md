# Story 07 — the Proof prints `026.2 ok: …`

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md`
Depends on: Stories 01–06.

## Change

- No change to `scripts/e2e/ui-collections-proof.sh`. It is already written
  (199 lines) and its assertions are binding. Run it and fix what it exposes in
  the files Stories 01–06 own.
- **One required edit to the previous epic's Proof.**
  `scripts/e2e/ui-system-proof.sh:138-147` asserts that the
  `#/project/<id>/overview` leaf still renders `[data-testid="not-built-yet"]`
  naming `026.2`. Story 04 builds that leaf, so the assertion is now false by
  design. Move it to a leaf that is still unbuilt: change line 138 to
  `await goto(\`#/project/${projectId}/graph\`);` and line 147 to expect the
epic the graph placeholder names (`026.6`). Change nothing else in that file
  — phase D must keep proving the cold load, the five ProjectShell nav items
  and the real project name in the breadcrumb.
- Apart from that one edit, the only files this story may touch are
  `src/app/project/list-projects.ts`, `src/app/resource/list-resources.ts` and
  `ui/src/**`, plus their tests. A defect that cannot be fixed there raises an
  `OPEN:` blocker instead of an edit to the 026.2 Proof.

Phase → owner, for triage:

| phase | asserts                                                                                                                      | owner         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A     | `build:ui` produces `ui/dist/index.html`; Chromium present                                                                   | EPIC 026      |
| B     | seeds project ×2, initiative ×2, objective, task ×2, repository, credential                                                  | the API       |
| C     | `#/project` lists 2 rows, search sends `?name=`, table narrows to 1                                                          | 01 + 03       |
| D     | 2 initiative cards, real names, `count-pending` = 2, decisions and digest present, in that order                             | 04            |
| E     | 4 tabs, cold-loaded credential grammar, branch column after the switch, reload keeps the tab, unknown type → `async-missing` | 06            |
| F     | a task created through the API raises the pending count with no interaction, 0 console errors                                | 05            |
| G     | no page request carried an `Authorization` header                                                                            | 026's R3 seam |

## Constraints

- The Proof is hermetic: `mktemp -d` database, `serve --port 0`, browser via
  `scripts/e2e/ui-browser.mjs`, everything killed on exit. Do not add network
  access, a model call, or a fixed port.
- Do not weaken an assertion, do not add a `sleep` to mask a race, and do not
  raise the 35 s polling timeout at line 179 — it is already two
  `POLL_INTERVAL_MS` intervals.

## Verify

- `scripts/e2e/ui-collections-proof.sh` exits 0 and prints
  `026.2 ok: projects listed + server-side search, Overview composition in
order, four typed resource tabs deep-linked, polling raised a task count with
no interaction`.
- `git diff --stat scripts/e2e/ui-collections-proof.sh` is empty.
- `npm run verify` exits 0.
- Regression: `scripts/e2e/ui-system-proof.sh` prints `026.1 ok: …` after the
  two-line phase-D move above, and `git diff scripts/e2e/ui-system-proof.sh`
  shows those two lines and nothing else. `scripts/e2e/ui-shell-proof.sh` still
  passes, untouched.
- Proof: every `PASS` phase A–G above.
