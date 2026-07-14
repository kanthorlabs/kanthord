/**
 * src/cli/verify.test.ts
 *
 * Story 018-002 Task T1 — RED tests for the verify CLI entrypoint.
 *
 * Tests drive the CLI's exported `main(args, deps)` with injected seams:
 * (a) clean run ⇒ exit 0 + "0 divergences" in output
 * (b) divergent run ⇒ exit 1 + each divergence entity/field/live/shadow printed
 * (c) missing --read-only or missing --from-markdown ⇒ usage error (exit != 0)
 * (d) contract-version mismatch from engine ⇒ exit 2
 * (e) zero writes recorded on live store and git store seams during a full run
 * (f) runs while a writer lock is held by another process (no lock acquisition)
 * (g) B1: top-level entrypoint is runnable via `node src/cli/verify.ts`
 * (h) B4: verify open path does not acquire the daemon writer lock
 * (i) B1-read-only: real CLI must not create/write tables in the live DB
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { Store } from "../foundations/sqlite-store.ts";
import type { VerifyReport, VerifyDivergence, ContractVersionMismatchError } from "../verify/engine.ts";
import { WriterLock } from "../store/writer-lock.ts";
import { GitStore } from "../store/git-store.ts";

// ---------------------------------------------------------------------------
// Seam types — the CLI must accept these via its Deps injection point
// ---------------------------------------------------------------------------

/**
 * The CLI must export a `main` function with this signature.
 * All I/O is injected to keep tests hermetic.
 */

type RunVerifyFn = (
  featureDir: string,
  live: Store,
  opts: object,
  ledgerSources?: Array<{ storyId: string; taskStem: string }>,
) => Promise<VerifyReport>;

type WritableOutput = { write(chunk: string): void };

type CliDeps = {
  /** Engine function — injectable for test doubles. */
  runVerify: RunVerifyFn;
  /** Live store factory: must open the DB read-only. */
  openLiveStore: (dbPath: string) => Store;
  /** Store root factory: must open the git store read-only (no writer lock). */
  openStoreRoot: (storeRoot: string) => { close(): void };
  /**
   * Discovers ledger source locators from the store root directory.
   * Returns a list of { storyId, taskStem } for every task journal present.
   * When absent from deps, defaults to returning [].
   */
  discoverLedgerSources?: (storeRoot: string) => Promise<Array<{ storyId: string; taskStem: string }>>;
  /** Output sink (defaults to process.stdout). */
  stdout: WritableOutput;
  /** Error sink (defaults to process.stderr). */
  stderr: WritableOutput;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal write-counting Store seam — counts calls to run(). */
function makeWriteCountingStore(data: Record<string, unknown[][]> = {}): Store & { writeCount: number } {
  let writeCount = 0;
  const store = {
    get writeCount() { return writeCount; },
    get<T>(sql: string, ...params: unknown[]): T | undefined {
      const key = sql.trim().substring(0, 40);
      const rows = data[key];
      if (rows && rows.length > 0) return rows[0] as unknown as T;
      return undefined;
    },
    run(_sql: string, ..._params: unknown[]): void {
      writeCount++;
    },
    all<T>(sql: string, ..._params: unknown[]): T[] {
      const key = sql.trim().substring(0, 40);
      const rows = data[key];
      return (rows ?? []) as unknown as T[];
    },
    close(): void {},
  };
  return store;
}

function makeOutput(): { write(chunk: string): void; value: string } {
  let value = "";
  return {
    get value() { return value; },
    write(chunk: string) { value += chunk; },
  };
}

/** Contract version mismatch error factory. */
function makeMismatchError(liveVersion: string, engineVersion: string): ContractVersionMismatchError {
  return Object.assign(
    new Error(`Contract version mismatch: live='${liveVersion}', engine='${engineVersion}'`),
    {
      code: "contract-version-mismatch" as const,
      liveVersion,
      engineVersion,
    },
  );
}

// ---------------------------------------------------------------------------
// The import under test — will fail RED until src/cli/verify.ts exists.
// ---------------------------------------------------------------------------

import { main } from "./verify.ts";

// ---------------------------------------------------------------------------
// Suite (a) — clean run exits 0 and prints "0 divergences"
// ---------------------------------------------------------------------------

describe("src/cli/verify — clean run exits 0", () => {
  test("clean engine report ⇒ exit code 0", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.equal(exitCode, 0, "exit code must be 0 for a clean run");
  });

  test("clean engine report ⇒ output contains '0 divergences'", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(
      stdout.value.includes("0 divergences") || stdout.value.includes("0 divergence"),
      `stdout must include divergence count; got: ${JSON.stringify(stdout.value)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (b) — divergent run exits 1 and prints each divergence
// ---------------------------------------------------------------------------

describe("src/cli/verify — divergent run exits 1", () => {
  const DIVERGENCES: VerifyDivergence[] = [
    {
      table: "plan_node",
      field: "ticket_ref",
      live: "LIVE-VAL",
      shadow: "SHADOW-VAL",
      rowIdentity: { id: "task-018-alpha" },
    },
  ];

  test("divergent engine report ⇒ exit code 1", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: DIVERGENCES }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.equal(exitCode, 1, "exit code must be 1 for a divergent run");
  });

  test("divergent run prints field name in output", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: DIVERGENCES }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(
      stdout.value.includes("ticket_ref"),
      `stdout must include field name 'ticket_ref'; got: ${JSON.stringify(stdout.value)}`,
    );
  });

  test("divergent run prints live value and shadow value in output", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: DIVERGENCES }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(
      stdout.value.includes("LIVE-VAL"),
      `stdout must include live value; got: ${JSON.stringify(stdout.value)}`,
    );
    assert.ok(
      stdout.value.includes("SHADOW-VAL"),
      `stdout must include shadow value; got: ${JSON.stringify(stdout.value)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (c) — missing required flags ⇒ usage error (non-zero exit)
// ---------------------------------------------------------------------------

describe("src/cli/verify — missing required flags", () => {
  test("missing --read-only ⇒ non-zero exit code", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--from-markdown", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.notEqual(exitCode, 0, "exit code must be non-zero when --read-only is absent");
  });

  test("missing --from-markdown ⇒ non-zero exit code", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.notEqual(exitCode, 0, "exit code must be non-zero when --from-markdown is absent");
  });

  test("missing --store ⇒ usage exit 3, names --store, and opens neither store", async () => {
    const stdout = makeOutput();
    const stderr = makeOutput();
    let openStoreRootCalls = 0;
    let openLiveStoreCalls = 0;

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => {
        openLiveStoreCalls++;
        return makeWriteCountingStore();
      },
      openStoreRoot: () => {
        openStoreRootCalls++;
        return { close() {} };
      },
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--from-markdown", "--read-only", "--db", "/tmp/live.db"],
      deps,
    );

    assert.equal(exitCode, 3, "missing --store must be a usage error");
    assert.match(stderr.value, /--store/, "usage output must name the missing --store option");
    assert.equal(openStoreRootCalls, 0, "missing --store must not open the store root");
    assert.equal(openLiveStoreCalls, 0, "missing --store must not open the live store");
  });

  test("missing --db ⇒ usage exit 3, names --db, and opens neither store", async () => {
    const stdout = makeOutput();
    const stderr = makeOutput();
    let openStoreRootCalls = 0;
    let openLiveStoreCalls = 0;

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => {
        openLiveStoreCalls++;
        return makeWriteCountingStore();
      },
      openStoreRoot: () => {
        openStoreRootCalls++;
        return { close() {} };
      },
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store"],
      deps,
    );

    assert.equal(exitCode, 3, "missing --db must be a usage error");
    assert.match(stderr.value, /--db/, "usage output must name the missing --db option");
    assert.equal(openStoreRootCalls, 0, "missing --db must not open the store root");
    assert.equal(openLiveStoreCalls, 0, "missing --db must not open the live store");
  });
});

// ---------------------------------------------------------------------------
// Suite (d) — contract-version mismatch from engine ⇒ exit 2
// ---------------------------------------------------------------------------

describe("src/cli/verify — contract-version mismatch exits 2", () => {
  test("engine throws ContractVersionMismatchError ⇒ exit code 2", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => {
        throw makeMismatchError("stale-version-0", "2");
      },
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    const exitCode = await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.equal(exitCode, 2, "exit code must be 2 for a contract-version mismatch");
  });

  test("contract mismatch output names both live and engine versions", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    const deps: CliDeps = {
      runVerify: async () => {
        throw makeMismatchError("stale-version-0", "2");
      },
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    const combined = stdout.value + stderr.value;
    assert.ok(
      combined.includes("stale-version-0"),
      `output must name live version 'stale-version-0'; got: ${JSON.stringify(combined)}`,
    );
    assert.ok(
      combined.includes("2"),
      `output must name engine version '2'; got: ${JSON.stringify(combined)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (e) — zero writes against live store during a full (divergent) run
// ---------------------------------------------------------------------------

describe("src/cli/verify — zero writes on live store", () => {
  test("write-counting live store records zero writes during a divergent run", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();

    // Engine returns divergences but the real live store must not be written
    const deps: CliDeps = {
      runVerify: async (_featureDir, live) => {
        // Confirm the CLI wires the write-counting store as the live seam
        assert.equal(live, liveStore, "CLI must pass the injected live store to runVerify");
        return {
          divergences: [
            {
              table: "plan_node",
              field: "status",
              live: "LIVE",
              shadow: "SHADOW",
              rowIdentity: { id: "task-e" },
            },
          ],
        };
      },
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout,
      stderr,
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.equal(
      liveStore.writeCount,
      0,
      `live store must record zero writes; got ${liveStore.writeCount}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (f) — runs while a writer lock is held (no lock acquisition by verify)
// ---------------------------------------------------------------------------

describe("src/cli/verify — no writer lock acquisition", () => {
  test("openStoreRoot is invoked without acquiring a writer lock (readOnly seam)", async () => {
    const liveStore = makeWriteCountingStore();
    const stdout = makeOutput();
    const stderr = makeOutput();
    let storeRootOpenedReadOnly = false;

    // openStoreRoot is the seam — verify must call it; the seam records the call
    // but does NOT acquire any writer lock (simulating read-only mode)
    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => liveStore,
      openStoreRoot: (_storeRoot: string) => {
        storeRootOpenedReadOnly = true;
        return { close() {} };
      },
      stdout,
      stderr,
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(
      storeRootOpenedReadOnly,
      "openStoreRoot must be called — verify must use the injected read-only store-root seam",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (g) — B1: top-level entrypoint is runnable via `node src/cli/verify.ts`
//
// Without a top-level invocation in verify.ts, `node src/cli/verify.ts` exits 0
// with no output. The test below spawns the script with no flags and asserts the
// process exits non-zero (usage error), proving the top-level entry runs main().
// ---------------------------------------------------------------------------

describe("src/cli/verify — B1 top-level entrypoint", () => {
  test("running `node src/cli/verify.ts` with no flags exits non-zero (usage error)", () => {
    // Spawn the script directly — no injected seams; this exercises the real
    // top-level entry point that must call main(process.argv.slice(2), realDeps).
    const result = spawnSync(
      process.execPath,
      ["src/cli/verify.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    // If the script has no top-level invocation, it exits 0 silently.
    // With a real top-level main() call, missing --from-markdown and --read-only
    // must produce a usage error (exit code != 0) and print to stderr.
    assert.notEqual(
      result.status,
      0,
      `node src/cli/verify.ts with no flags must exit non-zero (usage error); got exit ${result.status}, stderr: ${JSON.stringify(result.stderr)}, stdout: ${JSON.stringify(result.stdout)}`,
    );
  });

  test("running `node src/cli/verify.ts` with no flags prints usage to stderr", () => {
    const result = spawnSync(
      process.execPath,
      ["src/cli/verify.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    // The usage message must appear on stderr (or stdout) — any indication
    // that the top-level entry ran and validated the missing flags.
    const combined = (result.stdout ?? "") + (result.stderr ?? "");
    assert.ok(
      combined.length > 0,
      "node src/cli/verify.ts with no flags must produce output (usage message); got no output",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (h) — B4: real lock-held proof that verify/open path does not acquire
// the daemon writer lock.
//
// This test holds a real WriterLock in write mode, then opens a GitStore with
// { readOnly: true } — the real implementation of `openStoreRoot`. The open
// must succeed without throwing StoreLocked.
// ---------------------------------------------------------------------------

describe("src/cli/verify — B4 real lock-held open does not throw StoreLocked", () => {
  test("GitStore readOnly open succeeds while a WriterLock is held in write mode", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "kanthord-018-b4-"));
    const writerLock = new WriterLock(tmpDir);
    let token: string | null = null;
    try {
      // Acquire the writer lock (simulating the daemon holding it).
      token = await writerLock.acquire();

      // Now open the same directory read-only (simulating verify's openStoreRoot).
      // Must NOT throw StoreLocked — the readOnly path must bypass the lock entirely.
      const reader = new GitStore(tmpDir, { readOnly: true });
      await assert.doesNotReject(
        () => reader.open(),
        "GitStore({ readOnly: true }).open() must succeed while the write-mode WriterLock is held",
      );
    } finally {
      if (token !== null) {
        await writerLock.release(token);
      }
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite (i) — B1 read-only proof: real CLI must NOT create or write tables in
// the live DB file.
//
// The real `openLiveStore` in `realDeps` currently uses `openStore(dbPath, ...)`
// which runs WAL PRAGMA and creates a `schema_version` table. A true read-only
// open must leave the DB file entirely unchanged.
//
// Test: create an empty SQLite DB file, spawn the real CLI with that path as
// --db (missing --store will produce a usage/rebuild error, but the DB open
// happens before the engine runs), and assert that `schema_version` does NOT
// exist in the DB afterwards.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suite (j) — S1: main must close the live store handle before returning
//
// Reviewer S1: `main` opens the live store at line 105 but the finally block
// at line 150 only calls `storeRoot.close()`. The live DB handle (`live.close()`)
// is never called, leaving the injected/real DB connection lifecycle unmanaged.
// ---------------------------------------------------------------------------

describe("src/cli/verify — S1 main closes the live store handle", () => {
  test("main calls live.close() after a clean run", async () => {
    let closeCalled = false;
    const liveStore: Store & { writeCount: number } = {
      writeCount: 0,
      get<T>(_sql: string, ..._params: unknown[]): T | undefined { return undefined; },
      run(_sql: string, ..._params: unknown[]): void {},
      all<T>(_sql: string, ..._params: unknown[]): T[] { return [] as T[]; },
      close(): void { closeCalled = true; },
    };

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout: makeOutput(),
      stderr: makeOutput(),
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(closeCalled, "main must call live.close() before returning (S1)");
  });

  test("main calls live.close() even when runVerify throws", async () => {
    let closeCalled = false;
    const liveStore: Store & { writeCount: number } = {
      writeCount: 0,
      get<T>(_sql: string, ..._params: unknown[]): T | undefined { return undefined; },
      run(_sql: string, ..._params: unknown[]): void {},
      all<T>(_sql: string, ..._params: unknown[]): T[] { return [] as T[]; },
      close(): void { closeCalled = true; },
    };

    const deps: CliDeps = {
      runVerify: async () => { throw new Error("unexpected engine failure"); },
      openLiveStore: () => liveStore,
      openStoreRoot: () => ({ close() {} }),
      stdout: makeOutput(),
      stderr: makeOutput(),
    };

    await assert.rejects(
      () => main(
        ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
        deps,
      ),
      /unexpected engine failure/,
    );

    assert.ok(closeCalled, "main must call live.close() even when runVerify throws (S1)");
  });
});

describe("src/cli/verify — B1 live DB opened read-only (no writes to DB file)", () => {
  test("real CLI does not create schema_version in the live DB file", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "kanthord-018-b1-ro-"));
    const dbPath = join(tmpDir, "live.db");
    try {
      // Pre-create an empty SQLite DB so the file exists with no tables.
      const emptyDb = new DatabaseSync(dbPath);
      emptyDb.close();

      // Spawn the real CLI. Missing --from-markdown and --read-only will produce
      // a usage error (exit 3), but the important thing is that the DB open path
      // is exercised first. Even with a usage error, if openStore is called
      // before the flag check, it will have mutated the DB.
      // Actually: flag validation happens before openLiveStore — but we need to
      // test the real deps path. Provide all flags but an invalid store root so
      // the engine fails (exit 1 or unhandled error) after opening the DB.
      spawnSync(
        process.execPath,
        ["src/cli/verify.ts", "--from-markdown", "--read-only", "--store", tmpDir, "--db", dbPath],
        { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 },
      );

      // After the spawn (regardless of exit code), check whether the DB was
      // written by the real openLiveStore. A read-only open must not create any
      // tables. openStore() creates schema_version — that is the mutation to detect.
      const inspectDb = new DatabaseSync(dbPath);
      let schemaVersionExists = false;
      try {
        const row = inspectDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
        ).get();
        schemaVersionExists = row !== undefined;
      } finally {
        inspectDb.close();
      }

      assert.ok(
        !schemaVersionExists,
        "real CLI must NOT create schema_version in the live DB — openLiveStore must open read-only, not via openStore()",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite (k) — B1 (fourth review): shipped main must pass ledgerSources to
// runVerify so that markdown-derived op_ledger rows are rebuilt into the shadow
// rather than treated as live-only divergences.
//
// Contract: deps.runVerify must be called with a 4th argument that is NOT
// undefined — an array (possibly empty) of ledger source locators. Passing
// undefined omits op_ledger reconstruction entirely.
// ---------------------------------------------------------------------------

describe("src/cli/verify — B1 main passes ledgerSources to runVerify", () => {
  test("main passes ledgerSources (not undefined) as the 4th arg to runVerify", async () => {
    let capturedLedgerSources: Array<{ storyId: string; taskStem: string }> | undefined = undefined;
    let runVerifyCalled = false;

    const deps: CliDeps = {
      runVerify: async (
        _featureDir: string,
        _live: Store,
        _opts: object,
        ledgerSources?: Array<{ storyId: string; taskStem: string }>,
      ) => {
        runVerifyCalled = true;
        capturedLedgerSources = ledgerSources;
        return { divergences: [] };
      },
      openLiveStore: () => makeWriteCountingStore(),
      openStoreRoot: () => ({ close() {} }),
      stdout: makeOutput(),
      stderr: makeOutput(),
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(runVerifyCalled, "runVerify must be called");
    assert.notEqual(
      capturedLedgerSources,
      undefined,
      "main must pass ledgerSources (not undefined) as the 4th argument to runVerify — omitting it skips op_ledger shadow reconstruction",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (l) — S1 (fourth review): storeRoot.close() must be called even when
// openLiveStore throws, to prevent the store-root handle from leaking.
//
// Layout in main: storeRoot is opened BEFORE live. If openLiveStore throws,
// the try/finally that calls storeRoot.close() must still fire.
// ---------------------------------------------------------------------------

describe("src/cli/verify — S1 storeRoot.close() called when openLiveStore throws", () => {
  test("storeRoot.close() is called even if openLiveStore throws", async () => {
    let storeRootCloseCalled = false;

    const deps: CliDeps = {
      runVerify: async () => ({ divergences: [] }),
      openLiveStore: (_dbPath: string): Store => {
        throw new Error("DB open failure: ENOENT /nonexistent.db");
      },
      openStoreRoot: (_storeRoot: string) => ({
        close() {
          storeRootCloseCalled = true;
        },
      }),
      stdout: makeOutput(),
      stderr: makeOutput(),
    };

    await assert.rejects(
      () =>
        main(
          ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
          deps,
        ),
      /ENOENT/,
      "main must propagate the openLiveStore error",
    );

      assert.ok(
      storeRootCloseCalled,
      "storeRoot.close() must be called even when openLiveStore throws (S1 lifecycle leak)",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (m) — B1 (fifth review): shipped CLI must discover real ledger sources
// and pass a non-empty ledgerSources list when ledger source files exist.
//
// Passing [] disables op_ledger reconstruction in rebuildFromMarkdown
// (src/store/rebuild.ts:141: `if (ledgerSources !== undefined && ledgerSources.length > 0)`).
// The CLI must call the discoverLedgerSources seam and forward the result.
// ---------------------------------------------------------------------------

describe("src/cli/verify — B1 main discovers real ledger sources and passes them to runVerify", () => {
  test("main passes a non-empty ledgerSources when discoverLedgerSources returns entries", async () => {
    const discoveredSources = [
      { storyId: "story-001", taskStem: "T1-my-task" },
      { storyId: "story-001", taskStem: "T2-another-task" },
    ];
    let capturedLedgerSources: Array<{ storyId: string; taskStem: string }> | undefined = undefined;

    const deps: CliDeps = {
      runVerify: async (
        _featureDir: string,
        _live: Store,
        _opts: object,
        ledgerSources?: Array<{ storyId: string; taskStem: string }>,
      ) => {
        capturedLedgerSources = ledgerSources;
        return { divergences: [] };
      },
      openLiveStore: () => makeWriteCountingStore(),
      openStoreRoot: () => ({ close() {} }),
      discoverLedgerSources: async (_storeRoot: string) => discoveredSources,
      stdout: makeOutput(),
      stderr: makeOutput(),
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(
      Array.isArray(capturedLedgerSources),
      "main must pass an array as ledgerSources",
    );
    assert.ok(
      (capturedLedgerSources as Array<{ storyId: string; taskStem: string }>).length > 0,
      "main must pass a non-empty ledgerSources when discoverLedgerSources returns entries — passing [] disables op_ledger reconstruction",
    );
    assert.deepEqual(
      capturedLedgerSources,
      discoveredSources,
      "main must forward the full result of discoverLedgerSources to runVerify",
    );
  });

  test("main passes empty ledgerSources when discoverLedgerSources returns no entries", async () => {
    let capturedLedgerSources: Array<{ storyId: string; taskStem: string }> | undefined = undefined;

    const deps: CliDeps = {
      runVerify: async (
        _featureDir: string,
        _live: Store,
        _opts: object,
        ledgerSources?: Array<{ storyId: string; taskStem: string }>,
      ) => {
        capturedLedgerSources = ledgerSources;
        return { divergences: [] };
      },
      openLiveStore: () => makeWriteCountingStore(),
      openStoreRoot: () => ({ close() {} }),
      discoverLedgerSources: async (_storeRoot: string) => [],
      stdout: makeOutput(),
      stderr: makeOutput(),
    };

    await main(
      ["--from-markdown", "--read-only", "--store", "/tmp/store", "--db", "/tmp/live.db"],
      deps,
    );

    assert.ok(
      Array.isArray(capturedLedgerSources),
      "main must still pass an array (empty) when no ledger sources are found",
    );
  });
});
