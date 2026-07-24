// src/publication/port.ts — narrow local port for the RepositoryPublisher
// capability. Only this file defines the publication seam; adapters (e.g.
// GitRepositoryPublisher) import it.

import type { RepositoryAuth } from "../domain/resource.ts";

export interface PublishInput {
  homeDir: string;
  branch: string;
  remoteUrl: string;
  auth: RepositoryAuth;
  /** Last-known remote tip; null when publish has never observed the remote. */
  expectedRemoteOID: string | null;
}

export interface PublishResult {
  pushedOID: string;
  remoteOID: string;
}

export interface RepositoryPublisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

/**
 * Thrown when the remote has moved past `expectedRemoteOID` (a non-fast-forward
 * or stale `--force-with-lease` rejection). Carries the remote's current OID so
 * the caller can surface the divergence instead of overwriting remote history.
 */
export class PublishDivergedError extends Error {
  readonly remoteOID: string;

  constructor(remoteOID: string) {
    super(`Publish diverged: remote moved to ${remoteOID}`);
    this.name = "PublishDivergedError";
    this.remoteOID = remoteOID;
  }
}

/** Thrown when the configured auth cannot produce usable git credentials. */
export class PublishAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishAuthError";
  }
}
