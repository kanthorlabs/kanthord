.DEFAULT_GOAL := help

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
ENGINE_DIR := $(ROOT)/engine
APP_DIR := $(ROOT)/apps
RUN_DIR := $(ROOT)/.dev
WORKTREE_DIR := $(ROOT)/.worktree

# worktree-clean reports only. Pass DRY_RUN=0 to remove.
DRY_RUN ?= 1

# The repository to read the commit identity from. A worktree target overrides
# it with the submodule that owns the worktree.
AUTHOR_PATH ?= $(ROOT)

ENGINE_PID := $(RUN_DIR)/engine.pid
ENGINE_LOG := $(RUN_DIR)/engine.log
APP_PID := $(RUN_DIR)/app.pid
APP_LOG := $(RUN_DIR)/app.log

# The daemon matches a Host and an Origin exactly, so both ports are pinned.
# Read apps/docs/api/connectivity.md before you change one.
#
# Easter egg: each port spells a constant. 31415 is pi and it belongs to the
# daemon; 27182 is Euler's number and it belongs to the browser. One pair.
ENGINE_PORT ?= 31415
WEB_PORT ?= 27182

ifeq ($(shell command -v fvm 2>/dev/null),)
FLUTTER := flutter
else
FLUTTER := fvm flutter
endif

.PHONY: help up down restart status \
	engine-up engine-down engine-migrate engine-logs \
	app-up app-down app-logs \
	gitpull gitpush \
	author engine-worktree app-worktree worktree-clean

help:
	@echo "Kanthord local development. The daemon and the web app"
	@echo ""
	@echo "  up             Start the daemon and the web app"
	@echo "  down           Stop both"
	@echo "  restart        Stop both, then start both"
	@echo "  status         Report each process, and call both endpoints"
	@echo ""
	@echo "  engine-up      Start the daemon on http://127.0.0.1:$(ENGINE_PORT)"
	@echo "  engine-down    Stop the daemon"
	@echo "  engine-migrate Apply the pending database migrations"
	@echo "  engine-logs    Follow the daemon log"
	@echo ""
	@echo "  app-up         Start the web app on http://localhost:$(WEB_PORT)"
	@echo "  app-down       Stop the web app"
	@echo "  app-logs       Follow the web app log"
	@echo ""
	@echo "  gitpull        Pull this repository and both submodules"
	@echo "  gitpush        Commit and push both submodules, then this repository"
	@echo "                 Pass MSG=\"...\" when a working tree is dirty"
	@echo ""
	@echo "  engine-worktree BRANCH=name  Add .worktree/engine/name"
	@echo "  app-worktree    BRANCH=name  Add .worktree/apps/name"
	@echo "                 Both targets copy the files listed in the submodule"
	@echo "                 .worktreeinclude from the main checkout"
	@echo "                 The engine worktree also gets its own kanthord.config.json"
	@echo "                 Both need a local user section in the submodule"
	@echo ""
	@echo "  worktree-clean Report every worktree whose branch is merged or gone"
	@echo "                 Pass DRY_RUN=0 to remove them"
	@echo ""
	@echo "  author         Report the local commit identity, or how to set it"
	@echo "                 Pass AUTHOR_PATH=engine to check a submodule"
	@echo ""
	@echo "Both targets detach, so the hot reload keys are not available."
	@echo "For hot reload, run 'make dev' in apps/ instead. It stays in the foreground."

up: engine-up app-up

down: app-down engine-down

restart: down up

$(RUN_DIR):
	@mkdir -p $(RUN_DIR)

engine-migrate:
	@cd $(ENGINE_DIR) && node src/main.ts db migrate

engine-up: $(RUN_DIR)
	@if [ -f $(ENGINE_PID) ] && kill -0 $$(cat $(ENGINE_PID)) 2>/dev/null; then \
		echo "engine: already running (pid $$(cat $(ENGINE_PID)))"; exit 0; \
	fi; \
	cd $(ENGINE_DIR) || exit 1; \
	node src/main.ts db migrate >$(ENGINE_LOG) 2>&1 || { \
		echo "engine: migrate failed"; tail -20 $(ENGINE_LOG); exit 1; }; \
	nohup node src/main.ts serve >>$(ENGINE_LOG) 2>&1 & \
	echo $$! >$(ENGINE_PID); \
	printf "engine: starting"; \
	for i in $$(seq 1 30); do \
		grep -q "kanthord: ready" $(ENGINE_LOG) 2>/dev/null && break; \
		kill -0 $$(cat $(ENGINE_PID)) 2>/dev/null || { \
			echo " died"; tail -20 $(ENGINE_LOG); rm -f $(ENGINE_PID); exit 1; }; \
		printf "."; sleep 1; \
	done; \
	if grep -q "kanthord: ready" $(ENGINE_LOG) 2>/dev/null; then \
		echo " ready on http://127.0.0.1:$(ENGINE_PORT)"; \
	else \
		echo " timeout"; tail -20 $(ENGINE_LOG); exit 1; \
	fi

engine-down:
	@if [ -f $(ENGINE_PID) ]; then \
		kill $$(cat $(ENGINE_PID)) 2>/dev/null || true; rm -f $(ENGINE_PID); \
	fi; \
	pkill -f "src/main.ts serve" 2>/dev/null || true; \
	echo "engine: stopped"

engine-logs:
	@tail -f $(ENGINE_LOG)

app-up: $(RUN_DIR)
	@if [ -f $(APP_PID) ] && kill -0 $$(cat $(APP_PID)) 2>/dev/null; then \
		echo "app: already running (pid $$(cat $(APP_PID)))"; exit 0; \
	fi; \
	holder=$$(lsof -nP -iTCP:$(WEB_PORT) -sTCP:LISTEN -t 2>/dev/null | head -1); \
	if [ -n "$$holder" ]; then \
		echo "app: warning. Port $(WEB_PORT) already has a listener, pid $$holder:"; \
		ps -p $$holder -o command= | cut -c1-100; \
	fi; \
	cd $(APP_DIR) || exit 1; \
	nohup $(FLUTTER) run -d web-server --web-port=$(WEB_PORT) --web-hostname=localhost >$(APP_LOG) 2>&1 & \
	echo $$! >$(APP_PID); \
	printf "app: starting. The first web build takes about a minute"; \
	for i in $$(seq 1 90); do \
		grep -q "is being served at" $(APP_LOG) 2>/dev/null && break; \
		kill -0 $$(cat $(APP_PID)) 2>/dev/null || { \
			echo " died"; tail -20 $(APP_LOG); rm -f $(APP_PID); exit 1; }; \
		printf "."; sleep 2; \
	done; \
	if grep -q "is being served at" $(APP_LOG) 2>/dev/null; then \
		echo " ready on http://localhost:$(WEB_PORT)"; \
	else \
		echo " timeout"; tail -20 $(APP_LOG); exit 1; \
	fi

app-down:
	@if [ -f $(APP_PID) ]; then \
		kill $$(cat $(APP_PID)) 2>/dev/null || true; rm -f $(APP_PID); \
	fi; \
	pkill -f "web-port=$(WEB_PORT)" 2>/dev/null || true; \
	echo "app: stopped"

app-logs:
	@tail -f $(APP_LOG)

status:
	@if [ -f $(ENGINE_PID) ] && kill -0 $$(cat $(ENGINE_PID)) 2>/dev/null; then \
		echo "engine: running (pid $$(cat $(ENGINE_PID)))"; \
	else \
		echo "engine: stopped"; \
	fi; \
	token=$$(sed -n 's/.*"token": "\([^"]*\)".*/\1/p' $(ENGINE_DIR)/kanthord.config.json 2>/dev/null); \
	code=$$(curl -s -o /dev/null -w "%{http_code}" -H "Host: localhost:$(ENGINE_PORT)" \
		-H "Authorization: Bearer $$token" http://127.0.0.1:$(ENGINE_PORT)/v1/health 2>/dev/null); \
	echo "engine: GET /v1/health -> $${code:-no answer}"; \
	if [ -f $(APP_PID) ] && kill -0 $$(cat $(APP_PID)) 2>/dev/null; then \
		echo "app: running (pid $$(cat $(APP_PID)))"; \
	else \
		echo "app: stopped"; \
	fi; \
	holder=$$(lsof -nP -iTCP:$(WEB_PORT) -sTCP:LISTEN -t 2>/dev/null | head -1); \
	if [ -n "$$holder" ]; then \
		echo "app: port $(WEB_PORT) held by pid $$holder: $$(ps -p $$holder -o comm=)"; \
	else \
		echo "app: port $(WEB_PORT) free"; \
	fi

gitpull:
	git submodule sync
	git pull --recurse-submodules && git submodule update --remote --merge

gitpush:
	@cd $(ROOT) && dirty=""; \
	for path in engine apps; do \
		[ -z "$$(git -C $$path status --porcelain)" ] || dirty="$$dirty $$path"; \
	done; \
	[ -z "$$(git status --porcelain --ignore-submodules=all)" ] || dirty="$$dirty ."; \
	if [ -n "$$dirty" ] && [ -z "$(MSG)" ]; then \
		echo "gitpush: dirty:$$dirty"; \
		echo "gitpush: run 'make gitpush MSG=\"your message\"'"; exit 1; \
	fi; \
	for path in engine apps; do \
		if [ -n "$$(git -C $$path status --porcelain)" ]; then \
			echo "gitpush: commit $$path"; \
			git -C $$path add -A && git -C $$path commit -m "$(MSG)" || exit 1; \
		fi; \
		echo "gitpush: push $$path"; \
		git -C $$path push origin HEAD:main || exit 1; \
	done; \
	bumped=""; \
	for path in engine apps; do \
		recorded=$$(git rev-parse --quiet --verify HEAD:$$path); \
		current=$$(git -C $$path rev-parse HEAD); \
		[ "$$recorded" = "$$current" ] || bumped="$$bumped $$path"; \
	done; \
	if [ -n "$$bumped" ]; then \
		git add -- $$bumped; \
		git commit -m "chore: bump $$(echo $$bumped | sed 's/^ //;s/ /, /g')" || exit 1; \
	fi; \
	if [ -n "$$(git status --porcelain --ignore-submodules=all)" ]; then \
		echo "gitpush: commit the parent repository"; \
		git add -A && git commit -m "$(MSG)" || exit 1; \
	fi; \
	echo "gitpush: push the parent repository"; \
	git push

author:
	@name=$$(git -C $(AUTHOR_PATH) config --local user.name); \
	email=$$(git -C $(AUTHOR_PATH) config --local user.email); \
	if [ -n "$$name" ] && [ -n "$$email" ]; then \
		echo "author: $(AUTHOR_PATH): $$name <$$email>"; exit 0; \
	fi; \
	echo "author: $(AUTHOR_PATH) has no local user section."; \
	echo "author: set one. This machine reports:"; \
	echo ""; \
	echo "	git -C $(AUTHOR_PATH) config user.name \"$$(git config user.name)\""; \
	echo "	git -C $(AUTHOR_PATH) config user.email \"$$(git config user.email)\""; \
	echo ""; \
	exit 1

engine-worktree: BRANCH_DIR = $(WORKTREE_DIR)/engine
engine-worktree: SUBMODULE_DIR = $(ENGINE_DIR)
engine-worktree: CONFIGURE = node $(ENGINE_DIR)/src/main.ts config generate --home "$$target/.data/.kanthord" --output "$$target"
app-worktree: BRANCH_DIR = $(WORKTREE_DIR)/apps
app-worktree: SUBMODULE_DIR = $(APP_DIR)
app-worktree: CONFIGURE = true

engine-worktree app-worktree:
	@if [ -z "$(BRANCH)" ]; then \
		echo "$@: pass BRANCH=name"; exit 1; \
	fi; \
	report=$$($(MAKE) --no-print-directory author AUTHOR_PATH=$(SUBMODULE_DIR) 2>/dev/null) || { \
		echo "$$report"; exit 1; }; \
	name=$$(git -C $(SUBMODULE_DIR) config --local user.name); \
	email=$$(git -C $(SUBMODULE_DIR) config --local user.email); \
	target=$(BRANCH_DIR)/$(BRANCH); \
	if [ -e "$$target" ]; then \
		echo "$@: $$target already exists"; exit 1; \
	fi; \
	mkdir -p $$(dirname $$target); \
	git -C $(SUBMODULE_DIR) fetch origin || exit 1; \
	if git -C $(SUBMODULE_DIR) show-ref --verify --quiet refs/heads/$(BRANCH); then \
		git -C $(SUBMODULE_DIR) worktree add "$$target" $(BRANCH) || exit 1; \
	elif git -C $(SUBMODULE_DIR) show-ref --verify --quiet refs/remotes/origin/$(BRANCH); then \
		git -C $(SUBMODULE_DIR) worktree add --track -b $(BRANCH) "$$target" origin/$(BRANCH) || exit 1; \
	else \
		git -C $(SUBMODULE_DIR) worktree add --no-track -b $(BRANCH) "$$target" origin/main || exit 1; \
	fi; \
	cd $(SUBMODULE_DIR); \
	if [ -f .worktreeinclude ]; then \
		while IFS= read -r entry; do \
			case "$$entry" in ''|\#*|'!'*) continue ;; esac; \
			for item in $$entry; do \
				if [ -e "$$item" ] && git check-ignore -q -- "$$item"; then \
					mkdir -p "$$target/$$(dirname "$$item")" || exit 1; \
					cp -R "$$item" "$$target/$$item" || exit 1; \
					echo "$@: copied $$item"; \
				fi; \
			done; \
		done < .worktreeinclude; \
	fi; \
	(cd $(ENGINE_DIR) && $(CONFIGURE)) || exit 1; \
	echo "$@: ready at $$target, as $$name <$$email>"

worktree-clean:
	@tmp=$$(mktemp); \
	for path in $(ENGINE_DIR) $(APP_DIR); do \
		git -C $$path fetch --prune origin >/dev/null 2>&1 || { \
			echo "worktree-clean: fetch failed for $$path"; exit 1; }; \
		git -C $$path worktree list --porcelain \
			| awk '/^worktree /{tree=substr($$0,10)} /^branch /{print tree"\t"substr($$0,8)}' \
			>$$tmp.list; \
		while IFS="$$(printf '\t')" read -r tree ref; do \
			case "$$tree" in "$(WORKTREE_DIR)"/*) ;; *) continue ;; esac; \
			branch=$${ref#refs/heads/}; \
			if [ -n "$$(git -C "$$tree" status --porcelain)" ]; then \
				echo "worktree-clean: keep   $$branch. It has uncommitted changes"; continue; \
			fi; \
			reason=""; \
			if git -C $$path merge-base --is-ancestor "$$branch" origin/main 2>/dev/null; then \
				reason="merged into origin/main"; \
			else \
				upstream=$$(git -C $$path rev-parse --abbrev-ref --symbolic-full-name "$$branch@{upstream}" 2>/dev/null); \
				if [ -n "$$upstream" ] && ! git -C $$path rev-parse --verify --quiet "$$upstream" >/dev/null; then \
					reason="upstream $$upstream is gone"; \
				fi; \
			fi; \
			if [ -z "$$reason" ]; then \
				echo "worktree-clean: keep   $$branch. It is not merged"; continue; \
			fi; \
			if [ "$(DRY_RUN)" = "0" ]; then \
				git -C $$path worktree remove --force "$$tree" || exit 1; \
				git -C $$path branch -D "$$branch" >/dev/null || exit 1; \
				echo "worktree-clean: remove $$branch. It is $$reason"; \
			else \
				echo "worktree-clean: would remove $$branch. It is $$reason"; \
			fi; \
			echo removed >>$$tmp; \
		done <$$tmp.list; \
		if [ "$(DRY_RUN)" = "0" ]; then git -C $$path worktree prune; fi; \
	done; \
	if [ "$(DRY_RUN)" = "0" ]; then \
		find $(WORKTREE_DIR) -mindepth 1 -type d -empty -delete 2>/dev/null || true; \
	fi; \
	if [ ! -s $$tmp ]; then \
		echo "worktree-clean: nothing to remove"; \
	elif [ "$(DRY_RUN)" != "0" ]; then \
		echo "worktree-clean: dry run. Pass DRY_RUN=0 to apply"; \
	fi; \
	rm -f $$tmp $$tmp.list
