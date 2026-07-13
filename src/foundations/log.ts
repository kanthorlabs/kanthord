/**
 * src/foundations/log — shared structured logger for leaf modules.
 *
 * Low-level primitives (store, git, slots, compiler) have no injected `Logger`
 * (that seam only exists on the daemon/CLI deps). This shared sink lets those
 * modules leave a breadcrumb for a caught-but-nonfatal error instead of
 * swallowing it silently (see AGENTS.md "Debugging and error handling").
 *
 * Backed by `pino` (the ecosystem's hardened structured logger); this module is
 * only a thin wrapper that fixes our conventions: an `event` attribute on every
 * line and a caught-error normalizer. Level comes from `KANTHORD_LOG_LEVEL`
 * (default `warn`) — so `debug` breadcrumbs stay quiet in normal runs and tests
 * but are available for investigation via `KANTHORD_LOG_LEVEL=debug`, while
 * `warn` is visible by default.
 */

import { pino } from "pino";
import type { Logger as PinoLogger, LoggerOptions, DestinationStream } from "pino";

/** Normalize an unknown caught value to a short message string for logging. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Convenience logger: each call records a named `event` plus optional fields. */
export interface LeafLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): LeafLogger;
}

function wrap(p: PinoLogger): LeafLogger {
  return {
    debug: (event, fields): void => p.debug({ event, ...fields }),
    info: (event, fields): void => p.info({ event, ...fields }),
    warn: (event, fields): void => p.warn({ event, ...fields }),
    error: (event, fields): void => p.error({ event, ...fields }),
    child: (bindings): LeafLogger => wrap(p.child(bindings)),
  };
}

/**
 * Build a `LeafLogger`. `dest` is injectable (tests capture output); when
 * omitted, pino writes JSON lines to stdout. Level precedence:
 * explicit `opts.level` → `KANTHORD_LOG_LEVEL` → `warn`.
 */
export function createLogger(opts?: LoggerOptions, dest?: DestinationStream): LeafLogger {
  const level = opts?.level ?? process.env["KANTHORD_LOG_LEVEL"] ?? "warn";
  const options: LoggerOptions = { ...opts, level };
  return wrap(dest !== undefined ? pino(options, dest) : pino(options));
}

/** Process-wide leaf logger. Use `warn` for anomalies, `debug` for breadcrumbs. */
export const log: LeafLogger = createLogger();

/**
 * A pino-backed logger matching the injected `Logger` seam (`info(record)`),
 * for daemon/CLI operational events that already carry an `event` field in the
 * record. Defaults to the `info` level (operational logs are visible by
 * default), still overridable via `KANTHORD_LOG_LEVEL`.
 */
export interface RecordLogger {
  info(record: Record<string, unknown>): void;
  warn(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

export function createRecordLogger(opts?: LoggerOptions, dest?: DestinationStream): RecordLogger {
  const level = opts?.level ?? process.env["KANTHORD_LOG_LEVEL"] ?? "info";
  const options: LoggerOptions = { ...opts, level };
  const p = dest !== undefined ? pino(options, dest) : pino(options);
  return {
    info: (record): void => p.info(record),
    warn: (record): void => p.warn(record),
    error: (record): void => p.error(record),
  };
}
