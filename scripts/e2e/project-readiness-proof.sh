#!/usr/bin/env bash
# project-readiness-proof.sh — EPIC 014 Proof (deterministic, no model, no
# network beyond a local file:// remote).
#
# Proves that `check project` separates configured / verified / operational, never
# reports a merely-recorded prerequisite as ok, spawns no git by default, verifies
# real remote access under --probe-repositories, and reads a heartbeat that goes
# stale when the daemon dies.
#
# Run from the repo root. Against the CURRENT tree phase A fails: there is no
# `check project` command.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

PD="$(mktemp -d)"
DAEMON=""
cleanup() { [ -n "$DAEMON" ] && kill "$DAEMON" 2>/dev/null || true; rm -rf "$PD"; }
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"
# Short staleness window so the proof can observe a stale heartbeat without
# sleeping for minutes. Test-only override of the shipped constant.
export KANTHORD_HEARTBEAT_STALE_MS=2000

jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
ck() { jv 'v.checks.find(c=>c.name==="'"$1"'").status'; }
# Run a command that MUST exit non-zero. The ERR trap is detached for the call:
# with `set -E` bash fires it inside functions even under `set +e`, which would
# print a misleading FAILED line for an expected failure.
expect_fail() { local out="$1"; shift
  trap - ERR; set +e; "$@" >"$out" 2>&1; local rc=$?; set -e
  trap 'echo "FAILED: $0 line $LINENO" >&2' ERR
  [ "$rc" -ne 0 ] || { echo "FAILED: expected non-zero exit from: $*" >&2; exit 1; }; }
poll() { local secs="$1"; shift; local n=$(( secs * 5 )); local i=0
  while [ "$i" -lt "$n" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; i=$((i+1)); done
  echo "FAILED: condition never held within ${secs}s: $*" >&2; return 1; }

node src/main.ts db migrate >/dev/null

# ── Phase A — an unknown project id is a clear error, not an empty report ──────
expect_fail "$PD/unknown.txt" node src/main.ts check project --id 01AAAAAAAAAAAAAAAAAAAAAAAA --json
# Matched precisely: a bare `unknown` would also match "unknown command 'project'",
# so a missing command would false-green this phase.
grep -qiE 'no project with id' "$PD/unknown.txt"
echo "A ok: unknown project id is a clear error"

# ── Phase B — a bare project: missing prerequisites, structured next ───────────
PROJECT=$(node src/main.ts create project --name demo)
expect_fail "$PD/bare.json" node src/main.ts check project --id "$PROJECT" --json
test "$(ck database   < "$PD/bare.json")" = "ok"
test "$(ck repository < "$PD/bare.json")" = "missing"
test "$(ck ai_provider < "$PD/bare.json")" = "missing"
test "$(ck initiative < "$PD/bare.json")" = "missing"
test "$(jv 'v.configured' < "$PD/bare.json")" = "false"
test "$(jv 'v.ready'      < "$PD/bare.json")" = "false"
# No probe ran, so `verified` is null — never true by default.
test "$(jv 'v.verified===null' < "$PD/bare.json")" = "true"
# Notification is reported, not hidden: no notifier exists in src.
test "$(ck notification < "$PD/bare.json")" = "unsupported"
test "$(jv 'v.checks.find(c=>c.name==="notification").blocking' < "$PD/bare.json")" = "false"
# `next` is a STRUCTURED action. Configuring a repository needs user decisions the
# report cannot invent, so it names them and carries NO command.
test "$(jv 'v.next.check' < "$PD/bare.json")" = "repository"
test "$(jv 'v.next.requiresInput.includes("remoteUrl")' < "$PD/bare.json")" = "true"
test "$(jv 'v.next.requiresInput.includes("auth")' < "$PD/bare.json")" = "true"
test "$(jv 'v.next.command===undefined||v.next.command===null' < "$PD/bare.json")" = "true"
echo "B ok: missing prerequisites, verified=null, structured next without a guessed command"

# ── Phase C — recorded is not verified; unassigned provider does not count ─────
HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
SEED="$PD/seed"; git clone -q "$HOME_REMOTE" "$SEED"
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
REPO=$(node src/main.ts create repository --project "$PROJECT" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror")

expect_fail "$PD/c1.json" node src/main.ts check project --id "$PROJECT" --json
# Recorded, not probed: `unverified`, NOT ok.
test "$(ck repository < "$PD/c1.json")" = "unverified"
test "$(jv 'v.next.check' < "$PD/c1.json")" = "ai_provider"

DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV=$(node src/main.ts register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
# Registered but not assigned to this project. `register` makes it the active
# global DEFAULT, and resolveProviderChain appends the active default
# (src/domain/resolve-provider-chain.ts), so the daemon WOULD run on it. The
# report must therefore say `unverified`, never `missing` — a report stricter than
# the daemon is its own kind of lie. The detail still names `assign` so the
# implicit dependency on a global default is visible.
expect_fail "$PD/c2.json" node src/main.ts check project --id "$PROJECT" --json
test "$(ck ai_provider < "$PD/c2.json")" = "unverified"
test "$(jv 'v.checks.find(c=>c.name==="ai_provider").detail.includes("default")' < "$PD/c2.json")" = "true"
test "$(jv 'v.checks.find(c=>c.name==="ai_provider").detail.includes("assign")' < "$PD/c2.json")" = "true"

node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null
expect_fail "$PD/c3.json" node src/main.ts check project --id "$PROJECT" --json
# Assigned but never tested — the dummy credential would fail a real call.
test "$(ck ai_provider < "$PD/c3.json")" = "unverified"
test "$(jv 'v.next.check' < "$PD/c3.json")" = "initiative"
echo "C ok: recorded reads unverified; an unassigned provider does not satisfy the check"

# ── Phase D — an https-token repository with a dangling credential is blocked ──
# Done in a THROWAWAY project: `AddResource` does not validate credential
# references (src/app/resource/add-resource.ts), and there is no `remove resource`
# leaf (src/apps/cli/commands/remove.ts registers four leaves, none of them
# `resource`), so a bad repository created in $PROJECT could never be cleaned up
# and would poison every later phase.
SCRATCH_P=$(node src/main.ts create project --name scratch-badcred)
node src/main.ts create repository --project "$SCRATCH_P" --name needs-cred \
  --remote-url "file://$HOME_REMOTE" --branch main --auth https-token \
  --credential 01BBBBBBBBBBBBBBBBBBBBBBBB --path "$PD/mirror-badcred" >/dev/null
expect_fail "$PD/d0.json" node src/main.ts check project --id "$SCRATCH_P" --json
test "$(ck repository < "$PD/d0.json")" = "blocked"
test "$(jv 'v.checks.find(c=>c.name==="repository").detail.includes("credential")' < "$PD/d0.json")" = "true"
test "$(jv 'v.configured' < "$PD/d0.json")" = "false"
echo "D ok: a dangling credential reference makes the repository blocked, not ok"

# ── Phase E — runnable work: paused vs empty vs ok, deterministic next ─────────
INIT=$(node src/main.ts create initiative --project "$PROJECT" --name feature-one)
# An initiative with no incomplete task is `blocked`, not `ok`.
expect_fail "$PD/e0.json" node src/main.ts check project --id "$PROJECT" --json
test "$(ck initiative < "$PD/e0.json")" = "blocked"

OBJ=$(node src/main.ts create objective --initiative "$INIT" --name obj)
node src/main.ts create task --objective "$OBJ" --title "do the thing" \
  --instructions x --ac y --context repository="$REPO" >/dev/null
node src/main.ts pause initiative --id "$INIT" >/dev/null

expect_fail "$PD/e1.json" node src/main.ts check project --id "$PROJECT" --json
test "$(ck initiative < "$PD/e1.json")" = "paused"
# This next IS fully known, so it carries a runnable command with the real id.
test "$(jv 'v.next.command.includes("resume initiative")' < "$PD/e1.json")" = "true"
test "$(jv 'v.next.command.includes("'"$INIT"'")' < "$PD/e1.json")" = "true"
test "$(jv 'v.next.requiresInput.length' < "$PD/e1.json")" = "0"

node src/main.ts resume initiative --id "$INIT" >/dev/null
expect_fail "$PD/e2.json" node src/main.ts check project --id "$PROJECT" --json
test "$(ck initiative < "$PD/e2.json")" = "ok"
# Configured now holds, but nothing is verified and no daemon runs, so NOT ready.
test "$(jv 'v.configured'  < "$PD/e2.json")" = "true"
test "$(jv 'v.operational' < "$PD/e2.json")" = "false"
test "$(jv 'v.ready'       < "$PD/e2.json")" = "false"
echo "E ok: empty vs paused vs runnable are distinct; configured does not imply ready"

# ── Phase F — no git process is spawned without a probe flag ───────────────────
# A shim earlier in PATH fails loudly if the default path shells out to git.
mkdir -p "$PD/shim"
cat > "$PD/shim/git" <<'EOF'
#!/usr/bin/env bash
echo "git invoked without a probe flag: $*" >> "$KANTHORD_GIT_SHIM_LOG"
exit 42
EOF
chmod +x "$PD/shim/git"
export KANTHORD_GIT_SHIM_LOG="$PD/git-calls.log"; : > "$KANTHORD_GIT_SHIM_LOG"
PATH="$PD/shim:$PATH" node src/main.ts check project --id "$PROJECT" --json > "$PD/f0.json" 2>&1 || true
test ! -s "$KANTHORD_GIT_SHIM_LOG" || {
  echo "FAILED: default check spawned git:" >&2; cat "$KANTHORD_GIT_SHIM_LOG" >&2; exit 1; }
echo "F ok: the default check spawns no git process"

# ── Phase G — --probe-repositories verifies real access, and clones nothing ────
BOGUS=$(node src/main.ts create repository --project "$PROJECT" --name broken \
  --remote-url "file://$PD/does-not-exist.git" --branch main --auth ambient --path "$PD/mirror-bogus")
# Snapshot BOTH repository paths so "no clone" is proven for the reachable one too.
before_reachable="$(ls -A "$PD/mirror" 2>/dev/null | sort || true)"
before_bogus="$(ls -A "$PD/mirror-bogus" 2>/dev/null | sort || true)"

expect_fail "$PD/g1.json" node src/main.ts check project --id "$PROJECT" --probe-repositories --json
test "$(jv 'v.checks.find(c=>c.name==="repository").probes.find(p=>p.resourceId==="'"$BOGUS"'").status' < "$PD/g1.json")" = "failed"
test "$(jv 'v.checks.find(c=>c.name==="repository").probes.find(p=>p.resourceId==="'"$REPO"'").status' < "$PD/g1.json")" = "ok"
# One probe failed, so the run is not verified and not ready.
test "$(jv 'v.verified' < "$PD/g1.json")" = "false"
test "$(jv 'v.ready'    < "$PD/g1.json")" = "false"
# Neither repository path was touched: ls-remote must not clone.
test "$(ls -A "$PD/mirror" 2>/dev/null | sort || true)"       = "$before_reachable"
test "$(ls -A "$PD/mirror-bogus" 2>/dev/null | sort || true)" = "$before_bogus"

# A remote that answers but lacks the configured branch is `failed`, not `ok`.
WRONGBR=$(node src/main.ts create repository --project "$PROJECT" --name wrong-branch \
  --remote-url "file://$HOME_REMOTE" --branch nope --auth ambient --path "$PD/mirror-wb")
expect_fail "$PD/g2.json" node src/main.ts check project --id "$PROJECT" --probe-repositories --json
test "$(jv 'v.checks.find(c=>c.name==="repository").probes.find(p=>p.resourceId==="'"$WRONGBR"'").status' < "$PD/g2.json")" = "failed"
test "$(jv 'v.checks.find(c=>c.name==="repository").probes.find(p=>p.resourceId==="'"$WRONGBR"'").detail.includes("nope")' < "$PD/g2.json")" = "true"
echo "G ok: --probe-repositories verifies remote and branch, clones nothing"

# ── Phase H — the heartbeat reads live, then goes stale when the daemon dies ───
# Pause the initiative first, so the daemon has nothing to claim: this phase tests
# the heartbeat, not task execution against a dummy credential.
node src/main.ts pause initiative --id "$INIT" >/dev/null
test "$(ck daemon < "$PD/g2.json")" = "stopped"

node src/main.ts run daemon --poll-interval 200 >"$PD/daemon.log" 2>&1 &
DAEMON=$!
poll 30 bash -c 'node src/main.ts check project --id "'"$PROJECT"'" --json 2>/dev/null > "'"$PD"'/h1.json" || true
  [ "$(node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const v=JSON.parse(s);process.stdout.write(v.checks.find(c=>c.name===\"daemon\").status)})" < "'"$PD"'/h1.json")" = "running" ]'
test "$(jv 'v.operational' < "$PD/h1.json")" = "true"
test "$(jv 'typeof v.checks.find(c=>c.name==="daemon").ageSeconds' < "$PD/h1.json")" = "number"

# Kill it and wait PAST the staleness window: the check must flip to `stopped`,
# not merely report an age.
kill "$DAEMON" 2>/dev/null || true; wait "$DAEMON" 2>/dev/null || true; DAEMON=""
poll 30 bash -c 'node src/main.ts check project --id "'"$PROJECT"'" --json 2>/dev/null > "'"$PD"'/h2.json" || true
  [ "$(node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const v=JSON.parse(s);process.stdout.write(v.checks.find(c=>c.name===\"daemon\").status)})" < "'"$PD"'/h2.json")" = "stopped" ]'
test "$(jv 'v.operational' < "$PD/h2.json")" = "false"
echo "H ok: the heartbeat reads running while alive and flips to stopped once stale"

echo "014 ok: configured/verified/operational separated, unverified never ok, offline by default, real probes, stale-aware heartbeat"
