/**
 * The structured logger the HTTP app needs. Declared here, not imported from
 * src/logger/port.ts, because eslint `boundaries` forbids apps/ -> an adapter
 * port. `PinoLogger` (src/logger/pino.ts) satisfies both this and the port.
 */
export interface HttpLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
