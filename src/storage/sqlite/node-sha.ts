/**
 * Re-exports the canonical sha helpers from the single source of truth in
 * `src/domain/sha.ts`. Kept as a thin re-export so existing adapter imports
 * (`sqlite-task-repository.ts`, `sqlite-initiative-repository.ts`) continue to
 * resolve without path changes.
 */
export {
  sha256Hex,
  canonicalTask,
  canonicalObjective,
  canonicalInitiative,
} from "../../domain/sha.ts";
