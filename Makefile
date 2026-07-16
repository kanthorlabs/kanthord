# Kanthor Core — Podman local dev sandbox.
# `make help` lists targets. See docs/md/development.md for usage.

IMAGE    := kanthord-dev
CONTAINER:= kanthord-dev
DATA_DIR := $(CURDIR)/.data
PORT     := 7777
WEB_PORT ?= 5173
SLOT     ?= /data/kanthord-auth/slots/kanthord-verify.yaml
ACCOUNT  ?= codex
MODEL    ?= gpt-5.4-mini
DASHBOARD_COMPOSE := podman compose -f compose.web.yaml

# Rootless Podman: --userns=keep-id maps the container user to your host uid so
# files written into .data/ are owned by you and keep their 0600/0700 perms.
RUN_FLAGS := --userns=keep-id \
	-v $(DATA_DIR):/data:Z \
	-p 127.0.0.1:$(PORT):$(PORT) \
	-e DATA_DIR=/data -e PORT=$(PORT)

.DEFAULT_GOAL := help

.PHONY: help machine-up machine-down machine-status data build up down restart \
	logs shell ps reset verify clean compose-up compose-down compose-logs \
	dashboard-up dashboard-down dashboard-logs dashboard-ps

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

machine-up: ## Start the Podman VM (run once per boot)
	@podman machine ls --format '{{.Name}} {{.Running}}' | grep -q 'true' \
		&& echo "podman machine already running" \
		|| podman machine start

machine-down: ## Stop the Podman VM
	podman machine stop

machine-status: ## Show Podman machine + connection status
	podman machine ls
	@podman info --format 'server={{.Version.Version}} os={{.Host.OS}}' 2>/dev/null || true

data: ## Create the .data/ mount layout on the host
	@mkdir -p $(DATA_DIR)/sockets $(DATA_DIR)/database $(DATA_DIR)/logs \
		$(DATA_DIR)/auth $(DATA_DIR)/cache
	@chmod 700 $(DATA_DIR)/auth
	@echo "ready: $(DATA_DIR)"

build: ## Build the dev image
	podman build -t $(IMAGE) -f Containerfile .

up: data ## Start Core (sandbox) in the background
	@podman rm -f $(CONTAINER) >/dev/null 2>&1 || true
	podman run -d --name $(CONTAINER) $(RUN_FLAGS) $(IMAGE)
	@echo "started: $(CONTAINER) (TCP on 127.0.0.1:$(PORT))"

down: ## Stop and remove the container
	-podman rm -f $(CONTAINER)

restart: down up ## Restart the container

logs: ## Follow container logs
	podman logs -f $(CONTAINER)

shell: ## Open a shell inside the running container
	podman exec -it $(CONTAINER) bash

ps: ## Show container status
	podman ps -a --filter name=$(CONTAINER)

verify: build up ## Build, start, and probe the .data/ boundary from the host
	@echo "waiting for container to come up..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		podman logs $(CONTAINER) 2>/dev/null | grep -q smoke_ready && break; \
		sleep 1; done
	@node scripts/dev/probe-host.mjs; status=$$?; \
		$(MAKE) --no-print-directory down; exit $$status

reset: down ## Stop container and wipe .data/ (DESTRUCTIVE)
	rm -rf $(DATA_DIR)
	@$(MAKE) --no-print-directory data

clean: down ## Remove the container and the dev image
	-podman rmi $(IMAGE)

# --- Multi-container mode (server + client share UDS via named volume) --------
compose-up: data ## Start server + client containers (UDS over named volume)
	podman-compose up -d --build

compose-down: ## Stop the compose stack (keeps the .data/ bind, removes the sock volume)
	podman-compose down

compose-logs: ## Follow logs from both compose services
	podman-compose logs -f

# --- Real Core + Vite dashboard ----------------------------------------------
dashboard-up: data ## Build and start real Core + web UI (http://127.0.0.1:5173)
	KANTHORD_SLOT="$(SLOT)" KANTHORD_ACCOUNT="$(ACCOUNT)" KANTHORD_MODEL="$(MODEL)" \
		WEB_PORT="$(WEB_PORT)" $(DASHBOARD_COMPOSE) up -d --build
	@echo "dashboard: http://127.0.0.1:$(WEB_PORT)"

dashboard-down: ## Stop and remove the real Core + web UI stack
	$(DASHBOARD_COMPOSE) down

dashboard-logs: ## Follow real Core + web UI logs
	$(DASHBOARD_COMPOSE) logs -f

dashboard-ps: ## Show real Core + web UI service status
	$(DASHBOARD_COMPOSE) ps
