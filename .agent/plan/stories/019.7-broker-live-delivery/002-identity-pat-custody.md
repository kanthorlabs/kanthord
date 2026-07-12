# Story 002 - per-identity PAT custody in the live path

Epic: `.agent/plan/epics/019.7-broker-live-delivery.md`

## Goal

Load the `kanthordverify` git identity token into the live daemon so the broker
verbs can authenticate to GitHub. `loadIdentity` (`src/git/keyring.ts`) already
implements secure file/env loading but has **no live caller**. This story wires
it into `buildRealDeps` and exposes the token to the push + create_pr adapters.

## Acceptance Criteria

- `buildRealDeps`, given a slot whose `identity` is `kanthordverify`, loads that
  identity's token via `loadIdentity` from the custody file
  `.data/kanthord/credentials` (mode `0600`, owner-checked) and makes it available
  to the broker adapters — as the `Bearer` token for `create_pr` and for the
  `git.push` HTTPS auth (`http.extraHeader`).
- Fail-closed: when the identity file is missing, or its mode is not `0600`, or
  its owner is wrong, `buildRealDeps` (or daemon boot) raises a typed error whose
  message names the identity and the custody file, **without** printing the token,
  and the daemon does not start.
- The token is never written to a ledger row, a log line, or `process.env`
  visible to unrelated children (injected per-invocation only).

## Constraints

- **Reuse `loadIdentity` unchanged** (`src/git/keyring.ts`) — file mode `0600` +
  owner check are its existing contract; this story calls it, it does not
  reimplement custody.
- **Custody source is the slot's `identity`** — the file path derives from the
  identity name / data root, not a hard-coded path; the `kanthordverify` →
  `.data/kanthord/credentials` mapping is configuration, not code.
- **Per-invocation injection only** — the push adapter receives the token via the
  worktree git config / child env; `create_pr` via the `Authorization` header
  (Epic 013 custody posture). Never `process.env`-global.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the custody-load test passes
  (temp `0600` file) and the fail-closed cases raise typed errors; guard green.

### Task T1 - load the slot identity token in buildRealDeps

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a hermetic test creates a temp identity file with mode `0600`
owned by the test uid and asserts `buildRealDeps` (given a slot identity name and
the file path) exposes the loaded token to its broker-adapter construction (assert
via a seam: the constructed create_pr adapter/opts carry the token, or a returned
`identityToken` field equals the file contents). Further cases: a `0644` file and
a missing file each make `buildRealDeps` throw a typed error naming the identity
and file, with no token in the message.

**Action - GREEN:** in `buildRealDeps`, call `loadIdentity({ name: slotIdentity,
file: identityFilePath })`, thread the token into the broker-adapter construction
inputs (Story 003 consumes it), and surface load failures as a typed fail-closed
error.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green (existing cases still pass).
