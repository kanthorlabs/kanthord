# Homelab helpers. Source this file after scripts/lib/common.sh. Do not run it.

HOMELAB_PORT=${HOMELAB_PORT:-31416}
HOMELAB_CONTAINER=${CONTAINER:-kanthord-homelab}
HOMELAB_VOLUME=${VOLUME:-kanthord-homelab}

# homelab_host -> the public host from HOMELAB_HOST or from .env
homelab_host() {
	local host=${HOMELAB_HOST:-}
	if [ -z "$host" ] && [ -f "$ENV_FILE" ]; then
		host=$(sed -n 's/^HOMELAB_HOST=//p' "$ENV_FILE" | tail -n 1)
	fi
	[ -n "$host" ] || die "HOMELAB_HOST is not set. Write HOMELAB_HOST=<host> to $ENV_FILE"
	case "$host" in
	*[!A-Za-z0-9.-]* | .* | *. ) die "HOMELAB_HOST $host is not a host name" ;;
	esac
	printf '%s' "$host"
}

# homelab_engine -> CONTAINER_ENGINE, or the first of podman and docker
homelab_engine() {
	local engine=${CONTAINER_ENGINE:-} candidate
	if [ -z "$engine" ]; then
		for candidate in podman docker; do
			if command -v "$candidate" >/dev/null 2>&1; then
				engine=$candidate
				break
			fi
		done
	fi
	[ -n "$engine" ] || die "neither podman nor docker is installed. CONTAINER_ENGINE=path selects one"
	require_command "$engine"
	printf '%s' "$engine"
}
