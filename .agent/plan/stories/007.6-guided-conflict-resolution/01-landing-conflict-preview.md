# Story 1 — S1: landing conflict preview (`merge-tree`, pinned, returns merged tree)

Epic: `.agent/plan/epics/007.6-guided-conflict-resolution.md`

## Goal

Today `GitRepositoryLanding.land()` (`src/landing/git.ts`) discovers a conflict by
running a real `git merge` and then `git merge --abort` — it mutates the worktree
and index before rolling back. The epic's whole shape depends on **predicting**
the conflict without touching anything. `git` 2.48.1 gives us
`git merge-tree --write-tree <target> <candidate>`: a full 3-way merge **in
memory** that leaves refs, HEAD, index, and worktree unchanged, exits non-zero on
conflict (listing conflicting paths), and on success writes+prints the merged tree
OID. This story adds a read-only `preview` seam over that command. It is the
foundation both the overview (S2) and the predict-before-mutate land (S4) build on.

## Contract (tests assert this)

- The `RepositoryLanding` port (`src/landing/port.ts:48-50`) gains one method:
  `preview(homeDir: string, candidate: LandingCandidate, targetOID: string):
Promise<PreviewOutcome>`. `targetOID` is the **pinned** commit the preview runs
  against (the exact OID S4 will later compare-and-swap against) — never a branch
  name resolved twice.
- Define `PreviewOutcome` in `src/landing/port.ts`:
  - `{ kind: "fast-forward"; candidateOID: string }` — target OID is an ancestor
    of the candidate (a clean ff; no merge tree needed).
  - `{ kind: "mergeable"; treeOID: string }` — `merge-tree --write-tree` exited 0;
    `treeOID` is the concrete merged tree OID it printed (the exact tree S4 lands).
  - `{ kind: "conflict"; files: string[]; perFile: { path: string; hunks:
string }[] }` — `merge-tree` exited non-zero; `files` is the conflicting paths,
    `perFile[i].hunks` the non-empty `<<<<<<< / ======= / >>>>>>>` hunk text for
    that path (extracted from the conflicted blob in the printed result tree, per
    Appendix A — result tree `ebfe8fa`, `src/todo.mjs` lines 72–121).
- `GitRepositoryLanding.preview` implements it via `execFile("git", …)` (no shell,
  matching the existing adapter): `merge-base --is-ancestor` for the ff case, then
  `merge-tree --write-tree <targetOID> <candidate.candidateSHA>` for the rest.
  Fetch the candidate object into `homeDir` first if unreachable (mirror the
  existing `land()` fetch at `git.ts:109-113`), so `merge-tree` can resolve it.
- **Non-mutation is the core guarantee (debate B1):** across a `preview` call,
  `homeDir`'s refs (`git rev-parse <target>` / `git for-each-ref`), `HEAD`, index,
  and `git status --porcelain` are **unchanged**. NOT byte-identical — `merge-tree`
  legitimately writes blob/tree objects into the object DB; the guarantee is
  refs/HEAD/index/worktree unchanged, not an untouched `.git/objects`.

## Constraints

- `preview` is **read-only** wrt repo state: no `checkout`, no `merge`, no
  `update-ref`, no worktree write. If it needs the candidate object present, a
  bare `git fetch <workspace> <candidateSHA>` (object-DB only) is allowed — it does
  not touch refs/HEAD/index/worktree.
- Port purity: `src/landing/port.ts` defines the interface + result type only and
  imports no adapter (AGENTS.md ports rule). The adapter imports the port.
- Do NOT change `land()` in this story — S4 rewires the mutation path. S1 only
  **adds** `preview`; the existing `land()` tests stay green.
- Hunk extraction reads the conflicted blob from the **printed result tree** (e.g.
  `git cat-file -p <treeOID>:<path>` on the conflict-marked tree `merge-tree`
  writes) — do not re-run a mutating merge to get markers.
- Keep it small: one new method + one new result type; no new class, no god
  interface.

## Verification Gate

- `node --test src/landing/git.test.ts` (real git in a temp dir — the existing
  pattern in this file):
  - Build a bare-ish temp repo with a `main` at OID `T`; a candidate commit `C`
    that fast-forwards `T` → `preview(home, cand, T)` returns
    `{ kind: "fast-forward", candidateOID: C }`.
  - A candidate that cleanly merges (disjoint change) → `{ kind: "mergeable",
treeOID }` where `treeOID` is a real object (`git cat-file -t <treeOID>` ==
    `tree`).
  - Two commits that edit the same lines (Appendix A shape — same-line insert) →
    `{ kind: "conflict", files: ["…"], perFile }` with a **non-empty** `hunks`
    string containing `<<<<<<<` and `>>>>>>>` for the conflicting path.
  - **Non-mutation:** capture `rev-parse <target>`, `rev-parse HEAD`, and `status
--porcelain` before and after **each** preview call; assert all three
    unchanged (all three branches, including conflict).
- `node --test src/landing/port.test.ts` — a fake `RepositoryLanding` implementing
  `preview` type-checks against the port (the port contract compiles; the `merge`
  vs `mergeable` distinction is not conflated).
- `npm run typecheck` 0; `npm run lint` clean.
