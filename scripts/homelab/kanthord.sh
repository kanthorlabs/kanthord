#!/usr/bin/env bash
SCRIPT_NAME=homelab-kanthord
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"
require_command curl

engine=${CONTAINER_ENGINE:-}
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

host=$(homelab_host) || exit 1
base_path=/s/kanthord
image=${IMAGE:-kanthord:latest}
name=${CONTAINER:-kanthord-homelab}
volume=${VOLUME:-kanthord-homelab}
config=/var/lib/kanthord/config/kanthord/kanthord.yaml

"$engine" image inspect "$image" >/dev/null 2>&1 || die "image $image is missing. Run make release-image"

if ! "$engine" run --rm -v "$volume:/var/lib/kanthord" --entrypoint test "$image" -f "$config"; then
	log "creating the configuration in volume $volume"
	"$engine" run --rm -v "$volume:/var/lib/kanthord" "$image" config init \
		--gateway-bind :: \
		--gateway-allowed-host "$host" \
		--gateway-base-path "$base_path" || die "config init failed"
fi
"$engine" run --rm -v "$volume:/var/lib/kanthord" "$image" config show | grep -qx "  base_path: $base_path" ||
	die "the configuration in volume $volume has no base_path $base_path"

"$engine" rm -f "$name" >/dev/null 2>&1
case "$(basename "$engine")" in
podman) systemctl --user enable podman-restart.service >/dev/null 2>&1 || die "cannot enable podman-restart.service, so $name would not start after a reboot" ;;
esac
log "starting $name from $image on 127.0.0.1:$ENGINE_PORT"
"$engine" run -d --name "$name" --restart=always \
	-p "127.0.0.1:$ENGINE_PORT:31415" \
	-v "$volume:/var/lib/kanthord" \
	"$image" >/dev/null || die "cannot start $name"

for attempt in $(seq 1 30); do
	if curl -fs -o /dev/null -H "Host: $host" "http://127.0.0.1:$ENGINE_PORT$base_path/api/liveness"; then
		log "$name answers at http://127.0.0.1:$ENGINE_PORT$base_path"
		exit 0
	fi
	sleep 1
done
die "$name did not answer after 30 attempts. Read $engine logs $name"
