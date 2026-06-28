# 14 Versioning & Migrations

Goal:             Per-file version-aware migration machinery: detect when a file is
                  behind, return a plan of what auto-applies vs needs user action,
                  and never upgrade without an explicit confirmation input.

Decision anchors: B8 (every file has `version`; migration logic lives in the code
                  that needs it; show auto vs manual; never upgrade without
                  confirmation), §8 Versioning & Migrations.

ACs:
- A file whose `version` is **below** current-supported is detected as **needing
  migration**; a file at current reads normally.
- A file whose `version` is **above** supported is **refused** (no read/downgrade,
  no corruption) — consistent with epic 03's config bad-`version` refusal.
- The detect step returns a **migration plan as data**, each step carrying:
  `stepId`, `fromVersion`, `toVersion`, `mode` (**`auto` | `manual`**), `summary`,
  and `userAction` text for `manual` steps. (A test asserts the plan fields, not a
  log line.)
- **No upgrade applies without an explicit confirmation input:** called without
  confirmation, the file content is **unchanged** and still at its old `version`.
- Called **with** confirmation, the synthetic **v1→v2** migration succeeds: the
  file content is the v2 form at `version: 2`. If the migration **function throws**,
  the file is left at its v1 content/`version` (no half-written state).

Constraints:
- The `version` field is provided by epic 02 (B8, §8); epic 14 adds only the
  **detect → plan → confirm → apply** harness.
- **Migration logic lives in the module that needs it** (B8) — not a central
  engine; epic 14 is the shared harness those migrations plug into.
- Apply writes via the **epic-02 atomic replace + lock** (N1); crash-during-write
  safety is **inherited from epic 02, not newly defined here** (epic 14 tests only
  the migration-function-throws path unless epic 02 exposes a crash-simulation
  hook).
- Confirmation is an **explicit apply input / callback** at the machinery level;
  the concrete channel (CLI prompt / RPC) for a headless daemon comes later.
- **Per-file migration only.** Multi-file/batch-store atomicity and half-migrated-
  store recovery are **out of scope** until a real multi-file module needs them.
- **RPC/wire-version compatibility is out of scope** (file `version` only); backup/
  rollback is out of scope (epic-02 atomic write is the safety).
- Confirm gate is mandatory (§8) — no flag silently auto-migrates in normal
  operation. Only v1 exists today, so this is machinery proven on a v1→v2 fixture.

Spike?:           none — in-process logic over the epic-02 file-DB; reuses epic-02
                  atomicity findings, claims no new crash semantics.

Verification:     `node:test` in a throwaway temp dir (never `.data/`): behind-
                  version detected; plan data carries the named fields with correct
                  auto/manual modes; no-confirmation leaves the file unchanged;
                  confirmation applies v1→v2 (content + `version: 2`); a throwing
                  migration leaves v1 intact; newer-than-supported refused.

Dependencies:     01 (workspace), 02 (`version` field + atomic write/lock),
                  03 (aligns with config bad-version refusal).

Findings out:     none.
