import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { locators } from "@/locators";

type PublicBrokerDeclaration = {
  verb: string;
  tier: string;
  timeoutMs: number | bigint;
  idempotencyWindowMs: number | bigint;
  retryMax: number;
  retryBackoff: string;
  pollIntervalMs: number | bigint;
  terminalStates: readonly string[];
  requestsPerMinute: number;
  observedStateCanRegress: boolean;
  pendingExpiryMs?: number | bigint;
};

export interface PublicConfiguration {
  diffEscalationPolicy: string;
  brokerDeclarations: readonly PublicBrokerDeclaration[];
}

export function Configuration({ configuration }: { configuration: PublicConfiguration }) {
  return (
    <Card data-testid={locators.daemonOps.configurationCard}>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div data-testid={locators.daemonOps.configurationReadOnly} className="text-sm text-muted-foreground">
          Read-only
        </div>
        <div data-testid={locators.daemonOps.configurationGitDiscipline} className="text-sm text-muted-foreground">
          Git discipline
        </div>
        <pre
          data-testid={locators.daemonOps.configurationYaml}
          className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground"
        >{normalizeConfiguration(configuration)}</pre>
      </CardContent>
    </Card>
  );
}

function normalizeConfiguration(configuration: PublicConfiguration): string {
  const lines = [`diffEscalationPolicy: ${configuration.diffEscalationPolicy}`, "brokerDeclarations:"];

  for (const declaration of configuration.brokerDeclarations) {
    lines.push(
      `  - verb: ${declaration.verb}`,
      `    tier: ${declaration.tier}`,
      `    timeoutMs: ${String(declaration.timeoutMs)}`,
      `    idempotencyWindowMs: ${String(declaration.idempotencyWindowMs)}`,
      `    retryMax: ${declaration.retryMax}`,
      `    retryBackoff: ${declaration.retryBackoff}`,
      `    pollIntervalMs: ${String(declaration.pollIntervalMs)}`,
      "    terminalStates:",
    );
    for (const terminalState of declaration.terminalStates) {
      lines.push(`      - ${terminalState}`);
    }
    lines.push(
      `    requestsPerMinute: ${declaration.requestsPerMinute}`,
      `    observedStateCanRegress: ${declaration.observedStateCanRegress}`,
    );
    if (declaration.pendingExpiryMs !== undefined) {
      lines.push(`    pendingExpiryMs: ${String(declaration.pendingExpiryMs)}`);
    }
  }

  return lines.join("\n");
}
