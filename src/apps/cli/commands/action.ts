export interface CliResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  setExitCode(code: number): void;
}

export const processIo: CliIo = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

/** The single action adapter: writes a handler result via the injected io. */
export function emitResult(result: CliResult, io: CliIo): void {
  for (const line of result.stdout) io.out(line + "\n");
  for (const line of result.stderr) io.err(line + "\n");
  io.setExitCode(result.exitCode);
}
