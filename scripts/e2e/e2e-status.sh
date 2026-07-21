#!/usr/bin/env bash
# e2e-status.sh — one-shot E2E dashboard for a running initiative.
#
# Replaces the ad-hoc `list task --json | node -e …` + raw `landing_candidates`
# SQLite queries that get repeated dozens of times during an E2E run. Prints, in
# one call: each task's status / declared dependencies / runtime waiting set, the
# landing-candidate lifecycle state per task (the internal field no CLI exposes),
# and an event-feed tally.
#
# Usage:  KANTHORD_DB=<path> scripts/e2e/e2e-status.sh <initiative-id>
#   (KANTHORD_DB defaults to .data/kanthord.db if unset — matches the CLI.)
#
# Read-only: never mutates the DB or the tree. Safe to run any time.
set -euo pipefail

INIT="${1:?usage: e2e-status.sh <initiative-id>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export KANTHORD_DB="${KANTHORD_DB:-.data/kanthord.db}"

# tasks (via the CLI read model: id/title/status/dependencies/waiting)
TASKS_JSON="$(node "$REPO_ROOT/src/main.ts" list task --initiative "$INIT" --json 2>/dev/null)"

DB_ABS="$KANTHORD_DB"
case "$DB_ABS" in /*) : ;; *) DB_ABS="$PWD/$DB_ABS" ;; esac

TASKS_JSON="$TASKS_JSON" DB="$DB_ABS" NODE_NO_WARNINGS=1 node -e '
const fs=require("fs");
const {DatabaseSync}=require("node:sqlite");
const tasks=JSON.parse(process.env.TASKS_JSON||"[]");
const db=new DatabaseSync(process.env.DB);

// candidate state per task (latest row wins)
const cands={};
for(const r of db.prepare("SELECT task_id,base_sha,candidate_sha,state,id FROM landing_candidates ORDER BY id").all()){
  cands[r.task_id]={state:r.state,base:String(r.base_sha||"").slice(0,8),cand:String(r.candidate_sha||"").slice(0,8)};
}

const done=tasks.filter(t=>t.status==="completed").length;
console.log(`\n=== TASKS (${done}/${tasks.length} completed) — initiative ${process.argv[1]} ===`);
for(const t of tasks){
  const c=cands[t.id];
  const deps=(t.dependencies||[]).length;
  const wait=(t.waiting||[]).length;
  console.log(
    (t.status||"").padEnd(22),
    (t.title||"").slice(0,30).padEnd(32),
    `deps:${deps} waiting:${wait}`.padEnd(20),
    c?`candidate:${c.state} (${c.base}->${c.cand})`:"candidate:none"
  );
}

console.log("\n=== EVENTS ===");
const total=db.prepare("SELECT COUNT(*) n FROM events").get().n;
const byType=db.prepare("SELECT type,COUNT(*) n FROM events GROUP BY type ORDER BY n DESC").all();
console.log(`total ${total}`);
for(const r of byType) console.log(`  ${String(r.n).padStart(4)}  ${r.type}`);
' "$INIT"
