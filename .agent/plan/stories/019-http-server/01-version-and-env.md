# Story 01 — one version constant + `.env` loading

Epic: `.agent/plan/epics/019-http-server.md` (bullet S1)
Depends on: Story 00.

## Change

1. **New file `src/apps/version.ts`** — the single source of the program version.
   Exact content:

   ```ts
   import { readFileSync } from "node:fs";

   /**
    * The single source of the program version. `src/apps/cli/index.ts` and the
    * HTTP app's `/healthz` row both read this constant, so the API version and
    * the CLI version are equal by construction.
    */
   export const packageVersion = (
     JSON.parse(
       readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
     ) as { version: string }
   ).version;
   ```

   Note the path is `../../package.json` (two levels up from `src/apps/`), not
   the CLI's three.

2. **`src/apps/cli/index.ts`** — delete the inline read at `:41-45`:

   ```ts
   const packageVersion = (
     JSON.parse(
       readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
     ) as { version: string }
   ).version;
   ```

   and delete the now-orphan `import { readFileSync } from "node:fs";` on line 1.
   Add `import { packageVersion } from "../version.ts";` to the import block
   (keep the block's existing ordering style). Line `:85` (`.version(packageVersion)`)
   is unchanged.

3. **`src/main.ts`** — add `import { existsSync } from "node:fs";` at the top of
   the import list, and insert this block between the EPIPE loop (ends line 14)
   and `const dbPath = …` (line 16), so it runs before the first `process.env`
   read:

   ```ts
   // `.env` (cwd-relative, optional) fills env vars for the whole program.
   // Precedence matches `node --env-file`: a variable already present in the
   // real environment wins over the file. The snapshot/restore makes that rule
   // true regardless of process.loadEnvFile's own precedence.
   if (existsSync(".env")) {
     const preset = { ...process.env };
     process.loadEnvFile(".env");
     for (const [key, value] of Object.entries(preset)) {
       if (value !== undefined) process.env[key] = value;
     }
   }
   ```

## Constraints

- Do not change what `.version()` returns; `kanthord --version` must still print
  `27.8.1` for the current `package.json`.
- `src/apps/version.ts` must not import anything from `src/apps/cli/` or
  `src/apps/http/` — both import it.
- The `.env` load is cwd-relative and silent when the file is absent. Never log
  the file's contents and never throw when it is missing.
- No other file may read `package.json` for a version after this story.

## Verify

- New test `src/apps/version.test.ts`, run with
  `node --test src/apps/version.test.ts`:
  - `packageVersion` equals the `version` field parsed directly from
    `package.json` read in the test.
  - `packageVersion` matches `/^\d+\.\d+\.\d+$/`.
- New tests appended to `src/main.test.ts`, run with
  `node --test src/main.test.ts`. Extend the existing `runMain` helper (or add a
  sibling helper) so the spawn's `cwd` is a temp dir holding a written `.env`,
  the `KANTHORD_DB` is a temp path, and the parent env is never mutated
  (`{ ...process.env, ... }` merge only, mirroring `src/main.test.ts:29-33`):
  - `.env` containing `KANTHORD_MAX_TURNS=abc`, no such variable in the spawn
    env → exit status `1` and stderr names `KANTHORD_MAX_TURNS`. This proves the
    file is loaded at all.
  - `.env` containing `KANTHORD_MAX_TURNS=abc` AND `KANTHORD_MAX_TURNS=5` in the
    spawn env → exit status `0`. This proves the process env wins.
  - no `.env` in the cwd → `db migrate` exits `0` (absence is silent).
- Existing `src/apps/cli/index.test.ts` version assertion (`:307`) still passes
  unchanged.
- `grep -rn "readFileSync(new URL(\"../../../package.json\"" src/` returns
  nothing.
- `npm run verify` exits 0.
- Proof: prerequisite for phase B (`data.version` == `kanthord --version`) and
  phase A (`serve` reads `API_KEY` from the proof's `.env`).
