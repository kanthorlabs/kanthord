#!/usr/bin/env bash
# e2e-smoke-todo.sh — prove the built TODO API actually works end to end.
#
# Replaces the manual "start the server, curl five endpoints, eyeball the codes"
# step. Boots src/todo.mjs on a throwaway port and exercises the full CRUD cycle,
# asserting the status codes the graph's acceptance criteria require. Exits 0
# only if every check passes.
#
# Usage:  scripts/e2e/e2e-smoke-todo.sh <path-to-todo.mjs> [port]
#   e.g.  git -C <mirror> show HEAD:src/todo.mjs > /tmp/todo.mjs
#         scripts/e2e/e2e-smoke-todo.sh /tmp/todo.mjs
set -euo pipefail

MJS="${1:?usage: e2e-smoke-todo.sh <path-to-todo.mjs> [port]}"
PORT="${2:-3999}"
test -f "$MJS" || { echo "no such file: $MJS"; exit 1; }

node --check "$MJS" || { echo "FAIL: $MJS is not valid JS"; exit 1; }

PORT="$PORT" node "$MJS" >/tmp/e2e-todo-server.log 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
sleep 1

B="http://localhost:$PORT"
fail(){ echo "FAIL: $1"; exit 1; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }

# POST /tasks -> 201 + id
CREATED="$(curl -s -X POST "$B/tasks" -H 'content-type: application/json' \
  -d '{"title":"smoke","completed":false,"dueDate":"2026-08-01"}')"
ID="$(printf '%s' "$CREATED" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(String(o.id||(o.task&&o.task.id)||""))}catch{process.stdout.write("")}})')"
[ -n "$ID" ] || fail "POST /tasks returned no id ($CREATED)"
echo "POST   /tasks           -> id=$ID"

[ "$(code "$B/tasks")" = "200" ] || fail "GET /tasks not 200"
echo "GET    /tasks           -> 200"
[ "$(code "$B/tasks/$ID")" = "200" ] || fail "GET /tasks/:id not 200"
echo "GET    /tasks/$ID -> 200"
[ "$(code -X PUT "$B/tasks/$ID" -H 'content-type: application/json' -d '{"completed":true}')" = "200" ] || fail "PUT not 200"
echo "PUT    /tasks/:id        -> 200"
[ "$(code "$B/tasks/does-not-exist")" = "404" ] || fail "GET unknown not 404"
echo "GET    /tasks/unknown    -> 404"
[ "$(code -X DELETE "$B/tasks/$ID")" = "204" ] || fail "DELETE not 204"
echo "DELETE /tasks/:id        -> 204"
[ "$(code "$B/tasks/$ID")" = "404" ] || fail "GET after delete not 404"
echo "GET    /tasks/:id (gone) -> 404"

echo "TODO API SMOKE OK"
