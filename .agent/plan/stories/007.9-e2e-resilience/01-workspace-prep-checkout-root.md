# Story 1 — workspace-prep inspects the checkout ROOT, not "inside a repo"

Epic: `.agent/plan/epics/007.9-e2e-resilience.md`

## Goal

`src/workspace/local.ts` decides "the home checkout already exists" with
`pathExists(homePath)` (`:333`) and, when it exists, validates it with
`isGitRepo(homePath)` = `git rev-parse --git-dir` succeeds (`:127`, called
`:368`). But `--git-dir` succeeds from **any** directory nested inside a git
worktree — it resolves to the _enclosing_ repo. So an empty, pre-created
`homePath` nested inside another git repo takes the "home exists" branch,
`getRemoteUrl()` (`:148`, called `:376`) reads the **parent** repo's origin, and
prep throws `Home path <home> has origin <parent> but expected <remote>`
(`:383`). In run `e2e-0079` this blocked the whole initiative at task 1 with an
error that blames a wrong remote URL when the real state is "this dir is not its
own clone at all".

This story replaces the boolean `isGitRepo` with a structured inspection so prep
distinguishes the real cases and only clones when it is safe, errors clearly
otherwise, and never masks an operational git error.

## Contract (tests assert this)

Introduce one inspection function (e.g. `inspectCheckout(dir, env)`) returning a
discriminated result — **exactly these states**:

| State                | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `root-checkout`      | `dir` is the git worktree root (`realpath(show-toplevel)===realpath(dir)`) |
| `enclosing-checkout` | inside a worktree whose root is a **different** path (the bug case)        |
| `bare`               | a bare repository at `dir`                                                 |
| `not-a-repo`         | `dir` is not inside any worktree                                           |
| `git-error`          | git spawn/permission/bad-config failure (indeterminate)                    |

Prep (`prepare`, the `else` branch at `:366`) then behaves:

- **`not-a-repo` + confirmed-empty dir** → clone fresh into it. Clone must
  succeed with `homePath` already existing as an empty directory — either clone
  directly into the empty dir, or handle the temp-dir→`rename` case
  (`:334`–`:345`) so it does not fail because the target already exists. Do this
  **under the existing per-repo lock** (`:323`) — no check-then-rmdir-then-clone
  race.
- **`root-checkout` with matching origin** → reuse (existing fetch/CAS path,
  unchanged).
- **`root-checkout` with the WRONG origin** → hard error naming both URLs (keep
  today's message; it is correct _for this state_). Never silently re-clone.
- **`enclosing-checkout`** → hard error whose message names the real problem:
  `<home> is not a git checkout of <remote>; it is nested inside <toplevel>`.
- **`bare`** → hard error ("… is a bare repository").
- **`git-error`** → **re-throw / propagate as a `WorkspacePreparationError`
  that preserves the underlying git error** — must NOT be treated as
  `not-a-repo` and must NOT fall through to clone (no masking of operational
  failures).
- **Non-empty `not-a-repo`** (dir has any entry, **including hidden files** like
  `.DS_Store`) → hard error ("… exists and is not empty"); distinct message for
  a non-directory path. Never `rm` a non-empty dir.

Path handling:

- Use `lstat` (not `access`) to classify the path (absent / file / dir /
  symlink / broken-symlink) before any clone action — a broken symlink must not
  read as "absent".
- Compare roots via `realpath` on **both** sides so a `homePath` that is a
  symlink to the checkout root still resolves to `root-checkout` (state the
  symlink-acceptance policy in a comment).

## Constraints

- Surgical: this replaces the `isGitRepo`/`getRemoteUrl` gate and the
  clone-vs-reuse decision only. Do **not** touch the fetch/CAS/`canonicalSHA`
  logic (`:388`+), the lock, or the `promoteProposal` path.
- Keep `WorkspacePreparationError` as the thrown type for all error states.
- "Empty" = zero directory entries counting hidden files (`readdir` length 0).
- No dependency on running inside/outside another repo — the fix must be correct
  whether or not `homePath` is nested (the E2E default path _is_ nested).

## Verification Gate

- `node --test src/workspace/local.test.ts` — extend with cases driven against
  real temp dirs + a local bare "remote" (the suite already builds these):
  - **empty dir nested inside an outer repo** (reproduce the bug): prep clones
    fresh and returns a prepared workspace; assert **no** throw and the clone
    has the expected origin. (Guard: create an outer `git init` around the temp
    home to prove `--git-dir` would have resolved to it.)
  - `root-checkout` right origin → reuse (no re-clone).
  - `root-checkout` wrong origin → `WorkspacePreparationError` naming both URLs.
  - `enclosing-checkout` (non-empty, no `.git` of its own, inside outer repo) →
    error naming the real problem, not "wrong origin".
  - non-empty non-repo dir (incl. a lone hidden file) → "not empty" error; dir
    untouched.
  - `git-error` (e.g. injected failing `GIT_*` / unreadable) → error that
    preserves the git failure; **not** a clone attempt.
  - broken-symlink `homePath` → classified via `lstat`, not treated as absent.
- `npm run verify` exits 0.
- Delivers the epic's **Proof A** (empty nested checkout dir → built candidate,
  no wrong-origin failure).
