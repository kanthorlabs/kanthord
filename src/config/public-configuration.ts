import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { loadVerbRegistry } from "../broker/registry.ts";
import type { VerbRegistryEntry } from "../broker/registry.ts";
import type {
  PublicBrokerDeclaration,
  PublicConfiguration,
} from "../rpc/read-surfaces.ts";

const PUBLIC_DIFF_POLICY_PATH = fileURLToPath(
  new URL("../../config/public-configuration.yaml", import.meta.url),
);
const BROKER_VERBS_PATH = fileURLToPath(
  new URL("../../broker/verbs/", import.meta.url),
);

function projectBrokerDeclaration(entry: VerbRegistryEntry): PublicBrokerDeclaration {
  return {
    verb: entry.verb,
    tier: entry.tier,
    timeoutMs: entry.timeout,
    idempotencyWindowMs: entry.idempotency.window_ms,
    retryMax: entry.retry.max,
    retryBackoff: entry.retry.backoff,
    pollIntervalMs: entry.poll_interval,
    terminalStates: [...entry.terminal_states],
    requestsPerMinute: entry.rate_limit.requests_per_minute,
    observedStateCanRegress: entry.observed_state_can_regress,
  };
}

export async function loadPublicConfiguration(): Promise<PublicConfiguration> {
  const policyRaw = parseYaml(await readFile(PUBLIC_DIFF_POLICY_PATH, "utf8"));
  const policy = policyRaw as { diff_escalation_policy?: unknown };
  if (policy?.diff_escalation_policy !== "escalate_all_diffs") {
    throw new Error("invalid public diff escalation policy");
  }

  const registry = await loadVerbRegistry(BROKER_VERBS_PATH);
  const brokerDeclarations = Object.values(registry)
    .map(projectBrokerDeclaration)
    .sort((left, right) => left.verb.localeCompare(right.verb));

  return {
    diffEscalationPolicy: "escalate_all_diffs",
    brokerDeclarations,
  };
}
