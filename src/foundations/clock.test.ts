import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "./clock.ts";

describe("src/foundations/clock.ts", () => {
  describe("FakeClock — now and advance", () => {
    it("returns the start instant from now() before any advance", () => {
      const START = 1_000_000;
      const clock = new FakeClock(START);
      assert.strictEqual(clock.now(), START);
    });

    it("advances now() by exactly the given milliseconds", () => {
      const START = 1_000_000;
      const clock = new FakeClock(START);
      clock.advance(1000);
      assert.strictEqual(clock.now(), START + 1000);
    });
  });

  describe("FakeClock — deterministic timer scheduling", () => {
    it("fires only due timers in non-decreasing due-time order on advance", () => {
      const clock = new FakeClock(0);
      const fired: number[] = [];

      clock.setTimer(300, () => fired.push(300));
      clock.setTimer(100, () => fired.push(100));
      clock.setTimer(200, () => fired.push(200));

      clock.advance(250);

      // Only timers with delay <= 250 should have fired, in due-time order
      assert.deepStrictEqual(fired, [100, 200]);

      clock.advance(100);

      // After total 350ms, the 300ms timer fires
      assert.deepStrictEqual(fired, [100, 200, 300]);
    });

    it("breaks ties in scheduling order when two timers share the same delay", () => {
      const clock = new FakeClock(0);
      const fired: number[] = [];

      clock.setTimer(100, () => fired.push(1));
      clock.setTimer(100, () => fired.push(2));

      clock.advance(100);

      // Both timers are due; they must fire in insertion order
      assert.deepStrictEqual(fired, [1, 2]);
    });
  });
});
