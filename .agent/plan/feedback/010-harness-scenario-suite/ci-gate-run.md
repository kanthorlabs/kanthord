# Epic 010 CI Gate Run

Status: **pending refreshed CI run for this gate-candidate commit**.

## Evidence Contract

Required for G4 in `.agent/plan/e2e/phase1-e2e-testsuite.md`:

- CI run URL/artifact: pending after this change is committed and pushed.
- Gate-candidate commit SHA: pending after this change is committed.
- Workflow file: `.github/workflows/ci.yaml`.
- Workflow name: `ci`.
- Commands run: `npm run typecheck`, `npm test`.
- Guard-active proof: `npm test` preloads `src/harness/no-network-guard.ts` through
  `node --import`, so every Node test worker installs the guard before loading test
  modules. The CI log must show the guard self-tests in `src/harness/harness.test.ts`
  passing for blocked network primitives and credential reads.

## Last Published CI Reference

- Run URL: https://github.com/kanthorlabs/kanthord/actions/runs/28733028131
- Commit SHA: `1acf10c56b22fd0b6993c0e85ce43a81336a9f07`
- Workflow: `ci` (`.github/workflows/ci.yml`, before rename to `ci.yaml`)
- Result: success
- Commands visible in workflow: `npm run typecheck`, `npm test`
- Note: this run predates the runner-level `--import` guard preload in `npm test`,
  so it is retained only as prior reference evidence. It is not the final G4 gate
  artifact for the next gate-candidate commit.

## Local Verification After G3 Fix

- Date: 2026-07-05
- Node: `v24.12.0`
- Commit before edits: `1acf10c56b22fd0b6993c0e85ce43a81336a9f07`
- `npm run typecheck`: pass
- `node --import ./src/harness/no-network-guard.ts --test src/harness/harness.test.ts`: pass,
  `12` passed, `0` failed; proves blocked `net`, `tls`, `dns`, `dgram`, `http`,
  `https`, `http2`, global `fetch`, credential env reads, and provider credential
  file reads.
- `node --import ./src/harness/no-network-guard.ts --test src/daemon/status-server.test.ts`:
  pass, `6` passed, `0` failed; proves the loopback-only TC-11 exemption still works.
- `npm test`: pass, `313` passed, `0` failed, `0` todo, using
  `node --import ./src/harness/no-network-guard.ts --test "src/**/*.test.ts"`.

## Final Gate Entry

Fill this section after the new commit's CI run is green:

- CI run URL/artifact:
- Gate-candidate commit SHA:
- Verified by:
- Verification date:
- Commands observed:
- Guard-active proof observed:
