# EPIC 006 — Real agents via pi

## Goal

The `AgentRunner` seam gets its real implementation: a task executed by an
actual AI agent built on the `@earendil-works` pi packages (per the
reuse-pi-first rule — pi-agent-core's `Agent` loop + pi-coding-agent's tool
factories), working inside a prepared git workspace with resolved
AIProvider/Credential/Repository resources. After this epic, kanthord performs
a real (small) software-engineering task end to end — the project Goal in
miniature.

## Verification Gate

Gates:  `npm run typecheck && npm test`   (hermetic — pi adapter tested
        against a faked model session; no network in tests)
Proof:  (fresh EPIC 004-style setup shell; `SANDBOX` is a local throwaway
        git repo; the AIProvider's key is a real one resolved from env)

```bash
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate
# ... EPIC 004-style creates, plus:
node src/main.ts create ai-provider --project "$PROJECT" \
  --name openai --provider openai --model gpt-5.6 --secret-ref OPENAI_API_KEY
node src/main.ts create repository --project "$PROJECT" \
  --name sandbox --path "$SANDBOX" --branch main
TASK=$(node src/main.ts create task --objective "$OBJECTIVE" \
  --title "add a title line to README" \
  --context repository=<sandbox-resource-id> --context ai_provider=<openai-resource-id>)

node src/main.ts daemon run --until-idle
node src/main.ts get task "$TASK"
# prints completed + the TaskResult: workspace path, branch
# kanthord/<task-id>, commit sha, summary.
git -C "<printed workspace path>" log --oneline -1
# shows the agent's commit on branch kanthord/<task-id> — the commit lives
# in the task WORKSPACE clone, not the original sandbox repo (debate
# finding); nothing is pushed.
node src/main.ts events --after 0   # shows the agent's progress events.

# failure path: unset the key env var, retry the task —
# it fails with a named credential error (no hang), daemon exits non-zero.
```

## Stories

- **Resource authority (decision, debate B7).** The **database is the single
  resource store** — resources enter via EPIC 004's `create <resource-type>`
  commands. `secretRef` names an env var resolved **at use time**; secrets are
  never stored in the DB or any file. `import resource kanthord.yaml` is added
  as a pure convenience that runs the same resource-creation use cases from a
  YAML declaration file — an import, not live configuration and not a second
  source of truth.
- **PiAgentRunner adapter.** `agent-runner/pi.ts` implementing the EPIC 005
  port on pi-agent-core's `Agent` with pi-coding-agent's tool factories
  (read/write/edit/grep/find/ls/bash) scoped to the task workspace. Check
  installed `.d.ts` exports first; mirror pi logic where a surface doesn't
  fit — never hand-roll what pi already solved.
- **Provider session.** AIProvider resource → pi model/credential session
  (pi-ai `createModels`/`streamSimple` family) behind a resolver port;
  hermetic tests fake the session at that seam.
- **Workspace preparation.** Repository + Filesystem resources → a per-task
  workspace: clone or copy the repo, create branch `kanthord/<task-id>`,
  hand the agent that directory; workspace paths recorded on the task.
- **Result capture.** Agent outcome → commit on the task branch **in the
  task workspace clone** → TaskResult (workspace path, branch name, commit
  sha, summary) persisted and printed by `get task`; the workspace is kept
  after completion so the human can inspect/push the branch. Agent progress
  mapped to events (agent-started, tool-call summaries throttled,
  agent-finished).
- **Failure and budget guards.** Invalid credential, unreachable provider, or
  a turn/step budget exceeded → task fails with a named error and an event;
  the daemon survives and moves on.

## Non-goals

- No PR creation or GitHub API calls — the deliverable is a local branch +
  commit; PR workflows (`pr@1`) are a later epic.
- No multi-agent workflows (`tdd@1` with TestEngineer/ReviewerEngineer
  role-play) — one Generic agent per task.
- No cross-repo orchestration polish — one repository per task is enough
  here.
