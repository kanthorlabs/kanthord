#!/usr/bin/env bash
# ui-candidate-review-proof.sh — EPIC 026.9 Proof (deterministic, no model, no
# outbound network — loopback and local git only — nothing left running).
#
# Proves, against the real daemon serving the real build:
#   * the candidate diff read model returns REAL files and REAL patches for a
#     REAL objective candidate, produced through the production path
#     (KANTHORD_FAKE_AGENT + make-landing-graph.sh + run daemon --until-idle),
#   * reading the diff does NOT mutate the bare managed home — asserted by a
#     content hash of the whole home directory, not by a ref listing, because a
#     `git fetch` into the home writes loose objects and FETCH_HEAD without
#     moving a single ref (EPIC 026.9 decision 1),
#   * a verdict that names the wrong commit is refused, and a verdict on a
#     closed decision occurrence is refused with 409 decision_closed
#     (decisions 7, 8),
#   * the correct verdict really transitions the objective in SQLite,
#   * a discard cannot be sent without the dry run's impact digest (decision 10),
#   * in the browser: the W3 review screen renders the files, approve sends the
#     DTO's own head OID plus the occurrence id, and the resolved state renders
#     in place with no navigation (decision 12),
#   * R3 holds — no request the page issued carried an Authorization header.
#
# THREE INDEPENDENT SUBJECTS. A verdict is terminal, so no subject is reused
# across one: subject 1 answers the HTTP approval (C, D, E), subject 2 the
# discard path (F), subject 3 is left untouched for the browser (G). One subject
# cannot satisfy both E and G.
#
# EXPECTED FAILURE against the CURRENT tree: phase C fails at the first check,
# because `GET /api/objective/:id/candidate` does not exist — src/apps/http/
# routes.ts has no candidate route and no verdict route at all.
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

echo "--- B: three independent REAL objective candidates, through the real path"
node src/main.ts db migrate >/dev/null

jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }

# Objective status is read straight from SQLite, so the fixture's health is
# never inferred from the surface under test.
cat > "$PD/objstatus.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const r = db.prepare("SELECT status FROM objectives WHERE id = ?").get(process.argv[2]);
process.stdout.write(r === undefined ? "MISSING" : String(r.status));
EOF
ostatus() { node "$PD/objstatus.mjs" "$1"; }

DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV="$(node src/main.ts register ai-provider --name proof --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')"

# One subject = one project + its own bare remote + its own managed mirror + its
# own imported graph. Independent by construction, so a verdict on one cannot
# disturb another.
make_subject() {
  local n="$1"
  local project remote seed mirror repo graph
  project="$(node src/main.ts create project --name "proof-026-9-$n")"
  remote="$PD/remote-$n.git"; seed="$PD/seed-$n"; mirror="$PD/mirror-$n"
  git init -q --bare -b main "$remote"
  git clone -q "$remote" "$seed"
  git -C "$seed" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" push -q origin main
  repo="$(node src/main.ts create repository --project "$project" --name home \
    --remote-url "file://$remote" --branch main --auth ambient --path "$mirror")"
  node src/main.ts assign ai-provider --project "$project" --provider "$PROV" >/dev/null
  graph="$PD/graph-$n"
  scripts/e2e/make-landing-graph.sh "$graph" >/dev/null
  node src/main.ts import graph "$graph" --create --project "$project" \
    --bind source="$repo" >/dev/null
  # The scripted turn writes a real file, so the root task's real verification
  # passes and the objective reaches its candidate — the human gate.
  KANTHORD_FAKE_AGENT="$graph/.fake-agent.json" \
    node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1
  printf '%s %s %s %s' "$project" \
    "$(exportval "$graph" 'j.initiativeId')" \
    "$(exportval "$graph" 'j.refToId.objectives["todo-api-obj"]')" \
    "$mirror"
}

read -r P1 I1 O1 M1 <<<"$(make_subject 1)"
read -r P2 I2 O2 M2 <<<"$(make_subject 2)"
read -r P3 I3 O3 M3 <<<"$(make_subject 3)"
for pair in "1:$O1" "2:$O2" "3:$O3"; do
  eq "fixture: subject ${pair%%:*} really awaits confirmation" \
    "awaiting_confirmation" "$(ostatus "${pair#*:}")"
done
OID1="$(node src/main.ts get objective --id "$O1" --json | jv 'v.commitOid')"
ne "subject 1 has a real candidate commit" "" "$OID1"

echo "--- B2: the daemon serves the build"
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

api() { # api <method> <path> [body]
  if [ $# -ge 3 ]; then
    curl -sS -o "$PD/body.json" -w '%{http_code}' -X "$1" "$BASE$2" \
      -H "authorization: $BASIC" -H 'content-type: application/json' -d "$3"
  else
    curl -sS -o "$PD/body.json" -w '%{http_code}' -X "$1" "$BASE$2" -H "authorization: $BASIC"
  fi
}
# `body <expr> [arg]` — `j` is the parsed response, `a` the optional argument.
body() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const a=process.argv[3];process.stdout.write(String(eval(process.argv[2])))' "$PD/body.json" "$1" "${2-}"; }
# The decision occurrence id EPIC 026.8 mints, for a given objective.
decision_for() {
  local code
  code="$(api GET "/api/queue")"
  eq "the queue answers 200" "200" "$code"
  body 'j.data.items.find((i) => i.objectiveId === a)?.id ?? ""' "$1"
}
# A content hash of every file in the bare managed home. A `git fetch` into the
# home writes loose objects and FETCH_HEAD while moving no ref, so a ref listing
# would not see it — this does.
homehash() { find "$1" -type f -exec shasum {} + | sort | shasum | cut -d' ' -f1; }

echo "--- C: the diff read model is real, and the bare home is never touched"
HOME_BEFORE="$(homehash "$M1")"
CODE="$(api GET "/api/objective/$O1/candidate")"
eq "the objective candidate route answers 200" "200" "$CODE"
eq "it names the source it read" "objective" "$(body 'j.data.subject')"
eq "the diff is available" "true" "$(body 'String(j.data.available)')"
eq "base is the objective's parent oid" "true" "$(body 'String(typeof j.data.base === "string" && j.data.base.length > 0)')"
eq "head is the objective's candidate oid" "$OID1" "$(body 'j.data.head')"
ne "it returns at least one file" "0" "$(body 'j.data.files.length')"
eq "the file the fixture wrote is in the diff" "true" \
  "$(body 'String(j.data.files.some((f) => f.path === "src/todo.mjs"))')"
eq "that file carries a real patch" "true" \
  "$(body 'String(j.data.files.find((f) => f.path === "src/todo.mjs").patch.includes("+"))')"
eq "reading the diff did not mutate the bare managed home" "$HOME_BEFORE" "$(homehash "$M1")"

echo "--- D: a verdict that names the wrong thing is refused"
DEC1="$(decision_for "$O1")"
ne "the queue carries a decision occurrence id for subject 1 (EPIC 026.8)" "" "$DEC1"
STALE="$(printf '0%.0s' $(seq 1 40))"
CODE="$(api POST "/api/objective/$O1/approval" "{\"decisionId\":\"$DEC1\",\"expectedCommit\":\"$STALE\"}")"
eq "a stale expectedCommit is refused with 409" "409" "$CODE"
eq "...and names the reason" "stale_candidate" "$(body 'j.error.code')"
eq "the objective did not move" "awaiting_confirmation" "$(ostatus "$O1")"
CODE="$(api POST "/api/objective/$O1/approval" "{\"decisionId\":\"01ARZ3NDEKTSV4RRFFQ69G5FAV\",\"expectedCommit\":\"$OID1\"}")"
eq "an unknown decision occurrence is refused with 409" "409" "$CODE"
eq "...and names the reason" "decision_closed" "$(body 'j.error.code')"
eq "the objective still did not move" "awaiting_confirmation" "$(ostatus "$O1")"

echo "--- E: the correct verdict really lands, through HTTP"
CODE="$(api POST "/api/objective/$O1/approval" "{\"decisionId\":\"$DEC1\",\"expectedCommit\":\"$OID1\"}")"
eq "the approval answers 200" "200" "$CODE"
eq "it reports the outcome, not a bare success" "integrated" "$(body 'j.data.outcome')"
eq "the objective really transitioned in SQLite" "integrated" "$(ostatus "$O1")"
CODE="$(api POST "/api/objective/$O1/approval" "{\"decisionId\":\"$DEC1\",\"expectedCommit\":\"$OID1\"}")"
eq "replaying the same verdict is refused, not re-run" "409" "$CODE"

echo "--- F: discard cannot skip the dry run (subject 2)"
DEC2="$(decision_for "$O2")"
ne "the queue carries a decision occurrence id for subject 2" "" "$DEC2"
OID2="$(node src/main.ts get objective --id "$O2" --json | jv 'v.commitOid')"
ne "subject 2 has a real candidate commit" "" "$OID2"
# `expectedCommit` is present on every call below: an objective rejection
# requires it, so leaving it out would answer 400 and never reach the discard
# precondition this phase is about.
REJ2="\"decisionId\":\"$DEC2\",\"expectedCommit\":\"$OID2\",\"resolution\":\"discard\""
CODE="$(api POST "/api/objective/$O2/rejection" "{$REJ2}")"
eq "a discard with no impact digest is refused" "428" "$CODE"
eq "subject 2 did not move" "awaiting_confirmation" "$(ostatus "$O2")"
CODE="$(api POST "/api/objective/$O2/rejection" "{$REJ2,\"dryRun\":true}")"
eq "the dry run answers 200" "200" "$CODE"
DIGEST="$(body 'j.data.preview.digest')"
ne "the dry run returns an impact digest" "" "$DIGEST"
eq "the dry run wrote nothing" "awaiting_confirmation" "$(ostatus "$O2")"
CODE="$(api POST "/api/objective/$O2/rejection" "{$REJ2,\"expectImpact\":\"$DIGEST\"}")"
eq "the discard with the digest succeeds" "200" "$CODE"
eq "subject 2 is really discarded" "discarded" "$(ostatus "$O2")"

echo "--- G: the review screen in a real browser (subject 3, untouched)"
DEC3="$(decision_for "$O3")"
ne "the queue carries a decision occurrence id for subject 3" "" "$DEC3"
OID3="$(node src/main.ts get objective --id "$O3" --json | jv 'v.commitOid')"

cat > "$PD/steps.mjs" <<'STEPS'
export default async ({ goto, text, count, visible, consoleErrors, requests, page }) => {
  const { PROOF_DEC: dec, PROOF_HEAD: head } = process.env;
  const eq = (what, expected, actual) => {
    if (String(expected) !== String(actual)) throw new Error(`${what} — expected '${expected}', got '${actual}'`);
  };
  const has = (what, haystack, needle) => {
    if (!String(haystack).includes(needle)) throw new Error(`${what} — '${needle}' not found in: ${haystack}`);
  };

  // decision 12 — the review screen is a child of the decision URL and cold-loads.
  await goto(`#/inbox/${dec}/review`);
  eq("the review shell rendered", true, await visible('[data-testid="review-shell"]'));

  // decision 2 — evidence first: the real files render before any control acts.
  const files = await count('[data-testid="review-file"]');
  if (files < 1) throw new Error("the review screen rendered no file of the candidate diff");
  has("the fixture's file is on screen", await text('[data-testid="review-shell"]'), "src/todo.mjs");

  // decisions 7, 8 — the verdict names the occurrence and the commit it reviewed.
  const before = requests.length;
  await page.locator('[data-testid="review-approve"]').click();
  await page.waitForSelector('[data-testid="review-resolved"]');
  const verdict = requests.slice(before).find((r) => r.method === "POST" && /\/approval$/.test(new URL(r.url).pathname));
  if (verdict === undefined) throw new Error("approve issued no POST to an approval route");
  const sent = JSON.parse(verdict.postData ?? "{}");
  eq("the verdict carries the occurrence id", dec, sent.decisionId);
  eq("the verdict carries the head OID it reviewed", head, sent.expectedCommit);

  // decision 12 — the resolved state renders IN PLACE. Never auto-navigate.
  eq("the resolved state rendered", true, await visible('[data-testid="review-resolved"]'));
  eq("...on the same URL", true, page.url().includes(`#/inbox/${dec}/review`));

  eq("no console error", 0, consoleErrors.length);

  // R3.
  const offenders = requests.filter((r) => r.authorization !== null);
  if (offenders.length > 0) {
    throw new Error(`page code set Authorization on: ${offenders.map((o) => o.url).join(", ")}`);
  }
};
STEPS

PROOF_DEC="$DEC3" PROOF_HEAD="$OID3" \
  node "$ROOT/scripts/e2e/ui-browser.mjs" --base="$BASE" --key="$KEY" --script="$PD/steps.mjs" \
  || { echo "FAILED: browser phase G" >&2; exit 1; }

eq "the browser verdict really transitioned subject 3" "integrated" "$(ostatus "$O3")"

echo "026.9 ok: a real objective candidate served a real diff without touching the bare home, stale and closed verdicts were refused, discard went through its dry run, and the browser approved subject 3 in place"
