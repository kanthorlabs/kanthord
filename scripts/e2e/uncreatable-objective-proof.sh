#!/usr/bin/env bash
# uncreatable-objective-proof.sh — EPIC 007.19 Proof. Hermetic, no model, no
# network: the graph runs on `fake@1`, so no repository, ai_provider or credential
# resource is needed and no --bind flag is passed. The daemon never runs — this
# epic is about PREFLIGHT classification, not execution.
#
# Usage: scripts/e2e/uncreatable-objective-proof.sh
#
# Proves that an apply referencing an objective it cannot create is refused
# clearly, instead of being silently dropped and then misreported as a task error:
#   1. `--dry-run` REPORTS the problem and exits non-zero. Before 007.19 it
#      exits 0 and says nothing at all — the silent-failure case.
#   2. `--apply` REFUSES and writes nothing (the orphan task never lands; the
#      baseline task's title is untouched).
#   3. the refusal is a MAPPED one-liner naming the objective ref — never a raw
#      InvalidObjectiveIdError, a SQLite FOREIGN KEY error, or stack frames.
#      007.18's repository guard already names the right value, but it throws
#      mid-transaction and escapes runApply's error boundary as 12 stack frames.
#   4. a package whose objectives all resolve STILL APPLIES — regression guard, so
#      the new gate cannot degrade into a blanket refusal.
#
# Note on the assertions: `grep -vq <pat> <file>` is VACUOUS (it inverts line
# selection, not exit status), so every negative here is `! grep -q`. And every
# command whose exit code matters is captured to a FILE rather than piped into
# `grep -q`: piping a deliberately-failing command into `grep -q` under `pipefail`
# is a race (grep closes the pipe, so the status is sometimes the command's and
# sometimes a SIGPIPE code) that made EPIC 007.18's Proof flaky in ~40% of runs.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

D="$PWD/.data/proof-00719"
export KANTHORD_DB="$D/kanthord.db"
rm -rf "$D"; mkdir -p "$D"
G="$D/graph"

node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name proof-00719 | head -1)

"$HERE/make-orphan-objective-graph.sh" "$G"
node src/main.ts import graph "$G" --create --project "$PROJECT" >/dev/null

read_manifest() {
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));
           const p=process.argv[2].split(".");let v=m;for(const k of p)v=v[k];console.log(v)' "$G" "$1"
}
INIT=$(read_manifest 'initiativeId')
BASE=$(read_manifest 'refToId.tasks.base-task')

# The orphan objective + the task that references it. Additive: the baseline files
# and the live manifest are untouched.
"$HERE/make-orphan-objective-graph.sh" "$G" --add-orphan

# ---- 1) --dry-run REPORTS the problem and exits non-zero
DRY_STATUS=0
node src/main.ts import graph "$G" --apply --initiative "$INIT" --dry-run \
  > "$D/p1.txt" 2>&1 || DRY_STATUS=$?
test "$DRY_STATUS" -ne 0
grep -q 'orphan-obj' "$D/p1.txt"

# ---- 2) --apply REFUSES and writes nothing
APPLY_STATUS=0
node src/main.ts import graph "$G" --apply --initiative "$INIT" \
  > "$D/p2.txt" 2>&1 || APPLY_STATUS=$?
test "$APPLY_STATUS" -ne 0
node src/main.ts list task --initiative "$INIT" --json > "$D/tasks.json"
! grep -q 'Task parented to a brand-new objective' "$D/tasks.json"
node src/main.ts get task --id "$BASE" > "$D/base.txt"
grep -q '^title: Base task' "$D/base.txt"

# ---- 3) the refusal is a MAPPED one-liner, not a stack trace
grep -q 'orphan-obj' "$D/p2.txt"
! grep -q 'InvalidObjectiveIdError' "$D/p2.txt"
! grep -q 'FOREIGN KEY constraint failed' "$D/p2.txt"
! grep -q 'at ApplyGraph.execute' "$D/p2.txt"

# ---- 4) a fully resolvable package STILL APPLIES (regression guard)
rm -f "$G/objective-orphan.md" "$G/task-orphan.md"
sed -i '' 's/^title: .*/title: Base task retitled/' "$G/task-base.md"
node src/main.ts import graph "$G" --apply --initiative "$INIT" > "$D/p4.txt" 2>&1
node src/main.ts get task --id "$BASE" > "$D/base2.txt"
grep -q '^title: Base task retitled' "$D/base2.txt"

echo "007.19 PROOF OK"
