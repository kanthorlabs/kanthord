#!/usr/bin/env bash
# P5. Reconcile the parent gitlinks with the settled submodule checkouts.
# The parent must already be integrated. Creates at most one bump commit.
SCRIPT_NAME=sync-pointer
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/lib.sh"

bumped=""
for name in $SUBMODULES; do
	dir=$(repo_dir "$name")
	recorded=$(git -C "$ROOT" rev-parse --verify --quiet "HEAD:$name") || die "$name has no recorded gitlink"
	indexed=$(git -C "$ROOT" ls-files --stage -- "$name" | awk '{print $2}')
	actual=$(git -C "$dir" rev-parse HEAD)

	if [ "$indexed" != "$recorded" ] && [ "$indexed" != "$actual" ]; then
		die "$name has a staged gitlink $indexed that matches neither HEAD nor the checkout. Resolve it by hand"
	fi

	if [ "$actual" = "$recorded" ]; then
		log "$name pointer is correct"
		continue
	fi

	if git -C "$dir" merge-base --is-ancestor "$recorded" "$actual" 2>/dev/null; then
		git -C "$ROOT" add -- "$name" || die "$name could not be staged"
		bumped="$bumped $name"
		log "$name pointer moves forward to $(git -C "$dir" rev-parse --short "$actual")"
		continue
	fi

	if git -C "$dir" merge-base --is-ancestor "$actual" "$recorded" 2>/dev/null; then
		case "${ON_POINTER_BEHIND:-forward}" in
		forward)
			git -C "$dir" merge --ff-only "$recorded" >/dev/null ||
				die "$name could not fast-forward to the recorded $recorded"
			log "$name checkout fast-forwarded to the recorded pointer"
			;;
		bump)
			git -C "$ROOT" add -- "$name" || die "$name could not be staged"
			bumped="$bumped $name"
			warn "$name pointer moves BACKWARD to $(git -C "$dir" rev-parse --short "$actual")"
			;;
		abort) die "$name checkout is behind the recorded pointer. Set ON_POINTER_BEHIND=forward or bump" ;;
		*) die "unknown ON_POINTER_BEHIND=${ON_POINTER_BEHIND}" ;;
		esac
		continue
	fi

	case "${ON_POINTER_UNRELATED:-abort}" in
	actual)
		git -C "$ROOT" add -- "$name" || die "$name could not be staged"
		bumped="$bumped $name"
		warn "$name pointer takes the checkout over an unrelated recorded commit"
		;;
	recorded)
		git -C "$dir" checkout --detach "$recorded" >/dev/null ||
			die "$name could not check out the recorded $recorded"
		die "$name is now detached at the recorded commit. Reconcile main by hand, then sync again"
		;;
	*) die "$name checkout $actual and recorded pointer $recorded share no history. Set ON_POINTER_UNRELATED=actual or recorded" ;;
	esac
done

if [ -z "$bumped" ]; then
	log "every pointer is correct"
	exit 0
fi
message="chore: bump$(printf '%s' "$bumped" | sed 's/^ //;s/ /, /g' | sed 's/^/ /')"
git -C "$ROOT" commit -m "$message" -- $bumped >/dev/null || die "the bump commit failed"
log "committed$bumped in the parent"
