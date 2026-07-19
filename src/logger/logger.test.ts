import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NullLogger } from "./null.ts";
import { StdoutLogger } from "./stdout.ts";

test("NullLogger.info does not throw and returns undefined", () => {
  const logger = new NullLogger();
  const result = logger.info("any message");
  assert.equal(result, undefined);
});

test("NullLogger.warn does not throw and returns undefined", () => {
  const logger = new NullLogger();
  const result = logger.warn("any warning");
  assert.equal(result, undefined);
});

test("NullLogger.error does not throw and returns undefined", () => {
  const logger = new NullLogger();
  const result = logger.error("any error");
  assert.equal(result, undefined);
});

test("StdoutLogger.info calls process.stdout.write with message + newline", () => {
  const writes: string[] = [];
  const spy = mock.method(process.stdout, "write", (chunk: string) => {
    writes.push(chunk);
    return true;
  });
  try {
    const logger = new StdoutLogger();
    logger.info("hello");
    assert.ok(
      writes.some((w) => w === "hello\n"),
      `expected process.stdout.write to receive "hello\\n"; got ${JSON.stringify(writes)}`,
    );
  } finally {
    spy.mock.restore();
  }
});

test("StdoutLogger.warn calls process.stderr.write with [warn] prefix", () => {
  const writes: string[] = [];
  const spy = mock.method(process.stderr, "write", (chunk: string) => {
    writes.push(chunk);
    return true;
  });
  try {
    const logger = new StdoutLogger();
    logger.warn("something fishy");
    assert.ok(
      writes.some((w) => w === "[warn] something fishy\n"),
      `expected "[warn] something fishy\\n"; got ${JSON.stringify(writes)}`,
    );
  } finally {
    spy.mock.restore();
  }
});

test("StdoutLogger.error calls process.stderr.write with [error] prefix", () => {
  const writes: string[] = [];
  const spy = mock.method(process.stderr, "write", (chunk: string) => {
    writes.push(chunk);
    return true;
  });
  try {
    const logger = new StdoutLogger();
    logger.error("something broke");
    assert.ok(
      writes.some((w) => w === "[error] something broke\n"),
      `expected "[error] something broke\\n"; got ${JSON.stringify(writes)}`,
    );
  } finally {
    spy.mock.restore();
  }
});
