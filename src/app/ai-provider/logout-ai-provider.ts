// src/app/ai-provider/logout-ai-provider.ts — LogoutAiProvider use case
// (008.1 Story D: credential lifecycle — logout flips state to logged_out).
// S10: allow "no default" via a second confirmation (--confirm-no-default).

import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import {
  LoggedOutProviderError,
  DefaultNeedsReplacementError,
  SelfReplacementError,
  CorruptDefaultPointerError,
  UnnecessaryReplacementError,
  ConflictingDefaultChoiceError,
} from "./errors.ts";

export class LogoutAiProvider {
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

      // Both flags together are always rejected, regardless of the target
      // or its state — checked immediately after the unknown-id guard so it
      // can never be bypassed by an idempotent early return (mirrors remove).
      if (replacement !== undefined && confirmNoDefault === true) {
        throw new ConflictingDefaultChoiceError("logout", id);
      }

      const defaultId = this.#registry.getDefault()?.id;
      const isDefault = id === defaultId;

      // Flag-cannot-apply is validated BEFORE idempotency (Story D: "Flag
      // validation precedes idempotency"): a flag that cannot take effect is
      // an operator mistake and must be rejected, never silently swallowed by
      // the already-logged_out no-op below — an audit line must never claim
      // a write that did not happen. Consequence: logout is idempotent only
      // when called with no flags.
      if (!isDefault) {
        if (replacement !== undefined) {
          throw new UnnecessaryReplacementError(id, "logout", "--replacement");
        }
        if (confirmNoDefault === true) {
          throw new UnnecessaryReplacementError(
            id,
            "logout",
            "--confirm-no-default",
          );
        }
      }

      // Corrupt state: the default pointer references a logged_out provider.
      // Check this BEFORE the idempotent early return so the invariant
      // violation is always surfaced.
      if (isDefault && provider.state === "logged_out") {
        throw new CorruptDefaultPointerError(id);
      }

      // Idempotent: already logged_out (non-default, no flags) is a no-op.
      if (provider.state === "logged_out") {
        return;
      }

      if (isDefault) {
        if (replacement !== undefined) {
          if (replacement === id) {
            throw new SelfReplacementError("logout", id);
          }
          // Verify replacement exists and is active.
          const replacementProvider = this.#registry.get(replacement);
          if (replacementProvider === undefined) {
            throw new UnknownReferenceError("ai_provider", replacement);
          }
          if (replacementProvider.state !== "active") {
            throw new LoggedOutProviderError(replacement, "logout");
          }
          this.#registry.setDefault(replacement);
        } else if (confirmNoDefault === true) {
          this.#registry.clearDefault();
        } else {
          throw new DefaultNeedsReplacementError(id, "logout");
        }
      }

      this.#registry.logout(id);
    });
  }
}
