/**
 * Story 05 T1 (i) / Story 06 T1 — PiAgentProfile + genericProfile
 *
 * PiAgentProfile is the adapter-internal interface that the runner calls to
 * obtain a system prompt, the set of tools, and a post-run verifier for a
 * given agent key.
 *
 * genericProfile (agent key "generic@1") delegates createTools entirely to
 * createCodingTools() from @earendil-works/pi-coding-agent — the SDK-goal
 * check in pi-profile.test.ts verifies name equality.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodingTools } from "@earendil-works/pi-coding-agent";
import type { Task } from "../domain/task.ts";
import type { Workspace } from "../workspace/port.ts";
import type { Instruction } from "../instruction/port.ts";
import type { OutcomeEvidence, VerificationResult } from "./verification.ts";

export type { OutcomeEvidence, VerificationResult };

// ---------------------------------------------------------------------------
// PiAgentProfile interface
// ---------------------------------------------------------------------------

export interface PiAgentProfile {
  name: string;
  systemPrompt(input: {
    task: Task;
    workspace: Workspace;
    instructions: Instruction[];
  }): string;
  createTools(input: { workspace: Workspace }): AgentTool[];
  /** Evidence is typed as unknown at the interface level — adapters cast internally. */
  verify(evidence: unknown): Promise<VerificationResult>;
}

// ---------------------------------------------------------------------------
// generic@1 profile
// ---------------------------------------------------------------------------

export const genericProfile: PiAgentProfile = {
  name: "generic@1",

  systemPrompt({ task, workspace, instructions }) {
    const base = [
      `You are a software-engineering agent.`,
      `Workspace directory: ${workspace.dir}`,
      `Branch: ${workspace.branch}`,
      ``,
      `Task: ${task.title}`,
    ].join("\n");

    if (instructions.length === 0) return base;

    const ctx = instructions.map((i) => i.content).join("\n\n");
    return `${base}\n\n<project_context>\n${ctx}\n</project_context>`;
  },

  createTools({ workspace }) {
    return createCodingTools(workspace.dir);
  },

  async verify(evidence) {
    const ev = evidence as OutcomeEvidence;
    if (ev.finalDiff.hasChanges) {
      return { verdict: "accepted" as const, evidence: ev.finalResponse };
    }
    return {
      verdict: "rejected" as const,
      code: "NO_CHANGES" as const,
      message: "Agent made no changes to the workspace",
    };
  },
};
