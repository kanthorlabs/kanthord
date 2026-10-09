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

# homelab_find <command> -> its path on PATH or in an sbin directory
homelab_find() {
	command -v "$1" 2>/dev/null && return 0
	local dir
	for dir in /usr/local/sbin /usr/sbin /sbin; do
		if [ -x "$dir/$1" ]; then
			printf '%s\n' "$dir/$1"
			return 0
		fi
	done
	return 1
}

# homelab_require <command> <package> -> install the package with apt-get after a confirmation
homelab_require() {
	homelab_find "$1" >/dev/null && return 0
	command -v apt-get >/dev/null 2>&1 || die "$1 is missing. Install the package $2"
	confirm "$1 is missing. Install the package $2 with sudo apt-get" || die "$1 is missing. Install the package $2"
	sudo apt-get update || die "apt-get update failed"
	sudo apt-get install -y "$2" || die "apt-get could not install $2"
	homelab_find "$1" >/dev/null || die "$2 is installed, but $1 is still missing"
}

# homelab_engine -> CONTAINER_ENGINE, or the first of podman and docker, or podman after its installation
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
	if [ -z "$engine" ]; then
		homelab_require podman podman >&2
		engine=podman
	fi
	require_command "$engine"
	printf '%s' "$engine"
}
