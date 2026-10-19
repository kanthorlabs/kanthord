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
	homelab-nginx homelab-stats homelab-kanthord homelab-cleanup \
	sync sync-status test-submodules cleanup docs-tools \
	e2e e2e-start e2e-watch e2e-stop e2e-restart e2e-resume e2e-scale e2e-check pi-tools-update

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
	@echo "                   The binary embeds the pi tools (fd, rg) of its target"
	@echo "                   Needs an official Node 24. OUTPUT=path writes another path"
	@echo "  release-smoke    Start the binary in a disposable home and call the API"
	@echo "                   BINARY=path tests another binary"
	@echo "  release-image    Build the container image kanthord:<version> with podman"
	@echo "                   or docker. CONTAINER_ENGINE=docker selects one"
	@echo "                   IMAGE=registry/name sets the image name"
	@echo ""
	@echo "homelab"
	@echo "  homelab-nginx    Install the nginx site of the homelab on 127.0.0.1:80 with sudo"
	@echo "                   /s/kanthord goes to the daemon. / serves the floating market homepage"
	@echo "                   HOMELAB_HOST=name sets the host, for example homelab.example.com"
	@echo "                   Without it, both targets read HOMELAB_HOST= from platforms/homelab/.env"
	@echo "  homelab-stats    Install the timer that writes the CPU, RAM and disk usage"
	@echo "                   of the homepage every 60 s, with sudo"
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
	@echo ""
	@echo "e2e"
	@echo "  e2e              Start everything for an e2e run in one step. RUN=name"
	@echo "                   (todoapp-<yymmdd-HHMM>). PLACEMENT=server|worker (default server)."
	@echo "                   It installs the engine dependencies, starts make dev in the background"
	@echo "                   when the daemon is down, then runs e2e-start."
	@echo "                   GitHub calls use E2E_GH_TOKEN only. Dev log in .dev/e2e/dev.log"
	@echo "  e2e-start        Start an e2e run against the daemon of make dev. RUN=name"
	@echo "                   PLACEMENT=server|worker (default server)."
	@echo "                   At server placement: writes placement into each worker binding,"
	@echo "                   starts no worker processes; the daemon pool manages the instances."
	@echo "                   At worker placement: spawns a process for each instance."
	@echo "                   It creates the LLM and repository credentials, the SSH key of the run,"
	@echo "                   the github.com host key pin, a write deploy key, enablements,"
	@echo "                   a project, the base branch e2e/<RUN> from the fixture, the plan,"
	@echo "                   the workers and the GitHub poll inbound of the repository."
	@echo "                   It pauses the project right after the creation,"
	@echo "                   so that no worker claims a node. PAUSED=0 keeps the project active."
	@echo "                   CONFIG=path (scripts/e2e/todoapp.json). Files in .dev/e2e/<RUN>"
	@echo "  e2e-watch        Print project state changes, node changes, execution stops,"
	@echo "                   instance changes (server) or worker exits (worker), and PRs. RUN=name"
	@echo "  e2e-stop         At server placement: pause the project."
	@echo "                   STOP=daemon stops the daemon of make dev instead."
	@echo "                   At either placement, STOP=daemon deletes the deploy key of the run."
	@echo "                   At worker placement: stop the worker processes. RUN=name"
	@echo "  e2e-restart      At server placement: restart the daemon of make dev."
	@echo "                   At worker placement: restart the worker processes on the current"
	@echo "                   engine code. RUN=name"
	@echo "  e2e-resume       Resume the paused project of a run, so that workers claim nodes. RUN=name"
	@echo "  e2e-scale        Change instance_count of a worker binding. RUN=name BINDING=name COUNT=n"
	@echo "                   Refuses a run at the worker placement"
	@echo "  e2e-check        Run every suite, lint, format check, scratch-file check and secret check"
	@echo "                   on the head of the base branch of a run, in a scratch clone. RUN=name"
	@echo "                   Prints one line per check and RESULT pass or RESULT fail."
	@echo "                   Clone lives in .dev/e2e/<RUN>/check/ of the main checkout."
	@echo ""
	@echo "pi tools"
	@echo "  pi-tools-update  Pin one pi tool (fd, rg) to a release in engine/static/pi-tools.json"
	@echo "                   TOOL=rg VERSION=15.1.0. It refuses a release younger than"
	@echo "                   minimumReleaseAge"

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
homelab-stats:
	@$(MAKE) --no-print-directory -C $(HOMELAB) stats
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
e2e:
	@$(S)/e2e/run.sh
e2e-start:
	@$(S)/e2e/start.sh
e2e-watch:
	@$(S)/e2e/watch.sh
e2e-stop:
	@$(S)/e2e/stop.sh
e2e-restart:
	@$(S)/e2e/restart.sh
e2e-resume:
	@$(S)/e2e/resume.sh
e2e-scale:
	@$(S)/e2e/scale.sh
e2e-check:
	@$(S)/e2e/check.sh
pi-tools-update:
	@$(S)/engine/pi-tools-update.sh
