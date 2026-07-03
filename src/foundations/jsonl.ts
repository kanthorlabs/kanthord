import { appendFile, readFile } from "node:fs/promises";

/**
 * Thrown by `JsonlLog.readAll()` when a line cannot be parsed as JSON.
 * `lineNumber` is the 1-based index of the corrupt line.
 */
export class JsonlParseError extends Error {
  lineNumber: number;

  constructor(lineNumber: number, cause: unknown) {
    const msg =
      cause instanceof Error ? cause.message : String(cause);
    super(`JSONL parse error at line ${lineNumber}: ${msg}`);
    this.name = "JsonlParseError";
    this.lineNumber = lineNumber;
  }
}

/**
 * Append-only JSONL log — one JSON object per line, newline-terminated.
 *
 * Phase 1 assumes the single daemon writer (PRD §6.1); no locking beyond
 * the OS open-for-append semantics is applied here.
 */
export class JsonlLog {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * Append one record as a JSON-encoded line followed by `\n`.
   * Creates the file on first write (open-for-append semantics).
   */
  async append(record: unknown): Promise<void> {
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.path, line, { encoding: "utf8" });
  }

  /**
   * Read all records in append order.
   * Splits on `\n`, drops the trailing empty element (every line is
   * `\n`-terminated), and parses each line as JSON.
   * Returns `[]` when the file does not exist yet (ENOENT).
   */
  async readAll(): Promise<unknown[]> {
    let text: string;
    try {
      text = await readFile(this.path, { encoding: "utf8" });
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "ENOENT"
      ) {
        return [];
      }
      throw err;
    }
    const lines = text.split("\n");
    // The file always ends with \n, so the last element after split is "".
    const dataLines = lines.slice(0, lines.length - 1);
    const records: unknown[] = [];
    for (const [i, line] of dataLines.entries()) {
      try {
        records.push(JSON.parse(line) as unknown);
      } catch (err) {
        throw new JsonlParseError(i + 1, err);
      }
    }
    return records;
  }
}
