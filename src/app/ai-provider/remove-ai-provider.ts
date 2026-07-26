// src/app/ai-provider/remove-ai-provider.ts — RemoveAiProvider use case
// (008.1 Story D: credential lifecycle — remove deletes the record and repairs
// the default atomically).
// S10: allow "no default" via a second confirmation (--confirm-no-default);
// "remove must act the same" as logout.

import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import {
  LoggedOutProviderError,
  DefaultNeedsReplacementError,
  SelfReplacementError,
  UnnecessaryReplacementError,
  ConflictingDefaultChoiceError,
} from "./errors.ts";

export class RemoveAiProvider {
  readonly #registry: AiProviderRegistry;
  readonly #uow: UnitOfWork;

  constructor(registry: AiProviderRegistry, uow: UnitOfWork) {
    this.#registry = registry;
    this.#uow = uow;
  }

  execute(
    id: string,
    options?: { replacement?: string; confirmNoDefault?: boolean },
  ): void {
    this.#uow.transaction(() => {
      const replacement = options?.replacement;
      const confirmNoDefault = options?.confirmNoDefault;

      const provider = this.#registry.get(id);
      if (provider === undefined) {
        throw new UnknownReferenceError("ai_provider", id);
      }

      // Both flags together are always rejected, regardless of the target.
      if (replacement !== undefined && confirmNoDefault === true) {
        throw new ConflictingDefaultChoiceError("remove", id);
      }

      const defaultId = this.#registry.getDefault()?.id;
      const isDefault = id === defaultId;

      if (!isDefault) {
        if (replacement !== undefined) {
          throw new UnnecessaryReplacementError(id, "remove", "--replacement");
        }
        if (confirmNoDefault === true) {
          throw new UnnecessaryReplacementError(
            id,
            "remove",
            "--confirm-no-default",
          );
        }
      } else {
        const allProviders = this.#registry.list();

        if (allProviders.length > 1) {
          // Other providers exist — one of replacement/confirmNoDefault is required.
          if (replacement !== undefined) {
            if (replacement === id) {
              throw new SelfReplacementError("remove", id);
            }
            // Verify replacement exists and is active.
            const replacementProvider = this.#registry.get(replacement);
            if (replacementProvider === undefined) {
              throw new UnknownReferenceError("ai_provider", replacement);
            }
            if (replacementProvider.state !== "active") {
              throw new LoggedOutProviderError(replacement, "remove");
            }
            this.#registry.setDefault(replacement);
          } else if (confirmNoDefault === true) {
            this.#registry.clearDefault();
          } else {
            throw new DefaultNeedsReplacementError(id, "remove");
          }
        } else {
          // Last provider — 0 providers left ⇒ no default is unambiguous.
          // Both flags are unnecessary here; reject them (closes the hole
          // where --replacement on the last provider was silently ignored).
          if (replacement !== undefined) {
            throw new UnnecessaryReplacementError(
              id,
              "remove",
              "--replacement",
            );
          }
          if (confirmNoDefault === true) {
            throw new UnnecessaryReplacementError(
              id,
              "remove",
              "--confirm-no-default",
            );
          }
          // adapter's remove() cleans up the default pointer.
        }
      }

      this.#registry.remove(id);
    });
  }
}
