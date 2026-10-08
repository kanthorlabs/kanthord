#!/usr/bin/env bash
SCRIPT_NAME=release
. "$(dirname "$0")/../lib/common.sh"
require_command git
require_command node

RELEASE_REPOS="engine apps parent"
VERSION_PATTERN='^[1-9][0-9]*\.([1-9]|1[0-2])\.[1-9][0-9]*$'

remote_has_tag() {
	[ -n "$(git -C "$1" ls-remote --tags --refs origin "refs/tags/$2")" ]
}

month_counters() {
	git -C "$1" ls-remote --tags --refs origin "refs/tags/v$2.*" |
		sed -n "s|.*refs/tags/v$2\.\([1-9][0-9]*\)$|\1|p"
}

undo_release() {
	git -C "$1" tag -d "$tag" >/dev/null 2>&1
	git -C "$1" reset --quiet --hard origin/main
	die "$2. $(basename "$1") is back at origin/main, so make release can run again"
}

set_version() {
	node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const [path, version] = process.argv.slice(1);
const { name, version: _previous, ...rest } = JSON.parse(readFileSync(path, "utf8"));
writeFileSync(path, `${JSON.stringify({ name, version, ...rest }, null, 2)}\n`);
' "$1/package.json" "$2" || die "cannot set the version in $1/package.json"
}

for name in $RELEASE_REPOS; do
	dir=$(repo_dir "$name")
	branch=$(current_branch "$dir")
	[ "$branch" = main ] || die "$name must be on main, not ${branch:-detached}"
	[ -z "$(git -C "$dir" status --porcelain --ignore-submodules=all)" ] || die "$name has uncommitted changes"
	git -C "$dir" fetch --quiet origin main || die "$name fetch failed"
	[ "$(git -C "$dir" rev-parse HEAD)" = "$(git -C "$dir" rev-parse origin/main)" ] ||
		die "$name HEAD is not origin/main. Run make sync first"
done

if [ -n "${VERSION:-}" ]; then
	printf '%s' "$VERSION" | grep -qE "$VERSION_PATTERN" || die "VERSION $VERSION is not <YY>.<M>.<counter>"
else
	month=$(date -u +%y.%-m)
	highest=0
	for name in $RELEASE_REPOS; do
		for counter in $(month_counters "$(repo_dir "$name")" "$month"); do
			[ "$counter" -gt "$highest" ] && highest=$counter
		done
	done
	if [ "$highest" -gt 0 ] && ! remote_has_tag "$ROOT" "v$month.$highest"; then
		VERSION="$month.$highest"
		log "v$VERSION is incomplete in the root repository. Resuming it"
	else
		VERSION="$month.$((highest + 1))"
	fi
fi
tag="v$VERSION"

if [ "${DRY_RUN:-0}" = 1 ]; then
	log "the next release is $tag"
	exit 0
fi
confirm "release $tag: commit, tag and push engine, apps and the root repository?" || die "release cancelled"

for name in $RELEASE_REPOS; do
	dir=$(repo_dir "$name")
	if remote_has_tag "$dir" "$tag"; then
		log "$name already has $tag"
		continue
	fi
	set_version "$dir" "$VERSION"
	git -C "$dir" add -- package.json
	case "$name" in
	engine)
		(cd "$dir" && node src/main.ts gateway openapi >/dev/null) || undo_release "$dir" "cannot regenerate the OpenAPI contract"
		git -C "$dir" add -- static
		;;
	parent)
		git -C "$dir" add -- engine apps
		;;
	esac
	if ! git -C "$dir" diff --cached --quiet; then
		git -C "$dir" commit --quiet -m "chore(release): $VERSION" || undo_release "$dir" "$name commit failed"
	fi
	git -C "$dir" tag -a "$tag" -m "kanthord $VERSION" || undo_release "$dir" "$name tag failed"
	git -C "$dir" push --quiet --atomic origin main "refs/tags/$tag" || undo_release "$dir" "$name push failed"
	log "$name released $tag at $(git -C "$dir" rev-parse --short HEAD)"
done

log "released $tag. The release workflow builds the binaries from the root tag"
