/**
 * Story 000 T1 — Tone vocabulary unit tests.
 * Asserts the five-tone-to-badge-variant mapping from `design/status.ts`
 * (DESIGN §4). The exact variant values are the contract the SE implements.
 *
 * Badge variants available in the vendored badge.tsx:
 *   default | secondary | destructive | outline | ghost | link | success | warning
 *
 * Mapping rationale:
 *   neutral  → secondary   (muted/gray look)
 *   info     → default     (primary/action color = informational)
 *   success  → success     (semantic success token from globals.css)
 *   warning  → warning     (semantic warning token from globals.css)
 *   danger   → destructive (error/danger red)
 */
import { describe, it, expect } from "vitest";
import { TONE_BADGE_VARIANT } from "@/design/status";

describe("design/status — tone-to-badge-variant mapping (DESIGN §4)", () => {
  it("maps neutral tone to secondary badge variant", () => {
    expect(TONE_BADGE_VARIANT.neutral).toBe("secondary");
  });

  it("maps info tone to default badge variant", () => {
    expect(TONE_BADGE_VARIANT.info).toBe("default");
  });

  it("maps success tone to success badge variant", () => {
    expect(TONE_BADGE_VARIANT.success).toBe("success");
  });

  it("maps warning tone to warning badge variant", () => {
    expect(TONE_BADGE_VARIANT.warning).toBe("warning");
  });

  it("maps danger tone to destructive badge variant", () => {
    expect(TONE_BADGE_VARIANT.danger).toBe("destructive");
  });
});
