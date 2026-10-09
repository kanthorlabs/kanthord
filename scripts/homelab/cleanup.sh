#!/usr/bin/env bash
SCRIPT_NAME=homelab-cleanup
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"

engine=$(homelab_engine) || exit 1

if "$engine" container inspect "$HOMELAB_CONTAINER" >/dev/null 2>&1; then
	"$engine" rm -f "$HOMELAB_CONTAINER" >/dev/null || die "cannot remove container $HOMELAB_CONTAINER"
	log "removed container $HOMELAB_CONTAINER"
fi

if "$engine" volume inspect "$HOMELAB_VOLUME" >/dev/null 2>&1; then
	if confirm "remove volume $HOMELAB_VOLUME with its master key and data"; then
		"$engine" volume rm "$HOMELAB_VOLUME" >/dev/null || die "cannot remove volume $HOMELAB_VOLUME"
		log "removed volume $HOMELAB_VOLUME"
	else
		log "kept volume $HOMELAB_VOLUME"
	fi
fi

rm -rf "$RUN_DIR/homelab"
log "the nginx site stays. Run make homelab-kanthord to start again"
