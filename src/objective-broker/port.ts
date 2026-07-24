// src/objective-broker/port.ts — narrow local port for the ObjectiveBroker
// capability (EPIC 007.12 Story C: daemon-only home integration). Only this
// file defines the seam; adapters (e.g. GitObjectiveBroker) import it, and
// use cases (ApproveObjective) depend on this type, never the adapter.

export interface ObjectiveBroker {
  /**
   * Fetches the objective commit's objects from the isolated clone into the
   * bare home repo. Must not move any ref in home.
   */
  fetch(homeDir: string, clonePath: string, oid: string): Promise<void>;

  /**
   * Returns the number of commits between `parentOid` (exclusive) and `oid`
   * (inclusive) in the repo at `homeDir`. Used to validate the objective
   * fetched exactly one commit ahead of its recorded parent.
   */
  countCommitsSince(
    homeDir: string,
    parentOid: string,
    oid: string,
  ): Promise<number>;

  /**
   * Atomically advances `ref` to `oid`, but only if it currently points at
   * `expectedOld` (CAS). Throws `LandingCASMismatchError` (from
   * `../landing/port.ts`) carrying the ref's actual current OID when the
   * ref has moved since `expectedOld` was recorded.
   */
  casUpdateRef(
    homeDir: string,
    ref: string,
    oid: string,
    expectedOld: string,
  ): Promise<void>;

  /**
   * Returns the current OID `ref` points at in the repo at `homeDir` (e.g.
   * the initiative branch's live tip, used by Story E conflict resolution
   * to re-squash onto the current base). Optional so pre-existing fakes
   * satisfying only the Story C surface still structurally conform.
   */
  currentTip?(homeDir: string, ref: string): Promise<string>;
}
