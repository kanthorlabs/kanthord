#!/usr/bin/env bash
SCRIPT_NAME=eval
. "$(dirname "$0")/../lib/common.sh"
require_command node

[ -n "${AGENT:-}" ] || die "AGENT is required, for example make eval AGENT=swe@1"
REPEAT=${REPEAT:-3}
CASES=${CASES:-}
EVAL_TIMEOUT_MS=${EVAL_TIMEOUT_MS:-600000}
PRETTIER="$ROOT/node_modules/.bin/prettier"

MAIN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")
ENV_FILE="$MAIN/engine/.env.eval"

env_file_value() {
	LINE=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1) || true
	VALUE=${LINE#"$1="}
	VALUE=$(printf '%s' "$VALUE" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
	case $VALUE in
	\"*) VALUE=$(printf '%s' "$VALUE" | sed -E 's/^"([^"]*)".*$/\1/') ;;
	\'*) VALUE=$(printf '%s' "$VALUE" | sed -E "s/^'([^']*)'.*\$/\\1/") ;;
	\#*) VALUE= ;;
	esac
	printf '%s' "$VALUE"
}

[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; it must hold exactly one of EVAL_ANTHROPIC_API_KEY and EVAL_ANTHROPIC_AUTH_FILE"
KEY_VALUE=$(env_file_value EVAL_ANTHROPIC_API_KEY | tr -d '[:space:]')
AUTH_FILE_VALUE=$(env_file_value EVAL_ANTHROPIC_AUTH_FILE)
AUTH_FILE_VALUE=$(printf '%s' "${AUTH_FILE_VALUE%%[[:space:]]#*}" | sed -E 's/[[:space:]]+$//')
if [ -n "$KEY_VALUE" ] && [ -n "$AUTH_FILE_VALUE" ]; then
	die "$ENV_FILE holds both EVAL_ANTHROPIC_API_KEY and EVAL_ANTHROPIC_AUTH_FILE; keep exactly one"
fi
if [ -z "$KEY_VALUE" ] && [ -z "$AUTH_FILE_VALUE" ]; then
	die "$ENV_FILE holds no value for EVAL_ANTHROPIC_API_KEY or EVAL_ANTHROPIC_AUTH_FILE; keep exactly one"
fi
if [ -n "$AUTH_FILE_VALUE" ]; then
	case $AUTH_FILE_VALUE in
	/*) ;;
	*) die "EVAL_ANTHROPIC_AUTH_FILE is not an absolute path: $AUTH_FILE_VALUE" ;;
	esac
	[ -f "$AUTH_FILE_VALUE" ] || die "EVAL_ANTHROPIC_AUTH_FILE does not exist: $AUTH_FILE_VALUE"
fi
unset LINE VALUE KEY_VALUE AUTH_FILE_VALUE EVAL_ANTHROPIC_API_KEY EVAL_ANTHROPIC_AUTH_FILE
[ -x "$PRETTIER" ] || die "$PRETTIER is missing; run scripts/repo/install.sh"

HISTORY="$ROOT/docs/reference/agent/evals/$AGENT.json"
RUN=$(date -u +%Y%m%d-%H%M%S)
OUTPUT="$RUN_DIR/eval/$AGENT/$RUN.json"
ENTRY="${OUTPUT%.json}.entry.json"
mkdir -p "$(dirname "$OUTPUT")" "$(dirname "$HISTORY")"

export EVAL_AGENT=$AGENT EVAL_REPEAT=$REPEAT EVAL_OUTPUT=$OUTPUT EVAL_HISTORY=$HISTORY

engine_eval() {
	(cd "$ENGINE_DIR" && EVAL_CASES=$1 EVAL_RERUN=$2 node --env-file="$ENV_FILE" --test \
		--test-timeout="$EVAL_TIMEOUT_MS" src/eval/run.eval.ts)
}

regressed_cases() {
	node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).comparison.regressed.join(","))' "$OUTPUT"
}

write_history() {
	node -e '
const fs = require("fs");
const [history, entry] = process.argv.slice(1);
const list = fs.existsSync(history) ? JSON.parse(fs.readFileSync(history, "utf8")) : [];
list.push(JSON.parse(fs.readFileSync(entry, "utf8")));
fs.writeFileSync(history, JSON.stringify(list));
' "$HISTORY" "$ENTRY" || exit 1
	"$PRETTIER" --write "$HISTORY" >/dev/null || exit 1
	(cd "$ROOT" && node scripts/eval/render.mjs && "$PRETTIER" --write docs/reference/agent/evals.html >/dev/null) || exit 1
}

engine_eval "$CASES" 0 || exit $?

REGRESSED=$(regressed_cases) || exit 1
if [ -n "$REGRESSED" ]; then
	log "rerun of the regressed cases: $REGRESSED"
	engine_eval "$REGRESSED" 1 || exit $?
	REGRESSED=$(regressed_cases) || exit 1
fi

if [ ! -f "$HISTORY" ] || [ "${ACCEPT:-}" = 1 ]; then
	write_history
fi

log "run file $OUTPUT"
[ -z "$REGRESSED" ] || exit 1
