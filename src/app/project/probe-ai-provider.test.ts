// src/app/project/probe-ai-provider.test.ts — EPIC 014 Story 5
// Hermetic tests for the provider-probe adapter. No model, no network,
// no real TestAiProvider — the seam takes an injected `tester` and
// `secretOf`, and the tests drive both through in-process fakes.
//
// Why the fakes are inline (not shared): Story 5 is the only story in
// EPIC 014 that probes a provider; Story 6's `--probe-provider` flag
// is a flag-plumbing test, not a probe test. The fakes stay here.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProbeAiProvider,
  PROVIDER_PROBE_PROMPT,
  type ProviderProbeOutcome,
} from "./probe-ai-provider.ts";

/** Records every call so the assertions can inspect the request shape. */
class FakeTester {
  readonly calls: { id: string; prompt: string }[] = [];

  /** Programmable response — set to a string to resolve, an Error to reject, or a value to reject with. */
  resolveWith: string | Error | unknown = "ok, it is Monday";

  async execute(input: { id: string; prompt: string }): Promise<string> {
    this.calls.push({ id: input.id, prompt: input.prompt });
    if (this.resolveWith instanceof Error) {
      throw this.resolveWith;
    }
    if (typeof this.resolveWith !== "string") {
      throw this.resolveWith;
    }
    return this.resolveWith;
  }
}

const PROBE = new ProbeAiProvider(new FakeTester(), (_id: string) => null);

test("PROVIDER_PROBE_PROMPT is the fixed probe prompt", () => {
  assert.equal(PROVIDER_PROBE_PROMPT, "kanthord readiness probe");
});

test("ProbeAiProvider is constructible (no throw) and exports ProviderProbeOutcome type", () => {
  // Constructor returns an instance — this is a structural smoke test
  // (the type itself is erased at runtime, but a missing class would
  // fail the module-resolution RED proof).
  assert.ok(PROBE instanceof ProbeAiProvider);
  // Type-level guarantee: an outcome value satisfies the shape.
  const outcome: ProviderProbeOutcome = {
    resourceId: "p1",
    status: "ok",
    detail: "provider answered the probe prompt",
  };
  assert.equal(outcome.resourceId, "p1");
  assert.equal(outcome.status, "ok");
});

test("execute resolves with status:ok and a fixed detail when the tester returns a string", async () => {
  const tester = new FakeTester();
  tester.resolveWith = "ok, it is Monday";
  const probe = new ProbeAiProvider(tester, () => null);

  const out = await probe.execute("p1");

  assert.deepEqual(out, {
    resourceId: "p1",
    status: "ok",
    detail: "provider answered the probe prompt",
  });
});

test("execute does NOT surface the model's response text in the detail", async () => {
  const tester = new FakeTester();
  tester.resolveWith = "ok, it is Monday";
  const probe = new ProbeAiProvider(tester, () => null);

  const out = await probe.execute("p1");

  // The model reply is unbounded and could contain anything — including
  // a credential. The detail must be a fixed confirmation string.
  assert.equal(
    out.detail.includes("Monday"),
    false,
    "detail must not include the model reply",
  );
  assert.equal(out.detail, "provider answered the probe prompt");
});

test("execute calls the tester exactly once with { id: providerId, prompt: PROVIDER_PROBE_PROMPT }", async () => {
  const tester = new FakeTester();
  tester.resolveWith = "pong";
  const probe = new ProbeAiProvider(tester, () => null);

  await probe.execute("p1");

  assert.equal(tester.calls.length, 1);
  assert.deepEqual(tester.calls[0], {
    id: "p1",
    prompt: PROVIDER_PROBE_PROMPT,
  });
});

test("execute resolves (does not reject) with status:failed when the tester throws an Error with a plain message", async () => {
  const tester = new FakeTester();
  tester.resolveWith = new Error("401 unauthorized");
  const probe = new ProbeAiProvider(tester, () => null);

  // Crucial contract: a diagnostic command must not abort on a provider
  // failure — the rest of the report has to print.
  const out = await probe.execute("p1");

  assert.equal(out.resourceId, "p1");
  assert.equal(out.status, "failed");
  assert.equal(out.detail, "401 unauthorized");
});

test("execute redacts the provider's secret out of the failed detail (mirrors pi.test.ts redaction contract)", async () => {
  const tester = new FakeTester();
  tester.resolveWith = new Error("sk-secret is an invalid key");
  const probe = new ProbeAiProvider(tester, () => "sk-secret");

  const out = await probe.execute("p1");

  assert.equal(out.status, "failed");
  assert.equal(
    out.detail.includes("sk-secret"),
    false,
    "detail must not contain the raw secret",
  );
  assert.equal(
    out.detail.includes("***"),
    true,
    "detail must contain the redaction marker",
  );
});

test("execute leaves the message unchanged when secretOf returns null (no redaction when no secret is known)", async () => {
  const tester = new FakeTester();
  tester.resolveWith = new Error("sk-anything is an invalid key");
  const probe = new ProbeAiProvider(tester, () => null);

  const out = await probe.execute("p1");

  assert.equal(out.status, "failed");
  assert.equal(out.detail, "sk-anything is an invalid key");
  assert.equal(out.detail.includes("***"), false);
});

test("execute takes the first line of a multi-line error message and discards the rest", async () => {
  const tester = new FakeTester();
  tester.resolveWith = new Error("first line\nsecond line\nthird line");
  const probe = new ProbeAiProvider(tester, () => null);

  const out = await probe.execute("p1");

  assert.equal(out.status, "failed");
  assert.equal(out.detail, "first line");
  assert.equal(out.detail.includes("second"), false);
  assert.equal(out.detail.includes("third"), false);
});

test("execute truncates a 5000-character error message to at most 300 characters", async () => {
  const long = "x".repeat(5000);
  const tester = new FakeTester();
  tester.resolveWith = new Error(long);
  const probe = new ProbeAiProvider(tester, () => null);

  const out = await probe.execute("p1");

  assert.equal(out.status, "failed");
  assert.ok(out.detail.length <= 300, `detail.length=${out.detail.length}`);
  // The first line of a 5000-char single-line string is the whole string —
  // the truncation happens AFTER the first-line split.
  assert.ok(out.detail.length > 0);
});

test("execute redacts a secret inside a multi-line error message and keeps the first line only", async () => {
  const tester = new FakeTester();
  tester.resolveWith = new Error(
    "first line with sk-secret inside\nsecond line",
  );
  const probe = new ProbeAiProvider(tester, () => "sk-secret");

  const out = await probe.execute("p1");

  assert.equal(out.status, "failed");
  assert.equal(out.detail.includes("sk-secret"), false);
  assert.equal(out.detail.includes("***"), true);
  assert.equal(out.detail.includes("second"), false);
});

test("execute handles a non-Error rejection by stringifying the thrown value verbatim", async () => {
  // The FakeTester treats a string `resolveWith` as a resolution (it returns
  // the string from `execute`), not a rejection. To exercise the
  // `String(err)` branch in `ProbeAiProvider.execute`, the value must be
  // non-string AND non-Error, so the FakeTester throws it. The
  // `{ toString: () => "boom" }` object coerces to "boom" under `String()`.
  const tester = new FakeTester();
  tester.resolveWith = { toString: () => "boom" };
  const probe = new ProbeAiProvider(tester, () => null);

  const out = await probe.execute("p1");

  assert.equal(out.status, "failed");
  assert.equal(out.detail, "boom");
});

test("execute uses the providerId passed in, not one captured at construction time", async () => {
  const tester = new FakeTester();
  tester.resolveWith = "ok";
  const probe = new ProbeAiProvider(tester, () => null);

  await probe.execute("p-42");

  assert.equal(tester.calls[0]?.id, "p-42");
  assert.equal(tester.calls[0]?.prompt, PROVIDER_PROBE_PROMPT);
});
