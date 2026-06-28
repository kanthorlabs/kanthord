# 03 Config Loading (Zod-validated)

Goal:             Load and validate Core's configuration once at startup with Zod,
                  with explicit precedence and fail-fast on invalid config — so
                  every later module reads one trusted, typed config object.

Decision anchors: S5 (Zod for config — NOT for RPC), §3 Validation, B4 (env vars
                  are a dev/bootstrap fallback only, not default precedence;
                  credentials are NOT config), B8 / §8 (`version`).

ACs:
- The loader, given a valid config file, returns the **resolved values** later
  modules read (tests call the loader and assert the parsed values — the observable
  result, not "a TypeScript type").
- On a schema-invalid config Core **refuses to start** with an error that **names
  the offending field(s)** — no partial/coerced startup.
- **Missing config = built-in defaults.** With no config file present Core starts
  on documented built-in defaults (first-run is the common single-user case); it
  does not refuse.
- **Precedence (exact):** the config file is the source of truth. An env var
  supplies a value **only for a key the file does not set**, and only for keys
  explicitly marked as bootstrap-overridable; env **never overrides a file-set
  value** (B4). Per-key fallback, not whole-config fallback.
- **Secrets are a hard reject:** the auth key/secret and provider API keys are not
  in the config schema; a config that carries such a key **fails fast naming the
  field** (not silently ignored). Secrets live in the data/state dir (B4, B10;
  epic 08).
- **Version is hard-validated:** the config carries `version` starting at `1`; a
  missing, wrong-type, or higher-than-supported `version` **fails fast** (no
  silent coercion). Actual migration is epic 14.
- **Loaded once at startup; no live reload** in this task (no SIGHUP/watch).

Constraints:
- Zod validates config **at the load boundary only** (S5). After load, code uses
  the typed resolved config — no re-parsing config with Zod elsewhere, and **no
  Zod on RPC wire messages** (S5).
- Config is a **single JSON file** (the structured-machine-state case of the
  epic-02 format policy) — one format, not json-or-markdown.
- v1 config path is **one location** (under the data/state dir, or an explicit
  `--config` / env bootstrap path). Full per-platform path discovery
  (XDG / app-support / `/etc`) is deferred to the lifecycle/install epic (15).
- Env vars are bootstrap/fallback only, never default precedence (B4) — env leaks
  via `docker inspect`, crash dumps, CI logs, child processes.
- Zod is the first real runtime dependency: pure JS, no native `.node` (D2). The
  **no-native-modules guard** deferred from epic 01 is **implemented here** (a
  lockfile/tree check for `.node` artifacts), since this epic adds the first dep.

Spike?:           none — Zod is a known pure-JS lib and config loading is routine;
                  no unknown external API / OS boundary / atomicity (spike gate
                  not tripped).

Verification:     `node:test`: valid config → asserted resolved values; invalid
                  config fails fast naming the field; missing config → defaults;
                  env applies only per-key when the file omits the key and never
                  overrides; secret-bearing config hard-rejected; bad `version`
                  rejected. The no-native-modules guard runs green with Zod added.

Dependencies:     01 (workspace), 02 (versioned-file read for the config file).
                  The native-modules guard is **owned by this epic** (epic 01
                  deferred it to the first dep-adding epic).

Findings out:     none.
