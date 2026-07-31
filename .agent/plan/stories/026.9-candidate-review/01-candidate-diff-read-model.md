# Story 1 — the candidate diff read model: capability, domain source rule, two use cases

Epic: `.agent/plan/epics/026.9-candidate-review.md`

## Change

### 1. New capability `src/candidate-diff/port.ts`

Mirror `src/commit-presence/` (a `port.ts` + `git.ts` + `git.test.ts` pair).

```ts
export interface DiffLimits {
  /** Per-file patch byte cap. */
  readonly maxPatchBytes: number;
  /** File-count cap. */
  readonly maxFiles: number;
  /** Total patch byte budget across the whole response. */
  readonly maxTotalBytes: number;
}

export const DEFAULT_DIFF_LIMITS: DiffLimits = {
  maxPatchBytes: 262_144, // 256 KiB
  maxFiles: 300,
  maxTotalBytes: 8_388_608, // 8 MiB
};

export interface DiffFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  /** Previous path, renames only; `null` otherwise. */
  readonly oldPath: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly patch: string | null;
  readonly omitted: "too-large" | "binary" | "budget" | null;
}

export interface CandidateDiff {
  readonly files: readonly DiffFile[];
  /** Every changed file between base and head, before the file cap. */
  readonly totalFiles: number;
  readonly truncated: boolean;
}

export interface CandidateDiffReader {
  read(
    workspace: string,
    base: string,
    head: string,
    limits: DiffLimits,
  ): Promise<CandidateDiff>;
}

export class DiffObjectsUnreachableError extends Error {
  readonly workspace: string;
  readonly oid: string;
  constructor(workspace: string, oid: string) {
    super(`object ${oid} is not reachable in ${workspace}`);
    this.name = "DiffObjectsUnreachableError";
    this.workspace = workspace;
    this.oid = oid;
  }
}
```

### 2. New adapter `src/candidate-diff/git.ts` — `class GitCandidateDiffReader implements CandidateDiffReader`

Copy the exec helper verbatim from `src/objective-broker/git.ts:12-17` (`promisify(execFile)` + `gitOut`). `read` runs, in this exact order, all with `cwd: workspace`:

1. `git cat-file -e <base>^{commit}` then `git cat-file -e <head>^{commit}`. A non-zero exit on either throws
   `DiffObjectsUnreachableError(workspace, <the failing oid>)` — base checked first.
2. `git diff --numstat <base>..<head>` → one line per changed file, `<adds>\t<dels>\t<path>`.
   `totalFiles` = the number of non-empty lines. **This is the file order of the
   DTO; never re-sort.**
3. `git diff --name-status <base>..<head>` → `A|M|D|R<score>\t<path>[\t<newPath>]`.
   Build a `Map<path, {status, oldPath}>`: `A`→`added`, `M`→`modified`,
   `D`→`deleted`, `R*`→`renamed` with `oldPath` = the first field and the map
   keyed by the **second** field. Any other letter (`C`, `T`, `U`) →
   `modified`, `oldPath: null`.
4. For each of the first `limits.maxFiles` numstat lines, in order:
   - numstat `-\t-` → `binary: true`, `additions: 0`, `deletions: 0`,
     `patch: null`, `omitted: "binary"`. **No `git diff` is run for it.**
   - else `additions`/`deletions` are the parsed integers, `binary: false`, and
     the patch is `git diff <base>..<head> -- <path>` (for a rename, pass both
     `<oldPath>` and `<path>` after `--`).
     - `Buffer.byteLength(patch, "utf8") > limits.maxPatchBytes` →
       `patch: null`, `omitted: "too-large"`.
     - else if `spent + byteLength > limits.maxTotalBytes` → `patch: null`,
       `omitted: "budget"`, and **every later file also gets
       `omitted: "budget"`** without running `git diff` for it.
     - else `patch` is the string, `omitted: null`, and `spent` increases by its
       byte length.
5. `truncated` is `true` iff `totalFiles > limits.maxFiles` **or** any file
   carries `omitted: "budget"`. `binary` and `too-large` do **not** set it —
   they are per-file facts the DTO already names.
6. `read` writes nothing: no `fetch`, no `update-ref`, no `checkout`, no index
   or worktree command. The only verbs are `cat-file` and `diff`.

### 3. New domain module `src/domain/candidate-source.ts` (pure; imports nothing outside `src/domain/`)

```ts
export type CandidateSourceName =
  "landing-candidate" | "escalation" | "objective-candidate";

export type UnavailableReason =
  "workspace-missing" | "objects-unreachable" | "no-commit";

export type CandidateSource =
  | {
      readonly available: true;
      readonly source: CandidateSourceName;
      readonly workspace: string;
      readonly base: string;
      readonly head: string;
    }
  | {
      readonly available: false;
      readonly source: CandidateSourceName;
      readonly reason: "workspace-missing" | "no-commit";
      readonly base: string | null;
      readonly head: string | null;
    };

export function taskCandidateSource(input: {
  readonly candidate:
    { readonly baseSHA: string; readonly candidateSHA: string } | undefined;
  readonly result:
    | {
        readonly workspace: string | null;
        readonly baseCommit: string | null;
        readonly proposalCommit: string | null;
      }
    | undefined;
}): CandidateSource | null;

export function objectiveCandidateSource(input: {
  readonly parentOid: string | undefined;
  readonly commitOid: string | undefined;
  readonly workspace: string | undefined;
}): CandidateSource | null;
```

`taskCandidateSource` branch table — evaluate top to bottom, first match wins:

| `candidate` | `result.proposalCommit` | `result.workspace` | Result                                                                                                         |
| ----------- | ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| present     | —                       | non-empty          | `{available:true, source:"landing-candidate", workspace, base:candidate.baseSHA, head:candidate.candidateSHA}` |
| present     | —                       | `null` or `""`     | `{available:false, source:"landing-candidate", reason:"workspace-missing", base, head}`                        |
| absent      | non-null                | non-empty          | `{available:true, source:"escalation", workspace, base:result.baseCommit ?? "", head:proposalCommit}`          |
| absent      | non-null                | `null` or `""`     | `{available:false, source:"escalation", reason:"workspace-missing", base, head}`                               |
| absent      | `null`                  | —                  | `{available:false, source:"escalation", reason:"no-commit", base:result.baseCommit ?? null, head:null}`        |
| absent      | `result` undefined      | —                  | **`null`** — no source pair at all                                                                             |

An `available:true` landing-candidate row with `baseSHA === ""` is still
`available:true`; emptiness is the adapter's `cat-file` problem, not the
selector's.

`objectiveCandidateSource`:

- `commitOid` undefined → **`null`**.
- `workspace` undefined or `""` → `{available:false, source:"objective-candidate", reason:"workspace-missing", base: parentOid ?? null, head: commitOid}`.
- else → `{available:true, source:"objective-candidate", workspace, base: parentOid ?? "", head: commitOid}`.

### 4. Use case `src/app/task/get-task-candidate.ts`

Follow `src/app/task/get-conflict.ts` exactly: file-header comment, `// Port
types (narrow — owned by this consumer)`, `// Output types`, `// Typed error`,
`// Use case`; `#`-private fields, positional constructor args.

```ts
interface CandidateRepo {
  getCandidateByTask(
    taskId: string,
  ): { baseSHA: string; candidateSHA: string } | undefined;
}
interface TaskResultSource {
  get(
    taskId: string,
  ):
    | {
        workspace: string | null;
        baseCommit: string | null;
        proposalCommit: string | null;
      }
    | undefined;
}
interface TaskSource {
  get(taskId: string): { id: string } | undefined;
}

export interface CandidateDiffOutput {
  subject: "task" | "objective";
  subjectId: string;
  source: CandidateSourceName;
  base: string | null;
  head: string | null;
  available: boolean;
  unavailableReason: UnavailableReason | null;
  files: readonly DiffFile[];
  totalFiles: number;
  truncated: boolean;
  inspect: { executable: "git"; args: readonly string[] } | null;
}

export class NoCandidateError extends Error {
  readonly subjectId: string;
  constructor(subjectId: string) {
    super(`no candidate source for ${subjectId}`);
    this.name = "NoCandidateError";
    this.subjectId = subjectId;
  }
}

export class GetTaskCandidate {
  constructor(
    tasks: TaskSource,
    candidates: CandidateRepo,
    results: TaskResultSource,
    reader: CandidateDiffReader,
    limits: DiffLimits,
  ) {}
  async execute(input: { taskId: string }): Promise<CandidateDiffOutput>;
}
```

`execute` steps, pinned:

1. `tasks.get(taskId)` undefined → `throw new UnknownReferenceError("task", taskId)`.
2. `const src = taskCandidateSource({ candidate: candidates.getCandidateByTask(taskId), result: results.get(taskId) })`.
3. `src === null` → `throw new NoCandidateError(taskId)`.
4. `src.available === false` → return with `available: false`,
   `unavailableReason: src.reason`, `files: []`, `totalFiles: 0`,
   `truncated: false`, `inspect: inspectFor(src)`.
5. else `await reader.read(src.workspace, src.base, src.head, limits)`. A
   `DiffObjectsUnreachableError` is caught and returned as
   `available: false`, `unavailableReason: "objects-unreachable"`, `files: []`,
   `totalFiles: 0`, `truncated: false`. **Any other error propagates.**
6. Success returns `available: true`, `unavailableReason: null` and the reader's
   `files`/`totalFiles`/`truncated`.

`inspect` is built by a module-local helper shared by both use cases, copied
from the shape at `src/domain/decision-queue.ts:101-112`:
`{ executable: "git", args: ["-C", workspace, "diff", `${base}..${head}`] }`,
returned only when `workspace`, `base` and `head` are all non-empty and both
oids match `/^[0-9a-f]{7,64}$/`; otherwise `null`. Put it in
`src/domain/candidate-source.ts` as `export function candidateInspect(src: CandidateSource): { executable: "git"; args: string[] } | null`
so no `apps/` or duplicated regex is involved.

### 5. Use case `src/app/objective/get-objective-candidate.ts`

Same shape. Ports:

```ts
interface ObjectiveSource {
  get(
    id: string,
  ):
    | {
        id: string;
        initiativeId: string;
        parentOid?: string;
        commitOid?: string;
      }
    | undefined;
}
interface InitiativeWorkspaceSource {
  workspaceOf(initiativeId: string): string | undefined;
}
export class GetObjectiveCandidate {
  constructor(
    objectives: ObjectiveSource,
    initiatives: InitiativeWorkspaceSource,
    reader: CandidateDiffReader,
    limits: DiffLimits,
  ) {}
  async execute(input: { objectiveId: string }): Promise<CandidateDiffOutput>;
}
```

Steps mirror Story-1 §4 with `UnknownReferenceError("objective", id)`,
`objectiveCandidateSource`, and `subject: "objective"`. Both use cases share
`CandidateDiffOutput`, `NoCandidateError` and the inspect helper: declare
`CandidateDiffOutput` and `NoCandidateError` **once**, in
`src/app/task/get-task-candidate.ts`, and import the types into the objective
use case. No use case calls another.

### 6. Wiring — `src/composition.ts`

Import `GitCandidateDiffReader` beside `:151` and the two use cases beside
`:118`. Construct immediately after `getObjectiveConflict` (`:1009-1018`):

```ts
const candidateDiffReader = new GitCandidateDiffReader();
const getTaskCandidate = new GetTaskCandidate(
  { get: (id) => taskRepository.get(id) },
  { getCandidateByTask: (id) => landingRepository.getCandidateByTask?.(id) },
  { get: (id) => taskRepository.getTaskResult(id) },
  candidateDiffReader,
  DEFAULT_DIFF_LIMITS,
);
const getObjectiveCandidate = new GetObjectiveCandidate(
  { get: (id) => initiativeRepository.getObjective(id) },
  { workspaceOf: (id) => initiativeRepository.get(id)?.workspace },
  candidateDiffReader,
  DEFAULT_DIFF_LIMITS,
);
```

Every store is an arrow wrapper, never a bare method reference
(AGENTS.md). Expose both on the deps bundle beside `getConflict`.

### 7. `docs/ui-design.md`

The roadmap row and the "026.9 covers objective verdicts" note were already
amended while the epic was authored. **Verify both are present and change
nothing**; if either is missing, add it from epic decision 14. Do not duplicate.

## Constraints

- `src/domain/candidate-source.ts` imports nothing outside `src/domain/` and
  performs no I/O.
- The adapter never runs a writing git verb. `fetch`, `update-ref`, `checkout`,
  `add`, `commit`, `merge` and `merge-tree` must not appear in
  `src/candidate-diff/git.ts`.
- Do not touch `src/landing/git.ts`, `src/objective-broker/git.ts` or
  `GetConflict`.
- `getCandidateByTask` is optional on `LandingRepository`
  (`src/storage/port.ts:215`); call it as `?.(id)` in the wrapper, never
  assume it.

## Verify

- `node --test src/domain/candidate-source.test.ts` — every row of the
  `taskCandidateSource` branch table above, one test each, asserting the whole
  returned object; both `objectiveCandidateSource` unavailable cases and its
  `null`; `candidateInspect` returns `null` for an empty workspace, an empty
  oid, and a non-hex oid, and the exact argv for a valid triple.
- `node --test src/candidate-diff/git.test.ts` — real temp git repos, hermetic
  `mkdtemp` + `rm` in `finally`, following `src/landing/git.test.ts:25-66`:
  an added, a modified, a deleted and a renamed file each map to the right
  `status`/`oldPath`; a file larger than a `maxPatchBytes` of `64` gets
  `patch: null`, `omitted: "too-large"` and **keeps its `additions`/`deletions`**;
  a binary file gets `binary: true`, `omitted: "binary"`, `patch: null` and no
  `git diff` for it; with `maxFiles: 1` over three changed files the DTO has one
  file, `totalFiles: 3`, `truncated: true`; with a `maxTotalBytes` that fits the
  first patch only, the second and third carry `omitted: "budget"` and
  `truncated` is `true`; an unknown `head` oid throws
  `DiffObjectsUnreachableError` carrying that oid; and — the load-bearing one —
  a content hash of every file under the repo directory is **identical before and
  after** a `read` call.
- `node --test src/app/task/get-task-candidate.test.ts` — fakes only, no git:
  an unknown task throws `UnknownReferenceError`; no result row throws
  `NoCandidateError`; a persisted candidate picks `landing-candidate` and calls
  the reader with `(workspace, baseSHA, candidateSHA, limits)`; no candidate plus
  a `proposalCommit` picks `escalation` with `baseCommit..proposalCommit`; a
  `null` `proposalCommit` returns `available:false`,
  `unavailableReason:"no-commit"` and **does not call the reader**; a reader
  throwing `DiffObjectsUnreachableError` returns
  `unavailableReason:"objects-unreachable"`; a reader throwing any other error
  propagates.
- `node --test src/app/objective/get-objective-candidate.test.ts` — the same
  axes for `objective-candidate`, plus: a missing initiative workspace returns
  `workspace-missing` and does not call the reader.
- `npm run verify` exits 0.
- Proof: phase C (`the objective candidate route answers 200`, `it names the
source it read`, `the diff is available`, `base is the objective's parent
oid`, `head is the objective's candidate oid`, `it returns at least one
file`, `the file the fixture wrote is in the diff`, `that file carries a real
patch`, `reading the diff did not mutate the bare managed home`).
