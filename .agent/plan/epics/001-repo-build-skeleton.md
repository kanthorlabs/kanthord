# 001 Repo & Build Skeleton

## Outcome
Turn the flat hello-world skeleton into a TypeScript workspace, proven by one
real cross-package import, behind a single green `typecheck` + `test` gate.

## Decision Anchors
- B1: SEA is a real target, so no native deps.
- §3 Tech Stack: Node.js 24+, TypeScript, `node:test`.
- §Repository Structure: `packages/*`, `apps/*`, and `proto/` are the binding layout contract.

## Stories
- `.agent/plan/stories/001-repo-build-skeleton/001-workspace-cross-package-import.md` - workspace skeleton with a tested `apps/daemon` -> `packages/core` import.

## Verification Gate
- From the repo root, `npm run typecheck` exits 0.
- From the repo root, `npm test` exits 0.
- The compiled and tested set includes an `apps/daemon` import from `packages/core`.

## Dependencies
- None. Builds on the committed hello-world skeleton (`9be327f`).

## Non-Goals
- No empty speculative directories beyond `packages/core` and `apps/daemon`.
- No new test framework dependency.
- No native dependency guard yet; that starts with the first dependency-adding epic.

## Findings Out
- none
