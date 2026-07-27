#!/usr/bin/env bash
# preflight.sh — /e2e phase P0. FAIL FAST: verify every input, then publish the
# fixture branch that the run builds on.
#
# Nothing downstream is created until this passes, because a finding produced on
# top of a broken setup is noise, not a finding.
#
# What it proves (and what it deliberately does NOT claim):
#   * tooling + input syntax                                  — proven
#   * the AI endpoint is reachable and the key is not rejected — proven cheaply;
#     that the MODEL works is proven by `test ai-provider` in P1, through
#     kanthord's own adapter rather than a parallel curl implementation
#   * the GitHub token can READ the repo                       — proven
#   * the token can WRITE                                      — proven for real,
#     by pushing the fixture branch (API `permissions.push` is metadata, not proof)
#
# Usage: E2E_TAG=<tag> scripts/e2e/preflight.sh
# Push consent: interactive confirmation, or E2E_CONFIRM_PUSH=1.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-common.sh"

LOG="$E2E_RUN_DIR/logs/p0-preflight.log"
exec 3>&1
log() { echo "$*" | tee -a "$LOG" >&3; }

e2e_state_init
log "== P0 preflight — tag $E2E_TAG, repo $E2E_GH_REPO, mode $E2E_MODE"

# --- 1. tooling ------------------------------------------------------------
for tool in node git curl jq timeout; do
  command -v "$tool" >/dev/null 2>&1 || e2e_die "missing required tool: $tool"
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || e2e_die "node 24+ required, found $(node --version)"
log "tools ok — node $(node --version), git $(git --version | awk '{print $3}')"

# --- 2. inputs -------------------------------------------------------------
e2e_require_inputs
log "inputs ok — model $E2E_AI_MODEL, api $E2E_AI_API, effort $E2E_AI_EFFORT, ctx $E2E_AI_CONTEXT_WINDOW, max-tokens $E2E_AI_MAX_TOKENS"

# --- 3. base URL shape (same rules register-ai-provider enforces) ----------
node -e '
const raw = process.argv[1];
let url;
try { url = new URL(raw); } catch { console.error("not an absolute URL"); process.exit(1); }
if (url.protocol !== "http:" && url.protocol !== "https:") { console.error("not http(s)"); process.exit(1); }
if (url.username !== "" || url.password !== "") { console.error("embedded credentials"); process.exit(1); }
' "$E2E_AI_BASE_URL" || e2e_die "E2E_AI_BASE_URL is not a usable base URL: $E2E_AI_BASE_URL"
log "base URL ok — $E2E_AI_BASE_URL"

# --- 4. AI endpoint reachability (transport only, on purpose) --------------
AI_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $E2E_AI_API_KEY" "$E2E_AI_BASE_URL" 2>>"$LOG" || echo 000)"
case "$AI_STATUS" in
  000) e2e_die "cannot reach $E2E_AI_BASE_URL (DNS/TLS/connection). See $LOG" ;;
  401 | 403) e2e_die "AI endpoint rejected the key (HTTP $AI_STATUS)" ;;
  *) log "AI endpoint reachable — HTTP $AI_STATUS (model validity is proven in P1)" ;;
esac

# --- 5. GitHub token identity ---------------------------------------------
GH_LOGIN="$(e2e_gh /user | jq -r '.login // empty')" ||
  e2e_die "GitHub token rejected by /user"
[ -n "$GH_LOGIN" ] || e2e_die "GitHub /user returned no login — token invalid?"
log "github token ok — authenticated as $GH_LOGIN"

# --- 6. repo reachable + push metadata ------------------------------------
REPO_JSON="$(e2e_gh "/repos/$E2E_GH_REPO")" ||
  e2e_die "cannot read repo $E2E_GH_REPO with this token"
CAN_PUSH="$(jq -r '.permissions.push // false' <<<"$REPO_JSON")"
DEFAULT_BRANCH="$(jq -r '.default_branch // empty' <<<"$REPO_JSON")"
[ "$CAN_PUSH" = "true" ] ||
  e2e_die "token has no push permission on $E2E_GH_REPO (metadata says push=$CAN_PUSH)"
log "repo ok — $E2E_GH_REPO (default branch $DEFAULT_BRANCH, push metadata true)"

# --- 7. git read through the same plumbing kanthord uses -------------------
e2e_git_auth
REMOTE="$(e2e_remote_url)"
HEADS="$(git ls-remote --heads "$REMOTE" 2>>"$LOG")" ||
  e2e_die "git ls-remote failed for $REMOTE — see $LOG"
BASE_OID="$(awk -v ref="refs/heads/$E2E_GH_BASE_BRANCH" '$2==ref{print $1}' <<<"$HEADS")"
[ -n "$BASE_OID" ] ||
  e2e_die "branch '$E2E_GH_BASE_BRANCH' does not exist on $E2E_GH_REPO (set E2E_GH_BASE_BRANCH)"
e2e_state_set baseBranch "$E2E_GH_BASE_BRANCH"
e2e_state_set baseOid "$BASE_OID"
log "git read ok — $E2E_GH_BASE_BRANCH @ ${BASE_OID:0:8}"

# --- 8. fixture branch must not already exist -----------------------------
EXISTING="$(awk -v ref="refs/heads/$E2E_FIXTURE_BRANCH" '$2==ref{print $1}' <<<"$HEADS")"
if [ -n "$EXISTING" ] && [ "$E2E_FORCE_FIXTURE" != "1" ]; then
  e2e_die "fixture branch $E2E_FIXTURE_BRANCH already exists @ ${EXISTING:0:8} — pick a new E2E_TAG, or re-run with E2E_FORCE_FIXTURE=1 to replace it"
fi

# --- 9. write the fixture (the oracle; contract-proof.sh reuses this copy) --
rm -rf "$E2E_RUN_DIR/fixture"
"$E2E_REPO_ROOT/scripts/e2e/make-todo-service-fixture.sh" "$E2E_RUN_DIR/fixture" >>"$LOG"
FIXTURE_TESTS="$(find "$E2E_RUN_DIR/fixture/test" -name '*.contract.test.mjs' | wc -l | tr -d ' ')"
[ "$FIXTURE_TESTS" -ge 5 ] || e2e_die "fixture looks wrong — only $FIXTURE_TESTS contract test files"
log "fixture written — $FIXTURE_TESTS contract test files"

# The oracle must be RED against the stubs; a green fixture would prove nothing.
if (cd "$E2E_RUN_DIR/fixture" && node --test "test/**/*.contract.test.mjs" >>"$LOG" 2>&1); then
  e2e_die "the fixture contract suite PASSES against the stubs — the oracle is broken"
fi
log "fixture is red against the stubs, as required"

# --- 10. publish the fixture branch (a real write to a real remote) --------
log ""
log "About to WRITE to a real remote:"
log "  remote : $REMOTE"
log "  branch : $E2E_FIXTURE_BRANCH  (new orphan branch — $E2E_GH_BASE_BRANCH is never touched)"
if [ -n "$EXISTING" ]; then
  log "  NOTE   : replacing the existing branch @ ${EXISTING:0:8} (E2E_FORCE_FIXTURE=1)"
fi
if [ "${E2E_CONFIRM_PUSH:-0}" != "1" ]; then
  [ -t 0 ] || e2e_die "push needs consent: re-run with E2E_CONFIRM_PUSH=1 (non-interactive shell)"
  printf 'Type the branch name to confirm the push: ' >&3
  read -r ANSWER
  [ "$ANSWER" = "$E2E_FIXTURE_BRANCH" ] || e2e_die "push not confirmed — nothing was written"
fi

# An ORPHAN branch, not a branch off the base: the fixture is then a fixed,
# reproducible tree no matter what previous runs left behind on the base branch.
PUSH_DIR="$(mktemp -d)/fixture-push"
mkdir -p "$PUSH_DIR"
git -C "$PUSH_DIR" init -q -b "$E2E_FIXTURE_BRANCH"
cp -R "$E2E_RUN_DIR/fixture/." "$PUSH_DIR/"
git -C "$PUSH_DIR" add -A
git -C "$PUSH_DIR" -c user.email="e2e@kanthord.local" -c user.name="kanthord e2e" \
  commit -qm "e2e fixture: todo-service contract ($E2E_TAG)"
git -C "$PUSH_DIR" push -q --force "$REMOTE" "HEAD:refs/heads/$E2E_FIXTURE_BRANCH" 2>&1 |
  e2e_redact >>"$LOG"
FIXTURE_OID="$(git -C "$PUSH_DIR" rev-parse HEAD)"
e2e_state_set fixtureBranch "$E2E_FIXTURE_BRANCH"
e2e_state_set fixtureOid "$FIXTURE_OID"
log "fixture pushed — $E2E_FIXTURE_BRANCH @ ${FIXTURE_OID:0:8} (push scope PROVEN)"

# Confirm the remote really has it (a push that reported success but did not land
# would poison every later phase).
REMOTE_OID="$(git ls-remote --heads "$REMOTE" "refs/heads/$E2E_FIXTURE_BRANCH" | awk '{print $1}')"
[ "$REMOTE_OID" = "$FIXTURE_OID" ] ||
  e2e_die "fixture branch on the remote is $REMOTE_OID, expected $FIXTURE_OID"

e2e_state_set p0 "passed"
log ""
log "P0 PASSED — next: scripts/e2e/provider-cycle.sh"
