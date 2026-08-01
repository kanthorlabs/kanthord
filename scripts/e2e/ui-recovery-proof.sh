#!/usr/bin/env bash
# ui-recovery-proof.sh — EPIC 026.10 Proof (deterministic, no model, no outbound
# network — loopback and local git only — nothing left running).
#
# Proves, against REAL stopped work produced through the production path:
#   * POST /api/task/:id/reattempt re-readies a failed task, carries the 026.8
#     decision occurrence id, and CLOSES that occurrence as `resolved`,
#   * a stale (closed) occurrence id is 409 decision_closed, never 500,
#   * an ESCALATED task — awaiting_confirmation with NO candidate row — can be
#     reattempted at all, which no path can do today, and a blank guidance note
#     is refused,
#   * abandonment is lease-addressed: GET /api/task/:id carries `runJobId`, a
#     stale job id is 409 lease_moved, the current one is 202 `abandoning`, a
#     repeat is 202 `already_abandoning`, and after the drain it is lease_moved,
#   * POST /api/objective/:id/reattempt reports a DISCRIMINATED outcome, so a
#     still-conflicted objective is never reported as recovered,
#   * the task workspace renders the abandon control only for a running task,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# Each fixture gets its OWN temp directory and its OWN KANTHORD_DB. Phases C and
# E leave tasks `pending`, and phase F starts a LIVE daemon which would
# otherwise claim them and destroy the phase's determinism.
#
# EXPECTED FAILURE against the CURRENT tree: recorded in the EPIC.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PD="$(mktemp -d)"
SERVE_PID=""
DAEMON_PID=""
cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — must not equal '$2'" >&2; exit 1; }; }
jf() { node -e 'const v=JSON.parse(process.argv[1]).data;process.stdout.write(String(process.argv[2].split(".").reduce((a,k)=>a?.[k],v)))' "$1" "$2"; }
jv() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(eval(process.argv[1])))' "$1"; }
exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }

# poll <seconds> <command...> — the bounded wait from abandon-run-proof.sh:21.
poll() {
  local secs="$1"; shift
  local i=0
  while [ "$i" -lt $((secs * 5)) ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.2; i=$((i + 1))
  done
  echo "FAILED: condition never held within ${secs}s: $*" >&2
  return 1
}

cat > "$PD/sql.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const row = db.prepare(process.argv[2]).get(...process.argv.slice(3));
process.stdout.write(row === undefined ? "MISSING" : String(Object.values(row)[0]));
EOF
sql() { node "$PD/sql.mjs" "$@"; }
tstatus() { sql "SELECT status FROM tasks WHERE id = ?" "$1"; }
evcount() { sql "SELECT COUNT(*) AS n FROM events WHERE type = ? AND payload LIKE ?" "$1" "%$2%"; }

# start_serve — boots `serve` against the CURRENT $KANTHORD_DB and sets $BASE.
start_serve() {
  export KANTHORD_UI_DIST="$DIST"
  : > "$PD/serve.log"
  ( cd "$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
  SERVE_PID=$!
  local port=""
  for _ in $(seq 1 100); do
    if ! kill -0 "$SERVE_PID" 2>/dev/null; then
      echo "FAILED: serve exited during startup; log:" >&2; cat "$PD/serve.log" >&2; exit 1
    fi
    port="$(node -e '
      const { readFileSync } = require("node:fs");
      for (const line of readFileSync(process.argv[1], "utf8").split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try { const o = JSON.parse(line);
          if (o.msg === "listening" && typeof o.port === "number") { process.stdout.write(String(o.port)); break; }
        } catch {}
      }' "$PD/serve.log")"
    [ -n "$port" ] && break
    sleep 0.2
  done
  [ -n "$port" ] || { echo "FAILED: no listening log line; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }
  BASE="http://127.0.0.1:$port"
}
stop_serve() {
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; wait "$SERVE_PID" 2>/dev/null || true; fi
  SERVE_PID=""
}

# provision <dir> <name> — a migrated db, a project, a local bare remote, a
# registered provider whose key is never read, and an imported landing graph.
# Sets PROJECT, REPO, GRAPH and exports KANTHORD_DB for the caller.
provision() {
  local dir="$1" name="$2"
  mkdir -p "$dir"
  export KANTHORD_DB="$dir/kanthord.db"
  node src/main.ts db migrate >/dev/null
  PROJECT="$(node src/main.ts create project --name "$name")"
  local remote="$dir/repo.git" seed="$dir/repo-seed" mirror="$dir/repo-mirror"
  git init -q --bare -b main "$remote"
  git clone -q "$remote" "$seed"
  git -C "$seed" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" push -q origin main
  REPO="$(node src/main.ts create repository --project "$PROJECT" --name repo \
    --remote-url "file://$remote" --branch main --auth ambient --path "$mirror")"
  printf 'dummy' > "$dir/token"
  local prov
  prov="$(node src/main.ts register ai-provider --name "$name" --provider openai-codex \
    --model gpt-5.6-sol --value-file "$dir/token" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')"
  node src/main.ts assign ai-provider --project "$PROJECT" --provider "$prov" >/dev/null
  GRAPH="$dir/graph"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
  node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
    --bind source="$REPO" >/dev/null
}

# open_decision <taskId> — reads GET /api/queue FIRST, so 026.8's projection has
# reconciled and the occurrence exists. The occurrence is opened by the
# projection, not by the mutation, so a POST-then-inspect would race it.
open_decision() {
  local q
  q="$(curl -sS "$BASE/api/queue" -H "authorization: $BASIC")"
  node -e '
    const q = JSON.parse(process.argv[1]).data;
    const it = (q.items ?? []).find((i) => i.taskId === process.argv[2]);
    if (!it) { process.stderr.write("no queue item for the task\n"); process.exit(1); }
    if (!it.id) { process.stderr.write("the queue item has no occurrence id (026.8)\n"); process.exit(1); }
    process.stdout.write(it.id);' "$q" "$1"
}

echo "--- A: the build exists and the browser is installed"
BUILD_SCRIPT="$(node -e 'const fs=require("node:fs");const p=process.argv[1];process.stdout.write(fs.existsSync(p)?(JSON.parse(fs.readFileSync(p,"utf8")).scripts?.["build:ui"] ?? ""):"")' "$ROOT/package.json")"
ne "package.json defines build:ui (EPIC 026 S1)" "" "$BUILD_SCRIPT"
( cd "$ROOT" && npm run build:ui ) >"$PD/build.log" 2>&1 \
  || { echo "FAILED: npm run build:ui; log:" >&2; tail -30 "$PD/build.log" >&2; exit 1; }
DIST="$ROOT/ui/dist"
[ -f "$DIST/index.html" ] || { echo "FAILED: no $DIST/index.html" >&2; exit 1; }
node --input-type=module -e '
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true });
  await b.close();
' >"$PD/browser.log" 2>&1 || {
  echo "FAILED: Playwright Chromium is unavailable. Install it once, outside the Proof:" >&2
  echo "    npx playwright install chromium" >&2
  tail -5 "$PD/browser.log" >&2
  exit 1
}

echo "--- B: fixture 1 — a REAL failed task, through the real verification path"
provision "$PD/f1" proof-026-10-a
TASK1="$(exportval "$GRAPH" 'j.refToId.tasks["create-task"]')"
printf '[{"text":"did nothing"}]' > "$PD/noop-agent.json"
KANTHORD_FAKE_AGENT="$PD/noop-agent.json" \
  node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
eq "fixture 1: the root task really failed" "failed" "$(tstatus "$TASK1")"
start_serve
echo "    fixture 1 port: ${BASE##*:}   task: $TASK1"

echo "--- C: reattempt re-readies the task and RESOLVES the decision"
# Probe the capability under test FIRST, so a missing 026.10 route is named as
# such instead of hiding behind a predecessor's gap.
PROBE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/task/$TASK1/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' -d '{}')"
case "$PROBE" in
  404|405) echo "FAILED: POST /api/task/:id/reattempt does not exist (got $PROBE)" >&2; exit 1 ;;
esac
DEC1="$(open_decision "$TASK1")"
RE_BODY="$PD/reattempt.json"
RE_CODE="$(curl -sS -o "$RE_BODY" -w '%{http_code}' -X POST "$BASE/api/task/$TASK1/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"decisionId\":\"$DEC1\",\"note\":\"proof reattempt\"}")"
eq "reattempt is accepted" "200" "$RE_CODE"
eq "reattempt reports its outcome" "reattempted" "$(jf "$(cat "$RE_BODY")" "outcome")"
eq "the task is re-readied" "pending" "$(tstatus "$TASK1")"
ne "a task.ready event was appended" "0" "$(evcount "task.ready" "$TASK1")"
DEC1_STATE="$(jf "$(curl -sS "$BASE/api/queue/$DEC1" -H "authorization: $BASIC")" "state")"
eq "the reattempt RESOLVED the occurrence (026.8 decision 4)" "resolved" "$DEC1_STATE"

echo "--- D: a closed occurrence and a missing one are named states, never 500"
STALE_CODE="$(curl -sS -o "$PD/stale.json" -w '%{http_code}' -X POST "$BASE/api/task/$TASK1/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"decisionId\":\"$DEC1\",\"note\":\"stale tab\"}")"
eq "a closed occurrence is refused" "409" "$STALE_CODE"
eq "…with the shared 026.9 code" "decision_closed" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).error?.code))' "$(cat "$PD/stale.json")")"
NOID_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/task/$TASK1/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' -d '{}')"
eq "a reattempt with no occurrence id is invalid input" "400" "$NOID_CODE"
stop_serve

echo "--- E: fixture 2 — an ESCALATED task, reattemptable at last"
provision "$PD/f2" proof-026-10-b
TASK2="$(exportval "$GRAPH" 'j.refToId.tasks["create-task"]')"
# An `escalate` turn that edits NOTHING: the runner then produces
# outcome:"escalated" with proposalCommit undefined (src/agent-runner/pi.ts:718-742),
# and RunNextTask holds at awaiting_confirmation WITHOUT saving a candidate
# (src/app/task/run-next-task.ts:452-481).
printf '[{"toolCalls":[{"name":"escalate","arguments":{"reason":"the proof needs a human"}}]}]' \
  > "$PD/escalate-agent.json"
KANTHORD_FAKE_AGENT="$PD/escalate-agent.json" \
  node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
eq "fixture 2: the task really escalated" "awaiting_confirmation" "$(tstatus "$TASK2")"
eq "fixture 2: the escalation left NO candidate row" "0" \
  "$(sql "SELECT COUNT(*) AS n FROM landing_candidates WHERE task_id = ?" "$TASK2")"
start_serve
DEC2="$(open_decision "$TASK2")"
BLANK_CODE="$(curl -sS -o "$PD/blank.json" -w '%{http_code}' -X POST "$BASE/api/task/$TASK2/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"decisionId\":\"$DEC2\",\"note\":\"   \"}")"
eq "a blank guidance note is refused" "400" "$BLANK_CODE"
eq "…by name" "escalation_guidance_required" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).error?.code))' "$(cat "$PD/blank.json")")"
eq "the refused escalation did not move" "awaiting_confirmation" "$(tstatus "$TASK2")"
ANS_CODE="$(curl -sS -o "$PD/answer.json" -w '%{http_code}' -X POST "$BASE/api/task/$TASK2/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"decisionId\":\"$DEC2\",\"note\":\"use the seeded remote, not a new one\"}")"
eq "an answered escalation is reattempted" "200" "$ANS_CODE"
eq "the escalated task is re-readied" "pending" "$(tstatus "$TASK2")"
eq "the operator's answer is persisted as guidance" "use the seeded remote, not a new one" \
  "$(node src/main.ts get task --id "$TASK2" --json | jv 'v.note')"
stop_serve

echo "--- F: fixture 3 — abandonment is lease-addressed, asynchronous, and bounded"
provision "$PD/f3" proof-026-10-c
TASK3="$(exportval "$GRAPH" 'j.refToId.tasks["create-task"]')"
INIT3="$(exportval "$GRAPH" 'j.initiativeId')"
# Several SHORT sleeps, not one long one: the drain lands at tool-call
# boundaries (scripts/e2e/abandon-run-proof.sh:39-43).
cat > "$PD/slow-agent.json" <<'EOF'
[{"toolCalls":[{"name":"bash","arguments":{"command":"sleep 12"}}]},
 {"toolCalls":[{"name":"bash","arguments":{"command":"sleep 12"}}]},
 {"toolCalls":[{"name":"bash","arguments":{"command":"sleep 12"}}]},
 {"toolCalls":[{"name":"bash","arguments":{"command":"mkdir -p src && printf \"export default 1\\n\" > src/todo.mjs"}}]},
 {"text":"done"}]
EOF
start_serve
KANTHORD_FAKE_AGENT="$PD/slow-agent.json" \
  node src/main.ts run daemon --poll-interval 200 >"$PD/daemon.log" 2>&1 &
DAEMON_PID=$!
running() { [ "$(tstatus "$TASK3")" = "running" ]; }
poll 30 running
TASK_BODY="$(curl -sS "$BASE/api/task/$TASK3" -H "authorization: $BASIC")"
JOB="$(jf "$TASK_BODY" "runJobId")"
case "$JOB" in
  01*) ;;
  *) echo "FAILED: GET /api/task/:id carries no runJobId (got '$JOB')" >&2; exit 1 ;;
esac
MOVED_CODE="$(curl -sS -o "$PD/moved.json" -w '%{http_code}' -X POST "$BASE/api/task/$TASK3/abandonment" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d '{"expectedJobId":"01KYZZNOTTHELEASE00000000","reason":"proof"}')"
eq "a stale lease is refused" "409" "$MOVED_CODE"
eq "…by name" "lease_moved" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).error?.code))' "$(cat "$PD/moved.json")")"
AB1="$PD/abandon1.json"
AB1_CODE="$(curl -sS -o "$AB1" -w '%{http_code}' -X POST "$BASE/api/task/$TASK3/abandonment" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"expectedJobId\":\"$JOB\",\"reason\":\"the proof stops this run\"}")"
eq "abandonment is ACCEPTED, not completed" "202" "$AB1_CODE"
eq "the outcome is named" "abandoning" "$(jf "$(cat "$AB1")" "outcome")"
eq "the lease is echoed back" "$JOB" "$(jf "$(cat "$AB1")" "jobId")"
AB2="$PD/abandon2.json"
AB2_CODE="$(curl -sS -o "$AB2" -w '%{http_code}' -X POST "$BASE/api/task/$TASK3/abandonment" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"expectedJobId\":\"$JOB\",\"reason\":\"pressed twice\"}")"
eq "a repeat on the SAME lease is idempotent" "202" "$AB2_CODE"
eq "…and says so" "already_abandoning" "$(jf "$(cat "$AB2")" "outcome")"
drained() { [ "$(evcount "task.abandoned" "$TASK3")" != "0" ]; }
poll 40 drained
AB3_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/task/$TASK3/abandonment" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"expectedJobId\":\"$JOB\",\"reason\":\"after the drain\"}")"
eq "after the drain the lease has moved" "409" "$AB3_CODE"
kill -0 "$DAEMON_PID" 2>/dev/null || { echo "FAILED: the daemon died during abandonment" >&2; exit 1; }
echo "    fixture 3 lease: $JOB"

echo "--- H: the browser — the abandon control exists only while a run is held"
cat > "$PD/steps-running.mjs" <<'STEPS'
export default async ({ goto, visible, consoleErrors, requests, page }) => {
  const { PROOF_PROJECT: pid, PROOF_INIT: iid, PROOF_OBJ: oid, PROOF_TASK: tid } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  await goto(`#/project/${pid}/initiative/${iid}/objective/${oid}/task/${tid}`);
  eq("a running task offers abandon", true, await visible('[data-testid="recovery-abandon"]'));
  await page.locator('[data-testid="recovery-abandon"]').click();
  const before = requests.length;
  await page.locator('[data-testid="recovery-abandon-reason"]').fill("   ");
  await page.locator('[data-testid="danger-confirm"]').click();
  const sent = requests.slice(before).filter((r) => r.url.includes("/abandonment"));
  if (sent.length > 0) throw new Error("a blank reason still issued a request");
  await page.locator('[data-testid="recovery-abandon-reason"]').fill("the proof stops this run");
  await page.locator('[data-testid="danger-confirm"]').click();
  await page.waitForSelector('[data-testid="recovery-outcome"]');
  eq("no console error", 0, consoleErrors.length);
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
};
STEPS
OBJ3="$(exportval "$GRAPH" 'j.refToId.objectives["todo-api-obj"]')"
PROOF_PROJECT="$PROJECT" PROOF_INIT="$INIT3" PROOF_OBJ="$OBJ3" PROOF_TASK="$TASK3" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps-running.mjs" \
  || { echo "FAILED: browser phase H (running task)" >&2; exit 1; }
kill "$DAEMON_PID" 2>/dev/null || true; wait "$DAEMON_PID" 2>/dev/null || true; DAEMON_PID=""
stop_serve

echo "--- G: fixture 4 — objective conflict recovery reports a HONEST outcome"
provision "$PD/f4" proof-026-10-d
INIT4="$(exportval "$GRAPH" 'j.initiativeId')"
OBJ4="$(exportval "$GRAPH" 'j.refToId.objectives["todo-api-obj"]')"
# The CAS-mismatch recipe of scripts/e2e/decision-workbench-proof.sh:236-300: a
# second objective settles in the SAME daemon pass and is approved first, so the
# first objective's anchor is stale and its approval records a conflict.
OBJ4B="$(node src/main.ts create objective --initiative "$INIT4" --name "tip mover")"
node src/main.ts create task --objective "$OBJ4B" --title "move the tip" \
  --agent generic@1 --instructions "touch a file" --ac "the tip moves" \
  --verification "true" --context repository="$REPO" >/dev/null
node -e '
  const fs = require("node:fs");
  const base = JSON.parse(fs.readFileSync(process.argv[1] + "/.fake-agent.json", "utf8"));
  fs.writeFileSync(process.argv[2], JSON.stringify({
    "*": base,
    "move the tip": [
      { toolCalls: [{ name: "bash", arguments: { command: "mkdir -p src && printf \"tip mover\\n\" > src/tip-mover.txt" } }] },
      { text: "moved the tip" },
    ],
  }));' "$GRAPH" "$PD/combined-agent.json"
KANTHORD_FAKE_AGENT="$PD/combined-agent.json" \
  node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
OID4B="$(node src/main.ts get objective --id "$OBJ4B" --json | jv 'v.commitOid')"
node src/main.ts approve objective --id "$OBJ4B" --expected-commit "$OID4B" >/dev/null
OID4="$(node src/main.ts get objective --id "$OBJ4" --json | jv 'v.commitOid')"
node src/main.ts approve objective --id "$OBJ4" --expected-commit "$OID4" >/dev/null || true
eq "fixture 4: the objective really recorded a conflict" "conflict" \
  "$(node src/main.ts get objective --id "$OBJ4" --json | jv 'v.status')"
start_serve
DECO="$(curl -sS "$BASE/api/queue" -H "authorization: $BASIC" | node -e '
  const q = JSON.parse(require("fs").readFileSync(0, "utf8")).data;
  const it = (q.items ?? []).find((i) => i.objectiveId === process.argv[1] && i.taskId == null);
  if (!it?.id) { process.stderr.write("no open occurrence for the conflicted objective\n"); process.exit(1); }
  process.stdout.write(it.id);' "$OBJ4")"
STALEC_CODE="$(curl -sS -o "$PD/stalec.json" -w '%{http_code}' -X POST "$BASE/api/objective/$OBJ4/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"decisionId\":\"$DECO\",\"expectedCommit\":\"0000000000000000000000000000000000000000\"}")"
eq "a stale expectedCommit is refused" "409" "$STALEC_CODE"
eq "…by name" "stale_candidate" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).error?.code))' "$(cat "$PD/stalec.json")")"
RO="$PD/objective-reattempt.json"
RO_CODE="$(curl -sS -o "$RO" -w '%{http_code}' -X POST "$BASE/api/objective/$OBJ4/reattempt" \
  -H "authorization: $BASIC" -H 'content-type: application/json' \
  -d "{\"decisionId\":\"$DECO\",\"expectedCommit\":\"$OID4\",\"note\":\"proof recovery\"}")"
eq "objective reattempt is accepted" "200" "$RO_CODE"
RO_OUT="$(jf "$(cat "$RO")" "outcome")"
RO_STATUS="$(node src/main.ts get objective --id "$OBJ4" --json | jv 'v.status')"
case "$RO_OUT" in
  recovered)
    eq "recovered means the objective really transitioned" "awaiting_confirmation" "$RO_STATUS" ;;
  still_conflicted)
    eq "still_conflicted means the objective really did NOT move" "conflict" "$RO_STATUS" ;;
  *)
    echo "FAILED: outcome must be recovered or still_conflicted, got '$RO_OUT'" >&2; exit 1 ;;
esac

cat > "$PD/steps-objective.mjs" <<'STEPS'
export default async ({ goto, visible, consoleErrors, requests }) => {
  const { PROOF_DECISION: decision, PROOF_OUTCOME: outcome } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  await goto(`#/inbox/${decision}`);
  eq("the decision cold-loads", true, await visible('[data-testid="decision-state"]'));
  if (outcome === "still_conflicted") {
    eq("a still-conflicted objective says so", true, await visible('[data-testid="objective-still-conflicted"]'));
  }
  eq("no console error", 0, consoleErrors.length);
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
};
STEPS
PROOF_DECISION="$DECO" PROOF_OUTCOME="$RO_OUT" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps-objective.mjs" \
  || { echo "FAILED: browser phases H–I (objective)" >&2; exit 1; }
stop_serve

echo "026.10 ok: failed task $TASK1 reattempted through HTTP and its occurrence $DEC1 resolved; a closed occurrence is decision_closed; escalated task $TASK2 reattempted with required guidance; run $JOB abandoned by lease with 202/already_abandoning/lease_moved; objective $OBJ4 reattempt reported '$RO_OUT' matching its real status"
