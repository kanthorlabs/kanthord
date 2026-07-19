import { homedir } from "node:os";
import { resolve, join, isAbsolute } from "node:path";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Resource, ReasoningEffort } from "../../domain/resource.ts";
import { newId } from "../../domain/entity.ts";
import {
  DuplicateNameError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";

export type AddResourceInput =
  | {
      type: "repository";
      projectId: string;
      name: string;
      organization: string;
      branch: string;
      path: string;
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

export class AddResource {
  readonly #projectRepository: ProjectRepository;
  readonly #referenceResolver: ReferenceResolver;

  constructor(
    projectRepository: ProjectRepository,
    referenceResolver: ReferenceResolver,
  ) {
    this.#projectRepository = projectRepository;
    this.#referenceResolver = referenceResolver;
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
      let repoPath: string;
      if (input.path === "") {
        repoPath = join(
          homedir(),
          ".kanthord",
          "repos",
          input.organization,
          input.name,
        );
      } else if (!isAbsolute(input.path)) {
        repoPath = resolve(input.path);
      } else {
        repoPath = input.path;
      }
      resource = {
        id,
        type: "repository",
        name: input.name,
        organization: input.organization,
        branch: input.branch,
        path: repoPath,
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
