import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { CliDeps } from "../deps.ts";
import type { HttpLogger } from "../../http/logger.ts";
import { runCli } from "./run-cli.ts";

interface RecordedLine {
  message: string;
  fields?: Record<string, unknown>;
}

function makeFakeHttpLogger(): { logger: HttpLogger; lines: RecordedLine[] } {
  const lines: RecordedLine[] = [];
  const logger: HttpLogger = {
    info: (message, fields) => {
      lines.push({ message, ...(fields ? { fields } : {}) });
    },
    warn: (message, fields) => {
      lines.push({ message, ...(fields ? { fields } : {}) });
    },
    error: (message, fields) => {
      lines.push({ message, ...(fields ? { fields } : {}) });
    },
  };
  return { logger, lines };
}

function withApiKey<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const before = process.env["API_KEY"];
  if (value === undefined) delete process.env["API_KEY"];
  else process.env["API_KEY"] = value;
  return run().finally(() => {
    if (before === undefined) delete process.env["API_KEY"];
    else process.env["API_KEY"] = before;
  });
}

describe("src/apps/cli/commands/serve.ts", () => {
  test("missing API_KEY exits 1, names API_KEY, logs no listening line", async () => {
    const { logger, lines } = makeFakeHttpLogger();
    const deps = { httpLogger: logger } as unknown as CliDeps;
    await withApiKey(undefined, async () => {
      const result = await runCli(["serve"], deps);
      assert.equal(result.exitCode, 1);
      assert.ok(
        result.stderr.some((line) => line.includes("API_KEY")),
        "stderr must name API_KEY",
      );
      assert.ok(
        !lines.some((line) => line.message === "listening"),
        "no listening line must be recorded",
      );
    });
  });

  test("a 15-character API_KEY exits 1 naming API_KEY", async () => {
    const deps = {
      httpLogger: makeFakeHttpLogger().logger,
    } as unknown as CliDeps;
    await withApiKey("a".repeat(15), async () => {
      const result = await runCli(["serve"], deps);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.some((line) => line.includes("API_KEY")));
    });
  });

  test("valid API_KEY with an invalid --port exits 1 naming --port", async () => {
    const deps = {
      httpLogger: makeFakeHttpLogger().logger,
    } as unknown as CliDeps;
    await withApiKey("a".repeat(16), async () => {
      const result = await runCli(["serve", "--port", "abc"], deps);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.some((line) => line.includes("--port")));
    });
  });

  test("valid API_KEY with --port 0 starts the server, logs listening, answers /healthz, and shuts down cleanly", async () => {
    const { logger, lines } = makeFakeHttpLogger();
    const deps = { httpLogger: logger } as unknown as CliDeps;
    const apiKey = "a".repeat(16);

    const beforeTerm = process.listeners("SIGTERM");
    const beforeInt = process.listeners("SIGINT");

    await withApiKey(apiKey, async () => {
      const result = await runCli(["serve", "--port", "0"], deps);
      assert.equal(result.exitCode, 0);

      const listeningLine = lines.find((line) => line.message === "listening");
      assert.ok(listeningLine, "expected a listening line to be recorded");
      const port = listeningLine!.fields?.["port"];
      assert.equal(typeof port, "number");

      const auth = "Basic " + Buffer.from(`x:${apiKey}`).toString("base64");
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { Authorization: auth },
      });
      assert.equal(res.status, 200);

      const addedTerm = process
        .listeners("SIGTERM")
        .filter((l) => !beforeTerm.includes(l));
      const addedInt = process
        .listeners("SIGINT")
        .filter((l) => !beforeInt.includes(l));
      assert.equal(
        addedTerm.length,
        1,
        "expected exactly one added SIGTERM listener",
      );
      assert.equal(
        addedInt.length,
        1,
        "expected exactly one added SIGINT listener",
      );

      try {
        (addedTerm[0] as () => void)();
      } finally {
        process.off("SIGTERM", addedTerm[0] as never);
        process.off("SIGINT", addedInt[0] as never);
      }

      await assert.rejects(
        fetch(`http://127.0.0.1:${port}/healthz`, {
          headers: { Authorization: auth },
        }),
      );
    });
  });
});
