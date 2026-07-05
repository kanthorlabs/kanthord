# SU1 Git CLI Execution Path — Findings

Date: 2026-07-05
git version probed: `2.48.1`
Probe environment: temp repo + local bare remote (`file://`) on the macOS host.
Linux dev-sandbox cross-check: **process-group kill DONE** (2026-07-05, evidence
below). **Push-auth over HTTPS DONE** (2026-07-05, live `kanthord-verify` repo +
fine-grained PAT) — **with a correction: the header is `Authorization: Basic`, NOT
`Bearer`** (see Credential Injection).

## Decision

Core drives git by executing the **git CLI** via `node:child_process`, using
`execFile`/`spawn` with **array args** — never `exec` (which spawns a shell). No
git library is added; `package.json`/lockfile are unchanged for SU1.

Rejected alternatives:
- `isomorphic-git` (pure JS) — **disqualified**: Epic 016 needs `git worktree
  add/remove`, which it does not implement, and its semantics diverge from real git.
- `nodegit` (libgit2 native bindings) — build-toolchain liability on Node 24
  (native compile, brittle install).
- `simple-git` — a thin wrapper over the same CLI; a dependency for what
  `child_process` already does.

This is a **tradeoff, not a dogma**: "no dependency" is justified here because the
surface is small, the git CLI is the canonical hardened implementation, and the
broker needs explicit control of exit-code/stderr classification — not because
dependencies are inherently disallowed.

## Invocation Rule

- `execFile("git", args, opts)` or `spawn("git", args, opts)`. Array args mean **no
  shell**, so shell injection and path quoting are non-issues: paths with spaces and
  newlines pass safely as single argv elements.
- Array args do **not** remove git-level option/refname ambiguity. Validate every
  Core-supplied branch/ref before use (see Ref Validation).

## cwd Isolation

- Pass an explicit `cwd` = the repo-slot path on every call. **Pick one invariant:
  use `cwd`, do not also pass `git -C`.** If the two ever diverge the failure is
  hard to debug. Never rely on `process.cwd()`.

## Environment Sanitization (allowlist, not empty)

A near-empty env breaks git's HTTPS in containers/enterprise, so use three explicit
lists rather than stripping everything:

- **Set / force:**
  - `GIT_TERMINAL_PROMPT=0` — fail fast instead of hanging on an interactive
    credential prompt.
  - `GIT_CONFIG_NOSYSTEM=1` and a controlled/empty `HOME` + `GIT_CONFIG_GLOBAL` —
    host and user gitconfig + credential helpers cannot interfere.
  - `LC_ALL=C` / `LANG=C` — stable English for any residual message parsing.
- **Pass through (required for HTTPS to work):** `PATH`, `SSL_CERT_FILE` /
  `SSL_CERT_DIR`, proxy vars (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`).
- **Forbid:** ambient tokens, host `GIT_ASKPASS` / credential-helper vars.

## Credential Injection (push auth — ties to SU4 custody)

**CHOSEN (Ulrich, 2026-07-05, revised): HTTPS + per-identity PAT** (the earlier SSH
deploy-key choice is dropped — it is per-repo and does not scale to the multi-account
keyring). `git.push`/clone/fetch go over **HTTPS** to the repo's HTTPS remote, using
the token of the slot's identity from the keyring. See `git-platform-adapter.md` for
the keyring + multi-identity model.

HTTPS token injection (primary): the token must never appear in argv (visible via
`ps`), the remote URL (leaks into reflog / remote config), or logs. Mechanism:
- **Env-config `http.<url>.extraHeader`** via `GIT_CONFIG_COUNT` /
  `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` (git ≥ 2.31), setting
  **`Authorization: Basic <base64("x-access-token:" + token)>`**. **Scope it to the
  GitHub host only** — it can leak the header on a cross-host redirect if URL scoping
  is wrong.
- **CORRECTION (spike-confirmed 2026-07-05):** the header value is **Basic**, not
  `Bearer`. `Bearer <PAT>` is **rejected** by GitHub git-over-HTTPS
  (`remote: invalid credentials`); Basic with `x-access-token:<PAT>` succeeds. The
  earlier Bearer hypothesis is superseded.
- Alternative: an ephemeral `GIT_ASKPASS` script (no redirect-leak surface).
- Per-identity: use the token bound to the slot's `identity`; also set
  `-c user.name/user.email` for that identity per commit. No global git state.
- The API side (`github.create_pr`) uses the **same** per-identity token via `gh`'s
  `GH_TOKEN` env (SU2) — one credential per identity does transport + API.

**VERIFIED (live, 2026-07-05)** — `scripts/dev/probes/su2-su5-gh-spike.sh` against
`kanthorlabs/kanthord-verify` (throwaway) with a repo-scoped fine-grained PAT
(Contents+PR write). Redacted transcript:
- **push OK** — `Authorization: Basic` via `GIT_CONFIG_KEY_0/VALUE_0` (host-scoped),
  token **not** in argv/URL: `* [new branch] probe/su-… -> probe/su-…`, exit 0.
- **auth failure without a prompt** — a bogus Basic token with
  `GIT_TERMINAL_PROMPT=0`: `remote: Invalid username or token. Password
  authentication is not supported for Git operations.` → `fatal: Authentication
  failed`, **exit 128, no hang** (terminal → escalate).
- `git 2.48.1` on the host (≥ 2.31 min-version satisfied).

## Timeout / Kill (platform-sensitive)

A hung `git fetch` / `git push` over the network is the target case. Node's
`child_process` `timeout` sends `SIGTERM` only to the direct child, orphaning git's
helper subprocesses (`git-remote-https`). Contract:

- `spawn(..., { detached: true })` to create a **process group**; on timeout
  `process.kill(-pid, "SIGTERM")`, escalate to `SIGKILL` after a grace period —
  killing the whole group.
- Guard against killing unrelated processes if `setpgid` fails (fall back to killing
  the single pid).
- **Platform:** Core runs Linux inside the Podman sandbox; POSIX process groups
  apply. If native-macOS mode is exercised, test there too.
- **VERIFIED (Linux, 2026-07-05)** — `scripts/dev/probes/su1-kill-probe.mjs` in a
  `node:24-slim` container (git 2.39.5). A `git clone` against a silent local TCP
  server hangs, producing a real 3-process group `git → git → git-remote-http`.
  A single group SIGTERM (`process.kill(-pgid, "SIGTERM")`) reaped **all 3** —
  `group members AFTER kill (0): (none)`, child exited via SIGTERM, `used group
  kill = true`. Confirms the detached-group contract kills the helper (no
  orphaned `git-remote-http`); SIGKILL escalation + single-pid fallback are coded
  but were not needed (SIGTERM sufficed within the grace window).

## Exit Code / stderr Classification

Rule: classify by **exit code + porcelain output + pre/postcondition checks first;
stderr English text is the last resort** (git writes progress to stderr even on
success, and human messages change across versions). Prefer `git status
--porcelain=v2` and `git push --porcelain`.

Observed on the probe (git 2.48.1):

| Case | exit | signal |
|---|---|---|
| `clone` empty remote | 0 | warns "cloned an empty repository" (not an error) |
| `commit` with changes | 0 | — |
| `commit` nothing to commit | **1** | "nothing to commit, working tree clean" |
| `status --porcelain=v2` clean | 0 | empty stdout |
| `push --porcelain` first push | 0 | ends `Done` |
| `push --porcelain` up-to-date | 0 | `=\trefs/...\t[up to date]` + `Done` |
| `push --porcelain` non-fast-forward | **1** | `!\trefs/...\t[rejected] (fetch first)` + `error: failed to push some refs` |
| `check-ref-format --branch` valid | 0 | echoes name |
| `check-ref-format --branch` `-badname` | **128** | "is not a valid branch name" |
| `clone` into non-empty dir | **128** | "already exists and is not an empty directory" |
| `ls-remote` bad host | **128** | "Could not resolve host: …" |
| `worktree add` / `list` / `remove` | 0 | — |

Broker mapping:
- **nothing to commit (exit 1)** → detect by **preflight** (index/tree has no
  changes via `--porcelain=v2`) rather than parsing stderr → idempotent noop, not a
  failure.
- **push up-to-date (exit 0)** → idempotent-success (the `git.push` idempotency case).
- **push non-fast-forward (exit 1)** → terminal → escalate (remote moved).
- **clone-into-non-empty / bad-ref (exit 128)** → terminal (caller/config error).
- **bad host / network (exit 128)** → retryable (backoff).
- `push --porcelain` machine format: one line per ref, leading char `=` up-to-date /
  space ok / `!` rejected, then `<local>:<remote>` and a `[status]`, ending `Done`.

## Ref Validation (before any Core-supplied name reaches git)

Validate with `git check-ref-format --branch <name>` **plus** a Core allowlist —
`-`-rejection alone is not enough. Confirmed rejected (exit 128): flag-like
`-badname`, `bad..name`, `bad@{name`. Use `--` separators where the subcommand
supports it.

## Desired-Effect Helpers (for Epic 014 reconcile)

- `git.branch` effect = ref at sha: `git rev-parse refs/heads/<b>`.
- `git.commit` effect = **content-equivalence** via tree hash
  `git rev-parse <ref>^{tree}` (probe returned e.g.
  `92ac8126…`). Commit sha is **not** reproducible across retries; the tree hash is
  content identity but ignores parent/message/author. **Stated contract:** the
  `git.commit` desired effect is branch-head **content-equivalence** (tree hash),
  not exact commit identity.
- `git.push` effect = remote ref at sha: `git ls-remote <remote> refs/heads/<b>`.

## Probe Scope (risky cases, per debate hardening)

Covered on the host probe: paths with spaces, flag-like/`..`/`@{` branch names,
non-fast-forward push, nothing-to-commit, clone-into-non-empty, bad-host, worktree
add/remove, tree-hash extraction.

Linux-sandbox status: hanging git subprocess (timeout → process-group kill)
**DONE** (see Timeout / Kill above). HTTPS auth failure without a prompt and the
`http.extraHeader` injection mechanism end to end **DONE** (see Credential
Injection — VERIFIED live, incl. the Bearer→Basic correction). No SU1 items remain
owed.

All probes run against scratch-only targets (Epic 011 safety boundary): a temp repo
and a local bare remote; nothing external is touched.
