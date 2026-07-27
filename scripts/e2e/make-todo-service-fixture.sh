#!/usr/bin/env bash
# make-todo-service-fixture.sh — write the TODO-SERVICE fixture tree.
#
# The fixture is the ORACLE for the mid-level E2E workload: conventions, module
# stubs, and immutable contract tests that are RED at the base commit. The model
# must make them pass; it may read them and may NOT edit them (each task's
# `# Verification` starts with `git diff --quiet HEAD -- test/`).
#
# Why a fixture and not model-authored tests: when the same agent writes both the
# implementation and the tests that certify it, `node --test` is executable but
# meaningless — the agent can weaken, mirror, or delete its own oracle.
#
# This script only WRITES files (no network, no git). `preflight.sh` is what
# publishes the tree to the fixture branch, behind a human confirmation.
#
# Usage: scripts/e2e/make-todo-service-fixture.sh <out-dir>
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-todo-service-fixture.sh <out-dir>}"
mkdir -p "$OUT/src" "$OUT/test/helpers"

# ---------------------------------------------------------------------------
# Conventions. kanthord injects a workspace-root AGENTS.md into the agent's
# system prompt, so this file is how the workload states its rules — pre-seeded
# on purpose: a task never receives an AGENTS.md it writes itself.
# ---------------------------------------------------------------------------
cat > "$OUT/AGENTS.md" <<'EOF'
# AGENTS.md — todo-service conventions

A small TODO service. Node 24, ES modules, **zero third-party dependencies**.

## Rules

- Use `node:` built-ins only (`node:http`, `node:sqlite`, `node:test`, …). Never
  add a dependency, a lockfile, or vendored code.
- `src/store.mjs` owns storage. `src/server.mjs` owns HTTP. The HTTP layer talks
  to the store only through the store's exported interface — never reach into
  its internals.
- `src/server.mjs` exports `createServer(store)` and must NOT listen on import.
  `src/main.mjs` is the only boot path.
- `test/**/*.contract.test.mjs` are the **contract**. They are the specification
  of this service: read them, make them pass. **Never edit, move, or delete a
  file under `test/`** — a change there fails the task.
- Run the suite with `node --test "test/**/*.contract.test.mjs"` (quote the
  glob — Node expands it; `node --test test/` does not work on Node 24).
EOF

cat > "$OUT/package.json" <<'EOF'
{
  "name": "todo-service",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/**/*.contract.test.mjs\""
  }
}
EOF

cat > "$OUT/.gitignore" <<'EOF'
node_modules/
*.sqlite
*.sqlite-journal
EOF

# ---------------------------------------------------------------------------
# Stubs. Signatures + semantics are documented; every body throws so the
# contract tests are red until the work lands.
# ---------------------------------------------------------------------------
cat > "$OUT/src/store.mjs" <<'EOF'
/**
 * Task storage.
 *
 * A task is `{ id: string, title: string, completed: boolean, dueDate: string|null }`
 * where `dueDate` is a `YYYY-MM-DD` string.
 *
 * @param {{ file?: string }} [options]
 *   `file` is a path to a database file. When omitted (or `":memory:"`) the
 *   store is ephemeral and shares nothing with any other store.
 * @returns {{
 *   insert: (input: { title: string, completed?: boolean, dueDate?: string|null }) => object,
 *   get: (id: string) => object|undefined,
 *   list: (query?: { completed?: boolean, dueDate?: string, limit?: number, offset?: number }) => { items: object[], total: number },
 *   update: (id: string, patch: object) => object|undefined,
 *   remove: (id: string) => boolean,
 *   close: () => void,
 * }}
 *
 * Semantics:
 * - `insert` assigns a unique non-empty string id; `completed` defaults to
 *   `false`, `dueDate` to `null`. It returns the stored task.
 * - `list` returns `items` in insertion order. `total` is the number of tasks
 *   matching the filters BEFORE `limit`/`offset` are applied. Filters are exact
 *   matches. With no `limit`, every match is returned.
 * - `update` applies a PARTIAL patch (only the given keys change) and returns
 *   the updated task, or `undefined` for an unknown id.
 * - `remove` returns `true` when a task was deleted, `false` otherwise.
 * - `close` releases resources and is idempotent. Any other method called after
 *   `close` throws.
 */
export function createStore(options = {}) {
  throw new Error("not implemented");
}
EOF

cat > "$OUT/src/server.mjs" <<'EOF'
/**
 * HTTP surface for the task store.
 *
 * Returns a `node:http` server that is NOT listening — the caller decides the
 * port. The full request/response contract (status codes, error bodies, the
 * `Allow` header on 405) lives in `test/**\/*.contract.test.mjs`.
 *
 * @param {object} store a store from `createStore()`
 * @returns {import("node:http").Server}
 */
export function createServer(store) {
  throw new Error("not implemented");
}
EOF

cat > "$OUT/src/main.mjs" <<'EOF'
// Boot path. `PORT` (default 3000) and `TODO_DB` (default ephemeral).
import { createStore } from "./store.mjs";
import { createServer } from "./server.mjs";

const store = createStore({ file: process.env.TODO_DB });
const server = createServer(store);
server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`todo-service listening on ${server.address().port}`);
});
EOF

# ---------------------------------------------------------------------------
# Test helper. Kept OUT of the *.contract.test.mjs glob on purpose: a file under
# test/ with no test cases is collected by a bare `node --test` and counted as a
# test, so the suite is always addressed through the explicit glob.
# ---------------------------------------------------------------------------
cat > "$OUT/test/helpers/serve.mjs" <<'EOF'
import { createStore } from "../../src/store.mjs";
import { createServer } from "../../src/server.mjs";

/** Boot the real server on an ephemeral port, run `fn`, always tear down. */
export async function withServer(fn, options) {
  const store = createStore(options);
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ base, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      store.close();
    } catch {
      /* a store that already threw must not mask the test's own failure */
    }
  }
}

/** One request; parses a JSON body when there is one. */
export async function req(base, path, init) {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, text, headers: res.headers };
}

/** POST a task and return it. */
export async function seed(base, input) {
  const res = await req(base, "/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status !== 201) {
    throw new Error(`seed failed: ${res.status} ${res.text}`);
  }
  return res.body;
}
EOF

# ---------------------------------------------------------------------------
# Contract: the store (gate for task A1)
# ---------------------------------------------------------------------------
cat > "$OUT/test/store.contract.test.mjs" <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";

test("insert assigns a unique id and applies defaults", () => {
  const store = createStore();
  const a = store.insert({ title: "a" });
  const b = store.insert({ title: "b" });
  assert.equal(typeof a.id, "string");
  assert.ok(a.id.length > 0);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(
    { title: a.title, completed: a.completed, dueDate: a.dueDate },
    { title: "a", completed: false, dueDate: null },
  );
  const c = store.insert({ title: "c", completed: true, dueDate: "2026-08-01" });
  assert.equal(c.completed, true);
  assert.equal(c.dueDate, "2026-08-01");
  store.close();
});

test("get returns the stored task, or undefined", () => {
  const store = createStore();
  const a = store.insert({ title: "a" });
  assert.deepEqual(store.get(a.id), a);
  assert.equal(store.get("nope"), undefined);
  store.close();
});

test("list returns insertion order and a total independent of pagination", () => {
  const store = createStore();
  for (const title of ["a", "b", "c", "d"]) store.insert({ title });
  const all = store.list();
  assert.deepEqual(
    all.items.map((t) => t.title),
    ["a", "b", "c", "d"],
  );
  assert.equal(all.total, 4);

  const page = store.list({ limit: 2, offset: 1 });
  assert.deepEqual(
    page.items.map((t) => t.title),
    ["b", "c"],
  );
  assert.equal(page.total, 4);

  const past = store.list({ limit: 2, offset: 10 });
  assert.deepEqual(past.items, []);
  assert.equal(past.total, 4);
  store.close();
});

test("list filters on completed, including the false case", () => {
  const store = createStore();
  store.insert({ title: "open-1" });
  store.insert({ title: "done", completed: true });
  store.insert({ title: "open-2" });

  const open = store.list({ completed: false });
  assert.deepEqual(
    open.items.map((t) => t.title),
    ["open-1", "open-2"],
  );
  assert.equal(open.total, 2);

  const done = store.list({ completed: true });
  assert.deepEqual(
    done.items.map((t) => t.title),
    ["done"],
  );
  assert.equal(done.total, 1);
  store.close();
});

test("list filters on dueDate, and both filters combine", () => {
  const store = createStore();
  store.insert({ title: "a", dueDate: "2026-08-01" });
  store.insert({ title: "b", dueDate: "2026-08-02" });
  store.insert({ title: "c", dueDate: "2026-08-01", completed: true });

  const byDate = store.list({ dueDate: "2026-08-01" });
  assert.equal(byDate.total, 2);

  const both = store.list({ dueDate: "2026-08-01", completed: true });
  assert.deepEqual(
    both.items.map((t) => t.title),
    ["c"],
  );
  assert.equal(both.total, 1);
  store.close();
});

test("update is a partial patch and returns undefined for an unknown id", () => {
  const store = createStore();
  const a = store.insert({ title: "a", dueDate: "2026-08-01" });
  const updated = store.update(a.id, { completed: true });
  assert.equal(updated.id, a.id);
  assert.equal(updated.title, "a");
  assert.equal(updated.dueDate, "2026-08-01");
  assert.equal(updated.completed, true);
  assert.deepEqual(store.get(a.id), updated);
  assert.equal(store.update("nope", { completed: true }), undefined);
  store.close();
});

test("remove reports whether it deleted anything", () => {
  const store = createStore();
  const a = store.insert({ title: "a" });
  assert.equal(store.remove(a.id), true);
  assert.equal(store.get(a.id), undefined);
  assert.equal(store.remove(a.id), false);
  assert.equal(store.list().total, 0);
  store.close();
});

test("close is idempotent and every other method throws afterwards", () => {
  const store = createStore();
  store.insert({ title: "a" });
  store.close();
  store.close();
  assert.throws(() => store.list());
  assert.throws(() => store.insert({ title: "b" }));
});

test("a store with no file shares nothing with another store", () => {
  const one = createStore();
  const two = createStore();
  one.insert({ title: "only-in-one" });
  assert.equal(two.list().total, 0);
  one.close();
  two.close();
});
EOF

# ---------------------------------------------------------------------------
# Contract: the server seam (gate for task A1)
# ---------------------------------------------------------------------------
cat > "$OUT/test/server.contract.test.mjs" <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { createServer } from "../src/server.mjs";

test("createServer returns a server that is not listening yet", () => {
  const store = createStore();
  const server = createServer(store);
  assert.equal(typeof server.listen, "function");
  assert.equal(typeof server.close, "function");
  assert.equal(server.listening, false);
  store.close();
});

test("the server listens on an ephemeral port and closes cleanly", async () => {
  const store = createStore();
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  assert.equal(server.listening, true);
  assert.ok(server.address().port > 0);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(server.listening, false);
  store.close();
});

test("an unknown path is 404 not_found", async () => {
  const store = createStore();
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
  await new Promise((resolve) => server.close(resolve));
  store.close();
});
EOF

# ---------------------------------------------------------------------------
# Contract: collection endpoints (gate for task A2)
# ---------------------------------------------------------------------------
cat > "$OUT/test/http-collection.contract.test.mjs" <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { withServer, req, seed } from "./helpers/serve.mjs";

const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

test("POST /tasks creates a task with 201 and JSON defaults", async () => {
  await withServer(async ({ base }) => {
    const res = await req(base, "/tasks", json(JSON.stringify({ title: "a" })));
    assert.equal(res.status, 201);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(typeof res.body.id, "string");
    assert.equal(res.body.title, "a");
    assert.equal(res.body.completed, false);
    assert.equal(res.body.dueDate, null);
  });
});

test("POST /tasks keeps the fields it is given", async () => {
  await withServer(async ({ base }) => {
    const res = await req(
      base,
      "/tasks",
      json(JSON.stringify({ title: "a", completed: true, dueDate: "2026-08-01" })),
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.completed, true);
    assert.equal(res.body.dueDate, "2026-08-01");
  });
});

test("POST /tasks rejects a malformed or invalid body with a named 400", async () => {
  await withServer(async ({ base }) => {
    const cases = [
      ["{not json", "invalid_json"],
      [JSON.stringify({}), "invalid_title"],
      [JSON.stringify({ title: "" }), "invalid_title"],
      [JSON.stringify({ title: 7 }), "invalid_title"],
      [JSON.stringify({ title: "a", completed: "yes" }), "invalid_completed"],
      [JSON.stringify({ title: "a", dueDate: "2026/08/01" }), "invalid_dueDate"],
      [JSON.stringify({ title: "a", dueDate: 20260801 }), "invalid_dueDate"],
    ];
    for (const [body, error] of cases) {
      const res = await req(base, "/tasks", json(body));
      assert.equal(res.status, 400, `body ${body} should be 400`);
      assert.deepEqual(res.body, { error }, `body ${body} should say ${error}`);
    }
  });
});

test("GET /tasks returns items + total", async () => {
  await withServer(async ({ base }) => {
    await seed(base, { title: "a" });
    await seed(base, { title: "b" });
    const res = await req(base, "/tasks");
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.deepEqual(
      res.body.items.map((t) => t.title),
      ["a", "b"],
    );
  });
});

test("GET /tasks filters on completed, including completed=false", async () => {
  await withServer(async ({ base }) => {
    await seed(base, { title: "open-1" });
    await seed(base, { title: "done", completed: true });
    await seed(base, { title: "open-2" });

    const open = await req(base, "/tasks?completed=false");
    assert.equal(open.status, 200);
    assert.equal(open.body.total, 2);
    assert.deepEqual(
      open.body.items.map((t) => t.title),
      ["open-1", "open-2"],
    );

    const done = await req(base, "/tasks?completed=true");
    assert.equal(done.body.total, 1);
    assert.equal(done.body.items[0].title, "done");
  });
});

test("GET /tasks filters on dueDate and combines both filters", async () => {
  await withServer(async ({ base }) => {
    await seed(base, { title: "a", dueDate: "2026-08-01" });
    await seed(base, { title: "b", dueDate: "2026-08-02" });
    await seed(base, { title: "c", dueDate: "2026-08-01", completed: true });

    const byDate = await req(base, "/tasks?dueDate=2026-08-01");
    assert.equal(byDate.body.total, 2);

    const both = await req(base, "/tasks?dueDate=2026-08-01&completed=true");
    assert.equal(both.body.total, 1);
    assert.equal(both.body.items[0].title, "c");
  });
});

test("GET /tasks paginates with limit + offset and a default limit of 20", async () => {
  await withServer(async ({ base }) => {
    for (let i = 0; i < 25; i += 1) {
      await seed(base, { title: `t-${String(i).padStart(2, "0")}` });
    }
    const page = await req(base, "/tasks?limit=2&offset=1");
    assert.equal(page.status, 200);
    assert.equal(page.body.total, 25);
    assert.deepEqual(
      page.body.items.map((t) => t.title),
      ["t-01", "t-02"],
    );

    const dflt = await req(base, "/tasks");
    assert.equal(dflt.body.total, 25);
    assert.equal(dflt.body.items.length, 20);
  });
});

test("GET /tasks rejects invalid query values with a named 400", async () => {
  await withServer(async ({ base }) => {
    const cases = [
      ["/tasks?completed=maybe", "invalid_completed"],
      ["/tasks?dueDate=2026-8-1", "invalid_dueDate"],
      ["/tasks?limit=0", "invalid_limit"],
      ["/tasks?limit=-1", "invalid_limit"],
      ["/tasks?limit=abc", "invalid_limit"],
      ["/tasks?limit=101", "invalid_limit"],
      ["/tasks?offset=-1", "invalid_offset"],
      ["/tasks?offset=abc", "invalid_offset"],
    ];
    for (const [path, error] of cases) {
      const res = await req(base, path);
      assert.equal(res.status, 400, `${path} should be 400`);
      assert.deepEqual(res.body, { error }, `${path} should say ${error}`);
    }
  });
});

test("an unsupported method on /tasks is 405 with an exact Allow header", async () => {
  await withServer(async ({ base }) => {
    const res = await req(base, "/tasks", { method: "PATCH" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, POST");
  });
});
EOF

# ---------------------------------------------------------------------------
# Contract: item endpoints (gate for task A3)
# ---------------------------------------------------------------------------
cat > "$OUT/test/http-item.contract.test.mjs" <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { withServer, req, seed } from "./helpers/serve.mjs";

const put = (body) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body,
});

test("GET /tasks/:id returns the task, or 404 not_found", async () => {
  await withServer(async ({ base }) => {
    const task = await seed(base, { title: "a", dueDate: "2026-08-01" });
    const found = await req(base, `/tasks/${task.id}`);
    assert.equal(found.status, 200);
    assert.deepEqual(found.body, task);

    const missing = await req(base, "/tasks/does-not-exist");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: "not_found" });
  });
});

test("PUT /tasks/:id applies a partial update", async () => {
  await withServer(async ({ base }) => {
    const task = await seed(base, { title: "a", dueDate: "2026-08-01" });
    const res = await req(
      base,
      `/tasks/${task.id}`,
      put(JSON.stringify({ completed: true })),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, task.id);
    assert.equal(res.body.title, "a");
    assert.equal(res.body.dueDate, "2026-08-01");
    assert.equal(res.body.completed, true);

    const reread = await req(base, `/tasks/${task.id}`);
    assert.deepEqual(reread.body, res.body);
  });
});

test("PUT /tasks/:id rejects an invalid body with a named 400", async () => {
  await withServer(async ({ base }) => {
    const task = await seed(base, { title: "a" });
    const cases = [
      ["{not json", "invalid_json"],
      [JSON.stringify({ title: "" }), "invalid_title"],
      [JSON.stringify({ title: 7 }), "invalid_title"],
      [JSON.stringify({ completed: "yes" }), "invalid_completed"],
      [JSON.stringify({ dueDate: "2026/08/01" }), "invalid_dueDate"],
    ];
    for (const [body, error] of cases) {
      const res = await req(base, `/tasks/${task.id}`, put(body));
      assert.equal(res.status, 400, `body ${body} should be 400`);
      assert.deepEqual(res.body, { error });
    }
  });
});

test("PUT /tasks/:id on an unknown id is 404", async () => {
  await withServer(async ({ base }) => {
    const res = await req(
      base,
      "/tasks/does-not-exist",
      put(JSON.stringify({ completed: true })),
    );
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "not_found" });
  });
});

test("DELETE /tasks/:id is 204 with an empty body, then the task is gone", async () => {
  await withServer(async ({ base }) => {
    const task = await seed(base, { title: "a" });
    const res = await req(base, `/tasks/${task.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);
    assert.equal(res.text, "");

    const gone = await req(base, `/tasks/${task.id}`);
    assert.equal(gone.status, 404);

    const again = await req(base, `/tasks/${task.id}`, { method: "DELETE" });
    assert.equal(again.status, 404);
    assert.deepEqual(again.body, { error: "not_found" });
  });
});

test("an unsupported method on /tasks/:id is 405 with an exact Allow header", async () => {
  await withServer(async ({ base }) => {
    const task = await seed(base, { title: "a" });
    const res = await req(base, `/tasks/${task.id}`, { method: "PATCH" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, PUT, DELETE");
  });
});
EOF

# ---------------------------------------------------------------------------
# Contract: persistence (gate for task B1 — the SQLite refactor)
# ---------------------------------------------------------------------------
cat > "$OUT/test/persistence.contract.test.mjs" <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.mjs";

async function withDbFile(fn) {
  const dir = await mkdtemp(join(tmpdir(), "todo-service-"));
  try {
    return await fn(join(dir, "todo.sqlite"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a file-backed store survives close + reopen", async () => {
  await withDbFile(async (file) => {
    const first = createStore({ file });
    const task = first.insert({
      title: "durable",
      completed: true,
      dueDate: "2026-08-01",
    });
    first.close();

    const second = createStore({ file });
    assert.deepEqual(second.get(task.id), task);
    assert.equal(second.list().total, 1);
    second.close();
  });
});

test("a removal survives close + reopen", async () => {
  await withDbFile(async (file) => {
    const first = createStore({ file });
    const keep = first.insert({ title: "keep" });
    const drop = first.insert({ title: "drop" });
    assert.equal(first.remove(drop.id), true);
    first.close();

    const second = createStore({ file });
    assert.equal(second.list().total, 1);
    assert.equal(second.get(drop.id), undefined);
    assert.equal(second.get(keep.id).title, "keep");
    second.close();
  });
});

test("an update survives close + reopen, and filters still work on reload", async () => {
  await withDbFile(async (file) => {
    const first = createStore({ file });
    const a = first.insert({ title: "a", dueDate: "2026-08-01" });
    first.insert({ title: "b", dueDate: "2026-08-02" });
    first.update(a.id, { completed: true });
    first.close();

    const second = createStore({ file });
    assert.equal(second.get(a.id).completed, true);
    assert.equal(second.list({ completed: false }).total, 1);
    assert.equal(second.list({ dueDate: "2026-08-01" }).total, 1);
    second.close();
  });
});

test("two stores on the same file see each other's committed writes", async () => {
  await withDbFile(async (file) => {
    const writer = createStore({ file });
    const task = writer.insert({ title: "shared" });
    writer.close();

    const readerA = createStore({ file });
    const readerB = createStore({ file });
    assert.equal(readerA.get(task.id).title, "shared");
    assert.equal(readerB.get(task.id).title, "shared");
    readerA.close();
    readerB.close();
  });
});
EOF

echo "fixture written: $OUT"
