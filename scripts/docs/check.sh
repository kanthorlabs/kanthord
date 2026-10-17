#!/bin/sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
"$REPO/node_modules/.bin/prettier" --check "$REPO/docs" --log-level warn
python3 "$REPO/scripts/docs/check.py"
node --test "$REPO/scripts/docs/"*.test.mjs
python3 "$REPO/scripts/docs/check.test.py"
python3 "$REPO/scripts/docs/build.test.py"
CHECK=1 "$REPO/scripts/docs/tools.sh"
sh "$REPO/scripts/docs/prompts.sh"
sh "$REPO/scripts/docs/todoapp.sh"
