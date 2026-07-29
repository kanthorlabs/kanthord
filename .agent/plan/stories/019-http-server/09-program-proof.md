# Story 09 — the program proof runs green

Epic: `.agent/plan/epics/019-http-server.md` (bullet S9)
Depends on: Story 08.

## Change

`scripts/e2e/http-serve-proof.sh` is **already written and committed** (authored
with the epic; confirmed RED on the pre-implementation tree: `db migrate` passed,
then `serve --port 0` failed with `unknown command 'serve'`). This story has no
new file to create.

The work is: run it, and make the SERVER satisfy it.

- Run `scripts/e2e/http-serve-proof.sh` from the repo root.
- Every failing phase is a defect in `src/**`, not in the script. Fix the source.
- The script is in the software-engineer's lane (`scripts/*`), so it MAY be
  edited — but only to correct a genuine defect in the script itself (a wrong
  `base64` invocation, a bad `sed` expression, a race in the port-wait loop).
  **Weakening or deleting an assertion is forbidden.** If a phase looks wrong,
  raise an `OPEN:` blocker instead of relaxing it.

## Constraints

- Do not add `curl`. The request helper is `node --eval`-style
  (`$PD/req.mjs` + `fetch`) so status, headers and parsed body are all assertable.
- Do not leave a server running: the `trap cleanup EXIT` must stay.
- Do not point the proof at `.data/kanthord.db` or the developer's `.env`. It runs
  `serve` with `cwd` set to its own temp dir, which is what keeps it hermetic.

## Verify

- `scripts/e2e/http-serve-proof.sh` exits 0 and its last line starts with
  `019 ok:`.
- Phase-by-phase, the run must show: A the bound port read from the `listening`
  JSON line; B `data.version` equal to `kanthord --version`; C `401` +
  `WWW-Authenticate: Basic realm="kanthord"`, wrong key `401`, lower-case `basic`
  `200`; D `GET /` `200 text/html` plus the shell's own request returning the same
  version; E `404 unknown_route` and `405` + `Allow: GET`; F `403
host_not_allowed`, no `Access-Control-Allow-Origin` for a hostile origin, the
  own-origin echo, no `Access-Control-Allow-Credentials`, and the `API_KEY` absent
  from every body and every log line; G `serve` with no `API_KEY` exiting
  non-zero; H `SIGTERM` closing the port.
- Running the script twice in a row both times exits 0 (no leaked port, no leaked
  temp dir).
- `npm run verify` exits 0.
- Proof: delivers the whole Proof block.
