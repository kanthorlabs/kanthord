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

mkdir -p "$sandbox/bin"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s/gh.log"\nprintf "https://example.invalid/pull/1\\n"\n' "$sandbox" >"$sandbox/bin/gh"
chmod 700 "$sandbox/bin/gh"
export PATH="$sandbox/bin:$PATH"

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

for alias in engine apps webhook homelab; do
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
	[ "$alias" != homelab ] || path=platforms/homelab
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
branch=$(git -C "$sandbox/parent.git" for-each-ref --format='%(refname:short)' refs/heads/sync/)
[ -n "$branch" ] || fail 'parent sync branch was not pushed'
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$(git -C "$sandbox/parent.git" rev-parse "$branch")" ] || fail 'parent sync branch is not the parent head'
[ "$(git -C "$ROOT" rev-parse HEAD)" != "$(git -C "$sandbox/parent.git" rev-parse main)" ] || fail 'parent main was pushed directly'
grep -q -- "pr create --base main --head $branch" "$sandbox/gh.log" || fail 'parent pull request was not opened'
grep -q 'The parent waits in https://example.invalid/pull/1' "$sandbox/sync.log" || fail 'sync did not report the pull request'
git -C "$sandbox/parent.git" update-ref refs/heads/main "refs/heads/$branch"
git -C "$ROOT" fetch --quiet origin
[ -f "$ROOT/.dev/sync/webhook.pin" ] || fail 'alias-based state file missing'
webhook_line=$(grep -n 'sync-all: webhook pushed' "$sandbox/sync.log" | cut -d: -f1)
parent_line=$(grep -n 'sync-all: parent pushed' "$sandbox/sync.log" | cut -d: -f1)
[ "$webhook_line" -lt "$parent_line" ] || fail 'parent published before webhook'
NOFETCH=1 "$ROOT/scripts/sync/status.sh" >"$sandbox/status.log"
grep -q '^webhook .*synced' "$sandbox/status.log" || fail 'status omits webhook'

apps="$ROOT/apps"
homelab="$ROOT/platforms/homelab"
git -C "$ROOT/engine" checkout --quiet -b feature/fixture
apps_published=$(git -C "$sandbox/apps.git" rev-parse main)
printf 'unpublished apps revision\n' >>"$apps/README.md"
git -C "$apps" commit --quiet -am 'docs: update apps fixture'
printf 'uncommitted apps edit\n' >>"$apps/README.md"
git -C "$homelab" checkout --quiet --detach
printf 'orphan homelab revision\n' >>"$homelab/README.md"
git -C "$homelab" commit --quiet -am 'docs: orphan homelab fixture'
if NOFETCH=1 "$ROOT/scripts/sync/all.sh" >"$sandbox/skip.log" 2>&1; then
	fail 'sync passed with a dirty repository'
fi
[ "$(git -C "$ROOT/engine" symbolic-ref --short HEAD)" = main ] || fail 'engine did not switch to main'
grep -q 'sync-all: engine switched from feature/fixture to main' "$sandbox/skip.log" || fail 'sync did not report the switch'
grep -q '^  apps: it has uncommitted changes' "$sandbox/skip.log" || fail 'sync did not report the dirty apps'
grep -q '^  homelab: it is detached at .*which no branch contains' "$sandbox/skip.log" || fail 'sync did not report the orphan homelab'
grep -q 'sync-all: resolve each reason, then sync again' "$sandbox/skip.log" || fail 'sync failed for the wrong reason'
grep -q 'sync-all: webhook is level with origin/main' "$sandbox/skip.log" || fail 'sync did not continue with webhook'
[ "$(git -C "$sandbox/apps.git" rev-parse main)" = "$apps_published" ] || fail 'sync pushed a skipped repository'
git -C "$homelab" symbolic-ref --quiet HEAD >/dev/null && fail 'sync switched the orphan homelab'
git -C "$apps" reset --quiet --hard origin/main
git -C "$homelab" checkout --quiet main

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

git -C "$webhook" checkout --quiet --detach origin/main
"$ROOT/scripts/repo/attach.sh"
[ "$(git -C "$webhook" symbolic-ref --short HEAD)" = main ] || fail 'webhook did not reattach to main'

# A fresh recursive checkout can fetch the published nested gitlink.
git -c protocol.file.allow=always clone --quiet --recurse-submodules "$sandbox/parent.git" "$sandbox/fresh"
[ -f "$sandbox/fresh/platforms/webhook/README.md" ] || fail 'fresh clone lacks webhook'
ROOT="$sandbox/fresh" "$sandbox/fresh/scripts/repo/attach.sh"
[ "$(git -C "$sandbox/fresh/platforms/webhook" symbolic-ref --short HEAD)" = main ] || fail 'fresh webhook checkout stayed detached'

repair="$sandbox/repair"
git -c protocol.file.allow=always clone --quiet --recurse-submodules "$sandbox/parent.git" "$repair"
if (cd "$sandbox" && ROOT="$repair" "$repair/scripts/git/author.sh") 2>"$sandbox/author.log"; then
	fail 'author accepted a root with no local identity'
fi
grep -q 'config user.name "<your name>"' "$sandbox/author.log" || fail 'author printed no name placeholder'
grep -q 'config user.email "<your email>"' "$sandbox/author.log" || fail 'author printed no email placeholder'

git -C "$repair" config user.name 'Fixture Operator'
git -C "$repair" config user.email 'fixture@example.invalid'
git -C "$repair/engine" ls-files -z | (cd "$repair/engine" && xargs -0 rm -f)
printf 'uncommitted apps edit\n' >>"$repair/apps/README.md"
mkdir -p "$sandbox/bootstrap-bin"
printf '#!/bin/sh\ncase "$*" in\n*" submodule update --init")\n\t[ ! -e "%s/update-fails" ] || exit 1\n\t[ -e "%s/update-failed" ] || { : >"%s/update-failed"; exit 1; } ;;\nesac\nexec "%s" "$@"\n' \
	"$sandbox" "$sandbox" "$sandbox" "$(command -v git)" >"$sandbox/bootstrap-bin/git"
printf '#!/bin/sh\ncase "$1" in -v) printf "v24.0.0\\n" ;; *) printf "24\\n" ;; esac\n' >"$sandbox/bootstrap-bin/node"
printf '#!/bin/sh\nexit 0\n' >"$sandbox/bootstrap-bin/pnpm"
chmod 700 "$sandbox/bootstrap-bin/git" "$sandbox/bootstrap-bin/node" "$sandbox/bootstrap-bin/pnpm"
for script in repo/install.sh engine/install.sh app/install.sh; do
	printf '#!/bin/sh\nexit 0\n' >"$repair/scripts/$script"
done
PATH="$sandbox/bootstrap-bin:$PATH" ROOT="$repair" \
	GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always \
	"$repair/scripts/repo/bootstrap.sh" >"$sandbox/bootstrap.log" 2>&1 || {
	printf 'test-submodules: bootstrap log follows\n' >&2
	cat "$sandbox/bootstrap.log" >&2
	fail 'bootstrap did not repair a failed submodule update'
}
[ -e "$sandbox/update-failed" ] || fail 'the first submodule update did not fail'
[ -f "$repair/engine/README.md" ] || fail 'bootstrap left the engine checkout empty'
grep -q 'uncommitted apps edit' "$repair/apps/README.md" || fail 'bootstrap discarded an uncommitted apps change'

git -C "$repair/engine" ls-files -z | (cd "$repair/engine" && xargs -0 rm -f)
PATH="$sandbox/bootstrap-bin:$PATH" ROOT="$repair" \
	GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always \
	"$repair/scripts/repo/bootstrap.sh" >"$sandbox/bootstrap.log" 2>&1 || {
	printf 'test-submodules: bootstrap log follows\n' >&2
	cat "$sandbox/bootstrap.log" >&2
	fail 'bootstrap failed after a passed submodule update'
}
[ -f "$repair/engine/README.md" ] || fail 'bootstrap left the engine checkout empty after a passed update'

: >"$sandbox/update-fails"
if PATH="$sandbox/bootstrap-bin:$PATH" ROOT="$repair" \
	GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always \
	"$repair/scripts/repo/bootstrap.sh" >"$sandbox/bootstrap.log" 2>&1; then
	fail 'bootstrap accepted a second failed submodule update'
fi
grep -q 'repo-bootstrap: submodule update failed' "$sandbox/bootstrap.log" || fail 'bootstrap failed for the wrong reason'
printf 'test-submodules: PASS (aliases, hooks, historical modes, publication order, pointers, status, identity, attach, recursive clone, bootstrap repair)\n'
