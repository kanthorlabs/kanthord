#!/usr/bin/env bash
# lane-check.sh <role> <path> — exit 0 if the role may modify the path.
# Roles: test-engineer | software-engineer. Paths are repo-relative.
# Used by /work Step 5g.1 as the lane-ownership predicate.
set -u

role="${1:?usage: lane-check.sh <role> <path>}"
path="${2:?usage: lane-check.sh <role> <path>}"

# Always forbidden to every role (note: in bash case patterns, * matches "/").
case "$path" in
  .agent/plan/*|.claude/*|.opencode/*|scripts/*|\
  package.json|package-lock.json|tsconfig*.json|*.config.*|\
  AGENTS.md|Containerfile|compose.yaml|Makefile)
    exit 1 ;;
esac

# Both roles own the TDD working area (drafts, history, journals).
case "$path" in
  .agent/tdd/*) exit 0 ;;
esac

case "$role" in
  test-engineer)
    case "$path" in
      src/*.test.ts|src/*.spec.ts) exit 0 ;;
    esac
    ;;
  software-engineer)
    case "$path" in
      src/*.test.ts|src/*.spec.ts) exit 1 ;;
      src/*.ts) exit 0 ;;
    esac
    ;;
esac

exit 1
