# Story 07 — the program Proof goes GREEN

Epic: `.agent/plan/epics/019-http-api-skeleton.md`
Depends on: Stories 01–06.

## Change

**No new file.** `scripts/e2e/http-api-proof.sh` already exists (213 lines,
executable) and is the epic's Proof. This story makes it pass.

- **Binding: do not edit the script.** It was written and confirmed RED before
  implementation (fails at phase A, `unknown command 'serve'`). Editing it would
  destroy the contract. If a phase cannot pass, that is a defect in stories 01–06
  or a real disagreement with the epic — raise an `OPEN:` blocker naming the
  phase and the line, and stop.
- The only permitted change is to `scripts/e2e/` **as a new file** if a helper
  turns out to be missing; the proof itself stays byte-identical.

Contract points the script pins, each already covered by a story — verify the
wiring matches before running:

| script line | expectation                                                                                                                                       | owner                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `:74-83`    | `serve --port 0` prints the bound port as stdout line 1                                                                                           | Story 05                 |
| `:85-87`    | the key file beside the temp DB is mode `600`; its content is the pairing credential                                                              | Stories 01, 05           |
| `:89-91`    | `GET /api/health` → 200, `data.status === "ok"`, no session                                                                                       | Stories 03, 04           |
| `:95-98`    | unauthenticated read → 401 `unauthenticated`                                                                                                      | Story 04 step 7          |
| `:102-110`  | `POST /api/sessions` → 201, `Location`, `HttpOnly`, `SameSite=Strict`; wrong credential → 401                                                     | Stories 03, 04           |
| `:117-141`  | `GET /api/projects/:id` `data` structurally equals `kanthord get project --json`; cookie auth gives the same body                                 | Story 03's `projectView` |
| `:143-160`  | 404 `unknown_reference`, 404 `unknown_route`, 405 + `Allow: GET`, 401 on a flipped signature byte                                                 | Stories 02, 04           |
| `:163-175`  | `DELETE /api/sessions/current`: 403 without CSRF, 204 with it, zero-byte body, no `content-type`, token revoked afterwards                        | Stories 03, 04           |
| `:178-200`  | `Host: evil.example` → 403; `text/plain` body → 415; foreign `Origin` → 403; no CORS header; the credential appears in no body and in no log line | Story 04                 |
| `:203-211`  | `SIGTERM` stops the server and the port stops accepting                                                                                           | Story 05                 |

## Constraints

- The proof runs against a temp `KANTHORD_DB` (`:23`), so it must never create or
  read `.data/http-key` in the repo. Story 05's `dirname(deps.dbPath)` derivation
  is what guarantees this.
- No model, no outbound network, no daemon. The script starts exactly one
  background process and kills it in `trap cleanup EXIT` (`:14-21`).
- Do not add the proof to `npm run verify` — Proof scripts are invoked separately
  (`package.json:19` runs five commands and no `scripts/e2e/*.sh`).

## Verify

- `scripts/e2e/http-api-proof.sh` exits 0 and its last line is
  `019 ok: REST skeleton serves one resource end to end — loopback bind, JWT session resource, envelope, status map, REST semantics, hardening`.
- Each phase prints its own `A ok:` … `H ok:` line — all eight appear.
- `git status --porcelain scripts/e2e/http-api-proof.sh` is empty (the script was
  not edited).
- Run it twice in a row; both runs pass and no `/tmp` directory is left behind
  (the `trap cleanup EXIT` removes `$PD`).
- `npm run verify` exits 0.
- Proof: this story delivers the whole `Proof:` block — phases A through H.
