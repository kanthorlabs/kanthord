#!/usr/bin/env bash
# List every worktree under .worktree, with its state.
SCRIPT_NAME=tree-list
. "$(dirname "$0")/../lib/common.sh"

printf '%-8s %-40s %-9s %-10s %s\n' REPO BRANCH TREE MERGED PR
for repo in $SUBMODULES; do
	dir=$(repo_dir "$repo")
	git -C "$dir" worktree list --porcelain |
		awk '/^worktree /{tree=substr($0,10)} /^branch /{print tree"\t"substr($0,8)}' |
		while IFS="$(printf '\t')" read -r tree ref; do
			case "$tree" in "$WORKTREE_DIR"/*) ;; *) continue ;; esac
			branch=${ref#refs/heads/}
			state="clean"
			[ -n "$(git -C "$tree" status --porcelain)" ] && state="dirty"
			merged="no"
			git -C "$dir" merge-base --is-ancestor "$branch" origin/main 2>/dev/null && merged="yes"
			pr="?"
			count=$(pr_count "$dir" "$branch")
			[ -n "$count" ] && { [ "$count" = "0" ] && pr="none" || pr="$count"; }
			printf '%-8s %-40s %-9s %-10s %s\n' "$repo" "$branch" "$state" "$merged" "$pr"
		done
done
