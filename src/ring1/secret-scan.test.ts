import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanPayload, loadPatternRegistry } from "./secret-scan.ts";
import type { ScanMatch, PatternRegistry } from "./secret-scan.ts";
import {
  makeOutboundScanGuard,
} from "./outbound-scan-guard.ts";
import type {
  OutboundScanGuard,
  ScanEscalationEvent,
} from "./outbound-scan-guard.ts";

// ---------------------------------------------------------------------------
// Helper to build a temp registry dir with a YAML pattern file
// ---------------------------------------------------------------------------

async function makeTempRegistry(
  yaml: string,
): Promise<{ dir: string; filePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "secret-scan-test-"));
  const filePath = join(dir, "patterns.yaml");
  await writeFile(filePath, yaml, "utf8");
  return { dir, filePath };
}

describe("src/ring1/secret-scan.ts", () => {
  // -------------------------------------------------------------------------
  // T1(a): fixture payloads with known credential shapes each return a match
  //        naming the pattern class, never echoing the secret value
  // -------------------------------------------------------------------------

  it("T1(a)-aws: AWS-style access key match returns pattern class, not the value", async () => {
    // Fake AWS-style 20-char all-caps key (test fixture — not a real key)
    const fakeAwsKey = "AKIAIOSFODNN7EXAMPLE";
    const payload = `the key is ${fakeAwsKey} and more text`;

    const registry: PatternRegistry = {
      version: "1.0.0",
      patterns: [
        {
          name: "aws-access-key",
          regex: "AKIA[0-9A-Z]{16}",
        },
      ],
    };

    const matches = scanPayload(payload, registry);

    assert.equal(matches.length, 1);
    const match = matches[0] as ScanMatch;
    assert.equal(match.patternClass, "aws-access-key");
    // The secret value must NOT appear in the match object
    assert.ok(
      !JSON.stringify(match).includes(fakeAwsKey),
      "secret value must not appear in the match object",
    );
  });

  it("T1(a)-bearer: bearer token match returns pattern class, not the value", async () => {
    const fakeToken = "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
    const payload = `Authorization: ${fakeToken}`;

    const registry: PatternRegistry = {
      version: "1.0.0",
      patterns: [
        {
          name: "bearer-token",
          regex: "Bearer\\s+[A-Za-z0-9_\\-\\.]+",
        },
      ],
    };

    const matches = scanPayload(payload, registry);

    assert.equal(matches.length, 1);
    const match = matches[0] as ScanMatch;
    assert.equal(match.patternClass, "bearer-token");
    // No secret value in the match
    const serialized = JSON.stringify(match);
    assert.ok(
      !serialized.includes("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"),
      "token value must not appear in the match object",
    );
  });

  it("T1(a)-private-key: PEM private-key block match returns pattern class, not the value", async () => {
    const fakeKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----";
    const payload = `config:\n  key: "${fakeKey}"`;

    const registry: PatternRegistry = {
      version: "1.0.0",
      patterns: [
        {
          name: "pem-private-key",
          regex: "-----BEGIN [A-Z ]*PRIVATE KEY-----",
        },
      ],
    };

    const matches = scanPayload(payload, registry);

    assert.equal(matches.length, 1);
    const match = matches[0] as ScanMatch;
    assert.equal(match.patternClass, "pem-private-key");
    // The PEM header is the pattern marker — the private key block itself
    // must not appear in the match object beyond the pattern class name
    assert.ok(
      !JSON.stringify(match).includes("PRIVATE KEY-----\nMIIE"),
      "raw key block must not appear in the match object",
    );
  });

  // -------------------------------------------------------------------------
  // T1(b): clean text returns no matches
  // -------------------------------------------------------------------------

  it("T1(b): clean payload returns empty match array", async () => {
    const payload = "This is a clean payload with no secrets.";

    const registry: PatternRegistry = {
      version: "1.0.0",
      patterns: [
        { name: "aws-access-key", regex: "AKIA[0-9A-Z]{16}" },
        { name: "bearer-token", regex: "Bearer\\s+[A-Za-z0-9_\\-\\.]+" },
      ],
    };

    const matches = scanPayload(payload, registry);
    assert.equal(matches.length, 0);
  });

  // -------------------------------------------------------------------------
  // T1(c): malformed pattern registry is a typed error naming the file
  // -------------------------------------------------------------------------

  it("T1(c): malformed YAML registry is a typed error naming the file path", async () => {
    const { dir, filePath } = await makeTempRegistry(
      "not: valid: yaml: {{{{{{",
    );
    try {
      await assert.rejects(
        () => loadPatternRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes(filePath),
            `error message must include the file path; got: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T1(c): missing required field in registry is a typed error naming the file path", async () => {
    // A registry without 'version' is malformed
    const { dir, filePath } = await makeTempRegistry(
      "patterns:\n  - name: foo\n    regex: bar\n",
    );
    try {
      await assert.rejects(
        () => loadPatternRegistry(filePath),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes(filePath),
            `error message must include the file path; got: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1 registry version surfaces in scan result context
  // -------------------------------------------------------------------------

  it("T1: registry version is accessible from the loaded registry", async () => {
    const { dir, filePath } = await makeTempRegistry(
      "version: '2.3.1'\npatterns:\n  - name: test-pattern\n    regex: 'SECRET_[A-Z]+'\n",
    );
    try {
      const registry = await loadPatternRegistry(filePath);
      assert.equal(registry.version, "2.3.1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T2: Choke-point enforcement, fail-closed
// Tests the OutboundScanGuard seam that wraps the broker submit path and
// the runbook.append path.
// ---------------------------------------------------------------------------

// Story-named values (PROFILE.md: Mock = Story-named value)
const MOCK_REQUEST_ID_T2 = "req-stub-T2-001";

/** A fake verb adapter that records invocation count. */
function makeFakeAdapter(): {
  submit: (payload: unknown) => Promise<string>;
  calls: number;
} {
  let calls = 0;
  return {
    submit: async (_payload: unknown) => {
      calls += 1;
      return MOCK_REQUEST_ID_T2;
    },
    get calls() { return calls; },
  };
}

/** A registry with one AWS-key pattern (test-fixture credential shape). */
const AWS_REGISTRY: PatternRegistry = {
  version: "1.0.0",
  patterns: [{ name: "aws-access-key", regex: "AKIA[0-9A-Z]{16}" }],
};

/** Serialize a payload object to its final JSON string (simulating templating). */
function serialize(payload: unknown): string {
  return JSON.stringify(payload);
}

describe("src/ring1/outbound-scan-guard.ts — T2 choke-point enforcement", () => {
  // -------------------------------------------------------------------------
  // T2(a): A matching broker submit is blocked before the adapter runs;
  //        escalation event names verb, task id, and pattern class (never value)
  // -------------------------------------------------------------------------
  it("T2(a): broker submit with secret payload is blocked before adapter runs and escalation records verb/task/patternClass", async () => {
    const escalations: ScanEscalationEvent[] = [];
    const adapter = makeFakeAdapter();

    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: AWS_REGISTRY,
      onEscalate: (e) => escalations.push(e),
    });

    // Payload containing a fake AWS-style key (test fixture — not a real key)
    const fakeKey = "AKIAIOSFODNN7EXAMPLE";
    const serializedPayload = serialize({ param: fakeKey });

    const result = await guard.guardedSubmit({
      verb: "git.push",
      taskId: "task-t2a",
      serializedPayload,
      submit: adapter.submit,
    });

    // Adapter must NOT have been called
    assert.equal(adapter.calls, 0, "adapter submit must not run when payload matches");

    // Result must indicate blocked
    assert.equal(result.status, "blocked", "result status must be 'blocked'");

    // Exactly one escalation
    assert.equal(escalations.length, 1, "one escalation event must be recorded");
    const ev = escalations[0] as ScanEscalationEvent;
    assert.equal(ev.tag, "scan-blocked", "escalation tag must be 'scan-blocked'");
    assert.equal(ev.verb, "git.push", "escalation must name the verb");
    assert.equal(ev.taskId, "task-t2a", "escalation must name the task id");
    assert.equal(ev.patternClass, "aws-access-key", "escalation must name the pattern class");
    // The secret value must NOT appear in the escalation
    assert.ok(
      !JSON.stringify(ev).includes(fakeKey),
      "secret value must not appear in the escalation event",
    );
  });

  // -------------------------------------------------------------------------
  // T2(b): A matching runbook.append body is blocked and escalated;
  //        the append callback must NOT be called (choke-point suppression)
  // -------------------------------------------------------------------------
  it("T2(b): runbook.append with secret body is blocked, escalated, and append callback suppressed", async () => {
    const escalations: ScanEscalationEvent[] = [];
    let appendCalls = 0;

    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: AWS_REGISTRY,
      onEscalate: (e) => escalations.push(e),
    });

    const fakeKey = "AKIAIOSFODNN7EXAMPLE";
    const result = await guard.guardedRunbookAppend({
      taskId: "task-t2b",
      body: `Runbook note: key=${fakeKey}`,
      append: async (_body: string) => { appendCalls += 1; },
    });

    assert.equal(result.status, "blocked", "runbook.append must be blocked when body matches");
    assert.equal(appendCalls, 0, "append callback must NOT be called when body is blocked");
    assert.equal(escalations.length, 1, "one escalation event");
    const ev = escalations[0] as ScanEscalationEvent;
    assert.equal(ev.tag, "scan-blocked");
    assert.equal(ev.verb, "runbook.append");
    assert.equal(ev.taskId, "task-t2b");
    assert.equal(ev.patternClass, "aws-access-key");
  });

  // -------------------------------------------------------------------------
  // T2(b-clean): A clean runbook.append body passes through and the append
  //              callback IS called (choke-point allows and delegates)
  // -------------------------------------------------------------------------
  it("T2(b-clean): clean runbook.append body passes through and append callback is called", async () => {
    const escalations: ScanEscalationEvent[] = [];
    let appendCalls = 0;
    let appendedBody = "";

    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: AWS_REGISTRY,
      onEscalate: (e) => escalations.push(e),
    });

    const cleanBody = "This is a clean runbook note.";
    const result = await guard.guardedRunbookAppend({
      taskId: "task-t2b-clean",
      body: cleanBody,
      append: async (body: string) => { appendCalls += 1; appendedBody = body; },
    });

    assert.equal(result.status, "ok", "clean body must pass through");
    assert.equal(appendCalls, 1, "append callback must be called exactly once on clean body");
    assert.equal(appendedBody, cleanBody, "append callback must receive the original body");
    assert.equal(escalations.length, 0, "no escalation for clean body");
  });

  // -------------------------------------------------------------------------
  // T2(c): An injected scanner throw blocks the send with a scan-failed escalation
  // -------------------------------------------------------------------------
  it("T2(c): injected scanner error blocks the send with scan-failed escalation", async () => {
    const escalations: ScanEscalationEvent[] = [];
    const adapter = makeFakeAdapter();

    // Scanner that always throws
    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: AWS_REGISTRY,
      onEscalate: (e) => escalations.push(e),
      // Inject a scanner that always throws
      scanFn: (_payload: string, _registry: PatternRegistry): ScanMatch[] => {
        throw new Error("scanner internal error");
      },
    });

    const result = await guard.guardedSubmit({
      verb: "github.create_pr",
      taskId: "task-t2c",
      serializedPayload: serialize({ title: "my PR" }),
      submit: adapter.submit,
    });

    assert.equal(adapter.calls, 0, "adapter must not run when scanner throws");
    assert.equal(result.status, "blocked", "result must be blocked on scanner error");
    assert.equal(escalations.length, 1);
    const ev = escalations[0] as ScanEscalationEvent;
    assert.equal(ev.tag, "scan-failed", "escalation tag must be 'scan-failed'");
    assert.equal(ev.verb, "github.create_pr");
    assert.equal(ev.taskId, "task-t2c");
  });

  // -------------------------------------------------------------------------
  // T2(d): A second fake verb is blocked with no verb-specific wiring —
  //        structural: the choke point is shared, not per-verb
  // -------------------------------------------------------------------------
  it("T2(d): a second verb with no verb-specific wiring is still blocked at the shared choke point", async () => {
    const escalations: ScanEscalationEvent[] = [];
    const adapter = makeFakeAdapter();

    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: AWS_REGISTRY,
      onEscalate: (e) => escalations.push(e),
    });

    const fakeKey = "AKIAIOSFODNN7EXAMPLE";

    // First verb
    await guard.guardedSubmit({
      verb: "git.push",
      taskId: "task-t2d",
      serializedPayload: serialize({ data: fakeKey }),
      submit: adapter.submit,
    });

    // Second, entirely different verb — no special wiring needed
    await guard.guardedSubmit({
      verb: "github.create_issue",
      taskId: "task-t2d",
      serializedPayload: serialize({ body: fakeKey }),
      submit: adapter.submit,
    });

    // Both calls blocked; adapter never ran
    assert.equal(adapter.calls, 0, "adapter must not run for either verb");
    assert.equal(escalations.length, 2, "both verbs produce escalations via the shared choke point");
    assert.equal((escalations[0] as ScanEscalationEvent).verb, "git.push");
    assert.equal((escalations[1] as ScanEscalationEvent).verb, "github.create_issue");
  });

  // -------------------------------------------------------------------------
  // T2(e): With a failed registry load, submits are blocked with scan-unavailable
  //        while the guard remains operational (daemon keeps serving)
  // -------------------------------------------------------------------------
  it("T2(e): guard built with scan-unavailable state blocks all submits with scan-unavailable escalation", async () => {
    const escalations: ScanEscalationEvent[] = [];
    const adapter = makeFakeAdapter();

    // Build a guard that failed to load its registry (scan unavailable)
    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: null, // null signals registry-load failure
      onEscalate: (e) => escalations.push(e),
    });

    const result = await guard.guardedSubmit({
      verb: "git.push",
      taskId: "task-t2e",
      serializedPayload: serialize({ data: "clean" }),
      submit: adapter.submit,
    });

    assert.equal(adapter.calls, 0, "adapter must not run when registry is unavailable");
    assert.equal(result.status, "blocked");
    assert.equal(escalations.length, 1);
    const ev = escalations[0] as ScanEscalationEvent;
    assert.equal(ev.tag, "scan-unavailable", "escalation tag must be 'scan-unavailable'");
    assert.equal(ev.verb, "git.push");
    assert.equal(ev.taskId, "task-t2e");
  });

  // -------------------------------------------------------------------------
  // T2(f): A secret introduced only by payload serialization (absent from raw
  //        params) is caught — the scan sees the final serialized form
  // -------------------------------------------------------------------------
  it("T2(f): a secret introduced only during serialization/templating is caught by the scan", async () => {
    const escalations: ScanEscalationEvent[] = [];
    const adapter = makeFakeAdapter();

    // Registry with a pattern matching a "template-injected" secret shape
    const templateRegistry: PatternRegistry = {
      version: "1.0.0",
      patterns: [{ name: "template-secret", regex: "TMPL_SECRET_[A-Z0-9]+" }],
    };

    const guard: OutboundScanGuard = makeOutboundScanGuard({
      registry: templateRegistry,
      onEscalate: (e) => escalations.push(e),
    });

    // The raw params look innocuous; the secret appears only in the serialized form
    // (simulating a template that expands a variable into the final payload)
    const rawParams = { title: "My PR" };
    const templateExpansion = "TMPL_SECRET_ABCDEF123"; // injected by template
    const finalSerializedPayload = JSON.stringify({
      ...rawParams,
      renderedBody: `PR created with key ${templateExpansion}`,
    });

    const result = await guard.guardedSubmit({
      verb: "github.create_pr",
      taskId: "task-t2f",
      serializedPayload: finalSerializedPayload,
      submit: adapter.submit,
    });

    assert.equal(adapter.calls, 0, "adapter must not run when serialized payload contains secret");
    assert.equal(result.status, "blocked");
    assert.equal(escalations.length, 1);
    assert.equal((escalations[0] as ScanEscalationEvent).patternClass, "template-secret");
  });
});
