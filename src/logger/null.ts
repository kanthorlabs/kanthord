import type { Logger } from "./port.ts";

export class NullLogger implements Logger {
  info(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
}
