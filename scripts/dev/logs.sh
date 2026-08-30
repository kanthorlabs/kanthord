#!/usr/bin/env bash
# Follow both logs together.
SCRIPT_NAME=dev-logs
. "$(dirname "$0")/../lib/common.sh"
exec tail -f "$RUN_DIR/engine.log" "$RUN_DIR/app.log"
