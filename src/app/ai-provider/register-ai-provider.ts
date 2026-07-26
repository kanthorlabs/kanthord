// src/app/ai-provider/register-ai-provider.ts — RegisterAiProvider use case
// (008.1 Story B: register use case + transactional first-wins default).

import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError, EmbeddedCredentialError } from "../errors.ts";
import {
  UnknownProviderError,
  InvalidEffortError,
  InvalidBaseUrlError,
  EmptyValueError,
  InvalidApiFlavorError,
  InsecureEndpointError,
  MissingCustomProviderIdError,
  MissingBaseUrlError,
  InvalidNumericFlagError,
} from "./errors.ts";
import {
  hasEmbeddedUserinfo,
  isInsecureEndpoint,
  REASONING_EFFORTS,
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
  CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS,
} from "../../domain/resource.ts";

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
        // 1. Validate api flavor before anything else
        if (
          input.api !== "openai-completions" &&
          input.api !== "openai-responses"
        ) {
          throw new InvalidApiFlavorError(input.api);
        }

        // S1: Validate effort against known reasoning efforts
        if (
          input.effort !== undefined &&
          !(REASONING_EFFORTS as readonly string[]).includes(input.effort)
        ) {
          throw new InvalidEffortError(input.effort);
        }

        // 2. Validate required custom fields
        if (
          input.customProviderId === undefined ||
          input.customProviderId === ""
        ) {
          throw new MissingCustomProviderIdError();
        }
        if (input.baseUrl === undefined || input.baseUrl === "") {
          throw new MissingBaseUrlError();
        }

        // 3. Validate baseUrl shape — must be an absolute http(s) URL
        try {
          const url = new URL(input.baseUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new InvalidBaseUrlError(input.baseUrl);
          }
        } catch {
          throw new InvalidBaseUrlError(input.baseUrl);
        }

        // S2: Validate numeric flags — must be positive integers
        if (
          input.contextWindow !== undefined &&
          (!Number.isInteger(input.contextWindow) || input.contextWindow <= 0)
        ) {
          throw new InvalidNumericFlagError(
            "context-window",
            input.contextWindow,
          );
        }
        if (
          input.maxTokens !== undefined &&
          (!Number.isInteger(input.maxTokens) || input.maxTokens <= 0)
        ) {
          throw new InvalidNumericFlagError("max-tokens", input.maxTokens);
        }

        // 4. Endpoint trust checks
        if (hasEmbeddedUserinfo(input.baseUrl)) {
          throw new EmbeddedCredentialError(input.baseUrl);
        }
        if (!input.allowInsecure && isInsecureEndpoint(input.baseUrl)) {
          throw new InsecureEndpointError(input.baseUrl);
        }

        const provider = this.#registry.register({
          name: input.name,
          provider: input.customProviderId,
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
      if (input.baseUrl !== undefined) {
        try {
          const url = new URL(input.baseUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new InvalidBaseUrlError(input.baseUrl);
          }
        } catch {
          throw new InvalidBaseUrlError(input.baseUrl);
        }
      }

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
