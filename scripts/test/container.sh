#!/usr/bin/env bash
SCRIPT_NAME=test-container
. "$(dirname "$0")/../lib/common.sh"
require_command pnpm

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
[ -d "$ENGINE_DIR/node_modules" ] || die "engine dependencies are missing. Run make bootstrap"

image=${IMAGE:-localhost/kanthord-dev}
CONTAINER_ENGINE=$engine IMAGE=$image "$ROOT/scripts/release/image.sh" ||
	die "the image build failed"

log "running the container driver test against $image with $engine"
(cd "$ENGINE_DIR" && KANTHORD_TEST_CONTAINER_IMAGE=$image pnpm run test:container) ||
	die "the container driver test failed"
log "the container driver test passed"
