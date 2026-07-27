# Story 3 — Drift reporting

Epic: `.agent/plan/epics/015-guided-project-setup.md`
Depends on: Story 1 (`StepOutcome`, `DriftField`, `SetupObject`).

## Change

New file `src/apps/cli/setup/drift-report.ts` — a pure formatter. It imports
types only, from `../../../app/project/setup-plan.ts`.

```ts
export interface DriftContext {
  projectId: string;
  /** Present when `answers.graph.skip === false`; used by the graph remediation line. */
  packagePath?: string;
}

/** Lines for a `{kind:"drift"}` outcome, in order, each already prefixed. */
export function formatDriftReport(
  outcome: Extract<StepOutcome, { kind: "drift" }>,
  ctx: DriftContext,
): string[];

/** Lines for an `{kind:"ambiguous"}` outcome. */
export function formatAmbiguousReport(
  outcome: Extract<StepOutcome, { kind: "ambiguous" }>,
  ctx: DriftContext,
): string[];
```

`formatDriftReport` returns, in this exact order:

1. `error: drift on <object>: <n> field(s) differ` — `n = fields.length`, the
   noun always spelled `field(s)`.
2. one line per field, in `fields` order:
   `  <field>: expected <expected>, actual <actual>`
3. exactly one remediation line, chosen by this table:

| object                  | condition                              | remediation line                                                                                                                                                                                       |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repository`            | drifted fields ⊆ `{remoteUrl, branch}` | `remediation: kanthord update repository --id <targetId>` + ` --remote-url <expected>` when `remoteUrl` drifted + ` --branch <expected>` when `branch` drifted + ` --reclone` when `remoteUrl` drifted |
| `repository`            | `path` or `auth` drifted               | `remediation: no flag exists on 'update repository' for path/auth — revert the drifted answer to the actual value above, or remove and recreate the repository resource`                               |
| `provider`              | always                                 | `remediation: kanthord remove ai-provider --id <targetId> --cascade`                                                                                                                                   |
| `graph`                 | always                                 | `remediation: kanthord import graph --create --dir <ctx.packagePath> --project <ctx.projectId>`                                                                                                        |
| `project`, `credential` | never reachable                        | throw `new Error("formatDriftReport: <object> has no drift fields")`                                                                                                                                   |

`formatAmbiguousReport` returns exactly two lines:

1. `error: ambiguous <object>: <n> candidates` — `n = candidates.length`.
2. `  candidates: <ids joined by ", ">`

No remediation line for the ambiguous case: nothing can be done automatically
when the answer names more than one thing.

## Constraints

- Pure and synchronous: no I/O, no `deps`, no `CliIo`. Story 4 pushes the
  returned lines onto `stderr`.
- Flag names are the real ones: `update repository` has `--id`, `--name`,
  `--branch`, `--remote-url`, `--reclone` and **no `--path` / `--auth`**
  (`src/apps/cli/commands/update/repository.ts:17-22`); `remove ai-provider` has
  `--id` and `--cascade` (`src/apps/cli/commands/remove/ai-provider.ts:18,27`).
- The word `drift`, the word `expected` and the word `differ` all appear —
  Phase I greps `drift|differs|expected`.
- No secret is ever a `DriftField` value: the drifted fields are exactly
  `remoteUrl`, `branch`, `path`, `auth`, `model`, `baseUrl`, `route`,
  `graph.packagePath`. Assert this in the test rather than trusting it.
- Never emit the string `run daemon` from this module.

## Verify

`src/apps/cli/setup/drift-report.test.ts`:

- one drifted `remoteUrl` produces exactly three lines; line 1 contains `drift`,
  `repository` and `1 field(s) differ`; line 2 is
  `  remoteUrl: expected <A>, actual <B>` with both values present; line 3 is
  `remediation: kanthord update repository --id <id> --remote-url <A> --reclone`.
- one drifted `branch` produces a remediation with `--branch` and **without**
  `--reclone`.
- `remoteUrl` + `branch` together produce one remediation carrying both flags
  and `--reclone`.
- a drifted `path` produces the no-flag remediation line, and a drifted `auth`
  does too; `remoteUrl` + `path` together also take the no-flag branch.
- three drifted repository fields emit five lines with the field lines in the
  same order as `outcome.fields`.
- a drifted provider `model` produces
  `remediation: kanthord remove ai-provider --id <id> --cascade`.
- a drifted provider `route` renders `expected custom, actual builtin`.
- a drifted `graph.packagePath` produces
  `remediation: kanthord import graph --create --dir <packagePath> --project <projectId>`.
- `formatDriftReport` throws for `object: "project"` and for
  `object: "credential"`.
- `formatAmbiguousReport` on three candidates returns two lines, the second
  listing all three ids joined by `", "` in the given order.
- no output line from any of the above contains `run daemon`.
- `node --test src/apps/cli/setup/drift-report.test.ts`
- `npm run verify` exits 0.
- Proof: Phase I — `grep -qiE 'drift|differs|expected'`, plus both remote URLs
  present, plus the unchanged `db status` fingerprint (guaranteed because
  Story 4 aborts on drift before executing any step).
