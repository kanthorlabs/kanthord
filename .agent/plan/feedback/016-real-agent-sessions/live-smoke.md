# Epic 016 Live Smoke

- result: PASS
- started_at: 2026-07-09T15:53:38.231Z
- completed_at: 2026-07-09T15:53:43.477Z
- command: `node test/live/pi-session-smoke.ts`
- pi_cli: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`
- worktree_strategy: temporary detached git worktree
- worktree_path: `/var/folders/wj/czy1ln210z17hw14m1jrng7r0000gn/T/kanthord-live-smoke-7TLHhS/worktree`
- prompt_marker: `KANTHORD_LIVE_SMOKE_OK`
- duration_ms: 5138

## Observations

- real_pi_session_spawn: PASS - pi CLI completed and returned the expected marker.
- worktree_spawn: PASS - command ran with cwd set to the temporary worktree path.
- teardown: PASS - temporary worktree removal was attempted after the run.
- hermetic_default_suite: PASS - this file is under `test/live/` and is not matched by `npm test`.
- context_size_signal_fidelity: NOT_OBSERVED - the pi CLI text-mode smoke does not expose a context-size signal in stdout/stderr.
- cost_signal_fidelity: NOT_OBSERVED - the pi CLI text-mode smoke does not expose cost accounting in stdout/stderr.

## Output Summary

- stdout_contains_marker: true
- stdout_bytes: 23
- stderr_bytes: 0
