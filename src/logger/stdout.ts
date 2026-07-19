import type { Logger } from "./port.ts";

export class StdoutLogger implements Logger {
  info(message: string): void {
    process.stdout.write(message + "\n");
  }

  warn(message: string): void {
    process.stderr.write("[warn] " + message + "\n");
  }

  error(message: string): void {
    process.stderr.write("[error] " + message + "\n");
  }
}
