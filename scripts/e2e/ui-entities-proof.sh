#!/usr/bin/env bash
# ui-entities-proof.sh — EPIC 026.3 Proof (deterministic, no model, loopback
# only, nothing left running).
#
# Proves, in a real browser against the real daemon serving the real build:
#   * every entity has a canonical nested URL that cold-loads with a breadcrumb
#     built from real names, not ids,
#   * each W2 page renders its fixed tabs AND an honest empty state per tab —
#     a pending task has no Result and no Landing, and says so,
#   * task evidence keeps the exact facts: the blocking task's id and the exact
#     downstream count,
#   * a real entity under the WRONG parent is a scope mismatch, while a
#     non-existent id is missing — the two states are distinct,
#   * a credential secret is rendered nowhere,
#   * the epic really is read-only: the page issues no POST, PATCH or DELETE.
#
# EXPECTED FAILURE against the CURRENT tree: phase A fails at the first check,
# because `ui/` does not exist and `npm run build:ui` is not a script yet.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

echo "--- B: seed a real chain through the real API"
node "$ROOT/src/main.ts" db migrate >/dev/null
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
echo "    daemon port: $PORT"

POST() {
  local path="$1" body="$2" code
  code="$(curl -sS -o "$PD/post.json" -w '%{http_code}' -X POST "$BASE$path" \
    -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
    --data "$body")"
  [ "$code" = "201" ] || { echo "FAILED: POST $path — expected 201, got $code: $(cat "$PD/post.json")" >&2; exit 1; }
  node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).id))' "$PD/post.json"
}
GETJSON() { curl -sS "$BASE$1" -H "authorization: $BASIC"; }

PROJECT="$(POST /api/project '{"name":"proof-026-3-project"}')"
INIT="$(POST "/api/project/$PROJECT/initiative" '{"name":"proof-initiative"}')"
OBJ_A="$(POST "/api/initiative/$INIT/objective" '{"name":"proof-objective-a"}')"
OBJ_B="$(POST "/api/initiative/$INIT/objective" '{"name":"proof-objective-b"}')"
TASK_BLOCKER="$(POST "/api/objective/$OBJ_A/task" '{"title":"blocker-task"}')"
TASK_MAIN="$(POST "/api/objective/$OBJ_A/task" "{\"title\":\"main-task\",\"dependencies\":[\"$TASK_BLOCKER\"]}")"
REPO="$(POST "/api/project/$PROJECT/repository" \
  '{"name":"proof-repo","remoteUrl":"https://example.invalid/x.git","branch":"main","auth":{"kind":"ambient"}}')"
POST "/api/project/$PROJECT/credential" \
  '{"name":"proof-cred","provider":"github","value":"s3cr3t-not-rendered"}' >/dev/null

# The exact downstream count the API reports for the blocker — the page must
# show this number, not a number the proof invented.
DOWNSTREAM="$(node -e '
  process.stdout.write(String(JSON.parse(process.argv[1]).downstream));' "$(GETJSON "/api/task/$TASK_BLOCKER")")"
echo "    project=$PROJECT initiative=$INIT objectiveA=$OBJ_A objectiveB=$OBJ_B blocker=$TASK_BLOCKER downstream=$DOWNSTREAM"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page }) => {
  const {
    PROOF_PROJECT: project, PROOF_INIT: init, PROOF_OBJ_A: objA, PROOF_OBJ_B: objB,
    PROOF_TASK_MAIN: taskMain, PROOF_TASK_BLOCKER: blocker, PROOF_REPO: repo,
    PROOF_DOWNSTREAM: downstream,
  } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };
  const tab = async (label) => {
    await page.locator('[data-testid="entity-tabs"] [role="tab"]', { hasText: label }).first().click();
    await page.waitForLoadState("networkidle");
  };

  // --- C: the initiative page, cold-loaded.
  await goto(`#/project/${project}/initiative/${init}`);
  const crumb = await text('[data-testid="breadcrumb"]');
  has("breadcrumb names the real project", crumb, "proof-026-3-project");
  has("breadcrumb names the real initiative", crumb, "proof-initiative");
  has("the header names the initiative", await text('[data-testid="entity-header"]'), "proof-initiative");
  await tab("Objectives");
  has("the Objectives tab lists the seeded objective", await text('[data-testid="tab-panel"]'), "proof-objective-a");
  await tab("Dependencies");
  const initDeps = await text('[data-testid="tab-panel"]');
  if (initDeps.trim() === "") throw new Error("the initiative Dependencies tab is an empty shell");

  // --- D: the objective page, cold-loaded.
  await goto(`#/project/${project}/initiative/${init}/objective/${objA}`);
  has("breadcrumb names the objective", await text('[data-testid="breadcrumb"]'), "proof-objective-a");
  await tab("Tasks");
  const taskPanel = await text('[data-testid="tab-panel"]');
  has("the Tasks tab lists the blocker", taskPanel, "blocker-task");
  has("the Tasks tab lists the main task", taskPanel, "main-task");
  await tab("Integration");
  const integration = await text('[data-testid="tab-panel"]');
  if (integration.trim() === "") throw new Error("the Integration tab is an empty shell");

  // --- E: the task page — five tabs, honest empty states, exact facts.
  await goto(`#/project/${project}/initiative/${init}/objective/${objA}/task/${taskMain}`);
  eq("the task page has five tabs", 5, await count('[data-testid="entity-tabs"] [role="tab"]'));
  await tab("Result");
  eq("a task that has not run says so", true, await visible('[data-testid="empty-result"]'));
  await tab("Landing");
  eq("a task with no candidate says so", true, await visible('[data-testid="empty-landing"]'));
  await tab("Dependencies");
  has("the Dependencies tab names the blocking task id", await text('[data-testid="tab-panel"]'), blocker);

  // The exact downstream count, read from the blocker's own page.
  await goto(`#/project/${project}/initiative/${init}/objective/${objA}/task/${blocker}`);
  eq("the exact downstream count is rendered", downstream, (await text('[data-testid="task-downstream"]')).replace(/\D/g, ""));

  // --- F: scope mismatch and missing are DIFFERENT states.
  await goto(`#/project/${project}/initiative/${init}/objective/${objB}/task/${taskMain}`);
  eq("a real task under the wrong objective is a scope mismatch", true, await visible('[data-testid="scope-mismatch"]'));
  eq("...and is NOT the missing state", 0, await count('[data-testid="async-missing"]'));
  await goto(`#/project/${project}/initiative/${init}/objective/${objA}/task/01JZZZNOTATASKID0000000000`);
  eq("an absent task is the missing state", true, await visible('[data-testid="async-missing"]'));
  eq("...and is NOT a scope mismatch", 0, await count('[data-testid="scope-mismatch"]'));

  // --- G: the resource entity page, and no secret anywhere.
  await goto(`#/project/${project}/resource/repository/${repo}`);
  has("the resource page names the repository", await text('[data-testid="entity-header"]'), "proof-repo");
  if ((await text("body")).includes("s3cr3t-not-rendered")) throw new Error("a credential secret was rendered");

  eq("no console error across every page", 0, consoleErrors.length);

  // --- H: read-only, and R3.
  const writes = requests.filter((r) => ["POST", "PATCH", "DELETE"].includes(r.method));
  if (writes.length > 0) {
    throw new Error(`EPIC 026.3 is read-only but the page issued: ${writes.map((w) => `${w.method} ${w.url}`).join(", ")}`);
  }
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
};
STEPS

PROOF_PROJECT="$PROJECT" PROOF_INIT="$INIT" PROOF_OBJ_A="$OBJ_A" PROOF_OBJ_B="$OBJ_B" \
PROOF_TASK_MAIN="$TASK_MAIN" PROOF_TASK_BLOCKER="$TASK_BLOCKER" PROOF_REPO="$REPO" \
PROOF_DOWNSTREAM="$DOWNSTREAM" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases C–H" >&2; exit 1; }

echo "026.3 ok: nested entity URLs cold-load with real breadcrumbs, tabs carry honest empty states, downstream=$DOWNSTREAM rendered exactly, scope mismatch and missing stay distinct, no write issued"
