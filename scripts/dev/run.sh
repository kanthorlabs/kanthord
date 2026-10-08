#!/usr/bin/env bash
SCRIPT_NAME=dev
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command lsof

[ -d "$ENGINE_DIR/node_modules" ] || die "engine dependencies are missing. Run make bootstrap"
[ -x "$APP_DIR/node_modules/.bin/vite" ] || die "app dependencies are missing. Run make bootstrap"
[ -f "$(engine_config_file)" ] || die "$(engine_config_file) is missing. Run make bootstrap"

for port in "$ENGINE_PORT" "$WEB_PORT"; do
	holder=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
	[ -z "$holder" ] || die "port $port already has a listener, pid $holder: $(ps -p "$holder" -o command= | cut -c1-80)"
done

if [ "${FRESH:-0}" = "1" ]; then
	engine_remove_data
	log "removed the engine data"
fi

prefix() {
	while IFS= read -r line; do
		printf '[%s] %s\n' "$1" "$line"
	done
}

engine_pid=
app_pid=
stop() {
	trap - EXIT
	[ -n "$engine_pid" ] && kill "$engine_pid" 2>/dev/null
	[ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null
	wait 2>/dev/null
}
trap 'stop; exit 0' INT TERM
trap stop EXIT

(cd "$ENGINE_DIR" && exec node --watch-path=src --watch-path=static src/main.ts serve) \
	> >(prefix engine) 2>&1 &
engine_pid=$!
(cd "$APP_DIR" && exec ./node_modules/.bin/vite --host 0.0.0.0 --port "$WEB_PORT" --strictPort) \
	> >(prefix apps) 2>&1 &
app_pid=$!

log "engine http://127.0.0.1:$ENGINE_PORT, dashboard http://localhost:$WEB_PORT. Press Ctrl-C to stop both"
while kill -0 "$engine_pid" 2>/dev/null && kill -0 "$app_pid" 2>/dev/null; do
	sleep 1
done
kill -0 "$engine_pid" 2>/dev/null || warn "the engine stopped"
kill -0 "$app_pid" 2>/dev/null || warn "the dashboard stopped"
exit 1
