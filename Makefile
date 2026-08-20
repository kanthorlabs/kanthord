.DEFAULT_GOAL := help

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
ENGINE_DIR := $(ROOT)/engine
APP_DIR := $(ROOT)/apps
RUN_DIR := $(ROOT)/.dev

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
	app-up app-down app-logs

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
		grep -q "Starting application from main method" $(APP_LOG) 2>/dev/null && break; \
		kill -0 $$(cat $(APP_PID)) 2>/dev/null || { \
			echo " died"; tail -20 $(APP_LOG); rm -f $(APP_PID); exit 1; }; \
		printf "."; sleep 2; \
	done; \
	if grep -q "Starting application from main method" $(APP_LOG) 2>/dev/null; then \
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
	git submodule foreach "git push origin main" && git push