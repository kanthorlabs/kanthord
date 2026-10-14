#!/usr/bin/env bash
SCRIPT_NAME=e2e-start
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command gh
[ -n "${RUN:-}" ] || die "set RUN=<name>, for example RUN=todoapp-1"
exec node "$ROOT/scripts/e2e/start.mjs" "${CONFIG:-scripts/e2e/todoapp.json}" "$RUN" "${PAUSED:-1}" "${PLACEMENT:-server}"
