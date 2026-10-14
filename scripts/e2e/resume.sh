#!/usr/bin/env bash
SCRIPT_NAME=e2e-resume
. "$(dirname "$0")/../lib/common.sh"
require_command node
[ -n "${RUN:-}" ] || die "set RUN=<name>"
exec node "$ROOT/scripts/e2e/resume.mjs" "$RUN"
