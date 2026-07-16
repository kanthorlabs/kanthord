import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Configuration } from "@/daemon-ops/Configuration";
import { locators } from "@/locators";

const PUBLIC_CONFIGURATION = {
  diffEscalationPolicy: "escalate_all_diffs",
  brokerDeclarations: [
    {
      verb: "github.create_pr",
      tier: "auto_with_audit",
      timeoutMs: 120_000n,
      idempotencyWindowMs: 3_600_000n,
      retryMax: 5,
      retryBackoff: "exponential",
      pollIntervalMs: 10_000n,
      terminalStates: ["done", "failed", "escalation_needed"],
      requestsPerMinute: 60,
      observedStateCanRegress: true,
      pendingExpiryMs: 300_000n,
    },
  ],
};

const NORMALIZED_YAML = [
  "diffEscalationPolicy: escalate_all_diffs",
  "brokerDeclarations:",
  "  - verb: github.create_pr",
  "    tier: auto_with_audit",
  "    timeoutMs: 120000",
  "    idempotencyWindowMs: 3600000",
  "    retryMax: 5",
  "    retryBackoff: exponential",
  "    pollIntervalMs: 10000",
  "    terminalStates:",
  "      - done",
  "      - failed",
  "      - escalation_needed",
  "    requestsPerMinute: 60",
  "    observedStateCanRegress: true",
  "    pendingExpiryMs: 300000",
].join("\n");

describe("Configuration — safe public YAML card", () => {
  it("renders normalized YAML from the typed public configuration allowlist", () => {
    render(<Configuration configuration={PUBLIC_CONFIGURATION} />);

    expect(screen.getByTestId(locators.daemonOps.configurationCard)).toBeInTheDocument();
    expect(screen.getByTestId(locators.daemonOps.configurationYaml).textContent).toBe(NORMALIZED_YAML);
  });

  it("marks the YAML as read-only and records the git-discipline note", () => {
    render(<Configuration configuration={PUBLIC_CONFIGURATION} />);

    expect(screen.getByTestId(locators.daemonOps.configurationReadOnly)).toHaveTextContent("Read-only");
    expect(screen.getByTestId(locators.daemonOps.configurationGitDiscipline)).toHaveTextContent(/git.*discipline/i);
  });

  it("offers no form, content-editing, or edit/save/upload affordance", () => {
    render(<Configuration configuration={PUBLIC_CONFIGURATION} />);

    const card = screen.getByTestId(locators.daemonOps.configurationCard);
    expect(card.outerHTML).not.toMatch(/<(?:input|textarea)\b/i);
    expect(card.outerHTML).not.toMatch(/contenteditable/i);
    expect(card).not.toHaveTextContent(/\b(?:edit|save|upload)\b/i);
  });
});
