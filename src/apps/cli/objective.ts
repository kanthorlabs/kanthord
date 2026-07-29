import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import type { ApproveObjective } from "../../app/objective/approve-objective.ts";
import type { RetryObjective } from "../../app/objective/retry-objective.ts";
import type { RejectObjective } from "../../app/objective/reject-objective.ts";
import type { GetObjective } from "../../app/objective/get-objective.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

export async function runCreateObjective(
  args: Record<string, unknown>,
  createObjective: CreateObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const initiativeId = args["initiative"] as string;
  const name = args["name"] as string;
  const after = (args["after"] as string[]) ?? [];
  try {
    const id = await createObjective.execute({ initiativeId, name, after });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`objective created: ${name}`],
    };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export async function runRenameObjective(
  args: Record<string, unknown>,
  renameObjective: RenameObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  const name = args["name"] as string;
  try {
    await renameObjective.execute({ id, name });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    const mapped = toResult(err);
    return { ...mapped, stdout: [] };
  }
}

export function runListObjectives(
  args: Record<string, unknown>,
  listObjectives: ListObjectives,
): { exitCode: number; stdout: string[]; stderr: string[] } {
  const initiativeId = args["initiative"] as string;
  const rows = listObjectives.execute({ initiativeId });
  if (args["json"]) {
    return { exitCode: 0, stdout: [JSON.stringify(rows)], stderr: [] };
  }
  return {
    exitCode: 0,
    stdout: rows.map((r) => `${r.id}  ${r.name}`),
    stderr: [],
  };
}

export async function runGetObjective(
  args: Record<string, unknown>,
  getObjective: GetObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"] as string;
  try {
    const output = await getObjective.execute({ id });
    if (args["json"]) {
      return { exitCode: 0, stdout: [JSON.stringify(output)], stderr: [] };
    }
    const lines: string[] = [
      `id: ${output.id}`,
      `name: ${output.name}`,
      `status: ${output.status}`,
    ];
    if (output.after.length > 0) {
      lines.push(`after: ${output.after.join(" ")}`);
    }
    for (const w of output.waiting) {
      if (w.neverSatisfies) {
        lines.push(`waiting on: ${w.id} (discarded — will never satisfy)`);
      } else {
        lines.push(`waiting on: ${w.id}`);
      }
    }
    lines.push(
      ...output.integrations.map(
        (i) => `integration: ${i.repository} ${i.state}`,
      ),
    );
    if (output.conflictCause !== null) {
      lines.push(`conflictCause: ${output.conflictCause}`);
    }
    if (output.conflictReason !== null) {
      lines.push(`conflictReason: ${output.conflictReason}`);
    }
    if (output.note !== null) {
      lines.push(`note: ${output.note}`);
    }
    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runApproveObjective(
  args: Record<string, unknown>,
  approveObjective: ApproveObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  // Story 4 (012) — required `--expected-commit` so the client echoes the
  // candidate it reviewed; checked here in addition to the commander
  // requiredOption so the runtime path is equally strict.
  const expectedCommit = args["expectedCommit"];
  if (typeof expectedCommit !== "string" || expectedCommit === "") {
    return {
      ...toResult(new MissingFlagError("--expected-commit")),
      stdout: [],
    };
  }
  try {
    // The use case records a conflict internally rather than throwing, so
    // announcing "integrated" unconditionally reported a success that did not
    // happen — it cost a full diagnosis to notice (e2e 20260727-141944). Exit
    // code stays 0: a conflict is a real, expected outcome of approving.
    const { outcome } = await approveObjective.execute({
      objectiveId: id,
      expectedCommit,
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [
        outcome === "integrated"
          ? `objective integrated: ${id}`
          : `objective conflict: ${id} — nothing was landed; resolve it and retry`,
      ],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRetryObjective(
  args: Record<string, unknown>,
  retryObjective: RetryObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  // Story 4 (012) — required `--expected-commit`.
  const expectedCommit = args["expectedCommit"];
  if (typeof expectedCommit !== "string" || expectedCommit === "") {
    return {
      ...toResult(new MissingFlagError("--expected-commit")),
      stdout: [],
    };
  }
  const note =
    typeof args["note"] === "string" && args["note"] !== ""
      ? args["note"]
      : undefined;
  try {
    await retryObjective.execute(
      note !== undefined
        ? { objectiveId: id, note, expectedCommit }
        : { objectiveId: id, expectedCommit },
    );
    return { exitCode: 0, stdout: [id], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRejectObjective(
  args: Record<string, unknown>,
  rejectObjective: RejectObjective,
  retryObjective: RetryObjective,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  const rawResolution = args["resolution"];
  if (typeof rawResolution !== "string" || rawResolution === "") {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: missing required flag --resolution"],
    };
  }
  if (rawResolution !== "retry" && rawResolution !== "discard") {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        `error: invalid --resolution value "${rawResolution}": must be "retry" or "discard"`,
      ],
    };
  }
  const resolution = rawResolution as "retry" | "discard";
  // Story 4 (012) — required `--expected-commit`, checked AFTER the
  // `--resolution` checks so the existing missing/invalid resolution messages
  // and their tests are unaffected.
  const expectedCommit = args["expectedCommit"];
  if (typeof expectedCommit !== "string" || expectedCommit === "") {
    return {
      ...toResult(new MissingFlagError("--expected-commit")),
      stdout: [],
    };
  }
  const reason =
    typeof args["reason"] === "string" ? args["reason"] : undefined;

  // Story 3 (017) §C — `--dry-run`/`--yes`/`--expect-impact`/`--json` apply
  // to the `discard` branch only, never `retry`.
  const dryRun = args["dryRun"] === true ? true : undefined;
  const yes = args["yes"] === true;
  const expectImpact =
    typeof args["expectImpact"] === "string" ? args["expectImpact"] : undefined;
  const json = args["json"] === true;

  if (resolution === "discard" && dryRun === true && yes) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --dry-run and --yes are mutually exclusive"],
    };
  }

  try {
    if (resolution === "retry") {
      await retryObjective.execute({ objectiveId: id, expectedCommit });
      return { exitCode: 0, stdout: [id], stderr: [] };
    }

    const outcome = await rejectObjective.execute({
      objectiveId: id,
      reason,
      expectedCommit,
      ...(dryRun !== undefined ? { dryRun } : {}),
      ...(expectImpact !== undefined ? { expectImpact } : {}),
    });

    const preview = outcome.preview;
    const stdout: string[] = [];
    if (json) {
      stdout.push(JSON.stringify(preview));
    } else {
      for (const d of preview.damage) {
        stdout.push(
          `impact: ${d.effect} ${d.target.type} ${d.target.id} ${d.target.name}`,
        );
      }
      stdout.push(`impact-digest: ${preview.digest}`);
    }
    // §C — the damage is printed above before this refusal, so it is
    // visible in the same invocation that refuses.
    if (dryRun !== true && !yes) {
      return {
        exitCode: 1,
        stdout,
        stderr: [
          "error: reject objective --resolution discard requires --yes (or --dry-run to preview)",
        ],
      };
    }
    if (!json) {
      stdout.push(id);
    }
    return { exitCode: 0, stdout, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
