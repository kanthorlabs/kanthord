import type { Repository, Filesystem } from "../domain/resource.ts";

export interface Workspace {
  dir: string;
  branch: string;
  baseCommit: string;
}

export interface WorkspaceManager {
  prepare(taskId: string, source: Repository | Filesystem): Promise<Workspace>;
  /**
   * Returns the canonical local mirror path for a repository (the path the
   * manager clones the repository's `remoteUrl` into), stable for a given
   * `repoId` and distinct from any per-task workspace dir it builds as
   * `join(root, <taskId>)`. Optional so existing fakes need not implement it.
   */
  homeDir?(repoId: string): string;
}

export class WorkspacePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePreparationError";
  }
}

export class FetchError extends Error {
  readonly repoId: string;
  readonly cause: unknown;
  constructor(repoId: string, cause: unknown) {
    super(`Fetch failed for repository: ${repoId}`);
    this.name = "FetchError";
    this.repoId = repoId;
    this.cause = cause;
  }
}

export class DivergenceError extends Error {
  readonly repoId: string;
  readonly localSHA: string;
  readonly originSHA: string;
  constructor(repoId: string, localSHA: string, originSHA: string) {
    super(
      `Divergence in repository ${repoId}: local=${localSHA}, origin=${originSHA}`,
    );
    this.name = "DivergenceError";
    this.repoId = repoId;
    this.localSHA = localSHA;
    this.originSHA = originSHA;
  }
}

export interface CachedModePolicy {
  repoId: string;
  lastFetchedOriginSHA: string;
  fetchTime: string;
  baseSHA: string;
}
