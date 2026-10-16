#!/usr/bin/env bash
SCRIPT_NAME=e2e-check
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command git
[ -n "${RUN:-}" ] || die "set RUN=<name>"
exec node "$ROOT/scripts/e2e/check.mjs" "$RUN"
