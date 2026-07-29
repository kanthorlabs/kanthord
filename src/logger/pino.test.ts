import { test } from "node:test";
import assert from "node:assert/strict";
import type { DestinationStream } from "pino";

import { PinoLogger } from "./pino.ts";
import type { HttpLogger } from "../apps/http/logger.ts";

function buildStream(lines: string[]): DestinationStream {
  return {
    write: (s: string) => {
      lines.push(s);
      return true;
    },
  } as DestinationStream;
}

test("PinoLogger.info writes one JSON line with msg, fields, level 30, no pid/hostname", () => {
  const lines: string[] = [];
  const logger = new PinoLogger(buildStream(lines));
  logger.info("listening", { port: 4100 });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(parsed.msg, "listening");
  assert.equal(parsed.port, 4100);
  assert.equal(parsed.level, 30);
  assert.equal("pid" in parsed, false);
  assert.equal("hostname" in parsed, false);
});

test("PinoLogger.warn writes level 40", () => {
  const lines: string[] = [];
  const logger = new PinoLogger(buildStream(lines));
  logger.warn("careful", { reason: "x" });
  const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(parsed.level, 40);
  assert.equal(parsed.msg, "careful");
});

test("PinoLogger.error writes level 50", () => {
  const lines: string[] = [];
  const logger = new PinoLogger(buildStream(lines));
  logger.error("broke", { code: "boom" });
  const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(parsed.level, 50);
  assert.equal(parsed.msg, "broke");
});

test("PinoLogger.info with no fields still parses and carries the message", () => {
  const lines: string[] = [];
  const logger = new PinoLogger(buildStream(lines));
  logger.info("plain");
  const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(parsed.msg, "plain");
});

test("PinoLogger structurally satisfies HttpLogger", () => {
  const lines: string[] = [];
  const stream = buildStream(lines);
  const asHttp: HttpLogger = new PinoLogger(stream);
  assert.ok(asHttp);
});
