/**
 * LoginProvider use case — authenticate an AI provider via OAuth and persist
 * the result as a global ai-provider. Transport-agnostic: the interactive
 * presentation arrives as an OAuthLoginPresenter, so the CLI and any future
 * transport share this orchestration.
 *
 * 008.3 Story E: cut over to use the global registry (AiProviderRegistry)
 * instead of a project-scoped credential. The provider is inserted via
 * `registerGlobalProvider` (the shared helper also used by RegisterAiProvider).
 * OAuth-only guard: non-OAuth providers are rejected with NonOAuthProviderError
 * pointing at `register ai-provider --value-file`.
 */
import type {
  OAuthLoginProvider,
  OAuthLoginPresenter,
} from "../../oauth/port.ts";
import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError } from "../errors.ts";
import { NonOAuthProviderError } from "../ai-provider/errors.ts";
import { registerGlobalProvider } from "../ai-provider/register-global-provider.ts";

// Re-exported so driving adapters (apps/*) depend on the app layer, not the
// oauth port directly (keeps the apps→app import boundary intact).
export type { OAuthLoginPresenter };

export interface LoginProviderInput {
  providerId: string;
  name: string;
  method: string;
  presenter: OAuthLoginPresenter;
  model?: string;
  baseUrl?: string;
  effort?: string;
  selectModel?: (models: string[]) => Promise<string>;
}

export class LoginProvider {
  readonly #oauth: OAuthLoginProvider;
  readonly #registry: AiProviderRegistry;
  readonly #unitOfWork: UnitOfWork;
  readonly #modelCatalog: ModelCatalog;
  readonly #listModels: (provider: string) => string[];

  constructor(deps: {
    oauth: OAuthLoginProvider;
    registry: AiProviderRegistry;
    unitOfWork: UnitOfWork;
    modelCatalog: ModelCatalog;
    listModels: (provider: string) => string[];
  }) {
    this.#oauth = deps.oauth;
    this.#registry = deps.registry;
    this.#unitOfWork = deps.unitOfWork;
    this.#modelCatalog = deps.modelCatalog;
    this.#listModels = deps.listModels;
  }

  async execute(input: LoginProviderInput): Promise<string> {
    // 0. Guard: when no model and no selectModel, reject before OAuth.
    if (input.model === undefined && input.selectModel === undefined) {
      throw new Error(
        "Login requires a model selection: pass --model or provide selectModel callback",
      );
    }

    // 0b. OAuth-only guard — reject non-OAuth providers with a clear message
    // pointing at `register ai-provider --value-file`.
    if (!this.#oauth.has(input.providerId)) {
      throw new NonOAuthProviderError(input.providerId);
    }

    // 1. OAuth login first — success gates the rest (no project validation
    // needed since we're creating a global provider, not a project resource).
    const value = await this.#oauth.login({
      providerId: input.providerId,
      method: input.method,
      presenter: input.presenter,
    });

    // 2. Model selection: explicit --model takes precedence; otherwise invoke
    // selectModel with the provider's pinned-catalog model list.
    let model = input.model;
    if (model === undefined) {
      const choices = this.#listModels(input.providerId);
      model = await input.selectModel!(choices);
    }

    // 3. Validate model against the pinned catalog.
    if (!this.#modelCatalog.isValid(input.providerId, model)) {
      throw new UnknownModelError(input.providerId, model);
    }

    // 4. Register as a global provider via the shared helper (same semantics
    // as RegisterAiProvider: insert + first-wins default).
    // Wrapped in a transaction because registerGlobalProvider is NOT
    // transactional itself (RegisterAiProvider.execute() provides its own
    // outer transaction; LoginProvider is async-OAuth so we wrap here).
    return this.#unitOfWork.transaction(() =>
      registerGlobalProvider(this.#registry, {
        name: input.name,
        provider: input.providerId,
        model,
        baseUrl: input.baseUrl,
        effort: input.effort,
        value,
      }),
    );
  }
}
