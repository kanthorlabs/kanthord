#!/usr/bin/env bash
SCRIPT_NAME=engine-migrate
. "$(dirname "$0")/../lib/common.sh"
cd "$ENGINE_DIR" || exit 1
exec node src/main.ts db migrate
