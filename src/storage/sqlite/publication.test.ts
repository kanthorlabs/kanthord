// src/storage/sqlite/publication.test.ts — SqlitePublicationRepository
// (007.13 Story C: persisted, queryable publication state).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqlitePublicationRepository } from "./publication.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-publication-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir, repo: new SqlitePublicationRepository(db) };
}

test("SqlitePublicationRepository: unknown (repoId, branch) target returns undefined (unpublished)", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    repo.getPublication("repo-none", "main"),
    undefined,
    "an unknown (repoId, branch) target must return undefined",
  );
});

test("SqlitePublicationRepository: set/get round-trips the 'published' state with its remoteOID", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.setPublication("repo-1", "main", {
    state: "published",
    remoteOID: "abc123",
  });

  const got = repo.getPublication("repo-1", "main");
  assert.deepEqual(got, { state: "published", remoteOID: "abc123" });
});

test("SqlitePublicationRepository: set/get round-trips the 'diverged' state with the observed remoteOID", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.setPublication("repo-1", "main", {
    state: "diverged",
    remoteOID: "deadbeef",
  });

  const got = repo.getPublication("repo-1", "main");
  assert.deepEqual(got, { state: "diverged", remoteOID: "deadbeef" });
});

test("SqlitePublicationRepository: a later setPublication for the same (repoId, branch) overwrites the prior state", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.setPublication("repo-1", "main", {
    state: "published",
    remoteOID: "oid-1",
  });
  repo.setPublication("repo-1", "main", {
    state: "diverged",
    remoteOID: "oid-2",
  });

  const got = repo.getPublication("repo-1", "main");
  assert.deepEqual(got, { state: "diverged", remoteOID: "oid-2" });
});

test("SqlitePublicationRepository: state is scoped per (repoId, branch) — a different branch stays unpublished", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.setPublication("repo-1", "main", {
    state: "published",
    remoteOID: "oid-1",
  });

  assert.equal(
    repo.getPublication("repo-1", "other-branch"),
    undefined,
    "a different branch of the same repo must not see the other branch's state",
  );
});

// ---------------------------------------------------------------------------
// getLatestPublication (007.12 reconciliation): delivery publishes the
// initiative branch (kanthord/init/<id>), not the repo's configured branch, so
// callers that want "what did we last publish" must look across branches.
// ---------------------------------------------------------------------------

test("SqlitePublicationRepository: getLatestPublication returns the most-recently-inserted branch's record for a repo", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.setPublication("repo-1", "main", {
    state: "published",
    remoteOID: "main-oid",
  });
  repo.setPublication("repo-1", "kanthord/init/X", {
    state: "published",
    remoteOID: "deadbeef",
  });

  const got = repo.getLatestPublication("repo-1");
  assert.deepEqual(got, { state: "published", remoteOID: "deadbeef" });
});

test("SqlitePublicationRepository: getLatestPublication on a repo with no rows returns undefined", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    repo.getLatestPublication("repo-none"),
    undefined,
    "a repo with no publication rows must return undefined",
  );
});
