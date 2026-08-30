#!/usr/bin/env bash
# Install the daemon dependencies and generate a configuration when it is
# missing. TARGET names another checkout, such as a worktree.
SCRIPT_NAME=engine-install
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command pnpm

target=${TARGET:-$ENGINE_DIR}
cd "$target" || die "$target does not exist"

if [ -f pnpm-lock.yaml ]; then
	pnpm install --frozen-lockfile || die "pnpm install failed"
else
	pnpm install || die "pnpm install failed"
fi
log "dependencies installed in $target"

if [ ! -f "$target/kanthord.config.json" ]; then
	node "$ENGINE_DIR/src/main.ts" config generate \
		--home "$target/.data/.kanthord" --output "$target" || die "config generate failed"
	log "generated kanthord.config.json in $target"
fi
