# SU4 Credential Custody in Daemon Config — Findings

Date: 2026-07-05 (revised — supersedes the single-token / SSH-deploy-key model).
Status: **design + verify checklist**. Mutating steps (minting PATs, running probes)
are maintainer-executed.

Anchors: PRD line 166 "Agents never hold credentials and never make raw calls";
PRD line 173 "Central credential custody; scoped per integration. Single audit log."
Cross-cutting design: **`git-platform-adapter.md`** (keyring, sources, deployment).

## Decision

Central custody = a **keyring of named identities** loaded fail-closed, held in
memory only, with value-based log redaction, and **never exposed to child processes**
except through the per-invocation injection paths. Supersedes "one `github_token` +
one SSH deploy key."

### Keyring of named identities (multi-account)

- Identities e.g. `company`, `personal`; each a **per-identity fine-grained PAT over
  HTTPS** (Contents: write + Pull requests: write, repo-scoped). One credential per
  identity does both transport (`git push` via `http.extraHeader`) and API (`gh` via
  `GH_TOKEN` env). **SSH deploy key + `known_hosts` hardening dropped** (per-repo,
  doesn't scale to multi-account).
- Each repo slot names its identity; the daemon injects it per invocation, incl.
  `-c user.name/user.email` per commit — no global git state.
- GitLab self-hosted identities also carry a `host`/`api_url`.
- **Model-provider auth is provider-dependent and the API key is OPTIONAL**
  (Ulrich, 2026-07-05): OAuth/subscription backends (e.g. Codex CLI, GitHub
  Copilot, and pi when it authenticates via OAuth) hold **no** API key. The keyring
  carries a model API key **only** when the chosen provider requires one; the git
  PAT is the sole always-required credential. Custody rules (redaction, isolation,
  fail-closed) apply to whatever secrets are present.

### Credential sources (deployment-dependent)

- **file** `.data/kanthord/credentials` (`0600`, fail-closed owner check) — strict
  narrow schema (env-style / flat), **not YAML**, no nesting/interpolation.
- **env** multi-identity `KANTHOR_IDENTITY_<NAME>_TOKEN` (container / orchestrator
  secret).
- **systemd `LoadCredential`** (`$CREDENTIALS_DIRECTORY`) on a Linux VPS.

### Load lifecycle

**Boot-only** for the 2A proof (simpler/safer). Consequence: rotating a token
requires a daemon restart. (Alternatives: SIGHUP reload; per-op read.)

### Fail-closed permission guard (runtime invariant)

Refuse the file (typed error, no boot) if mode > `0600` or owner ≠ the **effective
UID the daemon runs as in the environment where it loads the file**. Container
(`--userns=keep-id`): host `stat` ≠ in-container ownership — **run the check inside
the daemon's runtime context**.

### Child-process isolation (whole family, allowlist by default)

Verify the daemon builds a **minimal allowlisted** child env. Assert absent in a
spawned child: `GH_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, provider keys,
`KANTHOR_SECRETS_FILE`/`KANTHOR_IDENTITY_*`, `GIT_ASKPASS`, `GIT_CONFIG_*`,
`SSH_AUTH_SOCK`, child **argv**, askpass/git-config **temp files**.
**Never set `GH_TOKEN` in the daemon's own process env** — only in the per-invocation
child env for the chosen identity (multi-identity collision + leak).

### gh/glab state dir

Even with an env token (no `gh auth login`), `gh`/`glab` write a config/state/cache
dir. **Pin `GH_CONFIG_DIR`/`GLAB_CONFIG_DIR`** to a controlled **writable** path —
never the host's, never global.

### Log redaction (value-based, not just key-based)

Register each loaded secret value (or a digest-backed token) for **value-based**
scrubbing across all log messages: `Authorization` headers, git errors,
`remote: https://token@github.com/...`, `http.extraHeader`, `gh` stderr, exception
messages, serialized config.

## Bootstrap CLI (populates the keyring)

`kanthord bootstrap` writes the keyring + slot configs and runs `verifySetup`; it
touches **kanthord's own files only** — never `~/.gitconfig`, `gh auth`, or the macOS
keychain. Non-interactive mode reads env / mounted secret, **fail-closed** (no
prompts). See `git-platform-adapter.md` §5.

## Verify Checklist (run in the daemon's runtime context)

- **load probe:** daemon loads the keyring; asserts each identity's PAT present **by
  shape** (never prints a value).
- **ignore:** `git check-ignore .data/kanthord/credentials` prints the path.
- **no tracked leak (canary):** use a **synthetic canary** — a small verifier reads
  the secret internally and scans tracked files without echoing; assert the path is
  untracked. Never grep the real token through a shell-expanded command.
- **mode + owner:** in-container `stat -c '%a %U'` == `600 <daemon-effective-user>`.
- **subprocess isolation:** spawn a child with the sanitized env; dump env + argv and
  assert the whole leak set (above) is absent; assert `GH_TOKEN` is set **only** in an
  identity's per-invocation child, not the daemon env.
- **log redaction:** boot with a canary value; scan boot logs; assert absent.
- **deployment:** re-run the owner/redaction/isolation checks in **both** host and
  container contexts (the matrix in `git-platform-adapter.md` §5).

## Verify Run — evidence

**Probe:** `scripts/dev/probes/su4-credential-probe.mjs` (standalone; covers every
setup invariant that does not require the daemon loader). Sanitized — no secret
value is printed, only key names/shapes.

**Run 1 — macOS host context, 2026-07-05 — RESULT: PASS 8/8:**

```
PASS  load: >=1 identity PAT present by shape — identities=[KANTHORDVERIFY]
PASS  load: model API key optional — none configured — provider uses OAuth/subscription, or key lives outside the keyring
PASS  mode == 600 — mode=600
PASS  owner == effective user — owner=tuanatelsa effective=tuanatelsa
PASS  git check-ignore prints path — .data/kanthord/credentials
PASS  no secret value in any tracked file — clean
PASS  child env free of leak set — clean
PASS  child argv free of secret values — argv clean
RESULT: PASS — 8/8 checks
```

Covered: load-by-shape (git PAT; model key optional — none configured, OAuth/
subscription backend), mode `600`, owner == effective user, git-ignored, no tracked
leak (canary), child-env leak-set absent, argv clean.

**Deferred (not maintainer-checkable at gate time):**
- **daemon boot-log redaction** — needs the daemon config loader → consuming epic
  (013/014 Story 000) AC.
- **in-container (`--userns=keep-id`) owner check** — re-run the probe via
  `make shell` when the container owner context is exercised; host run above covers
  native-on-Mac. (Same probe, run inside the daemon's runtime context.)
