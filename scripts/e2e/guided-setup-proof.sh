#!/usr/bin/env bash
# guided-setup-proof.sh — EPIC 015 Proof (deterministic, no model, no network
# beyond a local file:// remote, no prompting: every answer comes from --answers).
#
# HOME is redirected into the run's temp dir: AddResource derives a repository
# path under `homedir()/.kanthord/repos` when none is given
# (src/app/resource/add-resource.ts:56,60), so a stray default must not be able to
# touch the real home.
#
# Run from the repo root. Against the CURRENT tree phase A fails: there is no
# `setup` command group.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

PD="$(mktemp -d)"; trap 'rm -rf "$PD"' EXIT
export HOME="$PD/home"; mkdir -p "$HOME"
export KANTHORD_DB="$PD/kanthord.db"

jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
ck() { jv 'v.checks.find(c=>c.name==="'"$1"'").status'; }
expect_fail() { local out="$1"; shift
  trap - ERR; set +e; "$@" >"$out" 2>&1; local rc=$?; set -e
  trap 'echo "FAILED: $0 line $LINENO" >&2' ERR
  [ "$rc" -ne 0 ] || { echo "FAILED: expected non-zero exit from: $*" >&2; exit 1; }; }
# Full row-count fingerprint of every user table (23 lines today): the only honest
# way to assert "wrote nothing". Counting projects alone misses resources,
# providers, assignments, events and heartbeats. Guarded against silently
# collapsing to empty, which would make every no-write assertion vacuous.
snapshot() {
  local s; s="$(node src/main.ts db status 2>/dev/null | grep -E '^[a-z_]+: [0-9]+$' | sort)"
  [ "$(printf '%s\n' "$s" | grep -c .)" -ge 20 ] \
    || { echo "FAILED: db status fingerprint collapsed — no-write assertions would be vacuous" >&2; exit 1; }
  printf '%s\n' "$s"
}

node src/main.ts db migrate >/dev/null

HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED" 2>/dev/null
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main

SECRET="$PD/token"; printf 'super-secret-value' > "$SECRET"
GRAPH="$PD/g"; scripts/e2e/make-landing-graph.sh "$GRAPH" >/dev/null
export KANTHORD_FAKE_AGENT="$GRAPH/.fake-agent.json"

# The complete, valid answer set. Individual phases copy and mutate it.
write_full_answers() { cat > "$1" <<EOF
# comments and blank lines are ignored

project.name=demo
repository.name=home
repository.remoteUrl=file://$HOME_REMOTE
repository.branch=main
repository.path=$PD/mirror
repository.auth=https-token
credential.name=gh
credential.provider=github
credential.valueFile=$SECRET
provider.route=apiKey
provider.name=e2e
provider.provider=openai-codex
provider.model=gpt-5.6-sol
provider.valueFile=$SECRET
provider.confirmCost=true
graph.packagePath=$2
graph.bind.source=home
EOF
}

# ── Phase A — a missing answer names the key and writes NOTHING ────────────────
BEFORE="$(snapshot)"
cat > "$PD/incomplete.answers" <<EOF
project.name=demo
repository.name=home
repository.remoteUrl=file://$HOME_REMOTE
EOF
expect_fail "$PD/a.txt" node src/main.ts setup project --answers "$PD/incomplete.answers" --non-interactive
grep -qE 'repository\.(branch|path|auth)' "$PD/a.txt"
test "$(snapshot)" = "$BEFORE" || { echo "FAILED: a missing answer still wrote to the database" >&2; exit 1; }
echo "A ok: a missing answer names the key and writes nothing"

# ── Phase B — an inline secret is refused by a secret rule, never echoed ───────
BEFORE="$(snapshot)"
write_full_answers "$PD/inline.answers" "$GRAPH"
printf 'credential.value=super-secret-value\n' >> "$PD/inline.answers"
expect_fail "$PD/b.txt" node src/main.ts setup project --answers "$PD/inline.answers" --non-interactive
# A secret-SPECIFIC message, not a generic unknown-key error: the rule under test
# is that inline secrets are refused on purpose.
grep -qiE 'valueFile|value file|must be a path' "$PD/b.txt"
grep -qi 'unknown key' "$PD/b.txt" && { echo "FAILED: inline secret rejected only as an unknown key" >&2; exit 1; }
grep -q 'super-secret-value' "$PD/b.txt" && { echo "FAILED: the refusal echoed the secret" >&2; exit 1; }
test "$(snapshot)" = "$BEFORE"
echo "B ok: an inline secret is refused by a secret-specific rule, without echoing it"

# ── Phase C — unknown key, and a key irrelevant to the chosen route ───────────
BEFORE="$(snapshot)"
write_full_answers "$PD/unknown.answers" "$GRAPH"
printf 'repository.colour=blue\n' >> "$PD/unknown.answers"
expect_fail "$PD/c1.txt" node src/main.ts setup project --answers "$PD/unknown.answers" --non-interactive
grep -q 'repository.colour' "$PD/c1.txt"

# `provider.route=apiKey` makes an OAuth-only key irrelevant — an error, not a
# silent ignore, so a typo cannot look like it worked.
write_full_answers "$PD/irrelevant.answers" "$GRAPH"
printf 'provider.oauthMethod=browser\n' >> "$PD/irrelevant.answers"
expect_fail "$PD/c2.txt" node src/main.ts setup project --answers "$PD/irrelevant.answers" --non-interactive
grep -q 'provider.oauthMethod' "$PD/c2.txt"
test "$(snapshot)" = "$BEFORE"
echo "C ok: unknown and route-irrelevant keys are refused by name, with no writes"

# ── Phase D — an embedded credential in the remote URL is refused, redacted ────
BEFORE="$(snapshot)"
write_full_answers "$PD/embedded.answers" "$GRAPH"
node -e '
const fs=require("fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^repository\.remoteUrl=.*$/m,
  "repository.remoteUrl=https://user:tok3n-should-not-appear@example.com/r.git"));' "$PD/embedded.answers"
expect_fail "$PD/d.txt" node src/main.ts setup project --answers "$PD/embedded.answers" --non-interactive
grep -qiE 'embedded credential|must not contain' "$PD/d.txt"
grep -q 'tok3n-should-not-appear' "$PD/d.txt" && {
  echo "FAILED: the refusal echoed the embedded token" >&2; exit 1; }
test "$(snapshot)" = "$BEFORE"
echo "D ok: an embedded credential is refused with a redacted message"

# ── Phase E — an unreachable remote is rejected at its step ────────────────────
write_full_answers "$PD/badremote.answers" "$GRAPH"
node -e '
const fs=require("fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^repository\.remoteUrl=.*$/m,
  "repository.remoteUrl=file://"+process.argv[2]+"/does-not-exist.git"));' "$PD/badremote.answers" "$PD"
expect_fail "$PD/e.txt" node src/main.ts setup project --answers "$PD/badremote.answers" --non-interactive
grep -qiE 'remote|unreachable|ls-remote|does-not-exist' "$PD/e.txt"
# The project step may legitimately have committed before the repository step ran,
# but the unreachable repository itself must NOT be recorded.
P_BAD=$(node src/main.ts list project --json | jv 'v.length?v[0].id:""')
if [ -n "$P_BAD" ]; then
  test "$(node src/main.ts list repository --project "$P_BAD" --json | jv 'v.length')" = "0"
fi
echo "E ok: an unreachable remote is rejected and not recorded"

# ── Phase F — a full run configures the project end to end ─────────────────────
export KANTHORD_DB="$PD/full.db"; node src/main.ts db migrate >/dev/null
write_full_answers "$PD/full.answers" "$GRAPH"
node src/main.ts setup project --answers "$PD/full.answers" --non-interactive > "$PD/f.txt" 2>&1

grep -q 'super-secret-value' "$PD/f.txt" && { echo "FAILED: output contains the secret" >&2; exit 1; }
PROJECT=$(node src/main.ts list project --json | jv 'v[0].id')
test -n "$PROJECT"
# The closing output names the project id and the exact next command.
grep -q "$PROJECT" "$PD/f.txt"
grep -qE 'run daemon' "$PD/f.txt"
# Terminal state: a graph WAS imported, so work exists.
grep -qE 'configured-with-work' "$PD/f.txt"

node src/main.ts check project --id "$PROJECT" --json > "$PD/f.json" || true
test "$(jv 'v.configured' < "$PD/f.json")" = "true"
test "$(ck initiative < "$PD/f.json")" = "ok"
# Exact statuses, not `!= missing`: `unverified` and `blocked` must not pass here.
test "$(ck repository  < "$PD/f.json")" = "unverified"
test "$(ck ai_provider < "$PD/f.json")" = "unverified"
# The https-token repository really references the credential setup created.
CRED=$(node src/main.ts list credential --project "$PROJECT" --json | jv 'v[0].id')
REPO=$(node src/main.ts list repository --project "$PROJECT" --json | jv 'v[0].id')
# The credential reference lives on the auth object (src/domain/resource.ts:15),
# not as a top-level field.
test "$(node src/main.ts get repository --id "$REPO" --json | jv 'v.auth.credentialId')" = "$CRED"
test "$(node src/main.ts list credential --project "$PROJECT" --json | jv 'v[0].value===undefined')" = "true"
# No secret in any persisted resource JSON either.
node src/main.ts get resource --id "$CRED" --json | grep -q 'super-secret-value' && {
  echo "FAILED: the stored credential view exposes its value" >&2; exit 1; }
# The graph binding really resolved to that repository.
INIT=$(node src/main.ts list initiative --project "$PROJECT" --json | jv 'v[0].id')
test "$(node src/main.ts list task --initiative "$INIT" --json | jv 'v.length>0')" = "true"
echo "F ok: one run produces a configured project, credential bound, no secret anywhere"

# ── Phase G — no daemon started, no task ran ───────────────────────────────────
node src/main.ts list event --after 0 --limit 1000 --json > "$PD/ev.json"
test "$(jv 'v.events.every(e=>!["task.started","agent.started","task.completed","task.failed"].includes(e.type))' < "$PD/ev.json")" = "true"
test "$(ck daemon < "$PD/f.json")" = "stopped"
test "$(node src/main.ts list task --initiative "$INIT" --json | jv 'v.every(t=>t.status==="pending")')" = "true"
echo "G ok: setup started no daemon and ran no task"

# ── Phase H — a second identical run is a free no-op ──────────────────────────
BEFORE="$(snapshot)"
node src/main.ts setup project --answers "$PD/full.answers" --non-interactive > "$PD/h.txt" 2>&1
test "$(snapshot)" = "$BEFORE" || { echo "FAILED: an identical rerun changed the database" >&2; exit 1; }
# Each step is reported as already satisfied, per step — not one vague word.
for step in project repository credential provider graph; do
  grep -qiE "$step.*(already|satisfied|unchanged)" "$PD/h.txt" \
    || { echo "FAILED: rerun did not report step '$step' as satisfied" >&2; exit 1; }
done
echo "H ok: an identical rerun writes nothing and reports every step satisfied"

# ── Phase I — a CHANGED answer is drift: refused, with expected vs actual ─────
BEFORE="$(snapshot)"
OTHER_REMOTE="$PD/other.git"; git init -q --bare -b main "$OTHER_REMOTE"
write_full_answers "$PD/drift.answers" "$GRAPH"
node -e '
const fs=require("fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^repository\.remoteUrl=.*$/m,
  "repository.remoteUrl=file://"+process.argv[2]));' "$PD/drift.answers" "$OTHER_REMOTE"
expect_fail "$PD/i.txt" node src/main.ts setup project --answers "$PD/drift.answers" --non-interactive
grep -qiE 'drift|differs|expected' "$PD/i.txt"
grep -q "$OTHER_REMOTE" "$PD/i.txt"     # expected
grep -q "$HOME_REMOTE"  "$PD/i.txt"     # actual
test "$(snapshot)" = "$BEFORE" || { echo "FAILED: drift run mutated the project" >&2; exit 1; }
echo "I ok: a changed answer is reported as drift and mutates nothing"

# ── Phase J — resume after a FAILED step, not after a missing answer ───────────
export KANTHORD_DB="$PD/resume.db"; node src/main.ts db migrate >/dev/null
# A valid answer set whose graph path does not exist: project/repo/credential/
# provider steps succeed, the graph step fails.
write_full_answers "$PD/resume-bad.answers" "$PD/no-such-package"
expect_fail "$PD/j1.txt" node src/main.ts setup project --answers "$PD/resume-bad.answers" --non-interactive
P2=$(node src/main.ts list project --json | jv 'v[0].id')
test "$(node src/main.ts list repository --project "$P2" --json | jv 'v.length')" = "1"
test "$(node src/main.ts list initiative --project "$P2" --json | jv 'v.length')" = "0"

# Fix only the graph answer: the run resumes and duplicates nothing.
write_full_answers "$PD/resume-good.answers" "$GRAPH"
node src/main.ts setup project --answers "$PD/resume-good.answers" --non-interactive > "$PD/j2.txt" 2>&1
test "$(node src/main.ts list project --json | jv 'v.length')" = "1"
test "$(node src/main.ts list repository --project "$P2" --json | jv 'v.length')" = "1"
test "$(node src/main.ts list credential --project "$P2" --json | jv 'v.length')" = "1"
test "$(node src/main.ts list initiative --project "$P2" --json | jv 'v.length')" = "1"
node src/main.ts check project --id "$P2" --json > "$PD/j.json" || true
test "$(jv 'v.configured' < "$PD/j.json")" = "true"
echo "J ok: a failed step resumes on the next run without duplicating earlier steps"

# ── Phase K — skipping the graph is a DIFFERENT success ───────────────────────
export KANTHORD_DB="$PD/nowork.db"; node src/main.ts db migrate >/dev/null
write_full_answers "$PD/nograph.answers" "$GRAPH"
node -e '
const fs=require("fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8")
  .split("\n").filter(l=>!l.startsWith("graph.")).join("\n")+"\ngraph.skip=true\n");' "$PD/nograph.answers"
node src/main.ts setup project --answers "$PD/nograph.answers" --non-interactive > "$PD/k.txt" 2>&1
grep -qE 'configured-no-work' "$PD/k.txt"
grep -qE 'import graph' "$PD/k.txt"          # names how to get work
grep -qE 'run daemon' "$PD/k.txt" && { echo "FAILED: no-work state told the user to run the daemon" >&2; exit 1; }
P3=$(node src/main.ts list project --json | jv 'v[0].id')
test "$(node src/main.ts list initiative --project "$P3" --json | jv 'v.length')" = "0"
echo "K ok: an explicit graph skip is a distinct success that does not promise work"

echo "015 ok: preflight-atomic answers, secret-safe, drift-refusing, verified per step, resumable, two honest terminal states"
