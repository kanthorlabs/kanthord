#!/usr/bin/env bash
# drive-run.sh — /e2e phase P3. The RESILIENT phase: run the daemon in bounded
# rounds, preserve evidence for everything that goes wrong, unblock what can be
# unblocked mechanically, and keep going so one run surfaces as many issues as
# possible.
#
# Design rules (each one is load-bearing):
#   * Machine interface = the DAEMON'S OWN stderr summary (`task failed: <id> — …`,
#     `N objective(s) awaiting confirmation`, `N initiative(s) landed`) plus the
#     `--json` read models. e2e-status.sh is a human dashboard and is only
#     appended to the log — never parsed.
#   * Only ONE transition is safe to make unattended: approving an objective that
#     is already `awaiting_confirmation`. Retrying a failed task is a judgement
#     call (it costs another real model call on the same deterministic failure),
#     so it happens automatically only in round 1 and then only up to
#     E2E_MAX_ATTEMPTS; after that the run stops as `blocked` and the agent
#     decides, with a `retry task --note …` that carries diagnosis.
#   * Resumable: state and attempt counters live in the run dir, so after the
#     agent retries something by hand this script can simply be run again.
#   * Outcome is explicit — `landed` / `blocked` / `failed` in state.json. It is
#     NOT "always exit 0": a harness that always claims success erases the
#     difference between proving the feature and proving nothing.
#
# Usage: E2E_TAG=<tag> scripts/e2e/drive-run.sh
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-common.sh"

LOG="$E2E_RUN_DIR/logs/p3-drive-run.log"
exec 3>&1
log() { echo "$*" | tee -a "$LOG" >&3; }

[ "$(e2e_state_get p2 || echo no)" = "passed" ] || e2e_die "run setup-graph.sh first"

INIT="$(e2e_state_need initiativeId)"
ATTEMPTS="$E2E_RUN_DIR/attempts.json"
[ -f "$ATTEMPTS" ] || echo '{}' >"$ATTEMPTS"

attempt_count() { jq -r --arg id "$1" '.[$id] // 0' "$ATTEMPTS"; }
attempt_bump() {
  local tmp="$ATTEMPTS.tmp"
  jq --arg id "$1" '.[$id] = ((.[$id] // 0) + 1)' "$ATTEMPTS" >"$tmp" && mv "$tmp" "$ATTEMPTS"
}

# One immutable snapshot of everything that matters, per round.
snapshot() {
  local out="$1"
  local tasks
  tasks="$(e2e_kanthord list task --initiative "$INIT" --json 2>>"$LOG" || echo '[]')"
  TASKS="$tasks" INITIATIVE="$INIT" DB="$KANTHORD_DB" node -e '
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.env.DB);
const init=process.env.INITIATIVE;
const tasks=JSON.parse(process.env.TASKS||"[]").map((t)=>({
  id:t.id, title:t.title, status:t.status,
  dependencies:t.dependencies||[], waiting:t.waiting||[],
})).sort((a,b)=>a.id.localeCompare(b.id));
const initiative=db.prepare("SELECT status FROM initiatives WHERE id = ?").get(init);
const objectives=db.prepare("SELECT id,name,status FROM objectives WHERE initiativeId = ? ORDER BY id").all(init);
const events=db.prepare("SELECT COUNT(*) n FROM events").get().n;
process.stdout.write(JSON.stringify({
  initiative: initiative ? initiative.status : "unknown",
  objectives, tasks, events,
}, null, 2));
' >"$out"
}

# Events since the stored cursor. The cursor advances only after a page is fully
# written, so an interrupted round re-reads rather than skips.
drain_events() {
  local round="$1" cursor page next
  cursor="$(e2e_state_get eventCursor || echo 0)"
  while :; do
    page="$(e2e_kanthord list event --after "$cursor" --limit 1000 --json 2>>"$LOG" || echo '')"
    [ -n "$page" ] || return 0
    jq -c --arg round "$round" '.events[]? | {round:$round} + .' <<<"$page" \
      >>"$E2E_RUN_DIR/snapshots/events.jsonl"
    next="$(jq -r '.nextCursor // empty' <<<"$page")"
    [ -n "$next" ] && [ "$next" != "$cursor" ] || return 0
    cursor="$next"
    e2e_state_set eventCursor "$cursor"
  done
}

ROUND="$(e2e_state_get round || echo 0)"
OUTCOME="running"

while [ "$ROUND" -lt "$E2E_MAX_ROUNDS" ]; do
  ROUND=$((ROUND + 1))
  e2e_state_set round "$ROUND"
  ROUND_LOG="$E2E_RUN_DIR/logs/p3-round-$ROUND.log"
  SNAP="$E2E_RUN_DIR/snapshots/round-$ROUND.json"
  log ""
  log "== round $ROUND/$E2E_MAX_ROUNDS — daemon (timeout ${E2E_ROUND_TIMEOUT}s)"

  # SIGINT first: the daemon wires it to a clean stop so the in-flight task ends
  # tidily. SIGKILL only if it ignores that.
  RC=0
  timeout -s INT -k 30 "$E2E_ROUND_TIMEOUT" \
    node "$E2E_REPO_ROOT/src/main.ts" run daemon --until-idle --poll-interval 2000 \
    >"$ROUND_LOG" 2>&1 || RC=$?
  e2e_redact <"$ROUND_LOG" >"$ROUND_LOG.redacted" && mv "$ROUND_LOG.redacted" "$ROUND_LOG"
  log "daemon exit=$RC (log: $ROUND_LOG)"

  if [ "$RC" = "124" ] || [ "$RC" = "137" ]; then
    # The kill may have interrupted a task mid-flight; the next round re-reads
    # real state rather than assuming anything about it.
    e2e_finding P3 round-timeout major \
      "daemon hit the ${E2E_ROUND_TIMEOUT}s round timeout and was stopped" round="$ROUND" log="$ROUND_LOG"
  fi

  # --- daemon's own summary lines -----------------------------------------
  while IFS= read -r line; do
    TASK_ID="$(sed -E 's/^task failed: ([^ ]+) .*/\1/' <<<"$line")"
    REASON="$(sed -E 's/^task failed: [^ ]+ [—-]+ //' <<<"$line")"
    SEV=major
    case "$REASON" in
      *"no AI provider available"* | *provider_chain_exhausted*) SEV=critical ;;
    esac
    e2e_finding P3 task-failed "$SEV" "$REASON" round="$ROUND" taskId="$TASK_ID" log="$ROUND_LOG"
  done < <(grep -E '^task failed: ' "$ROUND_LOG" || true)

  grep -E '^[0-9]+ (task|objective|initiative)' "$ROUND_LOG" >>"$LOG" 2>/dev/null || true

  snapshot "$SNAP"
  drain_events "$ROUND"
  "$E2E_REPO_ROOT/scripts/e2e/e2e-status.sh" "$INIT" >>"$LOG" 2>&1 || true

  INIT_STATUS="$(jq -r '.initiative' "$SNAP")"
  log "initiative=$INIT_STATUS tasks=$(jq -r '[.tasks[].status] | join(",")' "$SNAP")"
  log "objectives=$(jq -r '[.objectives[].status] | join(",")' "$SNAP")"

  # --- terminal: the initiative landed -----------------------------------
  if [ "$INIT_STATUS" = "landed" ]; then
    OUTCOME="landed"
    log "initiative is landed"
    break
  fi
  if [ "$INIT_STATUS" = "discarded" ]; then
    e2e_finding P3 initiative-discarded critical "the initiative ended up discarded" round="$ROUND"
    OUTCOME="failed"
    break
  fi

  # --- the one safe unattended transition --------------------------------
  APPROVED=0
  while IFS= read -r obj; do
    [ -n "$obj" ] || continue
    log "approve objective $obj (automated orchestration of a human-gated command)"
    if e2e_kanthord approve objective --id "$obj" >>"$LOG" 2>&1; then
      APPROVED=$((APPROVED + 1))
    else
      e2e_finding P3 approve-objective-failed major \
        "approve objective refused for $obj" round="$ROUND" objectiveId="$obj"
    fi
  done < <(jq -r '.objectives[] | select(.status=="awaiting_confirmation") | .id' "$SNAP")

  # A conflicted objective needs its base re-read, then another daemon pass.
  RETRIED_OBJ=0
  while IFS= read -r obj; do
    [ -n "$obj" ] || continue
    e2e_finding P3 objective-conflict major \
      "objective $obj is in conflict; retrying it" round="$ROUND" objectiveId="$obj"
    e2e_kanthord retry objective --id "$obj" --note "e2e round $ROUND: base moved" >>"$LOG" 2>&1 &&
      RETRIED_OBJ=$((RETRIED_OBJ + 1))
  done < <(jq -r '.objectives[] | select(.status=="conflict") | .id' "$SNAP")

  # --- failed tasks: bounded, and only unattended in round 1 -------------
  RETRIED=0
  BLOCKED_TASKS=0
  while IFS= read -r task; do
    [ -n "$task" ] || continue
    N="$(attempt_count "$task")"
    if [ "$ROUND" = "1" ] && [ "$N" -lt "$E2E_MAX_ATTEMPTS" ]; then
      attempt_bump "$task"
      log "retry task $task (attempt $((N + 1))/$E2E_MAX_ATTEMPTS, first round only)"
      e2e_kanthord retry task --id "$task" --note "e2e round $ROUND: automatic first retry" \
        >>"$LOG" 2>&1 && RETRIED=$((RETRIED + 1))
    else
      BLOCKED_TASKS=$((BLOCKED_TASKS + 1))
      e2e_finding P3 needs-agent-decision major \
        "task $task is failed and will not be retried automatically (attempts=$N, round=$ROUND) — diagnose it and run: kanthord retry task --id $task --note '<diagnosis>'" \
        round="$ROUND" taskId="$task"
    fi
  done < <(jq -r '.tasks[] | select(.status=="failed") | .id' "$SNAP")

  # An escalation is the agent asking a human a question; never auto-approve it.
  while IFS= read -r task; do
    [ -n "$task" ] || continue
    BLOCKED_TASKS=$((BLOCKED_TASKS + 1))
    e2e_finding P3 task-escalated major \
      "task $task escalated to awaiting_confirmation — read the proposal, then approve or retry it" \
      round="$ROUND" taskId="$task"
  done < <(jq -r '.tasks[] | select(.status=="awaiting_confirmation") | .id' "$SNAP")

  # --- no-progress detection ---------------------------------------------
  # "Nothing changed" only counts when the snapshot is byte-identical AND this
  # round performed no transition — otherwise the next round has real work.
  if [ "$ROUND" -gt 1 ]; then
    PREV="$E2E_RUN_DIR/snapshots/round-$((ROUND - 1)).json"
    if [ -f "$PREV" ] && cmp -s "$PREV" "$SNAP" &&
      [ "$APPROVED" = "0" ] && [ "$RETRIED" = "0" ] && [ "$RETRIED_OBJ" = "0" ]; then
      e2e_finding P3 stalled major \
        "two identical snapshots with no transition available — the run cannot progress on its own" round="$ROUND"
      OUTCOME="blocked"
      break
    fi
  fi

  if [ "$BLOCKED_TASKS" -gt 0 ] && [ "$APPROVED" = "0" ] && [ "$RETRIED" = "0" ] && [ "$RETRIED_OBJ" = "0" ]; then
    log "$BLOCKED_TASKS task(s) need an agent decision — stopping so the diagnosis happens before more model spend"
    OUTCOME="blocked"
    break
  fi
done

if [ "$OUTCOME" = "running" ]; then
  e2e_finding P3 round-budget-exhausted major \
    "used all $E2E_MAX_ROUNDS rounds without landing the initiative" round="$ROUND"
  OUTCOME="blocked"
fi

e2e_state_set p3 "$OUTCOME"
log ""
log "P3 finished — outcome=$OUTCOME after $ROUND round(s)"
case "$OUTCOME" in
  landed)
    log "next: scripts/e2e/contract-proof.sh"
    exit 0
    ;;
  *)
    log "next: read $E2E_FINDINGS, fix or retry, then re-run this script (it resumes)"
    log "      or go straight to scripts/e2e/e2e-report.sh to write up what happened"
    exit 1
    ;;
esac
