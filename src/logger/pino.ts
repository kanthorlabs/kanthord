import pino from "pino";
import type { DestinationStream, Logger as Pino } from "pino";

import type { Logger } from "./port.ts";

/** JSON-line logger for the HTTP app. `base: undefined` drops pid/hostname. */
export class PinoLogger implements Logger {
  readonly #log: Pino;

  constructor(stream?: DestinationStream) {
    this.#log = pino({ base: undefined }, stream ?? process.stdout);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.#log.info(fields ?? {}, message);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.#log.warn(fields ?? {}, message);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.#log.error(fields ?? {}, message);
  }
}
