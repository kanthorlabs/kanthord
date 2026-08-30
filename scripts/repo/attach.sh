#!/usr/bin/env bash
# Put each submodule back on the main branch.
#
# git submodule update leaves a submodule on a detached HEAD. That is normal,
# but every sync target refuses a detached HEAD, because checking out a branch
# there can orphan a commit. This target does the checkout safely.
SCRIPT_NAME=repo-attach
. "$(dirname "$0")/../lib/common.sh"

for name in $SUBMODULES; do
	dir=$(repo_dir "$name")
	[ -d "$dir/.git" ] || [ -f "$dir/.git" ] || die "$name is not initialized. Run make repo-bootstrap"

	operation=$(in_progress "$dir") && die "$name has an unfinished $operation. Finish it or abort it first"

	branch=$(current_branch "$dir")
	if [ -n "$branch" ]; then
		log "$name is already on $branch"
		continue
	fi

	git -C "$dir" fetch --prune origin >/dev/null 2>&1 || die "$name fetch failed"
	git -C "$dir" rev-parse --verify --quiet origin/main >/dev/null || die "$name has no origin/main"

	head=$(git -C "$dir" rev-parse HEAD)
	# A detached commit that origin/main does not contain is unpublished work.
	# Checking out main would leave it reachable from no name at all.
	if ! git -C "$dir" merge-base --is-ancestor "$head" origin/main 2>/dev/null; then
		warn "$name is detached at $head, which origin/main does not contain."
		warn "$name name that commit yourself, so the checkout cannot lose it:"
		warn "  git -C $dir switch -c <branch>"
		exit 1
	fi

	git -C "$dir" checkout main >/dev/null 2>&1 || die "$name could not check out main"
	git -C "$dir" branch --set-upstream-to=origin/main main >/dev/null 2>&1 || true

	moved=$(git -C "$dir" rev-parse HEAD)
	if [ "$moved" = "$head" ]; then
		log "$name attached to main at $(git -C "$dir" rev-parse --short HEAD)"
	else
		log "$name attached to main, which moved it from $(printf '%.7s' "$head") to $(git -C "$dir" rev-parse --short HEAD)"
		log "$name the parent pointer is now stale. Run make sync-all to settle it"
	fi
done
