# Story 08 — the Proof prints `026.3 ok: …`

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` — Verification Gate
Depends on: Stories 01–07.

## Change

`scripts/e2e/ui-entities-proof.sh` **already exists on this tree** and is
executable (`-rwxr-xr-x`, 10648 bytes). This story ships **no new assertion**.

### 1. Run the Proof and fix the product, never the Proof

```bash
scripts/e2e/ui-entities-proof.sh
```

It must print, on the last line:

```
026.3 ok: nested entity URLs cold-load with real breadcrumbs, tabs carry honest empty states, downstream=<N> rendered exactly, scope mismatch and missing stay distinct, no write issued
```

**No assertion in that file may be edited, relaxed, deleted or commented out.**
Every failure is a product defect in Stories 01–07. The phase→story map:

| phase | assertion                                                                                                                                                 | story                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A     | `build:ui` exists, `ui/dist/index.html` builds, Chromium present                                                                                          | EPIC 026 / environment |
| B     | seeds a project, initiative, two objectives, two tasks, a repository, a credential through the real API                                                   | —                      |
| C     | breadcrumb names the real project and initiative; header names the initiative; Objectives tab lists the objective; Dependencies tab is not an empty shell | 02, 03                 |
| D     | breadcrumb names the objective; Tasks tab lists both tasks; Integration tab is not an empty shell                                                         | 02, 04                 |
| E     | five tabs; `empty-result`; `empty-landing`; Dependencies names the blocker id; `task-downstream` equals the API's count                                   | 05                     |
| F     | wrong-objective task → `scope-mismatch` and zero `async-missing`; made-up task id → `async-missing` and zero `scope-mismatch`                             | 01                     |
| G     | resource header names the repository; the credential secret is nowhere in the document                                                                    | 07                     |
| H     | no request carried `Authorization`; no POST, PATCH or DELETE; zero console errors outside phase F's deliberate 404                                        | every story            |

Three failure modes this tree makes likely — fix them in the owning story's
files, not here:

- `text(selector)` **throws** when nothing matches (index.md F16), so a missing
  element surfaces as a Playwright timeout, not a clean message. Read the phase
  header in the traceback to find which selector.
- `consoleErrors.length === 0` is asserted after every page (`:177`). A React
  `key` warning on any table or tab list fails phase G even when the DOM is
  correct — every `.map` in Stories 03–07 needs a stable `key`.
- The proof clicks a tab by its label text
  (`page.locator('[data-testid="entity-tabs"] [role="tab"]', { hasText: label })`
  at `:122-125`) with the labels `Objectives`, `Dependencies`, `Tasks`,
  `Integration`, `Result`, `Landing`. A renamed label is an unfindable tab.
  `Instructions & AC` is never clicked, but `Dependencies` must not become a
  substring collision with another tab label on the same page.

### 2. Sibling proofs must stay green (index.md F18)

Run all three and report each exit code:

```bash
scripts/e2e/ui-shell-proof.sh
scripts/e2e/ui-system-proof.sh
scripts/e2e/ui-collections-proof.sh
```

This epic touches no Overview, no collection page and no shell, so all three must
pass unchanged. The specific tripwires to confirm, not to edit:

- `ui-collections-proof.sh:116` — exactly 2 rows in `project-table`.
- `ui-collections-proof.sh:127,130,162-179` — exactly 2 initiative cards and the
  polling count rise.
- `ui-collections-proof.sh:140-142` — the strict vertical order
  `overview-initiative-card` < `overview-decisions` < `overview-digest`.
- `ui-collections-proof.sh:146,153-158` — exactly 4 resource tabs, the branch
  column count, and `#/project/<id>/resource/not-a-type` still rendering
  `async-missing`. Story 01's new `/project/:projectId/resource/:type/:resourceId`
  pattern must not shadow `/project/:id/resource/:type`; if it does, the fix is in
  `ui/src/app/routes.tsx`, not in the proof.
- `ui-system-proof.sh:146-147` — the `not-built-yet` placeholder naming an epic.
  EPIC 026.2 Story 07 was supposed to move this assertion off the Overview leaf
  and did not, so it failed. Fixed 2026-08-01 in a maintainer session: it now
  loads the Graph leaf and expects `026.6`. Still **not** a file this story may
  edit.

### 3. Gates

```bash
npm run verify
```

Must exit 0. It runs `typecheck`, `test`, `verify:handoff`, `lint`,
`ui:typecheck`, `ui:lint`, `ui:test`, `build:ui` and `db status`
(`package.json:28`).

## Constraints

- **No edit to `scripts/e2e/ui-entities-proof.sh`.** If an assertion looks wrong,
  raise an `OPEN:` blocker; do not weaken it.
- No edit to `ui-shell-proof.sh`, `ui-system-proof.sh` or
  `ui-collections-proof.sh` — they belong to EPIC 026, 026.1 and 026.2.

**Amendment, 2026-08-01 (Ulrich), after the 026.3 review.** Two edits were needed
and are now sanctioned. Both were made in a maintainer session, not by `/work`;
the "no edit" rule above stands for every other case.

1. `ui-entities-proof.sh` reads tab panels through `activeText()` and waits
   through `waitVisible()`, both now owned by `scripts/e2e/ui-browser.mjs`
   (index.md F16). This was forced by F13 being factually wrong: the base script
   read the first, hidden, empty panel and could never pass. The helpers live in
   the harness so the proof script stays assertion-only.
2. Phase H keeps `consoleErrors.length === 0`, but phase F first removes the
   console errors of its own deliberate absent-entity load and asserts they are
   404s and nothing else. Reason: the browser logs that 404 whatever the app
   does. No other page gets any carve-out, and the earlier blanket
   `!includes("404")` filter — which would have hidden a real error whose text
   mentions 404 — is removed.
3. `ui-system-proof.sh:146-147` was re-pointed from the Overview leaf (built by
   EPIC 026.2, so its `not-built-yet` assertion was stale and failing) to the
   Graph leaf, owned by EPIC 026.6. That is a 026.2 regression fixed in the
   maintainer session, not by this story.

- No edit to `package.json` (lane-forbidden; every script the Proof needs already
  exists — index.md F1).
- No new dependency. `playwright@1.62.0` is already pinned
  (`package.json:43`); Chromium is installed once outside the Proof with
  `npx playwright install chromium`, which the Proof itself prints when it is
  missing (`ui-entities-proof.sh:50-55`).
- Nothing may be left running: the Proof's own `trap cleanup EXIT` kills the
  daemon and removes its temp dir. If a run leaves a `node src/main.ts serve`
  behind, that is a defect in the product's shutdown path — report it.

## Verify

- `scripts/e2e/ui-entities-proof.sh` exits 0 and its final line starts with
  `026.3 ok:`, with no assertion in the file modified beyond the two amendments
  above.
- `scripts/e2e/ui-shell-proof.sh`, `scripts/e2e/ui-system-proof.sh` and
  `scripts/e2e/ui-collections-proof.sh` each exit 0; only `ui-system-proof.sh`
  is modified, by amendment 3 above.
- `npm run verify` exits 0.
- Proof: the whole `Proof:` block of the epic — phases A through H.
