import { describe, test } from "node:test";
import assert from "node:assert/strict";

// RED: module does not exist yet — import will fail
import { pollPrState } from "./pr-state.ts";
import type { PrHttpSeam } from "./pr-state.ts";

// Suite: src/review/pr-state.ts
// Story 019.18-002 Task T1 — PR state probe over injected platform seam

describe("src/review/pr-state.ts", () => {
  // -------------------------------------------------------------------------
  // T1a — merged PR → "merged"
  // -------------------------------------------------------------------------
  test("pollPrState returns 'merged' when platform reports PR as merged", async () => {
    const http: PrHttpSeam = {
      getPrState: async (_repo: string, _prNumber: number) => ({
        state: "closed",
        merged: true,
      }),
    };
    const result = await pollPrState({ repo: "org/repo", prNumber: 42, http });
    assert.equal(result, "merged");
  });

  // -------------------------------------------------------------------------
  // T1b — closed-unmerged PR → "closed"
  // -------------------------------------------------------------------------
  test("pollPrState returns 'closed' when platform reports PR as closed but not merged", async () => {
    const http: PrHttpSeam = {
      getPrState: async (_repo: string, _prNumber: number) => ({
        state: "closed",
        merged: false,
      }),
    };
    const result = await pollPrState({ repo: "org/repo", prNumber: 42, http });
    assert.equal(result, "closed");
  });

  // -------------------------------------------------------------------------
  // T1c — open PR → "open"
  // -------------------------------------------------------------------------
  test("pollPrState returns 'open' when platform reports PR as still open", async () => {
    const http: PrHttpSeam = {
      getPrState: async (_repo: string, _prNumber: number) => ({
        state: "open",
        merged: false,
      }),
    };
    const result = await pollPrState({ repo: "org/repo", prNumber: 42, http });
    assert.equal(result, "open");
  });

  // -------------------------------------------------------------------------
  // T1d — seam receives exact repo + prNumber
  // -------------------------------------------------------------------------
  test("pollPrState forwards the exact repo and prNumber to the seam", async () => {
    let capturedRepo: string | undefined;
    let capturedPrNumber: number | undefined;
    const http: PrHttpSeam = {
      getPrState: async (repo: string, prNumber: number) => {
        capturedRepo = repo;
        capturedPrNumber = prNumber;
        return { state: "open", merged: false };
      },
    };
    await pollPrState({ repo: "myorg/myrepo", prNumber: 99, http });
    assert.equal(capturedRepo, "myorg/myrepo");
    assert.equal(capturedPrNumber, 99);
  });
});
