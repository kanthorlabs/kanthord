#!/bin/sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
status=0
for copy in "$REPO"/docs/brainstorm/assets/prompt/*.md; do
	name=$(basename -- "$copy")
	source="$REPO/engine/static/prompt/$name"
	if ! cmp -s "$copy" "$source"; then
		echo "docs/brainstorm/assets/prompt/$name differs from engine/static/prompt/$name. Copy the engine text."
		status=1
	fi
done
exit "$status"
