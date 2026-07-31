# Story S8 — make the Proof print `026.1 ok: …`

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md` decision 1 and `## Verification Gate`
Depends on: Stories S1–S7

## Change

**No script change is needed.** `scripts/e2e/ui-browser.mjs` (136 lines) and `scripts/e2e/ui-system-proof.sh` (197 lines) are already written, and the one fixture defect they carried is already fixed in the tree (2026-07-31, by the human + assistant): `ui-system-proof.sh:95` now reads `.data.id`, because `POST /api/project` answers `201` with the success envelope `{"data":{"id":"<ulid>"}}` (`src/apps/http/routes.ts:548-559`, `src/apps/http/app.ts:300`) — the same path EPIC 026's passing proof uses (`scripts/e2e/ui-shell-proof.sh:275`).

S8 is therefore a **verification-only** story: run the gate and the Proof, and fix `ui/` until both are green. Do **not** weaken, delete or rewrite any assertion, selector, phase, threshold or the final `026.1 ok: …` line. If a phase fails, the defect is in `ui/`, not in the Proof.

## Constraints

- Do not edit `scripts/e2e/ui-browser.mjs` or `scripts/e2e/ui-system-proof.sh` at all.
- Do not change any assertion, selector, phase, threshold or the final `026.1 ok: …` line.
- Do not add a dependency and do not make the Proof install Chromium — it must keep exiting with the exact `npx playwright install chromium` message when the browser is absent (`ui-system-proof.sh:57-62`).
- Chromium must already be installed in the environment. Run `npx playwright install chromium` once, outside the Proof, if phase A reports it missing.

## Verify

- `npm run verify` exits 0 (backend typecheck + backend tests + `verify:handoff` + backend lint + `ui:typecheck` + `ui:lint` + `ui:test` + `build:ui` + `db status`).
- `scripts/e2e/ui-system-proof.sh` exits 0 and its last line starts with `026.1 ok:`. All phases must pass, in particular:
  - **A** — `build:ui` produces `ui/dist/index.html`; Chromium launches.
  - **B** — `#/` lands on `#/inbox`; `[data-testid="global-shell"]` mounted; `[data-testid="global-nav"] a` count is 3; nav text contains `Inbox`, `Projects`, `Operations`; `consoleErrors.length === 0`.
  - **C** — `[data-testid="health-version"]` visible and containing the version from the repo's `package.json` (currently `27.8.1`); `[data-testid="freshness-updated"]` contains `Updated`; the click on `[data-testid="freshness-refresh"]` succeeds.
  - **C2** — the daemon log holds at least two more `"path":"/healthz"` lines than before the browser ran.
  - **D** — a cold load of `#/project/<id>/overview` mounts `[data-testid="project-shell"]`, `[data-testid="project-nav"] a` count is 5 with the five labels, `[data-testid="breadcrumb"]` contains `proof-026-1`, and `[data-testid="not-built-yet"]` text contains `026.2`.
  - **E / E2** — `#/definitely-not-a-route` shows `[data-testid="async-missing"]` with a non-blank body; `GET /nope` still answers `404 unknown_route`.
  - **F** — all six of `--role-neutral`, `--role-active`, `--role-attention`, `--role-blocked`, `--role-danger`, `--role-success` resolve to non-empty values on `document.documentElement`.
  - **G / G2** — no request the page issued carried an `Authorization` header; the API key appears in neither the served index nor the daemon log.
- Regression: EPIC 026's proof still passes — `scripts/e2e/ui-shell-proof.sh` exits 0 and prints `026 ok: …`.
- Proof: every `PASS`/phase line of the epic Proof. S8 is the phase that closes the contract.
