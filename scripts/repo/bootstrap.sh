#!/usr/bin/env bash
# Make a fresh clone ready to work in.
#
# It checks the prerequisites, initializes both submodules, puts them on main,
# copies the root commit identity down, installs every dependency, and
# generates the daemon configuration and database. It is idempotent, so it is
# also the repair command when a checkout drifts.
SCRIPT_NAME=repo-bootstrap
. "$(dirname "$0")/../lib/common.sh"

step() { printf '\n%s: %s\n' "$SCRIPT_NAME" "$*"; }

step "1/6 prerequisites"
require_command git
require_command node
node_major=$(node -p "process.versions.node.split('.')[0]")
wanted=$(sed -n '1s/^v\{0,1\}\([0-9]*\).*/\1/p' "$ENGINE_DIR/.nvmrc" 2>/dev/null)
if [ -n "$wanted" ] && [ "$node_major" -lt "$wanted" ]; then
	die "node $node_major is older than the required $wanted. See engine/.nvmrc"
fi
log "node $(node -v)"

if ! command -v pnpm >/dev/null; then
	if command -v corepack >/dev/null; then
		log "pnpm is absent. Enabling it through corepack"
		corepack enable pnpm || die "corepack enable pnpm failed"
	else
		die "neither pnpm nor corepack is installed. Install node 24 with corepack, or install pnpm"
	fi
fi
log "pnpm $(cd "$ENGINE_DIR" 2>/dev/null && pnpm -v 2>/dev/null || pnpm -v)"

step "2/6 submodules"
git -C "$ROOT" submodule sync --quiet || die "submodule sync failed"
git -C "$ROOT" submodule update --init || die "submodule update failed"
for name in $SUBMODULES; do
	log "$name at $(git -C "$(repo_dir "$name")" rev-parse --short HEAD)"
done

step "3/6 branches"
"$ROOT/scripts/repo/attach.sh" || exit 1

step "4/6 dependencies"
"$ROOT/scripts/engine/install.sh" || exit 1
"$ROOT/scripts/app/install.sh" || exit 1

step "5/6 daemon configuration and database"
if [ -f "$ENGINE_DIR/.envrc" ] && command -v direnv >/dev/null; then
	direnv allow "$ENGINE_DIR" >/dev/null 2>&1 && log "allowed engine/.envrc"
fi
"$ROOT/scripts/engine/migrate.sh" >/dev/null || die "the database migration failed"
log "database migrated"

# Identity is last. A fresh clone has none, and that must not stop the install.
step "6/6 commit identity"
identity=0
"$ROOT/scripts/git/author.sh" || identity=1

if [ "$identity" != "0" ]; then
	printf '\n%s: the checkout is ready, but it cannot commit yet.\n' "$SCRIPT_NAME"
	printf '%s: set the identity above, then run make repo-bootstrap again.\n' "$SCRIPT_NAME"
	exit 1
fi

printf '\n%s: ready. Next:\n' "$SCRIPT_NAME"
printf '  make up          start the daemon on http://127.0.0.1:%s and the dashboard on http://localhost:%s\n' "$ENGINE_PORT" "$WEB_PORT"
printf '  make sync-status report the drift against origin/main\n'
printf '  make help        every target\n'
