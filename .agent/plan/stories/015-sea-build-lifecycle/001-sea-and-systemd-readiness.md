# Story 001 - SEA And Systemd Readiness

Epic: `.agent/plan/epics/015-sea-build-lifecycle.md`

## Goal
Core can be packaged as a Node SEA, started by systemd in foreground mode, discovered through its known HTTP endpoint/data-dir, and judged ready only after critical startup dependencies are usable.

## Acceptance Criteria
- Core builds into a SEA that runs without a separate Node install.
- SEA runs on linux/arm64 and linux/amd64.
- Readiness means all of: config loaded, auth verifier usable on remote path, storage opened, HTTP/gRPC-Web listener bound, RPC handler serving.
- Liveness is distinct from readiness.
- Dev HTTP endpoint resolves to `127.0.0.1:7777`.
- Remote bind is deployment-owned.
- Runtime data resolves to platform-absolute data dirs: VPS `/var/lib/kanthor/` or `${XDG_STATE_HOME}/kanthor`, container `/data`; macOS deferred.
- Clients can discover the resolved HTTP endpoint.
- Core runs in foreground and does not self-daemonize.
- systemd `Restart=always` starts it and restarts after process exit.
- Bad auth/perms/config makes Core fail to start with a clear logged reason.

## Constraints
- Ship as SEA (B1).
- Pure JS/no native `.node` is required (D2).
- systemd owns Linux/VPS/container lifecycle.
- launchd and app-bundle update are deferred.
- No bundled-Node or alternative-packaging fallback; SEA failure escalates B1.
- Startup wiring is owned by this capstone; internal module behavior remains owned by earlier epics.

## Verification Gate
- SEA build runs.
- SEA readiness probe passes on linux/arm64 and linux/amd64.
- systemd restart-after-kill check passes.
- bad config/auth/perms fail-fast check passes.

### Task 015-SPIKE - Node SEA feasibility

**Input:** `.agent/plan/findings/15-sea-build.md`.

**Action - RED:** none - spike.

**Action - GREEN:** Confirm Node 24 SEA can bundle the ESM app and all dependencies, handle assets, and run on linux/arm64 and linux/amd64. Record Node version, flags, asset handling, dependency limits, repro steps, and go/escalate outcome.

**Action - REFACTOR:** none.

**Verify:** Findings file records the SEA outcome. If SEA cannot package as-is, escalate B1 instead of adding fallback packaging.

### Task 015-RED - SEA lifecycle harness

**Input:** lifecycle/build tests or harness files chosen by the repo, plus `packages/core/src/**/*.test.ts` where unit checks fit.

**Action - RED:** Add harness coverage for SEA start/readiness, known HTTP endpoint/data dirs, systemd restart-after-kill, and bad auth/perms/config fail-fast behavior.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** Lifecycle gate fails because SEA/lifecycle wiring is missing.

### Task 015-GREEN - SEA build and lifecycle wiring

**Input:** `package.json`, `package-lock.json`, build scripts/config, systemd unit files, `packages/core/src/**`, `apps/daemon/**`, `Containerfile`, CI/harness files if present.

**Action - RED:** none - opened by Task `015-RED`.

**Action - GREEN:** Implement SEA build, foreground server startup, readiness contract, endpoint/data-dir discovery, systemd unit, and fail-fast startup wiring.

**Action - REFACTOR:** Keep build packaging separate from runtime readiness checks.

**Verify:** Full Epic Verification Gate passes.
