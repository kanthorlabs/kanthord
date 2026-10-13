#!/bin/sh
set -eu

USAGE="Usage: preflight.sh [--dry-run] <name>"

DRY=0
if [ "${1:-}" = "--dry-run" ]; then
	DRY=1
	shift
fi
if [ "$#" -ne 1 ]; then
	echo "$USAGE" >&2
	exit 2
fi
NAME=$1
case "$NAME" in
*[!a-z0-9-]* | "" | -*)
	echo "preflight: the name must use lowercase letters, digits and hyphens" >&2
	exit 2
	;;
esac

COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
MAIN=$(dirname "$COMMON")
WORKTREE="$MAIN/.dev/$NAME"
BRANCH="docs/$NAME"
DIRTY=0

report() {
	dir=$1
	label=$2
	git -C "$dir" fetch origin --quiet
	status=$(git -C "$dir" status --short)
	if git -C "$dir" rev-parse --verify --quiet main >/dev/null; then
		head=main
	else
		head=HEAD
	fi
	ahead=$(git -C "$dir" rev-list --count "origin/main..$head")
	if [ -n "$status" ]; then
		DIRTY=1
		echo "DIRTY $label: uncommitted work"
		echo "$status" | sed 's/^/  /'
	fi
	if [ "$ahead" -gt 0 ]; then
		DIRTY=1
		echo "DIRTY $label: $ahead commit(s) of $head not on origin/main"
	fi
	if [ -z "$status" ] && [ "$ahead" -eq 0 ]; then
		echo "CLEAN $label"
	fi
}

report "$MAIN" "root"
for sub in $(git -C "$MAIN" submodule --quiet foreach --recursive 'echo $displaypath'); do
	if [ -e "$MAIN/$sub/.git" ]; then
		report "$MAIN/$sub" "$sub"
	fi
done

if [ "$DIRTY" -ne 0 ]; then
	echo "preflight: FAIL. Dirty work exists. Advise Ulrich to commit, stash or discard it. Do not start." >&2
	exit 1
fi

if [ "$DRY" -eq 1 ]; then
	echo "preflight: dry run, no change made. Worktree would be $WORKTREE on $BRANCH"
	exit 0
fi

git -C "$MAIN" pull --ff-only --quiet
git -C "$MAIN" submodule foreach --recursive --quiet 'git checkout --quiet main && git pull --ff-only --quiet origin main'

NEED_BOOTSTRAP=0
if [ -d "$WORKTREE" ]; then
	echo "preflight: worktree exists, skip create"
	if [ ! -e "$WORKTREE/node_modules/.bin/prettier" ]; then
		NEED_BOOTSTRAP=1
	fi
else
	git -C "$MAIN" worktree add -b "$BRANCH" "$WORKTREE" main
	NEED_BOOTSTRAP=1
fi

if [ "$NEED_BOOTSTRAP" -eq 1 ]; then
	make -C "$WORKTREE" bootstrap
fi

echo "preflight: PASS"
echo "$WORKTREE"
