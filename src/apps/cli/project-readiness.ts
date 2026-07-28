// src/apps/cli/project-readiness.ts — EPIC 014 Story 6
// CLI handler for `kanthord check project`. Thin layer over the `CheckProject`
// use case: missing-flag detection, JSON vs text output, error mapping. The
// `--json` branch writes NOTHING to stderr — the Proof phase C captures
// `2>&1` and `JSON.parse`s the file, so a single stray stderr line breaks
// four phases.

import type { CheckProject } from "../../app/project/check-project.ts";
import type { ReadinessReport } from "../../app/project/project-readiness.ts";
import { requireFlag, toResult } from "./error-map.ts";

export type HandlerResult = {
  exitCode: number;
  stdout: string[];
  stderr: string[];
};

function formatVerified(verified: ReadinessReport["verified"]): string {
  return verified === null ? "null" : String(verified);
}

/**
 * Render the report as a deterministic, line-oriented text table.
 * Order: 5 headline lines, one check line per check in `checks` order, one
 * probe line per probe directly under its check, then the `next:` block
 * (when actionable). The probe line is present iff the check has probes.
 */
function renderText(report: ReadinessReport): string[] {
  const lines: string[] = [
    `project: ${report.projectId}`,
    `configured: ${report.configured}`,
    `verified: ${formatVerified(report.verified)}`,
    `operational: ${report.operational}`,
    `ready: ${report.ready}`,
  ];
  for (const c of report.checks) {
    lines.push(`${c.name.padEnd(13)}${String(c.status).padEnd(11)}${c.detail}`);
    if (c.probes !== undefined) {
      for (const p of c.probes) {
        lines.push(`  - ${p.resourceId} ${p.status} ${p.detail}`);
      }
    }
  }
  if (report.next !== null) {
    lines.push(`next: ${report.next.action}`);
    if (report.next.requiresInput.length > 0) {
      lines.push(`  requires: ${report.next.requiresInput.join(", ")}`);
    } else {
      // `command` is set by the pure builder only when every value is known,
      // so this branch is only reachable when the next-action's command is
      // present. The `as string` cast is sound: the pure builder's `next`
      // table sets `command` iff `requiresInput` is empty.
      lines.push(`  run: ${report.next.command!}`);
    }
  }
  return lines;
}

export async function runCheckProject(
  args: Record<string, unknown>,
  checkProject: CheckProject,
): Promise<HandlerResult> {
  try {
    const id = requireFlag(args, "id");
    const probeRepositories = args["probe-repositories"] === true;
    const probeProvider = args["probe-provider"] === true;
    const report = await checkProject.execute({
      id,
      probeRepositories,
      probeProvider,
    });

    if (args["json"] === true) {
      // `stderr: []` is load-bearing — the Proof phase C captures `2>&1` and
      // JSON.parses the file, so any stray stderr line breaks four phases.
      return {
        exitCode: report.ready ? 0 : 1,
        stdout: [JSON.stringify(report, null, 2)],
        stderr: [],
      };
    }

    return {
      exitCode: report.ready ? 0 : 1,
      stdout: renderText(report),
      stderr: [],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}
