#!/usr/bin/env bash
SCRIPT_NAME=release-smoke-container
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command curl

engine=${CONTAINER_ENGINE:-podman}
require_command "$engine"
image_name=localhost/kanthord
owner_label=io.kanthord.owner
version=$(node -p "require('$ENGINE_DIR/package.json').version")

image_source=${IMAGE_FROM:-build}
case "$image_source" in
build)
	CONTAINER_ENGINE=$engine IMAGE=$image_name "$ROOT/scripts/release/image.sh" ||
		die "the image build failed"
	;;
docker)
	require_command docker
	docker save "kanthord:$version" | "$engine" load >/dev/null ||
		die "cannot load kanthord:$version from docker into $engine"
	"$engine" tag "kanthord:$version" "$image_name:$version" ||
		die "cannot tag kanthord:$version as $image_name:$version"
	;;
*) die "IMAGE_FROM is build or docker, got $image_source" ;;
esac
"$engine" image inspect "$image_name:$version" >/dev/null ||
	die "$engine holds no image $image_name:$version"
log "image $image_name:$version ready in $engine"

home="$RUN_DIR/release/smoke-container"
extract=
owner=

cleanup() {
	[ -n "${server_pid:-}" ] && kill "$server_pid" 2>/dev/null && wait "$server_pid" 2>/dev/null
	[ -n "$extract" ] && "$engine" rm --force "$extract" >/dev/null 2>&1
	if [ -n "$owner" ]; then
		"$engine" ps --all --quiet --filter "label=$owner_label=$owner" | xargs -r "$engine" rm --force >/dev/null 2>&1
		"$engine" volume ls --quiet --filter "label=$owner_label=$owner" | xargs -r "$engine" volume rm --force >/dev/null 2>&1
	fi
	return 0
}
trap cleanup EXIT

owned_names() {
	"$engine" ps --all --filter "label=$owner_label" --format '{{.Names}}' | sort
}

real_config=${XDG_CONFIG_HOME:-$HOME/.config}
real_data=${XDG_DATA_HOME:-$HOME/.local/share}
mkdir -p "$real_config/containers" "$real_data/containers"

rm -rf "$home"
mkdir -m 700 -p "$home" || die "cannot create $home"
mkdir -m 700 "$home/config" "$home/data" || die "cannot create $home/config"
ln -s "$real_config/containers" "$home/config/containers"
ln -s "$real_data/containers" "$home/data/containers"

binary=${BINARY:-}
if [ -z "$binary" ]; then
	os=$(node -p process.platform)
	arch=$(node -p process.arch)
	if [ "$os" = linux ]; then
		binary="$home/kanthord"
		extract=$("$engine" create "$image_name:$version") || die "cannot create a container from $image_name:$version"
		"$engine" cp "$extract:/usr/local/bin/kanthord" "$binary" || die "cannot copy the binary out of the image"
	else
		binary="$ROOT/dist/kanthord-$os-$arch"
	fi
fi
[ -x "$binary" ] || die "$binary is missing. Run make release-build, or set BINARY=path"
[ "$("$binary" --version)" = "$version" ] || die "the binary version differs from the image version $version"

port=$(node -e '
const server = require("node:net").createServer();
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
  server.close();
});
')
endpoint="http://127.0.0.1:$port"
config="$home/kanthord.yaml"
export XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data"
export XDG_STATE_HOME="$home/state" XDG_CACHE_HOME="$home/cache"
export KANTHORD_ENDPOINT="$endpoint"

"$binary" config init --config "$config" >/dev/null || die "config init failed"
sed -i.bak -e "s/31415/$port/g" -e "s|^\\( *container_image:\\) .*|\\1 $image_name|" "$config" && rm "$config.bak"
grep -q "^  container_image: $image_name\$" "$config" || die "worker.container_image is not $image_name in $config"
"$binary" config validate --config "$config" >/dev/null || die "config validate failed"

before=$(owned_names)
"$binary" serve --config "$config" >"$home/serve.log" 2>&1 &
server_pid=$!
ready=0
for _ in $(seq 1 60); do
	if curl -fsS -o /dev/null "$endpoint/api/openapi.yaml" 2>/dev/null; then
		ready=1
		break
	fi
	kill -0 "$server_pid" 2>/dev/null || break
	sleep 0.5
done
[ "$ready" = 1 ] || die "the server did not answer. See $home/serve.log"
log "server ready on $endpoint"

"$binary" auth jwt generate smoke --config "$config" --output "$home/token.yaml" >/dev/null ||
	die "auth jwt generate failed"
token=$(sed -n 's/^token: //p' "$home/token.yaml")
umask 077
cli() {
	KANTHORD_TOKEN="$token" "$binary" "$@"
}
cat >"$home/credential.json" <<'JSON'
{"name":"smoke-anthropic","platform":"anthropic","metadata":null,"secret":{"key":"smoke_anthropic_key"}}
JSON
cli llm credential create --file "$home/credential.json" >/dev/null ||
	die "llm credential create failed"
cat >"$home/enablement.json" <<'JSON'
{"agent_providers":[{"name":"default","provider":"anthropic","credential":"smoke-anthropic"}],"default_configuration":{"agent_provider":"default","model_identifier":"claude-sonnet-4-5","reasoning_effort":"off"},"fallback_configurations":[]}
JSON
cli agent enablement put swe@1 --file "$home/enablement.json" >/dev/null ||
	die "agent enablement put failed"
project_id=$(cli project create --name smoke-container | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).id') ||
	die "project create failed"
cat >"$home/bindings.json" <<'JSON'
{"version":1,"bindings":{"general":{"kind":"worker","config":{"worker":"coder@1","instance_count":1,"placement":"container","entries":[{"agent":"swe@1","agent_provider":"default","model_identifier":"claude-sonnet-4-5","reasoning_effort":"off"}]}}}}
JSON
cli project binding apply "$project_id" --file "$home/bindings.json" >/dev/null ||
	die "project binding apply failed"

slot_ready=0
for _ in $(seq 1 240); do
	if cli worker registration list --project "$project_id" |
		node -e '
const { items } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
process.exit(items.some((item) => item.placement === "container" && item.draining === false) ? 0 : 1);
'; then
		slot_ready=1
		break
	fi
	kill -0 "$server_pid" 2>/dev/null || break
	sleep 0.5
done
[ "$slot_ready" = 1 ] || die "no container slot registered in 120 s. See $home/serve.log"
log "container slot registered"

created=$(comm -13 <(printf '%s\n' "$before") <(owned_names) | head -n 1)
[ -n "$created" ] || die "no container with the label $owner_label exists"
owner=$("$engine" inspect --format "{{index .Config.Labels \"$owner_label\"}}" "$created") ||
	die "cannot read the owner label of $created"
[ -n "$owner" ] || die "$created holds an empty $owner_label label"
log "container $created holds owner $owner"

kill "$server_pid" && wait "$server_pid" 2>/dev/null
server_pid=
gone=0
for _ in $(seq 1 40); do
	if [ -z "$("$engine" ps --all --quiet --filter "label=$owner_label=$owner")" ]; then
		gone=1
		break
	fi
	sleep 0.5
done
[ "$gone" = 1 ] || die "a container with the owner label remained 20 s after the server stop"
log "no container with the owner label remains after the server stop"

log "container smoke passed for $binary"
