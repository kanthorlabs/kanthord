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
  AssignedProviderError,
  AmbiguousFlagsError,
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
    options?: {
      replacement?: string;
      confirmNoDefault?: boolean;
      cascade?: boolean;
    },
  ): void {
    this.#uow.transaction(() => {
      const replacement = options?.replacement;
      const confirmNoDefault = options?.confirmNoDefault;
      const cascade = options?.cascade === true;

      const provider = this.#registry.get(id);
      if (provider === undefined) {
        throw new UnknownReferenceError("ai_provider", id);
      }

      // Both flags together are always rejected, regardless of the target.
      if (replacement !== undefined && confirmNoDefault === true) {
        throw new ConflictingDefaultChoiceError("remove", id);
      }

      // S1: cascade and replacement together are mutually exclusive.
      if (cascade && replacement !== undefined) {
        throw new AmbiguousFlagsError(id, "cascade", "replacement");
      }

      const defaultId = this.#registry.getDefault()?.id;
      const isDefault = id === defaultId;

      // Early validation when replacement is set: reject self-replacement
      // and validate the replacement provider exists.
      if (replacement !== undefined) {
        if (replacement === id) {
          throw new SelfReplacementError("remove", id);
        }
        const replacementProvider = this.#registry.get(replacement);
        if (replacementProvider === undefined) {
          throw new UnknownReferenceError("ai_provider", replacement);
        }
      }

      // ── 008.2 Story E — assignment-aware removal ─────────────────
      const assigningProjects = this.#registry.listProjectsAssigning(id);
      const hasAssignments = assigningProjects.length > 0;

      if (hasAssignments) {
        if (!cascade && replacement === undefined) {
          throw new AssignedProviderError(id, assigningProjects.length);
        }

        if (cascade) {
          if (isDefault) {
            throw new DefaultNeedsReplacementError(id, "remove");
          }
          for (const projectId of assigningProjects) {
            this.#registry.unassign(projectId, id);
            this.#registry.compactRanks(projectId);
          }
        } else {
          // replacement is set — rewrite assignments with dedup.
          // Use the removed provider's rank so the replacement occupies
          // the same slot (B2).
          for (const projectId of assigningProjects) {
            const assignment = this.#registry.getAssignment(projectId, id);
            const oldRank = assignment?.rank;
            const assignedProviders = this.#registry.listAssigned(projectId);
            const isReplacementAssigned = assignedProviders.some(
              (p) => p.id === replacement,
            );

            this.#registry.unassign(projectId, id);
            if (!isReplacementAssigned && oldRank !== undefined) {
              this.#registry.assign(projectId, replacement!, oldRank);
            }
            this.#registry.compactRanks(projectId);
          }
        }
      }

      if (!isDefault) {
        if (replacement !== undefined && !hasAssignments) {
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
            // Replacement provider existence and self-rejection already validated
            // above. Check logged_out here.
            const replacementProvider = this.#registry.get(replacement);
            if (replacementProvider!.state !== "active") {
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
