# Story 01 — the queue and conflict adapter

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decisions 1, 2, 9)
Depends on: EPIC 026.6 (sequence order).

## Change

- In `ui/src/lib/dto.ts`, append these types. Every field mirrors
  `src/apps/http/views/queue.ts:11-74`, `src/apps/http/views/shared.ts:1-8` and
  `src/apps/http/views/conflict.ts:4-47` exactly. Optional means the server omits
  the key; nullable means the server sends `null`.

```ts
export interface QueueInspectDto {
  readonly executable: string;
  readonly args: readonly string[];
}
/** Queue evidence. The literals are the server's, not a widening. */
export interface QueueEvidenceDto {
  readonly basis: "verification-and-summary";
  readonly diffAvailable: false;
  readonly inspect: {
    readonly executable: "git";
    readonly args: readonly string[];
  } | null;
}
/** Objective-conflict evidence — a different, wider server contract. */
export interface ConflictEvidenceDto {
  readonly basis: string;
  readonly diffAvailable: boolean;
  readonly inspect: QueueInspectDto | null;
}
export interface QueueVerdictDto {
  readonly kind: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly targetDependencyId?: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
}
export interface DecisionItemDto {
  readonly verdicts: readonly QueueVerdictDto[];
  readonly kindLabel: string;
  readonly cause?: "candidate" | "escalation";
  readonly projectId: string;
  readonly projectName: string;
  readonly initiativeId: string;
  readonly objectiveId?: string;
  readonly taskId?: string;
  readonly downstream: number;
  readonly actionableSince: number | null;
  readonly evidence: QueueEvidenceDto;
  readonly expectedCommit?: string;
}
export interface DecisionQueueDto {
  readonly items: readonly DecisionItemDto[];
  readonly counts: {
    readonly total: number;
    readonly byKind: Readonly<Record<string, number>>;
  };
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}
export interface ConflictFileDto {
  readonly path: string;
  /** The whole conflict-marked file body from `git cat-file`, or "". */
  readonly hunks: string;
}
export interface TaskConflictDto {
  readonly taskId: string;
  readonly branch: string;
  readonly targetOID: string;
  readonly candidateOID: string;
  readonly files: readonly ConflictFileDto[];
}
export interface ObjectiveConflictDto {
  readonly objectiveId: string;
  readonly initiativeId: string;
  readonly status: string;
  readonly conflictCause: string | null;
  readonly parentOid: string | null;
  readonly commitOid: string | null;
  readonly observedTipOid: string | null;
  readonly currentTip: string | null;
  readonly tipMovedSinceAnchor: boolean;
  readonly conflictReason: string | null;
  readonly note: string | null;
  readonly evidence: ConflictEvidenceDto;
}
```

`QueueEvidenceDto` is assignable to `ConflictEvidenceDto`, so one renderer takes
the wider type. Do not collapse the two into one type: `views/queue.ts:22-29`
pins `basis`, `diffAvailable` and `executable` as literals, while
`views/conflict.ts:38-45` widens all three. Losing that distinction would let a
future `diffAvailable: true` on a queue item type-check.

- `DecisionItemDto.verdicts` is declared `readonly QueueVerdictDto[]` even though
  the wire view types it `readonly unknown[]`. The runtime element is always
  `actionView(...)` (`src/apps/http/views/shared.ts:18-28`). No runtime validator,
  no `unknown` narrowing at the call sites — the declared DTO is the contract,
  the same way every other DTO in this file treats an index-signature view.
- In `ui/src/lib/query-keys.ts`, append:

```ts
export const queueKeys = {
  list: (limit: number) => ["queue", { limit }] as const,
};
export const conflictKeys = {
  task: (taskId: string) => ["task", taskId, "conflict"] as const,
  objective: (objectiveId: string) =>
    ["objective", objectiveId, "conflict"] as const,
};
```

- In `ui/src/lib/api-client.ts`, append three helpers over the existing `apiGet`
  and `apiPath`. `apiGet` stays the only `fetch` caller; none of them sets a
  header.

```ts
export function fetchQueue(
  limit: number,
  init?: RequestInitLike,
): Promise<DecisionQueueDto>;
export function fetchTaskConflict(
  taskId: string,
  init?: RequestInitLike,
): Promise<TaskConflictDto>;
export function fetchObjectiveConflict(
  objectiveId: string,
  init?: RequestInitLike,
): Promise<ObjectiveConflictDto>;
```

Exact paths: `apiPath("/api/queue", { limit: String(limit) })`,
`` `/api/task/${taskId}/conflict` ``, `` `/api/objective/${objectiveId}/conflict` ``.

- Create `ui/src/lib/decision-queue.ts` with these five exports and nothing else:

```ts
/**
 * The API maximum (`src/apps/http/routes.ts:517`). One window, no paging.
 * The locked Proof measures `/api/queue` with NO limit, i.e. the server default
 * of 50 (`get-decision-queue.ts:94`). The two windows agree only while the
 * fixture yields fewer than 50 items — it yields exactly one. See index.md.
 */
export const QUEUE_LIMIT = 500;

/** Decision 3, verbatim. The only order text the Inbox renders. */
export const ORDER_STATEMENT =
  "Ordered by downstream dependents, highest first; then the oldest actionable item; items with no actionable time last.";

/** Decision 1: a render key, never an identity. */
export function rowKey(item: DecisionItemDto): string;

/** The target the row names. Always resolves — the initiative id is always present. */
export function rowTarget(item: DecisionItemDto): {
  readonly type: "task" | "objective" | "initiative";
  readonly id: string;
};

/** Decision 2's age column. `now` is the fetch time, never `Date.now()`. */
export function relativeAge(
  nowMs: number,
  actionableSince: number | null,
): string;
```

- `rowKey` returns
  `` `${item.projectId}|${item.initiativeId}|${item.objectiveId ?? ""}|${item.taskId ?? ""}|${item.kindLabel}` ``.
- `rowTarget` picks, in this exact order: `taskId` → `{type:"task"}`,
  else `objectiveId` → `{type:"objective"}`, else
  `{type:"initiative", id:item.initiativeId}`. Never returns `null`; the
  initiative id is always present (`views/queue.ts:17`).
- `relativeAge` is pure and total. `actionableSince === null` → exactly
  `"no actionable time"`. Otherwise `d = Math.max(0, nowMs - actionableSince)`
  and, in this order: `d < 60_000` → `"just now"`;
  `d < 3_600_000` → `` `${Math.floor(d / 60_000)}m` ``;
  `d < 86_400_000` → `` `${Math.floor(d / 3_600_000)}h` ``; else
  `` `${Math.floor(d / 86_400_000)}d` ``.
- Create `ui/src/lib/inspect.ts` with one export:

```ts
/**
 * Renders the server's own argv as a paste-able POSIX line. Adds separators and
 * quoting only — never a token, never a `kanthord ` prefix, never a git
 * subcommand (decision 10, as amended 2026-07-31).
 */
export function inspectCommand(
  inspect: {
    readonly executable: string;
    readonly args: readonly string[];
  } | null,
): string | null;
```

- `null` in → `null` out.
- Otherwise take `[inspect.executable, ...inspect.args]`, apply `quoteToken` to
  each, and join with one space.
- `quoteToken(token)`: return the token verbatim when it is non-empty **and**
  matches `/^[A-Za-z0-9_@%+=:,./-]+$/` — the conservative POSIX-safe set. In every
  other case (including the empty string) return
  `` `'${token.replaceAll("'", "'\\''")}'` ``. This is an allowlist, not a
  metacharacter blocklist: a blocklist silently passes through the next character
  someone's shell treats specially.
- The function adds no token and knows no CLI vocabulary. It never sees a string
  the server did not send.

## Constraints

- Do not add `expired` or `truncated` handling to `asyncStateOf` — decision 4
  renders truncation as a banner beside a live table, not as an `AsyncBoundary`
  state. `AsyncBoundary`'s `truncated` and `expired` branches stay unused by this
  epic.
- Do not add a write helper. `apiPatch`/`apiPostCreated` (EPIC 026.4) are not
  used by any file in this epic.
- Do not re-sort, filter, group or re-key the server's `items`. No client
  comparator exists anywhere in this epic.
- Do not add a `limit` control, a cursor, or a second window size.

## Verify

- `npm test --workspace ui -- src/lib/decision-queue.test.ts` — create this file.
  Assert: `QUEUE_LIMIT === 500`; `ORDER_STATEMENT` contains `"downstream"` and,
  lower-cased, contains neither `"impact"` nor `"priority"`; `rowKey` for an item
  with no `objectiveId`/`taskId` yields the two empty segments in place;
  two items differing only in `kindLabel` yield different keys; `rowTarget`
  precedence for all three shapes; `relativeAge` at each boundary
  (`null`, `0`, `59_999`, `60_000`, `3_599_999`, `3_600_000`, `86_399_999`,
  `86_400_000`, and a negative delta clamping to `"just now"`).
- `npm test --workspace ui -- src/lib/inspect.test.ts` — create this file. Assert:
  - `null` → `null`;
  - the real queue shape
    `{executable:"git",args:["-C","/tmp/home","diff","abc..def"]}` →
    exactly `"git -C /tmp/home diff abc..def"` (no token quoted);
  - a home containing a space →
    `"git -C '/tmp/my home' diff abc..def"`;
  - a token containing `'` is wrapped and its quote escaped as `'\''`;
  - a token containing `$`, backtick, `;`, `&`, `|`, `*`, `(`, newline or a tab is
    quoted — one assertion per character, driven by `test.each`;
  - the empty-string token becomes `''`, never a bare gap that would vanish on
    paste;
  - `args: []` returns just the executable;
  - the output is stable: calling it twice on the same input returns the identical
    string, and the function mutates neither `args` nor the input object.
- `npm test --workspace ui -- src/lib/api-client.test.ts` — extend the existing
  file, which already stubs `globalThis.fetch` with
  `vi.spyOn(globalThis, "fetch")` (`ui/src/lib/api-client.test.ts:19`). Assert the exact three request
  paths, that `fetchQueue(500)` requests `/api/queue?limit=500`, that the
  `{data}` envelope is unwrapped, that the `AbortSignal` is forwarded, and that
  no request carries an `authorization` header. Assert a 409 body surfaces as
  `ApiError` with `status === 409` and `code === "no_conflict_candidate"`.
- `npm test --workspace ui -- src/lib/query-keys.test.ts` — extend the existing
  file. Assert `queueKeys.list(500)` and both `conflictKeys` shapes literally.
- `npm run verify` exits 0.
- Proof: none directly. Phases C–F all read through these helpers.
