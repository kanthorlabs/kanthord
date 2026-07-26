// src/app/ai-provider/register-global-provider.ts — shared registry-insert helper
// (008.3 Story E: extracted from RegisterAiProvider so both RegisterAiProvider
// and LoginProvider share the same insert + first-wins-default logic).
// BLOCKER 3: registry generates its own id — no phantom-id injection.

import type { AiProviderRegistry } from "../../storage/port.ts";

/**
 * Register a global AI provider.
 *
 * WARNING: This function is NOT transactional. It must be called from within
 * a transaction provided by the caller (RegisterAiProvider.execute() or
 * LoginProvider.execute()). Do NOT wrap this function in another transaction
 * — it is designed to be used inside an existing transaction boundary.
 *
 * - Calls `registry.register(...)` to persist the provider record.
 * - Uses the registry-generated id from the return value.
 * - Applies the first-wins default convention: the first provider ever
 *   registered becomes the default.
 * - Returns the generated provider id.
 */
export function registerGlobalProvider(
  registry: AiProviderRegistry,
  params: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    effort?: string;
    value: string;
  },
): string {
  const p = registry.register(params);

  // First-wins default convention: the first registered provider becomes the
  // default (same semantics as RegisterAiProvider).
  if (registry.getDefault() === undefined) {
    registry.setDefault(p.id);
  }

  return p.id;
}
