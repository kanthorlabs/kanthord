#!/bin/sh
set -eu

REPO=$(git rev-parse --show-toplevel)
MANIFEST="$REPO/docs-authoring/manifest.yaml"
ENGINE_DIR="$REPO/engine"
DOCS_DIR="$REPO/docs"

ptr_issues=0
cite_issues=0
stale_issues=0
link_issues=0
claim_issues=0
inv_issues=0

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: manifest not found at $MANIFEST"
  exit 1
fi

# ── 1. Pointer drift ──────────────────────────────────────────────────────────
echo "── 1. Pointer drift ─────────────────────────────────────────────────────"
PINNED=$(awk '/engine-pinned:/{print $2; exit}' "$MANIFEST" | tr -d '"')
# rev-parse HEAD:engine gives the commit the parent repo records for the submodule,
# which is distinct from the checked-out HEAD when the engine has been advanced locally.
POINTER=$(git -C "$REPO" rev-parse HEAD:engine 2>/dev/null | cut -c1-7 || echo "not-found")

if [ -d "$ENGINE_DIR" ]; then
  HEAD_FULL=$(git -C "$ENGINE_DIR" rev-parse HEAD 2>/dev/null || echo "")
  HEAD=$(echo "$HEAD_FULL" | cut -c1-7)
else
  HEAD_FULL=""
  HEAD="not-checked-out"
fi

MANIFEST_POINTER=$(awk '/engine-pointer:/{print $2; exit}' "$MANIFEST" | tr -d '"')
if [ -n "$MANIFEST_POINTER" ] && [ "$MANIFEST_POINTER" != "$POINTER" ]; then
  echo "  DRIFT: manifest engine-pointer field ($MANIFEST_POINTER) != live submodule pointer ($POINTER)"
  ptr_issues=$((ptr_issues + 1))
fi

if [ "$PINNED" = "$POINTER" ] && [ "$PINNED" = "$HEAD" ]; then
  echo "  OK: manifest=$PINNED  pointer=$POINTER  head=$HEAD"
else
  if [ "$PINNED" != "$POINTER" ]; then
    echo "  DRIFT: manifest engine-pinned ($PINNED) != submodule pointer ($POINTER)"
    ptr_issues=$((ptr_issues + 1))
  fi
  if [ "$PINNED" != "$HEAD" ]; then
    echo "  DRIFT: manifest engine-pinned ($PINNED) != engine HEAD ($HEAD)"
    ptr_issues=$((ptr_issues + 1))
  fi
  if [ "$POINTER" != "$HEAD" ]; then
    echo "  DRIFT: submodule pointer ($POINTER) != engine HEAD ($HEAD)"
    ptr_issues=$((ptr_issues + 1))
  fi
fi

# ── 2. Unresolvable citations ─────────────────────────────────────────────────
echo ""
echo "── 2. Unresolvable citations ────────────────────────────────────────────"
cite_ok=1

# Extract claim:path pairs. Strip line-number suffixes from paths.
# AWK tracks the current claim (^  C\d\d:) and mode (sources/dep-surfaces).
CITE_DATA=$(awk '
  /^  C[0-9][0-9]:/ { cur = substr($1, 1, length($1) - 1); mode = "" }
  /^    sources:/            { mode = "src"; next }
  /^    dependency-surfaces:/ { mode = ""; next }
  /^    owner:|^    status:|^    absence-note:/ { mode = ""; next }
  mode == "src" && /^      - / {
    val = $2
    gsub(/:.*$/, "", val)
    print cur ":" val
  }
' "$MANIFEST")

while IFS=: read -r claim path; do
  [ -z "$claim" ] && continue
  if [ ! -f "$REPO/$path" ]; then
    echo "  MISSING: $path  (cited by $claim)"
    cite_issues=$((cite_issues + 1))
    cite_ok=0
  fi
done << EOF
$CITE_DATA
EOF
[ "$cite_ok" = "1" ] && echo "  OK: all cited source paths resolve"

# ── 3. Stale-by-diff claims ───────────────────────────────────────────────────
echo ""
echo "── 3. Stale-by-diff (review trigger — not proof claim is wrong) ─────────"
if [ -z "$HEAD_FULL" ]; then
  echo "  SKIP: engine directory not found or not a git repo"
else
  stale_ok=1
  # Verify the pinned commit is reachable before running any diffs.
  # A failure here means the manifest pin is stale relative to this checkout.
  if ! git -C "$ENGINE_DIR" cat-file -e "${PINNED}^{commit}" 2>/dev/null; then
    echo "  ERROR: engine-pinned commit ($PINNED) not found in engine repo; stale-diff skipped"
    stale_issues=$((stale_issues + 1))
    stale_ok=0
  else
    # Extract claim surface pairs (one per line, space-separated).
    DEP_DATA=$(awk '
      /^  C[0-9][0-9]:/ { cur = substr($1, 1, length($1) - 1); mode = "" }
      /^    dependency-surfaces:/ { mode = "dep"; next }
      /^    sources:|^    owner:|^    status:|^    absence-note:/ { mode = ""; next }
      mode == "dep" && /^      - / { print cur " " $2 }
    ' "$MANIFEST")

    while IFS=' ' read -r claim surface; do
      [ -z "$claim" ] && continue
      # Strip the leading engine/ prefix to get a path relative to the engine repo.
      rel="${surface#engine/}"
      changed=$(git -C "$ENGINE_DIR" diff --name-only "${PINNED}" "${HEAD_FULL}" -- "$rel" 2>/dev/null || true)
      if [ -n "$changed" ]; then
        echo "  REVIEW: $claim  surface: $surface  changed since $PINNED"
        stale_issues=$((stale_issues + 1))
        stale_ok=0
      fi
    done << EOF
$DEP_DATA
EOF
    [ "$stale_ok" = "1" ] && echo "  OK: no dependency surfaces changed since $PINNED"
  fi
fi

# ── 4. Broken cross-links ─────────────────────────────────────────────────────
echo ""
echo "── 4. Broken cross-links ────────────────────────────────────────────────"
link_ok=1

# Extract [text](target.md) or [text](target.md#anchor) targets from docs/*.md.
LINK_DATA=$(sed -n 's/.*\](\([^)]*\.md\)[^)]*).*/\1/p' "$DOCS_DIR"/*.md 2>/dev/null \
  | sed 's/#.*//' | sort -u || true)

while IFS= read -r target; do
  [ -z "$target" ] && continue
  if [ ! -f "$DOCS_DIR/$target" ]; then
    echo "  BROKEN: $target"
    link_issues=$((link_issues + 1))
    link_ok=0
  fi
done << EOF
$LINK_DATA
EOF
[ "$link_ok" = "1" ] && echo "  OK: all cross-links resolve"

# ── 5. Undefined claim references ─────────────────────────────────────────────
echo ""
echo "── 5. Undefined claim references ────────────────────────────────────────"
claim_ok=1

CLAIM_IDS=$(grep -h 'evidences:' "$DOCS_DIR"/*.md 2>/dev/null \
  | grep -oE 'C[0-9]+' | sort -u || true)

while IFS= read -r cid; do
  [ -z "$cid" ] && continue
  # Check for the HTML anchor <a id="Cnn"> in overview.md.
  if ! grep -q "id=\"$cid\"" "$DOCS_DIR/overview.md" 2>/dev/null; then
    echo "  UNDEFINED: $cid not defined in overview.md"
    claim_issues=$((claim_issues + 1))
    claim_ok=0
  fi
done << EOF
$CLAIM_IDS
EOF
[ "$claim_ok" = "1" ] && echo "  OK: all evidenced claim ids are defined in overview.md"

# ── 6. Incomplete written pages ───────────────────────────────────────────────
echo ""
echo "── 6. Incomplete written pages ──────────────────────────────────────────"
inv_ok=1

# Report any destination whose status is written or verified while its
# coverage-inventory contains a pending item.
INV_DATA=$(awk '
  /^ {2}[a-z][^ ]*\.md:/ {
    dest = substr($1, 1, length($1) - 1)
    status = ""
    mode = ""
  }
  /^    status:/ { status = $2 }
  /^    coverage-inventory:/ { mode = "inv"; next }
  /^    [a-z]/ && !/coverage-inventory:/ { mode = "" }
  mode == "inv" && /disposition: pending/ &&
      (status == "written" || status == "verified") {
    print dest ":" status
  }
' "$MANIFEST")

while IFS=: read -r dest st; do
  [ -z "$dest" ] && continue
  echo "  INCOMPLETE: $dest  status=$st  has pending inventory items"
  inv_issues=$((inv_issues + 1))
  inv_ok=0
done << EOF
$INV_DATA
EOF
[ "$inv_ok" = "1" ] && echo "  OK: no written pages have pending inventory items"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "── Summary ──────────────────────────────────────────────────────────────"
total=$((ptr_issues + cite_issues + stale_issues + link_issues + claim_issues + inv_issues))
printf "  pointer-drift=%d  unresolvable=%d  stale-claims=%d  broken-links=%d  undefined-claims=%d  incomplete-pages=%d  TOTAL=%d\n" \
  "$ptr_issues" "$cite_issues" "$stale_issues" "$link_issues" "$claim_issues" "$inv_issues" "$total"

[ "$total" -gt 0 ] && exit 1 || exit 0
