// src/app/repository/publish-repository.ts — use case: publish a landed
// repository target's branch to its configured remote.
//
// Resolves the repository resource, reads the landed local head + the
// last-known remote OID (publication state), calls the RepositoryPublisher
// port, and persists the resulting publication state. Never calls git
// directly — that lives behind the port (Story A) — and never retries with
// force on divergence.

import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";
import { isRepository } from "../../domain/resource.ts";
import type { Resource } from "../../domain/resource.ts";
import { PublishDivergedError } from "../../publication/port.ts";
import type { RepositoryPublisher } from "../../publication/port.ts";
import type { PublicationRepository } from "../../storage/port.ts";

interface ResourceStore {
  getResource(id: string): Resource | undefined;
}

export interface PublishRepositoryInput {
  repositoryId: string;
  branch: string;
}

export type PublishOutcome =
  | { kind: "published"; repositoryId: string; remoteOID: string }
  | { kind: "diverged"; repositoryId: string; remoteOID: string }
  | { kind: "failed"; repositoryId: string; message: string; cause: unknown };

export class PublishRepository {
  readonly #store: ResourceStore;
  readonly #publisher: RepositoryPublisher;
  readonly #publicationRepository: PublicationRepository;
  readonly #resolveHomeDir: (repoId: string) => string;
  readonly #resolveTargetOID: (
    homeDir: string,
    branch: string,
  ) => string | Promise<string>;

  constructor(
    store: ResourceStore,
    publisher: RepositoryPublisher,
    publicationRepository: PublicationRepository,
    resolveHomeDir: (repoId: string) => string,
    resolveTargetOID: (
      homeDir: string,
      branch: string,
    ) => string | Promise<string>,
  ) {
    this.#store = store;
    this.#publisher = publisher;
    this.#publicationRepository = publicationRepository;
    this.#resolveHomeDir = resolveHomeDir;
    this.#resolveTargetOID = resolveTargetOID;
  }

  async execute(input: PublishRepositoryInput): Promise<PublishOutcome> {
    const { repositoryId, branch } = input;
    const resource = this.#store.getResource(repositoryId);
    if (!resource) throw new UnknownReferenceError("resource", repositoryId);
    if (!isRepository(resource)) {
      throw new WrongTypeReferenceError(
        "repository",
        resource.type,
        repositoryId,
      );
    }

    const homeDir = this.#resolveHomeDir(repositoryId);
    // Confirms the branch is landed locally before publishing; the port
    // itself re-reads the local tip when building the push (Story A).
    await this.#resolveTargetOID(homeDir, branch);
    const expectedRemoteOID =
      this.#publicationRepository.getPublication(repositoryId, branch)
        ?.remoteOID ?? null;

    try {
      const result = await this.#publisher.publish({
        homeDir,
        branch,
        remoteUrl: resource.remoteUrl,
        auth: resource.auth,
        expectedRemoteOID,
      });
      this.#publicationRepository.setPublication(repositoryId, branch, {
        state: "published",
        remoteOID: result.remoteOID,
      });
      return { kind: "published", repositoryId, remoteOID: result.remoteOID };
    } catch (err) {
      if (err instanceof PublishDivergedError) {
        this.#publicationRepository.setPublication(repositoryId, branch, {
          state: "diverged",
          remoteOID: err.remoteOID,
        });
        return { kind: "diverged", repositoryId, remoteOID: err.remoteOID };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "failed", repositoryId, message, cause: err };
    }
  }
}
