// BLOCKER S3 — one shared GlobalAiProvider -> ResolvedProvider mapping, used by
// both src/composition.ts (providerChainFor) and
// src/agent-runner/pi-provider-probe.ts, replacing the copy-pasted
// `p.effort as any` mapping duplicated at both call sites.
import type { GlobalAiProvider } from "../storage/port.ts";
import type { ReasoningEffort } from "../domain/resource.ts";
import type { ResolvedProvider } from "./port.ts";

export function toResolvedProvider(p: GlobalAiProvider): ResolvedProvider {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    model: p.model,
    value: p.value ?? "",
    credentialVersion: p.credentialVersion,
    ...(p.baseUrl !== null ? { baseUrl: p.baseUrl } : {}),
    ...(p.effort !== null ? { effort: p.effort as ReasoningEffort } : {}),
    ...(p.api !== null ? { api: p.api } : {}),
    ...(p.contextWindow !== null ? { contextWindow: p.contextWindow } : {}),
    ...(p.maxTokens !== null ? { maxTokens: p.maxTokens } : {}),
  };
}
