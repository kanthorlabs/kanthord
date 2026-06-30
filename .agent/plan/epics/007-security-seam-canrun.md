# 007 Security Seam CanRun

## Outcome
Provide one policy entrypoint, `canRun(tool, args, ctx) -> allow | deny`, default-allow with a small literal denylist.

## Decision Anchors
- D4: default allow for the observed single-machine case.
- B3: minimal seam, one `canRun`, small denylist.
- §4 Security seam.
- D9: real host safety is the Podman sandbox.

## Stories
- `.agent/plan/stories/007-security-seam-canrun/001-default-allow-denylist.md` - pure synchronous default-allow `canRun` with literal denylist rules.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.

## Dependencies
- Epic 001.

## Non-Goals
- No policy engine, approval system, ACL framework, symlink defense, prompt-injection defense, or system-wide call-site proof yet.
- Tool routing coverage lands in Epic 009.

## Findings Out
- none
