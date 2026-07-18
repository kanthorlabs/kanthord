/**
 * Story 05 T1 (k) — RepoInstructionLoader
 *
 * Synchronously reads workspace-root instruction files (AGENTS.md, CLAUDE.md)
 * in INSTRUCTION_CANDIDATES order. No ancestor/descendant walk — checks
 * only the top-level directory. Missing or unreadable files are skipped.
 * No pi imports; pure Node.js fs.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Instruction, InstructionLoader } from "./port.ts";
import { INSTRUCTION_CANDIDATES } from "./port.ts";

export { INSTRUCTION_CANDIDATES };

export class RepoInstructionLoader implements InstructionLoader {
  readonly #workspaceDir: string;

  constructor(workspaceDir: string) {
    this.#workspaceDir = workspaceDir;
  }

  load(): Instruction[] {
    const results: Instruction[] = [];
    for (const candidate of INSTRUCTION_CANDIDATES) {
      const filePath = join(this.#workspaceDir, candidate);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          const content = readFileSync(filePath, "utf8");
          results.push({ path: candidate, content });
        }
      } catch {
        // missing or unreadable → skip
      }
    }
    return results;
  }
}
