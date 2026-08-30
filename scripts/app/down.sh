#!/usr/bin/env bash
# Stop the dashboard. CLEAN=1 also removes the log.
SCRIPT_NAME=app-down
. "$(dirname "$0")/../lib/common.sh"

PID="$RUN_DIR/app.pid"
if [ -f "$PID" ]; then
	kill "$(cat "$PID")" 2>/dev/null || true
	rm -f "$PID"
fi
holder=$(lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
[ -n "$holder" ] && kill "$holder" 2>/dev/null
[ "${CLEAN:-0}" = "1" ] && rm -f "$RUN_DIR/app.log"
log "stopped"
