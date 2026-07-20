import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, PassThrough } from "node:stream";
import {
  readCredentialValue,
  CredentialReadTimeoutError,
  EmptyCredentialError,
} from "./credential-input.ts";

// -------------------------------------------------------------------------
// Story 02 T1 — readCredentialValue: valuefile path + timeout + newline contract
// -------------------------------------------------------------------------

describe("src/apps/cli/credential-input.ts", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "cred-input-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (a) trailing LF is stripped and the read timeout is cleared
  test("readCredentialValue valuefile: clears the read timeout after success", async (t) => {
    const f = join(tmpDir, "a.txt");
    await writeFile(f, "sk-abc\n");
    const originalClearTimeout = globalThis.clearTimeout;
    const clearTimeout = t.mock.method(
      globalThis,
      "clearTimeout",
      originalClearTimeout,
    );
    const result = await readCredentialValue({ valuefile: f, timeoutMs: 1000 });
    assert.equal(result, "sk-abc");
    assert.equal(clearTimeout.mock.callCount(), 1);
  });

  // (b) trailing CRLF is stripped
  test("readCredentialValue valuefile: trailing CRLF is stripped", async () => {
    const f = join(tmpDir, "b.txt");
    await writeFile(f, "sk-abc\r\n");
    const result = await readCredentialValue({ valuefile: f, timeoutMs: 5000 });
    assert.equal(result, "sk-abc");
  });

  // (c) file contains only newline → EmptyCredentialError
  test("readCredentialValue valuefile: file with only LF throws EmptyCredentialError", async () => {
    const f = join(tmpDir, "c.txt");
    await writeFile(f, "\n");
    await assert.rejects(
      () => readCredentialValue({ valuefile: f, timeoutMs: 5000 }),
      (err: unknown) => {
        assert.ok(
          err instanceof EmptyCredentialError,
          `expected EmptyCredentialError, got ${String(err)}`,
        );
        return true;
      },
    );
  });

  // (d) empty file → EmptyCredentialError
  test("readCredentialValue valuefile: empty file throws EmptyCredentialError", async () => {
    const f = join(tmpDir, "d.txt");
    await writeFile(f, "");
    await assert.rejects(
      () => readCredentialValue({ valuefile: f, timeoutMs: 5000 }),
      (err: unknown) => {
        assert.ok(
          err instanceof EmptyCredentialError,
          `expected EmptyCredentialError, got ${String(err)}`,
        );
        return true;
      },
    );
  });

  // (e) internal newline is preserved; only ONE trailing LF stripped
  test("readCredentialValue valuefile: internal newline preserved, only trailing LF stripped", async () => {
    const f = join(tmpDir, "e.txt");
    await writeFile(f, "sk\nabc");
    const result = await readCredentialValue({ valuefile: f, timeoutMs: 5000 });
    assert.equal(result, "sk\nabc");
  });

  // (f) valuefile "-" with injected stdin Readable → reads to EOF
  test('readCredentialValue valuefile "-": reads from injected stdin Readable and returns value', async () => {
    const readable = Readable.from(["sk-from-stdin"]);
    const result = await readCredentialValue({
      valuefile: "-",
      stdin: readable,
      timeoutMs: 5000,
    });
    assert.equal(result, "sk-from-stdin");
  });

  // (g) valuefile "-" with a Readable that never emits + short timeout → CredentialReadTimeoutError
  test('readCredentialValue valuefile "-": timeout throws CredentialReadTimeoutError with duration in message', async () => {
    const neverEmits = new Readable({
      read() {
        // intentionally never pushes data or EOF
      },
    });
    await assert.rejects(
      () =>
        readCredentialValue({
          valuefile: "-",
          stdin: neverEmits,
          timeoutMs: 50,
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof CredentialReadTimeoutError,
          `expected CredentialReadTimeoutError, got ${String(err)}`,
        );
        assert.ok(
          err.message.includes("50"),
          `expected timeout duration (50) in error message; got: ${err.message}`,
        );
        return true;
      },
    );
  });

  // -------------------------------------------------------------------------
  // Story 02 T2 — hidden TTY reader (raw mode, restore in finally)
  // -------------------------------------------------------------------------

  // Helper: build a mock TTY stream (PassThrough + isTTY + setRawMode stub)
  function makeMockTty() {
    const pt = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
      setRawModeCalls: boolean[];
    };
    pt.isTTY = true;
    const setRawModeCalls: boolean[] = [];
    pt.setRawModeCalls = setRawModeCalls;
    pt.setRawMode = (mode: boolean) => {
      setRawModeCalls.push(mode);
    };
    return pt;
  }

  // (a) tty emits "sk-tty\n" then ends → resolves with "sk-tty"
  test("readCredentialValue tty: resolves with value when mock TTY emits data and ends", async () => {
    const mockTty = makeMockTty();
    const resultPromise = readCredentialValue({
      tty: mockTty as unknown as NodeJS.ReadStream,
      timeoutMs: 5000,
    });
    // Emit data then end the mock stream
    mockTty.push("sk-tty\n");
    mockTty.push(null); // EOF
    const result = await resultPromise;
    assert.equal(result, "sk-tty");
  });

  // (b) setRawMode throws → rejection propagates, setRawMode(false) still called (restore-in-finally)
  test("readCredentialValue tty: setRawMode(false) is called in finally even when setRawMode(true) throws", async () => {
    const pt = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
      setRawModeCalls: boolean[];
    };
    pt.isTTY = true;
    const setRawModeCalls: boolean[] = [];
    pt.setRawModeCalls = setRawModeCalls;
    let callCount = 0;
    pt.setRawMode = (mode: boolean) => {
      callCount++;
      setRawModeCalls.push(mode);
      if (mode === true) {
        throw new Error("setRawMode failed intentionally");
      }
    };

    await assert.rejects(
      () =>
        readCredentialValue({
          tty: pt as unknown as NodeJS.ReadStream,
          timeoutMs: 5000,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          (err as Error).message.includes("setRawMode failed"),
          `unexpected error: ${(err as Error).message}`,
        );
        return true;
      },
    );
    // setRawMode(false) must have been called in the finally block
    assert.ok(
      setRawModeCalls.includes(false),
      `setRawMode(false) must be called in finally; calls: ${JSON.stringify(setRawModeCalls)}`,
    );
  });

  // (c) tty path also respects timeout
  test("readCredentialValue tty: timeout throws CredentialReadTimeoutError when tty never emits", async () => {
    const mockTty = makeMockTty();
    // Never push data, so the promise will time out
    await assert.rejects(
      () =>
        readCredentialValue({
          tty: mockTty as unknown as NodeJS.ReadStream,
          timeoutMs: 50,
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof CredentialReadTimeoutError,
          `expected CredentialReadTimeoutError, got ${String(err)}`,
        );
        assert.ok(
          err.message.includes("50"),
          `expected timeout duration (50) in message; got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
