#!/usr/bin/env bash
# Install the workspace dependencies. TARGET names another checkout.
SCRIPT_NAME=app-install
. "$(dirname "$0")/../lib/common.sh"
require_command pnpm

target=${TARGET:-$APP_DIR}
cd "$target" || die "$target does not exist"
pnpm install --frozen-lockfile || pnpm install || die "pnpm install failed"
log "dependencies installed in $target"
