# Story 001 - real tools built for the worktree

Epic: `.agent/plan/epics/019.15-real-agent-tools-via-pi-factories.md`

## Goal

Reuse pi-coding-agent's real tool factories to build the six file tools bound to
the task worktree cwd, and wire them into the live Agent in place of the no-op
stubs, so a `write`/`edit` actually mutates a file in the worktree and a
`read`/`ls`/`grep`/`find` actually reads it. `bash` is never built.

## Acceptance Criteria

- A helper (e.g. `buildWorktreeTools(cwd)`) returns the six real `AgentTool`s
  named `read`, `write`, `edit`, `grep`, `find`, `ls` — and **no** `bash` tool —
  each constructed from the pi-coding-agent factory for the given `cwd`.
- Executing the returned `write` tool with `{ path: "<rel>", content: "<x>" }`
  creates `<cwd>/<rel>` on disk with `<x>`; executing `read` with that path
  returns `<x>`. (Proves the tools are real + standalone + cwd-bound — the stub
  returned empty and wrote nothing.)
- In the live path, the Agent built by `spawnAgent` uses these real tools
  constructed for the **session worktree** (`worktreePath`), **filtered to the
  allowed tool manifest** (`opts.tools`) — a restricted manifest builds only those
  real tools; `bash` is always excluded. (The live path always has a worktree —
  `bootstrap-live-run.ts` wires `worktreeSlot` — so real tools are always used.)
- When no worktree/cwd is available (cwd-less unit tests only), the tool set still
  lists the manifest tools, but their `execute` returns a **loud error result**
  (`isError: true`, e.g. "no workspace bound: tool `<name>` unavailable"). It must
  **never** return a silent empty-success no-op — a silent no-op is the exact
  failure this Epic exists to remove.

## Constraints

- **Reuse the factories** `createReadTool` / `createWriteTool` / `createEditTool`
  / `createGrepTool` / `createFindTool` / `createLsTool` imported from
  `@earendil-works/pi-coding-agent` (each `create<X>Tool(cwd, options?)`, node-fs
  default operations) — do not hand-roll tools (`CLAUDE.local.md` reuse rule).
- **`bash` excluded by construction** — the bash factory is never called (Epic
  015). Keep the existing `PI_EXEC_TOOLS` exclusion invariant intact.
- **cwd == worktree** — the cwd passed to the factories MUST be the same directory
  passed to `makeRing1HookAdapter` as `worktree` (`sessionWorktreePath ?? featureDir`),
  so a relative model path resolves to one absolute path for both tool and policy.
- **Minimal seam** — a `src/agent/` helper + threading `worktreePath` into the
  tool build; do not adopt `createAgentSession` or any SDK session/auth/resource
  machinery.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  `pi-agent-adapter` / `run-deps` / `pi-session` tests pass; guard green.

### Task T1 - build the six real factory tools for a cwd (discover + helper)

**Input:** `src/agent/worktree-tools.ts` (new), `src/agent/worktree-tools.test.ts` (new)

**Action - RED:** a hermetic test (temp dir as cwd) imports `buildWorktreeTools`
and asserts: (a) it returns tools named exactly `read,write,edit,grep,find,ls`
and no `bash`; (b) invoking the `write` tool's `execute` with a relative `path` +
`content` creates the file under the temp cwd with that content; (c) invoking
`read` on that path returns the content. Fails today (`buildWorktreeTools` does
not exist). This test is also the **characterization** of the factory surface.

**Action - GREEN:** create `buildWorktreeTools(cwd: string): AgentTool[]` that
constructs the six real factory tools from `@earendil-works/pi-coding-agent` for
`cwd`, excluding bash.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/agent/worktree-tools.test.ts` green.

### Task T2 - the live Agent uses the real worktree tools

**Input:** `src/agent/pi-agent-adapter.ts`, `src/cli/run-deps.ts`,
`src/agent/pi-agent-adapter.test.ts`

**Action - RED:** a hermetic test asserts that when the agent is built for a
session with a `worktreePath`, its tool set is the real `buildWorktreeTools`
output for that worktree (real `execute`, not the empty stub) and excludes
`bash`. Fails today because `makeAgentOpts` builds stub tools.

**Action - GREEN:** thread `worktreePath` (already available in `spawnAgent`) into
the tool build so the live Agent's `tools` are `buildWorktreeTools(worktreePath ??
<ring-1 base dir>)`; keep the stub path only where no real tools apply (tests
without a cwd). Preserve `beforeToolCall`, `model`, `streamFn`, and the
`prepareNextTurnWithContext` model-call logging.

**Action - REFACTOR:** remove the now-dead stub-tool builder if T2 orphans it
(only if this change created the orphan).

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/agent/pi-agent-adapter.test.ts src/cli/run-deps.test.ts` green.
