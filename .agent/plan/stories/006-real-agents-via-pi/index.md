# EPIC 006 — Real agents via pi · story index

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. Dispatched through `/work` (engineer lanes). One story per
file; one use case per file (verb-first), per `AGENTS.md`.

## Stories (build order = dependency order)

1. [Resource contract amendments — Repository / Credential / AIProvider](01-resource-contracts.md)
2. [Domain & storage groundwork — Task.agent, acceptance policy, status, events, migration 5](02-domain-storage-groundwork.md)
3. [Workspace preparation — local home + task clones](03-workspace.md)
4. [Provider session — pi-ai, API key + OAuth, `login`](04-provider-session.md)
5. [PiAgentRunner + agent profiles](05-pi-runner-profiles.md)
6. [Verification & result capture](06-verification-results.md)
7. [Escalation — awaiting_confirmation, approve / reject](07-escalation.md)
8. [Progress events, redaction & budget guards](08-progress-events-guards.md)
9. [`import resource <file.yaml>`](09-import-resources.md) — off the Proof
   critical path; /work schedules it after stories 01–08.
10. [End-to-end smoke test](10-e2e-smoke.md)

## Locked decisions (all debate-reviewed with Ulrich, 2026-07-16)

### Resources (D0, D1)

- **DB is the sole resource authority.** Resources enter via
  `create <resource-type>`; `import resource` (story 09) is a batch
  convenience over the same construction logic, all-or-nothing in one
  UnitOfWork transaction — never a second source of truth.
- **Credential stores the secret (D0).** `Credential = { provider, value }`
  — `value` is the API key, or the serialized OAuth credential JSON.
  **Supersedes** the epic's earlier "secrets are never stored in the DB"
  rule (Ulrich, 2026-07-16): OAuth tokens force storage, and pi-ai's
  `CredentialStore` refresh model expects a writable store. Consequence:
  every persisted `reason`/`summary`/event string passes a redactor that
  strips credential values (story 08).
- **Out-of-box auth methods (D0):** OpenAI OAuth and OpenAI-compatible API
  key. The credential kind is discriminated by its `value`: JSON-parsable
  OAuth credentials vs an opaque API-key string. `login <provider>` runs
  pi-ai's OAuth flow and writes the credential (story 04).
- **AIProvider gains connection properties (D0):**
  `{ provider, model, baseUrl? }` — `baseUrl` targets OpenAI-compatible
  endpoints; absent means the provider's default endpoint from pi-ai's
  catalog.
- **Repository (D1):** `{ organization: string; branch: string;
  path: string }` + base `name`. The remote URL is constructed, never
  stored: `https://github.com/<organization>/<name>.git` (GitHub + https
  only this epic). `path` is the repo's **local home** — the destination of
  the remote clone AND the source of every task-workspace clone. Default
  `~/.kanthord/repos/<organization>/<name>`; expanded/normalized to an
  absolute path at creation time.
- **Home semantics (D1 debate):** missing → clone to a temp sibling, rename
  into place (atomic, partial-clone safe); existing → must be a git repo
  whose `origin` matches the constructed URL (identity check — resource
  metadata and code can never silently disagree); anything else →
  `WorkspacePreparationError`. No fetch in this epic — home state is a
  snapshot and may be stale (documented). kanthord never writes to the home
  after the initial clone.

### Agents (D2)

- **`Task.agent` ships** (supersedes the EPIC 002/005 deferral): a required,
  opaque, **versioned** reference (`generic@1`; versioning matches the
  README's `tdd@1`/`pr@1` convention — a queued/retried task keeps its
  meaning when a profile evolves). The domain checks only non-empty; the
  CLI defaults `--agent generic@1` (default lives at the CLI boundary, not
  in `newTask`).
- **The universal plugin boundary stays `AgentRunnerResolver`** (locked in
  EPIC 005): re-keyed by agent ref — `Map<AgentRef, AgentRunner>`; unknown
  ref → `RunnerNotResolvableError { taskId, agent }` → named task failure
  through the existing EPIC 005 path. EPIC 006 registers `generic@1` →
  `PiAgentRunner` and `fake@1` → EPIC 005's `FakeRunner`.
  `daemon run --runner` is **superseded** by per-task agent refs
  (annotated in EPIC 005's docs; smoke tests use `--agent fake@1`).
- **`PiAgentProfile` is pi-adapter-private** (vendor types never enter a
  core port): `{ name; systemPrompt(input); createTools(input);
  verify(evidence) }` — data + pure functions parameterizing ONE shared pi
  Agent loop. Model/credential choice stays with the AIProvider/Credential
  resources, never the profile.
- **Binding goal (Ulrich, 2026-07-16): the Generic agent does its work
  with the SDK exposed by `@earendil-works/pi-coding-agent`.**
  `generic@1`'s tools are exclusively the SDK's
  `createCodingTools(workspace.dir)` (+ the runner's `escalate` built-in);
  kanthord authors no tools of its own for it. Marked as a verification
  gate in story 05 (tool-set deep-equal test + import check).
- **`AgentCatalog` port** (`has(ref): boolean`): `CreateTask` validates the
  agent ref at creation; execution still handles a missing ref.

### Verification & escalation (D3, two debate rounds)

- **Runner owns evidence; profiles own judgment.**
  `OutcomeEvidence = { baseCommit; finalDiff: { files; hasChanges /* vs
  base, incl. untracked */ }; finalResponse }` — normalized by the runner;
  `verify(evidence): Promise<VerificationResult>` (async now so future
  command-running verifiers don't churn the contract).
- **Two-valued verdict:**
  `{ verdict: 'accepted'; evidence } | { verdict: 'rejected'; code:
  'NO_CHANGES' | 'UNEXPECTED_CHANGES' | 'MISSING_RESPONSE'; message }` —
  structured codes, never parsed strings; the runner maps codes to the
  EPIC 005 `reason` string at the boundary.
- **Escalation is solely the agent's decision (Ulrich, 2026-07-16 —
  supersedes the earlier `acceptancePolicy`/`--confirm` design from the
  same day):** there is NO human-mandated confirmation flag. The runner
  appends one built-in `escalate({ reason })` tool to every profile's tool
  set (a runner capability, not profile-specific); the profile's system
  prompt tells the agent to call it when it needs a human decision. Calling
  it records the reason and ends the run. Precedence: an agent `escalate`
  call short-circuits `verify()` entirely — the actor's review IS the
  verification for that run; otherwise the profile verdict decides.
- **No-change escalation is allowed** (the agent may escalate as a pure
  question, before changing anything): no proposal commit is created
  (`proposal_commit` NULL); `approve` then completes the task without a
  `commitSha`; `reject` + `retry` re-runs it fresh. Answer-and-resume
  steering of an escalated agent is a later epic (needs the quality loop).
- **The proposal is frozen before confirmation** (D3 round 2 — a mutable
  workspace is a time-of-check/time-of-use bug): on an agent `escalate`
  call the runner creates a **proposal commit** on
  `kanthord/proposal/<task-id>` (kanthord git identity, untracked files
  included; skipped when there are no changes) and returns the third
  TaskResult variant `{ outcome: 'escalated'; reason; proposalCommit?;
  baseCommit; summary; workspace; branch }`. Approval promotes; it never
  creates content ("the agent is barred from acceptance, not the runner
  from snapshotting").
- **`awaiting_confirmation` status** with edges
  `running→awaiting_confirmation`, `awaiting_confirmation→completed`
  (approve), `awaiting_confirmation→pending` (reject-to-retry),
  `awaiting_confirmation→discarded` (reject-to-discard). There is NO
  `awaiting_confirmation→failed` edge — an escalated task exits only
  through a human decision (D4). Claimable stays "pending only"; crash
  recovery never touches it; dependents do not enqueue until `completed`.
  Escalated ≠ failed → daemon exit 0, plus an end-of-run summary line
  naming tasks awaiting confirmation.
- **`approve task <id>`** — guards status + stored `proposalCommit` match
  (stale/duplicate decisions rejected; re-approve is an idempotent no-op):
  promote `kanthord/proposal/<task-id>` → `kanthord/<task-id>`
  (`git branch -f`, idempotent), persist completed TaskResult
  (`commitSha = proposalCommit`), `task.approved` + `task.completed`
  events, enqueue newly-ready dependents. Works after a daemon restart.
  A NULL `proposal_commit` (no-change escalation) skips promotion and
  completes without a `commitSha`.
- **`reject task <id> --resolution <retry|discard> [--reason <text>]`
  (D4, debate-reviewed 2026-07-16)** — the resolution is REQUIRED (no
  default: a wrong silent default either abandons planned work or burns
  tokens; a single enum flag extends to future cases without new flags).
  One `RejectTask` use case, one DB transaction, structured decision
  persisted (`task_results.rejection_resolution` + `rejection_reason`) +
  `task.rejected { code: 'REJECTED_BY_ACTOR', resolution, message, actor,
  proposalCommit? }`:
  - **`retry`** — direct edge `awaiting_confirmation→pending`, **no
    `task.failed`** (debate B1: a review decision is not an execution
    failure — emitting failure would poison audit/metrics/retry-limits;
    trail reads escalated → rejected → ready). The task is claimable
    again; the next daemon scan enqueues it (pending-without-job is the
    architecture's normal, scan-healed state — no direct job insertion).
  - **`discard`** — new TERMINAL status `discarded` (own status, not
    failed-with-marker: retry guards, list filters, and dependency logic
    must read intent from status alone), edge
    `awaiting_confirmation→discarded`, events `task.discarded` + one
    `task.blocked { dependencyId }` per direct dependent (the pull-feed
    notice that the blockage is now permanent). Workspace + proposal kept
    (audit; no GC). The rejected proposal's sha/evidence survive in DB +
    events; content-level archiving is an accepted, documented gap.
- **Rejection idempotency (D4 debate B4):** repeating the SAME resolution
  on an already-rejected task → no-op success (safe client retry); a
  CONFLICTING resolution, or reject-after-approve/approve-after-reject →
  `RejectionConflictError`; anything else non-parked →
  `TaskNotAwaitingConfirmationError`.
- **Retry feedback (D4 debate B3):** the next attempt must see why it was
  rejected — the runner reads the persisted rejection
  (reason + prior summary + rejected proposal sha) via an injected lookup
  and appends a feedback block to the prompt; "blind re-run produces the
  same result" is the failure mode this prevents.
- **Discarded dependents:** readiness stays "all dependencies completed",
  so the scan naturally never enqueues them — no new scheduler rule.
  Visibility: `get task --id` on a dependent names each unmet dependency
  with its status; the `task.blocked` event notifies. Unblocking is the
  human's explicit act with the existing EPIC 004 re-arrange tooling
  (dependents are still `pending`, so dependency replacement is legal);
  the next scan then picks the task up normally. No cascade-discard, no
  auto-unblock.
- **Human confirmation only in this epic.** Actor identity is an audit
  label (`{ actor: 'human' }`) — no authentication (single-engineer tool).
  **Cross-epic constraint for the workflow epic:** an agent-actor confirmer
  must be triggered by proposal-readiness (the `task.escalated` event),
  never modeled as an ordinary completion dependent (deadlock).
- **`generic@1` policy, explicit:** requires a non-empty final diff
  (`NO_CHANGES` otherwise) — unless the agent escalated, which
  short-circuits verify. Future roles per Ulrich's ruling:
  ReviewerEngineer — empty diff required + structured review response
  (`UNEXPECTED_CHANGES` if it edited code); TestEngineer/SoftwareEngineer —
  non-empty diff.

### Execution mechanics

- **Every workspace is a git repo:** repository sources are clones of the
  home on `kanthord/<task-id>`; filesystem sources are copied, `git init` +
  initial commit + the same branch — so `baseCommit` is always defined and
  evidence/proposals are uniform. `Workspace = { dir; branch; baseCommit }`.
- **Hermetic seam = the provider session** (pi types stay inside the
  adapter): `ProviderSession = { model, streamFn, getApiKey }`;
  `ProviderSessionFactory.for(aiProvider, credential)`. Real factory on
  pi-ai (`createModels`, auth/CredentialStore, OAuth refresh persisted back
  through an injected save); `FakeSessionFactory` scripts turns against the
  REAL pi `Agent` + REAL `createCodingTools` in temp dirs — fake model,
  real tools/git, no network (precedent: real-SQLite adapter tests).
- **Credential failures fail fast** before any workspace work:
  `CredentialError` (provider mismatch, unparsable OAuth value),
  `UnknownModelError` — named task failures; messages never contain a
  credential value.
- **Deterministic git identity:** every kanthord-issued git commit runs
  with `-c user.name="kanthord" -c user.email="kanthord@localhost"`.
  git runs via `node:child_process` `execFile` — no new dependency.
- **All runner-known failures return `failed`, never throw:**
  CredentialError, UnknownModelError, InvalidContextError,
  WorkspaceUnresolvableError, WorkspacePreparationError,
  ResultCaptureError, BudgetExceededError, verification `rejected` codes,
  and any provider stream rejection → `{ outcome: 'failed', reason:
  '<Name>: <message>' }`. Unknown throws stay safe via EPIC 005's
  rejected-promise rule.
- **Context requirements for a pi task:** `ai_provider` + `credential`
  (matching `provider` values) + exactly one of `repository`/`filesystem`.
- **Events:** `agent.started {workspace}`, `agent.progress {tool, summary ≤
  200}` throttled to one per 5000 ms per run (first immediate; injected
  clock), `agent.finished {outcome}`; emitted via injected
  `emit(taskId, type, payload)` wired to `EventFeed.append` in main.ts
  (synchronous — order holds; the runner never imports storage).
- **Budget:** `maxTurns` (default 50; `KANTHORD_MAX_TURNS`, invalid → one-
  line startup error exit 1); exceeded → `Agent.abort()` (verified export,
  `pi-agent-core/dist/agent.d.ts:96`) → failed `BudgetExceededError`.
- **Trust boundary (explicit non-goal):** `createCodingTools(dir)` roots
  the tools' cwd but does NOT sandbox bash/absolute paths/network. EPIC 006
  runs a trusted local agent without OS isolation; the ring-1
  `beforeToolCall` guard is a later epic.
- **Workspace retention:** workspaces are kept after completion (the human
  inspects/pushes; kanthord never pushes); wiped only on retry re-prepare.
  No GC this epic — `KANTHORD_WORKSPACE_ROOT` (default
  `<dir of KANTHORD_DB>/workspaces`) is user-cleanable.

## Storage/queue capability map (defined once; each story implements its slice)

```
migration 5 (S02):    tasks.agent TEXT NOT NULL DEFAULT 'generic@1'
                      task_results(task_id PK/FK, workspace, branch, base_commit,
                                   proposal_commit, commit_sha, summary, reason,
                                   rejection_resolution, rejection_reason)
TaskRepository (S02): agent round-trip on save/get
                      saveTaskResult(taskId, result) -> void      # upsert
                      getTaskResult(taskId) -> TaskResult row | undefined
AgentCatalog (S02):   has(ref: string) -> boolean                 # create-time validation
WorkspaceManager(S03):prepare(taskId, source: Repository | Filesystem)
                        -> Promise<Workspace { dir; branch; baseCommit }>
workspace fns (S07):  promoteProposal(dir, taskId, proposalCommit) -> void
ListTasks (S07):      gains a --status filter
```

## Cross-epic amendments (annotated "superseded by EPIC 006", never silent)

- EPIC 002 S002 — Repository / Credential / AIProvider variant fields.
- EPIC 002 S003 — `Task.agent` in the canonical model; deferral table
  updated.
- EPIC 002 S004 — transition table: `awaiting_confirmation` + 3 edges.
- EPIC 002 S006 — EVENT_TYPES + 6 literals.
- EPIC 004 S04 — resource flag tables (`credential --value`,
  `repository --organization --branch [--path]`, `ai-provider [--base-url]`).
- EPIC 005 index + S01 — resolver re-keyed by agent ref; `--runner`
  superseded; TaskResult third variant; daemon-semantics notes.
- EPIC 006 epic file — Proof rewritten (gpt-5.5 catalog fix, `get task
  --id`, credential + escalation phases, exact failure-path commands).

## Non-goals (from the epic + debates)

No PR creation / GitHub API; no multi-agent workflows (one agent per task;
agent-actor confirmation designed for, not shipped); no cross-repo
orchestration; no OS sandboxing of tools; no workspace GC; no fetch/freshness
policy for repo homes; no actor authentication; no human-mandated
confirmation flag (escalation is solely the agent's decision — Ulrich,
2026-07-16); no answer-and-resume steering of an escalated agent (quality
loop, later epic); no `failed→discarded` edge (abandoning a plain failed
task is a sibling feature, not the rejection flow); no un-discard/re-open;
no cascade-discard; no third rejection resolution yet (the enum is the
extension point); initiative-completion rules for discarded/blocked tasks
deferred to the epic that adds initiative progress.
