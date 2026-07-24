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
  /**
   * Provisions `refs/heads/kanthord/init/<initId>` in the bare home at the
   * integration tip of `source.branch` (idempotent — reused, not moved, on
   * re-provision), then produces an isolated clone (`--no-hardlinks
   * --single-branch`, `origin` removed) checked out on that branch. Only the
   * daemon calls this — agents never write the home. Optional so existing
   * fakes need not implement it.
   */
  prepareInitiative?(initId: string, source: Repository): Promise<Workspace>;
  /**
   * Collapses every commit in the isolated clone at `dir` since `parentOid`
   * into exactly one commit on top of `parentOid`, preserving the working
   * tree, and returns the new commit's sha. No home write. Optional so
   * existing fakes need not implement it.
   */
  squashObjective?(
    dir: string,
    parentOid: string,
    message: string,
  ): Promise<{ oid: string }>;
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
