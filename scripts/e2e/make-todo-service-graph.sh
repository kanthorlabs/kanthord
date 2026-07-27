#!/usr/bin/env bash
# make-todo-service-graph.sh — author the TODO-SERVICE graph package (mid-level).
#
# The workload the real-model /e2e run drives. Unlike make-todo-graph.sh (which
# stays as-is for the deterministic no-model proofs), this graph is a MID-LEVEL
# test:
#   * the oracle is pre-seeded by make-todo-service-fixture.sh — immutable
#     contract tests, red at the base commit. The model implements TO a contract
#     it did not write and may not edit.
#   * brownfield: conventions (AGENTS.md) and module stubs already exist.
#   * exact HTTP semantics: 400 error codes, 404, 405 + an exact `Allow` header,
#     `completed=false`, pagination bounds.
#   * one refactor behind a seam: in-memory -> node:sqlite, contract unchanged.
#   * every task re-runs the tests that already passed, so a regression fails the
#     current task.
#
# Two objectives, four tasks. Execution is strictly serial and an ordinary
# failure is never auto-retried, so task count is kept at the minimum that still
# covers every aspect.
#
# Usage: scripts/e2e/make-todo-service-graph.sh <out-dir>
#
# Verification notes (both learned the hard way):
#   * `node --test test/` does NOT work on Node 24 — it resolves `test` as a
#     module and dies with MODULE_NOT_FOUND. Pass explicit files, or a QUOTED
#     glob so Node (not sh) expands it.
#   * each `# Verification` line runs in its own `sh -c` with a 300 s timeout and
#     no injected env, so every line must be self-contained.
set -Eeuo pipefail

# A bare `test`/`grep -q` under `set -e` aborts with exit 1 and NO message, so the
# failing check is invisible. This trap names it. `-E` (errtrace) is required or the
# trap never fires for a failure inside a function.
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

OUT="${1:?usage: make-todo-service-graph.sh <out-dir>}"
mkdir -p "$OUT"

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: todo-service-init
name: TODO service — contract-driven build
bindings:
  source: repository
---
EOF

cat > "$OUT/objective-core.md" <<'EOF'
---
kind: objective
ref: todo-core
initiative: todo-service-init
name: Complete the HTTP service against the contract
---
EOF

# `after: [todo-core]` gates every task of this objective on todo-core being
# INTEGRATED — i.e. a human ran `approve objective`. That is what makes the run
# exercise the 007.12 gate twice before the initiative reaches `landed`.
cat > "$OUT/objective-persistence.md" <<'EOF'
---
kind: objective
ref: todo-persistence
initiative: todo-service-init
name: Move the store onto node:sqlite without changing its contract
after: [todo-core]
---
EOF

# ---------------------------------------------------------------------------
# A1 — the store + server seam (gates on its own two contract files; the HTTP
#      and persistence contracts are legitimately still red at this point)
# ---------------------------------------------------------------------------
cat > "$OUT/task-store-and-server.md" <<'EOF'
---
kind: task
ref: store-and-server
objective: todo-core
title: Store + server seam — make the store and server contracts pass
agent: generic@1
context:
  source: source
---
# Instructions
Read `AGENTS.md` and `test/store.contract.test.mjs` +
`test/server.contract.test.mjs` first: those tests are the specification, and
`src/store.mjs` / `src/server.mjs` are stubs that throw.

Implement `createStore(options)` in `src/store.mjs` as an in-memory store, and
`createServer(store)` in `src/server.mjs` as a `node:http` server that is not
listening when it is returned. Routing for the task endpoints comes in later
tasks — this task only needs the store contract, the server lifecycle, and the
404 `{"error":"not_found"}` fallback for an unknown path.

Never edit, move, or delete anything under `test/`; the verification refuses any
change there. Do not add dependencies — `node:` built-ins only.
# Acceptance Criteria
- [ ] `src/store.mjs` implements the documented store interface in memory
- [ ] `src/server.mjs` exports `createServer(store)` and does not listen on import
- [ ] An unknown path answers `404` with `{"error":"not_found"}`
- [ ] `test/` is untouched and no dependency is added
# Verification
```sh
git diff --quiet HEAD -- test/
node --test test/store.contract.test.mjs test/server.contract.test.mjs
```
EOF

# ---------------------------------------------------------------------------
# A2 — collection endpoints
# ---------------------------------------------------------------------------
cat > "$OUT/task-collection-endpoints.md" <<'EOF'
---
kind: task
ref: collection-endpoints
objective: todo-core
title: Collection endpoints — POST /tasks and GET /tasks
agent: generic@1
dependencies: [store-and-server]
context:
  source: source
---
# Instructions
Read `test/http-collection.contract.test.mjs` — it is the specification for this
task, down to the exact error codes.

Add `POST /tasks` and `GET /tasks` to `src/server.mjs`. `GET /tasks` answers
`{"items":[…],"total":n}` where `total` counts every match before pagination,
supports the `completed`, `dueDate`, `limit` and `offset` query parameters, and
defaults to `limit=20`. Invalid input is a `400` with the exact named error the
contract test asserts (`invalid_json`, `invalid_title`, `invalid_completed`,
`invalid_dueDate`, `invalid_limit`, `invalid_offset`). An unsupported method on
`/tasks` is `405` with the exact `Allow` header.

The store's contract does not change. Keep the already-passing tests green.
Never edit anything under `test/`.
# Acceptance Criteria
- [ ] `POST /tasks` returns `201` with the created task and applies the documented defaults
- [ ] `GET /tasks` returns `{items,total}` and both filters work, including `completed=false`
- [ ] `limit`/`offset` paginate, `limit` defaults to 20, and out-of-range values are `400`
- [ ] An unsupported method on `/tasks` is `405` with `Allow: GET, POST`
- [ ] The store + server contract tests still pass and `test/` is untouched
# Verification
```sh
git diff --quiet HEAD -- test/
node --test test/store.contract.test.mjs test/server.contract.test.mjs test/http-collection.contract.test.mjs
```
EOF

# ---------------------------------------------------------------------------
# A3 — item endpoints
# ---------------------------------------------------------------------------
cat > "$OUT/task-item-endpoints.md" <<'EOF'
---
kind: task
ref: item-endpoints
objective: todo-core
title: Item endpoints — GET/PUT/DELETE /tasks/:id
agent: generic@1
dependencies: [collection-endpoints]
context:
  source: source
---
# Instructions
Read `test/http-item.contract.test.mjs` — it is the specification for this task.

Add `GET /tasks/:id`, `PUT /tasks/:id` and `DELETE /tasks/:id` to
`src/server.mjs`. `PUT` is a PARTIAL update: only the fields present in the body
change. An unknown id is `404` with `{"error":"not_found"}`; an invalid body is a
`400` with the same named errors the collection endpoints use; `DELETE` answers
`204` with an empty body. An unsupported method on `/tasks/:id` is `405` with the
exact `Allow` header.

Keep every previously passing test green. Never edit anything under `test/`.
# Acceptance Criteria
- [ ] `GET /tasks/:id` returns the task, unknown id is `404` `{"error":"not_found"}`
- [ ] `PUT /tasks/:id` applies a partial update and returns the updated task
- [ ] An invalid `PUT` body is a `400` with the documented named error
- [ ] `DELETE /tasks/:id` is `204` with an empty body; deleting twice is `404`
- [ ] An unsupported method on `/tasks/:id` is `405` with `Allow: GET, PUT, DELETE`
- [ ] All earlier contract tests still pass and `test/` is untouched
# Verification
```sh
git diff --quiet HEAD -- test/
node --test test/store.contract.test.mjs test/server.contract.test.mjs test/http-collection.contract.test.mjs test/http-item.contract.test.mjs
```
EOF

# ---------------------------------------------------------------------------
# B1 — the refactor. No task-level `dependencies`: the objective's `after:`
#      already gates it on todo-core being integrated.
# ---------------------------------------------------------------------------
cat > "$OUT/task-sqlite-store.md" <<'EOF'
---
kind: task
ref: sqlite-store
objective: todo-persistence
title: SQLite store — persist through close + reopen, contract unchanged
agent: generic@1
context:
  source: source
---
# Instructions
Read `test/persistence.contract.test.mjs` — it is the specification for this
task, and it is the only contract file still red.

Reimplement the internals of `src/store.mjs` on `node:sqlite` (`DatabaseSync`).
`createStore({ file })` must persist to that file so a second store opened on the
same path sees the committed data; with no `file` (or `":memory:"`) the store
stays ephemeral and shares nothing.

The exported interface does not change, and `src/server.mjs` must not be
adjusted to suit the new implementation — every HTTP contract test has to stay
green exactly as it is. Mind the representation gap: SQLite has no boolean, so
`completed` must still come back as a real `true`/`false`, and `dueDate` must
still be a `YYYY-MM-DD` string or `null`.

Never edit anything under `test/`. Do not add dependencies.
# Acceptance Criteria
- [ ] `src/store.mjs` stores data through `node:sqlite`
- [ ] A file-backed store survives close + reopen, including updates and removals
- [ ] A store with no file is still ephemeral
- [ ] `completed` is a boolean and `dueDate` is a `YYYY-MM-DD` string or `null`
- [ ] The store interface is unchanged and every contract test passes
- [ ] `test/` is untouched and no dependency is added
# Verification
```sh
git diff --quiet HEAD -- test/
node --test "test/**/*.contract.test.mjs"
```
EOF

echo "graph written: $OUT"
