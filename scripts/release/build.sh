#!/usr/bin/env bash
SCRIPT_NAME=release-build
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command pnpm

SEA_FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
os=$(node -p process.platform)
arch=$(node -p process.arch)
work="$RUN_DIR/release"
output=${OUTPUT:-$ROOT/dist/kanthord-$os-$arch}
node_binary=$(node -p process.execPath)

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
process.exit(major === 24 && minor >= 15 ? 0 : 1);
' || die "node $(node -v) is outside the engine range >=24.15.0 <25"

case "$os" in
darwin)
	require_command codesign
	if otool -L "$node_binary" | grep -qE '/(opt/homebrew|usr/local)/'; then
		die "$node_binary links Homebrew libraries. Use an official Node.js build"
	fi
	;;
linux) ;;
*) die "unsupported platform $os" ;;
esac

[ -d "$ENGINE_DIR/node_modules" ] || die "engine dependencies are missing. Run make bootstrap"
[ -d "$APP_DIR/node_modules" ] || die "app dependencies are missing. Run make bootstrap"

cd "$ROOT" || die "$ROOT does not exist"
pnpm install --frozen-lockfile >/dev/null || die "pnpm install failed in $ROOT"

rm -rf "$work"
mkdir -p "$work" "$(dirname "$output")" || die "cannot create $work"

log "fetching the pi tools"
(cd "$ENGINE_DIR" && pnpm run pi-tools:fetch) || die "the pi tools fetch failed"

log "building the dashboard"
(cd "$APP_DIR" && pnpm run build >"$work/dashboard.log" 2>&1) ||
	die "the dashboard build failed. See $work/dashboard.log"
[ -f "$APP_DIR/dist/index.html" ] || die "the dashboard build wrote no index.html"

log "bundling the engine"
pnpm exec esbuild "$ENGINE_DIR/src/main.ts" \
	--bundle \
	--platform=node \
	--target=node24 \
	--format=cjs \
	--log-level=warning \
	"--banner:js=const __kanthord_import_meta_url=require('node:url').pathToFileURL(__filename).href;" \
	--define:import.meta.url=__kanthord_import_meta_url \
	--outfile="$work/kanthord.cjs" || die "esbuild failed"

log "bundling the worker thread"
pnpm exec esbuild "$ENGINE_DIR/src/apps/worker/thread.ts" \
	--bundle \
	--platform=node \
	--target=node24 \
	--format=cjs \
	--log-level=warning \
	"--banner:js=const __kanthord_import_meta_url=require('node:url').pathToFileURL(process.execPath).href;" \
	--define:import.meta.url=__kanthord_import_meta_url \
	--outfile="$work/worker-thread.cjs" || die "worker thread bundle failed"
thread_url=$(cd / && node -e '
const banner = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n", 1)[0];
new (require("node:worker_threads").Worker)(`${banner}process.stdout.write(__kanthord_import_meta_url);`, { eval: true });
' "$work/worker-thread.cjs")
[ "$thread_url" = "$(node -p 'require("node:url").pathToFileURL(process.execPath).href')" ] ||
	die "the worker thread resolves import.meta.url to $thread_url instead of the executable"

log "preparing the single executable blob"
node "$ROOT/scripts/release/sea-config.mjs" "$ENGINE_DIR" "$APP_DIR/dist" "$work/kanthord.cjs" \
	"$work/worker-thread.cjs" "$work/kanthord.blob" "$work/sea-config.json" || die "cannot write the SEA configuration"
node --experimental-sea-config "$work/sea-config.json" >/dev/null || die "cannot prepare the SEA blob"

log "injecting the blob into $(node -v)"
cp "$node_binary" "$output" || die "cannot copy $node_binary"
chmod u+w "$output"
if [ "$os" = darwin ]; then
	codesign --remove-signature "$output" || die "cannot remove the signature"
	pnpm exec postject "$output" NODE_SEA_BLOB "$work/kanthord.blob" \
		--sentinel-fuse "$SEA_FUSE" --macho-segment-name NODE_SEA >/dev/null ||
		die "postject failed"
	codesign --sign - "$output" || die "cannot sign $output"
else
	pnpm exec postject "$output" NODE_SEA_BLOB "$work/kanthord.blob" \
		--sentinel-fuse "$SEA_FUSE" >/dev/null || die "postject failed"
fi

log "built $output"
