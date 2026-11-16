#!/bin/sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
COPIES="$REPO/docs/brainstorm/assets/prompt"
status=0
for copy in "$COPIES"/*.md "$COPIES"/template/*.md; do
	[ -e "$copy" ] || continue
	name=${copy#"$COPIES"/}
	source="$REPO/engine/static/prompt/$name"
	if ! cmp -s "$copy" "$source"; then
		echo "docs/brainstorm/assets/prompt/$name differs from engine/static/prompt/$name. Copy the engine text."
		status=1
	fi
done
exit "$status"
