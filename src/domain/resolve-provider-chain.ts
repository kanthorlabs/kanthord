// src/domain/resolve-provider-chain.ts — 008.2 Story C
// Pure (zero-I/O) provider-chain resolver.
// Assigned providers come in rank order; the default is appended iff it is
// active and its id is not already present (first-wins dedup).
//
// No imports outside domain/ — any type structurally matching
// { id, state } works (no explicit port dependency).

export interface ProviderChainMember {
  id: string;
  state: "active" | "logged_out";
}

export function resolveProviderChain<T extends ProviderChainMember>(
  assignedInRankOrder: T[],
  defaultProvider: T | undefined,
): T[] {
  const seen = new Set<string>();

  // Filter assigned to active only, dedup by id (first-wins).
  const chain: T[] = [];
  for (const p of assignedInRankOrder) {
    if (p.state === "active" && !seen.has(p.id)) {
      seen.add(p.id);
      chain.push(p);
    }
  }

  // Append the default if it is active and not already present.
  if (
    defaultProvider !== undefined &&
    defaultProvider.state === "active" &&
    !seen.has(defaultProvider.id)
  ) {
    chain.push(defaultProvider);
  }

  return chain;
}
