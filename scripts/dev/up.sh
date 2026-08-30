#!/usr/bin/env bash
# Start the daemon and the dashboard. FRESH=1 starts from a clean state:
# a new daemon home, a migrated database, and cleared web build caches.
SCRIPT_NAME=dev-up
. "$(dirname "$0")/../lib/common.sh"

"$ROOT/scripts/engine/up.sh" || exit 1
"$ROOT/scripts/app/up.sh" || exit 1
log "daemon http://127.0.0.1:$ENGINE_PORT, dashboard http://localhost:$WEB_PORT"
