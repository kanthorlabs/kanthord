#!/usr/bin/env bash
# decision-workbench-proof.sh — EPIC 017 Proof (deterministic, no model, no
# network beyond local file:// remotes, no daemon left running).
#
# Proves that guidance handed back on a FAILED task is actually persisted (the
# D1 defect), that carry-forward is off by default, that `queue` ranks decisions
# across MORE THAN ONE project with structured verdicts, that a destructive
# verdict names its damage and binds the confirmation to that exact preview, that
# an objective conflict is a distinct contract from a task conflict with a
# PERSISTED cause and no file list, and that no read writes a single byte.
#
# Run from the repo root. Against the CURRENT tree phase A fails: `retry task
# --note` drops the note when the task is `failed`
# (src/app/task/retry-task.ts:133-140 saves the task with no note, while only the
# awaiting_confirmation branch at :102 persists it). Phases A and B use ONLY
# wiring that already exists, so the first failure is a real behavioural defect
# rather than a missing command. Every later phase needs a command this epic
# introduces and is unreachable until then.
#
# NOTE ON HOW THE ROOT IS MADE TO FAIL. `run daemon --fail <id>` is honoured only
# by FakeRunner, which serves `fake@1` (src/composition.ts:426,441-443). The todo
# fixture's tasks are `generic@1`, so they route to PiAgentRunner and `--fail` is
# silently IGNORED — the task completes and the phase would assert against the
# wrong state. This proof instead swaps KANTHORD_FAKE_AGENT for a no-op script:
# the agent writes nothing, so the root's own verification (`test -f
# src/todo.mjs`, scripts/e2e/make-todo-graph.sh:69-71) exits 1 and the task
# reaches `failed` through the real failure path.
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
eq() { # eq <what> <expected> <actual>
  [ "$2" = "$3" ] || { echo "FAILED: $1 — expected '$2', got '$3'" >&2; exit 1; }; }

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
fingerprint() { node "$PD/fingerprint.mjs"; }

# Read a task's status straight from SQLite, so the fixture's health is never
# inferred from the same command under test.
cat > "$PD/taskstatus.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.KANTHORD_DB, { readOnly: true });
const r = db.prepare("SELECT status FROM tasks WHERE id = ?").get(process.argv[2]);
process.stdout.write(r === undefined ? "MISSING" : String(r.status));
EOF
tstatus() { node "$PD/taskstatus.mjs" "$1"; }

exportval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));console.log(eval(process.argv[2]))' "$1" "$2"; }

node src/main.ts db migrate >/dev/null

# ── Shared setup — two projects (the cross-project claim needs two), one bare
#    remote each, one provider ────────────────────────────────────────────────
mkrepo() { # mkrepo <project> <name> → echoes the repository id
  local project="$1" name="$2" remote="$PD/$2.git" seed="$PD/$2-seed" mirror="$PD/$2-mirror"
  git init -q --bare -b main "$remote"
  git clone -q "$remote" "$seed"
  git -C "$seed" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" push -q origin main
  node src/main.ts create repository --project "$project" --name "$name" \
    --remote-url "file://$remote" --branch main --auth ambient --path "$mirror"
}

PROJECT_A=$(node src/main.ts create project --name alpha)
PROJECT_B=$(node src/main.ts create project --name beta)
REPO_A=$(mkrepo "$PROJECT_A" repoa)
REPO_B=$(mkrepo "$PROJECT_B" repob)

# generic@1 needs repository context only; the daemon auto-resolves the provider
# chain (008.3), which must be non-empty or every task fails. KANTHORD_FAKE_AGENT
# replaces the session factory, so this token value is never read.
DUMMY="$PD/token"; printf 'dummy' > "$DUMMY"
PROV=$(node src/main.ts register ai-provider --name e2e --provider openai-codex \
  --model gpt-5.6-sol --value-file "$DUMMY" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
node src/main.ts assign ai-provider --project "$PROJECT_A" --provider "$PROV" >/dev/null
node src/main.ts assign ai-provider --project "$PROJECT_B" --provider "$PROV" >/dev/null

# `import --create` rewrites a package's source files in place with minted ULIDs,
# so each initiative needs its OWN copy of the fixture.
GRAPH_A="$PD/graph-a"; scripts/e2e/make-landing-graph.sh "$GRAPH_A" >/dev/null
node src/main.ts import graph "$GRAPH_A" --create --project "$PROJECT_A" \
  --bind source="$REPO_A" >/dev/null
INIT_A=$(exportval "$GRAPH_A" 'j.initiativeId')
OBJ_A=$(exportval "$GRAPH_A" 'j.refToId.objectives["todo-api-obj"]')
ROOT_A=$(exportval "$GRAPH_A" 'j.refToId.tasks["create-task"]')
# The four dependents of the root, per make-todo-graph.sh.
DEPS_A=()
for r in list-tasks get-task update-task delete-task; do
  DEPS_A+=("$(exportval "$GRAPH_A" "j.refToId.tasks[\"$r\"]")")
done

# A no-op agent script: it writes no file, so the root task's verification
# (`test -f src/todo.mjs`) exits 1 and the task fails for a real reason.
printf '[{"text":"did nothing"}]' > "$PD/noop-agent.json"

# fail_root — drive the root to `failed` through the real verification path.
# The dependents stay `pending` (their dependency never completes), so the
# root's downstream fan-out of 4 is preserved for phases D and E.
fail_root() {
  KANTHORD_FAKE_AGENT="$PD/noop-agent.json" \
    node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
  eq "fixture: root reached failed" "failed" "$(tstatus "$ROOT_A")"
}

# ── Phase A — the D1 proof. Guidance on a FAILED task must persist. ───────────
# THIS IS THE SINGLE FAILURE POINT AGAINST THE CURRENT TREE.
# The fixture assertion inside fail_root runs FIRST, so a broken fixture can
# never be mistaken for the defect under test.
fail_root

node src/main.ts retry task --id "$ROOT_A" --note "use the anchor" >/dev/null
NOTE_A=$(node src/main.ts get task --id "$ROOT_A" --json | jv 'v.note ?? "<ABSENT>"')
eq "A: note persisted on a failed-task retry" "use the anchor" "$NOTE_A"

echo "017 A ok: guidance on a failed task is persisted"

# ── Phase B — carry-forward is OFF by default (binding decision 3) ────────────
# Fail the root again so it is retryable, then retry with NO --note.
fail_root

node src/main.ts retry task --id "$ROOT_A" >/dev/null
# `get task --json` OMITS the key when unset (src/app/task/get-task.ts:97), so the
# expected value is the absent sentinel, never the string "null".
NOTE_B=$(node src/main.ts get task --id "$ROOT_A" --json | jv 'v.note ?? "<ABSENT>"')
eq "B: absent --note clears the previous note" "<ABSENT>" "$NOTE_B"

# --carry-note is the opt-in that preserves it.
fail_root
node src/main.ts retry task --id "$ROOT_A" --note "keep me" >/dev/null
fail_root
node src/main.ts retry task --id "$ROOT_A" --carry-note >/dev/null
NOTE_C=$(node src/main.ts get task --id "$ROOT_A" --json | jv 'v.note ?? "<ABSENT>"')
eq "B: --carry-note preserves the previous note" "keep me" "$NOTE_C"

echo "017 B ok: carry-forward is off by default and --carry-note opts in"

# ── Phase C — `queue` on a project with no decisions ─────────────────────────
# Asserted on parsed JSON, so a MISSING `queue` command fails here rather than
# false-greening on empty output.
fail_root
Q_JSON="$PD/q0.json"
node src/main.ts queue --json > "$Q_JSON"
eq "C: queue reports the failure" "1" "$(jv 'v.items.filter(i=>i.taskId==="'"$ROOT_A"'").length' < "$Q_JSON")"

echo "017 C ok: queue is a parseable contract"

# ── Phase D — queue item shape for an operational failure ────────────────────
eq "D: kindLabel"        "operational-failure" "$(jv 'v.items.find(i=>i.taskId==="'"$ROOT_A"'").kindLabel' < "$Q_JSON")"
eq "D: verdict kinds"    "reject,retry"        "$(jv 'v.items.find(i=>i.taskId==="'"$ROOT_A"'").verdicts.map(a=>a.kind).sort().join(",")' < "$Q_JSON")"
eq "D: downstream"       "4"                   "$(jv 'v.items.find(i=>i.taskId==="'"$ROOT_A"'").downstream' < "$Q_JSON")"
eq "D: diffAvailable"    "false"               "$(jv 'v.items.find(i=>i.taskId==="'"$ROOT_A"'").evidence.diffAvailable' < "$Q_JSON")"
eq "D: evidence basis"   "verification-and-summary" "$(jv 'v.items.find(i=>i.taskId==="'"$ROOT_A"'").evidence.basis' < "$Q_JSON")"
eq "D: projectId"        "$PROJECT_A"          "$(jv 'v.items.find(i=>i.taskId==="'"$ROOT_A"'").projectId' < "$Q_JSON")"

echo "017 D ok: an operational failure carries structured verdicts and honest evidence"

# ── Phase E — impact preview and the confirm protocol ────────────────────────
FP_BEFORE=$(fingerprint)
DRY="$PD/dry.json"
node src/main.ts reject task --id "$ROOT_A" --resolution discard --dry-run --json > "$DRY"
# 4 dependent tasks + the objective + the initiative all roll up to
# discarded-by-cascade, since the target task itself counts as discarded
# for the rollup (017 blocker B1: the target must seed the post-cascade
# discarded set, matching what RejectTask's real mutation already does).
eq "E: cascade count"  "6" "$(jv 'v.damage.filter(d=>d.effect==="discarded-by-cascade").length' < "$DRY")"
eq "E: counts agree"   "6" "$(jv 'v.counts["discarded-by-cascade"]' < "$DRY")"
# Every dependent is named, not just counted.
for d in "${DEPS_A[@]}"; do
  eq "E: dependent $d named" "1" "$(jv 'v.damage.filter(x=>x.target.id==="'"$d"'").length' < "$DRY")"
done
eq "E: objective rollup named" "1" "$(jv 'v.damage.filter(x=>x.target.id==="'"$OBJ_A"'" && x.effect==="discarded-by-cascade").length' < "$DRY")"
eq "E: initiative rollup named" "1" "$(jv 'v.damage.filter(x=>x.target.id==="'"$INIT_A"'" && x.effect==="discarded-by-cascade").length' < "$DRY")"
FP_AFTER=$(fingerprint)
eq "E: --dry-run wrote nothing" "$FP_BEFORE" "$FP_AFTER"

DIGEST=$(jv 'v.digest' < "$DRY")

# A stale digest must be refused, inside the transaction, with no mutation.
expect_fail "$PD/stale.txt" node src/main.ts reject task --id "$ROOT_A" \
  --resolution discard --yes --expect-impact "0000000000000000000000000000000000000000000000000000000000000000"
eq "E: refused stale digest wrote nothing" "$FP_BEFORE" "$(fingerprint)"

# --dry-run and --yes are mutually exclusive.
expect_fail "$PD/both.txt" node src/main.ts reject task --id "$ROOT_A" \
  --resolution discard --dry-run --yes --expect-impact "$DIGEST"

# The real verdict: damage is printed even under --yes.
OUT_E="$PD/reject.txt"
node src/main.ts reject task --id "$ROOT_A" --resolution discard --yes \
  --expect-impact "$DIGEST" > "$OUT_E"
grep -q "discarded-by-cascade" "$OUT_E" \
  || { echo "FAILED: E — --yes suppressed the damage output" >&2; exit 1; }
eq "E: root discarded" "discarded" "$(tstatus "$ROOT_A")"
for d in "${DEPS_A[@]}"; do
  eq "E: dependent $d discarded" "discarded" "$(tstatus "$d")"
done

echo "017 E ok: a destructive verdict names its damage and binds the confirmation"

# ── Phase F — objective conflict: a distinct contract with a PERSISTED cause ──
# Reached the only way a sequential CLI can: two objectives in one initiative,
# integrate the second so the branch tip moves, then approve the first.
# `getObjectiveParentOid` (src/composition.ts:862-882) chains an objective's
# squash anchor onto its immediately-preceding SIBLING's own `commitOid` —
# UNLESS that predecessor has not yet squashed (`commitOid` still undefined),
# in which case it falls back to the live initiative-branch ref. So BOTH
# objectives anchor to the SAME original ref tip when their task sets settle
# concurrently, before either is approved: the first objective to be created
# still has no predecessor (index 0, always ref-anchored); the second only
# skips chaining if it settles WHILE the first is still incomplete. That needs
# both objectives' tasks pending in ONE daemon pass, not two sequential ones —
# the tip-mover task is created before the first `run daemon`, and the queue is
# FIFO by job id (src/queue/sqlite.ts:40), so the tip-mover job (enqueued right
# after import, before the root's 4 dependents are unblocked) is claimed and
# settles before those dependents — leaving the first objective's own
# `commitOid` still undefined at that moment. Approving the SECOND objective
# first then CAS-advances the ref out from under the first's stale anchor:
# `commitCount` is still exactly 1 (each objective's own pair is
# invariant-distance-1 by construction, src/workspace/local.ts:857-882), so
# `countCommitsSince` never fires — the ref mismatch instead fails
# `casUpdateRef` → `LandingCASMismatchError` → "cas-mismatch"
# (src/app/objective/approve-objective.ts:96-104). The "non-single-commit"
# cause needs the stored parentOid itself to diverge from the squash target, a
# corruption/race no sequential CLI invocation can stage (see the EPIC's
# "Not provable at program level" note) — it is covered hermetically only.
GRAPH_B="$PD/graph-b"; scripts/e2e/make-landing-graph.sh "$GRAPH_B" >/dev/null
node src/main.ts import graph "$GRAPH_B" --create --project "$PROJECT_B" \
  --bind source="$REPO_B" >/dev/null
INIT_B=$(exportval "$GRAPH_B" 'j.initiativeId')
OBJ_B=$(exportval "$GRAPH_B" 'j.refToId.objectives["todo-api-obj"]')
ROOT_B=$(exportval "$GRAPH_B" 'j.refToId.tasks["create-task"]')

# The tip-mover objective + task are created BEFORE the daemon ever runs, so
# its job is enqueued ahead of the root's not-yet-unblocked dependents and the
# race above is real, not scripted around. It needs its OWN scripted turn: a
# flat (unkeyed) FakeTurn[] is replayed identically to every task title, which
# would rewrite `src/todo.mjs` with content already squashed elsewhere and
# produce a no-net-diff squash. `fakeSessionFactoryFromTurns` (src/agent-runner/
# fake-session.ts:96-104) instead selects turns BY TASK TITLE when given an
# object map (`FakeTurnMap`) — keyed here so the fixture's own tasks keep their
# `"*"` default turn (writes `src/todo.mjs`) and only "move the tip" gets a
# distinct file.
OBJ_B2=$(node src/main.ts create objective --initiative "$INIT_B" --name "tip mover")
T_B2=$(node src/main.ts create task --objective "$OBJ_B2" --title "move the tip" \
  --agent generic@1 --instructions "touch a file" --ac "the tip moves" \
  --verification "true" --context repository="$REPO_B")

jq -n --slurpfile fixture "$GRAPH_B/.fake-agent.json" \
  '{"*": $fixture[0], "move the tip": [
     {"toolCalls":[{"name":"bash","arguments":{"command":"mkdir -p src && printf \"tip mover\\n\" > src/tip-mover.txt"}}]},
     {"text":"moved the tip"}
   ]}' > "$PD/combined-agent.json"

export KANTHORD_FAKE_AGENT="$PD/combined-agent.json"
node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null

OID_B2=$(node src/main.ts get objective --id "$OBJ_B2" --json | jv 'v.commitOid')
node src/main.ts approve objective --id "$OBJ_B2" --expected-commit "$OID_B2" >/dev/null

# Now the FIRST objective's anchor is stale → conflict, not integration.
OID_B=$(node src/main.ts get objective --id "$OBJ_B" --json | jv 'v.commitOid')
node src/main.ts approve objective --id "$OBJ_B" --expected-commit "$OID_B" >/dev/null || true
eq "F: objective recorded a conflict" "conflict" \
  "$(node src/main.ts get objective --id "$OBJ_B" --json | jv 'v.status')"

C_JSON="$PD/conflict.json"
node src/main.ts get conflict --objective "$OBJ_B" --json > "$C_JSON"
eq "F: cause is persisted, not inferred" "cas-mismatch"      "$(jv 'v.conflictCause' < "$C_JSON")"
eq "F: tip moved since the anchor"       "true"              "$(jv 'v.tipMovedSinceAnchor' < "$C_JSON")"
eq "F: parentOid present"                "true"              "$(jv 'typeof v.parentOid === "string" && v.parentOid.length > 0' < "$C_JSON")"
eq "F: commitOid present"                "true"              "$(jv 'typeof v.commitOid === "string" && v.commitOid.length > 0' < "$C_JSON")"
eq "F: observedTipOid present"           "true"              "$(jv 'typeof v.observedTipOid === "string" && v.observedTipOid.length > 0' < "$C_JSON")"
# An objective conflict is NOT a file-level merge conflict: there is no file list.
eq "F: no files key"                     "false"             "$(jv '"files" in v' < "$C_JSON")"
# The inspect handle is structured, and it must actually run — a proof that
# prints an unrunnable command proves nothing.
eq "F: inspect executable"               "git"               "$(jv 'v.evidence.inspect.executable' < "$C_JSON")"
node -e 'const{execFileSync}=require("node:child_process");const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));execFileSync(v.evidence.inspect.executable,v.evidence.inspect.args,{stdio:"ignore"})' "$C_JSON" \
  || { echo "FAILED: F — inspect.args did not run" >&2; exit 1; }

echo "017 F ok: an objective conflict carries a persisted cause, no file list, a runnable inspect"

# ── Phase G — the task conflict path is DISTINCT, not repurposed ─────────────
expect_fail "$PD/taskconf.txt" node src/main.ts get conflict --id "$ROOT_B"
grep -q "no conflict candidate" "$PD/taskconf.txt" \
  || { echo "FAILED: G — wrong error for a task with no landing conflict" >&2; exit 1; }
expect_fail "$PD/neither.txt" node src/main.ts get conflict
expect_fail "$PD/bothopt.txt" node src/main.ts get conflict --id "$ROOT_B" --objective "$OBJ_B"

echo "017 G ok: task and objective conflict paths are distinct"

# ── Phase H — objective guidance lands on the OBJECTIVE ──────────────────────
# A successful retry moves the objective to awaiting_confirmation, which
# `get conflict --objective` refuses by contract — so the note is read from
# `get objective`, and the conflict is recreated before any later assertion.
node src/main.ts retry objective --id "$OBJ_B" --expected-commit "$OID_B" \
  --note "resolve at the new tip" >/dev/null
eq "H: note stored on the objective" "resolve at the new tip" \
  "$(node src/main.ts get objective --id "$OBJ_B" --json | jv 'v.note ?? "<ABSENT>"')"
# Every task stayed completed — the case where fanning the note to tasks reaches
# nobody (src/app/objective/retry-objective.ts:167-174).
eq "H: task still completed" "completed" "$(tstatus "$ROOT_B")"

echo "017 H ok: objective guidance persists independent of task status"

# ── Phase I — cross-project ranking (needs BOTH projects) ───────────────────
# Project A's own fixture tasks (ROOT_A + its 4 dependents) were all fully
# `discarded` back in phase E, so project A now has NO decision item of its
# own — a fresh task is created and driven to a real failure (`--verification
# false` always fails, no scripted agent needed) so project A is genuinely
# present in the queue again, not just assumed to still be there.
T_A2=$(node src/main.ts create task --objective "$OBJ_A" --title "second failure" \
  --agent generic@1 --instructions "no-op" --ac "always fails" \
  --verification "false" --context repository="$REPO_A")
unset KANTHORD_FAKE_AGENT
KANTHORD_FAKE_AGENT="$PD/noop-agent.json" \
  node src/main.ts run daemon --until-idle --poll-interval 200 >/dev/null 2>&1 || true
eq "I: fixture — second project-A failure reached failed" "failed" "$(tstatus "$T_A2")"

Q2="$PD/q2.json"
node src/main.ts queue --json > "$Q2"
eq "I: project A present" "true" "$(jv 'v.items.some(i=>i.projectId==="'"$PROJECT_A"'")' < "$Q2")"
eq "I: project B present" "true" "$(jv 'v.items.some(i=>i.projectId==="'"$PROJECT_B"'")' < "$Q2")"
# Ranking: downstream desc, then actionableSince asc, then lowest id. kindLabel
# never participates.
eq "I: ranked by impact then age" "true" "$(jv '
  v.items.every((it,i,a)=> i===0 || (
    a[i-1].downstream > it.downstream ||
    (a[i-1].downstream === it.downstream && (
       (a[i-1].actionableSince ?? Infinity) < (it.actionableSince ?? Infinity) ||
       ((a[i-1].actionableSince ?? Infinity) === (it.actionableSince ?? Infinity) &&
        a[i-1].initiativeId <= it.initiativeId)))))' < "$Q2")"
eq "I: byKind sums to total" "true" \
  "$(jv 'Object.values(v.counts.byKind).reduce((a,b)=>a+b,0) === v.counts.total' < "$Q2")"

echo "017 I ok: the queue ranks decisions across projects by impact"

# ── Phase J — no-write fingerprint over every read ──────────────────────────
FP0=$(fingerprint)
for _ in 1 2 3 4 5; do
  node src/main.ts queue --json >/dev/null
  node src/main.ts get conflict --objective "$OBJ_B" --json >/dev/null 2>&1 || true
  node src/main.ts reject task --id "${DEPS_A[0]}" --resolution discard --dry-run --json >/dev/null 2>&1 || true
  node src/main.ts reject objective --id "$OBJ_B" --dry-run \
    --expected-commit "$OID_B" --json >/dev/null 2>&1 || true
done
eq "J: reads and previews wrote nothing" "$FP0" "$(fingerprint)"

echo "017 ok: guidance persists, damage is named and bound, the conflict contract is distinct, the queue ranks by impact across projects, and every read writes nothing"
