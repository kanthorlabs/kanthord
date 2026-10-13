#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
	echo "Usage: drift.sh" >&2
	exit 2
fi

ROOT=$(git rev-parse --show-toplevel)
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$ROOT"
FAILED=0

echo "== (a) pinned dependency versions that docs state differently =="
if ! python3 "$HERE/drift-versions.py"; then
	FAILED=1
fi

echo "== (b) links and heading anchors that do not resolve =="
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
if python3 scripts/docs/check.py >"$LOG" 2>&1; then
	tail -n 1 "$LOG"
else
	grep -E '^[A-Za-z]*Error|^ValueError|broken link|missing anchor|escapes|internal material' "$LOG" | sed "s#$ROOT/##g" || tail -n 5 "$LOG"
	FAILED=1
fi

echo "== (c) lines for manual review: limitation, not yet, Today =="
grep -rnE --include='*.md' 'Current limitation|not yet|Today ' docs/reference docs/explanation | cut -c1-200 || true

if [ "$FAILED" -ne 0 ]; then
	echo "drift: FAIL (see (a) and (b))"
	exit 1
fi
echo "drift: PASS for (a) and (b). Review the lines of (c) by hand."
