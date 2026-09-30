#!/usr/bin/env bash
# Create a worktree that is ready to work in.
#
#   REPO=engine|apps|webhook BRANCH=name scripts/tree/new.sh
#
# A new branch always starts from the freshly fetched origin/main. The tree
# then gets the ignored local files listed in .worktreeinclude, links the
# parent repository directories it may reference, installs its own dependencies,
# and, for the daemon, creates its own configuration and home.
SCRIPT_NAME=tree-new
. "$(dirname "$0")/../lib/common.sh"

REPO=${REPO:-}
BRANCH=${BRANCH:-}
[ -n "$REPO" ] || die "pass REPO=engine, REPO=apps, or REPO=webhook"
[ -n "$BRANCH" ] || die "pass BRANCH=name"
case "$REPO" in engine | apps | webhook) ;; *) die "REPO must be engine, apps, or webhook" ;; esac

source_dir=$(repo_dir "$REPO")
target="$WORKTREE_DIR/$REPO/$BRANCH"
[ -e "$target" ] && die "$target already exists"

# These live in the parent repository, beside the normal engine and apps
# checkouts. A linked worktree is nested more deeply, so recreate that sibling
# relationship beside it. Keep this list explicit as more shared directories
# are introduced.
PARENT_DIRS=""
case "$REPO" in engine | apps) PARENT_DIRS="docs" ;; esac
for directory in $PARENT_DIRS; do
	[ -d "$ROOT/$directory" ] || die "parent directory $ROOT/$directory does not exist"
done

# The root identity is the only one to set. It is applied to all submodules.
author_report=$("$ROOT/scripts/git/author.sh" 2>&1) || {
	printf '%s\n' "$author_report" >&2
	exit 1
}

git -C "$source_dir" fetch --prune origin || die "fetch failed"
git -C "$source_dir" rev-parse --verify --quiet origin/main >/dev/null || die "$REPO has no origin/main"
mkdir -p "$(dirname "$target")"

if git -C "$source_dir" show-ref --verify --quiet "refs/heads/$BRANCH"; then
	git -C "$source_dir" worktree add "$target" "$BRANCH" || die "worktree add failed"
	log "reused the local branch $BRANCH"
elif git -C "$source_dir" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
	git -C "$source_dir" worktree add --track -b "$BRANCH" "$target" "origin/$BRANCH" || die "worktree add failed"
	log "tracked origin/$BRANCH"
else
	git -C "$source_dir" worktree add --no-track -b "$BRANCH" "$target" origin/main || die "worktree add failed"
	log "branched $BRANCH from the fetched origin/main"
fi

# Engine and apps can continue to resolve ../docs from their worktrees.
# Webhook is standalone and receives no parent links.
# Multiple branches with the same prefix share this link.
target_parent=$(dirname "$target")
for directory in $PARENT_DIRS; do
	source="$ROOT/$directory"
	link="$target_parent/$directory"
	if [ -L "$link" ]; then
		[ "$link" -ef "$source" ] || die "$link does not point to $source"
		continue
	fi
	[ ! -e "$link" ] || die "$link exists and is not a symlink"
	ln -s "$source" "$link" || die "could not link $link to $source"
	log "linked parent $directory"
done

# Ignored local files the checkout cannot carry, such as .env.
if [ -f "$source_dir/.worktreeinclude" ]; then
	# The entries are globs. They must expand inside the source checkout.
	cd "$source_dir" || die "$source_dir does not exist"
	while IFS= read -r entry; do
		case "$entry" in '' | \#* | '!'*) continue ;; esac
		for item in $entry; do
			[ -e "$item" ] || continue
			git check-ignore -q -- "$item" || continue
			mkdir -p "$target/$(dirname "$item")" || die "could not create $(dirname "$item")"
			cp -R "$item" "$target/$item" || die "could not copy $item"
			log "copied $item"
		done
	done <.worktreeinclude
	cd "$ROOT" || die "$ROOT does not exist"
fi

if [ -f "$target/.envrc" ] && command -v direnv >/dev/null; then
	direnv allow "$target" || die "direnv allow failed"
	log "allowed .envrc"
fi

case "$REPO" in
engine) TARGET="$target" "$ROOT/scripts/engine/install.sh" || die "engine setup failed" ;;
apps) TARGET="$target" "$ROOT/scripts/app/install.sh" || die "apps setup failed" ;;
webhook) log "webhook is documentation-only; no runtime setup is needed" ;;
esac

log "ready at $target, as $(git -C "$source_dir" config --local user.name) <$(git -C "$source_dir" config --local user.email)>"
if [ -t 1 ] && [ "${SHELL_IN:-1}" = "1" ]; then
	log "opening a shell there. Press Ctrl-D to come back"
	cd "$target" && exec "${SHELL:-/bin/sh}"
fi
