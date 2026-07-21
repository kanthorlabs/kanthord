#!/usr/bin/env bash
# make-todo-graph.sh — author the TODO-application-API graph package.
#
# Writes an importable graph (`import graph --create`) describing a real feature:
# a TODO API with five REST endpoints, one task per endpoint. The four
# read/update/delete tasks depend on the create task (the data model + server
# land first). Every task uses agent generic@1 and binds three aliases
# (source/provider/cred) because generic@1 requires repository + ai_provider +
# credential context.
#
# Usage: scripts/e2e/make-todo-graph.sh <out-dir>
#
# Verification is deliberately LIGHTWEIGHT (existence / `node --check`) so the
# same package is usable by the deterministic no-model landing proof
# (make-landing-graph.sh) as well as a real-model run; the endpoint specifics
# live in each task's Instructions + Acceptance Criteria.
set -euo pipefail

OUT="${1:?usage: make-todo-graph.sh <out-dir>}"
mkdir -p "$OUT"

cat > "$OUT/initiative.md" <<'EOF'
---
kind: initiative
ref: todo-api-init
name: TODO application API
bindings:
  source: repository
  provider: ai_provider
  cred: credential
---
EOF

cat > "$OUT/objective.md" <<'EOF'
---
kind: objective
ref: todo-api-obj
initiative: todo-api-init
name: CRUD REST API for tasks
---
EOF

# ---------------------------------------------------------------------------
# Task 1 — Create Task (root; the model + server land first)
# ---------------------------------------------------------------------------
cat > "$OUT/task-create.md" <<'EOF'
---
kind: task
ref: create-task
objective: todo-api-obj
title: Create Task — POST /tasks
agent: generic@1
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Implement `POST /tasks` in `src/todo.mjs` using `node:http`. Accept a JSON body
with a task's fields (e.g. title, completed flag, due date) and persist it in an
in-memory store keyed by a generated id. Return `201` with the created task
(including its id). This task establishes the shared task data model and the
HTTP server the other endpoints extend.
# Acceptance Criteria
- [ ] `POST /tasks` creates a task and returns `201` with the created task + id
- [ ] The task shape includes title, completed status, and due date
- [ ] `src/todo.mjs` starts an HTTP server via `node:http`
# Verification
```sh
test -f src/todo.mjs
```
EOF

# ---------------------------------------------------------------------------
# Task 2 — List Tasks (filter by status + due date)
# ---------------------------------------------------------------------------
cat > "$OUT/task-list.md" <<'EOF'
---
kind: task
ref: list-tasks
objective: todo-api-obj
title: List Tasks — GET /tasks
agent: generic@1
depends-on: [create-task]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Implement `GET /tasks` in `src/todo.mjs`. Return all tasks as JSON. Support
filtering via query params: by completion status (completed vs not completed)
and by due date.
# Acceptance Criteria
- [ ] `GET /tasks` returns all tasks as a JSON array
- [ ] Filtering by completion status works
- [ ] Filtering by due date works
# Verification
```sh
node --check src/todo.mjs
```
EOF

# ---------------------------------------------------------------------------
# Task 3 — Get Task
# ---------------------------------------------------------------------------
cat > "$OUT/task-get.md" <<'EOF'
---
kind: task
ref: get-task
objective: todo-api-obj
title: Get Task — GET /tasks/:id
agent: generic@1
depends-on: [create-task]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Implement `GET /tasks/:id` in `src/todo.mjs`. Return the task as JSON, or `404`
when no task with that id exists.
# Acceptance Criteria
- [ ] `GET /tasks/:id` returns the matching task as JSON
- [ ] An unknown id returns `404`
# Verification
```sh
node --check src/todo.mjs
```
EOF

# ---------------------------------------------------------------------------
# Task 4 — Update Task
# ---------------------------------------------------------------------------
cat > "$OUT/task-update.md" <<'EOF'
---
kind: task
ref: update-task
objective: todo-api-obj
title: Update Task — PUT /tasks/:id
agent: generic@1
depends-on: [create-task]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Implement `PUT /tasks/:id` in `src/todo.mjs`. Accept a JSON body and update the
matching task's fields, returning the updated task, or `404` when no task with
that id exists.
# Acceptance Criteria
- [ ] `PUT /tasks/:id` updates the task and returns it as JSON
- [ ] An unknown id returns `404`
# Verification
```sh
node --check src/todo.mjs
```
EOF

# ---------------------------------------------------------------------------
# Task 5 — Delete Task
# ---------------------------------------------------------------------------
cat > "$OUT/task-delete.md" <<'EOF'
---
kind: task
ref: delete-task
objective: todo-api-obj
title: Delete Task — DELETE /tasks/:id
agent: generic@1
depends-on: [create-task]
context:
  source: source
  provider: provider
  cred: cred
---
# Instructions
Implement `DELETE /tasks/:id` in `src/todo.mjs`. Remove the matching task and
return `204`, or `404` when no task with that id exists.
# Acceptance Criteria
- [ ] `DELETE /tasks/:id` removes the task and returns `204`
- [ ] An unknown id returns `404`
# Verification
```sh
node --check src/todo.mjs
```
EOF
