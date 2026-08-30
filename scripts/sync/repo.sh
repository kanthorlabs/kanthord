#!/usr/bin/env bash
# Sync one repository with its origin/main. Pass engine, apps, or parent.
# It never touches the gitlinks. Use sync-all for the whole tree.
SCRIPT_NAME=sync-repo
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"

name=${1:-} && [ -n "$name" ] || die "pass engine, apps, or parent"
SCRIPT_NAME="sync-$name"

sync_state_reset
preflight_repo "$name"
log "$name is $(drift_state "$name")"
protect_repo "$name"
integrate_repo "$name"
push_repo "$name"
restore_repo "$name"

preflight_repo "$name"
state=$(drift_state "$name")
[ "$state" = "synced" ] || warn "$name is still $state"
log "done"
