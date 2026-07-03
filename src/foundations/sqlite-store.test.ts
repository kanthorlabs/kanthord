import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "./sqlite-store.ts";

describe("src/foundations/sqlite-store.ts", () => {
  describe("openStore — WAL mode, busy_timeout, and schema_version", () => {
    let tmpDir!: string;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sqlite-store-t1-"));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("opens a fresh database with WAL mode, configured busy_timeout, and records the migration version", () => {
      const dbPath = join(tmpDir, "kanthord.db");
      const store = openStore(dbPath, { busyTimeout: 5000 });
      try {
        const journalRow = store.get<{ journal_mode: string }>(
          "PRAGMA journal_mode",
        );
        assert.equal(
          journalRow?.journal_mode,
          "wal",
          "journal_mode PRAGMA must return wal",
        );

        const timeoutRow = store.get<{ timeout: number }>(
          "PRAGMA busy_timeout",
        );
        assert.ok(
          timeoutRow !== undefined,
          "PRAGMA busy_timeout must return a row",
        );
        assert.ok(timeoutRow.timeout > 0, "busy_timeout must be non-zero");
        assert.equal(
          timeoutRow.timeout,
          5000,
          "busy_timeout must equal the configured value",
        );

        const versionRow = store.get<{ version: number }>(
          "SELECT version FROM schema_version",
        );
        assert.ok(
          versionRow !== undefined,
          "schema_version row must exist after migration",
        );
        assert.equal(
          versionRow.version,
          1,
          "schema_version must equal the number of applied migrations",
        );
      } finally {
        store.close();
      }
    });
  });

  describe("openStore — idempotent re-open", () => {
    let tmpDir!: string;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sqlite-store-t2-reopen-"));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("re-opening an already-migrated database leaves schema_version unchanged and does not duplicate rows", () => {
      const dbPath = join(tmpDir, "idempotent.db");

      // First open — runs migration version 1.
      const store1 = openStore(dbPath, { busyTimeout: 5000 });
      store1.close();

      // Second open — must not re-apply migration 1.
      const store2 = openStore(dbPath, { busyTimeout: 5000 });
      try {
        const versionRow = store2.get<{ version: number }>(
          "SELECT version FROM schema_version",
        );
        assert.ok(
          versionRow !== undefined,
          "schema_version row must still exist after re-open",
        );
        assert.equal(
          versionRow.version,
          1,
          "schema_version must remain 1 after re-open",
        );

        const allVersionRows = store2.all<{ version: number }>(
          "SELECT version FROM schema_version",
        );
        assert.equal(
          allVersionRows.length,
          1,
          "schema_version must have exactly one row — no duplicates from re-run",
        );
      } finally {
        store2.close();
      }
    });
  });

  describe("openStore — execution-seam row round-trip", () => {
    let tmpDir!: string;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sqlite-store-t2-roundtrip-"));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("inserts a row via run and reads it back equal via get and all", () => {
      const dbPath = join(tmpDir, "roundtrip.db");
      const store = openStore(dbPath, { busyTimeout: 5000 });
      try {
        store.run("INSERT INTO _roundtrip (value) VALUES (?)", "hello");

        const row = store.get<{ value: string }>(
          "SELECT value FROM _roundtrip WHERE value = ?",
          "hello",
        );
        assert.ok(
          row !== undefined,
          "inserted row must be retrievable via get",
        );
        assert.equal(row.value, "hello", "get must return the inserted value");

        const rows = store.all<{ value: string }>(
          "SELECT value FROM _roundtrip",
        );
        assert.equal(rows.length, 1, "all must return exactly one row");
        assert.equal(
          rows[0]?.value,
          "hello",
          "all must return the inserted value",
        );
      } finally {
        store.close();
      }
    });
  });
});
