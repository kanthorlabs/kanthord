// src/app/ai-provider/register-ai-provider.ts — RegisterAiProvider use case
// (008.1 Story B: register use case + transactional first-wins default).

import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError } from "../errors.ts";
import {
  UnknownProviderError,
  InvalidEffortError,
  InvalidBaseUrlError,
  EmptyValueError,
} from "./errors.ts";

export interface RegisterAiProviderInput {
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  effort?: string;
  value: string;
}

export class RegisterAiProvider {
  readonly #registry: AiProviderRegistry;
  readonly #uow: UnitOfWork;
  readonly #catalog: ModelCatalog | undefined;
  readonly #warn: ((msg: string) => void) | undefined;

  constructor(
    registry: AiProviderRegistry,
    uow: UnitOfWork,
    catalog?: ModelCatalog,
    warn?: (msg: string) => void,
  ) {
    this.#registry = registry;
    this.#uow = uow;
    this.#catalog = catalog;
    this.#warn = warn;
  }

  execute(input: RegisterAiProviderInput): string {
    if (input.value.length === 0) throw new EmptyValueError();
    return this.#uow.transaction(() => {
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
