#!/usr/bin/env bash
# initiative-graph-proof.sh — EPIC 016 Proof (deterministic, no model, no network
# beyond local file:// remotes, no daemon left running).
#
# Proves that `get graph --initiative` serves a whole initiative DAG in ONE call
# with per-element scoped actions, that a permanently-blocked node says so and
# offers the only action the CLI actually accepts, that a paused initiative can
# never look runnable, that `get overview --project` digests only what has NOT
# been acknowledged, that acknowledgement happens solely through `ack project`,
# and that neither read writes a single byte.
#
# Run from the repo root. Against the CURRENT tree phase A fails: there is no
# `get graph` command.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

PD="$(mktemp -d)"
cleanup() { rm -rf "$PD"; }
trap cleanup EXIT

export KANTHORD_DB="$PD/kanthord.db"

jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
# Run a command that MUST exit non-zero. The ERR trap is detached for the call:
# with `set -E` bash fires it inside functions even under `set +e`, which would
# print a misleading FAILED line for an expected failure.
expect_fail() { local out="$1"; shift
  trap - ERR; set +e; "$@" >"$out" 2>&1; local rc=$?; set -e
  trap 'echo "FAILED: $0 line $LINENO" >&2' ERR
  [ "$rc" -ne 0 ] || { echo "FAILED: expected non-zero exit from: $*" >&2; exit 1; }; }

# ── Independent DB readers (node:sqlite, never the CLI under test) ─────────────
# A full content fingerprint of every user table: row COUNTS alone would miss an
# in-place UPDATE, and `PRAGMA data_version` is only meaningful when compared on
# ONE open connection — across separate CLI processes it proves nothing.
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
  const h = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  out.push(`${t} ${rows.length} ${h}`);
}
process.stdout.write(out.join("\n") + "\n");
EOF
cat > "$PD/events.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const q = process.argv[2];
if (q === "count") process.stdout.write(String(db.prepare("SELECT COUNT(*) c FROM events").get().c));
if (q === "max") process.stdout.write(String(db.prepare("SELECT MAX(id) m FROM events").get().m));
if (q === "min") process.stdout.write(String(db.prepare("SELECT MIN(id) m FROM events").get().m));
EOF
fingerprint() { node "$PD/fingerprint.mjs"; }
ev() { node "$PD/events.mjs" "$1"; }

node src/main.ts db migrate >/dev/null

# ── Shared setup — one project, two bare remotes, one provider ────────────────
PROJECT=$(node src/main.ts create project --name demo)

mkrepo() { # mkrepo <name> → echoes the repository id; seeds a bare remote + mirror
  local name="$1" remote="$PD/$1.git" seed="$PD/$1-seed" mirror="$PD/$1-mirror"
  git init -q --bare -b main "$remote"
  git clone -q "$remote" "$seed"
  git -C "$seed" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" push -q origin main
  node src/main.ts create repository --project "$PROJECT" --name "$name" \
    --remote-url "file://$remote" --branch main --auth ambient --path "$mirror"
}
REPO_A=$(mkrepo repoa)
REPO_B=$(mkrepo repob)

# generic@1 needs repository context only; the daemon auto-resolves the provider
# chain (008.3), which must be non-empty or every task fails. KANTHORD_FAKE_AGENT
# replaces the session factory, so this value is never read.
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV=$(node src/main.ts register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV" >/dev/null

# `import --create` rewrites a package's source files in place with minted ULIDs,
# so each initiative needs its OWN copy of the fixture.
GRAPH_A="$PD/graph-a"; scripts/e2e/make-landing-graph.sh "$GRAPH_A" >/dev/null
node src/main.ts import graph "$GRAPH_A" --create --project "$PROJECT" \
  --bind source="$REPO_A" >/dev/null
exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }
INIT_A=$(exportval "$GRAPH_A" 'j.initiativeId')
OBJ_A=$(exportval "$GRAPH_A" 'j.refToId.objectives["todo-api-obj"]')
rootof() { node src/main.ts list task --initiative "$1" --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(t=>/Create Task/.test(t.title||"")).id))'; }
ROOT_A=$(rootof "$INIT_A")
NODE_COUNT=$(node src/main.ts list task --initiative "$INIT_A" --json | jv 'v.length')
test "$NODE_COUNT" = "5"

G="$PD/g.json"
graph() { node src/main.ts get graph --initiative "$1" --json > "$G"; }
nd() { jv 'JSON.stringify(v.nodes.find(n=>n.id==="'"$1"'"))'; }   # one node as JSON
nf() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }

# ── Phase A — an unknown initiative id is a clear error, not an empty graph ────
expect_fail "$PD/unknown.txt" node src/main.ts get graph --initiative 01AAAAAAAAAAAAAAAAAAAAAAAA --json
# Matched precisely: a bare `unknown` would also match "unknown command 'graph'",
# so a missing command would false-green this phase.
grep -qiE 'no initiative with id' "$PD/unknown.txt"
echo "A ok: unknown initiative id is a clear error"

# ── Phase B — a fresh graph: complete, drawable, and nothing to act on ─────────
graph "$INIT_A"
test "$(jv 'v.nodes.length'   < "$G")" = "$NODE_COUNT"
test "$(jv 'v.projectId'      < "$G")" = "$PROJECT"          # breadcrumb (B1)
test "$(jv 'v.initiative.id'  < "$G")" = "$INIT_A"
test "$(jv 'v.groups.length'  < "$G")" = "1"
test "$(jv 'v.groups[0].id'   < "$G")" = "$OBJ_A"
# Every node's groupId resolves to a group that is actually in the payload.
test "$(jv 'const g=new Set(v.groups.map(x=>x.id)); v.nodes.every(n=>g.has(n.groupId))' < "$G")" = "true"
test "$(jv 'v.edges.length'   < "$G")" = "4"
# `from` is the DEPENDENCY, `to` is the dependent: all four tasks depend on the root.
test "$(jv 'v.edges.every(e=>e.from==="'"$ROOT_A"'")' < "$G")" = "true"
test "$(jv 'new Set(v.edges.map(e=>e.to)).size' < "$G")" = "4"
test "$(jv 'v.criticalPath.metric'      < "$G")" = "remaining-node-count"
test "$(jv 'v.criticalPath.length'      < "$G")" = "2"
test "$(jv 'v.criticalPath.nodeIds[0]'  < "$G")" = "$ROOT_A"
test "$(jv 'v.counts.actionable'        < "$G")" = "0"
test "$(jv 'v.nodes.every(n=>n.action===null)' < "$G")" = "true"
test "$(jv 'v.groups[0].action===null'  < "$G")" = "true"
test "$(nd "$ROOT_A" < "$G" | nf 'n.dependencyState')" = "ready"
test "$(nd "$ROOT_A" < "$G" | nf 'n.executionState')" = "runnable"
test "$(nd "$ROOT_A" < "$G" | nf 'n.downstream')" = "4"
test "$(jv 'v.nodes.filter(n=>n.id!=="'"$ROOT_A"'").every(n=>n.dependencyState==="blocked")' < "$G")" = "true"
test "$(jv 'v.nodes.every(n=>n.blockedForever===false)' < "$G")" = "true"
echo "B ok: one call returns a complete, drawable graph with nothing actionable"

# ── Phase C — a failed root: retry on itself, dependents blocked but clearable ─
export KANTHORD_FAKE_AGENT="$GRAPH_A/.fake-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200 --fail "$ROOT_A" >/dev/null
graph "$INIT_A"
test "$(nd "$ROOT_A" < "$G" | nf 'n.status')"             = "failed"
test "$(nd "$ROOT_A" < "$G" | nf 'n.action.kind')"        = "retry"
test "$(nd "$ROOT_A" < "$G" | nf 'n.action.target.type')" = "task"
test "$(nd "$ROOT_A" < "$G" | nf 'n.action.target.id')"   = "$ROOT_A"
test "$(nd "$ROOT_A" < "$G" | nf 'n.failureReason!==null')" = "true"
DEPS='v.nodes.filter(n=>n.id!=="'"$ROOT_A"'")'
test "$(jv "$DEPS.every(n=>n.status==='pending')"            < "$G")" = "true"
test "$(jv "$DEPS.every(n=>n.dependencyState==='blocked')"   < "$G")" = "true"
test "$(jv "$DEPS.every(n=>n.blockedForever===false)"        < "$G")" = "true"
test "$(jv "$DEPS.every(n=>n.waiting.length===1&&n.waiting[0].id==='$ROOT_A'&&n.waiting[0].neverSatisfies===false)" < "$G")" = "true"
echo "C ok: failed root offers retry; dependents are blocked but can still clear"

# ── Phase D — discarding the root cascades over the pending dependent closure ──
node src/main.ts reject task --id "$ROOT_A" --resolution discard >/dev/null
graph "$INIT_A"
test "$(nd "$ROOT_A" < "$G" | nf 'n.status')" = "discarded"
test "$(jv 'v.nodes.every(n=>n.status==="discarded")' < "$G")" = "true"
test "$(jv 'v.nodes.every(n=>n.action===null)'        < "$G")" = "true"
test "$(jv 'v.criticalPath.nodeIds.length'            < "$G")" = "0"
echo "D ok: discard cascades; a discarded node offers nothing"

# ── Phase E — the permanent block, built the only way it is reachable ─────────
# `reject task` REFUSES a pending task (reject-task.ts:86-92) and `retry task`
# requires `failed`, so the only action that can free a node whose dependency is
# permanently dead is `remove dependency` — legal precisely because edges are
# editable while pending.
W=$(node src/main.ts create task --objective "$OBJ_A" --title "Blocked forever" \
  --instructions "waits on a discarded dependency" --agent fake@1)
node src/main.ts add dependency --task "$W" --dependency "$ROOT_A" >/dev/null
graph "$INIT_A"
test "$(nd "$W" < "$G" | nf 'n.status')"          = "pending"
test "$(nd "$W" < "$G" | nf 'n.dependencyState')" = "blocked"
test "$(nd "$W" < "$G" | nf 'n.blockedForever')"  = "true"
test "$(nd "$W" < "$G" | nf 'n.waiting.length')"  = "1"
test "$(nd "$W" < "$G" | nf 'n.waiting[0].id')"   = "$ROOT_A"
test "$(nd "$W" < "$G" | nf 'n.waiting[0].neverSatisfies')" = "true"
test "$(nd "$W" < "$G" | nf 'n.action.kind')"     = "remove-dependency"
test "$(nd "$W" < "$G" | nf 'n.action.target.id')" = "$W"
test "$(nd "$W" < "$G" | nf 'n.action.targetDependencyId')" = "$ROOT_A"
# The offered command must be runnable, not a prose hint.
test "$(nd "$W" < "$G" | nf 'n.action.command.includes("remove dependency")')" = "true"
echo "E ok: a permanently blocked node says so and offers the only accepted action"

# ── Phase F — a successful initiative: approve lives on the objective ─────────
GRAPH_B="$PD/graph-b"; scripts/e2e/make-landing-graph.sh "$GRAPH_B" >/dev/null
node src/main.ts import graph "$GRAPH_B" --create --project "$PROJECT" \
  --bind source="$REPO_B" >/dev/null
INIT_B=$(exportval "$GRAPH_B" 'j.initiativeId')
OBJ_B=$(exportval "$GRAPH_B" 'j.refToId.objectives["todo-api-obj"]')
ROOT_B=$(rootof "$INIT_B")
export KANTHORD_FAKE_AGENT="$GRAPH_B/.fake-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null
graph "$INIT_B"
test "$(jv 'v.groups[0].status'           < "$G")" = "awaiting_confirmation"
test "$(jv 'v.groups[0].action.kind'      < "$G")" = "approve"
test "$(jv 'v.groups[0].action.target.type' < "$G")" = "objective"
test "$(jv 'v.groups[0].action.target.id' < "$G")" = "$OBJ_B"
test "$(jv 'v.groups[0].repositories.length' < "$G")" = "1"
test "$(jv 'v.groups[0].repositories[0]'  < "$G")" = "$REPO_B"
test "$(jv 'v.nodes.every(n=>n.status==="completed")' < "$G")" = "true"
# A completed task under an awaiting objective points at the OBJECTIVE — the
# human gate moved there (run-next-task.ts:365-402). It is NOT null.
test "$(nd "$ROOT_B" < "$G" | nf 'n.action.kind')"        = "approve"
test "$(nd "$ROOT_B" < "$G" | nf 'n.action.target.type')" = "objective"
test "$(nd "$ROOT_B" < "$G" | nf 'n.action.target.id')"   = "$OBJ_B"
# The candidate the node produced is real, not invented: it matches `get task`.
CAND=$(nd "$ROOT_B" < "$G" | nf 'n.candidate.candidateSHA')
test "$(printf '%s' "$CAND" | grep -cE '^[0-9a-f]{40}$')" = "1"
test "$(node src/main.ts get task --id "$ROOT_B" --json | jv 'v.result.proposalCommit')" = "$CAND"
test "$(nd "$ROOT_B" < "$G" | nf 'n.produced.summary!==null')" = "true"
echo "F ok: approve is scoped to the objective and reachable from its task nodes"

# ── Phase G — a paused initiative can never look runnable ─────────────────────
node src/main.ts pause initiative --id "$INIT_A" >/dev/null
graph "$INIT_A"
test "$(jv 'v.initiative.paused'             < "$G")" = "true"
test "$(jv 'v.initiative.action.kind'        < "$G")" = "resume-initiative"
test "$(jv 'v.initiative.action.target.id'   < "$G")" = "$INIT_A"
test "$(jv 'v.nodes.every(n=>n.executionState==="paused")' < "$G")" = "true"
# dependencyState keeps its own meaning — pausing does not rewrite readiness.
test "$(nd "$W" < "$G" | nf 'n.dependencyState')" = "blocked"
node src/main.ts resume initiative --id "$INIT_A" >/dev/null
graph "$INIT_A"
test "$(jv 'v.initiative.paused'  < "$G")" = "false"
test "$(jv 'v.nodes.every(n=>n.executionState==="runnable")' < "$G")" = "true"
echo "G ok: paused nodes are never runnable, and readiness is unchanged"

# ── Phase H — the digest is driven only by an explicit ack ────────────────────
O="$PD/o.json"
overview() { node src/main.ts get overview --project "$PROJECT" --json > "$O"; }
TOTAL=$(ev count); LATEST=$(ev max); EARLIEST=$(ev min)
overview
test "$(jv 'v.digest.since===null' < "$O")" = "true"
test "$(jv 'v.digest.totalCount'   < "$O")" = "$TOTAL"
test "$(jv 'v.digest.latest'       < "$O")" = "$LATEST"
test "$(jv 'v.initiatives.length'  < "$O")" = "2"
test "$(jv 'v.decisions.length>0'  < "$O")" = "true"
# Ranked by fan-out desc, then longest-waiting first — monotonic, not arbitrary.
test "$(jv 'v.decisions.every((d,i,a)=>i===0||a[i-1].downstream>=d.downstream)' < "$O")" = "true"
# Reading twice never acknowledges anything.
overview
test "$(jv 'v.digest.totalCount' < "$O")" = "$TOTAL"
node src/main.ts ack project --id "$PROJECT" --cursor "$LATEST" >/dev/null
overview
test "$(jv 'v.digest.totalCount' < "$O")" = "0"
test "$(jv 'v.digest.since'      < "$O")" = "$LATEST"
# Reading after an ack does not re-arm the digest.
overview
test "$(jv 'v.digest.totalCount' < "$O")" = "0"
# A backwards ack cannot resurrect acknowledged history.
node src/main.ts ack project --id "$PROJECT" --cursor "$EARLIEST" >/dev/null
overview
test "$(jv 'v.digest.totalCount' < "$O")" = "0"
test "$(jv 'v.digest.since'      < "$O")" = "$LATEST"
# A cursor beyond the latest event would blind the digest forever — refused.
expect_fail "$PD/future.txt" node src/main.ts ack project --id "$PROJECT" \
  --cursor 01ZZZZZZZZZZZZZZZZZZZZZZZZ
overview
test "$(jv 'v.digest.since' < "$O")" = "$LATEST"
echo "H ok: only ack project moves the cursor, and it cannot run away from the feed"

# ── Phase I — neither read writes a single byte ───────────────────────────────
fingerprint > "$PD/fp-before.txt"
for _ in 1 2 3 4 5; do
  node src/main.ts get graph --initiative "$INIT_A" --json >/dev/null
  node src/main.ts get graph --initiative "$INIT_B" --json >/dev/null
  node src/main.ts get overview --project "$PROJECT" --json >/dev/null
done
fingerprint > "$PD/fp-after.txt"
diff -u "$PD/fp-before.txt" "$PD/fp-after.txt" \
  || { echo "FAILED: a read mutated the database" >&2; exit 1; }
test -s "$PD/fp-before.txt"
echo "I ok: ten graph reads and five overview reads changed nothing"

echo "016 ok: one-call initiative graph, scoped actions, honest blocking, explicit ack, zero writes"
