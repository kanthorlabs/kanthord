import { readFile } from "node:fs/promises";

export class CredentialReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Credential read timed out after ${timeoutMs}ms`);
    this.name = "CredentialReadTimeoutError";
  }
}

export class EmptyCredentialError extends Error {
  constructor() {
    super("Credential value must not be empty");
    this.name = "EmptyCredentialError";
  }
}

function stripTrailingNewline(buf: Buffer): string {
  let str = buf.toString("utf8");
  if (str.endsWith("\r\n")) {
    str = str.slice(0, -2);
  } else if (str.endsWith("\n")) {
    str = str.slice(0, -1);
  }
  return str;
}

function readFromStream(
  stream: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CredentialReadTimeoutError(timeoutMs));
    }, timeoutMs);

    stream.on("data", (chunk: Buffer | string) => {
      if (!settled) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    });

    stream.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const value = stripTrailingNewline(buf);
      if (value === "") {
        reject(new EmptyCredentialError());
      } else {
        resolve(value);
      }
    });

    stream.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function readCredentialValue(opts: {
  valuefile?: string;
  tty?: NodeJS.ReadStream;
  timeoutMs: number;
  signal?: AbortSignal;
  stdin?: NodeJS.ReadableStream;
}): Promise<string> {
  const { valuefile, tty, timeoutMs, stdin } = opts;

  if (valuefile === "-") {
    const source = stdin ?? (process.stdin as NodeJS.ReadableStream);
    return readFromStream(source, timeoutMs);
  }

  if (valuefile !== undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CredentialReadTimeoutError(timeoutMs)),
        timeoutMs,
      );
    });
    try {
      const buf = await Promise.race([readFile(valuefile), timeoutPromise]);
      const value = stripTrailingNewline(buf);
      if (value === "") {
        throw new EmptyCredentialError();
      }
      return value;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  if (tty !== undefined) {
    try {
      tty.setRawMode(true);
      return await readFromStream(tty, timeoutMs);
    } finally {
      tty.setRawMode(false);
    }
  }

  throw new Error("No credential source provided; use --value-file or a TTY");
}
