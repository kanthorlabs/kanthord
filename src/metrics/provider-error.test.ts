import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyProviderError } from "./provider-error.ts";

describe(
  "Story 003 T2 (Epic 019.5) — typed provider-error taxonomy + mapping",
  () => {
    it("T2: 'rate limit' pattern maps to rate_limited", () => {
      assert.equal(
        classifyProviderError("Rate limit exceeded: too many requests").kind,
        "rate_limited",
      );
    });

    it("T2: 'quota exceeded' pattern maps to quota_exhausted", () => {
      assert.equal(
        classifyProviderError("quota exceeded for this billing period").kind,
        "quota_exhausted",
      );
    });

    it("T2: '401 unauthorized' pattern maps to auth_failed", () => {
      assert.equal(
        classifyProviderError("401 Unauthorized: authentication failed").kind,
        "auth_failed",
      );
    });

    it("T2: 'timeout' / 'retry' pattern maps to transient", () => {
      assert.equal(
        classifyProviderError("network timeout, please retry").kind,
        "transient",
      );
    });

    it("T2: unmappable error maps to fatal with non-empty bounded detail", () => {
      const r = classifyProviderError("some totally unknown error xyz-987");
      assert.equal(r.kind, "fatal");
      assert.ok(
        r.detail !== undefined && r.detail.length > 0,
        "fatal must carry non-empty detail",
      );
      assert.ok(r.detail.length <= 512, "detail bounded to at most 512 chars");
    });

    it("T2: very long raw error is bounded in the fatal detail", () => {
      const r = classifyProviderError("z".repeat(2000));
      assert.equal(r.kind, "fatal");
      assert.ok(
        (r.detail?.length ?? 0) <= 512,
        "detail must be truncated to 512 chars",
      );
    });

    it("T2: secret key in raw error does not appear in classified output", () => {
      const fakeKey = "sk-ant-api03-fakekey1234567890abcdef";
      const r = classifyProviderError(`Auth error: key=${fakeKey}`);
      assert.ok(
        !JSON.stringify(r).includes(fakeKey),
        "secret must be redacted from classified result",
      );
    });
  },
);
