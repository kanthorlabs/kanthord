#!/bin/sh
set -eu

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
	echo "Usage: gate.sh [file ...]" >&2
	exit 2
fi

ROOT=$(git rev-parse --show-toplevel)
PRETTIER="$ROOT/node_modules/.bin/prettier"
if [ ! -x "$PRETTIER" ]; then
	echo "gate: FAIL at prettier binary: run make bootstrap in $ROOT"
	exit 1
fi

cd "$ROOT"
LIST=$(mktemp)
LOG=$(mktemp)
trap 'rm -f "$LIST" "$LOG"' EXIT

if [ "$#" -gt 0 ]; then
	for f in "$@"; do
		printf '%s\n' "$f" >>"$LIST"
	done
else
	{
		git diff --name-only main -- docs
		git ls-files --others --exclude-standard -- docs
	} | sort -u >"$LIST"
fi

FILES=$(mktemp)
trap 'rm -f "$LIST" "$LOG" "$FILES"' EXIT
while IFS= read -r f; do
	case "$f" in
	*.md | *.html | *.json | *.mjs | *.js | *.css | *.yml | *.yaml)
		if [ -f "$f" ]; then
			printf '%s\n' "$f" >>"$FILES"
		fi
		;;
	esac
done <"$LIST"

COUNT=$(wc -l <"$FILES" | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then
	if ! xargs "$PRETTIER" --write --log-level warn <"$FILES" >"$LOG" 2>&1; then
		cat "$LOG" >&2
		echo "gate: FAIL at prettier --write"
		exit 1
	fi
fi

if sh -x scripts/docs/check.sh >"$LOG" 2>&1; then
	echo "gate: PASS ($COUNT file(s) run through prettier, scripts/docs/check.sh green)"
	exit 0
fi
cat "$LOG" >&2
STEP=$(grep '^+ ' "$LOG" | tail -n 1 | sed -e 's/^+ //' -e "s#$ROOT/##g")
echo "gate: FAIL at ${STEP:-scripts/docs/check.sh}"
exit 1
