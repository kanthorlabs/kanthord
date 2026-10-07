#!/bin/sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
if [ "${CHECK:-0}" = "1" ]; then
	node "$REPO/scripts/docs/workbench-tools.mjs" --check
else
	node "$REPO/scripts/docs/workbench-tools.mjs"
fi
