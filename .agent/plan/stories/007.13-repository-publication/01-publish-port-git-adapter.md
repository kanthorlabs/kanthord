# Story A — publish port + git adapter (fast-forward push)

Epic: `.agent/plan/epics/007.13-repository-publication.md`

## Change

New capability `src/publication/` (mirror `src/landing/`):

- **`src/publication/port.ts`** — `interface RepositoryPublisher`:
  ```
  publish(input: {
    homeDir: string; branch: string; remoteUrl: string;
    auth: RepositoryAuth;               // src/domain/resource.ts:14-17
    expectedRemoteOID: string | null;   // last-known remote tip
  }): Promise<{ pushedOID: string; remoteOID: string }>
  ```
  plus typed `PublishDivergedError` (carries remote OID; model on
  `LandingCASMismatchError`, `src/landing/port.ts:57-65`). Optional
  `PublishAuthError`.
- **`src/publication/git.ts`** — `class GitRepositoryPublisher`, `execFile("git",
…)` (style of `src/landing/git.ts:25-30`):
  - `pushedOID = git --git-dir=<homeDir> rev-parse refs/heads/<branch>`.
  - Push fast-forward-only, `--force-with-lease` **as a guard only** (never blind
    `--force`):
    `git --git-dir=<homeDir> -c credential.helper= push
--force-with-lease=refs/heads/<branch>:<expectedRemoteOID> <remoteUrl>
refs/heads/<branch>:refs/heads/<branch>`.
    When `expectedRemoteOID` is null, use a plain non-force push (first-push / ff
    succeeds, diverged rejected by git default).
  - Build env via the `buildGitEnv` mechanism (`src/workspace/local.ts:84-129`):
    temp token + askpass for `https-token`, `GIT_TERMINAL_PROMPT=0`, `cleanup()`
    in `finally`; `ambient`/`ssh-agent` skip askpass. Sanitize env
    (`GIT_STRIP_KEYS`, `local.ts:46-53`).
  - Non-ff / stale-lease (git exit + stderr `rejected`/`stale info`/
    `non-fast-forward`) → throw `PublishDivergedError` with the current remote
    OID (`git ls-remote <remoteUrl> refs/heads/<branch>`). Never retry with
    `--force`.
  - On success read back `remoteOID` (`git ls-remote`); assert == `pushedOID`.
- Provide `resolveCredential(credentialId) => Promise<string>` (read the stored
  credential `value` from `resources` attributes as `src/agent-runner/pi.ts:397-401`
  does), constructed in `composition.ts`, passed to the publisher.

## Constraints

- Fast-forward default; any non-ff fails loudly. No remote-history rewrite on the
  normal path.
- `execFile("git", …)` only; clear `credential.helper`.
- Use case depends on the port, never on `git.ts`.

## Verify

- `node --test src/publication/git.test.ts` (real git, bare `file://` remote):
  - ff push advances the remote ref to the local tip; returns equal
    `pushedOID`/`remoteOID`.
  - diverged remote → `PublishDivergedError` with current remote OID; remote not
    overwritten.
  - `auth: ambient` against a writable `file://` remote pushes without askpass.
- `npm run verify` exits 0.
- Push mechanics behind Proof A + Proof D.
