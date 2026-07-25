# Story 5 — Proof scripts: graph generator + verification script

Epic: `.agent/plan/epics/007.18-content-vs-lifecycle-sha.md`
Depends on: Stories 1–4 (the script only passes once the behavior exists).

Two files, both mode **755** (all 11 existing `scripts/e2e/` scripts are 755 and
callers invoke them as `scripts/e2e/<name>.sh`, not via `bash`):

- `scripts/e2e/make-sha-graph.sh <out-dir> [--add-new-task]` — the graph package.
- `scripts/e2e/sha-classification-proof.sh` — the whole verification.

The second file exists because of the AGENTS.md rule _"Deterministic verification
script. In 'Verification Gate' section, must write bash script to setup validation
instead of using inline bash."_ The EPIC's Verification Gate must then shrink to
invoking it — that edit is the human's, not this story's (see the report's B5).

Three corrections to the epic's Story 6 text and Proof block, all forced by code:

- **`agent: fake@1`, no bindings, no `.fake-agent.json`, no repository.**
  `generic@1` is in `EXECUTOR_BINDING_SPECS` (`binding-resolver.ts:17`) and
  requires `repository` + `ai_provider` + `credential`, so the epic's single
  `--bind source=$REPO` throws `UnboundAliasError`, and `pi.ts:401-405` then fails
  the run with `CredentialError: task has no ai_provider context`. `fake@1` is not
  in that map, needs no bindings, and `FakeRunner` returns `completed` with no
  landing candidate — precedent `make-fake-retry-graph.sh:7-13`. `.fake-agent.json`
  / `KANTHORD_FAKE_AGENT` is the seam for the **pi** loop (`main.ts:35-43`), which
  `fake@1` never enters.
- **Three tasks, not two.** With two independent tasks and no edge,
  `run daemon --until-idle` drains the queue and completes **both**, so
  `idle-task` never stays `pending` and proof steps 3 and 5 fail. `blocker-task`
  plus an edge keeps `idle-task` `pending`, because only a `completed` dependency
  satisfies an edge. The proof fails the blocker with the existing `--fail <id>`
  flag (`commands/run/daemon.ts:12-23`). No cascade discards the dependent —
  discard is an explicit command (007.16).
- **`grep -vq <pat> <file>` is vacuous** — it inverts line selection, not exit
  status, so it succeeds whenever any line fails to match. Both uses become
  `! grep -q`. And the `locked` assertion is anchored to the node
  (`grep -q "locked: $RAN"`), because a bare `grep -qE 'locked'` also matches the
  summary line and would pass if the wrong node were locked.

## Change — `scripts/e2e/make-sha-graph.sh`

Conventions from `make-discard-graph.sh`: `#!/usr/bin/env bash`; header block
(name — purpose, blank `#`, `# Usage:`, then a Shape block); `set -euo pipefail`
as the last header line with no blank line before it; `OUT="${1:?usage: …}"`;
`mkdir -p "$OUT"`; `cat > "$OUT/<file>" <<'EOF'` quoted heredocs; 75-dash
`# ---…` separators above each task; **no `echo`** (generators print nothing).

Arg parsing — the second positional is the only flag; there is no `getopts`
precedent anywhere in `scripts/e2e/`:

```bash
OUT="${1:?usage: make-sha-graph.sh <out-dir> [--add-new-task]}"
MODE="${2:-}"
mkdir -p "$OUT"

if [ "$MODE" = "--add-new-task" ]; then
  cat > "$OUT/task-new.md" <<'EOF'
…
EOF
  exit 0
fi
```

The `--add-new-task` branch writes **only** `task-new.md` and exits — it must not
rewrite the other files, because the proof calls it a second time on a directory
whose manifest and stamped ids are already live.

### Files written in default mode

`$OUT/initiative.md`:

```
---
kind: initiative
ref: sha-init
name: Content drift versus lifecycle progress
---
```

`$OUT/objective.md`:

```
---
kind: objective
ref: sha-obj
initiative: sha-init
name: Classify a progressed task by content alone
---
```

`$OUT/task-ran.md` — `ref: ran-task`, `title: Task that runs to completion`,
`agent: fake@1`, no dependencies.
`$OUT/task-blocker.md` — `ref: blocker-task`,
`title: Task the proof fails on purpose`, `agent: fake@1`, no dependencies.
`$OUT/task-idle.md` — `ref: idle-task`, `title: Idle task`, `agent: fake@1`,
`dependencies:\n  - blocker-task`.

Each task body is exactly:

````
# Instructions
<one short paragraph>
# Acceptance Criteria
- [ ] <one item>
# Verification
```sh
true
````

````

### File written in `--add-new-task` mode

`$OUT/task-new.md` — `ref: new-task`, `agent: fake@1`, no dependencies, and the
title **exactly** `Added after work already ran` (the proof resolves the new id by
matching that string in `list task --initiative --json`).

## Change — `scripts/e2e/sha-classification-proof.sh`

Model on `scripts/e2e/discard-proof.sh`: same header shape, `set -euo pipefail`,
one terminal `echo` on success. Takes no arguments; owns its own data directory.

```bash
#!/usr/bin/env bash
# sha-classification-proof.sh — EPIC 007.18 Proof. Hermetic, no model, no
# network: the graph runs on the FakeRunner (agent: fake@1), so no repository,
# ai_provider or credential resource is needed and no --bind flag is passed.
#
# Usage: scripts/e2e/sha-classification-proof.sh
#
# Proves all four classifications against the real program, on an initiative
# where work has already reached a terminal state:
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
set -euo pipefail

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
cp "$G/task-ran.md" "$D/task-ran.bak"
sed -i '' 's/^title: .*/title: Ran task retitled/' "$G/task-ran.md"
! node src/main.ts import graph "$G" --apply --initiative "$INIT" >/dev/null 2>&1
node src/main.ts import graph "$G" --apply --initiative "$INIT" 2>&1 | grep -q "locked: $RAN"
! node src/main.ts get task --id "$RAN" | grep -q 'Ran task retitled'
cp "$D/task-ran.bak" "$G/task-ran.md"

# ---- 5) a real out-of-band content change is still caught as `drifted`
node src/main.ts add dependency --task "$IDLE" --dependency "$RAN" >/dev/null
node src/main.ts import graph "$G" --apply --initiative "$INIT" --dry-run 2>&1 \
  | grep -q "drifted: $IDLE"

echo "007.18 PROOF OK"
````

## Constraints

- `ref` values are exactly `sha-init`, `sha-obj`, `ran-task`, `blocker-task`,
  `idle-task`, `new-task` — the proof reads `refToId.tasks["<ref>"]`.
- `agent: fake@1` on all four tasks; no `context:` on any task and no `bindings:`
  on the initiative. Adding either would make the import demand `--bind` flags.
- No `.fake-agent.json`, no `KANTHORD_FAKE_AGENT`.
- The `# Verification` fence language must be exactly `sh`
  (`graph-codec.ts:117-146`); anything else parses as no verification. Frontmatter
  must start at byte 0 (`graph-codec.ts:25-31`).
- Every heredoc uses the quoted `<<'EOF'` form — each task body contains a fenced
  ` ```sh ` block, and no shell variable may be interpolated into a task file.
- `--add-new-task` is additive and idempotent; touching any other file is a defect.
- The proof script takes no arguments, writes only under `.data/proof-00718`, and
  removes that directory first so a rerun is deterministic.
- No shell linter runs on `scripts/` (no shellcheck; ESLint is `src/**/*.ts`;
  lint-staged excludes `.sh`; CI runs only typecheck) — correctness is on this
  story. Wrap comments at 80 columns.

## Verify

- `scripts/e2e/make-sha-graph.sh /tmp/sha-graph-check` writes exactly
  `initiative.md`, `objective.md`, `task-ran.md`, `task-blocker.md`,
  `task-idle.md` and prints nothing.
- `scripts/e2e/make-sha-graph.sh /tmp/sha-graph-check --add-new-task` adds only
  `task-new.md`; the other five files are byte-identical afterwards.
- `scripts/e2e/sha-classification-proof.sh` exits 0 and prints
  `007.18 PROOF OK`.
- Running it a second time in the same tree also exits 0 (it clears its own data
  directory).
- `npm run verify` exits 0.

Proof: delivers the entire Verification Gate — steps 1 (`unchanged: $RAN`),
2 (insert lands), 3 (`updated`), 4 (`locked: $RAN`), 5 (`drifted: $IDLE`), and the
`007.18 PROOF OK` line.
