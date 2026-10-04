#!/usr/bin/env bash
# Start the daemon. FRESH=1 deletes the daemon home and the database first.
SCRIPT_NAME=engine-up
. "$(dirname "$0")/../lib/common.sh"

PID="$RUN_DIR/engine.pid"
LOG="$RUN_DIR/engine.log"
mkdir -p "$RUN_DIR"

if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
	log "already running (pid $(cat "$PID"))"
	exit 0
fi

[ -d "$ENGINE_DIR/node_modules" ] || "$(dirname "$0")/install.sh" || exit 1

if [ "${FRESH:-0}" = "1" ]; then
	home=$(node -p "require('$ENGINE_DIR/kanthord.config.json').home" 2>/dev/null) || home=""
	if [ -n "$home" ] && [ -d "$home" ]; then
		rm -rf "$home"
		log "removed the daemon home $home"
	fi
fi

probe() {
	[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$ENGINE_PORT/api/liveness" 2>/dev/null)" = "200" ]
}

cd "$ENGINE_DIR" || exit 1
nohup node src/main.ts serve >"$LOG" 2>&1 &
echo $! >"$PID"
printf '%s: starting' "$SCRIPT_NAME"
for _ in $(seq 1 30); do
	probe && break
	kill -0 "$(cat "$PID")" 2>/dev/null || {
		printf ' died\n'
		tail -20 "$LOG" >&2
		rm -f "$PID"
		exit 1
	}
	printf '.'
	sleep 1
done
if probe; then
	printf ' ready on http://127.0.0.1:%s\n' "$ENGINE_PORT"
else
	printf ' timeout\n'
	tail -20 "$LOG" >&2
	exit 1
fi
