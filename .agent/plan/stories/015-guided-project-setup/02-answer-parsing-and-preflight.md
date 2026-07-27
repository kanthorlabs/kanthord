# Story 2 — Answer file parsing + preflight validation

Epic: `.agent/plan/epics/015-guided-project-setup.md`
Depends on: Story 1 (imports `SetupAnswers` and its sub-types).

## Change

New file `src/app/project/setup-answers.ts` — pure, zero I/O. It may import
`node:path` and `src/domain/resource.ts`; it must not read a file, and it must
not import anything under `src/apps/`.

```ts
export interface ParsedEntry {
  key: string;
  value: string;
  line: number;
}

export type ParseSetupAnswersResult =
  { ok: true; answers: SetupAnswers } | { ok: false; errors: string[] };

/**
 * `text` is the answers file contents. `baseDir` is the directory of the
 * answers file; every path-valued answer is resolved against it.
 */
export function parseSetupAnswers(
  text: string,
  baseDir: string,
): ParseSetupAnswersResult;
```

### Grammar (pinned)

- Split on `\n`; strip one trailing `\r` per line.
- A line whose first non-whitespace character is `#` is a comment → ignored.
- A line that is empty after trimming → ignored.
- Otherwise the line must contain `=`; split at the **first** `=`. Key = left
  side trimmed of ASCII whitespace; value = right side trimmed of ASCII
  whitespace. Values are **not** shell-unescaped, unquoted, or expanded.
- A non-comment, non-blank line with no `=` → error
  `error: line <n>: expected key=value`.
- An empty value → error `error: <key>: value must not be empty`.
- A repeated key → error `error: duplicate key: <key>` (each distinct
  `graph.bind.<alias>` is its own key; the same alias twice is a duplicate).

### Key set (closed and enumerated)

Always required: `project.name`, `repository.name`, `repository.remoteUrl`,
`repository.branch`, `repository.path`, `repository.auth`, `provider.route`,
`provider.name`, `provider.provider`, `provider.model`.

Conditional on `repository.auth`:

| `repository.auth`      | required                                                         | irrelevant                                                       |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `https-token`          | `credential.name`, `credential.provider`, `credential.valueFile` | —                                                                |
| `ambient`, `ssh-agent` | —                                                                | `credential.name`, `credential.provider`, `credential.valueFile` |

Conditional on `provider.route`:

| `provider.route` | required                                                                         | irrelevant                                                                       |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apiKey`         | `provider.valueFile`, `provider.confirmCost`                                     | `provider.oauthMethod`, `provider.baseUrl`, `provider.api`                       |
| `custom`         | `provider.valueFile`, `provider.confirmCost`, `provider.baseUrl`, `provider.api` | `provider.oauthMethod`                                                           |
| `oauth`          | `provider.oauthMethod`                                                           | `provider.valueFile`, `provider.confirmCost`, `provider.baseUrl`, `provider.api` |

Graph keys: `graph.skip` is optional (default `false`). When `graph.skip=true`,
`graph.packagePath` and every `graph.bind.<alias>` are **irrelevant**. When
`graph.skip` is absent or `false`, `graph.packagePath` is required and
`graph.bind.<alias>` keys are optional and repeatable.

Any key not in the table above and not matching `graph.bind.<alias>` (alias =
`[A-Za-z0-9_-]+`) → error `error: unknown key: <key>`, **except** the two
secret keys below.

### Value domains

- `repository.auth` ∈ `ambient | https-token | ssh-agent`, else
  `error: repository.auth must be one of: ambient, https-token, ssh-agent`.
- `provider.route` ∈ `oauth | apiKey | custom`, else
  `error: provider.route must be one of: oauth, apiKey, custom`.
- `provider.api` ∈ `openai-completions | openai-responses`, else
  `error: provider.api must be one of: openai-completions, openai-responses`.
- `graph.skip` and `provider.confirmCost` must be exactly `true` or `false`,
  else `error: <key> must be exactly "true" or "false"`.
- `provider.confirmCost` must be `true` when required:
  `error: provider.confirmCost must be true to authorise the provider verification call`.
- `repository.remoteUrl` must not carry an embedded credential. Use
  `hasEmbeddedUserinfo` from `src/domain/resource.ts:161`. On a hit, emit
  **exactly** `error: repository.remoteUrl must not contain embedded credentials`
  — the URL, the userinfo and the host are **not** included in the message, so
  `EmbeddedCredentialError` (`src/domain/resource.ts:84`, which does interpolate
  the raw URL) can never be reached.

### Secret rules (route-specific, not a blanket rule)

- `credential.value` and `provider.value` are **recognised** keys that are always
  rejected with a secret-specific message, never as an unknown key:
  `error: <key> is not accepted; provide the secret as a path with <prefix>.valueFile=<path>`.
  The message must not contain the value, and the value must never be copied
  into any error, log or returned structure.
- A `*.valueFile` whose value is `-` → `error: <key>: stdin ("-") is not supported with --answers; give a file path`.
- Path answers are resolved with `resolve(baseDir, value)` when relative,
  used verbatim when already absolute: `repository.path`,
  `credential.valueFile`, `provider.valueFile`, `graph.packagePath`.
- `parseSetupAnswers` **never stats or reads** any path — in particular not
  `graph.packagePath`. The graph step reads it (Story 4), which is what lets the
  Proof's Phase J write the earlier steps before the graph step fails.

### Error reporting

Collect **all** errors and return them together, in this order: grammar errors
by line number, then secret-key rejections, then unknown keys, then
irrelevant keys, then missing required keys, then value-domain errors. One
string per error, each already prefixed `error: `. Return `{ ok: false, errors }`
— never throw, never partially build `answers`.

When a discriminant key (`repository.auth`, `provider.route`, `graph.skip`) is
missing or outside its domain, report that key and **skip** evaluating the
conditional sets that depend on it.

## Constraints

- Pure: no `node:fs`, no network, no clock. `baseDir` is data.
- Never echo a secret. The only values that may appear in an error string are
  keys, line numbers, and non-secret values (`repository.auth`,
  `provider.route`, `provider.api`, booleans). Never a `*.valueFile` **content**;
  a `*.valueFile` **path** may appear.
- `answers.repository.path` is always absolute in the returned value, so the
  reconciliation comparison in Story 1 is a plain string equality.
- Do not weaken `confirmCost` to `boolean` — the `SetupAnswers` union pins the
  literal `true`, which is the point.

## Verify

`src/app/project/setup-answers.test.ts`:

- happy path: the exact answer set written by
  `scripts/e2e/guided-setup-proof.sh:48-68` (with `#` comment and blank line)
  parses to `ok: true` with `repository.auth === "https-token"`,
  `provider.route === "apiKey"`, `provider.confirmCost === true`,
  `graph.skip === false`, `graph.bind` deep-equal `{ source: "home" }`.
- grammar: `#` comment ignored; blank line ignored; a value containing `=` keeps
  everything after the first `=`; a value containing `#` keeps the `#`
  (no inline-comment stripping); a value containing `$HOME` is not expanded; a
  line without `=` errors naming its line number; duplicate key errors; empty
  value errors; the same `graph.bind.source` twice errors as a duplicate while
  `graph.bind.a` + `graph.bind.b` both parse.
- missing keys: with only `project.name`, `repository.name`,
  `repository.remoteUrl` the result is `ok: false` and `errors.join("\n")`
  matches `/repository\.(branch|path|auth)/` — the Phase A assertion.
- unknown key: `repository.colour=blue` errors naming `repository.colour`.
- irrelevant keys, one test each: `provider.oauthMethod` under
  `provider.route=apiKey`; `provider.baseUrl` under `apiKey`;
  `credential.name` under `repository.auth=ambient`; `graph.packagePath` under
  `graph.skip=true`.
- secret keys: `credential.value=super-secret-value` yields exactly one error
  that contains `valueFile`, does **not** contain the string `unknown key`
  (case-insensitive), and does **not** contain `super-secret-value`. Same for
  `provider.value`.
- `credential.valueFile=-` and `provider.valueFile=-` each error mentioning
  `stdin`.
- embedded credential: `repository.remoteUrl=https://user:tok3n@example.com/r.git`
  errors with a message containing `embedded credential` and containing neither
  `tok3n` nor `user:`.
- booleans: `graph.skip=TRUE`, `graph.skip=1`, `provider.confirmCost=yes` each
  error naming the key; `provider.confirmCost=false` under route `apiKey` errors
  naming `provider.confirmCost`.
- enums: bad `repository.auth`, bad `provider.route`, bad `provider.api` each
  error naming the key and listing the allowed values.
- route completeness: a valid `oauth` set (with `provider.oauthMethod`, without
  `provider.valueFile`/`confirmCost`) parses; a valid `custom` set (with
  `baseUrl` + `api`) parses.
- auth completeness: a valid `ambient` set without any `credential.*` key parses
  and `answers.credential === undefined`; the same for `ssh-agent`.
- path resolution: a relative `repository.path=./mirror` with
  `baseDir="/tmp/x"` resolves to `/tmp/x/mirror`; an absolute path is unchanged;
  the same for `credential.valueFile`, `provider.valueFile`,
  `graph.packagePath`.
- atomicity: a set missing one required key returns `ok: false` and the result
  object has **no** `answers` property.
- multiple simultaneous violations return every error in one array (assert
  `errors.length` and that an unknown key and a missing key both appear).
- `node --test src/app/project/setup-answers.test.ts`
- `npm run verify` exits 0.
- Proof: Phase A, Phase B, Phase C, Phase D of
  `scripts/e2e/guided-setup-proof.sh` — every one of them is a
  "no writes happened" assertion, satisfied because this function runs to
  completion before Story 4 executes any step.
