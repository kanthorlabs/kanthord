// src/apps/cli/setup/drift-report.ts — EPIC 015 Story 3
// Pure, synchronous formatter for drift and ambiguous outcomes emitted by
// `planSetup` / `planGraph`. The wizard's step executor (Story 4) pushes
// the returned lines onto stderr verbatim, so the line format is the
// public contract of this module — Phase I of the Proof greps it.
//
// Why pure: every line is a function of (outcome, ctx). No I/O, no clock,
// no port. The hermetic tests in `drift-report.test.ts` exercise every
// branch of the remediation table without a fake database, and a Phase I
// grep on the rendered output is the cheapest way to assert the Proof
// saw drift where it should have.

// ── Imports ──────────────────────────────────────────────────────────────────

import type {
  DriftField,
  StepOutcome,
} from "../../../app/project/setup-plan.ts";

// ── Public types ─────────────────────────────────────────────────────────────

export interface DriftContext {
  projectId: string;
  /** Present when `answers.graph.skip === false`; used by the graph remediation line. */
  packagePath?: string;
}

type DriftOutcome = Extract<StepOutcome, { kind: "drift" }>;
type AmbiguousOutcome = Extract<StepOutcome, { kind: "ambiguous" }>;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Format a `{kind:"drift"}` outcome into the line list the wizard prints to
 * stderr. Throws for `project` and `credential` because those objects have
 * no drift fields — reaching this branch is a programming error in the
 * caller, not a user-facing condition.
 */
export function formatDriftReport(
  outcome: DriftOutcome,
  ctx: DriftContext,
): string[] {
  const lines: string[] = [];
  lines.push(
    `error: drift on ${outcome.object}: ${outcome.fields.length} field(s) differ`,
  );
  for (const f of outcome.fields) {
    lines.push(formatFieldLine(f));
  }
  lines.push(formatRemediation(outcome, ctx));
  return lines;
}

/**
 * Format a `{kind:"ambiguous"}` outcome into two lines: the header and the
 * list of candidate ids. No remediation — nothing can be done automatically
 * when the answer names more than one thing.
 */
export function formatAmbiguousReport(
  outcome: AmbiguousOutcome,
  ctx: DriftContext,
): string[] {
  return [
    `error: ambiguous ${outcome.object}: ${outcome.candidates.length} candidates`,
    `  candidates: ${outcome.candidates.join(", ")}`,
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatFieldLine(f: DriftField): string {
  return `  ${f.field}: expected ${f.expected}, actual ${f.actual}`;
}

function formatRemediation(outcome: DriftOutcome, ctx: DriftContext): string {
  switch (outcome.object) {
    case "project":
    case "credential":
      throw new Error(
        `formatDriftReport: ${outcome.object} has no drift fields`,
      );
    case "repository":
      return formatRepositoryRemediation(outcome.fields, outcome.targetId);
    case "provider":
      return `remediation: kanthord remove ai-provider --id ${outcome.targetId} --cascade`;
    case "graph":
      return `remediation: kanthord import graph --create --dir ${ctx.packagePath ?? ""} --project ${ctx.projectId}`;
  }
  // Unreachable: SetupObject has 5 variants and all 5 are handled above.
  throw new Error(
    `formatDriftReport: unhandled object: ${(outcome as { object: string }).object}`,
  );
}

/**
 * Pick the repository remediation. `path` or `auth` in the drifted set
 * always takes the no-flag branch — `update repository` has no flag for
 * either (`src/apps/cli/commands/update/repository.ts:17-22`). When the
 * drifted set is a subset of `{remoteUrl, branch}` we can express the
 * fix as a single `update repository` command, with `--reclone` whenever
 * `remoteUrl` itself drifted (re-clone is required to pick up the new
 * remote).
 */
function formatRepositoryRemediation(
  fields: readonly DriftField[],
  targetId: string,
): string {
  const fieldNames = new Set(fields.map((f) => f.field));
  if (fieldNames.has("path") || fieldNames.has("auth")) {
    return `remediation: no flag exists on 'update repository' for path/auth — revert the drifted answer to the actual value above, or remove and recreate the repository resource`;
  }
  // fields ⊆ {remoteUrl, branch}
  const parts: string[] = [`kanthord update repository --id ${targetId}`];
  const remoteField = fields.find((f) => f.field === "remoteUrl");
  if (remoteField) {
    parts.push(`--remote-url ${remoteField.expected}`);
  }
  const branchField = fields.find((f) => f.field === "branch");
  if (branchField) {
    parts.push(`--branch ${branchField.expected}`);
  }
  if (remoteField) {
    parts.push("--reclone");
  }
  return `remediation: ${parts.join(" ")}`;
}
