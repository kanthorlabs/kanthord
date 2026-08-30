# Sync helpers. Source this file after scripts/lib/common.sh. Do not run it.

SYNC_STATE="$RUN_DIR/sync"

# The orchestrator owns the push order. The commit hook must not act.
export KANTHORD_SKIP_SUBMODULE_PUSH=1

sync_state_reset() {
	rm -rf "$SYNC_STATE"
	mkdir -p "$SYNC_STATE"
}

pin_file() { printf '%s/%s.pin' "$SYNC_STATE" "$1"; }
stash_file() { printf '%s/%s.stash' "$SYNC_STATE" "$1"; }

pinned() { cat "$(pin_file "$1")"; }

# P0. Reject every state that makes an automatic sync unsafe, then pin
# origin/main so every later phase reads one fixed commit.
preflight_repo() {
	name=$1
	dir=$(repo_dir "$name")
	[ -d "$dir/.git" ] || [ -f "$dir/.git" ] || die "$name is not initialized. Run git submodule update --init"

	operation=$(in_progress "$dir") && die "$name has an unfinished $operation. Finish it or abort it, then sync again"
	has_unmerged "$dir" && die "$name has unmerged paths. Resolve them, then sync again"

	branch=$(current_branch "$dir")
	[ -n "$branch" ] || die "$name is on a detached HEAD, which is the normal state after a clone. Run make repo-attach"
	[ "$branch" = "main" ] || die "$name is on $branch, not main. Check out main, then sync again"

	if [ "${NOFETCH:-0}" != "1" ]; then
		git -C "$dir" fetch --prune origin >/dev/null 2>&1 || die "$name fetch failed"
	fi
	oid=$(git -C "$dir" rev-parse --verify --quiet origin/main) || die "$name has no origin/main"
	mkdir -p "$SYNC_STATE"
	printf '%s\n' "$oid" >"$(pin_file "$name")"
}

# AHEAD BEHIND against the pinned commit.
drift_counts() {
	dir=$(repo_dir "$1")
	git -C "$dir" rev-list --left-right --count "HEAD...$(pinned "$1")"
}

drift_state() {
	set -- $(drift_counts "$1")
	if [ "$1" = "0" ] && [ "$2" = "0" ]; then printf 'synced'
	elif [ "$2" = "0" ]; then printf 'ahead %s' "$1"
	elif [ "$1" = "0" ]; then printf 'behind %s' "$2"
	else printf 'diverged %s/%s' "$1" "$2"
	fi
}

# P1. Settle the working tree before anything writes to the repository.
protect_repo() {
	name=$1
	dir=$(repo_dir "$name")

	untracked=$(untracked_files "$dir")
	if [ -n "$untracked" ]; then
		if [ "${ON_UNTRACKED:-add}" = "add" ]; then
			log "$name has new files. They are published with the rest:"
		else
			log "$name has new files. ON_UNTRACKED=skip leaves them behind:"
		fi
		printf '%s\n' "$untracked" | sed 's/^/  /'
	fi

	# A new file is dirt only when the run is allowed to publish it.
	if [ "${ON_UNTRACKED:-add}" = "add" ] && [ -n "$untracked" ]; then
		:
	elif ! is_dirty "$dir"; then
		return 0
	fi

	case "${ON_DIRTY:-stash}" in
	stash)
		stash_argv="push --message"
		[ "${ON_UNTRACKED:-add}" = "add" ] && stash_argv="push --include-untracked --message"
		git -C "$dir" stash $stash_argv "sync-all $(date -u +%FT%TZ)" >/dev/null || die "$name stash failed"
		oid=$(git -C "$dir" rev-parse stash@{0})
		printf '%s\n' "$oid" >"$(stash_file "$name")"
		log "$name stashed the working tree at $oid"
		;;
	commit)
		[ -n "${MSG:-}" ] || die "$name is dirty and ON_DIRTY=commit. Pass MSG=\"your message\""
		if [ "${ON_UNTRACKED:-add}" = "add" ]; then
			# git add -A honours .gitignore, so an ignored secret stays out.
			git -C "$dir" add -A || die "$name could not stage the new files"
			git -C "$dir" commit -m "$MSG" >/dev/null || die "$name commit failed"
			log "$name committed the tracked changes and the new files"
		else
			git -C "$dir" commit -a -m "$MSG" >/dev/null || die "$name commit failed"
			log "$name committed the tracked changes. ON_UNTRACKED=skip left the new files out"
		fi
		;;
	abort) die "$name has uncommitted changes. Set ON_DIRTY=stash or ON_DIRTY=commit MSG=\"...\"" ;;
	*) die "unknown ON_DIRTY=${ON_DIRTY}" ;;
	esac
}

# P2 and P4. Bring the repository onto the pinned commit. Never pushes.
# GUARD_COMMITS names submodule commits that published parent history must keep.
integrate_repo() {
	name=$1
	dir=$(repo_dir "$name")
	target=$(pinned "$name")
	set -- $(drift_counts "$name")
	ahead=$1
	behind=$2

	if [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
		log "$name is level with origin/main"
		return 0
	fi
	if [ "$behind" = "0" ]; then
		log "$name is $ahead ahead. It integrates nothing"
		return 0
	fi
	if [ "$ahead" = "0" ]; then
		git -C "$dir" merge --ff-only "$target" >/dev/null || die "$name fast-forward failed"
		log "$name fast-forwarded $behind commits"
		return 0
	fi

	strategy=${ON_DIVERGE:-rebase}
	if [ "$strategy" = "rebase" ]; then
		for guarded in ${GUARD_COMMITS:-}; do
			if git -C "$dir" merge-base --is-ancestor "$guarded" HEAD 2>/dev/null &&
				! git -C "$dir" merge-base --is-ancestor "$guarded" "$target" 2>/dev/null; then
				warn "$name: a rebase rewrites $guarded, which an unpushed parent commit names"
				warn "$name: that parent commit would point at a commit nobody can fetch"
				strategy=merge
				break
			fi
		done
	fi

	case "$strategy" in
	rebase)
		if ! git -C "$dir" rebase "$target" >/dev/null 2>&1; then
			conflicts=$(git -C "$dir" diff --name-only --diff-filter=U)
			git -C "$dir" rebase --abort 2>/dev/null || true
			warn "$name rebase conflicts:"
			printf '%s\n' "$conflicts" | sed 's/^/  /' >&2
			die "$name diverged and the rebase conflicts. Resolve it by hand"
		fi
		log "$name rebased $ahead commits onto origin/main"
		;;
	merge)
		if ! git -C "$dir" merge --no-edit "$target" >/dev/null 2>&1; then
			conflicts=$(git -C "$dir" diff --name-only --diff-filter=U)
			git -C "$dir" merge --abort 2>/dev/null || true
			warn "$name merge conflicts:"
			printf '%s\n' "$conflicts" | sed 's/^/  /' >&2
			die "$name diverged and the merge conflicts. Resolve it by hand"
		fi
		log "$name merged origin/main"
		;;
	abort) die "$name diverged, $ahead local and $behind remote. Set ON_DIVERGE=rebase or ON_DIVERGE=merge" ;;
	*) die "unknown ON_DIVERGE=${strategy}" ;;
	esac
}

# P6 and P8. Never forced. A rejection means the remote moved after P0.
push_repo() {
	name=$1
	dir=$(repo_dir "$name")
	set -- $(drift_counts "$name")
	if [ "$1" = "0" ]; then
		log "$name has nothing to push"
		return 0
	fi
	git -C "$dir" push origin HEAD:refs/heads/main >/dev/null 2>&1 ||
		die "$name push was rejected. origin/main moved after the sync started. Run sync again"
	log "$name pushed $1 commits"
	printf '%s\n' "$name" >>"$SYNC_STATE/published"
}

# P10. Apply the exact recorded stash. Drop it only after it applies.
restore_repo() {
	name=$1
	file=$(stash_file "$name")
	[ -f "$file" ] || return 0
	dir=$(repo_dir "$name")
	oid=$(cat "$file")
	if git -C "$dir" stash apply "$oid" >/dev/null 2>&1; then
		entry=$(git -C "$dir" stash list --format='%H %gd' | awk -v o="$oid" '$1 == o {print $2; exit}')
		[ -n "$entry" ] && git -C "$dir" stash drop "$entry" >/dev/null 2>&1
		rm -f "$file"
		log "$name restored the stashed working tree"
	else
		warn "$name could not restore the stash. It is kept. Recover it with:"
		warn "  git -C $dir stash apply $oid"
	fi
}

report_published() {
	[ -f "$SYNC_STATE/published" ] || return 0
	warn "already pushed before this failure: $(tr '\n' ' ' <"$SYNC_STATE/published")"
}
