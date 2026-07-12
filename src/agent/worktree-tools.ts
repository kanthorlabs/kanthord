/**
 * src/agent/worktree-tools.ts
 *
 * Builds the six real file-operation AgentTools from @earendil-works/pi-coding-agent
 * bound to a given cwd. bash is never constructed (Epic 019.15 constraint).
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";

/**
 * Returns the six real pi-coding-agent file tools (read, write, edit, grep,
 * find, ls) each bound to `cwd`. bash is excluded by construction.
 */
export function buildWorktreeTools(cwd: string): AgentTool[] {
  return [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}
