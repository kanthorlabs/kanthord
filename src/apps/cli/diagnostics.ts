import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";

/**
 * CLI handler for `diagnostics export`.
 * Validates required flags then delegates to the DiagnosticsExport use case.
 * Returns preview summary lines in stderr (never stdout) so callers can redirect
 * the output file independently.
 */
export async function runDiagnosticsExport(
  args: Record<string, unknown>,
  diagnosticsExport: DiagnosticsExport,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const initiative = args["initiative"] as string | undefined;
  const out = args["out"] as string | undefined;

  if (!initiative) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: missing required flag --initiative"],
    };
  }

  if (!out) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: missing required flag --out"],
    };
  }

  const taskId = args["task"] as string | undefined;
  const debug = args["debug"] as boolean | undefined;

  const result = await diagnosticsExport.execute({
    initiativeId: initiative,
    outPath: out,
    taskId,
    debug,
  });

  const previewLines = result.preview.map(
    (p) => `  ${p.kind}: ${p.count} record(s)`,
  );

  return {
    exitCode: 0,
    stdout: [],
    stderr: [
      `diagnostics export: ${result.recordCount} record(s) written to ${result.outPath}`,
      ...previewLines,
    ],
  };
}
