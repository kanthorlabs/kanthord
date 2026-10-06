#!/usr/bin/env bash
# Stop the daemon and wait until it exits, so the next start finds the database lock free.
# CLEAN=1 also removes the log.
SCRIPT_NAME=engine-down
. "$(dirname "$0")/../lib/common.sh"

PATTERN="src/main.ts serve"
EXIT_WAIT_SECONDS=15

PID="$RUN_DIR/engine.pid"
if [ -f "$PID" ]; then
	kill "$(cat "$PID")" 2>/dev/null || true
	rm -f "$PID"
fi
pkill -f "$PATTERN" 2>/dev/null || true

for _ in $(seq 1 $((EXIT_WAIT_SECONDS * 10))); do
	pgrep -f "$PATTERN" >/dev/null || break
	sleep 0.1
done
if pgrep -f "$PATTERN" >/dev/null; then
	die "a daemon still runs after ${EXIT_WAIT_SECONDS}s: $(pgrep -f "$PATTERN" | tr '\n' ' ')"
fi

[ "${CLEAN:-0}" = "1" ] && rm -f "$RUN_DIR/engine.log"
log "stopped"
