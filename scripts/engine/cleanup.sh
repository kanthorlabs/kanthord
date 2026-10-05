#!/usr/bin/env bash
SCRIPT_NAME=engine-cleanup
. "$(dirname "$0")/../lib/common.sh"

xdg_dir() {
	case "${1:-}" in
	/*) printf '%s/kanthord' "$1" ;;
	*) printf '%s/%s/kanthord' "$HOME" "$2" ;;
	esac
}

config_dir=$(xdg_dir "${XDG_CONFIG_HOME:-}" .config)
config_file=${KANTHORD_CONFIG:-$config_dir/kanthord.yaml}

"$ROOT/scripts/engine/down.sh"

for target in \
	"$config_file" \
	"$(xdg_dir "${XDG_DATA_HOME:-}" .local/share)" \
	"$(xdg_dir "${XDG_STATE_HOME:-}" .local/state)" \
	"$(xdg_dir "${XDG_CACHE_HOME:-}" .cache)"; do
	if [ -e "$target" ]; then
		rm -rf "$target"
		log "removed $target"
	fi
done

log "next: cd engine && node src/main.ts config init, then make up"
