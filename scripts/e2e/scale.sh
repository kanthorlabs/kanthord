#!/usr/bin/env bash
SCRIPT_NAME=e2e-scale
. "$(dirname "$0")/../lib/common.sh"
require_command node
[ -n "${RUN:-}" ] || die "set RUN=<name>"
[ -n "${BINDING:-}" ] || die "set BINDING=<binding>"
[ -n "${COUNT:-}" ] || die "set COUNT=<n>"
exec node "$ROOT/scripts/e2e/scale.mjs" "$RUN" "$BINDING" "$COUNT"
