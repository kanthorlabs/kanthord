#!/usr/bin/env bash
# sequencing-proof.sh — EPIC 007.17 Proof (deterministic, no model, no network).
#
# Proves follow-up sequencing at BOTH levels through the REAL CLI against real git
# in temp dirs, using the KANTHORD_FAKE_AGENT executor seam:
#   1.  an edge can be added to initiatives that ALREADY EXIST (the 2.1-before-3 case)
#   2.  the dependent is visibly blocked with NO new status invented
#   3.  a cycle is refused                       (checked while nothing has started)
#   4.  the daemon does NOT enqueue the dependent's task while the prereq is building
#   5.  landing the prereq makes the dependent runnable
#   6.  a retroactive edge is refused and names what already ran
#   7.  objective-level `after:` is read from the GRAPH PACKAGE, not just the CLI
#   8.  reordering `after:` in the file is a NO-OP, not drift (canonicalisation)
#   9.  a file that DROPS an edge never removes it implicitly — refused, edge survives
#   10. with --confirm-delete the edge removal IS applied (before any task runs)
#   11. an objective's task stays pending until ALL its prerequisites are integrated
#
# Usage: scripts/e2e/sequencing-proof.sh
#
# Why a script and not an inline block (AGENTS.md "Deterministic verification
# script"): the no-model path needs KANTHORD_FAKE_AGENT exported, and the bare
# origin must be seeded before `create repository` — setup an inline block
# cannot carry.
#
# Ordering note: steps 3 and 6 run the SAME command at DIFFERENT times on purpose.
# The refusal checks are ordered idempotence → already-started → cycle, so before
# the daemon runs (nothing started) the cycle check is what fires, and after the
# daemon + approve (a task has completed) the started check fires first. One
# command, two distinct refusals, no extra packages.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing claim is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate >/dev/null
PROJECT=$(node src/main.ts create project --name sequencing-proof | head -1)

# Bare origin seeded with one commit on the configured branch, plus the canonical
# local mirror the repository keeps at --path.
ORIGIN="$(mktemp -d)/origin.git"; git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)/seed"; git clone -q "$ORIGIN" "$SEED" 2>/dev/null
git -C "$SEED" -c user.email=a@b.c -c user.name=t commit -q --allow-empty -m init
git -C "$SEED" push -q origin main
MIRROR="$(mktemp -d)/mirror"

REPO=$(node src/main.ts create repository --project "$PROJECT" --name r \
        --remote-url "file://$ORIGIN" --branch main --auth ambient \
        --path "$MIRROR" | head -1)

# generic@1 now requires repository context only — the daemon auto-resolves the
# provider chain from the project's registered providers (008.3). No context
# binding is needed, but the chain must be non-empty or every task fails with
# "no AI provider available for project". Story D binds this setup to
# `register` + `assign`: registration alone would also work (the global default
# is the chain tail), but `assign` is the documented project operator flow and
# is what 008.3 actually resolves. KANTHORD_FAKE_AGENT replaces the session
# factory, so this value is never read.
DUMMY_VALUE="$(mktemp -d)/token"; printf 'dummy' > "$DUMMY_VALUE"
PROV_E2E=$(node src/main.ts register ai-provider --name e2e --provider openai-codex \
        --model gpt-5.6-sol --value-file "$DUMMY_VALUE" | grep -oE '01[0-9A-HJKMNP-TV-Z]{24}')
node src/main.ts assign ai-provider --project "$PROJECT" --provider "$PROV_E2E" >/dev/null

GRAPH="$(mktemp -d)/graph"
scripts/e2e/make-sequencing-graph.sh "$GRAPH"

# Derive an apply-mode variant of an ALREADY-IMPORTED package. `--apply` needs the
# ULIDs and the `.kanthord-export.json` baseline that `--create` writes back into
# the package, so the copy must happen after the import — a variant authored
# up-front has no baseline and cannot be applied.
#   $1 = source package dir (already imported)
#   $2 = variant dir to create
#   $3 = "reverse" (swap obj-2's two `after:` ids) | "drop-one" (keep only the first)
derive_variant() {
  rm -rf "$2"; mkdir -p "$2"
  cp -R "$1/." "$2/"
  node -e '
    const fs = require("fs");
    const [file, mode] = [process.argv[1], process.argv[2]];
    const src = fs.readFileSync(file, "utf8");
    const m = src.match(/^after: \[([^\]]+)\]$/m);
    if (m === null) { throw new Error("no after: line in " + file); }
    const ids = m[1].split(",").map((s) => s.trim());
    if (ids.length !== 2) { throw new Error("expected 2 after ids, got " + ids.length); }
    const next = mode === "reverse" ? [ids[1], ids[0]] : [ids[0]];
    fs.writeFileSync(file, src.replace(m[0], "after: [" + next.join(", ") + "]"));
  ' "$2/objective-2.md" "$3"

  # The variant must differ from its source in exactly one file — canonicalisation
  # and edge removal are about that file's `after:` line and nothing else.
  # `diff` exits 1 when files differ, which under `pipefail` would abort — capture
  # first, assert second.
  local d; d="$(diff -rq "$1" "$2" || true)"
  test "$(printf '%s\n' "$d" | grep -c 'objective-2.md' || true)" -eq 1
  test "$(printf '%s\n' "$d" | wc -l | tr -d ' ')" -eq 1
}

import_pkg() { # $1 = package dir
  node src/main.ts import graph "$1" --create --project "$PROJECT" \
    --bind source="$REPO" >/dev/null
}

read_manifest() { # $1 = package dir, $2 = dotted path into the manifest
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8"));
           const p=process.argv[2].split(".");let v=m;for(const k of p)v=v[k];console.log(v)' "$1" "$2"
}

status_of() { node src/main.ts get "$1" --id "$2" | sed -n 's/^status: //p'; }

ready_count() { # $1 = task id — number of task.ready events for that task
  # ZERO matches is a legitimate answer here (claim 4 asserts exactly that), but
  # `grep` exits 1 on no match and `pipefail` propagates it — which reads as a
  # failure to the ERR trap. Guard it so only real failures are reported.
  node src/main.ts list event --after 0 --limit 1000 --json 2>/dev/null \
    | { grep -o "\"type\":\"task.ready\",\"taskId\":\"$1\"" || true; } | wc -l | tr -d ' '
}

export KANTHORD_FAKE_AGENT="$GRAPH/init-a/.fake-agent.json"

# =========================== initiative level ===========================

import_pkg "$GRAPH/init-a"
import_pkg "$GRAPH/init-b"

A=$(read_manifest "$GRAPH/init-a" initiativeId)
B=$(read_manifest "$GRAPH/init-b" initiativeId)
AOBJ=$(read_manifest "$GRAPH/init-a" 'refToId.objectives.seq-obj-a')
ATASK=$(read_manifest "$GRAPH/init-a" 'refToId.tasks.seq-task-a')
BTASK=$(read_manifest "$GRAPH/init-b" 'refToId.tasks.seq-task-b')

# 1) sequence B after A on ALREADY-EXISTING initiatives.
node src/main.ts add initiative-dependency --initiative "$B" --after "$A"
node src/main.ts get initiative --id "$B" | grep -q "^after: $A"

# 2) B is visibly blocked, with no new status invented.
test "$(status_of initiative "$B")" = "building"
node src/main.ts get initiative --id "$B" | grep -q "^waiting on: $A"

# 3) a cycle is refused. Checked NOW, while no task has started, so the
#    already-started gate cannot mask it.
CYCLE_OUT="$(node src/main.ts add initiative-dependency --initiative "$A" --after "$B" 2>&1 || true)"
printf '%s' "$CYCLE_OUT" | grep -q 'Cycle detected'
! node src/main.ts add initiative-dependency --initiative "$A" --after "$B" >/dev/null 2>&1

# 4) the daemon must NOT enqueue B's task while A is still building.
node src/main.ts run daemon --until-idle --poll-interval 200 || true
test "$(status_of task "$BTASK")" = "pending"
test "$(ready_count "$BTASK")" -eq 0
test "$(ready_count "$ATASK")" -eq 1

# 5) land A, then B becomes runnable.
node src/main.ts approve objective --id "$AOBJ" >/dev/null
test "$(status_of objective "$AOBJ")" = "integrated"
test "$(status_of initiative "$A")" = "landed"
node src/main.ts run daemon --until-idle --poll-interval 200 || true
test "$(status_of task "$BTASK")" = "completed"

# 6) a retroactive edge is refused and names what already ran. Same command as
#    step 3, but A has now completed a task, so the started gate fires first.
RETRO_OUT="$(node src/main.ts add initiative-dependency --initiative "$A" --after "$B" 2>&1 || true)"
printf '%s' "$RETRO_OUT" | grep -q 'has already started'
printf '%s' "$RETRO_OUT" | grep -q 'ordering can no longer be guaranteed'
printf '%s' "$RETRO_OUT" | grep -q "$ATASK"
! node src/main.ts add initiative-dependency --initiative "$A" --after "$B" >/dev/null 2>&1

# =========================== objective level ===========================

import_pkg "$GRAPH/two-obj"

I2=$(read_manifest "$GRAPH/two-obj" initiativeId)
O1=$(read_manifest "$GRAPH/two-obj" 'refToId.objectives.obj-1')
O1B=$(read_manifest "$GRAPH/two-obj" 'refToId.objectives.obj-1b')
O2=$(read_manifest "$GRAPH/two-obj" 'refToId.objectives.obj-2')
T2=$(read_manifest "$GRAPH/two-obj" 'refToId.tasks.obj2-task')

# 7) `after:` was read from the graph package, not just the CLI. Two prerequisites,
#    rendered in sorted order — match without pinning which sorts first.
node src/main.ts get objective --id "$O2" | grep -q "^after: .*$O1"
node src/main.ts get objective --id "$O2" | grep -q "^after: .*$O1B"
node src/main.ts get objective --id "$O2" | grep -q "^waiting on: "

apply_variant() { # $1 = variant dir, extra args follow
  local dir="$1"; shift
  node src/main.ts import graph "$dir" --apply --initiative "$I2" \
    --bind source="$REPO" "$@" 2>&1
}

# 8) reordering `after:` in the file is a NO-OP, not drift (canonicalisation).
derive_variant "$GRAPH/two-obj" "$GRAPH/two-obj-reordered" reverse
REORDER_OUT="$(apply_variant "$GRAPH/two-obj-reordered" --dry-run)"
printf '%s' "$REORDER_OUT" | grep -q 'unchanged'
test "$(printf '%s' "$REORDER_OUT" | grep -c 'drifted' || true)" -eq 0

# 9) a file that DROPS an edge never deletes it implicitly. Absence is not an
#    instruction — same rule the node-deletion path already enforces. Without
#    --confirm-delete the apply is REFUSED, names the edge, and the edge SURVIVES.
derive_variant "$GRAPH/two-obj" "$GRAPH/two-obj-removed" drop-one
DROP_OUT="$(apply_variant "$GRAPH/two-obj-removed" || true)"
printf '%s' "$DROP_OUT" | grep -q "would remove edge: $O2 -> $O1B"
printf '%s' "$DROP_OUT" | grep -q 'edge removal(s) need --confirm-delete'
! apply_variant "$GRAPH/two-obj-removed" >/dev/null 2>&1
node src/main.ts get objective --id "$O2" | grep -q "^after: .*$O1B"

# 10) with --confirm-delete the edge removal IS applied, and reported.
#     This MUST run before the daemon executes any task. A task that has run
#     differs from its create-time manifest baseline and is therefore permanently
#     `drifted` (findings F1; root cause owned by EPIC 007.18), and a drifted node
#     refuses the WHOLE apply — so once tasks have completed this claim can never
#     pass. Capture with `|| true`: a non-zero exit must fail the grep below by
#     name, not abort the run through `pipefail` with no message.
CONFIRM_OUT="$(apply_variant "$GRAPH/two-obj-removed" --confirm-delete || true)"
printf '%s' "$CONFIRM_OUT" | grep -q "removed edge: $O2 -> $O1B"
node src/main.ts get objective --id "$O2" | grep -q "^after: $O1$"

# Restore the edge claim 10 just consumed: claim 11 needs TWO prerequisites to
# prove `after` is a SET (with one member, "all satisfied" is unprovable). Safe
# to add now — O2's task is still `pending`, so the retroactive refusal (claim 6)
# does not apply.
node src/main.ts add objective-dependency --objective "$O2" --after "$O1B" >/dev/null
node src/main.ts get objective --id "$O2" | grep -q "^after: .*$O1B"

# 11) O2's task stays pending until ALL of its prerequisites are integrated.
node src/main.ts run daemon --until-idle --poll-interval 200 || true
test "$(status_of task "$T2")" = "pending"
test "$(ready_count "$T2")" -eq 0

node src/main.ts approve objective --id "$O1" >/dev/null
node src/main.ts run daemon --until-idle --poll-interval 200 || true
# still blocked: obj-1b is not integrated yet, and `after` is a SET — every
# member must be satisfied.
test "$(status_of task "$T2")" = "pending"

node src/main.ts approve objective --id "$O1B" >/dev/null
node src/main.ts run daemon --until-idle --poll-interval 200 || true
test "$(status_of task "$T2")" = "completed"

echo "007.17 PROOF OK (sequencing)"
