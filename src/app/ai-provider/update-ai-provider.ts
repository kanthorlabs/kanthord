// src/app/ai-provider/update-ai-provider.ts — UpdateAiProvider use case
// (018 S3: edit a registered provider's config + optional secret rotation).

import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownReferenceError, UnknownModelError } from "../errors.ts";
import {
  LoggedOutProviderError,
  UnknownProviderError,
  InvalidEffortError,
  EmptyValueError,
  NoUpdateFieldsError,
  BuiltinProviderFieldError,
  StaleCredentialError,
} from "./errors.ts";
import { validateCustomProviderConfig } from "./config-validation.ts";

export interface UpdateAiProviderInput {
  id: string;
  model?: string;
  baseUrl?: string;
  effort?: string;
  api?: "openai-completions" | "openai-responses";
  contextWindow?: number;
  maxTokens?: number;
  /** New secret; when present the credential is rotated through the CAS. */
  value?: string;
  allowInsecure?: boolean;
}

/** The field names that changed, in the fixed order listed in `execute`. */
export type UpdateAiProviderOutput = { id: string; changed: string[] };

/** Fixed order for collecting present config keys (step 1 of `execute`). */
const CONFIG_FIELD_ORDER = [
  "model",
  "baseUrl",
  "effort",
  "api",
  "contextWindow",
  "maxTokens",
] as const;

/** Fixed order for refusing custom-only fields on a builtin row. */
const BUILTIN_FORBIDDEN_ORDER = [
  "api",
  "baseUrl",
  "contextWindow",
  "maxTokens",
] as const;

export class UpdateAiProvider {
  readonly #registry: AiProviderRegistry;
  readonly #uow: UnitOfWork;
  readonly #catalog: ModelCatalog | undefined;

  constructor(
    registry: AiProviderRegistry,
    uow: UnitOfWork,
    catalog?: ModelCatalog,
  ) {
    this.#registry = registry;
    this.#uow = uow;
    this.#catalog = catalog;
  }

  execute(input: UpdateAiProviderInput): UpdateAiProviderOutput {
    // 1. Collect the present config keys, before any read/transaction.
    const configKeys = CONFIG_FIELD_ORDER.filter((k) => input[k] !== undefined);
    const changed: string[] = [...configKeys];
    if (input.value !== undefined) changed.push("value");
    if (changed.length === 0) throw new NoUpdateFieldsError();

    return this.#uow.transaction(() => {
      // 3. Resolve the row.
      const current = this.#registry.get(input.id);
      if (current === undefined) {
        throw new UnknownReferenceError("ai_provider", input.id);
      }

      // 4. Refuse a logged_out row.
      if (current.state === "logged_out") {
        throw new LoggedOutProviderError(input.id, "update");
      }

      // 5. Branch on the row's shape.
      if (current.api !== null) {
        // Custom: shared rule set from Story S1; never consult the catalog.
        validateCustomProviderConfig(
          {
            api: input.api,
            effort: input.effort,
            baseUrl: input.baseUrl,
            contextWindow: input.contextWindow,
            maxTokens: input.maxTokens,
            allowInsecure: input.allowInsecure,
          },
          { customProviderId: false, baseUrl: false },
        );
      } else {
        // Builtin: custom-only fields are refused, model/effort are revalidated.
        for (const field of BUILTIN_FORBIDDEN_ORDER) {
          if (input[field] !== undefined) {
            throw new BuiltinProviderFieldError(field);
          }
        }

        if (this.#catalog !== undefined) {
          if (input.model !== undefined) {
            if (!this.#catalog.isValid(current.provider, input.model)) {
              if (!this.#catalog.hasProvider(current.provider)) {
                throw new UnknownProviderError(current.provider);
              }
              throw new UnknownModelError(current.provider, input.model);
            }
          }
          if (input.effort !== undefined) {
            const modelToCheck = input.model ?? current.model;
            if (
              !this.#catalog
                .getEfforts(current.provider, modelToCheck)
                .includes(input.effort)
            ) {
              throw new InvalidEffortError(input.effort);
            }
          }
        }
      }

      // 6. Write the config patch (only the present config keys).
      if (configKeys.length > 0) {
        const patch: {
          model?: string;
          baseUrl?: string;
          effort?: string;
          api?: "openai-completions" | "openai-responses";
          contextWindow?: number;
          maxTokens?: number;
        } = {};
        if (input.model !== undefined) patch.model = input.model;
        if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
        if (input.effort !== undefined) patch.effort = input.effort;
        if (input.api !== undefined) patch.api = input.api;
        if (input.contextWindow !== undefined)
          patch.contextWindow = input.contextWindow;
        if (input.maxTokens !== undefined) patch.maxTokens = input.maxTokens;
        this.#registry.update(input.id, patch);
      }

      // 7. Rotate the secret through the CAS, after the config write.
      if (input.value !== undefined) {
        if (input.value.length === 0) throw new EmptyValueError();
        const result = this.#registry.updateCredentialCAS(
          input.id,
          input.value,
          current.credentialVersion,
        );
        if (!result.applied) throw new StaleCredentialError(input.id);
      }

      // 8. Return the changed field names, in step-1 order.
      return { id: input.id, changed };
    });
  }
}
