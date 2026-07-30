#!/usr/bin/env bash
# ui-inbox-proof.sh — EPIC 026.7 Proof (deterministic, no model, no outbound
# network — loopback and local git only — nothing left running).
#
# Proves, in a real browser against the real daemon serving the real build:
#   * the Inbox renders a REAL decision-queue item, produced through the
#     production path: a no-op KANTHORD_FAKE_AGENT fails the root task's real
#     verification, which is what puts it on the queue,
#   * the row carries exactly what the DTO gives — kindLabel, projectName and
#     the API's own downstream count — and the page issues NO per-row entity
#     fetch (EPIC 026.7 decision 2),
#   * the toolbar states the server's order literally and never says "impact"
#     or "priority",
#   * selecting the row renders one verdict per API verdict, with the server's
#     exact command handed over verbatim where it supplied one,
#   * a conflict route for a task with no conflicted candidate renders the
#     honest "no longer present" state against the API's real 409,
#   * R3 holds — no request the page issued carried an Authorization header.
#
# NOT proven here, and deliberately so: a rendered conflict diff. A task-linked
# candidate in `conflict` state needs a runner result, and no public HTTP or CLI
# path creates one. The diff rendering is covered by the workspace's hermetic
# tests (EPIC 026.7 Gate).
#
# EXPECTED FAILURE against the CURRENT tree: phase A fails at the first check,
# because `ui/` does not exist and `npm run build:ui` is not a script yet.
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

# Task status is read straight from SQLite, so the fixture's health is never
# inferred from the surface under test. Same technique as
# scripts/e2e/decision-workbench-proof.sh.
cat > "$PD/taskstatus.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const r = db.prepare("SELECT status FROM tasks WHERE id = ?").get(process.argv[2]);
process.stdout.write(r === undefined ? "MISSING" : String(r.status));
EOF
tstatus() { node "$PD/taskstatus.mjs" "$1"; }
exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }

PROJECT="$(node src/main.ts create project --name proof-026-7)"
REMOTE="$PD/repo.git"; SEED="$PD/repo-seed"; MIRROR="$PD/repo-mirror"
git init -q --bare -b main "$REMOTE"
git clone -q "$REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO="$(node src/main.ts create repository --project "$PROJECT" --name repo \
  --remote-url "file://$REMOTE" --branch main --auth ambient --path "$MIRROR")"

# generic@1 needs repository context only; the daemon still requires a non-empty
# provider chain. KANTHORD_FAKE_AGENT replaces the session factory, so this
# token is never read and no model is ever called.
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV="$(node src/main.ts register ai-provider --name proof --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')"
node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null

GRAPH="$PD/graph"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
node src/main.ts import graph "$GRAPH" --create --project "$PROJECT" \
  --bind source="$REPO" >/dev/null
INIT="$(exportval "$GRAPH" 'j.initiativeId')"
OBJ="$(exportval "$GRAPH" 'j.refToId.objectives["todo-api-obj"]')"
TASK="$(exportval "$GRAPH" 'j.refToId.tasks["create-task"]')"

# A no-op agent writes no file, so the root task's real verification exits 1 and
# the task fails for a real reason — which is what puts it on the queue.
printf '[{"text":"did nothing"}]' > "$PD/noop-agent.json"
KANTHORD_FAKE_AGENT="$PD/noop-agent.json" \
  node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
eq "fixture: the root task really failed" "failed" "$(tstatus "$TASK")"

echo "--- B2: the daemon serves the build, and the queue really has the item"
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

QUEUE="$(curl -sS "$BASE/api/queue" -H "authorization: $BASIC")"
EXPECT_ROWS="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).items.length))' "$QUEUE")"
ne "the queue really has an item" "0" "$EXPECT_ROWS"
ITEM="$(node -e '
  const q = JSON.parse(process.argv[1]);
  const it = q.items.find((i) => i.taskId === process.argv[2]) ?? q.items[0];
  process.stdout.write(JSON.stringify({
    kindLabel: it.kindLabel,
    projectName: it.projectName,
    downstream: it.downstream,
    commands: it.verdicts.map((v) => v.command).filter(Boolean),
    verdicts: it.verdicts.length,
  }));' "$QUEUE" "$TASK")"
KIND="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).kindLabel)' "$ITEM")"
DOWNSTREAM="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).downstream))' "$ITEM")"
VERDICTS="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).verdicts))' "$ITEM")"
FIRST_COMMAND="$(node -e 'const c=JSON.parse(process.argv[1]).commands;process.stdout.write(c[0] ?? "")' "$ITEM")"
echo "    port=$PORT rows=$EXPECT_ROWS kind=$KIND downstream=$DOWNSTREAM verdicts=$VERDICTS"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page }) => {
  const {
    PROOF_PROJECT: project, PROOF_INIT: init, PROOF_OBJ: obj, PROOF_TASK: task,
    PROOF_ROWS: rows, PROOF_KIND: kind, PROOF_DOWNSTREAM: downstream,
    PROOF_VERDICTS: verdicts, PROOF_COMMAND: command, PROOF_PROJECT_NAME: projectName,
  } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };

  // --- C: the Inbox renders the real queue.
  const before = requests.length;
  await goto("#/inbox");
  eq("one row per queue item", rows, await count('[data-testid="inbox-table"] tbody tr'));
  const table = await text('[data-testid="inbox-table"]');
  has("the row shows the API's kindLabel", table, kind);
  has("the row shows the project name", table, projectName);
  has("the row shows the API's downstream count", table, downstream);

  // decision 2 — no per-row entity fetch. The Inbox is cross-project, so a
  // fan-out would be up to 500 requests against an already expensive call.
  const perRow = requests
    .slice(before)
    .filter((r) => /\/api\/(task|objective|initiative)\/[^/]+$/.test(new URL(r.url).pathname));
  if (perRow.length > 0) {
    throw new Error(`the Inbox fetched entities per row: ${perRow.map((r) => r.url).join(", ")}`);
  }

  // --- D: the order is stated literally, and never as an impact ranking.
  const order = await text('[data-testid="inbox-order"]');
  has("the order statement names downstream dependents", order, "downstream");
  for (const forbidden of ["impact", "priority"]) {
    if (order.toLowerCase().includes(forbidden)) {
      throw new Error(`the order statement claims an ${forbidden} ranking: "${order}"`);
    }
  }

  // --- E: the verdict inventory is the Inbox's real value.
  await page.locator('[data-testid="inbox-table"] tbody tr').first().click();
  eq("the pane opened", true, await visible('[data-testid="inbox-pane"]'));
  eq("one verdict per API verdict", verdicts, await count('[data-testid="verdict"]'));
  if (command !== "") {
    has("the server's own command is handed over verbatim",
      await text('[data-testid="inbox-pane"]'), command);
  }

  // --- F: the conflict route is honest about a conflict that is not there.
  await goto(`#/project/${project}/initiative/${init}/objective/${obj}/task/${task}/conflict`);
  eq("a task with no conflicted candidate says so", true, await visible('[data-testid="conflict-gone"]'));
  eq("...and it is not rendered as a transport error", 0, await count('[data-testid="async-error"]'));

  eq("no console error across both surfaces", 0, consoleErrors.length);

  // --- G: R3.
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
};
STEPS

PROOF_PROJECT="$PROJECT" PROOF_INIT="$INIT" PROOF_OBJ="$OBJ" PROOF_TASK="$TASK" \
PROOF_ROWS="$EXPECT_ROWS" PROOF_KIND="$KIND" PROOF_DOWNSTREAM="$DOWNSTREAM" \
PROOF_VERDICTS="$VERDICTS" PROOF_COMMAND="$FIRST_COMMAND" PROOF_PROJECT_NAME="proof-026-7" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases C–G" >&2; exit 1; }

echo "026.7 ok: a real failed task reached the Inbox as $KIND (downstream=$DOWNSTREAM, $VERDICTS verdicts), rows carry no per-row fetch, order stated literally, conflict route honest about a 409"
