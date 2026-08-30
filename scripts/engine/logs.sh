#!/usr/bin/env bash
SCRIPT_NAME=engine-logs
. "$(dirname "$0")/../lib/common.sh"
exec tail -f "$RUN_DIR/engine.log"
