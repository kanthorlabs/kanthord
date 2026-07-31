#!/usr/bin/env bash
# lane-check.sh <role> <path> — exit 0 if the role may modify the path.
# Roles: test-engineer | software-engineer. Paths are repo-relative.
# Used by /work Step 5g.1 as the lane-ownership predicate.
set -u

role="${1:?usage: lane-check.sh <role> <path>}"
path="${2:?usage: lane-check.sh <role> <path>}"

# Always forbidden to every role (note: in bash case patterns, * matches "/").
# The pipeline guards under scripts/ stay locked even though the rest of
# scripts/ is writable by the software-engineer.
case "$path" in
  .agent/plan/*|.claude/*|.opencode/*|\
  scripts/lane-check.sh|scripts/verify-handoff.mjs|scripts/memory-append-only.sh|\
  package.json|package-lock.json|tsconfig*.json|*.config.*|\
  ui/package.json|ui/tsconfig*.json|components.json|\
  AGENTS.md|Containerfile|compose.yaml|Makefile)
    exit 1 ;;
esac

# Both roles own the TDD working area (drafts, history, journals).
case "$path" in
  .agent/tdd/*) exit 0 ;;
esac

# Both roles may write committed format/spec docs under docs/.
case "$path" in
  docs/*) exit 0 ;;
esac

# EPIC 026 decision 8: ui/** is TDD-role territory, split the same way src/ is —
# tests to the test-engineer, everything else to the software-engineer. Without
# this every dashboard epic (026.1–026.8) would be maintainer-only forever.
# ui/package.json, ui/tsconfig*.json and ui/*.config.* stay maintainer-only via
# the always-forbidden block above.
case "$role" in
  test-engineer)
    case "$path" in
      src/*.test.ts|src/*.spec.ts) exit 0 ;;
      ui/*.test.ts|ui/*.test.tsx|ui/*.spec.ts|ui/*.spec.tsx) exit 0 ;;
    esac
    ;;
  software-engineer)
    case "$path" in
      src/*.test.ts|src/*.spec.ts) exit 1 ;;
      src/*.ts) exit 0 ;;
      ui/*.test.ts|ui/*.test.tsx|ui/*.spec.ts|ui/*.spec.tsx) exit 1 ;;
      ui/*) exit 0 ;;
      scripts/*) exit 0 ;;
    esac
    ;;
esac

exit 1
