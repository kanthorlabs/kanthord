#!/usr/bin/env bash
# update-ai-provider-proof.sh — EPIC 018 Proof (deterministic, no model, no
# outbound network — the endpoint is a 127.0.0.1 mock — no daemon).
#
# Proves that a registered AI provider can be edited IN PLACE: the model, the
# base URL and the secret change on the row that already exists, keeping its id,
# its name, its default pointer and its project assignment, and the very next
# call through the resolution path uses the new configuration with no restart.
#
# Against the CURRENT tree this fails in phase B: `update` has no `ai-provider`
# subcommand (src/apps/cli/commands/update/ holds only credential, filesystem,
# notification, repository). Phase A uses only commands that exist today, so the
# first failure is the missing capability and not a broken fixture.
#
# Motivation: /e2e run 20260729-121823 finding S1 — mid-run the provider returned
# 403 AllocationQuota.FreeTierOnly and switching model took four commands
# (register under a new name + unassign + assign + set-default) plus a duplicate
# account row.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

PD="$(mktemp -d)"
MOCK_A_PID=""
MOCK_B_PID=""
cleanup() {
  [ -n "$MOCK_A_PID" ] && kill "$MOCK_A_PID" 2>/dev/null || true
  [ -n "$MOCK_B_PID" ] && kill "$MOCK_B_PID" 2>/dev/null || true
  rm -rf "$PD"
}
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K() { node "$ROOT/src/main.ts" "$@"; }

jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
eq() { [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }
# Run a command that MUST exit non-zero. The ERR trap is detached for the call:
# with `set -E` bash fires it inside functions even under `set +e`, which would
# print a misleading FAILED line for an expected failure.
expect_fail() { local out="$1"; shift
  trap - ERR; set +e; "$@" >"$out" 2>&1; local rc=$?; set -e
  trap 'echo "FAILED: $0 line $LINENO" >&2' ERR
  [ "$rc" -ne 0 ] || { echo "FAILED: expected non-zero exit from: $*" >&2; exit 1; }; }

# A full content fingerprint of every user table. Row counts alone would miss an
# in-place UPDATE, which is exactly what this epic adds.
cat > "$PD/fingerprint.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
const out = [];
for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
  out.push(`${t} ${rows.length} ${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`);
}
process.stdout.write(out.join("\n") + "\n");
EOF
fingerprint() { node "$PD/fingerprint.mjs"; }

# Read the provider row straight from SQLite — never through the command under test.
cat > "$PD/prov.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const r = db.prepare("SELECT * FROM ai_providers WHERE id = ?").get(process.argv[2]);
process.stdout.write(r === undefined ? "MISSING" : String(r[process.argv[3]] ?? "NULL"));
EOF
prov() { node "$PD/prov.mjs" "$1" "$2"; }
count() { node -e 'import("node:sqlite").then(({DatabaseSync})=>{const d=new DatabaseSync(process.env.KANTHORD_DB,{readOnly:true});process.stdout.write(String(d.prepare(`SELECT COUNT(*) n FROM ${process.argv[1]}`).get().n))})' "$1"; }

# A RECORDING OpenAI-completions mock, owned by this proof. It mirrors
# scripts/e2e/mock-openai-completions.mjs (008.1 Story D) and adds the one thing
# this epic must assert: it appends "<model> <authorization>" per request to
# MOCK_RECORD. The shared mock is deliberately left untouched, so the 008.1 proof
# keeps its fixture and this proof's phase A runs on today's tree.
cat > "$PD/mock.mjs" <<'EOF'
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const record = process.env.MOCK_RECORD;
const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let model = "UNPARSEABLE";
      try { model = JSON.parse(body).model ?? "NO-MODEL"; } catch {}
      appendFileSync(record, `${model} ${req.headers.authorization ?? "NO-AUTH"}\n`);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      for (const c of [
        `data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n`,
        `data: {"choices":[{"delta":{"content":"MOCK-OK"}}]}\n\n`,
        `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n`,
        `data: [DONE]\n\n`,
      ]) res.write(c);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`http://127.0.0.1:${server.address().port}/v1\n`);
});
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
EOF

start_mock() { # start_mock <record-file> -> prints "<baseUrl> <pid>"
  local rec="$1" out="$PD/mock-$$-$RANDOM.out"
  : > "$rec"
  MOCK_RECORD="$rec" node "$PD/mock.mjs" >"$out" 2>&1 &
  local pid=$!
  for _ in $(seq 1 100); do
    [ -s "$out" ] && break
    sleep 0.1
  done
  local url
  url="$(head -1 "$out")"
  case "$url" in http://127.0.0.1:*) : ;; *) echo "FAILED: mock did not print a base URL (got '$url')" >&2; exit 1 ;; esac
  printf '%s %s' "$url" "$pid"
}

K db migrate >/dev/null

# ── Phase A — a registered custom provider, on today's commands only ──────────
read -r URL_A MOCK_A_PID <<<"$(start_mock "$PD/rec-a.txt")"
printf 'key-old' > "$PD/key-old"
chmod 600 "$PD/key-old"

PROJECT="$(K create project --name proj-018 | head -1)"
PROV="$(K register ai-provider --name prov-018 --api openai-completions \
  --custom-provider-id custom-018 --base-url "$URL_A" --model model-old \
  --effort high --context-window 131072 --max-tokens 8192 \
  --value-file "$PD/key-old" --allow-insecure | head -1)"
K assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null
K set-default ai-provider --id "$PROV" >/dev/null

eq "stored model" "model-old" "$(prov "$PROV" model)"
K test ai-provider --id "$PROV" --prompt 'ping' >/dev/null
eq "mock A saw the old model" "model-old" "$(awk 'NR==1{print $1}' "$PD/rec-a.txt")"
eq "mock A saw the old key" "Bearer key-old" "$(awk 'NR==1{print $2" "$3}' "$PD/rec-a.txt")"
echo "A ok: a custom provider is registered, assigned, default, and calls out with model-old"

# ── Phase B — the model changes in place, identity and wiring survive ─────────
VER_BEFORE="$(prov "$PROV" credentialVersion)"
K update ai-provider --id "$PROV" --model model-new >/dev/null

eq "one provider row" "1" "$(count ai_providers)"
eq "same id, new model" "model-new" "$(prov "$PROV" model)"
eq "name unchanged" "prov-018" "$(prov "$PROV" name)"
eq "credentialVersion untouched" "$VER_BEFORE" "$(prov "$PROV" credentialVersion)"
eq "still the default" "$PROV" "$(K list ai-provider --json | jv 'v.find(p=>p.isDefault).id')"
eq "still assigned to the project" "1" "$(K list ai-provider --project "$PROJECT" --json | jv 'v.filter(p=>p.id==="'"$PROV"'").length')"
echo "B ok: the model changed on the existing row; id, name, default and assignment survived"

# ── Phase C — the resolution path uses the new model, no restart ─────────────
K test ai-provider --id "$PROV" --prompt 'ping' >/dev/null
eq "mock A saw the new model" "model-new" "$(awk 'NR==2{print $1}' "$PD/rec-a.txt")"
echo "C ok: the very next call used model-new with no restart and no re-assignment"

# ── Phase D — base URL and secret rotate together ────────────────────────────
read -r URL_B MOCK_B_PID <<<"$(start_mock "$PD/rec-b.txt")"
printf 'key-new' > "$PD/key-new"
chmod 600 "$PD/key-new"

K update ai-provider --id "$PROV" --base-url "$URL_B" --value-file "$PD/key-new" \
  --allow-insecure > "$PD/d.out" 2>&1
eq "credentialVersion bumped by one" "$((VER_BEFORE + 1))" "$(prov "$PROV" credentialVersion)"
grep -q 'key-new' "$PD/d.out" && { echo "FAILED: the new secret was echoed to an output stream" >&2; exit 1; }

K test ai-provider --id "$PROV" --prompt 'ping' >/dev/null
eq "mock B was called" "model-new" "$(awk 'NR==1{print $1}' "$PD/rec-b.txt")"
eq "mock B saw the new key" "Bearer key-new" "$(awk 'NR==1{print $2" "$3}' "$PD/rec-b.txt")"
eq "mock A was not called again" "2" "$(wc -l < "$PD/rec-a.txt" | tr -d ' ')"
echo "D ok: base URL and secret rotated together; the new key never reached an output stream"

# ── Phase E — every refusal leaves the database byte-identical ───────────────
FP="$(fingerprint)"
expect_fail "$PD/e1" K update ai-provider --id "$PROV"
expect_fail "$PD/e2" K update ai-provider --id "$PROV" --name other
expect_fail "$PD/e3" K update ai-provider --id "$PROV" --provider anthropic
expect_fail "$PD/e4" K update ai-provider --id "$PROV" --context-window 0
expect_fail "$PD/e5" K update ai-provider --id "$PROV" --base-url 'https://user:pw@example.com/v1'
expect_fail "$PD/e6" K update ai-provider --id "$PROV" --base-url 'http://example.com/v1'
eq "no refusal wrote anything" "$FP" "$(fingerprint)"

echo "E ok: no-op, immutable fields and bad values are all refused with zero writes"

# ── Phase F — the project-scoped read never leaks the secret ─────────────────
# Runs BEFORE the logout of phase G: the project chain lists ACTIVE providers
# only, so a logged-out sole provider would empty it for a reason that has
# nothing to do with this epic.
LIST="$(K list ai-provider --project "$PROJECT" --json)"
eq "one provider in the project chain" "1" "$(jv 'v.length' <<<"$LIST")"
eq "the listed model is the new one" "model-new" "$(jv 'v[0].model' <<<"$LIST")"
eq "no value key is exposed" "false" "$(jv '"value" in v[0]' <<<"$LIST")"
echo "F ok: the project chain shows the updated provider and no secret"

# ── Phase G — a logged_out provider is refused, and writes nothing ───────────
# The sole provider IS the default, so logout requires the explicit no-default
# confirmation (src/apps/cli/ai-provider.ts runLogoutAiProvider). This phase is
# last because it leaves the provider inactive.
K logout ai-provider --id "$PROV" --confirm-no-default >/dev/null
FP2="$(fingerprint)"
expect_fail "$PD/e7" K update ai-provider --id "$PROV" --model model-third
eq "a logged_out provider is refused with no write" "$FP2" "$(fingerprint)"
grep -qi 'logged_out\|logged out' "$PD/e7" || { echo "FAILED: the refusal does not name the state" >&2; cat "$PD/e7" >&2; exit 1; }
echo "G ok: an update against a logged_out provider is refused with zero writes"

echo "018 ok: an AI provider is edited in place — model, base URL and key — keeping its id, name, default and assignments, with the next call using the new config"
