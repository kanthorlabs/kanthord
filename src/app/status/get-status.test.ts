import { test } from "node:test";
import assert from "node:assert/strict";

import { GetStatus } from "./get-status.ts";
import type { StatusStore } from "../../storage/port.ts";

class FakeStatusStore implements StatusStore {
  readonly path = "/tmp/fake-kanthord.db";
  closed = false;
  schemaVersion(): number {
    return 1;
  }
  journalMode(): string {
    return "wal";
  }
  taskCount(): number {
    return 0;
  }
  close(): void {
    this.closed = true;
  }
}

test("GetStatus.execute returns the four status fields from the store", () => {
  const store = new FakeStatusStore();
  const status = new GetStatus(store).execute();
  assert.deepEqual(status, {
    dbPath: "/tmp/fake-kanthord.db",
    schemaVersion: 1,
    journalMode: "wal",
    taskCount: 0,
  });
});
