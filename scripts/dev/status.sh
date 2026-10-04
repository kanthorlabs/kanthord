#!/usr/bin/env bash
# Report both processes, and call both endpoints.
SCRIPT_NAME=dev-status
. "$(dirname "$0")/../lib/common.sh"

report() {
	pid_file="$RUN_DIR/$1.pid"
	if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
		printf '%s: running (pid %s)\n' "$1" "$(cat "$pid_file")"
	else
		printf '%s: stopped\n' "$1"
	fi
}

report engine
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$ENGINE_PORT/api/liveness" 2>/dev/null)
printf 'engine: GET /api/liveness -> %s\n' "${code:-no answer}"

report app
holder=$(lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -n "$holder" ]; then
	printf 'app: port %s held by pid %s: %s\n' "$WEB_PORT" "$holder" "$(ps -p "$holder" -o comm=)"
else
	printf 'app: port %s free\n' "$WEB_PORT"
fi
