/**
 * LoginProvider use case — authenticate an AI provider via OAuth and persist
 * the result as a credential resource. Transport-agnostic: the interactive
 * presentation arrives as an OAuthLoginPresenter, so the CLI and any future
 * transport share this orchestration.
 */
import type {
  OAuthLoginProvider,
  OAuthLoginPresenter,
} from "../../oauth/port.ts";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { newId } from "../../domain/entity.ts";
import {
  DuplicateNameError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";

// Re-exported so driving adapters (apps/*) depend on the app layer, not the
// oauth port directly (keeps the apps→app import boundary intact).
export type { OAuthLoginPresenter };

export interface LoginProviderInput {
  providerId: string;
  projectId: string;
  name: string;
  method: string;
  presenter: OAuthLoginPresenter;
}

export class LoginProvider {
  readonly #oauth: OAuthLoginProvider;
  readonly #projects: ProjectRepository;
  readonly #resolver: ReferenceResolver;

  constructor(deps: {
    oauth: OAuthLoginProvider;
    projects: ProjectRepository;
    resolver: ReferenceResolver;
  }) {
    this.#oauth = deps.oauth;
    this.#projects = deps.projects;
    this.#resolver = deps.resolver;
  }

  async execute(input: LoginProviderInput): Promise<string> {
    // Validate the project reference and name BEFORE running the OAuth flow so
    // a real browser login cannot complete only to fail on a bad project or a
    // duplicate name.
    const kind = this.#resolver.resolveKind(input.projectId);
    if (kind === undefined) {
      throw new UnknownReferenceError("project", input.projectId);
    }
    if (kind !== "project") {
      throw new WrongTypeReferenceError("project", kind, input.projectId);
    }
    const existing = this.#projects.resolveResourceByName(
      input.projectId,
      input.name,
    );
    if (existing.length > 0) {
      throw new DuplicateNameError("resource", input.projectId, input.name);
    }

    const value = await this.#oauth.login({
      providerId: input.providerId,
      method: input.method,
      presenter: input.presenter,
    });

    const id = newId();
    this.#projects.addResource(input.projectId, {
      id,
      type: "credential",
      name: input.name,
      provider: input.providerId,
      value,
    });
    return id;
  }
}
