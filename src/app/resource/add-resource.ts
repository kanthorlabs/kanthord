import { homedir } from "node:os";
import { resolve, join, isAbsolute } from "node:path";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import {
  EmbeddedCredentialError,
  hasEmbeddedUserinfo,
} from "../../domain/resource.ts";
import type {
  Resource,
  ReasoningEffort,
  RepositoryAuth,
} from "../../domain/resource.ts";
import { newId } from "../../domain/entity.ts";
import {
  DuplicateNameError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError } from "../../model-catalog/port.ts";

export type AddResourceInput =
  | {
      type: "repository";
      projectId: string;
      name: string;
      remoteUrl: string;
      branch: string;
      path: string;
      auth: RepositoryAuth;
    }
  | {
      type: "credential";
      projectId: string;
      name: string;
      provider: string;
      value: string;
    }
  | {
      type: "notification";
      projectId: string;
      name: string;
      provider: "slack" | "telegram";
      destination: string;
    }
  | {
      type: "ai_provider";
      projectId: string;
      name: string;
      provider: string;
      model: string;
      baseUrl?: string;
      effort?: ReasoningEffort;
    }
  | {
      type: "filesystem";
      projectId: string;
      name: string;
      path: string;
    };

/** Derive a stable local path from a remoteUrl when the caller passes `path: ""`. */
function deriveDefaultRepoPath(remoteUrl: string): string {
  try {
    const u = new URL(remoteUrl);
    const pathPart = u.pathname.replace(/\.git$/, "").replace(/^\//, "");
    const segments = pathPart.split("/").filter((s) => s.length > 0);
    return join(homedir(), ".kanthord", "repos", u.hostname, ...segments);
  } catch {
    // Non-parseable URL (e.g. ssh git@host:path) — sanitize into a flat name.
    const slug = remoteUrl.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(homedir(), ".kanthord", "repos", slug);
  }
}

export class AddResource {
  readonly #projectRepository: ProjectRepository;
  readonly #referenceResolver: ReferenceResolver;
  readonly #modelCatalog: ModelCatalog;

  constructor(
    projectRepository: ProjectRepository,
    referenceResolver: ReferenceResolver,
    modelCatalog: ModelCatalog,
  ) {
    this.#projectRepository = projectRepository;
    this.#referenceResolver = referenceResolver;
    this.#modelCatalog = modelCatalog;
  }

  async execute(input: AddResourceInput): Promise<string> {
    const { projectId, name } = input;

    const kind = this.#referenceResolver.resolveKind(projectId);
    if (kind === undefined) {
      throw new UnknownReferenceError("project", projectId);
    }
    if (kind !== "project") {
      throw new WrongTypeReferenceError("project", kind, projectId);
    }

    const existing = this.#projectRepository.resolveResourceByName(
      projectId,
      name,
    );
    if (existing.length > 0) {
      throw new DuplicateNameError("resource", projectId, name);
    }

    const id = newId();
    let resource: Resource;

    if (input.type === "repository") {
      if (hasEmbeddedUserinfo(input.remoteUrl)) {
        throw new EmbeddedCredentialError(input.remoteUrl);
      }
      let repoPath: string;
      if (input.path === "") {
        repoPath = deriveDefaultRepoPath(input.remoteUrl);
      } else if (!isAbsolute(input.path)) {
        repoPath = resolve(input.path);
      } else {
        repoPath = input.path;
      }
      resource = {
        id,
        type: "repository",
        name: input.name,
        remoteUrl: input.remoteUrl,
        branch: input.branch,
        path: repoPath,
        auth: input.auth,
      };
    } else if (input.type === "credential") {
      resource = {
        id,
        type: "credential",
        name: input.name,
        provider: input.provider,
        value: input.value,
      };
    } else if (input.type === "notification") {
      resource = {
        id,
        type: "notification",
        name: input.name,
        provider: input.provider,
        destination: input.destination,
      };
    } else if (input.type === "ai_provider") {
      if (!this.#modelCatalog.isValid(input.provider, input.model)) {
        throw new UnknownModelError(input.provider, input.model);
      }
      resource = {
        id,
        type: "ai_provider",
        name: input.name,
        provider: input.provider,
        model: input.model,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
      };
    } else {
      resource = {
        id,
        type: "filesystem",
        name: input.name,
        path: input.path,
      };
    }

    this.#projectRepository.addResource(projectId, resource);
    return id;
  }
}
