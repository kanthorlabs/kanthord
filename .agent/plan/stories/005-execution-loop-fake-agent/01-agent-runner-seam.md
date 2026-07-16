# Story 01 — AgentRunner seam (port, resolver, FakeRunner)

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

The execution seam EPIC 006 fills with pi: the `AgentRunner` port, the
resolver that picks a runner per task, and the deterministic `FakeRunner`
that is both the `--runner fake` implementation and the test double.

## Acceptance Criteria

- `src/agent-runner/port.ts` exports:
  - `TaskResult = { outcome: 'completed'; summary?: string } | { outcome: 'failed'; reason: string }`
  - `TaskContextBinding = { type: string; resourceId: string }` (the shape
    stored by EPIC 004's `task_context`)
  - `AgentRunner { run(task: Task, context: TaskContextBinding[]): Promise<TaskResult> }`
  - `AgentRunnerResolver { for(task: Task, context: TaskContextBinding[]): AgentRunner }`
  - `RunnerNotResolvableError { taskId, resourceId }`
- `src/agent-runner/fake.ts` exports `FakeRunner implements AgentRunner`:
  - constructor `{ failTaskIds?: string[] }`;
  - `run` resolves instantly: `{ outcome: 'completed', summary: 'fake' }`,
    or `{ outcome: 'failed', reason: 'scripted failure' }` when
    `task.id ∈ failTaskIds`;
  - records every call on a public
    `calls: Array<{ taskId: string; context: TaskContextBinding[] }>`.
- `src/agent-runner/resolver.ts` exports `RegistryRunnerResolver implements
  AgentRunnerResolver`, constructor `{ defaultRunner: AgentRunner }`:
  - context contains an `ai_provider` binding → throw
    `RunnerNotResolvableError` naming the task and the binding's resourceId
    (no AI runner exists in this epic; EPIC 006 adds a registry keyed by
    provider behind the same port — index B3, resolved);
  - otherwise → `defaultRunner`.

  (Superseded by EPIC 006 D2 — Ulrich, 2026-07-16, debate-reviewed: the
  resolver is re-keyed by `Task.agent` — constructor
  `{ runners: Map<string, AgentRunner> }`, unknown ref → throw
  `RunnerNotResolvableError { taskId, agent }`; the ai_provider-binding
  branch and `defaultRunner` are removed by EPIC 006 S05-T2. Build this
  story as written — EPIC 006 refactors it behind the unchanged
  `AgentRunnerResolver` port.)

## Constraints

- New capability directory `src/agent-runner/` per `AGENTS.md`; the port
  imports only `domain/`; adapters import only their `port.ts`. No I/O.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — port + FakeRunner

**Requires:** EPIC 002 S003-T2 (`Task`).

**Input:** `src/agent-runner/port.ts` (new), `src/agent-runner/fake.ts`
(new), `src/agent-runner/fake.test.ts` (new).

**Action — RED:** tests: (a) `FakeRunner.run(task, [])` resolves
`{ outcome: 'completed', summary: 'fake' }` and appends `{ taskId, context }`
to `calls`; (b) with `failTaskIds: [task.id]` it resolves
`{ outcome: 'failed', reason: 'scripted failure' }` (still recorded); (c) two
runs record two calls in order. Fails today: module does not exist.

**Action — GREEN:** implement `port.ts` (types + `RunnerNotResolvableError`)
and `FakeRunner`.

**Action — REFACTOR:** none.

**Output:** the `AgentRunner`/`TaskResult`/`TaskContextBinding` port and a
deterministic, call-recording `FakeRunner`.

**Verify:** `npm test` green (all three cases); `npm run typecheck` exit 0.

### Task T2 — RegistryRunnerResolver

**Requires:** S01-T1.

**Input:** `src/agent-runner/resolver.ts` (new),
`src/agent-runner/resolver.test.ts` (new).

**Action — RED:** tests: (a) `for(task, [])` returns the injected default
runner; (b) a `repository` binding still selects the default (non-AI
bindings don't select); (c) an `ai_provider` binding throws
`RunnerNotResolvableError` carrying `taskId` and the `resourceId`. Fails
today: module does not exist.

**Action — GREEN:** implement `RegistryRunnerResolver` per the AC.

**Action — REFACTOR:** none.

**Output:** the resolver seam: default-runner selection now, provider
registry later (EPIC 006) — behind an unchanged port.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
