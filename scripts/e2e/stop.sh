#!/usr/bin/env bash
SCRIPT_NAME=e2e-stop
. "$(dirname "$0")/../lib/common.sh"
require_command node
[ "${STOP:-}" != daemon ] || require_command gh
[ -n "${RUN:-}" ] || die "set RUN=<name>"
exec node "$ROOT/scripts/e2e/stop.mjs" "$RUN"
