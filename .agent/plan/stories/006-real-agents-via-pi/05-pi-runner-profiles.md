# Story 05 — PiAgentRunner + agent profiles

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The real `AgentRunner`: resolve context resources, fail fast on
credentials, prepare the workspace, load the target repo's instruction files,
render the task specification into the user prompt, and run one shared pi
`Agent` loop parameterized by an adapter-private `PiAgentProfile` (D2). The
resolver is re-keyed by agent ref; `generic@1` (pi) and `fake@1` (EPIC 005
FakeRunner) are registered in the composition root.

**Prompt construction (Ulrich, 2026-07-16, debate-reviewed).** Two seams:
- **User prompt** = a pure, vendor-neutral renderer over the Task spec
  (`title` + `instructions` + `ac`); the runner appends the retry-feedback
  block. Task stays pure data — it never builds prompt strings.
- **System prompt** = the profile (layer 1) + the target repo's instruction
  files (layer 2), loaded through a kanthord-owned, profile-neutral
  `InstructionLoader` capability (`src/instruction/`). The runner loads once
  and passes the neutral `Instruction[]` INTO the profile, which owns
  placement — so a future kanthord-native role agent (TestEngineer /
  SoftwareEngineer / ReviewerEngineer) reuses the SAME loader with its own
  prompt representation. pi's own context auto-discovery stays OFF (one source
  of truth). Security hardening of the loader (realpath/symlink enforcement,
  size caps) is deferred to a dedicated later epic — this story locks only the
  discovery SEMANTICS, not the enforcement code.

**Binding goal (Ulrich, 2026-07-16): the Generic agent does its work with
the SDK exposed by `@earendil-works/pi-coding-agent`.** `generic@1`'s
tools are exclusively the SDK's coding tools —
`createCodingTools(workspace.dir)` (read / write / edit / grep / find /
ls / bash), imported from `@earendil-works/pi-coding-agent` — plus the
runner's `escalate` built-in. kanthord writes NO tool implementation of
its own for `generic@1`; if an SDK surface does not fit, mirror pi's logic
per the reuse-first rule and say so explicitly (grep evidence required).

## Acceptance Criteria

- **`src/instruction/` capability (new — kanthord-owned, profile-neutral).**
  - `src/instruction/port.ts`: `type Instruction = { path: string; content:
    string }` (kanthord's own type — pi's `ContextFile` never leaks into this
    port); `interface InstructionLoader { load(): Instruction[] }`; and the
    pure policy constant `INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']`
    (array order = precedence order).
  - `src/instruction/repo.ts`: `RepoInstructionLoader implements
    InstructionLoader`, **ctor `(workspaceDir: string)`** (option A — the
    source is bound at construction so the port's `load()` stays
    source-agnostic); `load()` returns, in `INSTRUCTION_CANDIDATES` order, one
    `Instruction` per candidate that exists as a regular file directly at the
    workspace root, with `path` **workspace-relative** and `content` its text.
    Locked discovery semantics: workspace-root only (NO ancestor walk — the
    deliberate divergence from pi's `loadProjectContextFiles`); BOTH
    `AGENTS.md` and `CLAUDE.md` load if both present (pi picks one; we do not);
    missing candidate → skipped; unreadable candidate → skipped this epic
    (a diagnostic channel is future); `*.local.md` is NOT a candidate
    (gitignored, absent from a fresh clone — debate). No pi types imported.
- `src/agent-runner/task-prompt.ts` (new, vendor-neutral, shared by any
  runner): pure `renderTaskPrompt(task: Task): string` → the user prompt from
  `title` + `instructions` + `ac` (fixed template; `ac` rendered as a list).
  No pi types, no I/O. The pi runner appends the retry-feedback block AFTER
  this (feedback is attempt-state the renderer does not own).
- `src/agent-runner/pi-profile.ts` (adapter-private — pi types never enter
  `port.ts`): `PiAgentProfile { name: string; systemPrompt(input: { task:
  Task; workspace: Workspace; instructions: Instruction[] }): string;
  createTools(input: { workspace: Workspace }): AgentTool[]; verify(evidence:
  OutcomeEvidence): Promise<VerificationResult> }` (evidence/verify types land
  in story 06; this story stubs `verify` for `generic@1` as
  accepted-when-changed). The profile — NOT the runner — decides where the
  loaded `instructions` go in its system-prompt string (debate B1: heterogeneous
  runtimes need per-profile placement; the runner does not append a universal
  block). `generic@1`: its `createTools` returns exactly
  `createCodingTools(workspace.dir)` from the
  `@earendil-works/pi-coding-agent` SDK (the binding goal above) — no
  kanthord-authored tools; its `systemPrompt` states the workspace dir, the
  branch, "complete the task; committing is optional; never push", and appends
  the `instructions` under a `<project_context>` block. NOTE: pi's
  `buildSystemPrompt` is NOT in the public `index` export (only under
  `core/system-prompt`), so `generic@1` MIRRORS pi's `<project_context>`
  wrapping rather than deep-importing it (reuse-first tier 2 — verify the
  export surface at implementation before choosing import vs mirror).
- `src/agent-runner/pi.ts` `PiAgentRunner implements AgentRunner`, ctor
  `{ sessions: ProviderSessionFactory; workspaces: WorkspaceManager;
  newInstructionLoader: (workspaceDir: string) => InstructionLoader;
  getResource: (id: string) => Resource | undefined; profiles:
  Map<string, PiAgentProfile>; getPriorRejection: (taskId: string) =>
  { reason: string; summary?: string; proposalCommit?: string } |
  undefined }` (`newInstructionLoader` is the per-task factory — workspaceDir
  is known only after prepare; main.ts wires it to
  `dir => new RepoInstructionLoader(dir)`; emit/clock/maxTurns land in story 08;
  `getPriorRejection` is wired to `TaskRepository.getTaskResult`'s
  rejection columns in main.ts).
  `run(task, context)` order:
  1. profile = `profiles.get(task.agent)` — missing → failed
     `UnknownAgentError: <ref>` (defense in depth; the resolver normally
     catches this).
  2. `ai_provider` binding → `getResource` → must be AIProvider else failed
     `InvalidContextError`; `credential` binding required → must be
     Credential else failed `CredentialError: task has no credential
     context`.
  3. `sessions.for(aiProvider, credential)` — CredentialError /
     UnknownModelError → failed; workspace never prepared (fail fast).
  4. workspace source: exactly one of `repository`/`filesystem`; none →
     failed `WorkspaceUnresolvableError`; both → failed
     `InvalidContextError`.
  5. `workspaces.prepare(task.id, source)` — WorkspacePreparationError →
     failed.
  5b. `const instructions = newInstructionLoader(workspace.dir).load()` — the
     target repo's instruction files (may be empty).
  6. pi `Agent`: `state.tools = profile.createTools(...)` **plus the
     runner-provided built-in `escalate` tool** (see below), session's
     model/streamFn/getApiKey, `profile.systemPrompt({ task, workspace,
     instructions })`, `prompt(renderTaskPrompt(task) + feedback block)`,
     `waitForIdle()`. pi context auto-discovery stays disabled (the Agent loop
     is driven directly; `instructions` is the only context source).
     **Retry feedback (D4 debate B3):** when `getPriorRejection(task.id)`
     returns a decision, the prompt gains a feedback block — "a previous
     attempt was escalated and the human rejected it: <reason>" (+ the
     prior summary when present) — appended AFTER `renderTaskPrompt(task)` so
     a rejected-for-retry task never re-runs blind.
  7. result capture per story 06; any stream/run rejection → failed
     `<Name>: <message>`.
- **The `escalate` tool (the ONLY escalation trigger — Ulrich,
  2026-07-16):** the runner appends `escalate({ reason: string })` to every
  profile's tool set — a runner capability, never profile-specific. Calling
  it records the reason on the run and ends the loop (the runner stops the
  agent after the tool resolves; no further turns). Every profile's system
  prompt (via a shared preamble the runner supplies) states: "if you need a
  human decision to proceed or to accept your work, call escalate with a
  clear reason."
- `RegistryRunnerResolver` re-keyed (supersedes EPIC 005 S01 — annotated
  there): ctor `{ runners: Map<string, AgentRunner> }`;
  `for(task, context)` → `runners.get(task.agent)` or throw
  `RunnerNotResolvableError { taskId, agent }` (RunNextTask already maps
  resolver throws to named task failures — EPIC 005 locked path).
- main.ts `buildDaemon`: `PiProviderSessionFactory`,
  `LocalWorkspaceManager(KANTHORD_WORKSPACE_ROOT ?? <db dir>/workspaces)`,
  `newInstructionLoader = dir => new RepoInstructionLoader(dir)`,
  `PiAgentRunner` with the `generic@1` profile; runners map
  `{ 'generic@1': piRunner, 'fake@1': fakeRunner }`; the same map's keys
  back the `AgentCatalog` given to `CreateTask`. `daemon run --runner` is
  removed (superseded by per-task agent refs — annotated in EPIC 005 docs);
  `--fail <task-id>` still builds the FakeRunner's `failTaskIds`.

## Constraints

- One shared loop: profiles are data + pure functions; the runner owns
  loop, session, and (later) budget/events. No profile owns a model or a
  credential (D2 debate S3).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.
- **SDK-goal check:** a test asserts `generic@1`'s tool set is exactly the
  pi-coding-agent SDK's coding-tool set (tool names deep-equal the SDK's
  `createCodingTools` output) plus `escalate`; and
  `src/agent-runner/pi-profile.ts` imports its tools from
  `@earendil-works/pi-coding-agent` (no local tool implementations —
  reviewable by grep).
- **Loader-boundary check:** `src/instruction/port.ts` and
  `src/instruction/repo.ts` import NO pi package (grep-reviewable) — the
  capability is vendor-neutral and does not depend on the agent runner.

### Task T1 — profiles + runner orchestration

**Requires:** S02-T1; S03-T1/T2; S04-T1/T2; EPIC 005 S01-T1.

**Input:** `src/instruction/port.ts`, `src/instruction/repo.ts`,
`src/agent-runner/task-prompt.ts`, `src/agent-runner/pi-profile.ts`,
`src/agent-runner/pi.ts` (new, + tests).

**Action — RED:** hermetic tests with FakeSessionFactory + a fake
WorkspaceManager + stub getResource: (a) happy path (`generic@1`, scripted
final text) → completed, prepare called with the repository source, the
Agent received the profile's tools + system prompt (recorded via the fake
session); (b) missing credential binding → failed `CredentialError:`
prefix, session factory never called; (c) factory CredentialError →
failed, prepare NOT called; (d) no repo/fs binding → failed
`WorkspaceUnresolvableError`; both → failed `InvalidContextError`; (e)
unknown profile key → failed `UnknownAgentError:`; (f) scripted stream
rejection → failed (resolves, never throws/hangs); (g) two synthetic
profiles produce different prompts/tools through the SAME runner instance
(the D2 pluggability proof); (h) the Agent's tool set contains `escalate`
alongside the profile tools, and a scripted `escalate({ reason })` call
ends the run after that turn (no further scripted turns are consumed),
recording the reason; (i) SDK-goal check: `generic@1`'s tool names
deep-equal the names of `createCodingTools(dir)` from
`@earendil-works/pi-coding-agent`, plus `escalate`; (j) with a stubbed
`getPriorRejection` returning a decision, the prompt recorded by the fake
session contains the feedback block (reason + prior summary); without one,
no feedback block; (k) **instruction loader semantics** (temp dirs, no pi):
a workspace with both `AGENTS.md` + `CLAUDE.md` → `load()` returns both, in
that order, `path` workspace-relative; only `CLAUDE.md` → one entry; neither →
`[]`; a nested `sub/AGENTS.md` is NOT returned (workspace-root only, no
ancestor/descendant walk); (l) **renderer** `renderTaskPrompt(task)` includes
`title`, `instructions`, and each `ac` line, and is pure (no pi import, no
I/O); (m) **profile placement**: the system prompt recorded by the fake
session contains the loaded instruction content under a `<project_context>`
block, and a synthetic profile that ignores `instructions` produces a prompt
WITHOUT it (proving the profile — not the runner — owns placement). Fails
today: modules absent.

**Action — GREEN:** implement the `InstructionLoader` port +
`RepoInstructionLoader`, `renderTaskPrompt`, the profile interface,
`generic@1`, and runner steps 1–7 (including step 5b + the new
`systemPrompt`/`prompt` wiring).

**Action — REFACTOR:** none.

**Output:** a real-agent AgentRunner, profile-parameterized, passing
hermetic scripted runs.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — resolver re-key + composition root

**Requires:** T1; S02-T3; EPIC 005 S07-T2 (buildDaemon).

**Input:** `src/agent-runner/resolver.ts`, `src/main.ts`,
`src/apps/cli/daemon.ts` (+ tests).

**Action — RED:** resolver tests: (a) `for(task{agent:'generic@1'})` →
the registered runner; (b) `for(task{agent:'ghost@9'})` → throws
`RunnerNotResolvableError` carrying taskId + `'ghost@9'`. Wiring tests
(temp DB): (c) a `fake@1` task (created with the now-required
`--instructions`/`--ac`) runs through the EPIC 005 FakeRunner end to end
(`daemon run --until-idle`, no `--runner` flag); (d)
`daemon run --runner fake` → exit 1 `error: unknown flag --runner`
(superseded); (e) the AgentCatalog wired into `create task` accepts
exactly the registered refs. Fails today: re-key absent.

**Action — GREEN:** re-key the resolver; rewire `buildDaemon` + the daemon
handler; back the catalog with the runners map keys.

**Action — REFACTOR:** delete the now-dead ai_provider-binding selection
branch from the resolver (orphan created by this change).

**Output:** `daemon run` routes every task by its agent ref — pi and fake
side by side.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
