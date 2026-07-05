# Phase 1 — End-to-End Acceptance Testsuite

Status: **spec / runbook** (authored 2026-07-03). Executable the day Phase 1
builds green. Source of truth for the Phase-1 → Phase-2 gate, in human- and
AI-followable form.

Sources: `.agent/plan/prd.md` (PRD), `.agent/plan/phases.md` (Phase 1),
Epic `010-harness-scenario-suite` (the automated gate), Epic
`009-daemon-shell-and-transport` (transport seam), Epic `000-milestone-setup`
(toolchain gate).

---

## 0. What this suite is (and is not)

- **Is:** a step-by-step acceptance runbook. Each test case has exact commands,
  one observable pass/fail assertion, the Phase-1 criterion it maps to, and a
  human manual-verify checkbox. An agent can follow it verbatim; a human can
  re-run any step and read the same result.
- **Is not:** a second implementation of the tests. The real assertions live in
  the Epic 010 harness (`src/harness/*.test.ts`). This runbook **drives and
  observes** those suites; it defines no new mechanism (mirrors Epic 010's
  "composition only, no new production mechanism" rule).
- **No browser, no UI, no video.** Phase 1 ships no web client (phases.md;
  Epic 009 Non-Goals). The only network surface is a **read-only** Connect
  status API + `/healthz` on **loopback**. So this suite is CLI/harness-driven.
  The evidence artifact is the **saved test output + the green CI run URL**, not
  a screen recording.

### Phase-1 invariants this suite must never violate

- **No LLM call, no network egress, no external credential** anywhere in the run
  (phases.md §72). Enforced by a suite-level guard (see G3). The single
  exemption is **loopback** (`127.0.0.1`/`::1`) sockets for the transport test.
- **Everything downstream of the seams is a fake** — fake clock, fake broker
  (success/failure/timeout/regression), temp SQLite, temp git repo (PRD §7.7).
- **All time is the fake clock.** No real `sleep`, no wall-clock waiting; soak
  timers and expiries advance the fake clock (PRD §7.7).

---

## 1. Command surface (read before running)

**Stable commands** (safe to depend on):

| Command | Meaning |
|---|---|
| `npm run typecheck` | `tsc` type-check of `src/`; must exit 0 |
| `npm test` | full `node:test` harness suite under the guards |
| `node --test <file>` | run one scenario file directly (Node 24 built-in runner) |

**Provisional commands** (name pinned when the entrypoint lands; flagged inline
below): the daemon boot entrypoint used in TC-11. Its exact invocation is
settled by Epic 009 Story 001 + the SU4 findings file
(`.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`).
Until then, TC-11 falls back to running the Epic 009 Story 002 test file, which
asserts the same properties in-process.

**Not a Phase-1 command:** `kanthord verify --from-markdown --read-only` is
**Phase 2A** (phases.md 2A deliverable 7). Phase-1 projection equality is proven
by the harness (`rebuildFromMarkdown` + `projectionOf`, TC-09), **not** by a
CLI. Do not add the verify CLI to any step below.

---

## 2. Preconditions (must all hold before any test case)

- [ ] **P1 — Toolchain gate green.** Epic 000 SU1–SU5 all verified: `yaml`
  dependency present; SQLite access path chosen and probed (WAL + busy_timeout);
  Connect deps + generated **read-only** stubs committed; Connect-on-Node-24
  spike findings file exists; CI wired to run `npm test` under the guards.
- [ ] **P2 — Node 24+.** `node --version` ≥ v24. (`"type": "module"`, ESM.)
- [ ] **P3 — Clean build.** `npm run typecheck` exits 0.
- [ ] **P4 — Golden fixture present.** The one golden `tdd@1` feature fixture
  exists (two stories, one parallel lane, one artifact handoff, one gate pair,
  one deploy chain) — the scenario that carries across all phases (phases.md
  guiding rule). Owned by Epic 010 Story 001.

If any precondition fails, **stop** — the gate cannot be evaluated.

---

## 3. Cross-cutting gate checks (G-series)

These are not scenarios; they are properties the whole suite must satisfy.

### G1 — Type-check clean
- **Run:** `npm run typecheck`
- **Pass:** exits 0, no diagnostics.
- **Human verify:** [ ] exit code is 0.
- **Maps:** every Epic 001–010 Verification Gate.

### G2 — Full suite green
- **Run:** `npm test`
- **Pass:** every `node:test` file green; non-zero failures ⇒ gate fails.
- **Human verify:** [ ] summary shows 0 failing, 0 todo-left-as-fail.
- **Maps:** Epic 010 Verification Gate.

### G3 — Zero-network + zero-credential guard active
- **Run:** `npm test` (the guard is a first-installed, suite-level helper
  imported **before** the SUT in every gate test — not a runner flag, because
  `scripts/`/`package.json` are lane-locked).
- **Pass, all of:**
  - A deliberate use of **each** Node network primitive — `net`, `tls`, `dns`,
    `dgram`, `http`, `https`, `http2`, global `fetch`/Undici — **throws** (proven
    by the guard's own self-test).
  - A deliberate read of a credential-shaped env var
    (`*_TOKEN`/`*_KEY`/`*_SECRET`/`*_PASSWORD`) or a provider-credential file
    path **throws**.
  - **Loopback exemption:** a `127.0.0.1`/`::1` socket is allowed (only for
    TC-11's transport server); any **non-loopback** address still throws.
  - No scenario except TC-11 opens any socket.
- **Human verify:** [ ] the guard self-test cases are present and pass; [ ] no
  scenario file imports a network client.
- **Maps:** phases.md criterion 5 ("zero network access, enforced in the test
  runner"); Epic 010 gate ("no network / no credentials"); PRD §7.1 (LLM-free
  deterministic surface).

### G4 — Green CI run recorded
- **Run:** the CI pipeline (Epic 000 SU5) executes `npm test` with the guard
  active, after Epic 010 lands.
- **Pass:** one green CI run; recorded in
  `.agent/plan/feedback/010-harness-scenario-suite/ci-gate-run.md` **with all
  of**: the run URL/artifact, the exact **gate-candidate commit SHA**, the
  commands run (`npm run typecheck`, `npm test`), and visible proof the
  no-network/credential **guard was active** in that run (debate finding — a
  bare "green run URL" is weaker than the evidence a gate artifact needs).
- **Human verify:** [ ] the CI run is green; [ ] the guard is shown active in
  the CI logs; [ ] the recorded entry has run URL + commit SHA + commands +
  guard-active proof.
- **Maps:** phases.md ("the golden scenario runs in CI"); Epic 010 review B1 +
  Findings Out.

### G5 — Harness kit parity: real temp git repo
- **Run:** `node --test src/harness/harness.test.ts`
- **Pass:** the kit provisions a **real initialized** temp git repo — `git
  rev-parse --git-dir` resolves inside it and **one commit lands** — and nothing
  more (no Phase-1 mechanism consumes git semantics; this only names the 2A
  brick-swap seam, Epic 012).
- **Human verify:** [ ] the temp repo is a real repo (rev-parse resolves);
  [ ] one commit is asserted; [ ] no repo/worktree semantics are modeled beyond
  that.
- **Maps:** Epic 010 gate review B2 (kit parity); Story 001 AC; PRD §7.7 (temp
  git repo is part of the mandated harness kit) — **omitted from Claude's first
  draft; added on debate finding**.

---

## 4. Named scenarios (TC-series)

Each maps to a Phase-1 success criterion. Run order is independent; each drives
the same harness kit with one injected fault (Epic 010 Story 002 constraint).

### TC-01 — Golden scenario end-to-end on fakes
- **Maps:** phases.md success criterion 1; Epic 010 Story 001.
- **Run:** `node --test src/harness/golden.test.ts`
- **Steps the scenario drives (all on the fake clock):**
  1. Sign-off **compile** of the golden feature (Epic 002).
  2. **DAG-ordered dispatch** respecting scope + resource **leases** (Epic 004)
     — the parallel lane runs concurrently only where scopes are disjoint.
  3. **Artifact handoff gate** — publisher exit "published" → consumer entry
     "consumed (hash X)" (Epic 006 Story 005 producer, not harness-local logic).
  4. **TDD gate pair** — entry `failing_test_exists` → exit `tests_pass`
     (Epic 006).
  5. **Scheduler-driven deploy chain with soak** — after PR-open the scheduler
     **continues past the terminal task into the deploy-stage DAG nodes**
     (Epic 008.1): each stage is dispatched through the real `pollOnce` lifecycle
     (enters the dispatchable set → leased → `pending`→`running` → executed),
     gated by the compiler-emitted **terminal-task→deploy edge**; the Epic 008
     executor runs the stage, observers pass and the soak window elapses on the
     fake clock; a **passing** stage marks its exit gate so the next stage becomes
     dispatchable, and the last stage's passed gate completes the chain. No
     merge/deploy/rollback verb is ever called.
  6. Feature reaches **complete**.
- **Pass:** the feature reaches `complete` deterministically, with the guard
  active (no network, no real wait); **and** at least one **successful async
  fake-broker op** is observably exercised on the golden path — a completion row
  is written to SQLite and the parked task is resumed by the scheduler (this is
  the **`success`** mode of PRD §7.7's fake broker). If the golden path happens
  to contain no async broker op, the `success` mode gets its **own named
  scenario in TC-05** instead — it must not be left only implicit (debate
  finding).
- **Human verify:** [ ] the test asserts the terminal state is `complete`;
  [ ] no real timer/sleep is used (soak advances the fake clock); [ ] the handoff
  gate is evaluated by the Epic 006 producer, not by test-local code; [ ] a
  successful broker op's completion row + scheduler wakeup is asserted somewhere
  (here or TC-05); [ ] each deploy stage is **dispatched by the scheduler**
  (through `pollOnce`: dispatchable → lease → `pending`→`running`), not executed
  by a bare `runChain`/`runStage` call, and a passing stage's exit gate is what
  unblocks the next stage (Epic 008.1 B2).
- **Fail signal:** any step blocks, completion depends on wall-clock time, the
  broker `success` mode is never observably asserted, or a deploy stage runs
  without being dispatched through the scheduler lifecycle.

### TC-02 — Lease expiry + heartbeat timeout
- **Maps:** PRD §7.3, §7.7; Epic 004; Epic 010 Story 002.
- **Run:** `node --test src/harness/lifecycle.test.ts` (this scenario)
- **Pass:** a task holds a lease; its heartbeat lapses; the fake clock advances
  past expiry; the lease is **reclaimed**; a **waiting task then dispatches**.
- **Human verify:** [ ] the waiter dispatches **only after** expiry on the fake
  clock; [ ] a live (heartbeating) lease is **not** reclaimed.
- **Fail signal:** lease reclaimed while heartbeat is fresh, or waiter never
  dispatches.

### TC-03 — Kill/restart respawn-equivalence (field-by-field, at any step)
- **Maps:** phases.md success criterion 2 ("kill-and-restart **at any scenario
  step**"); PRD §7.7; Epic 009.
- **Run:** `node --test src/harness/lifecycle.test.ts` (this scenario)
- **Pass:** a daemon kill-and-restart (discard in-memory runtime; keep markdown +
  ledger), injected at **multiple representative checkpoints** — at minimum
  post-compile, mid-dispatch, mid-gate-pair, and **mid-soak** — each reproduces,
  asserted **field-by-field** (a single kill point does not satisfy the phases.md
  "at any step" wording; debate finding):
  - the **pending-task set**,
  - **lease ownership**,
  - the **current workflow phase**,
  - the **injected STATE** of resuming tasks,
  - and any **in-progress deploy-stage soak state** (stage id, window start,
    sample history) — a kill mid-soak resumes the window, not restarts it.
    (Epic 008.1 made deploy stages scheduler-driven but tests only synchronous
    `pollOnce` passes; **durable soak-state parking that survives respawn is
    Epic 009's** to build on top of that — this scenario maps to Epic 009.)
- **Human verify:** [ ] all five fields asserted equal pre- vs post-restart;
  [ ] the kill is injected at **each** of the representative checkpoints, not
  just one; [ ] live model context is **not** required to match (that is the
  point of teardown).
- **Fail signal:** any field diverges, soak silently restarts/drops, or only a
  single kill point is exercised.

### TC-04 — Crash/restart + ledger reconciliation
- **Maps:** PRD §5, §7.7; Epic 005/009; Epic 010 Story 002.
- **Run:** `node --test src/harness/lifecycle.test.ts` (this scenario)
- **Pass:** with an in-flight fake broker op, kill-and-restart recovers durable
  op identity **from the ledger** (markdown), marks it **needs-reconciliation**,
  and the reconcile path resolves it against the **fake remote**
  (done | failed | resubmit | escalate).
- **Human verify:** [ ] op identity comes from the durable ledger, not RAM;
  [ ] the reconcile outcome matches the fake remote's state.
- **Fail signal:** op lost on restart, or reconciled from memory.

### TC-05 — Fake-broker failure / timeout / regression
- **Maps:** PRD §7.7 (fake broker models these modes); Epic 005; Epic 010
  Story 002.
- **Run:** `node --test src/harness/lifecycle.test.ts` (these three scenarios)
- **Pass, each mode named and asserted:**
  - **failed** op → writes a **failed completion**;
  - **timed-out** op → emits **escalation-needed**, no terminal state;
  - **regressing** op (`observed_state_can_regress: true`) → **not** left
    final-`done`.
- **Human verify:** [ ] each of the three modes has its own named scenario;
  [ ] the timeout case escalates rather than silently completing.
- **Fail signal:** any mode collapses into "success", or is unhandled.

### TC-06 — Compaction respawn (respawn-equivalence)
- **Maps:** PRD §3.2, §7.7; Epic 006; Epic 010 Story 002.
- **Run:** `node --test src/harness/lifecycle.test.ts` (this scenario)
- **Pass:** crossing the fake compaction threshold mid-task triggers
  `checkpoint()` → kill → respawn, and the **four fields** (pending set, lease
  ownership, phase, injected STATE) equal the pre-respawn values, asserted
  field-by-field.
- **Human verify:** [ ] threshold-triggered respawn uses the **same** code path
  as crash recovery (TC-03); [ ] the four fields match.
- **Fail signal:** respawn diverges, or a separate compaction path exists.

### TC-07 — Dirty-plan recompile + generation pinning
- **Maps:** PRD §7.1.1 step 7; Epic 004; Epic 010 Story 002.
- **Run:** `node --test src/harness/lifecycle.test.ts` (this scenario)
- **Pass:** editing a covered plan file marks the plan **dirty** and **halts new
  dispatch**; a recompile mints **`G+1`**; a task already running under `G`
  **keeps its stamp**, while a halted task dispatches under `G+1`.
- **Human verify:** [ ] new dispatch is halted while dirty; [ ] the running
  task's generation stamp is unchanged; [ ] the edit to a RUNBOOK/state/journal
  file would **not** dirty the plan (excluded from `compile_hash`).
- **Fail signal:** running task's generation changes, or new dispatch proceeds
  on a dirty plan.

### TC-08 — Invalid-plan rejection with planner-vocabulary diagnostics
- **Maps:** phases.md success criterion 3; PRD §7.1.1; Epic 002; Epic 010
  Story 003.
- **Run:** `node --test src/harness/lint-projection.test.ts` (these scenarios)
- **Pass:** **five isolated fixtures**, one violation each, each rejected by
  compile with its **expected diagnostic text asserted string-for-string**:
  1. **cycle** in the DAG;
  2. **forward handoff** (depends on a later story / higher group);
  3. **overlapping lanes** (same group, overlapping `write_scope`);
  4. **missing ticket ref** on a node;
  5. **missing required body section** (e.g. `## Tests`).
- **Human verify:** [ ] each violation is its **own** fixture (a combined set
  can stop early and hide later diagnostics); [ ] each message speaks the
  planner's vocabulary (names stories/tasks/handoffs, not graph nodes);
  [ ] diagnostic text matches Epic 002's messages (single source).
- **Fail signal:** any violation accepted, or a diagnostic phrased in graph
  vocabulary.

### TC-09 — Projection equality (rebuild == markdown-derived)
- **Maps:** phases.md success criterion 4; PRD §6.1; Epic 003; Epic 010
  Story 003.
- **Run:** `node --test src/harness/lint-projection.test.ts` (this scenario)
- **Pass:** compile the golden feature, call `rebuildFromMarkdown`, and
  `projectionOf(shadow) == projectionOf(live)` **field-by-field** (per the Epic
  003 documented, versioned projection contract); a mutated **runtime-only**
  field (lease, poll cursor) causes **no** divergence.
- **Human verify:** [ ] comparison uses Epic 003 `projectionOf`/`diffProjection`,
  not an ad-hoc field list; [ ] runtime-only fields are excluded from the diff.
- **Fail signal:** projection diverges, or a runtime-only field trips a
  divergence.

### TC-10 — Phase-boundary source drift
- **Maps:** PRD §6.3, §7.7; Epic 002 (snapshot) + Epic 006 (re-hash hook);
  Epic 010 Story 004.
- **Run:** `node --test src/harness/source-drift.test.ts`
- **Pass:** a multi-phase task snapshots its source at sign-off (clone-on-
  sign-off, Epic 002); the fake source changes after phase 0; the drift is
  detected at the **next phase boundary** (Epic 006 hook), **not** deferred to
  completion; a **human-signal escalation event** is recorded and the task
  **keeps working** (non-halted). Control: an unchanged source produces **no**
  drift event.
- **Human verify:** [ ] drift is caught at the next boundary, not at completion
  (a day-1 change on a 3-day task must not cost 2 wasted days); [ ] the task is
  **not** halted by the signal; [ ] the unchanged control fires nothing.
- **Fail signal:** drift detected only at completion, task halted, or control
  fires a false drift.

### TC-11 — Transport seam (read-only status + `/healthz`, loopback)
- **Maps:** phases.md Phase-1 deliverable 7; PRD §3.1, §9; Epic 009 Story 002.
- **Primary run (in-process, always runnable):** the Epic 009 Story 002 status-
  api test file runs as part of `npm test` (G2), so TC-11 is **always executable
  via the full suite**. To run it in isolation, pin the exact path from the SU4
  findings file (`.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`)
  and use `node --test <that path>`. Until pinned, run it through `npm test` —
  it is **not** left non-runnable (debate finding: TC-11 must be runnable now,
  not a bare placeholder).
- **Pass, all of:**
  - `/healthz` (a plain HTTP route, **not** an RPC) returns **healthy**.
  - The server is bound to **loopback** (`127.0.0.1`/`::1`); a test asserts it is
    **not** `0.0.0.0` — proven by **in-process bind introspection**, not by a
    manual external probe.
  - The read-only **status** method returns the current feature/task status
    **derived from SQLite**, and a write-counting store seam shows the call
    performs **zero writes**.
  - Introspecting the registered service **descriptor** lists **only** allowed
    read method(s) — **no** sign-off / approval / halt / mutate / control RPC.
  - The **structured logger** seam (pino per PROFILE.md) receives structured
    records for **boot**, **recovery summary**, and **server-listen** (Epic 009
    gate; PRD §3.1 structured logs — added on debate finding; no rotation/
    dead-man ping in Phase 1).
- **Optional manual check (loopback only — the sole G3 exemption):** boot the
  daemon on the golden feature dir (provisional command — pin from the SU4
  findings file), then from the same host:
  `curl -s http://127.0.0.1:<port>/healthz` → healthy JSON, and hit the read-only
  status endpoint → see the feature/task status. **Do not** probe a non-loopback
  address — the loopback-only bind is asserted **in-process** above, not by an
  external curl (removed: the earlier non-loopback curl contradicted the
  loopback-only guard — debate finding).
- **Human verify:** [ ] `/healthz` healthy; [ ] bind asserted not `0.0.0.0`
  (in-process); [ ] status call does zero writes; [ ] descriptor has no mutate
  method; [ ] boot / recovery-summary / server-listen structured log records
  present.
- **Fail signal:** any control/mutate method in the descriptor, a non-loopback
  bind, a status read that writes, or a missing structured log record.

---

## 5. Traceability — every Phase-1 outcome is covered

| Phase-1 success criterion (phases.md) | Covered by |
|---|---|
| Golden scenario end-to-end on fakes, deterministic | TC-01 |
| Kill-and-restart reproduces pending set / leases / phase / STATE | TC-03 (+ TC-04, TC-06) |
| Invalid plan rejected with planner-vocabulary diagnostics | TC-08 |
| Rebuild SQLite from markdown == markdown-derived projection | TC-09 |
| Zero network access enforced | G3 |
| Golden scenario runs in CI (with evidence contract) | G4 |
| Transport seam (`/healthz` + read-only status, no web client) | TC-11 |

| Phase-1 Epic gate item (not a phases.md success criterion, but in scope) | Covered by |
|---|---|
| Harness kit provisions a real temp git repo (Epic 010 B2) | G5 |
| Structured log records: boot / recovery / server-listen (Epic 009; PRD §3.1) | TC-11 |

| Extra PRD §7.7 mandated scenario | Covered by |
|---|---|
| Lease expiry + heartbeat timeout | TC-02 |
| Crash recovery + broker reconciliation | TC-04 |
| Fake-broker success/failure/timeout/regression | TC-01 (success) + TC-05 |
| Compaction respawn (respawn-equivalence) | TC-06 |
| Phase-boundary hash drift | TC-10 |
| Dirty-plan recompile + generation pinning | TC-07 |

Every phases.md Phase-1 success criterion and every PRD §7.7 mandated scenario
maps to at least one check above. No check introduces a mechanism Epics 001–010
do not already own.

---

## 6. Gate decision (Phase 1 → Phase 2)

**Phase 1 is complete only when ALL of the following hold:**

- [ ] G1 type-check clean.
- [ ] G2 full suite green (`npm test`).
- [ ] G3 network + credential guard active and self-tested; only loopback
  exempt; only TC-11 opens a socket.
- [ ] G4 one green CI run recorded in `ci-gate-run.md` (URL + commit SHA +
  commands + guard-active proof).
- [ ] G5 harness kit provisions a real temp git repo (one commit, rev-parse).
- [ ] TC-01 … TC-11 all pass with the human-verify boxes checked.
- [ ] The run used **no** LLM, **no** network egress, **no** external
  credential (confirmed by G3, not by inspection alone).

Record the gate result (date, CI run URL, who verified) alongside
`ci-gate-run.md`. That file + a green local suite **is** the Phase-1 → Phase-2
gate artifact (Epic 010 Findings Out).

---

## 7. Explicitly out of this suite (deferred, by phase)

- **Real** agents, broker verbs, S3 sync, fff, web client, ring-2 classifier —
  **Phase 2** (phases.md "Explicitly out of Phase 1").
- **Chrome MCP / browser automation / video** — no UI in Phase 1; the web
  dashboard is **Phase 2B** (Epic 026/027). Revisit this suite's observation
  layer then.
- **`kanthord verify` CLI** — **Phase 2A**; Phase-1 projection equality is TC-09.
- **Property tests over DAG + lease interleavings** — **Phase 3** "later
  hardening" (PRD §7.7); this suite ships the named scenarios only.
- **OS process-death semantics** (real signal handling, socket cleanup) — Phase 1
  proves deterministic crash-equivalence via an **in-process** simulated kill
  only (Epic 009 crash model); a real child-process kill is deferred.
