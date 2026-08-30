#!/usr/bin/env bash
# Start the dashboard. FRESH=1 clears the build caches first.
SCRIPT_NAME=app-up
. "$(dirname "$0")/../lib/common.sh"

PID="$RUN_DIR/app.pid"
LOG="$RUN_DIR/app.log"
mkdir -p "$RUN_DIR"

if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
	log "already running (pid $(cat "$PID"))"
	exit 0
fi

holder=$(lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -n "$holder" ]; then
	warn "port $WEB_PORT already has a listener, pid $holder:"
	ps -p "$holder" -o command= | cut -c1-100 >&2
fi

[ -d "$APP_DIR/node_modules" ] || "$(dirname "$0")/install.sh" || exit 1

if [ "${FRESH:-0}" = "1" ]; then
	rm -rf "$APP_DIR/.turbo" "$APP_DIR/apps/dashboard/.turbo" \
		"$APP_DIR/apps/dashboard/dist" "$APP_DIR/node_modules/.vite" \
		"$APP_DIR/apps/dashboard/node_modules/.vite"
	log "cleared the build caches"
fi

cd "$APP_DIR" || exit 1
nohup pnpm run dev >"$LOG" 2>&1 &
echo $! >"$PID"
printf '%s: starting' "$SCRIPT_NAME"
for _ in $(seq 1 60); do
	grep -qE "Local:|ready in" "$LOG" 2>/dev/null && break
	kill -0 "$(cat "$PID")" 2>/dev/null || {
		printf ' died\n'
		tail -20 "$LOG" >&2
		rm -f "$PID"
		exit 1
	}
	printf '.'
	sleep 1
done
if grep -qE "Local:|ready in" "$LOG" 2>/dev/null; then
	printf ' ready on http://localhost:%s\n' "$WEB_PORT"
else
	printf ' timeout\n'
	tail -20 "$LOG" >&2
	exit 1
fi
