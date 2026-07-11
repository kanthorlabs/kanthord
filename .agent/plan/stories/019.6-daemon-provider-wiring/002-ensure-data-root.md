# Story 002 - resolve + ensure the KANTHORD_DATA data root

Epic: `.agent/plan/epics/019.6-daemon-provider-wiring.md`

## Goal

Make every provider entrypoint bootstrap its own data root. `KANTHORD_DATA`
defaults to `~/.kanthord` and each entrypoint (`kanthord login`, `kanthord run`)
must **ensure that directory exists** (mode `0700`) before it builds the account
registry / credential store — so a fresh machine's first login persists instead
of silently failing on `ENOENT`.

## Acceptance Criteria

- A shared resolver returns `process.env.KANTHORD_DATA` when that variable is set
  and non-empty, and `~/.kanthord` otherwise.
- A shared ensure step, given a path that does not exist, creates it (including
  parents) with directory mode `0700`; given a path that already exists it
  succeeds without error (idempotent) and does not weaken existing permissions.
- After the ensure step runs for a fresh data root, that directory exists and is
  owner-only (`0700`), so the registry/credential-store "directory must already
  exist" contract is satisfied by the entrypoint.
- `kanthord login` and `kanthord run` both resolve-then-ensure the data root
  before constructing their deps; on a machine with no `~/.kanthord`, running
  `kanthord login openai --account <label>` creates the data root and persists
  `accounts.json` (no silent `ENOENT`).

## Constraints

- **One shared helper, two callers (DRY)** — the resolve + ensure logic lives in a
  single module reused by `login.ts` and `run.ts`; neither entrypoint re-inlines
  `process.env.KANTHORD_DATA ?? join(homedir(), ".kanthord")` after this story.
- **The registry/store keep their contract** — they still assume the directory
  exists (Epic 019.4). This story satisfies that contract at the entrypoint; it
  does not change the store to self-mkdir.
- **Directory mode `0700`** — matches the credential-custody posture (owner-only,
  rootless `--userns=keep-id`); the credential *file* stays `0600` (unchanged).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the new helper test passes and
  the existing suite shows no regression; the zero-network guard stays green (the
  helper touches only the local filesystem).
- `node src/cli/run.ts --help` exits 0 (unchanged surface).

### Task T1 - resolve + ensure data-root helper

**Input:** `src/foundations/data-root.ts`, `src/foundations/data-root.test.ts`

**Action - RED:** a hermetic test asserts `resolveDataRoot()` returns the value of
`KANTHORD_DATA` when the env var is set to a non-empty string, and a path ending
in `.kanthord` under the home dir when it is unset; and that
`ensureDataRoot(<temp path that does not exist>)` creates the directory with mode
`0700`, is idempotent on a second call, and returns the path. Use a temp dir under
the test's control (never the real `~/.kanthord`).

**Action - GREEN:** implement `src/foundations/data-root.ts` exporting
`resolveDataRoot(): string` (`process.env.KANTHORD_DATA` when non-empty, else
`join(homedir(), ".kanthord")`) and `ensureDataRoot(dataRoot: string):
Promise<string>` (`mkdir` recursive with mode `0700`, return the path).

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/foundations/data-root.test.ts` green.

### Task T2 - wire login + run through the helper

**Input:** `src/cli/login.ts`, `src/cli/run.ts`

**Action - RED:** none - GREEN-only. Both are thin entrypoint shells; the helper
behavior is covered by T1 and the surfaces by `--help` + the live login. No
hermetic test may create the real `~/.kanthord`.

**Action - GREEN:** in `login.ts` (main) and `run.ts` (main), replace the inline
`process.env["KANTHORD_DATA"] ?? join(homedir(), ".kanthord")` with `const
dataRoot = await ensureDataRoot(resolveDataRoot())` (imported from
`../foundations/data-root.ts`) before building deps. Drop the now-unused
`homedir` import where it becomes orphaned.

**Action - REFACTOR:** none.

**Verify:** `npm run typecheck` exits 0; `node src/cli/run.ts --help` exits 0.
