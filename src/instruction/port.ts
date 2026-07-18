/**
 * Story 05 T1 — InstructionLoader port
 *
 * Pure types and the candidate list; no I/O. Adapters (e.g. RepoInstructionLoader)
 * implement InstructionLoader and are injected into the runner via newInstructionLoader.
 */

export type Instruction = { path: string; content: string };

export interface InstructionLoader {
  load(): Instruction[];
}

/** Workspace-root candidate files, in discovery order. */
export const INSTRUCTION_CANDIDATES = ["AGENTS.md", "CLAUDE.md"] as const;
