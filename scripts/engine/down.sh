#!/usr/bin/env bash
# Stop the daemon. CLEAN=1 also removes the log.
SCRIPT_NAME=engine-down
. "$(dirname "$0")/../lib/common.sh"

PID="$RUN_DIR/engine.pid"
if [ -f "$PID" ]; then
	kill "$(cat "$PID")" 2>/dev/null || true
	rm -f "$PID"
fi
pkill -f "src/main.ts serve" 2>/dev/null || true
[ "${CLEAN:-0}" = "1" ] && rm -f "$RUN_DIR/engine.log"
log "stopped"
