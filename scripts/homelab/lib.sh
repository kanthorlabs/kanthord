# Homelab helpers. Source this file after scripts/lib/common.sh. Do not run it.

HOMELAB_ENV="$RUN_DIR/homelab.env"

# homelab_host -> the public host from HOMELAB_HOST or from .dev/homelab.env
homelab_host() {
	local host=${HOMELAB_HOST:-}
	if [ -z "$host" ] && [ -f "$HOMELAB_ENV" ]; then
		host=$(sed -n 's/^HOMELAB_HOST=//p' "$HOMELAB_ENV" | tail -n 1)
	fi
	[ -n "$host" ] || die "HOMELAB_HOST is not set. Write HOMELAB_HOST=<host> to $HOMELAB_ENV"
	case "$host" in
	*[!A-Za-z0-9.-]* | .* | *. ) die "HOMELAB_HOST $host is not a host name" ;;
	esac
	printf '%s' "$host"
}
