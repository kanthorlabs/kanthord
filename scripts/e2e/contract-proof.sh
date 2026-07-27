#!/usr/bin/env bash
# contract-proof.sh — /e2e phase P4. The program-level proof, run OUTSIDE the
# model's reach.
#
# Why not just trust the in-repo suite: the agent had write access to the whole
# clone. So this script materialises the landed tree, throws away whatever is in
# its `test/` directory, drops the HARNESS's own copy of the contract in its
# place, and runs that. Nothing the agent did to the tests can change the result.
# It then boots the real service twice on one database file to prove persistence
# through the real boot path (`src/main.mjs`), not just through unit tests.
#
# A failure here is `outcome=failed` — not "just a finding". If the program is not
# proven, the run did not succeed.
#
# Usage: E2E_TAG=<tag> scripts/e2e/contract-proof.sh
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-common.sh"

LOG="$E2E_RUN_DIR/logs/p4-contract-proof.log"
exec 3>&1
log() { echo "$*" | tee -a "$LOG" >&3; }

INIT="$(e2e_state_need initiativeId)"
REPO="$(e2e_state_need repositoryId)"
FIXTURE_BRANCH="$(e2e_state_need fixtureBranch)"
FIXTURE_OID="$(e2e_state_need fixtureOid)"
HOME_DIR="$E2E_RUN_DIR/home"
BRANCH="kanthord/init/$INIT"

P3="$(e2e_state_get p3 || echo missing)"
if [ "$P3" != "landed" ]; then
  e2e_finding P4 proof-blocked critical \
    "the program proof could not run: P3 outcome was '$P3', so there is nothing landed to prove"
  e2e_state_set outcome "blocked"
  e2e_die "P3 outcome is '$P3' — land the initiative first (or write the report and stop)"
fi

log "== P4 contract proof — $BRANCH"

# --- 1. materialise the WHOLE landed tree ---------------------------------
TREE="$(mktemp -d)/landed"
mkdir -p "$TREE"
git -C "$HOME_DIR" rev-parse --verify "$BRANCH" >/dev/null 2>&1 ||
  e2e_die "$BRANCH does not exist in the managed home $HOME_DIR"
LANDED_OID="$(git -C "$HOME_DIR" rev-parse "$BRANCH")"
e2e_state_set landedOid "$LANDED_OID"
git -C "$HOME_DIR" archive "$BRANCH" | tar -x -C "$TREE"
log "1. extracted ${LANDED_OID:0:8} — $(find "$TREE" -type f | wc -l | tr -d ' ') files"

# --- 2. replace the oracle with the harness's own copy --------------------
[ -d "$E2E_RUN_DIR/fixture/test" ] || e2e_die "the harness fixture copy is missing"
if ! diff -rq "$E2E_RUN_DIR/fixture/test" "$TREE/test" >"$LOG.testdiff" 2>&1; then
  e2e_finding P4 tests-modified major \
    "the landed tree's test/ differs from the fixture contract — the agent changed the oracle (see $LOG.testdiff)"
fi
rm -rf "$TREE/test"
cp -R "$E2E_RUN_DIR/fixture/test" "$TREE/test"
log "2. oracle restored from the harness copy"

# --- 3. the contract suite ------------------------------------------------
PROOF_OK=1
if (cd "$TREE" && node --test "test/**/*.contract.test.mjs" >>"$LOG" 2>&1); then
  log "3. contract suite PASSED against the harness-owned tests"
else
  PROOF_OK=0
  SUMMARY="$(grep -E '^. (tests|pass|fail) ' "$LOG" | tail -3 | tr '\n' ' ')"
  e2e_finding P4 contract-suite-failed critical \
    "the harness-owned contract suite fails on the landed tree ($SUMMARY)" log="$LOG"
  log "3. contract suite FAILED — see $LOG"
fi

# --- 4. the real boot path, twice, on one database ------------------------
# Proves persistence end to end: src/main.mjs -> createServer -> createStore.
PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
DBFILE="$TREE/proof.sqlite"
boot() {
  (cd "$TREE" && TODO_DB="$DBFILE" PORT="$PORT" node src/main.mjs >>"$LOG" 2>&1) &
  BOOT_PID=$!
  for _ in $(seq 1 40); do
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/tasks"; then return 0; fi
    kill -0 "$BOOT_PID" 2>/dev/null || return 1
    sleep 0.25
  done
  return 1
}
stop_boot() { kill "$BOOT_PID" 2>/dev/null || true; wait "$BOOT_PID" 2>/dev/null || true; }

if boot; then
  CREATED="$(curl -sS -X POST "http://127.0.0.1:$PORT/tasks" \
    -H 'content-type: application/json' \
    -d '{"title":"survives-a-restart","dueDate":"2026-08-01"}')"
  TASK_ID="$(jq -r '.id // empty' <<<"$CREATED")"
  stop_boot
  if [ -z "$TASK_ID" ]; then
    PROOF_OK=0
    e2e_finding P4 boot-post-failed critical "POST /tasks through the real boot path returned no id: $CREATED"
  elif boot; then
    AFTER="$(curl -sS "http://127.0.0.1:$PORT/tasks/$TASK_ID")"
    stop_boot
    if [ "$(jq -r '.title // empty' <<<"$AFTER")" = "survives-a-restart" ]; then
      log "4. restart persistence PASSED — the task survived a full process restart"
    else
      PROOF_OK=0
      e2e_finding P4 persistence-not-proven critical \
        "a task created before the restart was not readable after it: $AFTER"
    fi
  else
    PROOF_OK=0
    e2e_finding P4 boot-failed critical "the service did not come up on the second boot (see $LOG)"
  fi
else
  stop_boot
  PROOF_OK=0
  e2e_finding P4 boot-failed critical "the service did not come up via src/main.mjs (see $LOG)"
fi

if [ "$PROOF_OK" != "1" ]; then
  e2e_state_set p4 "failed"
  e2e_state_set outcome "failed"
  log ""
  log "P4 FAILED — the program is not proven. Next: scripts/e2e/e2e-report.sh"
  exit 1
fi
e2e_state_set p4 "passed"

# --- 5. delivery mode: publish to the real remote ------------------------
if [ "$E2E_MODE" != "delivery" ]; then
  e2e_state_set outcome "passed"
  log ""
  log "P4 PASSED (mode=local — nothing was published). Next: scripts/e2e/e2e-report.sh"
  exit 0
fi

e2e_git_auth
REMOTE_FIXTURE="$(git ls-remote --heads "$(e2e_remote_url)" "refs/heads/$FIXTURE_BRANCH" | awk '{print $1}')"
[ "$REMOTE_FIXTURE" = "$FIXTURE_OID" ] ||
  e2e_die "the fixture branch moved on the remote (${REMOTE_FIXTURE:0:8} != ${FIXTURE_OID:0:8}) — refusing to publish"

log ""
log "About to publish to a real remote:"
log "  remote      : $(e2e_remote_url)"
log "  source      : $BRANCH @ ${LANDED_OID:0:8} (in the managed home)"
log "  destination : refs/heads/$BRANCH  (new branch; $E2E_GH_BASE_BRANCH is never touched)"
if [ "${E2E_CONFIRM_PUBLISH:-0}" != "1" ]; then
  [ -t 0 ] || e2e_die "publish needs consent: re-run with E2E_CONFIRM_PUBLISH=1"
  printf 'Type the branch name to confirm the publish: ' >&3
  read -r ANSWER
  [ "$ANSWER" = "$BRANCH" ] || e2e_die "publish not confirmed — nothing was pushed"
fi

PUB_RC=0
e2e_kanthord publish repository --repository "$REPO" --branch "$BRANCH" >>"$LOG" 2>&1 || PUB_RC=$?
REMOTE_OID="$(git ls-remote --heads "$(e2e_remote_url)" "refs/heads/$BRANCH" | awk '{print $1}')"
if [ "$PUB_RC" = "0" ] && [ "$REMOTE_OID" = "$LANDED_OID" ]; then
  e2e_state_set publishedOid "$REMOTE_OID"
  e2e_state_set outcome "passed"
  log "5. published — remote $BRANCH @ ${REMOTE_OID:0:8} matches the landed commit"
else
  e2e_finding P4 publish-failed critical \
    "publish exited $PUB_RC and the remote ref is '${REMOTE_OID:-<absent>}' (expected $LANDED_OID)" log="$LOG"
  e2e_state_set outcome "failed"
  log "5. publish FAILED"
  exit 1
fi

log ""
log "P4 PASSED (delivery). Next: scripts/e2e/e2e-report.sh"
