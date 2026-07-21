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
  task's status / deps / waiting, the per-task landing-candidate `state`
  (the internal lifecycle field no CLI exposes — `pending`/`conflict`/`landed`),
  and an event tally. Run it instead of `list task --json | node -e …` +
  raw `landing_candidates` SQL. Read-only.
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

1. **AI provider (ChatGPT Plus / gpt-5.6-terra, effort medium).** The OAuth
   account lives in kanthord's OWN store `~/.kanthord/accounts.json` (provider
   `openai-codex`) — this is isolated from any company github-copilot pi CLI.
   - Preferred: `node src/main.ts login provider --provider openai-codex
--project $PROJECT --name terra-oauth --method browser` — prints an
     `auth.openai.com` URL + waits on a `localhost:1455` callback. Run it in the
     **background**, surface the URL to the human, wait for the callback.
   - If a valid token already exists and a browser login is undesirable, the
     human can seed the credential value from `~/.kanthord/credentials.json`
     (the tool classifier blocks the agent from reading that secret store — ask
     the human to run the copy). Then
     `create credential --provider openai-codex --value-file <seed>`.
   - `create ai-provider --project $PROJECT --name terra --provider openai-codex
--model gpt-5.6-terra --effort medium`.
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
     --bind source=$REPO --bind provider=$PROV --bind cred=$CRED_OAUTH
   ```
   The bind aliases (`source`/`provider`/`cred`) are declared in
   `graph/initiative.md`. Capture the initiative id from
   `graph/.kanthord-export.json`.

## Run + inspect + land

```bash
node src/main.ts run daemon --until-idle --poll-interval 2000   # build (background it — real model)
scripts/e2e/e2e-status.sh <initiative-id>                       # see where everything stands
```

The candidate gate holds each finished task at `awaiting_confirmation`. `approve
task --id <id>` lands it and unblocks dependents. Re-run the daemon to build the
newly-unblocked tasks. Repeat until `e2e-status.sh` shows N/N completed.

**Conflict recovery** (siblings that edit one file conflict once the base moves):
`approve` reports the conflict, then `get conflict --id` → `retry task --id
[--note "…"]` → re-run daemon (rebuilds on the fresh base) → `approve`.

## Verify the real program

```bash
git -C .data/e2e-<tag>/home show HEAD:src/todo.mjs > /tmp/todo.mjs
scripts/e2e/e2e-smoke-todo.sh /tmp/todo.mjs
```

## Gotchas (learned from prior runs — check these before filing a bug)

- **Help:** `node src/main.ts <cmd> help <sub>` shows subcommand help;
  `<cmd> <sub> --help` prints the ROOT help (known minor bug).
- **Conflict message prints to stderr** — capture `2>&1` when asserting it.
- **`approve` does not (yet) persist the candidate `state`** — see EPIC 007.8.
  Until fixed, `e2e-status.sh` shows completed tasks with `candidate:pending`,
  and the `get conflict`/`retry` recovery loop is a dead end via `approve`.
- **`list event`** silently caps at ~100 rows; pass `--limit 1000` or follow the
  `{"nextCursor":…}` sentinel (007.7). `e2e-status.sh` counts from the DB, so it
  is not affected.
- **Sibling serialization:** N siblings editing one file each need a full re-run
  on the moved base — expected cost, not a bug.

## Record findings

Write to `.agent/plan/epics/<epic>-e2e-findings.md`: each finding categorized
`critical | major | minor`, grouped by root cause, with a failure repro and a
suggestion. Group related bugs, `/debate` the fix approach, then author the
fix EPIC with a program-level `Proof:`.
