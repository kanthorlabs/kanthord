# 015 SEA Build & Lifecycle

## Outcome
Package Core as a Single Executable Application and define its lifecycle contract: readiness checks, known HTTP endpoint/data-dir discovery, and systemd-owned start/restart.

## Decision Anchors
- B1: ship as SEA.
- D2: no native `.node` keeps SEA and cross-arch simple.
- B7: service manager owns start/stop/restart; health and known socket/address for discovery.
- §9 Deployment.

## Stories
- `.agent/plan/stories/015-sea-build-lifecycle/001-sea-and-systemd-readiness.md` - SEA build/run, readiness, known endpoint/data paths, systemd restart, fail-fast bad config/auth.

## Verification Gate
- Build produces a SEA binary.
- SEA starts and passes readiness on linux/arm64 and linux/amd64.
- HTTP listens on `127.0.0.1:7777` in dev.
- systemd unit starts and restarts after kill.
- Invalid auth/perms/config fails fast with clear logged reason.

## Dependencies
- Epic 001.
- Epic 003 for config fail-fast.
- Epic 008 for auth startup.
- Epic 010 for health/readiness RPC.
- Epic 011 for listeners.
- Runtime modules wired by `server.ts`.

## Non-Goals
- No macOS/darwin SEA in this milestone.
- No launchd.
- No app-bundle updater.
- No bundled-Node fallback if SEA fails.

## Findings Out
- `.agent/plan/findings/15-sea-build.md`
