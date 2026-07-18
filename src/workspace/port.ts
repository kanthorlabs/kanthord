import type { Repository, Filesystem } from "../domain/resource.ts";

export interface Workspace {
  dir: string;
  branch: string;
  baseCommit: string;
}

export interface WorkspaceManager {
  prepare(taskId: string, source: Repository | Filesystem): Promise<Workspace>;
}

export class WorkspacePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePreparationError";
  }
}
