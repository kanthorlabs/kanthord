import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkPhaseBoundaryDrift,
  hashSourceContent,
} from "./drift-hook.ts";
import type { SourceProvider, EscalationSink } from "./drift-hook.ts";

// ---------------------------------------------------------------------------
// suite: src/workflow/drift-hook
// ---------------------------------------------------------------------------

describe("src/workflow/drift-hook", () => {
  describe("drift-hook — no drift when source is unchanged", () => {
    test("unchanged source at phase boundary produces no drift event", async () => {
      const content = "stable source content";
      const baselineHash = hashSourceContent(content);

      const sp: SourceProvider = {
        async fetchContent(_ref: string) {
          return content;
        },
      };

      const recorded: unknown[] = [];
      const sink: EscalationSink = {
        record(event) {
          recorded.push(event);
        },
      };

      await checkPhaseBoundaryDrift({
        ticketRef: "TICKET-1",
        baselineHash,
        sourceProvider: sp,
        escalationSink: sink,
      });

      assert.deepEqual(
        recorded,
        [],
        "no escalation event when source hash matches baseline",
      );
    });
  });

  describe("drift-hook — escalates on changed source", () => {
    test("changed source at phase boundary records a human-signal escalation event", async () => {
      const originalContent = "original source";
      const changedContent = "changed source — something was rewritten";
      const baselineHash = hashSourceContent(originalContent);

      const sp: SourceProvider = {
        async fetchContent(_ref: string) {
          return changedContent; // different from what was hashed at sign-off
        },
      };

      const recorded: Array<{ type: string; [k: string]: unknown }> = [];
      const sink: EscalationSink = {
        record(event) {
          recorded.push(event as { type: string; [k: string]: unknown });
        },
      };

      await checkPhaseBoundaryDrift({
        ticketRef: "TICKET-2",
        baselineHash,
        sourceProvider: sp,
        escalationSink: sink,
      });

      assert.equal(recorded.length, 1, "one escalation event recorded on drift");
      const ev = recorded[0];
      assert.ok(ev !== undefined, "event must be defined");
      assert.equal(
        ev.type,
        "human_signal",
        "escalation event type is human_signal",
      );
    });

    test("changed source at phase boundary does not halt the task — resolves without throwing", async () => {
      const baselineHash = hashSourceContent("snapshot content");

      const sp: SourceProvider = {
        async fetchContent(_ref: string) {
          return "completely different content at runtime";
        },
      };

      const sink: EscalationSink = { record() {} };

      let result: { drifted: boolean } | undefined;
      // Must resolve, not throw — task keeps working
      await assert.doesNotReject(async () => {
        result = await checkPhaseBoundaryDrift({
          ticketRef: "TICKET-3",
          baselineHash,
          sourceProvider: sp,
          escalationSink: sink,
        });
      }, "drift must not throw — task is not halted");

      assert.ok(result !== undefined, "result must be returned");
      assert.equal(
        result.drifted,
        true,
        "drifted flag is true when source changed",
      );
    });
  });

  describe("drift-hook — fires at every phase boundary", () => {
    test("re-hash is computed at each phase boundary, not only at the final one", async () => {
      const content = "consistent content";
      const baselineHash = hashSourceContent(content);

      let callCount = 0;
      const sp: SourceProvider = {
        async fetchContent(_ref: string) {
          callCount += 1;
          return content;
        },
      };

      const sink: EscalationSink = { record() {} };

      // Simulate two phase-boundary transitions
      await checkPhaseBoundaryDrift({
        ticketRef: "TICKET-4",
        baselineHash,
        sourceProvider: sp,
        escalationSink: sink,
      });
      await checkPhaseBoundaryDrift({
        ticketRef: "TICKET-4",
        baselineHash,
        sourceProvider: sp,
        escalationSink: sink,
      });

      assert.equal(
        callCount,
        2,
        "fetchContent called once per phase boundary, not only once total",
      );
    });
  });
});
