#!/usr/bin/env bash
SCRIPT_NAME=e2e-images
. "$(dirname "$0")/../lib/common.sh"

mode=${1:-build}
case "$mode" in build | id) ;; *) die "usage: images.sh [build|id]" ;; esac

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

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ENGINE_DIR/package.json")
[ -n "$version" ] || die "$ENGINE_DIR/package.json has no line in the form '  \"version\": \"<version>\",'"
node_version=$(tr -d '[:space:]v' <"$ENGINE_DIR/.nvmrc")
dev_image=localhost/kanthord-dev
node_image=localhost/kanthord-dev-node
load=
format=
case "$(basename "$engine")" in docker) load=--load ;; podman) format=--format=docker ;; esac

if [ "$mode" = build ]; then
	CONTAINER_ENGINE=$engine IMAGE=$dev_image "$ROOT/scripts/release/image.sh" >&2 ||
		die "the build of $dev_image failed"
	log "building $node_image:$version on $dev_image:$version" >&2
	"$engine" build \
		--file "$ROOT/scripts/e2e/dev-node.Containerfile" \
		--build-arg "NODE_VERSION=$node_version" \
		--build-arg "BASE_IMAGE=$dev_image" \
		--build-arg "VERSION=$version" \
		--tag "$node_image:$version" \
		$load \
		$format \
		"$ROOT/scripts/e2e" >&2 || die "the build of $node_image failed"
fi

image_id=$("$engine" image inspect --format '{{.Id}}' "$node_image:$version") ||
	die "$node_image:$version is absent. Run make e2e PLACEMENT=container or make e2e-restart"
printf 'image_id %s\n' "$image_id"
