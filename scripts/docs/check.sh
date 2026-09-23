#!/bin/sh
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
python3 "$REPO/scripts/docs/check.py"
node --test "$REPO/scripts/docs/navigation.test.mjs"
python3 "$REPO/scripts/docs/build.test.py"
