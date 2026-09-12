.DEFAULT_GOAL := help

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
S := $(ROOT)/scripts

# The daemon matches a Host and an Origin exactly, so both ports are pinned.
# Read apps/docs/api/connectivity.md before you change one.
#
# Easter egg: each port spells a constant. 31415 is pi and it belongs to the
# daemon; 27182 is Euler's number and it belongs to the browser. One pair.
export ENGINE_PORT ?= 31415
export WEB_PORT ?= 27182

.PHONY: help help-targets \
	repo-bootstrap repo-attach \
	up down restart status logs \
	dev-up dev-down dev-restart dev-status dev-logs \
	engine-up engine-down engine-logs engine-migrate engine-install \
	app-up app-down app-logs app-install \
	tree-new tree-list tree-clean \
	sync sync-all sync-status sync-engine sync-apps sync-parent \
	contract-sync git-author

help:
	@echo "Kanthord. Three scenarios. Copy a block and run it."
	@echo ""
	@echo "  make help-targets   every target, with its options"
	@echo ""
	@echo "==============================================================="
	@echo "SCENARIO 1 - FRESH START. A new clone, or a new machine"
	@echo "==============================================================="
	@echo ""
	@echo "  git clone git@kanthorlabs.github.com:kanthorlabs/kanthord.git"
	@echo "  cd kanthord"
	@echo "  git config user.name \"Your Name\""
	@echo "  git config user.email \"you@kanthorlabs.com\""
	@echo "  make repo-bootstrap"
	@echo "  make up"
	@echo "  make status"
	@echo ""
	@echo "  Only this repository needs the identity. repo-bootstrap copies it"
	@echo "  into engine and apps, installs every dependency, attaches both"
	@echo "  submodules to main, and migrates the database."
	@echo "  Run repo-bootstrap again whenever a checkout drifts. It repairs."
	@echo ""
	@echo "  daemon    http://127.0.0.1:$(ENGINE_PORT)"
	@echo "  dashboard http://localhost:$(WEB_PORT)"
	@echo ""
	@echo "==============================================================="
	@echo "SCENARIO 2 - DAILY. Level with origin/main, in both directions"
	@echo "==============================================================="
	@echo ""
	@echo "  make sync-status"
	@echo "  make sync-all"
	@echo ""
	@echo "  Carrying uncommitted work, commit and publish it in one run:"
	@echo ""
	@echo "  make sync-all ON_DIRTY=commit MSG=\"what you did\""
	@echo ""
	@echo "  sync-all pulls and pushes. It stashes a dirty tree and gives it"
	@echo "  back at the end. New files are published too; pass"
	@echo "  ON_UNTRACKED=skip to leave them behind."
	@echo "  It refuses a detached submodule. Fix that with make repo-attach."
	@echo ""
	@echo "==============================================================="
	@echo "SCENARIO 3 - FEATURE. One branch, in its own worktree"
	@echo "==============================================================="
	@echo ""
	@echo "  make tree-new REPO=engine BRANCH=feat/my-thing"
	@echo ""
	@echo "  A shell opens in .worktree/engine/feat/my-thing, branched from a"
	@echo "  freshly fetched origin/main, installed and configured."
	@echo "  Press Ctrl-D to come back here."
	@echo ""
	@echo "  Inside that shell:"
	@echo ""
	@echo "  git add -A && git commit -m \"your message\""
	@echo "  git push -u origin feat/my-thing"
	@echo "  gh pr create --fill"
	@echo ""
	@echo "  Back here, once the pull request is merged:"
	@echo ""
	@echo "  make sync-all"
	@echo "  make tree-list"
	@echo "  make tree-clean APPLY=1"
	@echo ""
	@echo "  sync-* only ever works on main. Push a feature branch with git,"
	@echo "  from its worktree. tree-clean reports first; APPLY=1 removes the"
	@echo "  merged worktrees and FORCE=1 BRANCH=name drops one that has no"
	@echo "  pull request."
	@echo ""
	@echo "  Publish the engine contract into apps with make contract-sync,"
	@echo "  then make sync-all."

help-targets:
	@echo "Kanthord targets. scripts/<category>/<command>.sh"
	@echo ""
	@echo "repo. A fresh clone"
	@echo "  repo-bootstrap   Make a clone ready to work in. Run this first"
	@echo "                   Prerequisites, submodules, branches, identity,"
	@echo "                   dependencies, daemon configuration and database"
	@echo "                   It is idempotent, so it also repairs a drifted checkout"
	@echo "  repo-attach      Put both submodules back on main"
	@echo "                   A clone leaves them detached, and sync refuses that"
	@echo ""
	@echo "dev. The daily loop"
	@echo "  dev-up           Start the daemon and the dashboard"
	@echo "                   FRESH=1 starts from a new daemon home and clean caches"
	@echo "  dev-down         Stop both. CLEAN=1 also drops the home, the logs, the pids"
	@echo "  dev-restart      dev-down, then dev-up"
	@echo "  dev-status       Report both processes, and call both endpoints"
	@echo "  dev-logs         Follow both logs"
	@echo "                   up, down, restart, status and logs are aliases"
	@echo ""
	@echo "engine. The daemon on http://127.0.0.1:$(ENGINE_PORT)"
	@echo "  engine-up        Start it. FRESH=1 deletes the daemon home first"
	@echo "  engine-down      Stop it. CLEAN=1 also removes the log"
	@echo "  engine-migrate   Apply the pending database migrations"
	@echo "  engine-install   Install the dependencies, generate a configuration"
	@echo "  engine-logs      Follow the daemon log"
	@echo ""
	@echo "app. The dashboard on http://localhost:$(WEB_PORT)"
	@echo "  app-up           Start it. FRESH=1 clears the build caches first"
	@echo "  app-down         Stop it. CLEAN=1 also removes the log"
	@echo "  app-install      Install the workspace dependencies"
	@echo "  app-logs         Follow the dashboard log"
	@echo ""
	@echo "tree. Worktrees under .worktree/<repo>/<branch>"
	@echo "  tree-new         REPO=engine|apps BRANCH=name"
	@echo "                   Branches from a freshly fetched origin/main, copies the"
	@echo "                   ignored local files, installs, configures, opens a shell"
	@echo "  tree-list        Every worktree, with its tree, merge and pull request state"
	@echo "  tree-clean       Report the finished worktrees"
	@echo "                   APPLY=1 removes the merged ones and the gone ones"
	@echo "                   FORCE=1 BRANCH=name removes one unmerged branch that"
	@echo "                   has no pull request. DIRTY=1 overrides a dirty tree"
	@echo "                   NO_PR=1 asserts there is none when gh cannot read the repo"
	@echo ""
	@echo "sync. Local and origin/main on the same commit"
	@echo "  sync-status      Drift table for the parent and both submodules"
	@echo "  sync-all         The whole tree, in a safe order. 'sync' is an alias"
	@echo "  sync-engine      The engine submodule only"
	@echo "  sync-apps        The apps submodule only"
	@echo "  sync-parent      This repository only, gitlinks untouched"
	@echo "                   ON_DIRTY=stash|commit|abort   MSG=\"...\" for commit"
	@echo "                   ON_UNTRACKED=add|skip  add is the default, so a new"
	@echo "                   file is published too. skip leaves new files behind"
	@echo "                   ON_DIVERGE=rebase|merge|abort"
	@echo "                   ON_POINTER_BEHIND=forward|bump|abort"
	@echo ""
	@echo "contract. Materials that flow from engine to apps"
	@echo "  contract-sync    Publish the engine contract into apps, and commit it"
	@echo ""
	@echo "git"
	@echo "  git-author       Apply the root commit identity to both submodules"
	@echo "                   Only this repository needs a local user section"
	@echo "                   CHECK=1 reports only, and fails on a mismatch"

repo-bootstrap:
	@$(S)/repo/bootstrap.sh
repo-attach:
	@$(S)/repo/attach.sh

up: dev-up
down: dev-down
restart: dev-restart
status: dev-status
logs: dev-logs

dev-up:
	@$(S)/dev/up.sh
dev-down:
	@$(S)/dev/down.sh
dev-restart:
	@$(S)/dev/down.sh && $(S)/dev/up.sh
dev-status:
	@$(S)/dev/status.sh
dev-logs:
	@$(S)/dev/logs.sh

engine-up:
	@$(S)/engine/up.sh
engine-down:
	@$(S)/engine/down.sh
engine-logs:
	@$(S)/engine/logs.sh
engine-migrate:
	@$(S)/engine/migrate.sh
engine-install:
	@$(S)/engine/install.sh

app-up:
	@$(S)/app/up.sh
app-down:
	@$(S)/app/down.sh
app-logs:
	@$(S)/app/logs.sh
app-install:
	@$(S)/app/install.sh

tree-new:
	@$(S)/tree/new.sh
tree-list:
	@$(S)/tree/list.sh
tree-clean:
	@$(S)/tree/clean.sh

sync: sync-all
sync-all:
	@$(S)/sync/all.sh
sync-status:
	@$(S)/sync/status.sh
sync-engine:
	@$(S)/sync/repo.sh engine
sync-apps:
	@$(S)/sync/repo.sh apps
sync-parent:
	@$(S)/sync/repo.sh parent

contract-sync:
	@$(S)/contract/sync.sh

git-author:
	@$(S)/git/author.sh
