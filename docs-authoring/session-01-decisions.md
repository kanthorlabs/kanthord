# Session 1 — decisions taken without review

Written 2026-09-07. Commit `3217b76`. Every item below was decided while Ulrich was away.
Each states the decision, the reason, and whether it is reversible.

## Publication

- **D1 — Nothing is published. The work is committed and not pushed.**
  Reason: `.github/workflows/pages.yml` deploys on a push to `main` for `docs/**`, so a push is the act
  of publication. The `kanthord` repository that serves the site is **public**, and
  `kanthord-engine` is **private**. Publishing means putting a profile of a private system on a public
  site, including the `main.ts` authorization defect (claim `C15`) and the external-execution trust
  model. The engine has no deployments yet, so the real risk is low, but the call is outward-facing.
  Reversible: yes — one push publishes; nothing yet is public.

- **D2 — The manifest and the drift check live outside `docs/`.**
  `docs-authoring/manifest.yaml` and `scripts/docs/check.sh`, not `docs/`.
  Reason: `docs/` is uploaded verbatim with `.nojekyll`, so anything inside it is served. The manifest
  holds working state, provenance and open questions, which must not be published.
  Reversible: yes, but do not — publishing the manifest publishes the open questions.

## Git

- **D3 — The commit used `KANTHORD_SKIP_SUBMODULE_PUSH=1`.**
  Reason: the pre-commit hook refused the commit because a **pre-existing staged `apps` pointer**
  (`502de95`) is not on `origin/main`. That pointer was staged before this session and is unrelated to
  this work. The commit carries no gitlink at all, so the hook's stated concern — naming a commit
  nobody can fetch — cannot apply to it. Explicit pathspecs kept both submodules out of the commit,
  and that was verified after the fact.
  Reversible: not applicable; no state was changed by skipping.

- **D4 — The engine submodule pointer was not bumped.**
  Three different commits are in play: the parent repository records `c4b5256`, the engine working tree
  is at `c17e718`, and the index holds a staged gitlink at `f66ab9c`. Reconciling them is a
  publishing decision with submodule-push consequences, so it was left alone.
  Reversible: yes. `make docs-check` reports the drift on every run.

- **D5 — The verification anchor is `c17e718`, the checked-out engine.**
  Reason: that is the tree the exploration actually read. The manifest records both `engine-pinned`
  (`c17e718`) and `engine-pointer` (`c4b5256`) and names the parent-recorded gitlink as authoritative
  for publication, so the disagreement is visible rather than silently resolved.
  Reversible: yes — re-verify against whichever commit is chosen.

## Content and structure

- **D6 — The overview owns exactly one system-context diagram.**
  The two-process split between daemon and CLI, the HTTP sequence, the state machine and the schema all
  stay with their own destinations. Reason: the one-owner rule. An overview that draws them becomes a
  second specification and guarantees drift.
  Reversible: yes.

- **D7 — The context diagram has no git-remote node.**
  Reason: at `c17e718` the daemon hands a harness no clone, no worktree and no branch, and reads no git
  ref when a harness reports. An arrow between the daemon and a git remote would assert an integration
  the code does not establish. The `051` epic family adds it; that belongs in an overlay, not here.
  Reversible: yes, once the verification path ships.

- **D8 — No tenth destination was created for the unbuilt internal execution path.**
  It will land as a bounded overlay inside `who-does-work.md`, under an explicit "not current
  behaviour" heading. Reason: a separate "future" page is the parallel future manual that the second
  debate round argued against. `capability-status.md` stayed a destination of its own rather than being
  folded into the reference, because the overlays it would summarise do not exist yet.
  Reversible: yes.

- **D9 — Status is annotated over three independent dimensions, not one three-value tier.**
  Observable implementation, planning provenance, design qualification — each stated only when it
  applies. Reason: a single tier conflated route existence, handler reachability, table existence,
  whether a production path writes it, and whether the schema still matches the execution model.
  `authoredEpics` membership in particular proves a planning range, not active implementation.
  Reversible: yes, but the rulebook and every page would need editing.

## Corrections applied to sub-agent output

- **D10 — Eight citations were repointed.** Claims cited the wrong file. Fixed: `C01` to
  `main.ts#L842` (the database path), `C02` split across `app.ts#L1` (Hono) and `convict.ts#L173` (the
  port default), `C10` to `auth.ts#L44` and `contract/actor.ts#L30`, `C11` to `contract/event.ts#L76`,
  `C12` to `run-authority.ts#L35` plus its three callers, `C13` to `attempt-accounting.ts#L71`, `C16`
  to `claim-node.ts#L409` and `report-outcome.ts`, and `C03` to both not-implemented services.

- **D11 — Claim `C12` was scoped down.** It said "every write against a claimed node" checks authority.
  `assertRunAuthority` has exactly three callers: renew, release and report. The claim now says so, and
  states that the claim itself opens the run and therefore runs no such check.

- **D12 — Claim `C11` is recorded as an absence claim** with its search scope stated, because no single
  file citation proves that no code path exists.

- **D13 — A fabricated example was removed from the rulebook.** `legend.md` illustrated the
  "conflicting" annotation with an invented disagreement that cited a real file. It now uses the real
  one — EPIC 053.1 and EPIC 050.1 naming different owners for the `judged_oid` pin — and the rulebook
  now forbids illustrating a rule with an invented fact.

- **D14 — Two mermaid rendering bugs were fixed.** `\n` does not break a line in a mermaid label, and
  the diagram contained literal `&lt;` entities. Both would have rendered as visible junk.

- **D15 — Two dependency surfaces were narrowed** from `engine/src/` to `engine/src/main.ts`. A
  whole-tree surface flags its claim on any engine change, which makes the drift report noise and
  guarantees a future session ignores it.

## Verified

The site was served locally and driven in a real browser. The overview renders, the mermaid diagram
produces a real SVG at 433x507, all sixteen claim anchors exist, headings carry stable ids, there is no
horizontal overflow and no error state. The deep link `?p=overview.md#C15` scrolls to the claim, which
proves the fragment is reserved for anchors. The path guard refuses `?p=../secret.md`. `make docs-check`
runs and reports only the genuine pointer drift; its other five categories pass.

Not verified: the light-theme palette (only dark was captured), and the viewer against a page holding a
deliberately broken mermaid fence.

## Noted, no action taken

- Two sub-agents reported statistics whose merged and set-aside counts did not add up to their stated
  catch totals. The substance of their reports was checked directly and is sound.
- `docs/index.html` offers the question "What services does the daemon start, and in what order?" and
  routes it to `system-map.md`. No verified fact about startup order was gathered. The coverage
  inventory for that page must either answer it or the question must go.

## Session 2 starts here

Run `make docs-check`. Answer the open questions in `docs-authoring/manifest.yaml`, starting with
publication (D1) and the pointer (D4). Then take the highest fact-readiness destination — `system-map`,
`identity-access`, `who-does-work` and `state-completion` are all `high` and their facts are already
gathered — and write one, updating the manifest in the same commit.
