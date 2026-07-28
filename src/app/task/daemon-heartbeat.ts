// src/app/task/daemon-heartbeat.ts — EPIC 014 Story 3
// Pure helpers + an interval-bound writer for the daemon's heartbeat. The
// writer is the only thing that touches a clock, a scheduler, and the
// `beat` port; every other export here is a pure function over its input,
// so the use case and the composition root can be unit-tested with fakes.

/** Beat period. The default staleness threshold is 3× this value. */
export const HEARTBEAT_INTERVAL_MS = 2_000;

/** Staleness threshold, a fixed multiple of the period (see `resolveIntervalMs`). */
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS;

/**
 * Resolve `KANTHORD_HEARTBEAT_STALE_MS` (raw env-var form) to a positive
 * integer millisecond threshold. Falls back to `HEARTBEAT_STALE_MS` on any
 * non-positive-integer input — a defensive default so a typo never makes
 * the daemon report itself as alive forever (e.g. `0`) or always stopped
 * (e.g. a negative value).
 */
export function resolveStaleMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return HEARTBEAT_STALE_MS;
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) return HEARTBEAT_STALE_MS;
  return num;
}

/**
 * Derive the heartbeat interval from the staleness threshold. The contract
 * is: the interval is a strict divisor of the threshold (capped at
 * `HEARTBEAT_INTERVAL_MS`), and is never less than 1 ms — otherwise the
 * writer would busy-loop the daemon. `Math.floor(staleMs / 3)` is the
 * largest integer ≤ threshold/3.
 */
export function resolveIntervalMs(staleMs: number): number {
  const candidate = Math.floor(staleMs / 3);
  return Math.max(1, Math.min(HEARTBEAT_INTERVAL_MS, candidate));
}

/** Stable identity for one daemon process — pid + process start time. */
export function daemonInstanceId(pid: number, startedAtMs: number): string {
  return `${pid}:${startedAtMs}`;
}

/**
 * Milliseconds since the last beat. Clamped to zero so a non-monotonic
 * clock jump (or a beat that lands at `now` itself) never reports a
 * negative age.
 */
export function heartbeatAgeMs(nowMs: number, lastBeatMs: number): number {
  return Math.max(0, nowMs - lastBeatMs);
}

/** Minimal port the writer calls. Defined here, not in `storage/port.ts`,
 * because nothing in the storage layer depends on this seam — the writer
 * is the only caller, and the adapter wraps `node:sqlite`. */
export interface HeartbeatStore {
  beat(input: {
    instanceId: string;
    pid: number;
    startedAtMs: number;
    atMs: number;
  }): void;
}

/** Minimal scheduler seam — a `setTimeout`/`setInterval` shaper that
 * returns a cancel handle. The production binding is `setInterval` (the
 * dependency is wired in Story 6 — composition root + CLI daemon command). */
export interface HeartbeatScheduler {
  schedule(fn: () => void, ms: number): { cancel(): void };
}

/** Everything `startHeartbeat` needs. The use case assembles it from
 * the composition root; the unit tests assemble it from fakes. */
export interface HeartbeatDeps {
  store: HeartbeatStore;
  now: () => number;
  pid: number;
  startedAtMs: number;
  intervalMs: number;
  schedule: HeartbeatScheduler["schedule"];
}

/**
 * Start a heartbeat: write one beat immediately, then schedule a beat every
 * `deps.intervalMs` ms until `stop()` is called. `stop()` is idempotent —
 * the underlying cancel handle is invoked exactly once even if `stop()` is
 * called twice — so a caller that registers `stop` in two teardown paths
 * cannot crash the runtime.
 */
export function startHeartbeat(deps: HeartbeatDeps): () => void {
  const instanceId = daemonInstanceId(deps.pid, deps.startedAtMs);

  // Pre-schedule beat: written BEFORE the scheduler is invoked, so a reader
  // that arrives between schedule() and the first fire still sees one row.
  deps.store.beat({
    instanceId,
    pid: deps.pid,
    startedAtMs: deps.startedAtMs,
    atMs: deps.now(),
  });

  const handle = deps.schedule(() => {
    deps.store.beat({
      instanceId,
      pid: deps.pid,
      startedAtMs: deps.startedAtMs,
      atMs: deps.now(),
    });
  }, deps.intervalMs);

  let cancelled = false;
  return () => {
    if (cancelled) return;
    cancelled = true;
    handle.cancel();
  };
}
