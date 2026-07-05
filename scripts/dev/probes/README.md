# Epic 011 setup probes

Maintainer-run probes that produce the recorded evidence Epic 011's gate needs.
All run against **scratch-only** targets with a **least-privilege PAT** (Epic 011
safety boundary). Tokens are never put in argv/URLs and are redacted from output.

## SU1 — process-group kill (DONE, no token)

Verifies a hung git network op is killed as a whole process group (no orphaned
`git-remote-http`). Runs in Linux:

```sh
podman run --rm -v "$PWD/scripts/dev/probes:/probes:ro" node:24-slim \
  sh -c 'apt-get update -qq && apt-get install -y -qq git procps && node /probes/su1-kill-probe.mjs'
```

Result recorded in `.agent/plan/feedback/014-real-broker-minimal-path/git-cli.md`.

## SU4 — credential custody (needs the real credentials file)

1. Create the file (env-style, flat, 0600) with your real scratch PAT:
   ```sh
   mkdir -p .data/kanthord && umask 077
   cat > .data/kanthord/credentials <<'EOF'
   KANTHOR_IDENTITY_KANTHORDVERIFY_TOKEN=github_pat_...your_scratch_pat...  # key name must match the slot's identity
   # KANTHOR_MODEL_API_KEY=sk-ant-...  # OPTIONAL: only if the model provider
   #   uses an API key. OAuth/subscription backends (Codex, Copilot, pi-on-OAuth)
   #   need none — omit the line entirely.
   EOF
   chmod 600 .data/kanthord/credentials
   ```
2. Run in the daemon's runtime context (native, or `make shell` for the container
   owner check):
   ```sh
   node scripts/dev/probes/su4-credential-probe.mjs
   ```
Covers load/mode/owner/ignore/no-leak/subprocess-isolation. Daemon **boot-log
redaction** is deferred to the loader's epic (013/014 Story 000) — it needs the daemon.

## SU2 + SU1(HTTPS) + SU5 — live gh/git spike (needs scratch repo + PAT)

Prereq: the `kanthord-verify` scratch repo exists with a ruleset on `main`
(human review required, no daemon bypass — see `proof-run.md` posture).

```sh
export GH_TOKEN=github_pat_...   # scratch PAT (Contents + PR write)
export REPO=kanthorlabs/kanthord-verify
./scripts/dev/probes/su2-su5-gh-spike.sh
```
Writes a redacted transcript to `su2-su5-transcript.txt`. Paste blocks into:
- `github-api.md` (SU2: `--json` shapes, duplicate stderr, auth shape, rate-limit),
- `git-cli.md` (SU1: HTTPS push ok + bad-auth-no-prompt),
- `proof-run.md` (SU5: push/PR/close cycle + merge-rejection).
