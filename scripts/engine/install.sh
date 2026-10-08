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

config_file=$(engine_config_file)
if [ ! -f "$config_file" ]; then
	node "$ENGINE_DIR/src/main.ts" config init || die "config init failed"
	perl -i -pe 's/^(\s+host_file:) true$/$1 false/' "$config_file" || die "cannot set host_file in $config_file"
	grep -Eq '^[[:space:]]+host_file: false$' "$config_file" || die "host_file is not false in $config_file"
	log "generated $config_file"
fi
