# Story 06 — the UI shell row

Epic: `.agent/plan/epics/019-http-server.md` (bullet S6)
Depends on: Story 05.

## Change

1. **New file `src/apps/http/ui.ts`** — one self-contained HTML document, no
   bundler, no framework, no external URL:

   ```ts
   /** The UI walking skeleton: fetches /healthz and renders the version. */
   export const UI_SHELL_HTML: string;

   export function uiShell(): string; // returns UI_SHELL_HTML
   ```

   The document must contain, exactly:
   - `<!doctype html>` and `<html lang="en">`;
   - `<title>kanthord</title>`;
   - an element `<pre id="health">loading…</pre>`;
   - one inline `<script>` that calls
     `fetch("/healthz", { credentials: "same-origin", headers: { accept: "application/json" } })`,
     parses JSON, and writes `body.data.version` into
     `document.getElementById("health").textContent`, with a `catch` that writes
     the error text instead;
   - no `<script src=`, no `<link rel="stylesheet"`, no `http://` or `https://`
     substring anywhere — a strictly self-contained page.

2. **`src/apps/http/routes.ts`** — add the `ui.get` row as the SECOND element of
   `ROUTES` (after `health.get`):

   ```ts
   {
     id: "ui.get",
     method: "GET",
     path: "/",
     successStatus: 200,
     kind: "html",
     cliCommands: [],
     decode: () => ({}),
     run: async () => uiShell(),
     present: (result) => result as string,
   }
   ```

## Constraints

- The shell is served by a route-table row, not by a special case in `app.ts`.
  The `kind: "html"` branch added in Story 05 is what renders it.
- The page must work with HTTP Basic auth: the browser already holds the
  credentials after its prompt, and `credentials: "same-origin"` keeps them on
  the `fetch`. No token, no cookie, no login form.
- Do not introduce a static-file reader; the document is a string constant.

## Verify

- New test `src/apps/http/ui.test.ts` (`node --test src/apps/http/ui.test.ts`):
  - `UI_SHELL_HTML` contains `<!doctype html>`, `<title>kanthord</title>`,
    `id="health"`, `/healthz`, and `same-origin`.
  - `UI_SHELL_HTML` contains none of: `<script src`, `<link rel="stylesheet"`,
    `http://`, `https://`.
  - `uiShell()` returns the same string (identity, so no per-call work).
- Appended to `src/apps/http/app.test.ts`:
  - `GET /` with `AUTH` → `200`, `content-type` starts `text/html`, and
    `res.text` equals `UI_SHELL_HTML` exactly (no envelope wrapper).
  - `GET /` without credentials → `401` with the `www-authenticate` challenge, so
    the browser prompts before it ever sees the page.
- `src/apps/http/routes.test.ts` policy and REST-shape suites still pass with two
  rows (they iterate `ROUTES`, so no edit is needed).
- `npm run verify` exits 0.
- Proof: delivers phase D (`GET /` is `200 text/html` referencing `/healthz`).
