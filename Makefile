# Makefile — one entry point for the /e2e end-to-end run.

SHELL := /bin/bash

# Every `make e2e` is a fresh run: a new timestamp tag, a new isolated DB under
# .data/e2e-<tag>/, and a new fixture branch. Inputs come from .data/e2e.env
# (see .claude/commands/e2e.md). The phase scripts under scripts/e2e/ are the
# real interface; this target just picks the tag and chains them.
#
# P0 asks before it writes to the remote, so run this from a terminal — or pass
# E2E_CONFIRM_PUSH=1 (plus E2E_CONFIRM_PUBLISH=1 when E2E_MODE=delivery).
# The report is written whatever happens, and the exit status is the first phase
# failure so a blocked run never reads as a success.
.PHONY: e2e
e2e:
	@tag="$(shell date +%Y%m%d-%H%M%S)"; \
	echo "== /e2e tag $$tag"; \
	export E2E_TAG="$$tag"; rc=0; \
	{ scripts/e2e/preflight.sh && \
	  scripts/e2e/provider-cycle.sh && \
	  scripts/e2e/setup-graph.sh; } || rc=$$?; \
	if [ "$$rc" = 0 ]; then scripts/e2e/drive-run.sh || rc=$$?; fi; \
	if [ "$$rc" = 0 ]; then scripts/e2e/contract-proof.sh || rc=$$?; fi; \
	scripts/e2e/e2e-report.sh || true; \
	echo "== /e2e tag $$tag done"; \
	exit $$rc
