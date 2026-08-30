#!/usr/bin/env bash
# Stop both processes. CLEAN=1 also removes the logs, the pid files, and the
# daemon home, so the next up starts from nothing.
SCRIPT_NAME=dev-down
. "$(dirname "$0")/../lib/common.sh"

"$ROOT/scripts/app/down.sh"
"$ROOT/scripts/engine/down.sh"

if [ "${CLEAN:-0}" = "1" ]; then
	home=$(node -p "require('$ENGINE_DIR/kanthord.config.json').home" 2>/dev/null) || home=""
	if [ -n "$home" ] && [ -d "$home" ]; then
		rm -rf "$home"
		log "removed the daemon home $home"
	fi
	rm -rf "$RUN_DIR"
	log "removed the run directory"
fi
