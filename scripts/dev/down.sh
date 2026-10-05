#!/usr/bin/env bash
# Stop both processes. CLEAN=1 also removes the logs, the pid files, and the
# database, so the next up starts from an empty database.
SCRIPT_NAME=dev-down
. "$(dirname "$0")/../lib/common.sh"

"$ROOT/scripts/app/down.sh"
"$ROOT/scripts/engine/down.sh"

if [ "${CLEAN:-0}" = "1" ]; then
	engine_remove_data
	rm -rf "$RUN_DIR"
	log "removed the run directory"
fi
