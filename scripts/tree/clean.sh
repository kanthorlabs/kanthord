#!/usr/bin/env bash
# Remove worktrees that are finished.
#
#   scripts/tree/clean.sh                    report only
#   APPLY=1 scripts/tree/clean.sh            remove the merged and the gone
#   FORCE=1 BRANCH=name scripts/tree/clean.sh   remove one branch that has no
#                                               pull request and is not merged
#
# A dirty tree is always kept, unless DIRTY=1 says otherwise.
SCRIPT_NAME=tree-clean
. "$(dirname "$0")/../lib/common.sh"

APPLY=${APPLY:-0}
FORCE=${FORCE:-0}
BRANCH=${BRANCH:-}
DIRTY=${DIRTY:-0}

[ "$FORCE" = "1" ] && [ -z "$BRANCH" ] && die "FORCE=1 needs BRANCH=name. It never sweeps unmerged work"
[ "$FORCE" = "1" ] && APPLY=1

mkdir -p "$RUN_DIR"

removed=0
kept=0

remove_tree() {
	git -C "$1" worktree remove --force "$2" || die "could not remove $2"
	git -C "$1" branch -D "$3" >/dev/null || die "could not delete the branch $3"
	removed=$((removed + 1))
}

for repo in $SUBMODULES; do
	dir=$(repo_dir "$repo")
	git -C "$dir" fetch --prune origin >/dev/null 2>&1 || die "fetch failed for $repo"

	git -C "$dir" worktree list --porcelain |
		awk '/^worktree /{tree=substr($0,10)} /^branch /{print tree"\t"substr($0,8)}' >"$RUN_DIR/.trees.$repo"

	while IFS="$(printf '\t')" read -r tree ref; do
		case "$tree" in "$WORKTREE_DIR"/*) ;; *) continue ;; esac
		branch=${ref#refs/heads/}
		[ -n "$BRANCH" ] && [ "$branch" != "$BRANCH" ] && continue

		if [ -n "$(git -C "$tree" status --porcelain)" ] && [ "$DIRTY" != "1" ]; then
			log "keep   $repo $branch. It has uncommitted changes. Pass DIRTY=1 to override"
			kept=$((kept + 1))
			continue
		fi

		reason=""
		if git -C "$dir" merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
			reason="merged into origin/main"
		else
			upstream=$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name "$branch@{upstream}" 2>/dev/null)
			if [ -n "$upstream" ] && ! git -C "$dir" rev-parse --verify --quiet "$upstream" >/dev/null; then
				reason="abandoned. Its upstream $upstream is gone"
			fi
		fi

		if [ -z "$reason" ] && [ "$FORCE" = "1" ]; then
			count=$(pr_count "$dir" "$branch")
			if [ -z "$count" ] && [ "${NO_PR:-0}" = "1" ]; then
				count=0
				log "$repo $branch: NO_PR=1 asserts there is no pull request"
			fi
			if [ -z "$count" ]; then
				log "keep   $repo $branch. gh cannot read $(repo_slug "$dir")."
				log "       Authorize the account that owns it, or pass NO_PR=1 once you checked by hand"
				kept=$((kept + 1))
				continue
			fi
			if [ "$count" != "0" ]; then
				log "keep   $repo $branch. It has $count pull request(s). FORCE only removes branches with none"
				kept=$((kept + 1))
				continue
			fi
			reason="unmerged, and it has no pull request"
		fi

		if [ -z "$reason" ]; then
			log "keep   $repo $branch. It is not merged. Pass FORCE=1 BRANCH=$branch to drop it"
			kept=$((kept + 1))
			continue
		fi

		if [ "$APPLY" = "1" ]; then
			remove_tree "$dir" "$tree" "$branch"
			log "remove $repo $branch. It is $reason"
		else
			log "would remove $repo $branch. It is $reason"
			removed=$((removed + 1))
		fi
	done <"$RUN_DIR/.trees.$repo"
	rm -f "$RUN_DIR/.trees.$repo"

	[ "$APPLY" = "1" ] && git -C "$dir" worktree prune
done

if [ "$APPLY" = "1" ]; then
	find "$WORKTREE_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
fi

[ "$removed" = "0" ] && log "nothing to remove"
[ "$APPLY" != "1" ] && [ "$removed" != "0" ] && log "report only. Pass APPLY=1 to remove"
exit 0
