#!/usr/bin/env bash
# Integration checks use only disposable repositories and local bare remotes.
set -euo pipefail

source_root=$(cd "$(dirname "$0")/../.." && pwd)
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/kanthord-submodules.XXXXXX")
trap 'rm -rf "$sandbox"' EXIT
sandbox=$(cd "$sandbox" && pwd -P)
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX KANTHORD_SKIP_SUBMODULE_PUSH
export ROOT="$sandbox/parent"

fail() { printf 'test-submodules: %s\n' "$*" >&2; exit 1; }

git init --quiet --bare --initial-branch=main "$sandbox/parent.git"
git init --quiet --initial-branch=main "$ROOT"
git -C "$ROOT" config user.name 'Fixture Operator'
git -C "$ROOT" config user.email 'fixture@example.invalid'
git -C "$ROOT" remote add origin "$sandbox/parent.git"
cp -R "$source_root/scripts" "$ROOT/scripts"
cp -R "$source_root/.githooks" "$ROOT/.githooks"
cp "$source_root/.gitignore" "$ROOT/.gitignore"
mkdir -p "$ROOT/platforms/webhook"
printf 'root fixture\n' >"$ROOT/README.md"
printf 'tracked before conversion\n' >"$ROOT/platforms/webhook/README.md"
git -C "$ROOT" add -- scripts .githooks .gitignore README.md platforms/webhook/README.md
git -C "$ROOT" commit --quiet -m 'chore: create fixture'
git -C "$ROOT" push --quiet -u origin main

# Keep an outgoing commit where the future submodule path is still a tree.
printf 'another ordinary directory revision\n' >>"$ROOT/platforms/webhook/README.md"
git -C "$ROOT" add -- platforms/webhook/README.md
git -C "$ROOT" commit --quiet -m 'docs: revise pre-conversion fixture'

for alias in engine apps webhook; do
	seed="$sandbox/$alias-seed"
	git init --quiet --initial-branch=main "$seed"
	git -C "$seed" config user.name 'Fixture Operator'
	git -C "$seed" config user.email 'fixture@example.invalid'
	printf '%s fixture\n' "$alias" >"$seed/README.md"
	git -C "$seed" add -- README.md
	git -C "$seed" commit --quiet -m 'docs: initialize fixture'
	git init --quiet --bare --initial-branch=main "$sandbox/$alias.git"
	git -C "$seed" remote add origin "$sandbox/$alias.git"
	git -C "$seed" push --quiet -u origin main
	path=$alias
	if [ "$alias" = webhook ]; then
		path=platforms/webhook
		git -C "$ROOT" rm --quiet -r -- "$path"
	fi
	git -C "$ROOT" -c protocol.file.allow=always submodule add --quiet --name "$alias" "$sandbox/$alias.git" "$path"
done

git -C "$ROOT" config core.hooksPath .githooks
git -C "$ROOT" commit --quiet -m 'chore: register nested submodule'
"$ROOT/scripts/git/author.sh"
CHECK=1 "$ROOT/scripts/git/author.sh"

# Alias resolution stays separate from slash-free state/worktree names.
(
	SCRIPT_NAME=test-submodules
	. "$ROOT/scripts/lib/common.sh"
	[ "$(repo_path webhook)" = platforms/webhook ] || fail 'wrong relative webhook path'
	[ "$(repo_dir webhook)" = "$ROOT/platforms/webhook" ] || fail 'wrong absolute webhook path'
	[ "$(repo_dir parent)" = "$ROOT" ] || fail 'wrong parent path'
	if (repo_path unknown) 2>/dev/null; then fail 'unknown alias accepted'; fi
) || fail 'alias resolution failed'

webhook="$ROOT/platforms/webhook"
old=$(git -C "$webhook" rev-parse HEAD)
printf 'unpublished webhook revision\n' >>"$webhook/README.md"
git -C "$webhook" add -- README.md
git -C "$webhook" commit --quiet -m 'docs: update webhook fixture'
git -C "$ROOT" add -- platforms/webhook
if (cd "$ROOT" && sh .githooks/pre-commit) >"$sandbox/hook.log" 2>&1; then
	fail 'hook accepted an unpublished nested gitlink'
fi
grep -q 'platforms/webhook pointer .* is not on its origin/main' "$sandbox/hook.log" || fail 'hook failed for the wrong reason'

# Sync must ignore historical tree objects, publish Webhook first, and then
# publish a parent whose nested gitlink is fetchable. No live remote is used.
NOFETCH=1 ON_DIRTY=abort "$ROOT/scripts/sync/all.sh" >"$sandbox/sync.log" 2>&1 || {
	printf 'test-submodules: sync log follows\n' >&2
	head -n 200 "$sandbox/sync.log" >&2
	fail 'nested sync failed'
}
actual=$(git -C "$webhook" rev-parse HEAD)
[ "$actual" != "$old" ] || fail 'fixture did not advance'
[ "$(git -C "$ROOT" rev-parse HEAD:platforms/webhook)" = "$actual" ] || fail 'nested pointer was not reconciled'
[ "$(git -C "$sandbox/webhook.git" rev-parse main)" = "$actual" ] || fail 'webhook was not published'
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$(git -C "$sandbox/parent.git" rev-parse main)" ] || fail 'parent was not published'
[ -f "$ROOT/.dev/sync/webhook.pin" ] || fail 'alias-based state file missing'
webhook_line=$(grep -n 'sync-all: webhook pushed' "$sandbox/sync.log" | cut -d: -f1)
parent_line=$(grep -n 'sync-all: parent pushed' "$sandbox/sync.log" | cut -d: -f1)
[ "$webhook_line" -lt "$parent_line" ] || fail 'parent published before webhook'
NOFETCH=1 "$ROOT/scripts/sync/status.sh" >"$sandbox/status.log"
grep -q '^webhook .*synced' "$sandbox/status.log" || fail 'status omits webhook'

# Pointer reconciliation must not commit another staged parent file.
printf 'published second revision\n' >>"$webhook/README.md"
git -C "$webhook" add -- README.md
git -C "$webhook" commit --quiet -m 'docs: advance fixture again'
git -C "$webhook" push --quiet origin main
printf 'unrelated staged change\n' >>"$ROOT/README.md"
git -C "$ROOT" add -- README.md
"$ROOT/scripts/sync/pointer.sh"
[ "$(git -C "$ROOT" diff --cached --name-only)" = README.md ] || fail 'pointer commit consumed unrelated staging'
[ "$(git -C "$ROOT" show --format= --name-only HEAD)" = platforms/webhook ] || fail 'pointer commit used an alias as a path'

# Prevent optional PR discovery from making any network request.
mkdir -p "$sandbox/bin"
printf '#!/bin/sh\nexit 1\n' >"$sandbox/bin/gh"
chmod +x "$sandbox/bin/gh"
export PATH="$sandbox/bin:$PATH"
REPO=webhook BRANCH=docs/fixture SHELL_IN=0 "$ROOT/scripts/tree/new.sh"
tree="$ROOT/.worktree/webhook/docs/fixture"
[ -f "$tree/README.md" ] || fail 'webhook worktree missing'
[ ! -e "$ROOT/.worktree/webhook/docs/docs" ] || fail 'standalone worktree received parent links'
"$ROOT/scripts/tree/list.sh" >"$sandbox/trees.log"
grep -q '^webhook .*docs/fixture' "$sandbox/trees.log" || fail 'worktree listing omits webhook'
APPLY=1 "$ROOT/scripts/tree/clean.sh"
[ ! -e "$tree" ] || fail 'merged webhook worktree was not removed'
[ ! -e "$ROOT/.dev/.trees.webhook" ] || fail 'worktree inventory was not cleaned'

git -C "$webhook" checkout --quiet --detach origin/main
"$ROOT/scripts/repo/attach.sh"
[ "$(git -C "$webhook" symbolic-ref --short HEAD)" = main ] || fail 'webhook did not reattach to main'

# A fresh recursive checkout can fetch the published nested gitlink.
git -c protocol.file.allow=always clone --quiet --recurse-submodules "$sandbox/parent.git" "$sandbox/fresh"
[ -f "$sandbox/fresh/platforms/webhook/README.md" ] || fail 'fresh clone lacks webhook'
ROOT="$sandbox/fresh" "$sandbox/fresh/scripts/repo/attach.sh"
[ "$(git -C "$sandbox/fresh/platforms/webhook" symbolic-ref --short HEAD)" = main ] || fail 'fresh webhook checkout stayed detached'
printf 'test-submodules: PASS (aliases, hooks, historical modes, publication order, pointers, status, identity, worktrees, attach, recursive clone)\n'
