#!/usr/bin/env bash
# ui-decision-identity-proof.sh — EPIC 026.8 Proof (deterministic, no model, no
# outbound network — loopback and local git only — nothing left running).
#
# Proves, against a REAL decision produced through the production path:
#   * every queue item carries an opaque id, a stable machine kind and the
#     entity's real name, and the id SURVIVES recomputation — the queue is a
#     projection, so a second call must return the same id,
#   * GET /api/queue/:id answers 200 with a lifecycle state, 404 for an id the
#     server never issued, and NEVER 410,
#   * closing the decision for real keeps the id addressable: it answers 200
#     with a closed state and historical names, not 404,
#   * filtering happens on the SERVER, before ranking and limiting, while the
#     counts stay global,
#   * the Inbox shows the real title, filters through the server, and
#     #/inbox/<id> cold-loads a decision,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# EXPECTED FAILURE against the CURRENT tree: phase A fails at the first check
# (no `build:ui`). Phase C would fail next, because the queue DTO has no `id`.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PD="$(mktemp -d)"
SERVE_PID=""
cleanup() {
  if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi
  rm -rf "$PD"
}
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
KEY="0123456789abcdef0123456789abcdef"
printf 'API_KEY=%s\n' "$KEY" > "$PD/.env"
BASIC="Basic $(printf 'kanthord:%s' "$KEY" | base64 | tr -d '\n')"

eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
ne() { [ "$2" != "$3" ] || { echo "FAILED: $1 — must not equal '$2'" >&2; exit 1; }; }
jf() { node -e 'const v=JSON.parse(process.argv[1]).data;process.stdout.write(String(process.argv[2].split(".").reduce((a,k)=>a?.[k],v)))' "$1" "$2"; }

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

echo "--- B: the fixture — a REAL failed task, through the real verification path"
node src/main.ts db migrate >/dev/null
cat > "$PD/taskstatus.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const r = db.prepare("SELECT status FROM tasks WHERE id = ?").get(process.argv[2]);
process.stdout.write(r === undefined ? "MISSING" : String(r.status));
EOF
tstatus() { node "$PD/taskstatus.mjs" "$1"; }
exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }

PROJECT="$(node src/main.ts create project --name proof-026-8)"
REMOTE="$PD/repo.git"; SEED="$PD/repo-seed"; MIRROR="$PD/repo-mirror"
git init -q --bare -b main "$REMOTE"
git clone -q "$REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO="$(node src/main.ts create repository --project "$PROJECT" --name repo \
  --remote-url "file://$REMOTE" --branch main --auth ambient --path "$MIRROR")"
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV="$(node src/main.ts register ai-provider --name proof --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')"
node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null
GRAPH="$PD/graph"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
  --bind source="$REPO" >/dev/null
TASK="$(exportval "$GRAPH" 'j.refToId.tasks["create-task"]')"
printf '[{"text":"did nothing"}]' > "$PD/noop-agent.json"
KANTHORD_FAKE_AGENT="$PD/noop-agent.json" \
  node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
eq "fixture: the root task really failed" "failed" "$(tstatus "$TASK")"

export KANTHORD_UI_DIST="$DIST"
( cd "$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
SERVE_PID=$!
PORT=""
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    echo "FAILED: serve exited during startup; log:" >&2; cat "$PD/serve.log" >&2; exit 1
  fi
  PORT="$(node -e '
    const { readFileSync } = require("node:fs");
    for (const line of readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      try { const o = JSON.parse(line);
        if (o.msg === "listening" && typeof o.port === "number") { process.stdout.write(String(o.port)); break; }
      } catch {}
    }' "$PD/serve.log")"
  [ -n "$PORT" ] && break
  sleep 0.2
done
[ -n "$PORT" ] || { echo "FAILED: no listening log line; log:" >&2; cat "$PD/serve.log" >&2; exit 1; }
BASE="http://127.0.0.1:$PORT"
echo "    daemon port: $PORT   task: $TASK"

echo "--- C: the queue carries identity, machine kind and the real name — stably"
Q1="$(curl -sS "$BASE/api/queue" -H "authorization: $BASIC")"
DEC_ID="$(node -e '
  const q = JSON.parse(process.argv[1]).data;
  const it = q.items.find((i) => i.taskId === process.argv[2]) ?? q.items[0];
  if (!it) { process.stderr.write("no queue item\n"); process.exit(1); }
  if (!it.id) { process.stderr.write("the queue item has no id\n"); process.exit(1); }
  process.stdout.write(it.id);' "$Q1" "$TASK")"
KIND="$(node -e '
  const q = JSON.parse(process.argv[1]).data;
  const it = q.items.find((i) => i.id === process.argv[2]);
  if (!it.kind) { process.stderr.write("the queue item has no machine kind\n"); process.exit(1); }
  process.stdout.write(it.kind);' "$Q1" "$DEC_ID")"
TITLE="$(node -e '
  const q = JSON.parse(process.argv[1]).data;
  const it = q.items.find((i) => i.id === process.argv[2]);
  const t = it.taskTitle ?? it.title;
  if (!t) { process.stderr.write("the queue item carries no entity name\n"); process.exit(1); }
  process.stdout.write(t);' "$Q1" "$DEC_ID")"
Q2="$(curl -sS "$BASE/api/queue" -H "authorization: $BASIC")"
SAME="$(node -e '
  const q = JSON.parse(process.argv[1]).data;
  process.stdout.write(q.items.some((i) => i.id === process.argv[2]) ? "yes" : "no");' "$Q2" "$DEC_ID")"
eq "the id survives recomputation of the projection" "yes" "$SAME"
echo "    decision: $DEC_ID   kind: $KIND   title: $TITLE"

echo "--- D: the decision is addressable, and 410 is never used"
OPEN_BODY="$(curl -sS "$BASE/api/queue/$DEC_ID" -H "authorization: $BASIC")"
eq "an open decision reports its state" "open" "$(jf "$OPEN_BODY" "state")"
UNKNOWN_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/queue/01KYZZUNKNOWNDECISION00000" -H "authorization: $BASIC")"
eq "an id the server never issued is 404" "404" "$UNKNOWN_CODE"
OPEN_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/queue/$DEC_ID" -H "authorization: $BASIC")"
eq "a known decision is 200, never 410" "200" "$OPEN_CODE"

echo "--- E: closing it for real keeps it addressable"
node src/main.ts retry task --id "$TASK" --note "proof retry" >/dev/null
CLOSED_CODE="$(curl -sS -o "$PD/closed.json" -w '%{http_code}' "$BASE/api/queue/$DEC_ID" -H "authorization: $BASIC")"
eq "a closed decision is still 200" "200" "$CLOSED_CODE"
CLOSED_STATE="$(jf "$(cat "$PD/closed.json")" "state")"
ne "the closed decision is no longer open" "open" "$CLOSED_STATE"
case "$CLOSED_STATE" in
  resolved|expired) ;;
  *) echo "FAILED: closed state must be resolved or expired, got '$CLOSED_STATE'" >&2; exit 1 ;;
esac
echo "    closed state: $CLOSED_STATE"

echo "--- F: filtering happens on the server, and the counts stay global"
TOTAL="$(jf "$Q1" "counts.total")"
OTHER_KIND="$([ "$KIND" = "task-review" ] && echo "operational-failure" || echo "task-review")"
FILTERED="$(curl -sS "$BASE/api/queue?kind=$OTHER_KIND" -H "authorization: $BASIC")"
eq "the other kind matches nothing" "0" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).data.items.length))' "$FILTERED")"
eq "counts stay global under a filter" "$TOTAL" "$(jf "$FILTERED" "counts.total")"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page }) => {
  const { PROOF_DECISION: decision, PROOF_TITLE: title, PROOF_KIND: kind } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };

  // --- G: the Inbox shows real names and filters through the server.
  await goto("#/inbox");
  has("the row shows the entity's real title", await text('[data-testid="inbox-row-title"]'), title);
  const before = requests.length;
  await page.locator('[data-testid="inbox-filter-kind"]').selectOption(kind);
  await page.waitForLoadState("networkidle");
  const filtered = requests.slice(before).filter((r) => r.url.includes("/api/queue") && r.url.includes("kind="));
  if (filtered.length === 0) throw new Error("the kind filter did not reach the server");
  eq("the global counts are labelled as global", true, await visible('[data-testid="inbox-counts-global"]'));

  // The deep link 026.1 forbade and 026.7 called unsupported.
  await goto(`#/inbox/${decision}`);
  eq("the decision cold-loads", true, await visible('[data-testid="decision-state"]'));
  await goto("#/inbox/01KYZZUNKNOWNDECISION00000");
  eq("an unknown decision is the missing state", true, await visible('[data-testid="async-missing"]'));

  eq("no console error", 0, consoleErrors.length);
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
  void count;
};
STEPS

PROOF_DECISION="$DEC_ID" PROOF_TITLE="$TITLE" PROOF_KIND="$KIND" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases G–H" >&2; exit 1; }

echo "026.8 ok: decision $DEC_ID stable across recomputation, kind=$KIND, addressable while open and after closing ($CLOSED_STATE), server-side filter with global counts, Inbox deep link works"
