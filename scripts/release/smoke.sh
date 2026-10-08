#!/usr/bin/env bash
SCRIPT_NAME=release-smoke
. "$(dirname "$0")/../lib/common.sh"
require_command node
require_command curl

os=$(node -p process.platform)
arch=$(node -p process.arch)
binary=${BINARY:-$ROOT/dist/kanthord-$os-$arch}
[ -x "$binary" ] || die "$binary is missing. Run make release-build"

home="$RUN_DIR/release/smoke"
config="$home/kanthord.yaml"
port=$(node -e '
const server = require("node:net").createServer();
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
  server.close();
});
')
endpoint="http://127.0.0.1:$port"
expected_version=$(node -p "require('$ENGINE_DIR/package.json').version")
server_pid=

cleanup() {
	[ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null && wait "$server_pid" 2>/dev/null
	return 0
}
trap cleanup EXIT

rm -rf "$home"
mkdir -m 700 -p "$home" || die "cannot create $home"
export HOME="$home"
export XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data"
export XDG_STATE_HOME="$home/state" XDG_CACHE_HOME="$home/cache"
export KANTHORD_ENDPOINT="$endpoint"

"$binary" --help >/dev/null || die "--help failed"
[ "$("$binary" --version)" = "$expected_version" ] || die "--version differs from the engine version $expected_version"
"$binary" config init --config "$config" >/dev/null || die "config init failed"
sed -i.bak "s/31415/$port/g" "$config" && rm "$config.bak"
"$binary" config validate --config "$config" >/dev/null || die "config validate failed"

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

version=$(curl -fsS "$endpoint/api/openapi.yaml" | sed -n 's/^  version: //p')
[ "$version" = "$expected_version" ] ||
	die "OpenAPI version $version differs from the engine version $expected_version"
curl -fsS -o /dev/null "$endpoint/api/openapi/gateway/verify.yaml" ||
	die "an OpenAPI service file is missing"
log "OpenAPI contract $version served"

index=$(curl -fsS "$endpoint/")
case "$index" in *'<div id="root">'*) ;; *) die "the dashboard index is missing" ;; esac
[ "$(curl -fsS "$endpoint/mission/unknown")" = "$index" ] ||
	die "a dashboard route did not answer the index"
script=$(printf '%s' "$index" | sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' | head -n 1)
[ -n "$script" ] || die "the dashboard index names no script"
curl -fsS -o /dev/null "$endpoint$script" || die "the dashboard script $script is missing"
log "dashboard served with $script"

"$binary" jwt generate smoke --config "$config" --output "$home/token.yaml" >/dev/null ||
	die "jwt generate failed"
token=$(sed -n 's/^token: //p' "$home/token.yaml")
curl -fsS -o /dev/null -H "Authorization: Bearer $token" "$endpoint/api/healthcheck" ||
	die "the authenticated healthcheck failed"
"$binary" gateway verify --token "$token" >/dev/null || die "gateway verify failed"
log "token accepted by the API and the CLI"

idempotency_key=$(node -e '
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let time = Date.now(), key = "";
for (let i = 0; i < 10; i++, time = Math.floor(time / 32)) key = alphabet[time % 32] + key;
for (const byte of require("node:crypto").randomBytes(16)) key += alphabet[byte % 32];
process.stdout.write(key);
')
login=$(curl -fsS -X POST "$endpoint/api/llm/credential/login" \
	-H "Authorization: Bearer $token" -H "Content-Type: application/json" \
	-H "Idempotency-Key: $idempotency_key" \
	-d '{"platform":"openai-codex","mode":"browser","name":"smoke-codex"}') ||
	die "the OpenAI Codex login did not start"
case "$login" in *'"address":"https://'*) ;; *) die "the OpenAI Codex login answered no address" ;; esac
log "OAuth flow loaded inside the binary"

log "smoke passed for $binary"
