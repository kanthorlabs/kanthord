# Git Platform Adapter, Keyring & verifySetup — Consolidated Design

Date: 2026-07-05. Source: design review with Ulrich (supersedes parts of the
first-pass SU1/SU2/SU4/SU5 findings). This is the anchor for the CLI-first git
platform design; `git-cli.md` (SU1), `github-api.md` (SU2),
`credential-custody.md` (SU4) and the SU5 proof-run preamble reference it.

## 1. CLI-first decision (supersedes SU2's plain-fetch-REST)

Core drives git platforms **CLI-first**:

- **git transport** (clone/fetch/branch/commit/push) → **`git` CLI** (SU1, unchanged;
  platform-agnostic).
- **platform API** (PR/MR create, status, list-by-head) → **`gh` CLI** now, **`glab`**
  later.
- **REST (plain `fetch`) is a fallback used ONLY for an operation a platform CLI has
  no command for** — not a parallel primary path.

Why (Ulrich's steer): the CLIs cover almost every operation we use, so CLI-first is
*less* setup than a hand-rolled REST client (no request/auth/pagination/rate-limit/
taxonomy code); one execution model end to end (everything is "shell out to a CLI",
matching SU1); and `gh`/`glab` are the ecosystem's hardened official tools that track
their platform's API. This reverses the first-pass "REST-default" recommendation.

**Invariants preserved from the REST analysis (still true, sourced differently):**
- The **broker owns the async lifecycle** (PRD §5): each CLI call is one *attempt*;
  the broker owns timeout + re-invocation. `gh`'s internal transient retry lives
  inside a single attempt — no conflict.
- **Error taxonomy comes from CLI exit code + stderr/`--json`** instead of HTTP
  headers (see `github-api.md`). Duplicate PR → `gh` non-zero exit → resolve via
  `gh pr list --head` (same idempotency-by-head as the REST 422 path).
- **Token fed per-invocation via env** (`GH_TOKEN`/`GITLAB_TOKEN`) from the keyring —
  **never** `gh auth login` (global state breaks custody).

## 2. GitPlatformAdapter interface

```
interface GitPlatformAdapter {
  // READ-ONLY preflight; never mutates. See §4.
  verifySetup(ctx): Promise<VerifyReport>;
  // Platform API verbs (CLI-first; REST fallback per op if no CLI command).
  createPr(...): Promise<PrRef>;
  getPr(number): Promise<PrState>;
  findPrByHead(branch): Promise<PrRef | undefined>;
}
```

- GitHub impl backs these with `gh` (`gh pr create --json ...`, `gh pr view`,
  `gh pr list --head <owner:branch> --state all --json ...`). Always pass
  **`--repo owner/name`** — never let `gh` infer from the worktree cwd remote.
- GitLab impl (later) backs them with `glab`; a per-identity **host/api_url** field
  is required for self-hosted GitLab (gitlab.com is the default).
- The interface is the seam GitLab plugs into; the broker verbs (Epic 014) call the
  adapter, not `gh` directly.

## 3. Credential model — keyring of named identities (multi-account)

Supersedes the single-token / SSH-deploy-key model.

- The daemon holds a **keyring of named identities** (e.g. `company`, `personal`),
  each a **per-identity fine-grained PAT over HTTPS**. One credential per identity
  unifies transport auth (`git push` via `http.extraHeader`) and API auth (`gh` via
  `GH_TOKEN` env) — **the SSH deploy key + `known_hosts` hardening are dropped**
  (a deploy key is per-repo and does not scale to multi-account/multi-repo).
- Each **repo slot names its identity** (`identity: company`); the daemon injects
  that identity per invocation, including `-c user.name/user.email` per commit so
  each account's commits carry the right author — **no global git state**.

### Credential sources (deployment-dependent — see §5)

- **file:** `.data/kanthord/credentials` (`0600`, fail-closed owner check).
- **env:** multi-identity convention `KANTHOR_IDENTITY_<NAME>_TOKEN` (container /
  orchestrator secret).
- **systemd `LoadCredential`** (`$CREDENTIALS_DIRECTORY`) on a Linux VPS.

**Never** set `GH_TOKEN`/`GITLAB_TOKEN` in the daemon's own process env (multi-identity
collision + leak) — only in the per-invocation child env for the chosen identity.
`gh`/`glab` still need a **writable, controlled config/state dir** even with an env
token — pin `GH_CONFIG_DIR`/`GLAB_CONFIG_DIR` to a controlled writable path, never
the host's, never global.

## 4. verifySetup — read-only preflight → inbox

`verifySetup()` pre-checks before any action. **Hard rule: read-only, never mutates**
(no push/create/change). Read probes only, CLI-first.

- **Checks:** tooling present **and min-version** (`git ≥ 2.31` for `GIT_CONFIG_COUNT`
  env-config; a `gh`/`glab` floor); auth valid + **expiring-soon** warning; token
  scopes for push + PR; repo reachable (`gh repo view`); transport reachable
  (`git ls-remote`); slot config valid.
- **Two levels:** setup-level (per identity, at bootstrap) and repo-level (per slot,
  at bootstrap AND as preflight before a mutating verb).
- **VerifyReport** keyed by `(platform, repo, identity)`, `ok` + per-check
  `{ name, ok, detail, remediation }`.
- **Fail-closed gating:** before the broker submits a mutating verb it runs the
  repo-level preflight; on failure it does **NOT** submit — terminal
  `blocked-needs-setup` state + a **`system:setup` inbox item** naming exactly which
  repo/platform/identity is broken and how to fix it. The inbox gains a **new
  `system:setup` kind** (Ulrich decision 2026-07-05; SU6 schema is an interface
  hypothesis, so this is a re-gen), and emits **one aggregate item per repo** (not per
  check).
- **Cost:** network checks (`gh repo view`, `gh auth status`) count against the API
  rate limit — **cache** them with a short TTL; always re-run at bootstrap.

## 5. Bootstrap CLI + deployment portability

**Bootstrap CLI** (`kanthord bootstrap` / a `doctor` mode; `src/cli/*` convention):
populates the **keyring + slot configs** and runs `verifySetup` across all
identities/slots. It writes **kanthord's own files only** — never `~/.gitconfig`,
`gh auth`, or the macOS keychain (SU1 no-global-config isolation). **Non-interactive
mode** (container/CI) reads from env / mounted secret and is **fail-closed** — errors
instead of prompting; `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED`, no update
prompts.

**Implementation-home gap (flag):** the bootstrap CLI is a real code component with
no epic yet (`kanthord verify` is Epic 018; there is no bootstrap epic). It needs an
implementation home before Epic 014's verbs can preflight — noted for planning.

### Host vs container matrix

| Concern | Host (macOS / Linux VPS) | Container (separate / inherit) |
|---|---|---|
| CLI binaries | host-installed; **version-drift risk** → min-version check | image-pinned; **never inherited** from host |
| Secrets source | `0600` file, or systemd `LoadCredential` (Linux) | env / mounted secret (separate); **data-only** bind (inherit) |
| File owner check | daemon service user (may ≠ login user) | in-container **effective UID**; `--userns=keep-id` mapping |
| gh/git config dir | user `$HOME` | **must pin writable `GH_CONFIG_DIR`** |
| CA / proxy | host-provided | ship **`ca-certificates`**; pass `HTTPS_PROXY`/`NO_PROXY` to `gh` too |
| Process-group kill (SU1) | POSIX — macOS + Linux | Linux |
| Status/control bind | loopback; remote VPS needs VPN/tunnel (PRD VPN-only) | loopback; expose via reverse proxy |

### "Inherit from host" — limit to token/keyring DATA only

- **CLI binaries never inherit** — the container uses its own image `git`/`gh`; a
  macOS-host `gh` is irrelevant inside a Linux container.
- **Never mount** host `~/.config/gh`, `~/.gitconfig`, or the macOS keychain into the
  container (reintroduces global-state coupling; macOS-native paths/helpers break on
  Linux). `GIT_CONFIG_NOSYSTEM=1` + controlled `HOME` (SU1) already neutralize the
  macOS `osxkeychain` helper — keep it.
- **UID mapping** decides whether the `0600` owner check passes: run the check in the
  daemon's **in-container effective UID**; `--userns=keep-id` maps a host-owned file
  to that UID, without it the file may be unreadable / fail the check.
- **No host-absolute paths** in slot/worktree config (`/Users/...`) — use
  container-relative or a configurable base, or the inherit case breaks.

### Required egress (deploy pre-req; `verifySetup` tests it via `remote-reachable`)

`api.github.com:443`, `github.com:443` (and the GitLab host). Firewall / k8s
NetworkPolicy must allow it.

## 6. Decided

Inbox representation of a setup failure: a **new `system:setup` kind** (Ulrich
2026-07-05) — genuinely distinct from a diff-escalation or an approval. It is added to
the SU6 inbox surface via a schema re-gen (the SU6 kind set was an interface
hypothesis); `ListInboxItems` items carry `kind: "system:setup"`.
