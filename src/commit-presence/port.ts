// src/commit-presence/port.ts — narrow capability port for the
// CommitPresence probe (EPIC 017 human-review blocker S3). `inspect` in the
// decision queue / objective-conflict evidence must be `null` not only when
// an OID is missing or malformed, but also when it is well-formed and simply
// absent from the named home — this port is how the use cases ask that
// question without shelling out themselves. Only this file defines the seam;
// adapters (e.g. GitCommitPresence) import it, use cases depend on this type.

export interface CommitPresence {
  /**
   * For each entry in `oids`, whether it names an object that exists in the
   * repo at `homeDir` and peels to a commit — same length, same ORDER as
   * `oids` (positional, never keyed on the request string: a found object
   * can echo back a different, resolved spelling than the input, e.g. an
   * abbreviation resolving to its full OID). This proves the object EXISTS
   * and resolves to a commit; it does NOT prove the commit is reachable
   * from any ref.
   *
   * Absence and failure are DISTINCT, and callers depend on the split: a
   * `false` entry means "this repo does not have that commit", while a
   * REJECTION means an operational fault (the home is not a repository, git
   * is unavailable, the probe timed out). An implementation must never
   * report a fault as absence — that would silently strip `inspect` from
   * every row and read as a clean, empty answer. Callers that want to stay
   * alive through a fault catch the rejection themselves and say so.
   */
  hasCommits(
    homeDir: string,
    oids: readonly string[],
  ): Promise<readonly boolean[]>;
}
