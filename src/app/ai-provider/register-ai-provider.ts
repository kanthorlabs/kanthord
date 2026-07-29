// src/app/ai-provider/register-ai-provider.ts — RegisterAiProvider use case
// (008.1 Story B: register use case + transactional first-wins default).

import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError } from "../errors.ts";
import {
  UnknownProviderError,
  InvalidEffortError,
  EmptyValueError,
} from "./errors.ts";
import {
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
  CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS,
} from "../../domain/resource.ts";
import {
  validateCustomProviderConfig,
  validateBuiltinBaseUrl,
} from "./config-validation.ts";

/**
 * Register provider callback (BLOCKER 9): routes through registerGlobalProvider
 * instead of inline registry.register + setDefault.
 */
export type RegisterProvider = (
  registry: AiProviderRegistry,
  params: {
    name: string;
    provider: string;
    model: string;
    value: string;
    baseUrl?: string;
    effort?: string;
  },
) => string;

export interface RegisterAiProviderInput {
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  effort?: string;
  value: string;
  /** API flavor for custom OpenAI-compatible providers; when set the custom path is taken. */
  api?: "openai-completions" | "openai-responses";
  /** Overrides `provider` for custom providers — effective provider id in the registry. */
  customProviderId?: string;
  /** Context window token count for custom providers (default 32768). */
  contextWindow?: number;
  /** Max output tokens for custom providers (default 4096). */
  maxTokens?: number;
  /** Opt-in to plain-http or private-network base URLs. */
  allowInsecure?: boolean;
}

export class RegisterAiProvider {
  readonly #registry: AiProviderRegistry;
  readonly #uow: UnitOfWork;
  readonly #catalog: ModelCatalog | undefined;
  readonly #warn: ((msg: string) => void) | undefined;
  readonly #registerProvider: RegisterProvider | undefined;

  constructor(
    registry: AiProviderRegistry,
    uow: UnitOfWork,
    catalog?: ModelCatalog,
    warn?: (msg: string) => void,
    registerProvider?: RegisterProvider,
  ) {
    this.#registry = registry;
    this.#uow = uow;
    this.#catalog = catalog;
    this.#warn = warn;
    this.#registerProvider = registerProvider;
  }

  execute(input: RegisterAiProviderInput): string {
    if (input.value.length === 0) throw new EmptyValueError();
    return this.#uow.transaction(() => {
      // ── Custom OpenAI-compatible provider path ──
      if (input.api !== undefined) {
        validateCustomProviderConfig(
          {
            api: input.api,
            effort: input.effort,
            customProviderId: input.customProviderId,
            baseUrl: input.baseUrl,
            contextWindow: input.contextWindow,
            maxTokens: input.maxTokens,
            allowInsecure: input.allowInsecure,
          },
          { customProviderId: true, baseUrl: true },
        );

        const provider = this.#registry.register({
          name: input.name,
          provider: input.customProviderId!,
          model: input.model,
          baseUrl: input.baseUrl,
          effort: input.effort,
          value: input.value,
          api: input.api,
          contextWindow:
            input.contextWindow ?? CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
          maxTokens: input.maxTokens ?? CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS,
        });

        // S3: set the default pointer when it's empty (first-wins convention).
        if (this.#registry.getDefault() === undefined) {
          this.#registry.setDefault(provider.id);
        }

        return provider.id;
      }

      // ── Builtin (pinned catalog) path ──
      // B4: validate provider/model against the pinned catalog when available.
      if (this.#catalog !== undefined) {
        if (!this.#catalog.isValid(input.provider, input.model)) {
          if (!this.#catalog.hasProvider(input.provider)) {
            throw new UnknownProviderError(input.provider);
          }
          throw new UnknownModelError(input.provider, input.model);
        }

        // S9: validate effort against catalog's known effort values.
        if (input.effort !== undefined) {
          const efforts = this.#catalog.getEfforts(input.provider, input.model);
          if (!efforts.includes(input.effort)) {
            throw new InvalidEffortError(input.effort);
          }
        }
      }

      // S9: validate baseUrl — must be an absolute http(s) URL.
      if (input.baseUrl !== undefined) validateBuiltinBaseUrl(input.baseUrl);

      // BLOCKER 9: when a registerProvider helper is wired, route the builtin
      // path through it (e.g. registerGlobalProvider) instead of inline register.
      if (this.#registerProvider !== undefined) {
        return this.#registerProvider(this.#registry, {
          name: input.name,
          provider: input.provider,
          model: input.model,
          value: input.value,
          baseUrl: input.baseUrl,
          effort: input.effort,
        });
      }

      const provider = this.#registry.register({
        name: input.name,
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        effort: input.effort,
        value: input.value,
      });

      // S2: warn when --provider/--model differ from stored config
      // (adapter keeps the old config on reactivation).
      if (
        provider.provider !== input.provider ||
        provider.model !== input.model
      ) {
        this.#warn?.(
          `config retained (${provider.provider}/${provider.model}), flags ignored`,
        );
      }

      // S3: set the default pointer when it's empty (first-wins convention).
      if (this.#registry.getDefault() === undefined) {
        this.#registry.setDefault(provider.id);
      }

      return provider.id;
    });
  }
}
