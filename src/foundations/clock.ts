/**
 * Clock — injectable time seam (PRD §7.7).
 *
 * Every time-dependent component depends on this interface; the real runtime
 * can inject `SystemClock` while tests inject `FakeClock`.
 */
export interface Clock {
  /** Returns the current millisecond epoch instant. */
  now(): number;
  /**
   * Schedule `cb` to fire once the clock has advanced by at least `delayMs`
   * milliseconds from the moment of scheduling. Fires deterministically inside
   * `advance()` — no real event-loop timers are used.
   */
  setTimer(delayMs: number, cb: () => void): void;
}

/** Internal timer entry stored by FakeClock. */
type TimerEntry = { dueMs: number; seq: number; cb: () => void };

/**
 * FakeClock — deterministic test double that never touches the real wall clock.
 *
 * Starts at `startMs` and advances only when `advance()` is called explicitly.
 * Timers scheduled via `setTimer` fire inside `advance` once their due time is
 * reached, in non-decreasing due-time order (insertion order breaks ties).
 */
export class FakeClock implements Clock {
  private currentMs: number;
  private pending: TimerEntry[] = [];
  private nextSeq = 0;

  constructor(startMs: number) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimer(delayMs: number, cb: () => void): void {
    this.pending.push({ dueMs: this.currentMs + delayMs, seq: this.nextSeq++, cb });
  }

  /** Move the internal instant forward by exactly `ms` milliseconds. */
  advance(ms: number): void {
    this.currentMs += ms;
    const due = this.pending
      .filter(t => t.dueMs <= this.currentMs)
      .sort((a, b) => a.dueMs - b.dueMs || a.seq - b.seq);
    this.pending = this.pending.filter(t => t.dueMs > this.currentMs);
    for (const t of due) {
      t.cb();
    }
  }
}
