#!/usr/bin/env bash
# Install the root dependencies, for example the prettier of the docs check.
SCRIPT_NAME=repo-install
. "$(dirname "$0")/../lib/common.sh"
require_command pnpm

cd "$ROOT" || die "$ROOT does not exist"
pnpm install --frozen-lockfile || die "pnpm install failed"
log "dependencies installed in $ROOT"
