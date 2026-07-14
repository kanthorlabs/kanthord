#!/usr/bin/env bash
# Lane-ownership predicate for the TDD pipeline (see .claude/commands/work.md).
#   scripts/lane-check.sh <role> <scope> <path>   ->  exit 0 = in-lane, 1 = out-of-lane
#
# Roles: test-engineer | software-engineer | reviewer-engineer
# Scope: core | web | all   (core owns src/; web owns clients/web/ — Epic 020 SU7)
#
# NOTE: `case` patterns are not pathname globs — a single `*` matches `/` too,
# so `src/*.test.ts` already covers nested dirs like `src/a/b.test.ts`.
set -euo pipefail

role="${1:?usage: lane-check.sh <role> <scope> <path>}"
scope="${2:?usage: lane-check.sh <role> <scope> <path>}"
path="${3:?usage: lane-check.sh <role> <scope> <path>}"
path="${path#./}"

# --- Always forbidden to every role (locked plan, pipeline, toolchain/config) ---
case "$path" in
  .agent/plan/*|.claude/*) exit 1 ;;
  package.json|package-lock.json|tsconfig*.json|*.config.*) exit 1 ;;
  scripts/*|Containerfile|compose.yaml|Makefile) exit 1 ;;
  *generated*/*|*__generated__*) exit 1 ;;   # generated proto/codegen output
  # web toolchain + maintainer-owned surfaces (Epic 020 SU7 / DESIGN §2):
  DESIGN.md) exit 1 ;;                                  # design contract
  clients/web/package.json|clients/web/package-lock.json) exit 1 ;;
  clients/web/components.json|clients/web/tsconfig*.json) exit 1 ;;
  clients/web/src/components/ui/*) exit 1 ;;            # vendored shadcn primitives (HD-A hard deny; §P2)
  clients/web/src/styles/globals.css) exit 1 ;;        # token file
  clients/web/src/gen/*) exit 1 ;;                     # generated Connect-Web client
esac

# --- Shared writable surfaces (drafts + this role's own journal + shared gotcha checklists) ---
# The shared gotcha files live directly under .agent/tdd/memory/ (e.g. ts-gotchas.md);
# both engineer personas instruct appending pitfalls to them as they are hit.
case "$path" in
  .agent/tdd/.${role}-response-*.md) exit 0 ;;
  .agent/tdd/memory/${role}/*)       exit 0 ;;
  .agent/tdd/memory/*-gotchas.md)    exit 0 ;;
esac

# --- Is this a test file? ---
is_test=0
case "$path" in
  src/*.test.ts|src/*.spec.ts) is_test=1 ;;
esac
# web variant: component/unit tests (*.test.ts[x]) + E2E under clients/web/e2e/
case "$scope" in
  web|all)
    case "$path" in
      clients/web/src/*.test.ts|clients/web/src/*.test.tsx|clients/web/e2e/*) is_test=1 ;;
    esac ;;
esac

case "$role" in
  test-engineer)
    [ "$is_test" -eq 1 ] && exit 0 || exit 1 ;;
  software-engineer)
    case "$path" in
      src/*.ts)      [ "$is_test" -eq 1 ] && exit 1 || exit 0 ;;
      test/live/*.ts) exit 0 ;;   # maintainer live-smoke scripts (excluded from npm test); e.g. test/live/pi-session-smoke.ts, provider-smoke.ts
      # web production: composites, features, design/, locators.ts (NOT ui/, globals.css,
      # gen/ — those are denied above). Test files fall to the is_test deny.
      clients/web/src/*.tsx|clients/web/src/*.ts)
                     [ "$is_test" -eq 1 ] && exit 1 || exit 0 ;;
      *)             exit 1 ;;
    esac ;;
  reviewer-engineer)
    exit 1 ;;   # reviewer is read-only — edits nothing
  *)
    exit 1 ;;
esac
