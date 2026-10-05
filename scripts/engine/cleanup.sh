#!/usr/bin/env bash
SCRIPT_NAME=engine-cleanup
. "$(dirname "$0")/../lib/common.sh"

"$ROOT/scripts/engine/down.sh"

config_file=$(engine_config_file)
if [ -e "$config_file" ]; then
	rm -f "$config_file"
	log "removed $config_file"
fi
engine_remove_data

log "next: make engine-install, then make up"
