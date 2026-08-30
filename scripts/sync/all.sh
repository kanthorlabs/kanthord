#!/usr/bin/env bash
# Bring the parent and both submodules level with origin/main.
#
# The parent integrates BEFORE the pointers are decided. The reverse order
# lets a parent fast-forward overwrite the gitlinks that were just chosen.
# Submodules are pushed BEFORE the parent, and every outgoing gitlink is
# proven reachable on its submodule remote before the parent is published.
SCRIPT_NAME=sync-all
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"

trap 'report_published' EXIT

# P0. Preflight and pin.
log "phase 0: preflight"
sync_state_reset
for name in parent $SUBMODULES; do
	preflight_repo "$name"
	printf '  %-8s %s\n' "$name" "$(drift_state "$name")"
done

# P1. Protect every working tree, the parent index included.
log "phase 1: protect the working trees"
for name in parent $SUBMODULES; do protect_repo "$name"; done

# P2. Integrate the parent first.
log "phase 2: integrate the parent"
integrate_repo parent

# P3. Gitlinks that unpushed parent commits already name.
log "phase 3: enumerate the outgoing gitlinks"
outgoing_gitlinks() {
	target=$1
	for commit in $(git -C "$ROOT" rev-list "$(pinned parent)..HEAD"); do
		git -C "$ROOT" rev-parse --verify --quiet "$commit:$target" 2>/dev/null
	done | sort -u
}
for name in $SUBMODULES; do
	guards=$(outgoing_gitlinks "$name" | tr '\n' ' ')
	printf '%s' "$guards" >"$SYNC_STATE/$name.guards"
	[ -n "$guards" ] && log "$name is named by unpushed parent commits: $guards"
done

# P4. Integrate the submodules, without rewriting a guarded commit.
log "phase 4: integrate the submodules"
for name in $SUBMODULES; do
	GUARD_COMMITS=$(cat "$SYNC_STATE/$name.guards" 2>/dev/null) integrate_repo "$name"
done

# P5. Decide the pointers on the already-integrated parent.
log "phase 5: reconcile the pointers"
"$(dirname "$0")/pointer.sh" || die "pointer reconciliation failed"

# P6. Submodules are published first.
log "phase 6: push the submodules"
for name in $SUBMODULES; do push_repo "$name"; done

# P7. A local gitlink is not evidence that the remote has the commit.
log "phase 7: verify the outgoing gitlinks are published"
for name in $SUBMODULES; do
	dir=$(repo_dir "$name")
	git -C "$dir" fetch --prune origin >/dev/null 2>&1 || die "$name re-fetch failed"
	published=$(git -C "$dir" rev-parse --verify origin/main)
	for commit in $(git -C "$ROOT" rev-list "$(pinned parent)..HEAD" | while read -r rev; do
		git -C "$ROOT" rev-parse --verify --quiet "$rev:$name" 2>/dev/null
	done | sort -u); do
		git -C "$dir" merge-base --is-ancestor "$commit" "$published" 2>/dev/null ||
			die "$name commit $commit is named by an outgoing parent commit but is not on origin/main. The parent stays unpushed"
	done
	log "$name gitlinks are published"
done

# P8. Publish the parent.
log "phase 8: push the parent"
push_repo parent

# P9. Prove the postcondition.
log "phase 9: verify"
for name in parent $SUBMODULES; do
	preflight_repo "$name"
	state=$(drift_state "$name")
	[ "$state" = "synced" ] || die "$name is $state after the sync"
done
for name in $SUBMODULES; do
	[ "$(git -C "$ROOT" rev-parse "HEAD:$name")" = "$(git -C "$(repo_dir "$name")" rev-parse HEAD)" ] ||
		die "$name pointer and checkout disagree after the sync"
done

# P10. Give the working trees back.
log "phase 10: restore the working trees"
for name in parent $SUBMODULES; do restore_repo "$name"; done

trap - EXIT
rm -f "$SYNC_STATE/published"
log "all three repositories are level with origin/main"
