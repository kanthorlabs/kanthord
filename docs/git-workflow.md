# Kanthord Git Workflow

How kanthord moves code from an agent's edits to your remote.

This covers the objective-branch workflow (EPICs 007.11–007.13). An initiative
targets a single repository. Per-task candidate landing and the EPIC 007.14
transplant recovery are in §6.

---

## 1. Glossary

| Term                          | Meaning                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remote (origin)**           | The upstream git server. The source of truth for _delivered_ work. Only `publish` writes to it.                                                                                                    |
| **Bare managed home**         | A kanthord-owned **bare** git repo (objects + refs, **no working tree**). A cache of landed work. Created once with `git clone --bare` from the remote.                                            |
| **Integration tip**           | `refs/heads/main` in the bare home — the base a new initiative branches from.                                                                                                                      |
| **Initiative branch**         | `refs/heads/kanthord/init/<initId>` in the bare home. One branch per initiative.                                                                                                                   |
| **Isolated clone**            | The agent's working copy: `git clone --no-hardlinks --single-branch --branch <initBranch> <home>`, then **`origin` removed**. The agent edits here — it has no configured git remote back to home. |
| **Initiative**                | A feature. Maps to one initiative branch and one isolated clone.                                                                                                                                   |
| **Objective**                 | A unit of an initiative that becomes **exactly one commit** on the initiative branch.                                                                                                              |
| **Task**                      | A working unit inside an objective. Tasks of an objective run **sequentially** in the clone.                                                                                                       |
| **Squash**                    | At the objective boundary: `git reset --soft <parentOid>` + `git commit` — collapses the objective's commits into one, in the clone.                                                               |
| **Broker**                    | The daemon-side step of `approve objective`: fetch the squashed commit from the clone into home, check it is exactly one commit past the parent, then CAS-advance the initiative branch.           |
| **CAS (compare-and-swap)**    | `git update-ref <ref> <newOID> <expectedOID>` — advances a ref only if it still points where we expect. Guards against concurrent moves.                                                           |
| **Land (locally landed)**     | Work whose commit is on a ref **in the bare home**. It is _not_ on the remote yet.                                                                                                                 |
| **Publish / publication**     | The explicit operator step that pushes a landed branch to the remote. Distinct from landing.                                                                                                       |
| **Publication state**         | Per (repository, branch): `unpublished` (no record) / `published@<remoteOID>` / `diverged`.                                                                                                        |
| **Fast-forward push**         | `publish` pushes fast-forward. When a prior remote OID is known it adds a `--force-with-lease=<ref>:<oid>` guard so an unexpectedly-moved remote is **rejected**, not clobbered.                   |
| **Scope-filtered claim**      | The queue hands out the next task only if its initiative has no task already running. Serializes tasks per initiative (per clone) while letting different initiatives/projects run in parallel.    |
| **Approval gate**             | Human step: `approve objective` (objective workflow) or `approve task` (per-task landing).                                                                                                         |
| **Objective conflict**        | Broker found the squash was not exactly one commit onto the tip, or the CAS failed → objective goes to `conflict` for re-resolution.                                                               |
| **Runner candidate output**   | The runner's internal `outcome: "candidate"` for a changed run. In the objective workflow this completes the task — it does **not** create a durable landing record.                               |
| **Durable landing candidate** | A persisted `landing_candidates` row created for a repository-bound task **without** a workspace binding. Basis for `approve task` and the 007.14 transplant.                                      |
| **Transplant**                | Deterministic 3-way replay (`git merge-tree`, no model) of a stale candidate onto a moved base.                                                                                                    |

---

## 2. Topology & invariants

Three stores, one direction of trust:

```mermaid
flowchart LR
    R[("Remote (origin)<br/>delivered work")]
    subgraph HOME["Bare managed home — no working tree"]
      MAIN["refs/heads/main<br/>(integration tip)"]
      IB["refs/heads/kanthord/init/&lt;initId&gt;<br/>(initiative branch)"]
    end
    C["Isolated clone<br/>--no-hardlinks --single-branch<br/>origin removed"]

    R -->|"git clone --bare (once)"| MAIN
    MAIN -->|"provision branch"| IB
    IB -->|"clone --branch initBranch"| C
    C -.->|"agent edits here (no remote back to home)"| C
```

Invariants:

- The home is **bare** — no working tree can drift out of sync.
- The isolated clone has **no configured git remote** back to home. The agent
  writes only the clone; it never advances a home ref itself.
- Home refs are advanced only by the **kanthord control plane** (the daemon's
  broker on `approve objective`, and landing use cases) — never by agent code.
- The **remote** is written only by `publish`. Nothing else pushes.
- "Locally landed" (a commit on a home ref) is always distinguishable from
  "delivered" (pushed to the remote) via the per-target **publication state**.
- **One task at a time per initiative.** The clone is per-initiative, so tasks
  of one initiative are serialized: the queue's **scope-filtered claim** never
  hands out a task from an initiative that already has a running task. Different
  initiatives (and different projects) may run in parallel; tasks _within_ an
  initiative are strictly sequential, in dependency order.

### Ref ownership

| Ref                             | Lives in            | Written by                                                   | How                                     |
| ------------------------------- | ------------------- | ------------------------------------------------------------ | --------------------------------------- |
| `refs/heads/main`               | Remote **and** home | Remote: PR merge (out of scope). Home: fetch of merged main. | —                                       |
| `refs/heads/kanthord/init/<id>` | Bare home           | Daemon broker                                                | CAS `update-ref` on `approve objective` |
| (working commits)               | Isolated clone      | Agent                                                        | edit + commit; squashed at boundary     |
| `refs/heads/kanthord/init/<id>` | Remote              | `publish repository`                                         | fast-forward push (+ lease guard)       |

---

## 3. The workflow (flowchart)

```mermaid
flowchart TB
    START(["Initiative created + graph imported<br/>(bound to ONE repository)"])
    PROV["Daemon provisions initiative branch<br/>from home main tip"]
    CLONE["Daemon clones it → isolated clone<br/>(--no-hardlinks --single-branch, origin removed)"]
    TASKS["Agent runs the objective's tasks<br/>SEQUENTIALLY in the clone"]
    SQUASH["Objective boundary:<br/>git reset --soft parent + commit<br/>= 1 squashed commit"]
    AWAIT["Objective → awaiting_confirmation"]
    APPROVE{"Human: approve objective?"}
    BROKER["Broker: fetch commit into home<br/>count == 1 ? CAS update-ref initBranch"]
    CONFLICT["Objective → conflict<br/>(resolve in clone, re-squash, re-broker)"]
    MORE{"More objectives?"}
    PR["All integrated → initiative awaiting_pr<br/>(branch complete in home)"]
    PUB["Human: publish repository --branch initBranch<br/>fast-forward push (+ lease guard)"]
    REMOTE[("Remote: initiative branch delivered<br/>publication = published@remoteOID")]

    START --> PROV --> CLONE --> TASKS --> SQUASH --> AWAIT --> APPROVE
    APPROVE -->|yes| BROKER
    BROKER -->|"count==1 & CAS ok"| MORE
    BROKER -->|"count!=1 or CAS mismatch"| CONFLICT
    CONFLICT --> AWAIT
    MORE -->|"yes (next objective builds on this tip)"| TASKS
    MORE -->|no| PR --> PUB --> REMOTE
```

Result: **one commit per objective**, linear history on the initiative branch,
each commit gated by a human before it enters the bare home.

---

## 4. State machines

These are **separate** state machines. They are related but must not be read as
one chart.

**Task** (objective workflow — a task completes; the _objective_ is the
integration unit):

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> running: daemon claims
    running --> completed: changed run committed in clone
    running --> failed: error / budget exhausted
    running --> awaiting_confirmation: agent escalated (frozen proposal)
    failed --> pending: retry task
    awaiting_confirmation --> completed: approve task
    awaiting_confirmation --> pending: reject --resolution retry
    completed --> [*]
```

**Objective:**

```mermaid
stateDiagram-v2
    [*] --> building
    building --> awaiting_confirmation: all tasks completed → squash to 1 commit
    awaiting_confirmation --> integrated: approve objective (broker: count==1 + CAS)
    awaiting_confirmation --> conflict: count != 1 or CAS mismatch
    conflict --> awaiting_confirmation: resolve in clone → re-squash → re-broker
    integrated --> [*]
```

An **integrated non-tip objective is immutable** — `retry objective` on it is
refused with corrective-objective / restart guidance.

**Initiative:**

```mermaid
stateDiagram-v2
    [*] --> building
    building --> awaiting_pr: all objectives integrated
    awaiting_pr --> delivered: defined, but not driven by publish yet
```

`awaiting_pr` means the branch is complete in home and ready to publish. The
`delivered` transition is defined in the domain but not driven in production:
`publish` records **publication** state and does not move the initiative.

**Publication** (per repository + branch):

```mermaid
stateDiagram-v2
    [*] --> unpublished: no record
    unpublished --> published: publish (fast-forward ok)
    published --> published: publish again (fast-forward)
    published --> diverged: remote moved unexpectedly (lease rejected)
    diverged --> published: publish after the divergence is resolved
```

---

## 5. Operating sequences

Actors: **Human**, **CLI**, **Daemon**, **Agent**, **Clone** (isolated clone),
**Home** (bare home), **Remote**.

### 5a. Start from fresh — first initiative through delivery

```mermaid
sequenceDiagram
    actor H as Human
    participant CLI
    participant D as Daemon
    participant A as Agent
    participant C as Clone
    participant Home as Home
    participant Rem as Remote

    Note over H,Rem: one-time — create project + repository → Home = git clone --bare from Remote
    H->>CLI: import graph (initiative, objectives, tasks) --bind source=REPO
    H->>CLI: run daemon
    D->>Home: provision refs/heads/kanthord/init/ID from main tip
    D->>C: clone --no-hardlinks --single-branch --branch initBranch, then remote remove origin
    loop objective A tasks (sequential)
        D->>A: run task in clone
        A->>C: edit files + commit
        A-->>D: completed
    end
    D->>C: boundary — git reset --soft parent + commit (1 squashed commit)
    D-->>H: objective A → awaiting_confirmation
    H->>CLI: approve objective A
    CLI->>D: broker
    D->>C: fetch objective commit into Home
    D->>Home: count==1 ? CAS update-ref initBranch OID PARENT
    D-->>H: objective A → integrated (initBranch = 1 commit ahead of main)
    Note over D: all objectives integrated → initiative awaiting_pr
    H->>CLI: publish repository --branch initBranch
    CLI->>Home: read landed local tip
    CLI->>Rem: fast-forward push initBranch (+ lease guard if prior OID known)
    Rem-->>CLI: ok → publication = published@remoteOID
```

### 5b. Process the next task after finishing one (within an objective)

```mermaid
sequenceDiagram
    participant D as Daemon
    participant A as Agent
    participant C as Clone

    Note over D,C: an objective's tasks run one at a time, in dependency order
    D->>A: run task T1 in clone
    A->>C: edit + commit
    A-->>D: T1 completed → enqueue newly-ready dependents
    D->>A: run task T2 (same clone, builds on T1)
    A->>C: edit + commit
    A-->>D: T2 completed
    Note over D,C: when ALL objective tasks completed →<br/>squash to 1 commit → objective awaiting_confirmation
```

### 5c. Process the next objective after finishing one

```mermaid
sequenceDiagram
    actor H as Human
    participant D as Daemon
    participant C as Clone
    participant Home as Home

    Note over H,Home: objective A already integrated — initBranch is 1 commit ahead of main
    D->>C: objective B tasks run sequentially in the SAME clone (on top of A's tip)
    D->>C: boundary — squash B's commits into 1 (parent = A's commit)
    D-->>H: objective B → awaiting_confirmation
    H->>D: approve objective B (broker)
    D->>Home: count==1 ? CAS update-ref initBranch B_OID A_OID
    D-->>H: objective B → integrated (initBranch = 2 commits ahead, linear)
    Note over D: all objectives integrated → initiative awaiting_pr
```

### 5d. Process the next initiative after finishing one

```mermaid
sequenceDiagram
    actor H as Human
    participant CLI
    participant D as Daemon
    participant C2 as New clone
    participant Home as Home

    Note over H,Home: previous initiative published to the remote — its branch is complete in Home
    opt bring Home main up to date
        H->>CLI: refresh Home main from the remote (after the PR merges — out of scope)
    end
    H->>CLI: import graph (initiative 2, ONE repository), then run daemon
    D->>Home: provision refs/heads/kanthord/init/ID2 from CURRENT main tip
    D->>C2: fresh clone of the new initiative branch (origin removed)
    Note over D,C2: same objective → squash → broker → publish cycle, isolated per initiative
```

Each initiative gets its own branch and its own isolated clone. A new initiative
branches from whatever `main` points to in home at provision time. Home `main`
advances only when the delivered branch is merged on the remote and that merged
`main` is fetched back.

---

## 6. Per-task candidate landing & transplant recovery (007.14)

A repository-bound task that runs without a workspace binding produces a
**landing candidate**: the task holds at `awaiting_confirmation`, and
`approve task` lands the candidate onto its target branch by advancing the ref
(CAS `update-ref`). An initiative task carries a workspace binding and takes the
objective workflow instead (§3–§5).

If the base moves before approval, the candidate is stale. `retry task --refresh`
recovers it deterministically, without the model:

```mermaid
sequenceDiagram
    actor H as Human
    participant CLI
    participant D as Daemon

    Note over H,D: stale landing candidate — base moved after it was built
    H->>CLI: retry task --refresh
    CLI->>D: deterministic 3-way transplant (git merge-tree, NO model) onto moved base
    alt zero conflicts AND verification gate passes
        D->>D: new candidate SHA + new base SHA → awaiting_confirmation
        Note over D: prior approval NEVER carries — FRESH approval required
        D-->>H: candidate.transplanted event
    else any conflict OR gate fails
        D->>D: fall back to full model rebuild (retry task --rebuild)
    end
```

---

## 7. Constraints

- **One repository per initiative.** Provisioning uses the first repository
  binding for the whole initiative; a mixed/multi-repository initiative would
  run tasks against the wrong clone. Bind exactly one repository.
- **Concurrency is serialized per initiative, parallel across them.** The
  queue's claim is scope-filtered: it will not start a task from an initiative
  that already has one running, so the single per-initiative clone is never
  mutated by two tasks at once — regardless of how many daemon processes run.
  Separate initiatives and projects still run concurrently.
- **Delivery is a separate, human-gated step.** A completed objective that is
  `integrated` is _locally landed_ in the bare home. It reaches the remote only
  via an explicit `publish`. Automatic push (the deferred `pr@1` agent) is not
  implemented.
- **Publish does not force by default.** The first publish is a plain
  fast-forward push. A `--force-with-lease` guard is added only to reject a
  remote that moved off a known OID. After a recorded divergence, a later
  publish leases against that recorded OID.
