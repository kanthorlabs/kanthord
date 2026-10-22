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
worker_pid=

cleanup() {
	[ -n "$worker_pid" ] && kill "$worker_pid" 2>/dev/null && wait "$worker_pid" 2>/dev/null
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
for tool in fd rg; do
	"$XDG_STATE_HOME/kanthord/pi/bin/$tool" --version >/dev/null ||
		die "serve did not install a working $tool in $XDG_STATE_HOME/kanthord/pi/bin. See $home/serve.log"
done
log "pi tools installed by serve"

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
script=$(printf '%s' "$index" | sed -n 's/.*src="\.\{0,1\}\(\/assets\/[^"]*\.js\)".*/\1/p' | head -n 1)
[ -n "$script" ] || die "the dashboard index names no script"
curl -fsS -o /dev/null "$endpoint$script" || die "the dashboard script $script is missing"
log "dashboard served with $script"

"$binary" auth jwt generate smoke --config "$config" --output "$home/token.yaml" >/dev/null ||
	die "auth jwt generate failed"
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
process.stdout.write(`idempotency_key_${key}`);
')
login=$(curl -fsS -X POST "$endpoint/api/llm/credential/login" \
	-H "Authorization: Bearer $token" -H "Content-Type: application/json" \
	-H "Idempotency-Key: $idempotency_key" \
	-d '{"platform":"openai-codex","mode":"browser","name":"smoke-codex"}') ||
	die "the OpenAI Codex login did not start"
case "$login" in *'"address":"https://'*) ;; *) die "the OpenAI Codex login answered no address" ;; esac
log "OAuth flow loaded inside the binary"

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
project_id=$(cli project create --name smoke-slot | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).id') ||
	die "project create failed"
cat >"$home/bindings.json" <<'JSON'
{"version":1,"bindings":{"general":{"kind":"worker","config":{"worker":"coder@1","instance_count":1,"placement":"server","entries":[{"agent":"swe@1","agent_provider":"default","model_identifier":"claude-sonnet-4-5","reasoning_effort":"off"}]}}}}
JSON
cli project binding apply "$project_id" --file "$home/bindings.json" >/dev/null ||
	die "project binding apply failed"
slot_ready=0
for _ in $(seq 1 60); do
	if cli worker registration list --project "$project_id" |
		node -e '
const { items } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
process.exit(items.some((item) => item.placement === "server" && item.draining === false) ? 0 : 1);
'; then
		slot_ready=1
		break
	fi
	sleep 0.5
done
[ "$slot_ready" = 1 ] || die "no slot thread registered. See $home/serve.log"
set -- "$XDG_STATE_HOME"/kanthord/workers/*/state/kanthord/kanthord.log
[ -f "$1" ] || die "the slot thread wrote no log under $XDG_STATE_HOME/kanthord/workers"
log "slot thread started inside the binary"

if "$binary" serve worker --instance smoke >"$home/worker-absent.log" 2>&1; then
	die "serve worker succeeded without an instance configuration. See $home/worker-absent.log"
fi
grep -q '^worker\.start\.instance_config_absent:' "$home/worker-absent.log" ||
	die "serve worker did not refuse the absent instance configuration. See $home/worker-absent.log"
cli worker instance create smoke --worker coder@1 --output >/dev/null ||
	die "worker instance create failed"
[ -f "$XDG_CONFIG_HOME/kanthord/workers/smoke.yaml" ] ||
	die "worker instance create wrote no instance file in $XDG_CONFIG_HOME/kanthord/workers"
instance_project=$(cli project create --name smoke-instance | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).id') ||
	die "project create failed"
cat >"$home/instance-bindings.json" <<'JSON'
{"version":1,"bindings":{"laptop":{"kind":"worker","config":{"worker":"coder@1","placement":"worker","worker_instances":["smoke"]}}}}
JSON
cli project binding apply "$instance_project" --file "$home/instance-bindings.json" >/dev/null ||
	die "project binding apply of the instance binding failed"
cli project pause "$instance_project" >/dev/null || die "project pause failed"
"$binary" serve worker --instance smoke >"$home/worker.log" 2>&1 &
worker_pid=$!
instance_ready=0
for _ in $(seq 1 60); do
	if cli worker registration list --project "$instance_project" |
		node -e '
const { items } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
process.exit(items.some((item) => item.instance === "smoke" && item.registered) ? 0 : 1);
'; then
		instance_ready=1
		break
	fi
	kill -0 "$worker_pid" 2>/dev/null || break
	sleep 0.5
done
[ "$instance_ready" = 1 ] || die "the worker instance did not register. See $home/worker.log"
kill "$worker_pid"
wait "$worker_pid" || die "serve worker did not exit 0 at SIGTERM. See $home/worker.log"
worker_pid=
log "worker instance registered and stopped"
for tool in fd rg; do
	"$XDG_DATA_HOME/kanthord/workers/smoke/pi/bin/$tool" --version >/dev/null ||
		die "serve worker did not install a working $tool in $XDG_DATA_HOME/kanthord/workers/smoke/pi/bin. See $home/worker.log"
done
log "pi tools installed by serve worker"

log "smoke passed for $binary"
