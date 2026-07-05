# Story 000 - Git Platform Foundation

Epic: `.agent/plan/epics/014-real-broker-minimal-path.md`

## Goal

The shared git-platform foundation this epic's verb stories (001–003) build on: a
hardened **git execution seam**, a **credential keyring** of named identities
(multi-account), a CLI-first **`GitPlatformAdapter`** (`gh` now), a read-only
**`verifySetup`** preflight that emits a `system:setup` inbox item on failure, and a
non-interactive **bootstrap CLI** that populates the keyring + slots. This story runs
**before** 001–003 (they depend on it) and implements Epic 011 SU7, which is
design-only because SU-gate epics are not RED/GREEN. Design source (recorded, not
re-decided here): `.agent/plan/feedback/014-real-broker-minimal-path/git-platform-adapter.md`.

## Acceptance Criteria

- **Git execution seam:** git runs via `execFile`/`spawn` with array args (no shell);
  explicit `cwd`; an allowlisted child env (`GIT_TERMINAL_PROMPT=0`,
  `GIT_CONFIG_NOSYSTEM=1`, controlled `HOME`, `LC_ALL=C`; passes `PATH`, SSL/CA, proxy
  vars); a hung child is killed by **process group** on timeout; every Core-supplied
  ref is validated (`git check-ref-format --branch` + allowlist) before use.
  Classification keys on **exit code + porcelain + pre/postcondition**, not stderr
  English: `nothing-to-commit` → idempotent noop, `push up-to-date` → success,
  non-fast-forward → terminal, bad-host → retryable (the SU1 `git-cli.md` contract).
- **Keyring:** named identities load from one of file (`0600`) / env
  (`KANTHOR_IDENTITY_<NAME>_TOKEN`) / systemd `LoadCredential`; each identity is a
  per-identity PAT. Loading a file whose mode > `0600` or whose owner ≠ the daemon's
  effective UID is a **typed error, not a boot** (fail-closed). No credential value
  reaches a log (value-based redaction); a spawned child does not see the token in env
  or argv; the daemon never sets `GH_TOKEN` in its own process env.
- **Adapter:** a `GitPlatformAdapter` (createPr / getPr / findPrByHead + verifySetup)
  with a `gh`-backed impl that passes `--repo owner/name` and the identity's token via
  `GH_TOKEN` in the per-invocation child env only; the error taxonomy is derived from
  `gh` exit code + stderr/`--json` (duplicate-PR → resolve via `findPrByHead`; auth →
  escalate; rate-limit → retryable-with-delay). REST (`fetch`) is used only for a gap
  op. All adapter tests run against a **fake `gh` runner** (no network).
- **verifySetup:** read-only (never mutates); checks tooling present **and
  min-version** (`git ≥ 2.31`, `gh` floor), auth valid (+ expiring-soon warning),
  token scopes (push, PR), repo reachable, transport reachable; returns a
  `VerifyReport` keyed by `(platform, repo, identity)` with per-check
  `{ name, ok, detail, remediation }`. On any failed check it yields **one aggregate
  `system:setup` inbox item** per repo naming the failures + remediation.
- **Bootstrap CLI:** `kanthord bootstrap` populates the keyring + slot configs and
  runs `verifySetup`; it writes **only kanthord's own files** — never `~/.gitconfig`,
  `gh auth`, or the macOS keychain. `--non-interactive` reads env / mounted secret and
  is **fail-closed** (errors, never prompts); a missing value exits non-zero with a
  named error.

## Constraints

- Git operations go **only** through the execution seam — no direct `child_process`
  git elsewhere (SU1; reused by Story 001–003 and by Epic 016 worktrees).
- CLI-first: `gh`/`glab` for the platform API, REST fallback only for a gap op
  (Ulrich decision 2026-07-05; `git-platform-adapter.md`).
- Credentials follow SU4 custody: central, agents never see them (PRD §5, lines
  166/173).
- Tests are hermetic: temp git repos + local bare remotes for the seam; a fake `gh`
  runner for the adapter/verifySetup; the Phase-1 no-network guard stays green.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for the Story 000 suites.
- A `push` to a local bare remote through the seam succeeds; a second identical push
  reports up-to-date (idempotent); a non-fast-forward push is a terminal typed error.
- A keyring file at mode `0644` is rejected with a typed fail-closed error; at `0600`
  owned by the effective UID it loads; a spawned child's env + argv contain no token.
- `verifySetup` against a fake `gh` with a missing PR scope returns `ok: false` and a
  single `system:setup` inbox item naming the repo/identity + remediation; with all
  checks passing it returns `ok: true` and no inbox item.
- `kanthord bootstrap --non-interactive` with a complete env populates the keyring +
  slots and reports `verifySetup` pass; with a missing identity value it exits
  non-zero and writes nothing.

### Task T1 - Git execution seam

**Input:** `src/git/exec.ts`, `src/git/exec.test.ts`

**Action - RED:** tests on a temp repo + bare remote: exit-code/porcelain
classification (nothing-to-commit noop, up-to-date success, non-ff terminal,
bad-host retryable); ref validation rejects `-x` / `..` / `@{`; the child env is
allowlisted (token/`SSH_AUTH_SOCK` absent); a sleeping child is killed by group on
timeout.

**Action - GREEN:** implement the `execFile`-based runner with cwd isolation, env
allowlist, process-group timeout/kill, ref validation, and the classifier.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for `src/git/exec.test.ts`; `npm run typecheck` exits 0.

### Task T2 - Credential keyring + custody

**Input:** `src/git/keyring.ts`, `src/git/keyring.test.ts`

**Action - RED:** tests: identities load from file/env; mode `0644` or wrong owner ⇒
typed fail-closed error; a canary value never appears in captured logs; a child
spawned via the seam sees no token in env/argv.

**Action - GREEN:** implement the multi-source loader, fail-closed permission guard,
value-based log redaction, and per-invocation token injection (never daemon-global).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T3 - GitPlatformAdapter (gh-backed)

**Input:** `src/git/platform-adapter.ts`, `src/git/platform-adapter.test.ts`

**Action - RED:** tests against a fake `gh` runner: `createPr` passes `--repo` + head
+ base and records the number; `findPrByHead` maps `--state all`; a duplicate-create
exit resolves via `findPrByHead` to the existing PR; an auth-failure exit classifies
escalate; a rate-limit exit classifies retryable-with-delay.

**Action - GREEN:** implement the `GitPlatformAdapter` interface + the `gh` impl
(token via `GH_TOKEN` child env, explicit `--repo`, taxonomy from exit/stderr/json).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T4 - verifySetup preflight + system:setup inbox item

**Input:** `src/git/verify-setup.ts`, `src/git/verify-setup.test.ts`

**Action - RED:** tests against a fake `gh` + fake tooling: a missing PR scope ⇒
`ok: false` + one aggregate `system:setup` inbox item naming repo/identity +
remediation; a stale git version ⇒ min-version check fails; all-pass ⇒ `ok: true`,
no item; the method performs **no** mutating call.

**Action - GREEN:** implement `verifySetup` (read-only checks, `VerifyReport`, the
`system:setup` inbox item mapping).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T5 - Bootstrap CLI

**Input:** `src/cli/bootstrap.ts`, `src/cli/bootstrap.test.ts`

**Action - RED:** tests: `--non-interactive` with a complete env populates keyring +
slots and reports `verifySetup` pass; a missing identity value exits non-zero and
writes nothing; the run touches no global git/gh path (asserted via a sandboxed
`HOME`/`GH_CONFIG_DIR`).

**Action - GREEN:** implement the bootstrap command over T1–T4, fail-closed and
writing only kanthord's own files.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
