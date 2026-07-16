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
        against a faked model session; no network in tests. The suite
        includes the SDK-goal check: `generic@1`'s tool set deep-equals
        `createCodingTools()` from the `@earendil-works/pi-coding-agent`
        SDK, plus the runner's `escalate` built-in — Ulrich, 2026-07-16.)
Proof:  (fresh EPIC 004-style setup shell; `SANDBOX` is a local throwaway
        git repo used as the repository's pre-seeded local home; the
        credential value is a real key. Proof rewritten 2026-07-16 —
        debate-reviewed with Ulrich: gpt-5.6 is not in the installed pi-ai
        0.80.3 catalog (gpt-5.5 is the highest), credentials are Credential
        resources with stored values (D0), repositories carry
        organization + local-home path (D1), `get task` takes `--id`, the
        failure path is exact commands, and an escalation phase exercises
        D3.)

```bash
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate
# ... EPIC 004-style creates (PROJECT, INITIATIVE, OBJECTIVE), plus:
git -C "$SANDBOX" remote add origin https://github.com/kanthorlabs/sandbox.git
AIPROV=$(node src/main.ts create ai-provider --project "$PROJECT" \
  --name openai --provider openai --model gpt-5.5)
CRED=$(node src/main.ts create credential --project "$PROJECT" \
  --name openai-key --provider openai --value "$OPENAI_API_KEY")
REPO=$(node src/main.ts create repository --project "$PROJECT" \
  --name sandbox --organization kanthorlabs --branch main --path "$SANDBOX")
TASK=$(node src/main.ts create task --objective "$OBJECTIVE" \
  --title "add a title line to README" \
  --instructions "Edit README.md at the repo root: add a top-level markdown H1 title line." \
  --ac "README.md begins with a level-1 markdown heading" \
  --context repository=$REPO --context ai_provider=$AIPROV --context credential=$CRED)

node src/main.ts daemon run --until-idle; echo "exit=$?"   # exit=0
node src/main.ts get task --id "$TASK"
# prints completed + the TaskResult: workspace path, branch
# kanthord/<task-id>, commit sha, summary.
git -C "<printed workspace path>" log --oneline -1
# shows the agent's commit on branch kanthord/<task-id> — the commit lives
# in the task WORKSPACE clone, not the sandbox home (debate finding);
# nothing is pushed.
node src/main.ts events --after 0   # task.started → agent.started →
                                    # agent.progress → agent.finished →
                                    # task.completed

# escalation path (D3): the AGENT decides it needs help — the task title
# instructs it to escalate; it parks for human confirmation.
TASK2=$(node src/main.ts create task --objective "$OBJECTIVE" \
  --title "add a second line to README, then call escalate to request human review of your change" \
  --instructions "Add a second line to README.md, then call the escalate tool to request human review of your change." \
  --ac "README.md has a second line" \
  --context repository=$REPO --context ai_provider=$AIPROV --context credential=$CRED)
node src/main.ts daemon run --until-idle; echo "exit=$?"   # exit=0 +
                                    # "1 task(s) awaiting confirmation"
node src/main.ts list task --status awaiting_confirmation  # shows TASK2
node src/main.ts approve task "$TASK2"
node src/main.ts get task --id "$TASK2"                    # completed;
                                    # commit_sha = the approved proposal

# failure path (exact commands): a provider-mismatched credential fails
# fast with a named error — no hang, daemon exits non-zero.
BADCRED=$(node src/main.ts create credential --project "$PROJECT" \
  --name wrong-provider --provider anthropic --value bogus)
TASK3=$(node src/main.ts create task --objective "$OBJECTIVE" \
  --title "this fails" \
  --instructions "Any change; this task is expected to fail on a provider-mismatched credential." \
  --ac "n/a" \
  --context repository=$REPO --context ai_provider=$AIPROV --context credential=$BADCRED)
node src/main.ts daemon run --until-idle; echo "exit=$?"   # exit=1
node src/main.ts get task --id "$TASK3"                    # failed,
                                    # reason starts CredentialError
```

## Stories

- **Resource authority (decision, debate B7).** The **database is the single
  resource store** — resources enter via EPIC 004's `create <resource-type>`
  commands. `import resource kanthord.yaml` is added as a pure convenience
  that runs the same resource-creation logic from a YAML declaration file —
  an import, not live configuration and not a second source of truth.
  (Amended by D0 — Ulrich, 2026-07-16, superseding the original "secretRef
  names an env var; secrets are never stored" rule: `Credential.value`
  stores the secret — API key or OAuth JSON — because OAuth tokens force
  storage and pi-ai's CredentialStore refresh expects a writable store;
  every persisted string passes a credential-value redactor. Out-of-box
  auth: OpenAI OAuth via `login <provider>`, and OpenAI-compatible API key;
  `AIProvider` gained `baseUrl?`.)
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
- **Task specification + prompt construction (D5).** `Task` gains required
  `instructions` + `ac`; a pure renderer turns the spec into the user prompt.
  A kanthord-owned, profile-neutral `InstructionLoader` (`src/instruction/`)
  reads the target repo's `AGENTS.md`/`CLAUDE.md` at the workspace root and
  the runner passes them into the profile, which places them in the system
  prompt — one loader the future native role agents reuse. Loader security
  hardening is a separate later epic.
- **Result capture.** Agent outcome → commit on the task branch **in the
  task workspace clone** → TaskResult (workspace path, branch name, commit
  sha, summary) persisted and printed by `get task`; the workspace is kept
  after completion so the human can inspect/push the branch. Agent progress
  mapped to events (agent-started, tool-call summaries throttled,
  agent-finished).
- **Failure and budget guards.** Invalid credential, unreachable provider, or
  a turn/step budget exceeded → task fails with a named error and an event;
  the daemon survives and moves on.

(Amended 2026-07-16 — Ulrich's D2/D3/D5 rulings, debate-reviewed, expanded the
epic during story authoring: `Task.agent` ships as a required versioned ref
(`generic@1`) resolved by a re-keyed `AgentRunnerResolver`, with
adapter-private pi profiles; **the Generic agent does its work with the SDK
exposed by `@earendil-works/pi-coding-agent`** (`createCodingTools` — a
story-05 verification gate); every profile explicitly verifies its output
over runner-computed evidence; and escalation is a first-class flow decided
**solely by the agent** (the runner-provided `escalate` tool — no
human-mandated confirmation flag): an escalated task parks in
`awaiting_confirmation` with a frozen proposal commit, resolved by
`approve task` / `reject task`. Full contracts:
`.agent/plan/stories/006-real-agents-via-pi/index.md`.)

## Non-goals

- No PR creation or GitHub API calls — the deliverable is a local branch +
  commit; PR workflows (`pr@1`) are a later epic.
- No multi-agent workflows (`tdd@1` with TestEngineer/ReviewerEngineer
  role-play) — one Generic agent per task.
- No cross-repo orchestration polish — one repository per task is enough
  here.
