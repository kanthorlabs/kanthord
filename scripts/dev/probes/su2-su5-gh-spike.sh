#!/usr/bin/env bash
# SU2 + SU1(HTTPS auth) + SU5 live spike — maintainer-run against a SCRATCH repo.
#
# Covers, against a least-privilege per-identity PAT on a throwaway repo:
#   SU2 : gh pr create / list --head / view (--json shapes); duplicate-create
#         stderr; auth-failure shape; rate-limit signal.
#   SU1 : git push over HTTPS via http.extraHeader (token NOT in argv/url);
#         auth failure without an interactive prompt (GIT_TERMINAL_PROMPT=0).
#   SU5 : branch push -> PR open -> PR close cycle; daemon-token MERGE attempt
#         is REJECTED by the ruleset (status + redacted body).
#
# The token is NEVER passed in argv or the remote URL. All output is scrubbed of
# the token value before it hits the transcript. Everything runs on a scratch
# branch and is cleaned up (Epic 011 safety boundary).
#
# Usage:
#   export GH_TOKEN=github_pat_...           # least-privilege PAT (Contents+PR write)
#   export REPO=kanthorlabs/kanthord-verify  # scratch repo, owner/name
#   ./scripts/dev/probes/su2-su5-gh-spike.sh
#
# Output: a sanitized transcript at scripts/dev/probes/su2-su5-transcript.txt
# Prereqs: gh (>=2.0), git (>=2.31), a ruleset on `main` requiring a human review
#          + no bypass for the daemon identity (see proof-run.md posture).

set -u
: "${GH_TOKEN:?set GH_TOKEN to the scratch PAT}"
: "${REPO:?set REPO to owner/name of the scratch repo}"

# Absolute path — the script cd's into a temp clone dir later, so a relative
# path would break every `tee -a "$OUT"` after that cd.
OUT="$(cd "$(dirname "$0")" && pwd)/su2-su5-transcript.txt"
BRANCH="probe/su-$(date +%s)"
WORK="$(mktemp -d)"
# Scrub the token (and any Authorization header) from everything we record.
# Scrub: the exact token, ANY github/gh token by prefix (catches gh's own
# partially-masked "github_pat_XXXX_****" output), and Basic/Bearer header values.
redact() {
  sed -E \
    -e "s#${GH_TOKEN}#***TOKEN***#g" \
    -e 's#(github_pat_|ghp_|gho_|ghs_|ghu_|ghr_)[A-Za-z0-9_]+#\1***#g' \
    -e 's#(Bearer|Basic) [A-Za-z0-9+/=_-]+#\1 ***#g'
}
log() { echo "$@" | redact | tee -a "$OUT"; }
# Capture the COMMAND's exit (PIPESTATUS[0]) before `log` runs its own pipeline
# and overwrites PIPESTATUS — otherwise we'd record tee's exit, not the command's.
run() { log "\$ $*"; "$@" 2>&1 | redact | tee -a "$OUT"; local rc=${PIPESTATUS[0]}; log "[exit $rc]"; log ""; }

: > "$OUT"
log "# SU2/SU1-HTTPS/SU5 live spike — $(date -u +%FT%TZ)"
log "repo=$REPO  branch=$BRANCH  (token redacted)"
log ""

# --- Preflight (verifySetup shape) -----------------------------------------
log "## Preflight"
run gh --version
run git --version
run gh auth status   # uses GH_TOKEN from env; must show the token is active

# --- Seed a scratch branch with one commit ---------------------------------
log "## Seed scratch branch (SU1 HTTPS push via http.extraHeader)"
git clone "https://github.com/${REPO}.git" "$WORK/repo" 2>&1 | redact | tee -a "$OUT"
cd "$WORK/repo" || exit 2
git checkout -b "$BRANCH" 2>&1 | redact | tee -a "$OUT"
echo "probe $(date -u +%FT%TZ)" > "probe-$(date +%s).txt"
git -c user.name="kanthord-probe" -c user.email="probe@kanthord.local" \
    add -A && git -c user.name="kanthord-probe" -c user.email="probe@kanthord.local" \
    commit -q -m "probe: SU spike" 2>&1 | redact | tee -a "$OUT"

# HTTPS push with the token in an env-config extraHeader — NOT in argv/url.
# MECHANISM (spike-confirmed 2026-07-05): GitHub git-over-HTTPS wants Basic auth,
# base64("x-access-token:<token>"). Bearer is REJECTED ("invalid credentials").
BASIC=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
log "\$ git push (token via GIT_CONFIG extraHeader = Authorization: Basic, host-scoped)"
GIT_TERMINAL_PROMPT=0 \
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0="http.https://github.com/.extraHeader" \
GIT_CONFIG_VALUE_0="Authorization: Basic ${BASIC}" \
  git push origin "$BRANCH" 2>&1 | redact | tee -a "$OUT"
log "[push exit ${PIPESTATUS[0]}]"; log ""

# --- SU1: auth failure without a prompt (bad token, must NOT hang) ----------
log "## SU1 auth-failure without prompt (bad token; GIT_TERMINAL_PROMPT=0)"
BADBASIC=$(printf 'x-access-token:%s' "github_pat_BOGUS000" | base64 | tr -d '\n')
GIT_TERMINAL_PROMPT=0 \
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0="http.https://github.com/.extraHeader" \
GIT_CONFIG_VALUE_0="Authorization: Basic ${BADBASIC}" \
  git ls-remote "https://github.com/${REPO}.git" 2>&1 | redact | tee -a "$OUT"
log "[bad-auth exit ${PIPESTATUS[0]} — expect non-zero, no hang]"; log ""

# --- SU2: create PR --------------------------------------------------------
# NOTE: `gh pr create --json` needs gh >= 2.37; create prints the PR URL on
# stdout on all versions, and we read structured fields via `gh pr list --head
# --json` below — so keep create version-portable (no --json here).
log "## SU2 gh pr create"
run gh pr create --repo "$REPO" --head "$BRANCH" --base main \
  --title "probe: SU spike" --body "throwaway; auto-closed"
PR=$(gh pr list --repo "$REPO" --head "$BRANCH" --state all --json number --jq '.[0].number' 2>/dev/null)
log "PR number = ${PR:-NONE}"; log ""

# --- SU2: find by head (reconcile key) + view ------------------------------
log "## SU2 gh pr list --head (reconcile correlation key)"
run gh pr list --repo "$REPO" --head "$BRANCH" --state all \
  --json number,state,headRefName,url
log "## SU2 gh pr view <n>"
run gh pr view "$PR" --repo "$REPO" --json number,state,mergedAt,isDraft,headRefName

# --- SU2: duplicate create (idempotency-by-head stderr shape) ---------------
log "## SU2 duplicate create (expect 'already exists' stderr)"
run gh pr create --repo "$REPO" --head "$BRANCH" --base main \
  --title "dup" --body "dup"

# --- SU2: auth-failure shape (bogus token) ---------------------------------
log "## SU2 auth-failure shape (bogus GH_TOKEN)"
log "\$ GH_TOKEN=bogus gh pr list --repo $REPO"
GH_TOKEN="github_pat_BOGUS000" gh pr list --repo "$REPO" 2>&1 | redact | tee -a "$OUT"
log "[exit ${PIPESTATUS[0]}]"; log ""

# --- SU2: rate-limit signal ------------------------------------------------
log "## SU2 rate-limit signal (x-ratelimit-* headers)"
run gh api -i rate_limit --jq '.rate'

# --- SU5: daemon-token MERGE attempt must be REJECTED ----------------------
# Guard: only run the merge attempt if `main` is actually protected by a ruleset
# / branch protection. Merging an UNPROTECTED main would "fail open" and give a
# false negative — so skip (do NOT merge) and flag it instead.
log "## SU5 merge attempt with daemon token (expect REJECT: 405/403/422)"
RULES=$(gh api "/repos/${REPO}/rules/branches/main" 2>/dev/null)
if [ "$(echo "$RULES" | tr -d '[:space:]')" = "[]" ] || [ -z "$RULES" ]; then
  log "SKIPPED — main has NO active ruleset/branch protection. Merging now would"
  log "fail open (daemon token could merge). Create the ruleset (proof-run.md"
  log "posture), then re-run this step. NOT merging."
else
  log "active rules on main:"; echo "$RULES" | redact | tee -a "$OUT"
  log "\$ gh api -i -X PUT /repos/$REPO/pulls/$PR/merge"
  gh api -i -X PUT "/repos/${REPO}/pulls/${PR}/merge" 2>&1 | redact | tee -a "$OUT"
  log "[merge-attempt exit ${PIPESTATUS[0]} — non-zero == rejected == PASS]"
fi
log ""

# --- SU5: cleanup (close PR, delete branch) --------------------------------
log "## SU5 cleanup"
run gh pr close "$PR" --repo "$REPO" --delete-branch
cd / && rm -rf "$WORK"

log "## DONE — transcript at $OUT (token redacted; review before pasting)"
echo ""
echo "Transcript written to: $OUT"
echo "Review it, then paste the relevant blocks into:"
echo "  - github-api.md   (SU2: --json shapes, duplicate stderr, auth shape, rate-limit)"
echo "  - git-cli.md      (SU1: HTTPS push ok + bad-auth-no-prompt)"
echo "  - proof-run.md    (SU5: push/PR/close cycle + merge-rejection status/body)"
