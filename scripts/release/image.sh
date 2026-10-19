#!/usr/bin/env bash
SCRIPT_NAME=release-image
. "$(dirname "$0")/../lib/common.sh"

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

[ -f "$ENGINE_DIR/package.json" ] || die "the engine submodule is missing. Run git submodule update --init -- engine apps"
[ -f "$APP_DIR/package.json" ] || die "the apps submodule is missing. Run git submodule update --init -- engine apps"

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ENGINE_DIR/package.json")
[ -n "$version" ] || die "$ENGINE_DIR/package.json has no version"
node_version=$(tr -d '[:space:]v' <"$ENGINE_DIR/.nvmrc")
image=${IMAGE:-kanthord}
load=
case "$(basename "$engine")" in docker) load=--load ;; esac

log "building $image:$version with $engine on node $node_version"
"$engine" build \
	--file "$ROOT/Containerfile" \
	--build-arg "NODE_VERSION=$node_version" \
	--tag "$image:$version" \
	--tag "$image:latest" \
	$load \
	"$ROOT" || die "$engine build failed"

[ "$("$engine" run --rm "$image:$version" --version)" = "$version" ] ||
	die "the image answers a version other than $version"
log "built $image:$version and $image:latest"
