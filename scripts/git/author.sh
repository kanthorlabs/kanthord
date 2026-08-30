#!/usr/bin/env bash
# The commit identity lives in this repository. Both submodules copy it.
#
# Only the root needs a local user section. This script applies that section to
# engine and apps, so the three repositories always commit under one identity.
# CHECK=1 reports only, and fails when a submodule does not match.
SCRIPT_NAME=git-author
. "$(dirname "$0")/../lib/common.sh"

name=$(git -C "$ROOT" config --local user.name)
email=$(git -C "$ROOT" config --local user.email)

if [ -z "$name" ] || [ -z "$email" ]; then
	warn "$ROOT has no local user section. Set one. This machine reports:"
	warn ""
	warn "	git -C $ROOT config user.name \"$(git config user.name)\""
	warn "	git -C $ROOT config user.email \"$(git config user.email)\""
	warn ""
	exit 1
fi
log "root: $name <$email>"

drift=0
for repo in $SUBMODULES; do
	dir=$(repo_dir "$repo")
	current_name=$(git -C "$dir" config --local user.name)
	current_email=$(git -C "$dir" config --local user.email)

	if [ "$current_name" = "$name" ] && [ "$current_email" = "$email" ]; then
		log "$repo: $current_name <$current_email>"
		continue
	fi

	if [ "${CHECK:-0}" = "1" ]; then
		warn "$repo: ${current_name:-unset} <${current_email:-unset}> does not match the root"
		drift=1
		continue
	fi

	git -C "$dir" config user.name "$name" || die "$repo could not take the name"
	git -C "$dir" config user.email "$email" || die "$repo could not take the email"
	log "$repo: applied $name <$email>"
done

exit $drift
