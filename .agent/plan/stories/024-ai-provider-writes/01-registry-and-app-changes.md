# Story S1 — the 24 registry codes, `502`, the 3 segments, 2 helpers, 2 app-layer changes

Epic: `.agent/plan/epics/024-ai-provider-writes.md` (decisions 6, 8, 9, 10)
Depends on: EPIC 023 landed (63 rows, `PUT` admitted with `PUT_ROWS`).

Lands **no row**. `ROUTES.length` stays 63. This story exists so every later row
can throw and be mapped, and so the two outbound rows have a bounded, redacting
app layer to call.

## Change

**1. `src/app/ai-provider/errors.ts`** — add one class:

```
export class ProviderCallFailedError extends Error {
  readonly id: string;
  constructor(id: string, detail: string) {
    super(`provider call failed for ${id}: ${detail}`);
    this.name = "ProviderCallFailedError";
    this.id = id;
  }
}
```

`detail` is ALREADY redacted and capped by the caller (change 3). This class never
redacts; it only carries.

**2. `src/app/project/probe-ai-provider.ts`** — `execute` gains an options
argument:

```
async execute(
  providerId: string,
  options?: { timeoutMs?: number },
): Promise<ProviderProbeOutcome>
```

Race the existing `this.#tester.execute({id, prompt})` against a timer of
`options?.timeoutMs`. When the timer wins, return
`{resourceId: providerId, status: "failed", detail: "probe timed out after <n>s"}`
where `<n>` is `timeoutMs / 1000`. When `timeoutMs` is absent there is NO timer
and the behaviour is exactly today's. Clear the timer on the settled path so the
process can exit. The method still **never throws** — that contract is why the
probe row answers `200` on failure.

**3. `src/app/ai-provider/test-ai-provider.ts`** — the constructor gains the same
secret accessor `ProbeAiProvider` already takes, and `execute` gains the same
options argument:

```
constructor(probe: ProviderProbe, secretOf: ProviderSecretOf)
async execute(
  input: TestAiProviderInput,
  options?: { timeoutMs?: number },
): Promise<string>
```

On success it returns the reply **verbatim and uncapped**. On a thrown error OR a
lost timeout race it throws
`new ProviderCallFailedError(input.id, detail)` where `detail` is built exactly as
`ProbeAiProvider` builds its failure detail (`probe-ai-provider.ts:72-77`):
`makeRedactor(secretOf(id))` applied to the message, then `.split("\n")[0]`,
`.trim()`, `.slice(0, 300)`. Reuse the same `PROBE_DETAIL_MAX` value; do not
invent a second cap.

Import `ProviderSecretOf` from `../project/probe-ai-provider.ts` (an `app/ → app/`
import, legal) rather than redeclaring the type.

**4. `src/composition.ts:301`** — the epic's ONLY composition edit:

```
const testAiProvider = new TestAiProvider(
  probe,
  (id) => aiProviderRegistry.get(id)?.value ?? null,
);
```

The identical arrow already feeds `ProbeAiProvider` on the next line (`:303`).
Keep it an **arrow wrapper**, never `aiProviderRegistry.get` — AGENTS.md forbids a
bare method reference because it loses `this` and crashes on the adapter's
`#private` fields.

**5. `src/apps/http/decode.ts`** — add `optionalQueryBool(query, name)`:
returns `true` only for the exact string `"true"`, `undefined` when the parameter
is absent, and throws `InvalidInputError(name, …)` for anything else — including
`"false"`, `"1"`, `""` and an array. **Absent must stay absent, never `false`**:
`LogoutAiProvider` and `RemoveAiProvider` distinguish "flag not passed" from
"flag passed" and reject a flag that cannot apply
(`logout-ai-provider.ts:539-556`).

**6. `src/apps/http/body.ts`** — add `optionalBodyNumber(body, field)`: returns a
`number` when present, `undefined` when absent, and throws
`InvalidInputError(field, …)` for a string, a boolean, `null`, `NaN` or a
non-finite value. It does NOT range-check — a present-but-non-positive number is
`InvalidNumericFlagError`'s job (`config-validation.ts:86,93`).

**7. `src/apps/http/routes.test.ts`** — `PATH_SEGMENTS` gains `"default"`,
`"probe"` and `"completion"`. `NOT_PLURAL` is NOT touched (none ends in `s`).
`BANNED_VERBS` is NOT touched (none of the three is a verb in it).

**8. `src/apps/http/error-registry.ts`** — append 24 entries to
`DOMAIN_ERROR_MAPPINGS`, in the epic's decision-10 table order. Nine carry an
explicit `message` because their own text names CLI flags:

| class                           | code                         | status | explicit `message`                                                                        |
| ------------------------------- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `EmptyValueError`               | `empty_value`                | 400    | —                                                                                         |
| `UnknownProviderError`          | `unknown_provider`           | 400    | —                                                                                         |
| `UnknownModelError`             | `unknown_model`              | 400    | —                                                                                         |
| `InvalidEffortError`            | `invalid_effort`             | 400    | —                                                                                         |
| `InvalidApiFlavorError`         | `invalid_api_flavor`         | 400    | —                                                                                         |
| `MissingCustomProviderIdError`  | `missing_custom_provider_id` | 400    | —                                                                                         |
| `MissingBaseUrlError`           | `missing_base_url`           | 400    | —                                                                                         |
| `InvalidBaseUrlError`           | `invalid_base_url`           | 400    | —                                                                                         |
| `InvalidNumericFlagError`       | `invalid_numeric_field`      | 400    | **yes** — name the JSON field, not `--context-window`                                     |
| `InsecureEndpointError`         | `insecure_endpoint`          | 400    | **yes** — "set `allowInsecure` to register a provider at a private or plain-http URL"     |
| `NoUpdateFieldsError`           | `no_update_fields`           | 400    | —                                                                                         |
| `BuiltinProviderFieldError`     | `builtin_provider_field`     | 400    | **yes** — "is only valid for a custom provider" without the `--`                          |
| `StaleCredentialError`          | `stale_credential`           | 409    | —                                                                                         |
| `LoggedOutProviderError`        | `logged_out_provider`        | 409    | —                                                                                         |
| `DuplicateAssignmentError`      | `duplicate_assignment`       | 409    | —                                                                                         |
| `InvalidRankError`              | `invalid_rank`               | 400    | **yes** — "rank must be a non-negative integer"                                           |
| `DefaultNeedsReplacementError`  | `default_needs_replacement`  | 409    | **yes** — name `replacement` / `confirmNoDefault`                                         |
| `SelfReplacementError`          | `self_replacement`           | 400    | —                                                                                         |
| `CorruptDefaultPointerError`    | `corrupt_default_pointer`    | 409    | —                                                                                         |
| `UnnecessaryReplacementError`   | `unnecessary_replacement`    | 400    | **yes** — name the query parameter                                                        |
| `ConflictingDefaultChoiceError` | `conflicting_default_choice` | 400    | **yes** — "replacement and confirmNoDefault are mutually exclusive"                       |
| `AssignedProviderError`         | `assigned_provider`          | 409    | **yes** — "use cascade or replacement"                                                    |
| `AmbiguousFlagsError`           | `ambiguous_options`          | 400    | **yes** — name the parameters, not `--cascade`                                            |
| `ProviderCallFailedError`       | `provider_call_failed`       | 502    | **yes** — fixed `"the provider call failed"`; its own message carries provider error text |

**9. `src/apps/http/error-registry.test.ts:17-19`** — `ALLOWED_STATUSES` gains
`502`. Today it is `400, 401, 403, 404, 405, 409, 412, 413, 415, 500`.

## Constraints

- **Land no row.** `ROUTES` is untouched; `ROUTES.length` stays whatever 023 left
  (expected 63). If it is not 63, raise an `OPEN:` blocker.
- **Register only what a 024 row can raise** (019 decision 11). Do NOT register
  `NonOAuthProviderError` (only `LoginProvider` throws it — EPIC 026) or
  `IncompatibleProviderCredentialError` (no production module throws it).
- `UnknownReferenceError` and `EmbeddedCredentialError` are ALREADY mapped. Do not
  add a second entry for either; `mapError` returns the FIRST match
  (`error-registry.ts:111-119`), so a duplicate silently shadows.
- **Do not weaken any use-case input type.** `RegisterAiProviderInput.provider`
  stays a required `string` (AGENTS.md: never weaken a spec-required field).
- **`ProbeAiProvider` must still never throw.** A timeout is a `failed` outcome,
  not an exception. Its existing `CheckProject` call site
  (`check-project.ts:213`) passes no options and must keep working unchanged.
- **`TestAiProvider` must throw only `ProviderCallFailedError`.** No raw provider
  error may escape, because `mapError` would fall through to
  `500 internal` and the raw text can carry the Authorization header.
- The timeout does NOT cancel the outbound call — `ProviderProbe` has no
  `AbortSignal`. Do not add one; that is an epic non-goal.
- No new middleware, no reordering, no envelope change.

## Verify

- `node --test src/app/project/probe-ai-provider.test.ts` — add:
  - a tester that never resolves, with `{timeoutMs: 20}` → resolves to
    `{status:"failed"}` whose detail matches `/timed out/`, and does NOT reject;
  - a tester that resolves in time with `{timeoutMs: 5000}` → `{status:"ok"}` and
    the fixed detail `"provider answered the probe prompt"`;
  - the existing no-options tests still pass unchanged (the regression guard for
    `CheckProject`);
  - a tester that throws an error containing the secret → the secret is absent
    from `detail`.
- `node --test src/app/ai-provider/test-ai-provider.test.ts` — add:
  - success returns the reply **verbatim**, including a reply longer than 300
    characters and one containing newlines (proves it is NOT capped or split);
  - a throwing tester → rejects with `ProviderCallFailedError`, whose message
    contains neither the secret nor a second line and is ≤ 300 characters after
    the prefix;
  - a never-resolving tester with `{timeoutMs: 20}` → rejects with
    `ProviderCallFailedError` matching `/timed out/`;
  - `secretOf` returning `null` (unknown provider) does not crash the redactor.
- `node --test src/apps/http/decode.test.ts` — `optionalQueryBool`: `"true"` →
  `true`; absent → `undefined`; `"false"`, `"1"`, `"TRUE"`, `""` and
  `["true"]` → `400 invalid_input` naming the parameter.
- `node --test src/apps/http/body.test.ts` — `optionalBodyNumber`: `8` → `8`;
  `0` → `0` and `-1` → `-1` (range is not this helper's job); absent →
  `undefined`; `"8"`, `true`, `null`, `NaN`, `Infinity` → `400 invalid_input`
  naming the field.
- `node --test src/apps/http/error-registry.test.ts` — the hygiene test at
  `21-42` passes with 24 more codes and `502` allowed; add one `mapError` test per
  new class in the style of `:44-68`; add ONE test asserting that for every 024
  code the resolved `message` does not contain `--`.
- `node --test src/apps/http/routes.test.ts` — the segment allowlist accepts
  `default`, `probe`, `completion`; the row count is still 63; the verb ban and
  the `PUT_ROWS` negative control still pass.
- `npm run verify` exits 0.
- Proof: still exits at the same place as before this story. S1 unblocks nothing
  on its own — that is expected and is why it lands no row.
