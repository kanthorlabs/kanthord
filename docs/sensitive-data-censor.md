# Sensitive-data censor — project-wide proposal

## 1. Where sensitive data lives today

| Location                                                 | Kind                                             | Reachable via                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `ai_providers.value`                                     | Folded AI credential (string, NULL after logout) | `register` input, `logout` clears; never read-path output                                     |
| `resources` table 👉 `credential.type` rows value column | Git credential                                   | `resource-view.ts` `CredentialView` omits `value` structurally; CLI `list`/`get` use the view |
| Task logs / `events` table                               | Execution context payload, error details         | Events polling, diagnostics                                                                   |
| Diagnostics export                                       | DB dump, CLI `db status`                         | Only id/name counts, no values                                                                |

**Current redaction in output paths:**

- **`resource-view.ts`**: Each view type lists fields explicitly — no spread, no `value` on `CredentialView` or `AIProviderView`. The `toResourceView()` function casts and picks.
- **`ai-provider-view.ts`**: The `AiProviderView` type for global providers structurally omits `value`. `GetAiProvider` / `ListAiProviders` use it. JSON output never contains the secret (verified by test: `"value" in view === false` + `JSON.stringify` grep).
- **CLI runners** (`runGetAiProvider`, `runListAiProviders`, `runListResources`): Format the view objects. No view field named `value`.
- **`readCredentialValue`**: Reads from `--value-file` or stdin-prompt; the value goes directly into the use case, never to stdout/stderr.

## 2. Options with trade-offs

### (a) Structural omission at view boundary + lint test — **Recommended**

Keep the current pattern: each read path builds a view type that omits `value` by listing fields manually (no spread). Add a lint rule / test that scans `JSON.stringify` calls in CLI runner files and asserts no `.value` reference in the output path.

**Pros**: Simple, already proven in 3 view types. Zero runtime cost. Type-safe within the view file (a spread would copy `value` accidentally, so the discipline is enforced by author intent). The test suite already has explicit checks (`"value" in view === false`, `JSON.stringify` not containing known secrets).

**Cons**: Manual discipline — a new view author could forget to omit `value`. No compile-time error if someone references `record.value` in a template. A lint test mitigates but doesn't prevent dumber leaks (e.g. `JSON.stringify(record)` in a new runner).

### (b) Branded `Secret<T>` type

Wrap all sensitive strings in `Opaque<string, "Secret">` or `Brand<string, "Secret">`. Only code within the adapter can unwrap via `reveal()`. JSON serialization would produce `{}` or throw unless a custom `toJSON()` is added.

**Pros**: Compile-time boundary — a view can't accidentally include a secret because the type isn't present. Industry pattern (see `type-fest` `Opaque`).

**Cons**: Heavy retrofit across 3+ aggregates. Adapter code needs explicit reveal/store/re-wrap — adds friction to simple CRUD. `toJSON()` customization for branded types is non-standard. The current surface is small enough that the type complexity outweighs the leak surface.

### (c) Serializer-level deny-list at CLI boundary

A single `toSafeJson(obj, denyKeys)` function walks the object tree and strips known sensitive keys (`value`, `secret`, `token`) before any `JSON.stringify`. All CLI output goes through this.

**Pros**: Centralised, catches all output paths, catches future field additions.

**Cons**: Runtime cost (walk + copy on every output). Fragile to field renames (a key renamed to `foldedValue` would leak until the deny-list is updated). False-positive risk on legitimate fields named `value` in other aggregates. Gives a false sense of security — a `JSON.stringify(record, null, 2)` with no deny call would still leak.

## 3. Recommendation

**Option (a)**: Structural omission + a focused lint test.

Rationale: The current pattern works, is simple, and is already verified by tests. Adding a `lint:leaks` script that greps for `value` in `JSON.stringify` calls within CLI runner files would formalise the guard. The cost of a leak is low here (local development, single-user). If the project later adds multi-user or CI output, upgrade to (b).

## 4. Enforcement

- **Test-level**: `ai-provider-view.ts` is type-checked at compile time (field listing, no spread). Tests verify `"value" in view === false` and `JSON.stringify` absence.
- **Lint test (proposed)**: A script under `scripts/` (not written yet) that checks all CLI runner files (`src/apps/cli/**/*.ts`) for `JSON.stringify(.*\.value)` or similar patterns. Gate it in the Verification Gate `Gates:` command.
- **No type-level enforcement**: A branded `Secret<T>` type is deferred unless a leak is found in production.

## 5. Retrofit cost to existing views

- `resource-view.ts` — already uses structural omission (line 82: explicit field list, no spread). Zero cost.
- `ai-provider-view.ts` — already omits `value`. Zero cost.
- CLI runners — format via `JSON.stringify(view)` where `view` has no `value` field. Zero cost.
- Events/task logs — not currently redacted (secrets are not expected in execution context at this point). If they appear, a `toSafeJson` filter would be needed, but that's out of scope for 008.x.
