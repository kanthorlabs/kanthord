/**
 * Story 05 T1 / Story 06 T1 — PiAgentRunner
 *
 * Implements AgentRunner using:
 *   - pi-agent-core's Agent loop
 *   - PiAgentProfile (system prompt, tool set, verifier)
 *   - ProviderSessionFactory (pi-ai model/session)
 *   - WorkspaceManager (clone/prepare workspace)
 *   - InstructionLoader (AGENTS.md / CLAUDE.md discovery)
 *
 * Orchestration:
 *   1. Profile lookup → UnknownAgentError if missing
 *   2. Credential binding check → CredentialError if absent
 *   3. Session factory call → CredentialError / UnknownModelError propagated
 *   4. Workspace source resolution → WorkspaceUnresolvableError / InvalidContextError
 *   5. workspaces.prepare()
 *   6. Instruction loading via newInstructionLoader(workspace.dir).load()
 *   7. Agent run with profile tools + built-in escalate tool
 *   (Story 06) Post-run:
 *   8. Compute OutcomeEvidence (git diff + last assistant text)
 *   9. Escalated → proposal commit + return escalated result
 *  10. profile.verify → failed on rejected verdict
 *  11. D6: execute task.verification commands sequentially
 *  12. Finalize: commit-if-dirty → return completed result
 *
 * All failures resolve to { outcome: "failed", reason } — the runner never throws.
 */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type {
  AIProvider,
  Credential,
  Filesystem,
  Repository,
} from "../domain/resource.ts";
import type { Task } from "../domain/task.ts";
import type { EventType } from "../domain/event.ts";
import type { Workspace } from "../workspace/port.ts";
import type { WorkspaceManager } from "../workspace/port.ts";
import type { Instruction, InstructionLoader } from "../instruction/port.ts";
import type { AgentRunner, TaskContextBinding, TaskResult } from "./port.ts";
import type { PiAgentProfile } from "./pi-profile.ts";
import type { ProviderSession, ProviderSessionFactory } from "./pi-session.ts";
import type { OutcomeEvidence, VerificationEvidence } from "./verification.ts";
import { renderTaskPrompt } from "./task-prompt.ts";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Escalate tool schema (defined once at module level)
// ---------------------------------------------------------------------------

const ESCALATE_PARAMS = Type.Object({ reason: Type.String() });

// ---------------------------------------------------------------------------
// Runner-local error classes
// ---------------------------------------------------------------------------

class WorkspaceUnresolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceUnresolvableError";
  }
}

class InvalidContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContextError";
  }
}

// ---------------------------------------------------------------------------
// Git helpers (module-level pure async functions)
// ---------------------------------------------------------------------------

/** Run a git command and return trimmed stdout. Throws on non-zero exit. */
async function gitRun(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

/** Extract the stderr string from a child-process error. */
function extractStderr(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return e.stderr?.trim() || e.message || String(err);
}

/** Extract the last assistant-message text from the agent's message history. */
function lastAssistantText(agent: Agent): string {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      role?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (m.role === "assistant") {
      return (m.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .slice(0, 500);
    }
  }
  return "";
}

/** Compute OutcomeEvidence from the workspace after the agent has finished.
 * Throws on git failure so the caller can return ResultCaptureError.
 */
async function computeEvidence(
  workspaceDir: string,
  baseCommit: string,
  agent: Agent,
): Promise<OutcomeEvidence> {
  // Tracked files changed vs baseCommit (working-tree diff, includes committed changes)
  // This throws if .git is absent — caller wraps as ResultCaptureError.
  const diffOut = await gitRun(workspaceDir, [
    "diff",
    "--name-only",
    baseCommit,
  ]);
  const trackedFiles = diffOut.split("\n").filter(Boolean);

  // Untracked new files (best-effort; if it fails we just get no untracked listing)
  let untrackedFiles: string[] = [];
  try {
    const out = await gitRun(workspaceDir, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    untrackedFiles = out.split("\n").filter(Boolean);
  } catch {
    // .git gone or no git — not reachable here if the line above succeeded
  }

  const files = [...trackedFiles, ...untrackedFiles];
  const finalResponse = lastAssistantText(agent);

  return {
    baseCommit,
    finalDiff: { files, hasChanges: files.length > 0 },
    finalResponse,
  };
}

/**
 * Create a proposal commit on kanthord/proposal/<taskId> containing all
 * current working-tree + index changes relative to baseCommit.
 * The task branch (HEAD) is left unchanged.
 * Returns the proposal commit SHA.
 */
async function createProposalCommit(
  workspaceDir: string,
  baseCommit: string,
  taskId: string,
): Promise<string> {
  // Stage all changes (including untracked files)
  await execFile("git", ["add", "-A"], { cwd: workspaceDir });
  // Create a tree object from the index
  const tree = await gitRun(workspaceDir, ["write-tree"]);
  // Create a commit object (doesn't update HEAD or any branch)
  const proposalSha = await gitRun(workspaceDir, [
    "-c",
    "user.name=kanthord",
    "-c",
    "user.email=kanthord@localhost",
    "commit-tree",
    tree,
    "-p",
    baseCommit,
    "-m",
    `kanthord: proposal for ${taskId}`,
  ]);
  // Point the proposal branch at the new commit
  await execFile(
    "git",
    ["update-ref", `refs/heads/kanthord/proposal/${taskId}`, proposalSha],
    { cwd: workspaceDir },
  );
  return proposalSha;
}

/**
 * Run a single verification command via sh -c.
 * Captures combined stdout+stderr and the exit code.
 * Never throws — exit code -1 signals timeout or spawn error.
 */
async function runVerificationCmd(
  workspaceDir: string,
  cmd: string,
): Promise<VerificationEvidence> {
  try {
    const { stdout, stderr } = await execFile("sh", ["-c", cmd], {
      cwd: workspaceDir,
      timeout: 300_000,
    });
    return {
      command: cmd,
      exitCode: 0,
      output: (stdout + stderr).slice(0, 10_000),
    };
  } catch (err) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const exitCode = typeof e.code === "number" ? e.code : -1;
    return {
      command: cmd,
      exitCode,
      output: ((e.stdout ?? "") + (e.stderr ?? "")).slice(0, 10_000),
    };
  }
}

/**
 * Build a progress summary from a tool name and its arguments.
 * Applies the redactor and truncates to maxLen characters.
 */
function buildSummary(
  toolName: string,
  args: Record<string, unknown>,
  maxLen: number,
  redact: (s: string) => string,
): string {
  const firstStrVal = Object.values(args).find((v) => typeof v === "string") as
    string | undefined;
  const raw =
    firstStrVal !== undefined ? `${toolName}: ${firstStrVal}` : toolName;
  return redact(raw).slice(0, maxLen);
}

/**
 * Finalize the task branch: commit if dirty, then return the HEAD commit SHA.
 * If the working tree is already clean (agent committed), this is a no-op.
 */
async function finalize(
  workspaceDir: string,
  taskTitle: string,
): Promise<string> {
  const status = await gitRun(workspaceDir, ["status", "--porcelain"]);
  if (status.length > 0) {
    await execFile("git", ["add", "-A"], { cwd: workspaceDir });
    await execFile(
      "git",
      [
        "-c",
        "user.name=kanthord",
        "-c",
        "user.email=kanthord@localhost",
        "commit",
        "-m",
        `kanthord: ${taskTitle}`,
      ],
      { cwd: workspaceDir },
    );
  }
  return gitRun(workspaceDir, ["rev-parse", "HEAD"]);
}

// ---------------------------------------------------------------------------
// PiAgentRunner
// ---------------------------------------------------------------------------

export interface PiAgentRunnerOptions {
  sessions: ProviderSessionFactory;
  workspaces: WorkspaceManager;
  newInstructionLoader: (workspaceDir: string) => InstructionLoader;
  getResource: (id: string) => unknown;
  profiles: Map<string, PiAgentProfile>;
  getPriorRejection: (
    taskId: string,
  ) =>
    { reason: string; summary?: string; proposalCommit?: string } | undefined;
  /** Optional event emitter — called for agent lifecycle events (Story 08). */
  emit?: (
    taskId: string,
    type: EventType,
    payload: Record<string, string>,
  ) => void;
  /** Optional clock — returns ms since epoch (injectable for tests). */
  clock?: () => number;
  /** Maximum agent turns (default 50). */
  maxTurns?: number;
}

export class PiAgentRunner implements AgentRunner {
  readonly #sessions: ProviderSessionFactory;
  readonly #workspaces: WorkspaceManager;
  readonly #newInstructionLoader: (workspaceDir: string) => InstructionLoader;
  readonly #getResource: (id: string) => unknown;
  readonly #profiles: Map<string, PiAgentProfile>;
  readonly #getPriorRejection: (
    taskId: string,
  ) =>
    { reason: string; summary?: string; proposalCommit?: string } | undefined;
  readonly #emit: (
    taskId: string,
    type: EventType,
    payload: Record<string, string>,
  ) => void;
  readonly #clock: () => number;
  readonly #maxTurns: number;

  constructor(options: PiAgentRunnerOptions) {
    this.#sessions = options.sessions;
    this.#workspaces = options.workspaces;
    this.#newInstructionLoader = options.newInstructionLoader;
    this.#getResource = options.getResource;
    this.#profiles = options.profiles;
    this.#getPriorRejection = options.getPriorRejection;
    this.#emit = options.emit ?? (() => {});
    this.#clock = options.clock ?? (() => Date.now());
    this.#maxTurns = options.maxTurns ?? 50;
  }

  async run(task: Task, context: TaskContextBinding[]): Promise<TaskResult> {
    const result = await this.#doRun(task, context);
    this.#emit(task.id, "agent.finished", { outcome: result.outcome });
    return result;
  }

  async #doRun(task: Task, context: TaskContextBinding[]): Promise<TaskResult> {
    // 1. Profile lookup
    const profile = this.#profiles.get(task.agent ?? "");
    if (!profile) {
      return {
        outcome: "failed",
        reason: `UnknownAgentError: unknown agent: ${task.agent ?? ""}`,
      };
    }

    // 2. Credential binding check (before calling session factory)
    const credBinding = context.find((b) => b.type === "credential");
    if (!credBinding) {
      return {
        outcome: "failed",
        reason: "CredentialError: task has no credential context",
      };
    }
    const aiBinding = context.find((b) => b.type === "ai_provider");
    if (!aiBinding) {
      return {
        outcome: "failed",
        reason: "CredentialError: task has no ai_provider context",
      };
    }

    const aiProvider = this.#getResource(aiBinding.resourceId) as AIProvider;
    const credential = this.#getResource(credBinding.resourceId) as Credential;

    // Build redactor: replaces all occurrences of the credential value with ***
    const redact = (s: string): string =>
      credential.value ? s.split(credential.value).join("***") : s;

    // 3. Session factory — errors here mean task fails, no workspace prepared
    let session: ProviderSession;
    try {
      session = await this.#sessions.for(aiProvider, credential);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return { outcome: "failed", reason: redact(`${e.name}: ${e.message}`) };
    }

    // 4. Workspace source resolution
    const repoBindings = context.filter((b) => b.type === "repository");
    const fsBindings = context.filter((b) => b.type === "filesystem");

    if (repoBindings.length > 0 && fsBindings.length > 0) {
      return {
        outcome: "failed",
        reason:
          "InvalidContextError: task has both repository and filesystem bindings",
      };
    }
    if (repoBindings.length === 0 && fsBindings.length === 0) {
      return {
        outcome: "failed",
        reason:
          "WorkspaceUnresolvableError: task has no repository or filesystem binding",
      };
    }

    const repoBinding = repoBindings[0];
    const fsBinding = fsBindings[0];
    const workspaceSource: Repository | Filesystem = repoBinding
      ? (this.#getResource(repoBinding.resourceId) as Repository)
      : (this.#getResource(fsBinding!.resourceId) as Filesystem);

    // 5–12. Workspace prep, instruction loading, agent run, evidence, finalize
    try {
      // 5. Workspace preparation
      const workspace: Workspace = await this.#workspaces.prepare(
        task.id,
        workspaceSource,
      );

      // Emit agent.started after workspace is ready
      this.#emit(task.id, "agent.started", { workspace: workspace.dir });

      // 6. Instruction loading
      const instructions: Instruction[] = this.#newInstructionLoader(
        workspace.dir,
      ).load();

      // 7. Agent setup
      let escalationReason: string | undefined;

      const escalateTool: AgentTool<typeof ESCALATE_PARAMS> = {
        name: "escalate",
        label: "Escalate to human",
        description:
          "Park this task pending human confirmation. Call when you need a human to review or approve your changes before proceeding.",
        parameters: ESCALATE_PARAMS,
        execute: async (_toolCallId, params) => {
          escalationReason = params.reason;
          return {
            content: [{ type: "text" as const, text: "Escalation recorded." }],
            details: { reason: params.reason },
            terminate: true,
          };
        },
      };

      const tools = [...profile.createTools({ workspace }), escalateTool];
      const systemPrompt = profile.systemPrompt({
        task,
        workspace,
        instructions,
      });

      // Build user prompt with optional prior-rejection feedback block
      let userPrompt = renderTaskPrompt(task);
      const rejection = this.#getPriorRejection(task.id);
      if (rejection) {
        userPrompt += `\n\n## Prior Rejection\n${rejection.reason}`;
        if (rejection.summary) {
          userPrompt += `\n${rejection.summary}`;
        }
      }

      const agent = new Agent({
        streamFn: session.streamFn,
        getApiKey: () => session.getApiKey(),
      });
      agent.state.systemPrompt = systemPrompt;
      agent.state.model = session.model;
      agent.state.tools = tools;

      // Subscribe for throttled progress events on tool execution starts
      let lastProgressAt: number | undefined;
      agent.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          const now = this.#clock();
          if (lastProgressAt === undefined || now - lastProgressAt >= 5000) {
            lastProgressAt = now;
            const summary = buildSummary(
              event.toolName,
              event.args as Record<string, unknown>,
              200,
              redact,
            );
            this.#emit(task.id, "agent.progress", {
              tool: event.toolName,
              summary,
            });
          }
        }
      });

      // Subscribe for turn budget enforcement
      let turnCount = 0;
      let budgetExceeded = false;
      const maxTurns = this.#maxTurns;
      agent.subscribe((event) => {
        if (event.type === "turn_end") {
          turnCount += 1;
          if (turnCount >= maxTurns) {
            budgetExceeded = true;
            agent.abort();
          }
        }
      });

      await agent.prompt(userPrompt);
      await agent.waitForIdle();

      // Check budget exceeded before any other error check
      if (budgetExceeded) {
        return {
          outcome: "failed",
          reason: `BudgetExceededError: exceeded ${maxTurns} turns`,
        };
      }

      // Check for agent-level error before evidence computation
      if (agent.state.errorMessage && escalationReason === undefined) {
        return { outcome: "failed", reason: redact(agent.state.errorMessage) };
      }

      // 8. Compute OutcomeEvidence (git diff + last assistant text)
      let evidence: OutcomeEvidence;
      try {
        evidence = await computeEvidence(
          workspace.dir,
          workspace.baseCommit,
          agent,
        );
      } catch (err) {
        return {
          outcome: "failed",
          reason: `ResultCaptureError: ${extractStderr(err)}`,
        };
      }

      // 9. Escalated path — skip verify, create proposal commit if hasChanges
      if (escalationReason !== undefined) {
        let proposalCommit: string | undefined;
        if (evidence.finalDiff.hasChanges) {
          try {
            proposalCommit = await createProposalCommit(
              workspace.dir,
              workspace.baseCommit,
              task.id,
            );
          } catch (err) {
            return {
              outcome: "failed",
              reason: `ResultCaptureError: ${extractStderr(err)}`,
            };
          }
        }
        return {
          outcome: "escalated",
          reason: escalationReason,
          summary: evidence.finalResponse,
          workspace: workspace.dir,
          branch: workspace.branch,
          baseCommit: workspace.baseCommit,
          proposalCommit,
        };
      }

      // 10. profile.verify — rejected verdict → failed
      const verdict = await profile.verify(evidence);
      if (verdict.verdict === "rejected") {
        return {
          outcome: "failed",
          reason: `${verdict.code}: ${verdict.message}`,
        };
      }

      // 11. D6: execute task.verification commands sequentially
      let verificationEvidence: VerificationEvidence[] | undefined;
      if (task.verification && task.verification.length > 0) {
        verificationEvidence = [];
        for (const cmd of task.verification) {
          const ev = await runVerificationCmd(workspace.dir, cmd);
          verificationEvidence.push(ev);
          if (ev.exitCode !== 0) {
            return {
              outcome: "failed",
              reason: `VerificationFailedError: ${cmd} (exit ${ev.exitCode})`,
            };
          }
        }
      }

      // 12. Finalize: commit-if-dirty, return completed
      let commitSha: string;
      try {
        commitSha = await finalize(workspace.dir, task.title);
      } catch (err) {
        return {
          outcome: "failed",
          reason: `ResultCaptureError: ${extractStderr(err)}`,
        };
      }

      return {
        outcome: "completed",
        summary: evidence.finalResponse,
        workspace: workspace.dir,
        branch: workspace.branch,
        commitSha,
        evidence: verificationEvidence,
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return { outcome: "failed", reason: `${e.name}: ${e.message}` };
    }
  }
}
