#!/usr/bin/env bash
# sha-classification-proof.sh — EPIC 007.18 Proof. Hermetic, no model, no
# network: the graph runs on the FakeRunner (agent: fake@1), so no repository,
# ai_provider or credential resource is needed and no --bind flag is passed.
#
# Usage: scripts/e2e/sha-classification-proof.sh
#
# Proves all five claims against the real program, on an initiative where work
# has already reached a terminal state:
#   1. a completed task with an untouched file is `unchanged`, not `drifted`
#      — the fix; before 007.18 this blocked every --apply forever
#   2. a NEW task lands on an initiative that has already run work
#   3. editing a PENDING task's file still applies (`updated`) — regression
#      guard; this passed before 007.18 too and must keep passing
#   4. editing a COMPLETED task's file is refused as `locked`, not applied
#      — before 007.18 the `locked` check was unreachable, shadowed by `drifted`
#   5. a real out-of-band content change is still caught as `drifted`
#
# Shape: ran-task (completes), blocker-task (failed via --fail), idle-task
# (depends on blocker-task, so it stays `pending` — only a `completed`
# dependency satisfies an edge). Two independent tasks would BOTH complete
# under --until-idle, leaving nothing `pending` for steps 3 and 5.
#
# Note on the negative assertions: `grep -vq <pat> <file>` is VACUOUS — it
# inverts line selection, not exit status, so it succeeds whenever any single
# line fails to match. Every negative here is `! grep -q`. The `locked` check is
# anchored to the node (`locked: $RAN`) because a bare match on `locked` would
# also hit the summary line and pass if the wrong node were locked.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

D="$PWD/.data/proof-00718"
export KANTHORD_DB="$D/kanthord.db"
rm -rf "$D"; mkdir -p "$D"
G="$D/graph"

node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name proof-00718 | head -1)

"$HERE/make-sha-graph.sh" "$G"
node src/main.ts import graph "$G" --create --project "$PROJECT" >/dev/null

read_manifest() {
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));
           const p=process.argv[2].split(".");let v=m;for(const k of p)v=v[k];console.log(v)' "$G" "$1"
}
INIT=$(read_manifest 'initiativeId')
RAN=$(read_manifest 'refToId.tasks.ran-task')
IDLE=$(read_manifest 'refToId.tasks.idle-task')
BLOCKER=$(read_manifest 'refToId.tasks.blocker-task')

status_of() { node src/main.ts get task --id "$1" | sed -n 's/^status: //p'; }

node src/main.ts run daemon --until-idle --poll-interval 200 --fail "$BLOCKER" >/dev/null 2>&1 || true
test "$(status_of "$RAN")"  = "completed"
test "$(status_of "$IDLE")" = "pending"

# ---- 1) THE FIX: a completed task with an untouched file is `unchanged`
node src/main.ts import graph "$G" --apply --initiative "$INIT" --dry-run > "$D/p1.txt" 2>&1
grep -q "unchanged: $RAN" "$D/p1.txt"
! grep -q "drifted: $RAN" "$D/p1.txt"

# ---- 2) a NEW task lands on an initiative that has already run work
"$HERE/make-sha-graph.sh" "$G" --add-new-task
node src/main.ts import graph "$G" --apply --initiative "$INIT" >/dev/null
NEW=$(node src/main.ts list task --initiative "$INIT" --json | node -e '
  const r = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const t = r.find((x) => x.title === "Added after work already ran");
  if (!t) { console.error("insert did not land"); process.exit(1); }
  console.log(t.id);
')
test -n "$NEW"
test "$(status_of "$NEW")" = "pending"

# ---- 3) editing a PENDING task's file still applies (`updated`)
sed -i '' 's/^title: .*/title: Idle task retitled/' "$G/task-idle.md"
node src/main.ts import graph "$G" --apply --initiative "$INIT" >/dev/null
node src/main.ts get task --id "$IDLE" | grep -q '^title: Idle task retitled'

# ---- 4) editing a COMPLETED task's file is refused as `locked`
# This apply is EXPECTED to exit non-zero (`refused: 1 locked node(s)`). Piping it
# into `grep -q` under `pipefail` is a race — `grep -q` closes the pipe on its
# first match, so the pipeline's status is sometimes node's 1 and sometimes a
# SIGPIPE code, which aborted this gate in ~40% of runs. Capture the output ONCE
# (case 1's idiom), then assert the status and the message separately.
cp "$G/task-ran.md" "$D/task-ran.bak"
sed -i '' 's/^title: .*/title: Ran task retitled/' "$G/task-ran.md"
APPLY4_STATUS=0
node src/main.ts import graph "$G" --apply --initiative "$INIT" > "$D/p4.txt" 2>&1 \
  || APPLY4_STATUS=$?
test "$APPLY4_STATUS" -ne 0
grep -q "locked: $RAN" "$D/p4.txt"
! node src/main.ts get task --id "$RAN" | grep -q 'Ran task retitled'
cp "$D/task-ran.bak" "$G/task-ran.md"

# ---- 5) a real out-of-band content change is still caught as `drifted`
# Captured to a file for the same reason as case 4: `--dry-run` exits 0 today, so
# the pipeline form is safe by accident only, and a future exit-code change would
# silently make this gate flaky instead of failing loudly.
node src/main.ts add dependency --task "$IDLE" --dependency "$RAN" >/dev/null
node src/main.ts import graph "$G" --apply --initiative "$INIT" --dry-run \
  > "$D/p5.txt" 2>&1
grep -q "drifted: $IDLE" "$D/p5.txt"

echo "007.18 PROOF OK"
