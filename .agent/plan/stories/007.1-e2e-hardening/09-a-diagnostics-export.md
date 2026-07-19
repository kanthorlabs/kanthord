# Story 09 — A: diagnostics export — closed safe-facts schema + canary

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

A new `src/observability/` module + `DiagnosticsExport` use case projects the
private `events` journal into a CLOSED safe-facts schema — the **single
sanitization boundary**. A new `diagnostics export --initiative <id> --out <file>`
CLI command writes the artifact. This is the ONLY shareable artifact; the private
journal stays local and sensitive.

Enforcement (all from the debate-hardened findings):

- Closed record kinds + closed error enum (`unknown → internal_unclassified`).
- NO `message` / `metadata` / `Record<string,unknown>` in the output schema.
- Runtime exact-schema validation: reject records with unknown keys.
- Explicit field-by-field serialization: NEVER spread (`...r`), `Object.assign`,
  or `JSON.parse(JSON.stringify(...))`.
- Opaque RANDOM `taskRef` / `sessionRef` (NOT hashes — low-entropy names are
  guessable); same refs stored in a new `observability_refs` table for local
  correlation. `seq` gaps reveal dropped records; detected and warned.
- Import restriction: only `src/app/observability/diagnostics-export.ts` (and the
  CLI handler) import from `src/observability/schema.ts`. No other module produces
  the artifact.
- Owner-only bounded file (`mode: 0o600`).
- Canary tests prove prompts / paths / commands / tool-args / errors / credentials
  / repo / branch / commit text NEVER appear in the output.
- `--debug` flag raises capture frequency in display; it does NOT expand sensitivity
  or add new string fields to the output.

Reuses the structural-omission discipline from Story 03 (D6): same explicit
field-list pattern, same no-spread rule.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/observability/schema.ts  (NEW)

export const SCHEMA_VERSION = "007.1";

export const SAFE_FACTS_KINDS = [
  "task.lifecycle", // task.started / task.completed / task.failed / task.escalated
  "agent.turn", // agent.started (start of run) / agent.finished (with tokens)
  "agent.tool", // agent.progress (one per captured tool call)
  "task.verification", // from task.verification events
  "task.outcome", // summary outcome record keyed on task.completed / task.failed
] as const;
export type SafeFactsKind = (typeof SAFE_FACTS_KINDS)[number];

export const SAFE_FACTS_ERROR_CODES = [
  "budget_exceeded",
  "credential_error",
  "workspace_error",
  "verification_failed",
  "agent_error",
  "result_capture_error",
  "internal_unclassified", // catch-all — any unrecognised reason maps here
] as const;
export type SafeFactsErrorCode = (typeof SAFE_FACTS_ERROR_CODES)[number];

// Closed, flat, no free-form strings:
export interface SafeFactsRecord {
  schemaVersion: string; // always SCHEMA_VERSION
  sessionRef: string; // opaque random — NOT the real run/session id
  taskRef: string; // opaque random — NOT the real task id
  seq: number; // 1-based, monotone within (sessionRef, taskRef)
  timestamp: string; // ISO 8601 UTC from event id (ULID timestamp)
  kind: SafeFactsKind;
  outcomeCode?: SafeFactsErrorCode; // present on task.outcome + task.lifecycle failed
  reasonCode?: SafeFactsErrorCode; // present on task.outcome
  toolCategory?: "read" | "write" | "exec" | "search" | "other"; // agent.tool only
  exitClass?: "pass" | "fail" | "timeout"; // task.verification only
  durationMs?: number; // numeric, from payload.durationMs
  turns?: number; // numeric, from agent.finished payload.turns
  tokensIn?: number; // numeric, from agent.finished payload.tokensIn
  tokensOut?: number; // numeric, from agent.finished payload.tokensOut
}

export interface SafeFactsExport {
  schemaVersion: string;
  exportedAt: string; // ISO 8601 UTC
  initiativeRef: string; // opaque random — NOT the real initiative id
  records: SafeFactsRecord[];
}

// Throws SchemaValidationError when: kind is not in SAFE_FACTS_KINDS,
// unknown keys are present, or a numeric field is not typeof "number":
export function validateSafeFactsRecord(record: unknown): SafeFactsRecord;

// Explicit field-by-field — NEVER spread, Object.assign, or JSON roundtrip:
export function serializeSafeFactsRecord(
  r: SafeFactsRecord,
): Record<string, unknown>;

// Key list for validation + serialization (single source of truth):
export const SAFE_FACTS_RECORD_KEYS: ReadonlyArray<keyof SafeFactsRecord>;

export class SchemaValidationError extends Error {
  constructor(message: string); // name = "SchemaValidationError"
}
```

```ts
// src/app/observability/diagnostics-export.ts  (NEW)

// Deps interfaces (narrow — only what the use case needs):
interface EventReader {
  readAfter(
    cursor: string,
    limit?: number,
  ): Array<{
    id: string;
    type: string;
    taskId: string;
    payload?: Record<string, string>;
  }>;
}

interface TaskInitiativeReader {
  getInitiativeId(taskId: string): string | undefined;
  listByInitiative(initiativeId: string): Array<{ id: string }>;
}

interface ObservabilityRefs {
  getOrCreateTaskRef(taskId: string): string;
  getOrCreateInitiativeRef(initiativeId: string): string;
  getOrCreateSessionRef(runKey: string): string;
}

export interface DiagnosticsExportResult {
  recordCount: number;
  outPath: string;
  preview: Array<{ kind: SafeFactsKind; count: number }>;
}

export class DiagnosticsExport {
  constructor(
    events: EventReader,
    tasks: TaskInitiativeReader,
    refs: ObservabilityRefs,
    writeFile: (
      path: string,
      data: string,
      opts: { mode: number },
    ) => Promise<void>,
  );
  async execute(input: {
    initiativeId: string;
    taskId?: string; // if set, export only this task's events
    outPath: string;
    debug?: boolean; // raises sampling; never expands sensitivity
  }): Promise<DiagnosticsExportResult>;
}
```

```ts
// observability_refs table (extend migration 7 DDL or add migration 8 if 7
// is already applied; coordinate with Story 06 which anchors migration 7):
//
//   CREATE TABLE observability_refs (
//     kind      TEXT NOT NULL CHECK (kind IN ('task','initiative','session')),
//     entity_id TEXT NOT NULL,
//     ref       TEXT NOT NULL,
//     PRIMARY KEY (kind, entity_id)
//   );
//
// Adapter: SqliteObservabilityRefs  in  src/storage/sqlite/sqlite-observability-refs.ts

// src/apps/cli/diagnostics.ts  (NEW)
export async function runDiagnosticsExport(
  args: Record<string, unknown>,
  diagnosticsExport: DiagnosticsExport,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>;
// Flags: --initiative <id>, --task <id> (optional), --out <file>, --debug (boolean)
// Prints preview lines to stderr before writing the file.
// Missing --initiative → exit 1; missing --out → exit 1.

// COMMANDS["diagnostics export"] in src/apps/cli/router.ts
// RouterDeps gains: diagnosticsExport: DiagnosticsExport
```

```ts
// TOOL → toolCategory mapping (closed; lives in diagnostics-export.ts, not schema.ts):
// "Read"/"read"/*Read → "read"
// "Write"/"write"/*Write/*Edit → "write"
// "Bash"/"bash"/"exec"/*Exec → "exec"
// "Grep"/"grep"/"Search"/"search"/*Search → "search"
// everything else → "other"
// The raw tool name NEVER appears in the output.
```

## Constraints

- `src/observability/schema.ts` is the ONLY module from which `SafeFactsRecord`,
  `SafeFactsExport`, `validateSafeFactsRecord`, and `serializeSafeFactsRecord`
  are imported. Only `src/app/observability/diagnostics-export.ts` and
  `src/apps/cli/diagnostics.ts` may import from it. A canary test asserts this
  by checking that no `import ... from "../../observability/schema"` (or similar
  path) appears in any other source file. (Use `grep -r` in the canary; not a
  typecheck-only concern.)
- `serializeSafeFactsRecord` must list every field of `SafeFactsRecord` explicitly,
  one statement per field (`if (r.durationMs !== undefined) out.durationMs = r.durationMs`).
  TypeScript structural typing will not catch an accidental spread at compile time;
  the canary test does.
- `taskRef` / `sessionRef` / `initiativeRef` are minted via `newId()` from
  `src/domain/entity.ts` (a ULID-like random id). They are stored in
  `observability_refs` and reused on subsequent export calls for the same entity.
  They are NEVER derived from the real id (no hash, no substring). The canary
  tests this: inject a well-known task id `"TASK-CANARY-123"`; assert the output
  file does not contain `"TASK-CANARY-123"`.
- `seq` is assigned 1-based and monotone within each (sessionRef, taskRef) group.
  When the export detects a gap (seq jumps), it logs a warning to stderr only —
  NEVER adds a gap marker to the artifact.
- The output file is written with `mode: 0o600`. If the path already exists it is
  overwritten (truncated) without error.
- The EVENTS table CHECK (after migration 7) constrains the event type column.
  The projection must handle types that do not map to a `SafeFactsKind` gracefully
  (skip and warn to stderr) rather than throwing.
- `debug` flag raises sampling: in the events-display preview, shows more records;
  it does NOT change the schema, add new string fields, or include tool names.
- Requires Story 03 (D6) for the structural-omission discipline (no credential
  values via spread); the canary here also covers credential values.
- Requires Story 06 for `task.verification` events and `turns`/`tokensIn`/`tokensOut`
  journal fields.

## Verification Gate

- `node --test src/observability/schema.test.ts` — `validateSafeFactsRecord`
  throws `SchemaValidationError` on unknown keys; `serializeSafeFactsRecord` output
  has exactly the fields present in the record (no extras); `SAFE_FACTS_KINDS` and
  `SAFE_FACTS_ERROR_CODES` are frozen; all `SafeFactsKind` values are in
  `SAFE_FACTS_KINDS`.
- `node --test src/app/observability/diagnostics-export.test.ts` — (a) canary: inject
  events whose payloads contain `"sk-canary-999"` (credential), `"/home/user/repo"`
  (path), `"npm test --reporter=spec"` (command), `"TASK-CANARY-123"` (real task id);
  assert none appear in the serialized output; (b) refs are stable: two calls with
  same `initiativeId` produce the same `taskRef` / `initiativeRef`; (c) seq is
  contiguous; (d) all output records pass `validateSafeFactsRecord`; (e) import
  restriction canary: `grep -r 'from.*observability/schema'` over `src/` must match
  ONLY the two allowed files.
- `node --test src/apps/cli/diagnostics.test.ts` — missing `--initiative` returns
  exit 1; missing `--out` returns exit 1; valid call produces a JSON file matching
  `SafeFactsExport`.
- `npm run verify` (typecheck + test + lint + db status) all green.

---

### Task T1 — safe-facts schema types + validation + serialization

**Requires:** Story 06 T1 (EVENT_TYPES includes `task.verification`; migration 7
defines the event types the schema models; no hard runtime dependency — T1 is
self-contained but tests should use real event type strings from `EVENT_TYPES`).

**Input:** (new files) `src/observability/schema.ts`,
`src/observability/schema.test.ts`.

**Action — RED:** In `src/observability/schema.test.ts`:
(a) `validateSafeFactsRecord({ ...validRecord, extraKey: "x" })` throws
`SchemaValidationError` with message matching `/unknown key/` or `/extraKey/`.
(b) `validateSafeFactsRecord(validRecord)` returns the record unchanged.
(c) `validateSafeFactsRecord({ ...validRecord, durationMs: "500" })` throws
`SchemaValidationError` (string where number expected).
(d) `serializeSafeFactsRecord(recordWithAllFields)` produces an object with
exactly the fields present in the record — no extras, no missing optionals.
(e) `serializeSafeFactsRecord` called with a record that has `taskRef: "ref-a"`
returns an object where `JSON.stringify(result)` contains `"ref-a"` but does NOT
contain any real task id string passed as a canary (i.e., the schema module never
reads external ids — the caller already put the opaque ref in).
(f) `SAFE_FACTS_KINDS` and `SAFE_FACTS_ERROR_CODES` are frozen (`Object.isFrozen`).
Fails today: module does not exist.

**Action — GREEN:** Create `src/observability/schema.ts` with all constants,
interfaces, `SchemaValidationError`, `SAFE_FACTS_RECORD_KEYS`, `validateSafeFactsRecord`,
and `serializeSafeFactsRecord`. Freeze both `const` arrays with `Object.freeze`.
`validateSafeFactsRecord`: (i) check `kind in SAFE_FACTS_KINDS` (indexOf ≥ 0);
(ii) for each key of the incoming object, check it is in `SAFE_FACTS_RECORD_KEYS`;
throw on any unknown key; (iii) for `durationMs`, `turns`, `tokensIn`, `tokensOut`:
if present, assert `typeof === "number"`. `serializeSafeFactsRecord`: build a plain
object with one explicit assignment per field, guarded by `!== undefined`.

**Action — REFACTOR:** Extract `SAFE_FACTS_RECORD_KEYS` as the single source of
truth for both `validateSafeFactsRecord` (unknown-key check) and
`serializeSafeFactsRecord` (ensures they stay in sync). Verify no `...spread`
appears in the serializer.

**Output:** Closed schema module; frozen enums; runtime validation; explicit
serializer; tests green.

**Verify:** `node --test src/observability/schema.test.ts` green;
`npm run typecheck` exit 0.

---

### Task T2 — DiagnosticsExport use case + observability_refs table + canary

**Requires:** T1, Story 03 T1 (D6 structural-omission discipline), Story 06 T1–T4
(task.verification events and turns/tokens journal fields).

**Input:** (new files) `src/app/observability/diagnostics-export.ts`,
`src/app/observability/diagnostics-export.test.ts`,
`src/storage/sqlite/sqlite-observability-refs.ts`;
`src/storage/sqlite/migrations.ts` (extend migration 7 or add migration 8 for
the `observability_refs` table — coordinate with Story 06 which anchors migration 7).

**Action — RED:** In `src/app/observability/diagnostics-export.test.ts`:

**(a) Canary test:** build a fake `EventReader` that returns events with payloads
containing:

- `credential`: `{ payload: { outcome: "failed", reason: "sk-canary-999" } }`
  (type `agent.finished`).
- `path`: `{ payload: { workspace: "/home/user/secret-repo" } }` (type `agent.started`).
- `command`: `{ payload: { verifierKind: "cmd", phase: "start" } }` where the
  fake also includes `{ payload: { command: "npm test --reporter=spec" } }` — the
  projection must NOT copy this key.
- `realTaskId`: inject a real task id string `"TASK-CANARY-123"` in event.taskId.
  Call `execute(...)`. Serialize the result with `JSON.stringify`. Assert:
- `"sk-canary-999"` not in output.
- `"/home/user/secret-repo"` not in output.
- `"npm test"` not in output.
- `"TASK-CANARY-123"` not in output (refs are opaque random).
  Fails today: use case does not exist.

**(b) Ref-stability test:** call `execute(...)` twice with the same `initiativeId`.
Assert the `initiativeRef` and all `taskRef` values are identical across both calls.
Fails today: use case does not exist.

**(c) Seq-contiguous test:** inject 5 events for one task; assert `seq` values are
`[1, 2, 3, 4, 5]` in the output.

**(d) Schema-valid test:** assert every record in the output passes
`validateSafeFactsRecord` without throwing.

**(e) Import restriction canary:** add a test that runs:

```ts
import { execSync } from "node:child_process";
const out = execSync(
  `grep -r 'from.*observability/schema' src --include='*.ts' -l`,
  { cwd: process.cwd(), encoding: "utf8" },
).trim();
const files = out.split("\n").filter(Boolean);
const allowed = [
  "src/app/observability/diagnostics-export.ts",
  "src/apps/cli/diagnostics.ts",
];
for (const f of files) {
  assert.ok(
    allowed.some((a) => f.endsWith(a.replace(/\//g, "/"))),
    `Import restriction violated: ${f} imports from observability/schema`,
  );
}
```

Fails today: files do not exist (test itself will be created green after GREEN step).

**Action — GREEN:**

1. Add `observability_refs` table to migration 7 (or migration 8 if 7 is already
   landed): `CREATE TABLE observability_refs (kind TEXT NOT NULL CHECK (kind IN
('task','initiative','session')), entity_id TEXT NOT NULL, ref TEXT NOT NULL,
PRIMARY KEY (kind, entity_id))`.
2. Implement `SqliteObservabilityRefs` with `getOrCreate*` methods using
   `INSERT OR IGNORE` + `SELECT`.
3. Implement `DiagnosticsExport.execute`:
   - Read all events for the scope (initiative or specific task) via `EventReader`.
   - For each event, apply the closed projection map (switch on `event.type`):
     - `"task.started"` → kind `"task.lifecycle"`.
     - `"task.completed"` → kind `"task.outcome"` (include `outcomeCode` only if
       `payload.outcome === "completed"` — omit as no error).
     - `"task.failed"` → kind `"task.outcome"` + map `payload.reason` prefix to
       `SafeFactsErrorCode` via a closed map; unknown prefix → `"internal_unclassified"`.
     - `"agent.started"` / `"agent.finished"` → kind `"agent.turn"`. For
       `"agent.finished"`: parse `payload.turns`, `payload.tokensIn`,
       `payload.tokensOut` as integers; use `0` on parse failure.
     - `"agent.progress"` → kind `"agent.tool"`. Map `payload.tool` name to
       `toolCategory` via the closed map (see Constraints); do NOT copy the tool
       name itself.
     - `"task.verification"` → kind `"task.verification"`. Copy `exitClass`
       and parse `durationMs` as integer. Do NOT copy the verifierKind string or
       command text.
     - All other types → skip (log warning to stderr).
   - Lookup/mint opaque refs for each task + initiative.
   - Assign `seq` 1-based within each (sessionRef, taskRef).
   - Detect and warn on seq gaps.
   - Run `validateSafeFactsRecord` on each; skip + warn on failure.
   - Serialize via `serializeSafeFactsRecord` (NEVER spread).
   - Build `SafeFactsExport` and write to `outPath` with `mode: 0o600`.

**Action — REFACTOR:** Extract the event-type → SafeFactsKind switch into a module-level
`PROJECT_KIND` map. Extract the reason-string → SafeFactsErrorCode map into
`PROJECT_REASON_CODE`. Keep `DiagnosticsExport.execute` readable; avoid nested
helpers that themselves import from `schema.ts`.

**Output:** DiagnosticsExport produces validated, sanitized safe-facts records;
canary and ref-stability tests pass; seq is contiguous.

**Verify:** `node --test src/app/observability/diagnostics-export.test.ts` green;
`npm run typecheck` exit 0.

---

### Task T3 — CLI command + composition root wire-up

**Requires:** T1, T2.

**Input:** (new file) `src/apps/cli/diagnostics.ts`,
`src/apps/cli/diagnostics.test.ts`; `src/apps/cli/router.ts` (COMMANDS + RouterDeps),
`src/composition.ts` (buildDeps).

**Action — RED:** In `src/apps/cli/diagnostics.test.ts`:
(a) `runDiagnosticsExport({ initiative: "INI-1", out: "/tmp/test.json" },
    fakeDiagnosticsExport)` returns `exitCode: 0` and `stderr` contains at least
one preview line.
(b) `runDiagnosticsExport({ out: "/tmp/test.json" }, ...)` returns `exitCode: 1`
with `stderr[0]` matching `/--initiative/`.
(c) `runDiagnosticsExport({ initiative: "INI-1" }, ...)` returns `exitCode: 1`
with `stderr[0]` matching `/--out/`.
Fails today: module does not exist.

**Action — GREEN:**

1. Create `src/apps/cli/diagnostics.ts` with `runDiagnosticsExport`. Validate
   required flags; call `diagnosticsExport.execute(...)`; print preview summary
   lines to `stderr` (`"<count> records (<kind>: <n>, ...)"`) and the output path;
   return `exitCode: 0`.
2. Add `"diagnostics export"` to `COMMANDS` in `src/apps/cli/router.ts`:
   ```ts
   "diagnostics export": {
     usage: "diagnostics export --initiative <id> --out <file> [--task <id>] [--debug]",
     parse: {
       initiative: { type: "string" },
       task:       { type: "string" },
       out:        { type: "string" },
       debug:      { type: "boolean" },
     },
     handler: (args, deps) => runDiagnosticsExport(args, deps.diagnosticsExport),
   }
   ```
3. Add `diagnosticsExport: DiagnosticsExport` to `RouterDeps`.
4. In `src/composition.ts` (`buildDeps`): import `DiagnosticsExport`,
   `SqliteObservabilityRefs`; construct
   `const obsRefs = new SqliteObservabilityRefs(db)`;
   `const diagnosticsExport = new DiagnosticsExport(eventFeed, tasks, obsRefs, fs.writeFile)`;
   include in the returned `RouterDeps`.

**Action — REFACTOR:** Confirm `RouterDeps.diagnosticsExport` import uses
`import type` (no adapter leak from the router type file).

**Output:** `diagnostics export --initiative <id> --out <file>` works end-to-end;
composition root wires correctly; `npm run verify` green.

**Verify:** `node --test src/apps/cli/diagnostics.test.ts` green;
`npm run verify` (typecheck + test + lint + db status) all green.
