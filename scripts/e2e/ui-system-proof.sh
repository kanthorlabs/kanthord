#!/usr/bin/env bash
# ui-system-proof.sh — EPIC 026.1 Proof (deterministic, no model, no outbound
# network — loopback only — nothing left running).
#
# Proves that the dashboard has a body:
#   * the built UI is served by the real daemon and BOOTS in a real browser
#     (jsdom cannot run a Vite module bundle — EPIC 026 decision 10),
#   * `#/` lands on `#/inbox` inside GlobalShell with exactly three nav items,
#   * Operations renders the health card with the daemon's REAL version, and
#     FreshnessBar's refresh really issues a second GET /healthz,
#   * a COLD load of a project deep link renders ProjectShell with five nav
#     items and the real project name in the breadcrumb, and the unbuilt leaf
#     says which epic owns it,
#   * an unknown hash renders the explicit missing state, not a blank page,
#     while GET /nope still answers 404 unknown_route,
#   * the six operator-role custom properties resolve in the live document,
#   * R3 holds over the wire: no request the PAGE issued carried an
#     Authorization header, and the API key is in no response body.
#
# EXPECTED FAILURE against the CURRENT tree: phase A fails at the first check,
# because `ui/` does not exist and `npm run build:ui` is not a script yet. That
# is the missing capability, not a broken fixture.
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
contains() { case "$2" in *"$3"*) ;; *) echo "FAILED: $1 — '$3' not found in: $2" >&2; exit 1 ;; esac; }
absent() { case "$2" in *"$3"*) echo "FAILED: $1 — '$3' MUST NOT appear in: $2" >&2; exit 1 ;; *) ;; esac; }

echo "--- A: the build exists and the browser is installed"
BUILD_SCRIPT="$(node -e 'const fs=require("node:fs");const p=process.argv[1];process.stdout.write(fs.existsSync(p)?(JSON.parse(fs.readFileSync(p,"utf8")).scripts?.["build:ui"] ?? ""):"")' "$ROOT/package.json")"
ne "package.json defines build:ui (EPIC 026 S1)" "" "$BUILD_SCRIPT"
( cd "$ROOT" && npm run build:ui ) >"$PD/build.log" 2>&1 \
  || { echo "FAILED: npm run build:ui; log:" >&2; tail -30 "$PD/build.log" >&2; exit 1; }
DIST="$ROOT/ui/dist"
[ -f "$DIST/index.html" ] || { echo "FAILED: no $DIST/index.html" >&2; exit 1; }
# The browser is installed at environment setup, never by the Proof.
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

echo "--- B: the daemon serves that build and it BOOTS in a real browser"
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

# A real project, created through the real API — phase D deep-links to it.
PROJECT_NAME="proof-026-1"
CREATE="$(curl -sS -o "$PD/create.json" -w '%{http_code}' -X POST "$BASE/api/project" \
  -H "authorization: $BASIC" -H "origin: $BASE" -H 'content-type: application/json' \
  --data "{\"name\":\"$PROJECT_NAME\"}")"
eq "project created" "201" "$CREATE"
PROJECT_ID="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).data.id)' "$PD/create.json")"
ne "project id captured" "" "$PROJECT_ID"
VERSION="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version)' "$ROOT/package.json")"
echo "    project: $PROJECT_ID   version: $VERSION"

HEALTHZ_BEFORE="$(grep -c '"path":"/healthz"' "$PD/serve.log" || true)"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page }) => {
  const {
    PROOF_PROJECT_ID: projectId,
    PROOF_PROJECT_NAME: projectName,
    PROOF_VERSION: version,
  } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) {
      throw new Error(`${what} — expected '${expected}', got '${actual}'`);
    }
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) {
      throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
    }
  };

  // --- B: the root URL boots and lands on the settled default route.
  await goto("");
  eq("GlobalShell is mounted at /", 1, await count('[data-testid="global-shell"]'));
  eq("GlobalShell has exactly three nav items", 3, await count('[data-testid="global-nav"] a'));
  eq("`#/` redirects to `#/inbox`", "#/inbox", new URL(page.url()).hash);
  const nav = await text('[data-testid="global-nav"]');
  for (const label of ["Inbox", "Projects", "Operations"]) has("GlobalShell nav label", nav, label);
  eq("the page booted with no console error", 0, consoleErrors.length);

  // --- C: Operations is a real screen over a real query.
  await goto("#/operations", '[data-testid="health-version"]');
  eq("Operations renders the health card", true, await visible('[data-testid="health-version"]'));
  has("the card shows the daemon's real version", await text('[data-testid="health-version"]'), version);
  has("FreshnessBar shows a fetch time", await text('[data-testid="freshness-updated"]'), "Updated");
  await page.locator('[data-testid="freshness-refresh"]').click();
  await page.waitForLoadState("networkidle");

  // --- D: a COLD load of a deep link — the whole route comes from the URL.
  await goto(`#/project/${projectId}/overview`);
  eq("ProjectShell is mounted", 1, await count('[data-testid="project-shell"]'));
  eq("ProjectShell has exactly five nav items", 5, await count('[data-testid="project-nav"] a'));
  const pnav = await text('[data-testid="project-nav"]');
  for (const label of ["Overview", "Graph", "Plan", "Resources", "Readiness"]) {
    has("ProjectShell nav label", pnav, label);
  }
  has("breadcrumb carries the real project name", await text('[data-testid="breadcrumb"]'), projectName);
  const placeholder = await text('[data-testid="not-built-yet"]');
  has("the unbuilt leaf names its owning epic", placeholder, "026.2");

  // --- E: an unknown hash is an explicit state, never a blank page.
  await goto("#/definitely-not-a-route");
  eq("unknown hash renders the missing state", true, await visible('[data-testid="async-missing"]'));
  const bodyText = await text("body");
  if (bodyText.trim().length === 0) throw new Error("unknown hash rendered a blank page");

  // --- F: the token layer is live in the document, not only in a source file.
  const roles = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["neutral", "active", "attention", "blocked", "danger", "success"].map((r) => [
        r,
        s.getPropertyValue(`--role-${r}`).trim(),
      ]),
    );
  });
  for (const [role, value] of Object.entries(roles)) {
    if (value === "") throw new Error(`role token --role-${role} does not resolve in the document`);
  }

  // --- G: R3 — no ui/ module may set an Authorization header.
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
  console.log(`    roles resolved: ${Object.keys(roles).join(", ")}`);
};
STEPS

PROOF_PROJECT_ID="$PROJECT_ID" PROOF_PROJECT_NAME="$PROJECT_NAME" PROOF_VERSION="$VERSION" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phases B–G" >&2; exit 1; }

echo "--- C2: the refresh control really re-fetched /healthz"
HEALTHZ_AFTER="$(grep -c '"path":"/healthz"' "$PD/serve.log" || true)"
[ "$HEALTHZ_AFTER" -ge "$((HEALTHZ_BEFORE + 2))" ] \
  || { echo "FAILED: expected at least 2 more GET /healthz, before=$HEALTHZ_BEFORE after=$HEALTHZ_AFTER" >&2; exit 1; }

echo "--- E2: the 404 policy survived the shell"
NOPE="$(curl -sS -o "$PD/nope.json" -w '%{http_code}' "$BASE/nope" -H "authorization: $BASIC")"
eq "GET /nope status" "404" "$NOPE"
contains "GET /nope code" "$(cat "$PD/nope.json")" "unknown_route"

echo "--- G2: the API key leaked into no response body and no log line"
absent "key not in the served index" "$(curl -sS "$BASE/" -H "authorization: $BASIC")" "$KEY"
absent "key not in the daemon log" "$(cat "$PD/serve.log")" "$KEY"

echo "026.1 ok: shell boots in a real browser, deep link cold-loads into ProjectShell ($PROJECT_ID), six role tokens resolve, healthz refetched $HEALTHZ_AFTER times, 404 policy intact"
