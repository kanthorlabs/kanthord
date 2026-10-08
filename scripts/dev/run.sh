#!/usr/bin/env bash
SCRIPT_NAME=dev
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command lsof

[ -d "$ENGINE_DIR/node_modules" ] || die "engine dependencies are missing. Run make bootstrap"
[ -x "$APP_DIR/node_modules/.bin/vite" ] || die "app dependencies are missing. Run make bootstrap"
[ -f "$(engine_config_file)" ] || die "$(engine_config_file) is missing. Run make bootstrap"

port_holders() {
	lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null
}

watch_parent() {
	local parent
	parent=$(ps -o ppid= -p "$1" 2>/dev/null | tr -d ' ')
	[ -n "$parent" ] && [ "$parent" != 1 ] || return 0
	case "$(ps -o command= -p "$parent" 2>/dev/null)" in
	*node*--watch*) printf '%s\n' "$parent" ;;
	esac
}

stop_port() {
	local port=$1 holders pid attempt
	holders=$(port_holders "$port")
	[ -n "$holders" ] || return 0
	for pid in $holders; do
		log "port $port: stop pid $pid: $(ps -p "$pid" -o command= | cut -c1-80)"
		kill $(watch_parent "$pid") "$pid" 2>/dev/null
	done
	for attempt in 1 2 3 4 5 6 7 8 9 10; do
		[ -n "$(port_holders "$port")" ] || return 0
		sleep 0.5
	done
	holders=$(port_holders "$port")
	[ -z "$holders" ] || kill -KILL $holders 2>/dev/null
	sleep 0.5
	holders=$(port_holders "$port")
	[ -z "$holders" ] || die "port $port still has a listener, pid $holders"
}

for port in "$ENGINE_PORT" "$WEB_PORT"; do
	stop_port "$port"
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
