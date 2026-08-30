#!/usr/bin/env bash
SCRIPT_NAME=app-logs
. "$(dirname "$0")/../lib/common.sh"
exec tail -f "$RUN_DIR/app.log"
