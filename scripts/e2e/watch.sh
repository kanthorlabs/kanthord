#!/usr/bin/env bash
SCRIPT_NAME=e2e-watch
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command gh
[ -n "${RUN:-}" ] || die "set RUN=<name>"
exec node "$ROOT/scripts/e2e/watch.mjs" "$RUN"
