#!/usr/bin/env bash
SCRIPT_NAME=e2e
. "$(dirname "$0")/../lib/common.sh"
require_command curl

DAEMON_WAIT_SECONDS=60
LIVENESS="http://127.0.0.1:$ENGINE_PORT/api/liveness"
DEV_LOG="$RUN_DIR/e2e/dev.log"

[ -f "$ENGINE_DIR/.env.e2e" ] || die "$ENGINE_DIR/.env.e2e is missing"

require_command pnpm
(cd "$ENGINE_DIR" && pnpm install --frozen-lockfile --reporter=silent) ||
	die "the engine dependencies do not match engine/pnpm-lock.yaml"
(cd "$ENGINE_DIR" && pnpm run pi-tools:fetch) || die "the pi tools fetch failed"

live() {
	curl -fsS -o /dev/null --max-time 2 "$LIVENESS" 2>/dev/null
}

if live; then
	log "the daemon answers on port $ENGINE_PORT"
else
	mkdir -p "$RUN_DIR/e2e"
	nohup "$ROOT/scripts/dev/run.sh" >>"$DEV_LOG" 2>&1 </dev/null &
	log "make dev started in the background, pid $!, log $DEV_LOG"
	for _ in $(seq "$DAEMON_WAIT_SECONDS"); do
		live && break
		sleep 1
	done
	live || die "the daemon did not answer in $DAEMON_WAIT_SECONDS s. Read $DEV_LOG"
fi

RUN=${RUN:-todoapp-$(date +%y%m%d-%H%M)} exec "$ROOT/scripts/e2e/start.sh"
