#!/bin/sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
DESIGN="$REPO/docs/brainstorm/assets/todoapp/plan"
FIXTURE="$REPO/engine/src/apps/server/__fixtures__/todoapp/plan"
status=0
for copy in "$DESIGN"/*.md; do
	name=$(basename -- "$copy")
	if ! cmp -s "$copy" "$FIXTURE/$name"; then
		echo "docs/brainstorm/assets/todoapp/plan/$name differs from engine/src/apps/server/__fixtures__/todoapp/plan/$name. Copy the design text."
		status=1
	fi
done
for source in "$FIXTURE"/*; do
	name=$(basename -- "$source")
	if [ ! -e "$DESIGN/$name" ]; then
		echo "engine/src/apps/server/__fixtures__/todoapp/plan/$name has no design text in docs/brainstorm/assets/todoapp/plan. Delete the engine copy."
		status=1
	fi
done
exit "$status"
