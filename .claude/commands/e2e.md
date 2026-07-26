---
description: Run and inspect an end-to-end real-model feature build (the TODO-API E2E) through the kanthord CLI. Sets up resources, imports the graph, runs the daemon, drives the approve/recover loop, and verifies the real program — using the scripts under scripts/e2e/ instead of ad-hoc one-liners. Use when validating that all components work together on a real feature, or when hunting integration bugs.
argument-hint: [epic-tag e.g. 077]  (used only to name the isolated DB dir)
allowed-tools: Bash, Read, Write, Edit
---

# /e2e — end-to-end feature-build test playbook

Arguments: `$ARGUMENTS` (an epic tag such as `077`; defaults to a timestamp).
It only names the isolated workspace `./.data/e2e-<tag>/`.

Goal: drive a real feature (the 5-endpoint TODO API) from an empty repo to
completion through the CLI, exactly as the engineer would, and record + group
any bugs. Prefer the `scripts/e2e/*` helpers over re-deriving state by hand.

## Helpers (all under `scripts/e2e/`)

- `make-todo-graph.sh <dir>` — author the TODO-API graph package (initiative +
  objective + 5 tasks; the 4 read/update/delete tasks depend on the root create
  task). Real-model runs use this.
- `make-landing-graph.sh <dir>` — superset: same graph **plus** a
  `.fake-agent.json` so the **no-model** daemon can produce candidates
  deterministically (for wiring proofs).
- `e2e-status.sh <initiative-id>` — **the workhorse.** One call prints every
  task's status / deps / waiting, the initiative + per-objective status (the
  objective-branch workflow's real gate, 007.12), a legacy per-task
  landing-candidate `state` (only populated on the no-model/candidate path,
  `candidate:none` under the real-model objective-branch flow), and an event
  tally. Run it instead of `list task --json | node -e …`. Read-only.
- `e2e-smoke-todo.sh <todo.mjs> [port]` — boot the built server and assert the
  full CRUD cycle (POST 201, GET 200, PUT 200, unknown 404, DELETE 204,
  get-after-delete 404). This is the program-level proof the feature works.

Always run CLI commands with `node src/main.ts …` directly (not `npm start --`,
which mangles nested-subcommand `--help`). Export `KANTHORD_DB` to an isolated
relative DB so the run never touches `.data/kanthord.db`.

## Setup

```bash
export KANTHORD_DB="$PWD/.data/e2e-<tag>/kanthord.db"
node src/main.ts db migrate
PROJECT=$(node src/main.ts create project --name todo-e2e-<tag> | head -1)
```

1. **AI provider (ChatGPT Plus / gpt-5.6-terra).** `login provider` writes a
   **global provider row in the kanthord DB** and prints its id — no
   `~/.kanthord/accounts.json` file is ever written. That DB-backed store is
   isolated from any company github-copilot pi CLI.
   - Preferred: `node src/main.ts login provider --provider openai-codex
--name terra-oauth --method browser` — prints an `auth.openai.com` URL + waits
     on a `localhost:1455` callback. Run it in the **background**, surface the
     URL to the human, wait for the callback.
   - If a valid token already exists and a browser login is undesirable, use
     `register ai-provider --name terra --provider openai-codex --model gpt-5.6-terra
--value-file <seed>` to register a global provider with an API key value directly.
   - Assign the provider to the project: `node src/main.ts assign ai-provider
--project $PROJECT --provider $PROV_ID`.
   - Verify the catalog: `list model --provider openai-codex` shows
     `gpt-5.6-terra`. The real run itself is the live subscription check.
2. **Repository (throwaway `kanthorlabs/kanthord-verify`).** PAT credential →
   repo resource (https-token clone plumbing works via GIT_ASKPASS):
   ```bash
   CRED_PAT=$(node src/main.ts create credential --project $PROJECT --name gh-pat \
     --provider github --value-file .data/e2e-<tag>/pat.txt | head -1)
   REPO=$(node src/main.ts create repository --project $PROJECT --name verify \
     --remote-url https://github.com/kanthorlabs/kanthord-verify.git --branch main \
     --auth https-token --credential $CRED_PAT --path "$PWD/.data/e2e-<tag>/home" | head -1)
   ```
   For a **from-scratch** build, confirm `main` has no `src/todo.mjs` first
   (`git ls-remote` / a shallow clone).
3. **Import the graph:**
   ```bash
   scripts/e2e/make-todo-graph.sh .data/e2e-<tag>/graph
   node src/main.ts import graph .data/e2e-<tag>/graph --create --project $PROJECT \
     --bind source=$REPO
   ```
   The bind alias `source` is declared in `graph/initiative.md`. The daemon
   auto-resolves the AI provider chain from the project, so no `--bind provider`
   or `--bind cred` is needed. Capture the initiative id from
   `graph/.kanthord-export.json`.

## Run + inspect + land

```bash
node src/main.ts run daemon --until-idle --poll-interval 2000   # build (background it — real model)
scripts/e2e/e2e-status.sh <initiative-id>                       # see where everything stands
```

Objective-branch workflow (007.12): the daemon builds **all** ready tasks in one
run onto a single objective branch `kanthord/init/<initiative-id>`, unblocking
dependents inline as their deps complete. There is **no** per-task approve gate.
When every task is done the objective sits at `awaiting_confirmation`. Approve at
the **objective** level:

```bash
node src/main.ts approve objective --id <objective-id>   # brokers the commit into the bare home → objective integrated
```

The objective's tasks all edit the shared branch serially, so **no sibling
conflicts** occur (that was the old per-task-candidate failure mode). If the
objective reports a conflict (its base moved), use `retry objective --id
[--note "…"]` → re-run daemon → `approve objective`.

After integration the initiative reaches its local-done terminal state (see
EPIC 007.15) with an event. Delivering to the remote is a separate step:

```bash
node src/main.ts publish repository --repository <repo-id> --branch kanthord/init/<initiative-id>
```

(`get initiative --id <id>` prints the publishable `branch:` line.)

## Verify the real program

The landed code is on the objective branch `kanthord/init/<initiative-id>` in the
bare home, **not** on home `HEAD`/`main` (main moves only on publish):

```bash
git -C .data/e2e-<tag>/home show kanthord/init/<initiative-id>:src/todo.mjs > /tmp/todo.mjs
scripts/e2e/e2e-smoke-todo.sh /tmp/todo.mjs
```

## Gotchas (learned from prior runs — check these before filing a bug)

- **Conflict message prints to stderr** — capture `2>&1` when asserting it.
- **The landed code is on the objective branch** `kanthord/init/<initiative-id>`,
  not home `HEAD`/`main`. Extract from that ref (see Verify above).
- **`list event`** needs `--after <cursor>` (e.g. `--after 0`) and pages **10**
  rows without `--limit`, then prints a `more available — pass --after <cursor>`
  sentinel line; pass `--limit 1000` or follow that sentinel (007.7). `e2e-status.sh` counts from the DB, so it is not affected.
- **`get resource`, not `get repository` for arbitrary resources** — though
  `get repository --id` now works as an alias (007.15).

## Record findings

Write to `.agent/plan/epics/<epic>-e2e-findings.md`: each finding categorized
`critical | major | minor`, grouped by root cause, with a failure repro and a
suggestion. Group related bugs, `/debate` the fix approach, then author the
fix EPIC with a program-level `Proof:`.
