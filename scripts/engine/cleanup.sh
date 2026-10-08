#!/usr/bin/env bash
SCRIPT_NAME=engine-cleanup
. "$(dirname "$0")/../lib/common.sh"

holder=$(lsof -nP -iTCP:"$ENGINE_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
[ -z "$holder" ] || die "port $ENGINE_PORT has a listener, pid $holder. Stop make dev first"

config_file=$(engine_config_file)
if [ -e "$config_file" ]; then
	rm -f "$config_file"
	log "removed $config_file"
fi
engine_remove_data

log "next: make bootstrap, then make dev"
