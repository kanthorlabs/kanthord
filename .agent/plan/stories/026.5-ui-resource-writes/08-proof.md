# Story 8 — the Proof prints `026.5 ok: …`

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (Verification Gate)
Depends on: Stories 1–7.

`scripts/e2e/ui-resources-proof.sh` **already exists** (225 lines, executable,
committed — index F1). This story does not author it. It adds the two setup steps
the script is missing and replaces two fragile navigation steps. **No assertion,
no `eq`/`ne`/`contains`/`absent` call, and no phase heading is changed.**

`scripts/e2e/**` is in the software-engineer lane
(`scripts/lane-check.sh:50`, `scripts/*) exit 0`), and
`scripts/e2e/ui-browser.mjs` must not be touched.

## Change

### Edit 1 — give the daemon its own HOME (`ui-resources-proof.sh:70`)

Replace:

```bash
( cd "$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
```

with:

```bash
# AddResource derives a repository's default local home from $HOME
# (src/app/resource/add-resource.ts:55-66) and homePathExists() calls the real
# fs.access (src/composition.ts:310-318). Point HOME at the temp dir so phase F
# operates on a path this Proof owns and cleans up.
( cd "$PD" && export HOME="$PD" && exec node "$ROOT/src/main.ts" serve --port 0 ) >"$PD/serve.log" 2>&1 &
```

`homedir()` is called in exactly one place in `src/` (index F7), so no other
behaviour changes.

### Edit 2 — create the cached home phase F needs (after `ui-resources-proof.sh:97`)

Append immediately after `echo "    project: $PROJECT"`:

```bash
# Phase D creates the repository with no explicit path, so the daemon derives
# <HOME>/.kanthord/repos/example.invalid/one from
# https://example.invalid/one.git. Phase F's CacheConflictError fires only when
# that directory EXISTS (src/app/resource/update-repository.ts:53-59), and only
# the confirmed continuation empties the stored path — which is what :223 asserts.
REPO_HOME="$PD/.kanthord/repos/example.invalid/one"
mkdir -p "$REPO_HOME"
echo "    cached home: $REPO_HOME"
```

Without this directory the first PATCH in phase F succeeds outright, the
confirmation never renders, `reclone` is never sent, and `:223` fails with a
non-empty `path`.

### Edit 3 — capture the created ids (inside the steps heredoc)

In phase C, immediately after
`eq("the credential was created", 201, credCreate.status());` (`:121`), insert:

```js
const credId = (await credCreate.json()).data.id;
```

In phase D, immediately after
`eq("the repository was created", 201, repoCreate.status());` (`:140`), insert:

```js
const repoId = (await repoCreate.json()).data.id;
```

### Edit 4 — reach the workspace by URL, not by a table row (`:147-148` and `:163-164`)

Epic decision 10 puts edit on the resource page, and a collection row click opens
a read-only `DetailPane` instead of navigating (index F14). Replace, in phase E:

```js
await goto(`#/project/${project}/resource/credential`);
await page.locator("tbody tr", { hasText: "proof-credential" }).first().click();
```

with:

```js
await goto(`#/project/${project}/resource/credential/${credId}`);
```

and, in phase F:

```js
await goto(`#/project/${project}/resource/repository`);
await page.locator("tbody tr", { hasText: "proof-repository" }).first().click();
```

with:

```js
await goto(`#/project/${project}/resource/repository/${repoId}`);
```

`goto` is the driver's cold `networkidle` load at a hash URL
(`scripts/e2e/ui-browser.mjs:95-101`), so each phase starts from a fresh page,
which is stricter than the row click it replaces.

### Edit 5 — make the lone-`reclone` check live, without capturing a secret

`:183-192` filters `requests` on `r.postData`, which the driver never records
(`scripts/e2e/ui-browser.mjs:72-82`), so the check can never fire. The driver must
**not** start recording bodies — that array would then hold the rotation secret
(decision 3). Record bodies inside the steps module instead, for the repository
PATCH route only, which never carries a secret.

Insert after the `has` helper in the steps heredoc, and **delete** `:108`
(`const bodyOf = (r) => r.postData ?? "";`) and `:202` (`void bodyOf;`), which the
old vacuous filter was the only user of:

```js
// The driver records no request body, and must not start: that array would
// hold the rotation secret (EPIC 026.5 decision 3). Capture bodies here, for
// the repository PATCH route ONLY — it never carries a secret.
const repoPatchBodies = [];
page.on("request", (req) => {
  if (req.method() === "PATCH" && req.url().includes("/api/repository/")) {
    repoPatchBodies.push(req.postData() ?? "");
  }
});
```

Then replace `:183-192` with:

```js
eq("both repository PATCH bodies were captured", 2, repoPatchBodies.length);
const lonelyReclone = repoPatchBodies.filter((raw) => {
  try {
    const b = JSON.parse(raw);
    return b.reclone === true && b.remoteUrl === undefined;
  } catch {
    return false;
  }
});
```

`:192`'s `if (lonelyReclone.length > 0) throw …` line stays byte-identical. The
new `eq` makes the check non-vacuous: phase F issues exactly two repository
PATCHes — the `409` attempt and the confirmed `200` continuation. The listener is
registered once on the single `page` object, and `goto` reuses that page, so it
survives every cold load.

### Nothing else

- `ui-resources-proof.sh:149` (`page.locator('[data-testid="rotate-secret"]').click()`)
  stays. Story 3 pins `rotate-secret` as a section whose form is always rendered
  and whose blank submit issues no request, so this click is inert whatever it
  lands on.
- Do not add tracing, video or screenshots (decision 3). The driver configures
  none today; keep it that way.
- Do not touch `scripts/e2e/ui-browser.mjs` or any sibling `ui-*-proof.sh`.

## Sanctioned deviations from the epic's Story 8 wording

Reviewed and approved by the engineer on 2026-07-31, so `/work` proceeds without
raising an `OPEN:` blocker. Recorded here because AGENTS.md forbids deviating from
an epic directive silently.

1. The epic bullet says Story 8 **writes** `scripts/e2e/ui-resources-proof.sh`.
   The file already exists and is committed (index F1), so this story edits it.
2. The epic bullet says the script must pass "without its assertions being
   edited". Edits 1–4 change setup and navigation only, and hold to that. **Edit 5
   changes one assertion region** — it replaces a filter that can never fire with
   one that can, and adds a count assertion. The invariant asserted is strictly
   stronger, and the epic's own Verification Gate demands it ("nothing sends
   `reclone` alone").
3. The scope of edit 5 is deliberately narrow: bodies are captured for
   `PATCH /api/repository/*` only, never for `PATCH /api/credential/*`, so no
   secret is ever held in a captured body.

## Constraints

- Only `scripts/e2e/ui-resources-proof.sh` may be edited by this story. If a phase
  fails because of a `ui/**` defect, fix `ui/**` — never relax the assertion.
- The script must stay hermetic: everything it writes lives under `$PD` (which is
  why edit 1 exists), and the `cleanup` EXIT trap already removes it.
- No npm script is added — `package.json` is lane-forbidden
  (`scripts/lane-check.sh:16`) and the proofs are invoked by path.

## Verify

- `bash scripts/e2e/ui-resources-proof.sh` exits `0` and its last line is
  exactly:

  ```
  026.5 ok: four typed forms, complete auth object, secret never read back or logged, remote change named honestly and only emptied the home pointer
  ```

  with phases `A`, `B`, `C2` and `F2` each printing their heading, and
  `--- C2` reporting no occurrence of
  `sentinel-secret-must-never-be-read-back` in the credential collection, the
  credential detail, or `serve.log`.

- Edit 5 is non-vacuous, proved two ways:
  - the run passes `eq("both repository PATCH bodies were captured", 2, …)`,
    so bodies really were captured;
  - temporarily make `remoteUrlPatchBody` (Story 1) emit `reclone` with no
    `remoteUrl`, re-run, and confirm the script fails with
    `reclone was sent without a remoteUrl change`; then revert.
- `repoPatchBodies` is appended to **only** when the URL includes
  `/api/repository/`, so no credential PATCH body is ever captured. Confirm by
  reading the listener; there is no second `page.on("request")` in the file.
- Re-run the script a second time in the same shell: it exits `0` again (the temp
  dir is fresh, `mkdir -p` is idempotent, nothing is left running — confirm with
  `pgrep -f "main.ts serve"` returning nothing after the run).
- The five sibling UI proofs still exit `0`, because Stories 5 and 7 edited files
  they share (`ui/src/components/danger-confirm.tsx`,
  `ui/src/lib/status-role.ts`, `ui/src/pages/entity-resource.tsx`,
  `ui/src/pages/project-resources.tsx`):
  - `bash scripts/e2e/ui-shell-proof.sh`
  - `bash scripts/e2e/ui-system-proof.sh`
  - `bash scripts/e2e/ui-collections-proof.sh`
  - `bash scripts/e2e/ui-entities-proof.sh`
  - `bash scripts/e2e/ui-writes-proof.sh`
- `npm run verify` exits 0.
- Proof: the whole of `scripts/e2e/ui-resources-proof.sh` — phases A, B, C, C2,
  D, E, F, F2 and G.
