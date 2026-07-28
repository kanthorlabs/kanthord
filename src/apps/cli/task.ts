import type { CreateTask } from "../../app/task/create-task.ts";
import type { RetryTask } from "../../app/task/retry-task.ts";
import type { GetTask } from "../../app/task/get-task.ts";
import type { ApproveTask } from "../../app/task/approve-task.ts";
import type { RejectTask } from "../../app/task/reject-task.ts";
import type { GetConflict } from "../../app/task/get-conflict.ts";
import type { AbandonTask } from "../../app/task/abandon-task.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

export async function runCreateTask(
  args: Record<string, unknown>,
  createTask: CreateTask,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const objectiveId = args["objective"];
  if (typeof objectiveId !== "string" || objectiveId === "") {
    const err = new MissingFlagError("--objective");
    return { ...toResult(err), stdout: [] };
  }

  const title = args["title"];
  if (typeof title !== "string" || title === "") {
    const err = new MissingFlagError("--title");
    return { ...toResult(err), stdout: [] };
  }

  // Validate --instructions
  const instructions = args["instructions"];
  if (typeof instructions !== "string" || instructions === "") {
    const err = new MissingFlagError("--instructions");
    return { ...toResult(err), stdout: [] };
  }

  // Validate --ac
  const rawAc = args["ac"];
  if (
    rawAc === undefined ||
    rawAc === null ||
    (Array.isArray(rawAc) && (rawAc as string[]).length === 0)
  ) {
    const err = new MissingFlagError("--ac");
    return { ...toResult(err), stdout: [] };
  }
  const ac: string[] = Array.isArray(rawAc)
    ? (rawAc as string[])
    : [rawAc as string];

  // Normalize --agent: absent defaults to generic@1
  const rawAgent = args["agent"];
  const agent: string =
    typeof rawAgent === "string" && rawAgent !== "" ? rawAgent : "generic@1";

  // Normalize --verification: string → [string], array → string[], absent → undefined
  const rawVerification = args["verification"];
  let verification: string[] | undefined;
  if (rawVerification !== undefined) {
    verification = Array.isArray(rawVerification)
      ? (rawVerification as string[])
      : [rawVerification as string];
  }

  // Normalize --dependencies: may be a string, string[], or absent
  const rawDeps = args["dependencies"];
  let dependencies: string[] | undefined;
  if (rawDeps !== undefined) {
    dependencies = Array.isArray(rawDeps)
      ? (rawDeps as string[])
      : [rawDeps as string];
  }

  // Parse --context entries: each is "type=resourceId"
  const rawContext = args["context"];
  let context: Record<string, string> | undefined;
  if (rawContext !== undefined) {
    const entries = Array.isArray(rawContext)
      ? (rawContext as string[])
      : [rawContext as string];
    context = {};
    for (const entry of entries) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx === -1) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [
            `error: invalid --context value "${entry}": expected format type=resourceId`,
          ],
        };
      }
      const type = entry.slice(0, eqIdx);
      const resourceId = entry.slice(eqIdx + 1);
      context[type] = resourceId;
    }
  }

  try {
    const id = await createTask.execute({
      objectiveId,
      title,
      agent,
      instructions,
      ac,
      verification,
      dependencies,
      context,
    });
    return { exitCode: 0, stdout: [id], stderr: [`task created: ${title}`] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRetryTask(
  args: Record<string, unknown>,
  retryTask: RetryTask,
): Promise<HandlerResult> {
  const id = args["id"] as string;
  const note = typeof args["note"] === "string" ? args["note"] : undefined;
  const rebuild = args["rebuild"] === true ? true : undefined;
  try {
    await retryTask.execute({ taskId: id, note, rebuild });
    return { exitCode: 0, stdout: [], stderr: [`task re-queued: ${id}`] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runApproveTask(
  args: Record<string, unknown>,
  approveTask: ApproveTask,
): Promise<HandlerResult> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  try {
    const outcome = await approveTask.execute({ taskId: id });
    if (outcome.kind === "approved") {
      return { exitCode: 0, stdout: [id], stderr: [] };
    }
    if (outcome.kind === "conflict") {
      const files = outcome.conflictFiles;
      const filesPart =
        files && files.length > 0
          ? files.join(", ")
          : "conflicting files unavailable";
      return {
        exitCode: 0,
        stdout: [],
        stderr: [
          `conflict: task ${id} — merge conflict in ${filesPart}; inspect: get conflict --id ${id}; guide: retry task --id ${id} --note "<guideline>", then re-run daemon and approve`,
        ],
      };
    }
    if (outcome.kind === "target_moved") {
      return {
        exitCode: 0,
        stdout: [],
        stderr: [
          `info: task ${id} — target branch moved during approval; re-run approve to retry`,
        ],
      };
    }
    // landing_failed
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: ${outcome.message}`],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRejectTask(
  args: Record<string, unknown>,
  rejectTask: RejectTask,
): Promise<HandlerResult> {
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
  const reason =
    typeof args["reason"] === "string" ? args["reason"] : undefined;
  try {
    const outcome = await rejectTask.execute({
      taskId: id,
      resolution,
      reason,
    });
    const stdout = [
      id,
      ...(outcome?.skipped ?? []).map((skippedId) => `skipped: ${skippedId}`),
    ];
    return { exitCode: 0, stdout, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runGetConflict(
  args: Record<string, unknown>,
  getConflict: GetConflict,
): Promise<HandlerResult> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  try {
    const overview = await getConflict.execute({ taskId: id });
    const lines: string[] = [];
    lines.push(`target ${overview.branch}@${overview.targetOID}`);
    lines.push(`candidate ${overview.taskId}@${overview.candidateOID}`);
    for (const file of overview.files) {
      lines.push(`--- ${file.path} ---`);
      lines.push(file.hunks);
    }
    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    if (err instanceof NoConflictCandidateError) {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [`error: no conflict candidate found for task ${id}`],
      };
    }
    return { ...toResult(err), stdout: [] };
  }
}

export async function runGetTask(
  args: Record<string, unknown>,
  getTask: GetTask,
): Promise<HandlerResult> {
  const id = args["id"] as string;
  const useResult = args["result"] === true;
  const useJson = args["json"] === true;

  // mutual exclusion guard
  if (useResult && useJson) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --result and --json are mutually exclusive"],
    };
  }

  try {
    const output = await getTask.execute({ id });

    if (useJson) {
      return {
        exitCode: 0,
        stdout: [JSON.stringify(output)],
        stderr: [],
      };
    }

    if (useResult) {
      if (output.result === undefined) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [`error: task ${id} has no result yet`],
        };
      }
      const r = output.result;
      const lines: string[] = [
        `Summary: ${r.summary ?? ""}`,
        `Commit:  ${r.commitSha ?? ""}`,
        `Files:   ${r.workspace ?? ""}`,
        "--- Verification ---",
      ];
      if (r.evidence !== null && r.evidence !== undefined) {
        for (const entry of r.evidence) {
          lines.push(`$ ${entry.command}   exit ${entry.exitCode}`);
          if (entry.output) {
            lines.push(entry.output.slice(0, 500));
          }
        }
      }
      return { exitCode: 0, stdout: lines, stderr: [] };
    }

    const lines: string[] = [
      `id: ${output.id}`,
      `title: ${output.title}`,
      `status: ${output.status}`,
      `agent: ${output.agent ?? ""}`,
    ];

    if (output.result !== undefined) {
      const r = output.result;
      if (r.workspace !== null) lines.push(`workspace: ${r.workspace}`);
      if (r.branch !== null) lines.push(`branch: ${r.branch}`);
      if (r.commitSha !== null) lines.push(`commit_sha: ${r.commitSha}`);
      if (r.summary !== null) lines.push(`summary: ${r.summary}`);
      if (r.reason !== null) lines.push(`reason: ${r.reason}`);

      if (r.evidence !== null && r.evidence !== undefined) {
        for (const entry of r.evidence) {
          lines.push(`${entry.command} → exit ${entry.exitCode}`);
        }
      }
    }

    if (output.landingCandidate !== null) {
      const c = output.landingCandidate;
      lines.push(
        `landing candidate: ${c.state} (base ${c.baseSHA} → candidate ${c.candidateSHA}, target ${c.target})`,
      );
    }

    // EPIC 013 Story 6 — `abandoning` is a marker on a `running` task whose
    // lease has been revoked. Only print the line when true so a non-abandoning
    // task is byte-identical to today's output.
    if (output.abandoning) {
      lines.push("abandoning: true");
    }

    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

/**
 * EPIC 013 Story 6 — `abandon task --id <id> --reason <text>` handler.
 *
 * Both `abandoning` (lease revoked this call) and `already_abandoning`
 * (idempotent second call) resolve to exit 0 so the second `abandon` in
 * Proof phase B is a no-op and never fails. The 3 typed errors are
 * registered in `error-map.ts` so the CLI surfaces them as single-line
 * `error: …` messages instead of raw stack traces.
 */
export async function runAbandonTask(
  args: Record<string, unknown>,
  abandonTask: AbandonTask,
): Promise<HandlerResult> {
  const id = args["id"];
  if (typeof id !== "string" || id === "") {
    return { ...toResult(new MissingFlagError("--id")), stdout: [] };
  }
  const reason = args["reason"];
  if (typeof reason !== "string" || reason === "") {
    return { ...toResult(new MissingFlagError("--reason")), stdout: [] };
  }
  try {
    const outcome = abandonTask.execute({ taskId: id, reason });
    const note =
      outcome.outcome === "abandoning"
        ? `task abandoning: ${id} (lease revoked; draining at the next turn boundary)`
        : `task already abandoning: ${id}`;
    return { exitCode: 0, stdout: [id], stderr: [note] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}
