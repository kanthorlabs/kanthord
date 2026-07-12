# Story 001 - loadRepoSlot accepts a remote-URL repo

Epic: `.agent/plan/epics/019.10-slot-remote-url.md`

## Goal

`loadRepoSlot` accepts a slot whose `repo` is a remote URL (https / ssh / `.git`)
by validating the URL shape and skipping the local git-work-tree check, since the
daemon self-clones it (Epic 019.8). A local-path `repo` keeps the existing
git-work-tree validation.

## Acceptance Criteria

- A slot yaml whose `repo` is a remote URL (e.g.
  `https://github.com/owner/name.git`) loads successfully — no `git rev-parse`
  against the URL, no `SlotRegistrationError` — returning the parsed slot with the
  URL `repo`.
- A slot yaml whose `repo` is a local path is still validated as a git work tree
  (existing behavior): a non-git local path still throws `SlotRegistrationError`.
- A malformed `repo` that is neither a valid URL nor an existing local git work
  tree still fails with a typed error.

## Constraints

- **URL detection is by shape** — treat `repo` as remote when it matches a URL /
  scp-like git remote (`https://`, `http://`, `ssh://`, `git@host:...`, or a
  trailing `.git` on a host path); everything else is a local path validated as
  today. No network call is made to a URL repo in `loadRepoSlot`.
- **No change to the returned `RepoSlot` shape** — only the validation branch
  differs.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — URL-slot + local-path-slot tests
  pass; guard green.

### Task T1 - accept remote-URL repo in loadRepoSlot

**Input:** `src/slots/repo-slot.ts`, `src/slots/repo-slot.test.ts`

**Action - RED:** add a hermetic test: `loadRepoSlot` on a yaml with `repo:
https://github.com/kanthorlabs/kanthord-verify.git` resolves successfully with
`slot.repo` equal to that URL and **without** invoking the injected `runGit`
(assert the git seam is not called for a URL repo). Keep/confirm the existing
local-path cases: a valid local git work tree still passes; a non-git local path
still throws `SlotRegistrationError`.

**Action - GREEN:** in `repo-slot.ts`, before the `git rev-parse` check, detect a
remote-URL `repo` by shape and, when remote, skip the work-tree check and return
the slot; keep the local-path branch unchanged.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/slots/repo-slot.test.ts` green.
