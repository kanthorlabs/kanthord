import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPublicConfiguration } from "./public-configuration.ts";

// suite: src/config/public-configuration.ts

test("public configuration authority loads the fixed diff policy and every git-owned broker declaration", async () => {
  const configuration = await loadPublicConfiguration();

  assert.equal(
    configuration.diffEscalationPolicy,
    "escalate_all_diffs",
    "the fixed public policy must expose the approved diff escalation mode",
  );
  assert.deepEqual(
    configuration.brokerDeclarations.map((declaration) => declaration.verb).sort(),
    [
      "git.branch",
      "git.clone",
      "git.commit",
      "git.fetch",
      "git.push",
      "github.create_pr",
    ],
    "every checked-in broker verb declaration must be represented in the public configuration",
  );

  const createPr = configuration.brokerDeclarations.find(
    (declaration) => declaration.verb === "github.create_pr",
  );
  assert.deepEqual(
    createPr,
    {
      verb: "github.create_pr",
      tier: "auto_with_audit",
      timeoutMs: 120_000,
      idempotencyWindowMs: 3_600_000,
      retryMax: 5,
      retryBackoff: "exponential",
      pollIntervalMs: 10_000,
      terminalStates: ["done", "failed", "escalation_needed"],
      requestsPerMinute: 60,
      observedStateCanRegress: true,
    },
    "github.create_pr must project the declaration values in broker/verbs/github.create_pr.yaml",
  );
});

test("public configuration authority projects only the typed public allowlist", async () => {
  const configuration = await loadPublicConfiguration();

  assert.deepEqual(
    Object.keys(configuration).sort(),
    ["brokerDeclarations", "diffEscalationPolicy"],
    "the public response must not expose a policy path or any private top-level field",
  );
  for (const declaration of configuration.brokerDeclarations) {
    assert.deepEqual(
      Object.keys(declaration).sort(),
      [
        "idempotencyWindowMs",
        "observedStateCanRegress",
        "pollIntervalMs",
        "requestsPerMinute",
        "retryBackoff",
        "retryMax",
        "terminalStates",
        "tier",
        "timeoutMs",
        "verb",
      ],
      `declaration ${declaration.verb} must contain only public broker fields`,
    );
  }
  assert.doesNotMatch(
    JSON.stringify(configuration),
    /(?:path|credential|tls|secret|regex|provider)/i,
    "public configuration must not project raw paths, credentials, TLS material, secret regexes, or provider data",
  );
});
