# Glossary

kanthord uses a small invented vocabulary. One entry per term; deeper detail
lives in the PRD section cited. Read this once before the PRD — it makes the
dense parts readable.

## Planning

| Term | Meaning |
|---|---|
| **Plan Contract** | The typed document any planner hands to kanthord: epic/story/task markdown files with frontmatter. kanthord lints it like a compiler and rejects invalid plans. It is a coordination contract, not a correctness contract. (PRD §7.1) |
| **Shape** | The structural type of a whole plan — how a feature is decomposed and what discipline its tasks follow. MVP hardcodes exactly one: `tdd@1`. (PRD §7.1.1) |
| **Workflow** | How one *task* executes (phases, gates, checkpoint). Shape is plan-level; workflow is task-level. (PRD §10) |
| **Filename grammar** | `<major>[.<lane>]-<slug>`: the file/directory name carries ordering and parallelism. Same major = same group; `N.1`/`N.2` lanes = parallel-intended. The filesystem is the hierarchy — no pointers in frontmatter. (PRD §7.1.1 §4) |
| **Compile / sign-off** | The explicit action that lints the plan and lowers it to SQLite rows. Nothing runs before sign-off. (PRD §7.1.1 §7) |
| **Generation (G / G+1)** | A counter stamped on every successful compile. Running tasks stay pinned to the generation they started under. (PRD §7.1.1 §7) |
| **Dirty plan** | Any edit to covered plan files after sign-off marks the plan dirty: new dispatch halts until a recompile mints G+1. (PRD §7.1.1 §7) |
| **Handoff / `frozen` / `draft_ok`** | A cross-task dependency edge on a declared output. `frozen` (default): consumer waits for the final artifact. `draft_ok`: consumer may start against a draft and accepts rework risk. (PRD §7.3) |
| **Contract artifact** | An authored boundary file (`.proto`, `openapi.yaml`, …) stored in the feature directory. Publisher exit gate and consumer entry gate compare its hash — coordination without shared agent sessions. (PRD §7.2) |
| **Re-planning** | A first-class flow: a running task signals the plan is wrong → plan diff → human approves → affected subgraph re-opens. Always edits the authored files and recompiles. (PRD §7.5) |

## Execution

| Term | Meaning |
|---|---|
| **Repo slot** | The durable per-repo home: checkout/worktrees, config, search index, leases. Long-running. (PRD §3.2) |
| **Session** | One in-process pi `Agent` instance doing a task. Ephemeral by design: torn down at task boundaries, respawned from STATE.md. Never an OS child process. (PRD §3.2) |
| **Respawn-equivalence** | The invariant that makes teardown safe: after any respawn, the pending-task set, lease ownership, current phase, and injected STATE match the pre-respawn values. Compaction, task-boundary, and crash recovery share this one code path. (PRD §7.7) |
| **Compaction** | When a session's context passes ~50–60% of the model window: checkpoint → kill → respawn fresh. (PRD §3.2) |
| **Lease** | A per-capability lock (write-scope paths, ports, test DBs, emulators…) with expiry + heartbeat. Disjoint scopes run in parallel; any shared capability serializes. (PRD §7.3) |
| **`write_scope`** | The per-task declaration of which paths it may write. Enforced deterministically; an out-of-scope write is blocked and treated as a re-planning signal. (PRD §4) |
| **`single_checkout`** | Slot strategy for disk-heavy repos (mobile): one checkout, one lease, park/resume via named WIP commits — never `git stash`. (PRD §3.3) |
| **Gate** | A machine-checkable entry/exit condition on a node. The `tdd@1` pair: entry `failing_test_exists`, exit `tests_pass`. (PRD §7.1.1 §8) |
| **Deploy chain** | DAG stages after "PR open": read-only observers + explicit success criteria + a soak window. Pass notifies the human; fail halts with evidence. The merge button stays human. (PRD §7.4) |
| **Soak** | "Observe for N minutes" as part of a deploy gate — deploys that look healthy at 90 seconds can fall over at minute five. (PRD §7.4) |

## Broker & security

| Term | Meaning |
|---|---|
| **Broker** | The only door to the outside world. Agents submit **typed verbs**; the broker executes, audits, and holds all credentials. Never a generic HTTP proxy. (PRD §5) |
| **Verb / verb registry** | One declared entry per operation (`github.create_pr`, `jira.comment`…) with tier, timeout, idempotency, retry, and reconcile path. The approval matrix is literally the registry's `tier` column. (PRD §5) |
| **Tier** | `auto` / `auto_with_audit` / `approval_required` — who gets to say yes. (PRD §5) |
| **Always-async** | Every broker call returns an operation id; the task parks and the scheduler wakes it when the completion row lands in SQLite. One wake-up mechanism, no callbacks. (PRD §5) |
| **Operation ledger** | Durable entries in the task's markdown (`op_id`, idempotency key, external correlation, desired-effect hash). After a crash, reconciliation queries real remote state and resolves each interrupted op. (PRD §5) |
| **Ring 1 / 2 / 3** | The security model. Ring 1: deterministic policy — write-scope, path policy, secret scan, budget breaker, no agent network. Ring 2: LLM risk classifier, advisory. Ring 3: human approval. (PRD §4) |
| **Budget circuit-breaker** | Fail-closed per-task cost ledger: spend is reserved before each model call; breach halts and escalates; survives respawns — a respawn cannot reset it. (PRD §4) |
| **Escalation** | Any event that needs the human, delivered to the inbox with typed evidence. Doubles as a metric event. (PRD §2) |
| **Interaction type** | Every human touch is classified: `approval` / `clarification` / `correction` / `takeover` / `external`. `takeover` is the honest capability-gap signal. (PRD §2) |

## Storage & operations

| Term | Meaning |
|---|---|
| **Markdown = truth, SQLite = derived** | The division of truth: files are synced and human-readable; the database is a rebuildable local index, never synced. (PRD §6.1) |
| **Single-writer invariant** | Only the daemon writes the markdown store. Two daemons at once is out of scope and documented as a constraint. (PRD §6.1) |
| **STATE / JOURNAL / RUNBOOK** | Per-node docs with different disciplines: STATE.md — bounded, rewritten, what a fresh session gets injected; `*.journal.jsonl` — append-only history; RUNBOOK.md — mutable "how to execute here" guidance, injected into every spawn, excluded from the plan hash. (PRD §6.2, §7.1.1 §6) |
| **Projection contract** | The versioned, documented mapping of which SQLite fields derive from markdown vs. runtime-only. What makes "rebuildable" a testable claim. (PRD §6.1) |
| **`kanthord verify`** | Rebuilds a shadow database from markdown and diffs it against the live one; the drift detector for the single-writer convention. (PRD §6.1) |
| **Ticket drift** | The external ticket changed after sign-off. Detected by re-hashing at every phase boundary; default is signal-and-keep-working. (PRD §6.3) |
| **Clone-on-sign-off** | Ticket content is snapshotted into the task at sign-off; work happens against the clone, drift is measured against it. (PRD §6.3) |
| **Dead-man ping** | Daily "alive, N tasks processed" message. Crash-restart catches a dead daemon; the ping catches the worse failure — up but silently idle. (PRD §3.1) |
| **fff** | The daemon-owned search index per repo slot (typo-resistant path/content search, frecency). Lives in the daemon so respawned sessions get it warm. (PRD §6.4) |
| **Harness** | The deterministic test kit: fake clock, fake broker, temp SQLite, temp git repo, crash/restart entrypoint. Named scenarios are the phase gates; fakes are permanent test doubles. (PRD §7.7) |
