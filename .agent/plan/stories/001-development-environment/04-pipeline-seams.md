# Story 4 — Pipeline seams

**Acceptance:** TDD memory + history + stories dirs exist; `/work` pre-flight
checks pass.

### Task S4-T1 — Seed `ts-gotchas.md` (maintainer; `.agent/tdd/*`)

**Pre-requirements.** None. (Deliberately first in the execution order — every
`src/` task requires reading it.)

**Input.** The pitfalls verified during planning: Node 24 type stripping,
`verbatimModuleSyntax`, `node:sqlite` behavior on Node 24.12.

**Action.** Create `.agent/tdd/memory/ts-gotchas.md` seeded with the verified
pitfalls:
- relative imports need explicit `.ts` extensions under type stripping;
- `verbatimModuleSyntax` → `import type` required for type-only imports;
- builtins imported via the `node:` prefix form;
- top-level await is fine in ESM;
- **`node:sqlite` prints `ExperimentalWarning` to stderr but exits 0
  (verified on 24.12)** — do not treat stderr noise as failure;
- `noUncheckedIndexedAccess` → indexed access types as `T | undefined`.

**Output.** `.agent/tdd/memory/ts-gotchas.md` — the living checklist engineers
(and this epic's maintainer session) read before any `src/` edit.

**Verify.** File exists and lists each pitfall above.

### Task S4-T2 — Create working dirs (maintainer)

**Pre-requirements.** None.

**Input.** The `/work` Step-2 pre-flight list and the engineer personas' journal
paths.

**Action.** Create with `.gitkeep`: `.agent/tdd/history/`,
`.agent/plan/stories/` (exists once this epic's files land),
`.agent/tdd/memory/test-engineer/`, `.agent/tdd/memory/software-engineer/`.

**Output.** The four directories, tracked in git via `.gitkeep`.

**Verify.** `ls -d .agent/tdd/history .agent/plan/stories \
.agent/tdd/memory/test-engineer .agent/tdd/memory/software-engineer` → all
succeed.

### Task S4-T3 — `/work` pre-flight smoke (maintainer, read-only)

**Pre-requirements.** S4-T2 (dirs exist).

**Input.** `/work`'s Step-2 checks (`.claude/commands/work.md`). `/work` has
**no dry-run mode**, so do not invoke it — run its checks directly.

**Action.** Run the read-only equivalent of `/work` Step 2:

```bash
test -f .agent/plan/epics/001-development-environment.md \
  && test -f .claude/agents/test-engineer.md \
  && test -f .claude/agents/software-engineer.md \
  && test -f .claude/agents/reviewer-engineer.md \
  && test -d .agent/tdd/history && echo "preflight OK"
```

**Output.** Confirmation that the pipeline is dispatchable for EPIC 002 —
`preflight OK` on stdout; nothing written, no subagent dispatched.

**Verify.** The command prints `preflight OK` and exits 0.
