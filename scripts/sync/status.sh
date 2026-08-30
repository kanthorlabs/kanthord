#!/usr/bin/env bash
# Drift table for the parent and both submodules. Writes nothing but the
# remote-tracking refs that a fetch updates. NOFETCH=1 reads the cached refs.
SCRIPT_NAME=sync-status
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"

printf '%-8s %-10s %-14s %s\n' REPO BRANCH DRIFT TREE
for name in parent $SUBMODULES; do
	dir=$(repo_dir "$name")
	branch=$(current_branch "$dir")
	tree="clean"
	is_dirty "$dir" && tree="dirty"
	[ -n "$(untracked_files "$dir")" ] && tree="$tree+untracked"
	operation=$(in_progress "$dir") && tree="$operation in progress"

	if ! preflight_output=$(preflight_repo "$name" 2>&1); then
		printf '%-8s %-10s %-14s %s\n' "$name" "${branch:-detached}" "blocked" "$tree"
		printf '  %s\n' "$preflight_output"
		continue
	fi
	printf '%-8s %-10s %-14s %s\n' "$name" "${branch:-detached}" "$(drift_state "$name")" "$tree"
done

for name in $SUBMODULES; do
	recorded=$(git -C "$ROOT" rev-parse --verify --quiet "HEAD:$name") || continue
	actual=$(git -C "$(repo_dir "$name")" rev-parse HEAD)
	[ "$recorded" = "$actual" ] && continue
	printf 'pointer %s: parent records %s, checkout is %s\n' \
		"$name" "$(git -C "$(repo_dir "$name")" rev-parse --short "$recorded" 2>/dev/null || printf '%.8s' "$recorded")" \
		"$(git -C "$(repo_dir "$name")" rev-parse --short "$actual")"
done
