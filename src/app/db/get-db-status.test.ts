import { test } from "node:test";
import assert from "node:assert/strict";
import type { StatusStore } from "../../storage/port.ts";
import { GetDbStatus } from "./get-db-status.ts";

class FakeStatusStore implements StatusStore {
  readonly path = "/tmp/test.db";
  schemaVersion(): number {
    return 5;
  }
  journalMode(): string {
    return "wal";
  }
  tables(): Array<{ name: string; rows: number }> {
    return [
      { name: "initiatives", rows: 2 },
      { name: "projects", rows: 1 },
    ];
  }
  close(): void {
    /* no-op */
  }
}

test("GetDbStatus.execute() returns dbPath, schemaVersion, journalMode, and tables from the store", async () => {
  const uc = new GetDbStatus(new FakeStatusStore());
  const result = await uc.execute();
  assert.equal(result.dbPath, "/tmp/test.db");
  assert.equal(result.schemaVersion, 5);
  assert.equal(result.journalMode, "wal");
  assert.deepEqual(result.tables, [
    { name: "initiatives", rows: 2 },
    { name: "projects", rows: 1 },
  ]);
});

test("GetDbStatus.execute() returns tables:[] on an unmigrated store", async () => {
  class FakeEmptyStore implements StatusStore {
    readonly path = "/tmp/empty.db";
    schemaVersion(): number {
      return 0;
    }
    journalMode(): string {
      return "wal";
    }
    tables(): Array<{ name: string; rows: number }> {
      return [];
    }
    close(): void {
      /* no-op */
    }
  }
  const uc = new GetDbStatus(new FakeEmptyStore());
  const result = await uc.execute();
  assert.equal(result.dbPath, "/tmp/empty.db");
  assert.equal(result.schemaVersion, 0);
  assert.deepEqual(result.tables, []);
});
