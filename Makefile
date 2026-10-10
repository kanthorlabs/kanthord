.DEFAULT_GOAL := help

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
S := $(ROOT)/scripts
HOMELAB := $(ROOT)/platforms/homelab

# The daemon matches a Host and an Origin exactly, so both ports are pinned.
# Read apps/docs/api/connectivity.md before you change one.
#
# Easter egg: each port spells a constant. 31415 is pi and it belongs to the
# daemon; 27182 is Euler's number and it belongs to the browser. One pair.
export ENGINE_PORT ?= 31415
export WEB_PORT ?= 27182

.PHONY: help dev bootstrap release release-build release-smoke release-image \
	homelab-nginx homelab-kanthord homelab-cleanup \
	sync sync-status test-submodules cleanup docs-tools

help:
	@echo "Kanthord. Run make <target>."
	@echo ""
	@echo "dev"
	@echo "  dev              Start the engine (node --watch) and the dashboard (Vite)"
	@echo "                   in the foreground. Ctrl-C stops both. It first stops"
	@echo "                   any process that listens on one of the two ports"
	@echo "                   FRESH=1 starts from an empty database"
	@echo "                   daemon    http://127.0.0.1:$(ENGINE_PORT)"
	@echo "                   dashboard http://localhost:$(WEB_PORT)"
	@echo ""
	@echo "setup"
	@echo "  bootstrap        Make a clone ready to work in. It installs dependencies,"
	@echo "                   attaches the submodules to main and sets the git identity."
	@echo "                   It is idempotent, so it also repairs a drifted checkout"
	@echo ""
	@echo "release"
	@echo "  release          Cut v<YY>.<M>.<counter> from the UTC date: set the version"
	@echo "                   in engine, apps and the root, commit, tag and push all three"
	@echo "                   The root tag starts the release workflow"
	@echo "                   DRY_RUN=1 prints the next tag. VERSION=26.10.1 forces one"
	@echo "                   YES=1 skips the confirmation. A rerun resumes a partial release"
	@echo "  release-build    Build dist/kanthord-<os>-<arch>: engine, assets, dashboard"
	@echo "                   Needs an official Node 24. OUTPUT=path writes another path"
	@echo "  release-smoke    Start the binary in a disposable home and call the API"
	@echo "                   BINARY=path tests another binary"
	@echo "  release-image    Build the container image kanthord:<version> with podman"
	@echo "                   or docker. CONTAINER_ENGINE=docker selects one"
	@echo "                   IMAGE=registry/name sets the image name"
	@echo ""
	@echo "homelab"
	@echo "  homelab-nginx    Install the nginx site of the homelab on 127.0.0.1:80 with sudo"
	@echo "                   /s/kanthord goes to the daemon. / serves the nginx default page"
	@echo "                   HOMELAB_HOST=name sets the host, for example homelab.example.com"
	@echo "                   Without it, both targets read HOMELAB_HOST= from platforms/homelab/.env"
	@echo "  homelab-kanthord Run the daemon container under /s/kanthord on 127.0.0.1:31416"
	@echo "                   The first run creates its configuration in the volume"
	@echo "                   IMAGE=name:tag (kanthord:latest) CONTAINER=name VOLUME=name"
	@echo "                   HOMELAB_PORT=port moves it off 31416"
	@echo "  homelab-cleanup  Remove the daemon container. Ask before it removes the volume"
	@echo "                   YES=1 skips the question. The nginx site stays"
	@echo ""
	@echo "pending decision"
	@echo "  sync             Level main with origin/main in every repository"
	@echo "                   ON_DIRTY=stash|commit|abort   MSG=\"...\" for commit"
	@echo "                   ON_UNTRACKED=add|skip   ON_DIVERGE=rebase|merge|abort"
	@echo "                   ON_POINTER_BEHIND=forward|bump|abort"
	@echo "  sync-status      Drift table for the parent and all submodules"
	@echo "  test-submodules  Test the sync tooling in disposable repositories"
	@echo "  cleanup          Delete the configuration, data, state and cache directories"
	@echo "  docs-tools       Regenerate docs/reference/workbench/tools.md"
	@echo "                   CHECK=1 reports only, and fails when the page is stale"

dev:
	@$(S)/dev/run.sh
bootstrap:
	@$(S)/repo/bootstrap.sh

release:
	@$(S)/release/cut.sh
release-build:
	@$(S)/release/build.sh
release-smoke:
	@$(S)/release/smoke.sh
release-image:
	@$(S)/release/image.sh

homelab-nginx:
	@$(MAKE) --no-print-directory -C $(HOMELAB) nginx
homelab-kanthord:
	@$(MAKE) --no-print-directory -C $(HOMELAB) kanthord
homelab-cleanup:
	@$(MAKE) --no-print-directory -C $(HOMELAB) kanthord-cleanup

sync:
	@$(S)/sync/all.sh
sync-status:
	@$(S)/sync/status.sh
test-submodules:
	@$(S)/test/submodules.sh
cleanup:
	@$(S)/engine/cleanup.sh
docs-tools:
	@$(S)/docs/tools.sh
