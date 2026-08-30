#!/usr/bin/env bash
# Publish the engine contract into apps, and commit it there.
#
# Both repositories must be on main, clean, and level with origin/main, so the
# published manifest names a commit that everybody can fetch.
# EPIC_GATE=0 skips the EPIC 042-045 content assertion.
SCRIPT_NAME=contract-sync
. "$(dirname "$0")/../lib/common.sh"

CONTRACT_DIR="$APP_DIR/docs/api/contract"

for name in engine apps; do
	dir=$(repo_dir "$name")
	branch=$(current_branch "$dir")
	[ "$branch" = "main" ] || die "$name must be on main, not ${branch:-detached}"
	[ -z "$(git -C "$dir" status --porcelain)" ] || die "$name has uncommitted changes"
	git -C "$dir" fetch origin main >/dev/null || die "$name fetch failed"
	[ "$(git -C "$dir" rev-parse HEAD)" = "$(git -C "$dir" rev-parse origin/main)" ] ||
		die "$name HEAD is not the current origin/main. Run make sync-all first"
done

engine_commit=$(git -C "$ENGINE_DIR" rev-parse HEAD)
cd "$ENGINE_DIR" || exit 1
# pnpm forwards "--" to the script as a literal argument, where npm consumed
# it. The flags follow the script name directly.
pnpm run contract:publish --unreleased "$CONTRACT_DIR" || die "contract:publish failed"

if [ "${EPIC_GATE:-1}" = "1" ]; then
	has_042=0 has_043=0 has_044=0 has_045=0
	grep -q 'name: force' "$CONTRACT_DIR/features/provider.yaml" && has_042=1
	grep -q 'requiredAccess:' "$CONTRACT_DIR/features/repository.yaml" && has_043=1
	grep -q '"provider.verify"' "$CONTRACT_DIR/manifest.json" && has_044=1
	if grep -q '"provider.loginStart"' "$CONTRACT_DIR/manifest.json" &&
		grep -q '"provider.loginComplete"' "$CONTRACT_DIR/manifest.json" &&
		grep -q '"provider.loginCancel"' "$CONTRACT_DIR/manifest.json"; then has_045=1; fi
	case "$has_042$has_043$has_044$has_045" in
	1000) epics="042" ;;
	1100) epics="042, 043" ;;
	1110) epics="042, 043, 044" ;;
	1111) epics="042, 043, 044, 045" ;;
	*) die "the contract does not carry a contiguous EPIC 042-045 publication. Pass EPIC_GATE=0 once newer EPICs land" ;;
	esac
else
	epics=""
fi

[ "$(node -p "require('$CONTRACT_DIR/manifest.json').commit")" = "$engine_commit" ] ||
	die "the manifest does not name engine HEAD"

git -C "$APP_DIR" add -A -- docs/api/contract
if git -C "$APP_DIR" diff --cached --quiet -- docs/api/contract; then
	log "the generated contract has no changes"
	exit 0
fi

short_commit=$(git -C "$ENGINE_DIR" rev-parse --short=8 HEAD)
if [ -n "$epics" ]; then
	message="chore(contract): publish EPICs $epics at engine $short_commit"
else
	message="chore(contract): publish at engine $short_commit"
fi
git -C "$APP_DIR" commit -m "$message" -- docs/api/contract || die "commit failed"
log "committed engine $engine_commit in apps. Run make sync-all to publish it"
