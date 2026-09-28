#!/bin/sh
# Build the exact public artifact; never upload docs/ directly.
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <new-output-directory>" >&2
  exit 1
fi
OUTPUT=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$1")
case "$OUTPUT/" in
  "$REPO/docs/"*)
    echo "Output directory must be outside the documentation source: $OUTPUT" >&2
    exit 1
    ;;
esac
if [ -e "$OUTPUT" ]; then
  echo "Output directory already exists: $OUTPUT" >&2
  exit 1
fi

test -f "$REPO/docs/CNAME"
test -f "$REPO/docs/README.md"
mkdir -p "$OUTPUT"
rsync -a --exclude='/brainstorm/' --exclude='/serve.json' "$REPO/docs/" "$OUTPUT/"
python3 "$REPO/scripts/docs/check.py" "$OUTPUT"
echo "Public documentation built at $OUTPUT"
