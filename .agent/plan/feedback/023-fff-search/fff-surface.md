# SU2 — fff embedding spike (Epic 020 SU2, unblocks Epic 023)

Status: **PASS — 10/10, native-on-Mac AND in the Podman dev container.**
Date: 2026-07-14. Probe: `scripts/dev/probes/su2-fff-spike.mjs`.

## Dependency + pin

- Package: **`@ff-labs/fff-node`** — the Node binding published from
  `dmtrKovalenko/fff` (the `@ff-labs` org is the publisher). Confirmed against the
  repo README; the bare npm name `fff` is an unrelated package.
- **Pinned exact `0.9.6`** (`--save-exact`, no caret) in `package.json` +
  lockfile. `0.9.6` is the `latest` dist-tag, published 2026-06-21 (22.8 days old
  at pin time — safely past the `.npmrc` `min-release-age=3`). A `nightly` channel
  (`0.9.7-nightly.*`) exists — matches PRD §6.4 "pre-1.0, fast-moving nightlies";
  we track the stable tag and re-pin deliberately.
- **Native binding:** ships a prebuilt Rust binary per platform via `ffi-rs`,
  pulled as `optionalDependencies` (`@ff-labs/fff-bin-<platform>`). No compile
  step. Runtime dep `ffi-rs@^1` (also prebuilt). This makes the dev image's old
  "zero native bindings" note obsolete — Containerfile.dev updated.

## Container-run verification (the debate finding)

> "works on my Mac does not unblock a container-run pipeline."

The binding was exercised **inside the Podman dev container** (`kanthord-dev`,
`node:24-slim`, **linux/arm64** on the Apple-Silicon VM), not just native-on-Mac:

```
podman run --rm --userns=keep-id \
  -v "$PWD/scripts/dev/probes/su2-fff-spike.mjs:/app/su2-probe.mjs:ro" \
  -w /app kanthord-dev node su2-probe.mjs
→ RESULT: PASS — 10/10  (platform=linux/arm64, fff-node=0.9.6)
```

`npm ci` in the image pulled `@ff-labs/fff-bin-linux-arm64-gnu@0.9.6` as the
optional dep; `git2` integration reported available in-container. **Epic 023
does NOT need a native-only declaration** — it runs container-side.

## Surface the daemon needs (all answered)

The Epic 023 interface wraps `FileFinder` from `@ff-labs/fff-node`:

| Need | fff surface | Result |
|---|---|---|
| Index **start** | `FileFinder.create({ basePath, frecencyDbPath?, historyDbPath?, aiMode })` → `Result<FileFinder>`, then `await finder.waitForScan(timeoutMs)` | scanned=true |
| Index **stop** | `finder.destroy()` | ok |
| **Path query** | `finder.fileSearch(query, { pageSize })` → `Result<SearchResult>`; typo-resistant (`'alfa'` → `alpha.ts`) | hit |
| **Content query** | `finder.grep(query, { mode: "plain"\|regex\|fuzzy, smartCase, before/afterContext, maxMatchesPerFile })` → `Result<GrepResult>` | 2 matches / 2 files |
| **Glob** | `finder.glob("**/*.ts", { pageSize })` | 2 hits |
| **Frecency** | ranking is frecency-aware **only when `frecencyDbPath` is set** at create (omit → frecency skipped). Feed it via `finder.trackQuery(query, absoluteSelectedPath)` — the selected path **must be absolute** (it canonicalizes; a relative path errors "Failed to canonicalize path"). History via `historyDbPath` + `getHistoricalQuery`. | tracked + ranked |
| **Watcher lifecycle** | background watcher is **automatic** after `create`: a file added post-scan appeared via `fileSearch` **without** an explicit rescan. `finder.scanFiles()` + `waitForScan` force a manual rescan; `reindex(newPath)` repoints. | auto-watch=true |
| **Non-git dir** | fff itself indexes + queries a **plain (non-git) dir** fine (git integration is optional; `healthCheck().git.available` is separate). kanthord still rejects non-git paths at registration (PRD assumption #5) — that policy is kanthord's, not fff's. | scanned + hit |
| **Memory footprint** | rss delta ≈ **5–7 MB** for a full index of a ~4-file repo (indicative only; scales with tree size — no numeric bound set, captured per PRD). | recorded |
| **Runtime `engineVersion()`** | `finder.healthCheck()` → `{ version, git: { available } }`. **`version` == the pinned `0.9.6` at runtime** — satisfies the debate finding that `engineVersion()` must equal the pin at runtime, not just in the lockfile. Surface `healthCheck().version` in daemon-ops status for drift. | runtime==pinned |

## Notes carried into Epic 023

- **`Result<T>` everywhere** = `{ ok: true, value } | { ok: false, error }`. The
  `src/search/` wrapper must unwrap and map `!ok` to kanthord's typed search
  errors (timeout / over-cap) — never let a raw fff error escape.
- **Result caps + timeout** (Epic 023 debate finding: no unbounded scan reaches an
  agent) map to `pageSize` on search/glob and `maxMatchesPerFile` on grep;
  `waitForScan(timeoutMs)` is the scan timeout. The wrapper owns enforcing a
  mandatory cap + timeout on every query.
- **`getScanProgress()` / `isScanning()`** exist for the "degraded at boot"
  fail-soft path (Epic 023 story 002): a slot whose scan fails/hangs → mark
  degraded + escalate, boot anyway.
- **Module boundary:** only `src/search/` may import `@ff-labs/fff-node`
  (Epic 023 story 001 assertion).
- Extra surface available if needed later: `directorySearch`, `mixedSearch`,
  `multiGrep`, `refreshGitStatus`, `getBasePath`.
