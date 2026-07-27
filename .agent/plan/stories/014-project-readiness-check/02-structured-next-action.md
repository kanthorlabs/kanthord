# Story 2 — structured `next`

Epic: `.agent/plan/epics/014-project-readiness-check.md`
Depends on: Story 1 (`src/app/project/project-readiness.ts` and its types must
already exist; this story replaces the `next: null` placeholder).

## Change

### 1. `src/app/project/project-readiness.ts` — add the `NextAction` type

```ts
/** Statuses a `next` action can be derived from, in `CHECK_ORDER` order. */
export const ACTIONABLE_STATUSES = [
  "missing",
  "paused",
  "blocked",
  "failed",
  "stopped",
] as const;

export interface NextAction {
  /** The check this action resolves. */
  check: CheckName;
  /** Imperative, one line, no id interpolation. */
  action: string;
  /** Values the user must decide. Empty when every value is already known. */
  requiresInput: string[];
  /** Present ONLY when requiresInput is empty and every value is known. */
  command?: string;
}
```

Change `ReadinessReport.next` from `null` to `NextAction | null`.

### 2. Selection rule — pin exactly

`next` = the action for the **first** check in `CHECK_ORDER` whose `status` is in
`ACTIONABLE_STATUSES`; `null` when no check is actionable.

Consequences that Proof phases depend on, and that tests must lock:

- `ok`, `unverified`, `unsupported` and `multiple` are **not** actionable.
  `unverified` not being actionable is why Proof phase C1 (`repository` is
  `unverified`) advances `next` to `ai_provider`, and phase C3 advances to
  `initiative`.
- `multiple` is not actionable: this epic explicitly does no daemon supervision,
  so there is no command that fixes two live daemons.
- `failed` (a probe failure) is actionable.

### 3. Per-status action table — pin exactly

`P` = `facts.projectId`. Ids interpolated into `command` come from the same
lowest-id selection Story 1 already made for that check's `detail`.

| check         | status    | action                                                       | requiresInput                                 | command                                   |
| ------------- | --------- | ------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| `database`    | `blocked` | `apply the pending database migrations`                      | `[]`                                          | `kanthord db migrate`                     |
| `repository`  | `missing` | `configure a repository for this project`                    | `["name","remoteUrl","branch","auth","path"]` | _(absent)_                                |
| `repository`  | `blocked` | `point the repository at an existing credential resource`    | `["credential"]`                              | _(absent)_                                |
| `repository`  | `failed`  | `fix remote access for the repository that failed its probe` | `["remoteUrl","auth"]`                        | _(absent)_                                |
| `ai_provider` | `missing` | `register an ai provider`                                    | `["name","provider","model","valueFile"]`     | _(absent)_                                |
| `ai_provider` | `blocked` | `re-authenticate the assigned ai provider`                   | `["valueFile"]`                               | _(absent)_                                |
| `ai_provider` | `failed`  | `replace the credential of the assigned ai provider`         | `["valueFile"]`                               | _(absent)_                                |
| `initiative`  | `missing` | `create an initiative with at least one task`                | `["name"]`                                    | _(absent)_                                |
| `initiative`  | `paused`  | `resume the paused initiative`                               | `[]`                                          | `kanthord resume initiative --id ${i.id}` |
| `initiative`  | `blocked` | `add a task to the initiative`                               | `["objective","title","instructions","ac"]`   | _(absent)_                                |
| `daemon`      | `stopped` | `start the daemon`                                           | `[]`                                          | `kanthord run daemon`                     |

- `command` is present **iff** `requiresInput` is empty. Encode that as a single
  invariant in the code, not per row.
- `command` is omitted with `?:` (the property is absent), so
  `JSON.stringify` drops it — Proof phase B asserts
  `v.next.command === undefined || v.next.command === null`.
- The `initiative`/`paused` command uses the **lowest-id paused candidate** — the
  same initiative Story 1's `paused` detail names (Proof phase E1 asserts the
  command contains the real `$INIT` id).
- `notification` is never a `next`: `unsupported` is not actionable.

## Constraints

- Still zero I/O and zero imports in `project-readiness.ts`. No environment read,
  no clock, no id generation.
- Command strings are literal `kanthord …` text with real ids interpolated. Never
  emit a placeholder like `<id>` inside `command` — a command that needs a
  placeholder must instead have no `command` and name the value in
  `requiresInput`.
- Do not add a `next` for a check whose status is not in the table above; if such
  a combination is reachable it is a Story 1 rule bug, not a `next` fallback.
  Throw nothing — the combination is unreachable by construction because
  `ACTIONABLE_STATUSES` and the table cover exactly the same pairs; a test
  asserts that every (check, actionable status) pair the Story 1 rules can emit
  has a row.

## Verify

- `node --test src/app/project/project-readiness.test.ts` — extend the Story 1
  file. New assertions:
  - **Order**: facts where `repository` is `missing` **and** `initiative` is
    `missing` → `next.check === "repository"`.
  - **`unverified` is skipped**: `repository: unverified` + `ai_provider: missing`
    → `next.check === "ai_provider"`. `repository: unverified` +
    `ai_provider: unverified` + `initiative: missing` → `next.check === "initiative"`.
  - **A default-resolved provider is not a `next`**: facts with
    `aiProvider: {resolved: [{source: "default"}], assignedCount: 0}`,
    `repository: unverified` and `initiative: missing` →
    `next.check === "initiative"`. The report names the implicit default in the
    `ai_provider` detail; it does not demand an assignment, because the daemon
    would run.
  - **`repository` missing**: `requiresInput` includes `"remoteUrl"` and
    `"auth"`, and `"command" in report.next === false`.
  - **`initiative` paused**: `requiresInput.length === 0`,
    `command === "kanthord resume initiative --id <lowest-id paused candidate>"`;
    with two paused candidates given in descending-id order, the command carries
    the lowest id.
  - **`daemon` stopped**: with all four config checks `ok`/`unverified`,
    `next.check === "daemon"` and `command === "kanthord run daemon"`.
  - **`database` blocked wins over everything**: `command === "kanthord db migrate"`.
  - **`multiple` is not actionable**: two live instances + everything else
    `ok`/`unverified` → `next === null`.
  - **All green**: every config check `ok`, probes all `ok`, daemon `running` →
    `next === null` and `ready === true`.
  - **Invariant**: for every fact set in the test file, `next === null` or
    (`next.requiresInput.length === 0` XOR `next.command === undefined`) — i.e.
    a command is present exactly when nothing is required.
- `npm run verify` exits 0.
- Proof: none directly. Delivers the `next` assertions in Proof phases B
  (`next.check === "repository"`, `requiresInput`, no command), C1/C3
  (`next.check` advancing past `unverified`) and E1 (`resume initiative` command
  with the real id) once Story 6 wires it.
