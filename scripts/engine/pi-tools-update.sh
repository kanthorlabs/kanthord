#!/usr/bin/env bash
SCRIPT_NAME=engine-pi-tools-update
. "$(dirname "$0")/../lib/common.sh"
require_command pnpm

[ -n "${TOOL:-}" ] || die "TOOL is required, for example TOOL=rg"
[ -n "${VERSION:-}" ] || die "VERSION is required, for example VERSION=15.1.0"

cd "$ENGINE_DIR" || die "$ENGINE_DIR does not exist"
pnpm run pi-tools:update "$TOOL" "$VERSION" || die "the pi tool update failed"
log "pinned $TOOL $VERSION in engine/static/pi-tools.json"
