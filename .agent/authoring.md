# Authoring Rules

How to author any milestone in `.agent/milestone/<NN>-<name>/`. These rules are
**shared across all milestones** — do not copy them into a milestone folder.
Adapted from kanthorvault's "Epic / Story / Task Authoring" for a headless
TypeScript daemon (no UI, file-based, gRPC).

## Unit of work: the task brief

Milestones are split into numbered task files (`01-...md`, `02-...md`). There is
**no separate Epic/Story layer** — the numbered task file *is* the unit. Each
task brief uses this template:

```
# NN <task name>
Goal:             <one line>
Decision anchors: <D/B/S/N IDs this implements, from 01-plan*.md>
ACs:              <observable behavior + external contract values>
Constraints:      <mandated mechanism, each citing a decision ID>
Spike?:           <none | the unknown it de-risks>
Verification:     <the executable check, e.g. `make verify` / a unit test>
Dependencies:     <task numbers + any findings file required>
Findings out:     <path — only if it discovers behavior a later task needs>
```

## ACs vs. Constraints (the key distinction)

**Acceptance Criteria describe observable behavior and external contract values —
not internal mechanism.** Mandated mechanism goes in **Constraints**, citing the
decision that mandates it.

- AC (observable / external): "a client connects over the UDS and gets an echo";
  "Core refuses to start when auth perms are looser than `0600`/`0700`"; "`canRun`
  denies `rm -rf /`"; published port `7777`; the `version` field; job-state names
  `queued → claimed → running → {done|failed|cancelled}`.
- Constraint (mandated mechanism, cite the decision): "atomic write-temp-then-
  rename + file lock (N1)"; "no SQL, file-based only (D1)"; "do not wrap pi
  packages (D3)"; "proto owns the RPC wire contract, no Zod on RPC (S5)".

A value that the user/decision fixes (a port, a perm, a timeout, a retry count) is
an AC — it is the engineer's target and the reviewer's check. Dropping it makes
the brief useless.

## Rules

1. **ACs are behavior, not implementation.** No variable names, no specific API
   calls, no file paths-as-mechanism. The engineer picks the approach — unless a
   ratified decision fixes it, in which case it is a Constraint citing the ID.
2. **Carry the concrete contract values into the ACs** (ports, perms, formats,
   state names, timeouts). These numbers are the acceptance criteria.
3. **Verify library/API behavior before prescribing it — write a spike.** Don't
   assume Node `fs`/UDS semantics or `pi-agent-core`/`pi-ai` (pinned `0.80.2`) API
   shape; confirm it. (Proven: UDS does not cross the macOS host→VM boundary.)
4. **Read the actual source before referencing it** — especially the external
   pinned deps. Don't prescribe methods/signatures that may not exist.
5. **Read the relevant decisions/findings before writing in an area, not
   upfront.** The decisions in `01-plan.md` / `01-plan-revise.md` and recorded
   findings are the gotcha source.
6. **Analyze blast radius of seed/fixture changes.** For the file DB, full-scan
   queries (N2) and version migrations (B8) mean a seed-format or ordering change
   ripples to every reader and test. List dependents before changing a seed.
7. **If the same assertion fails 2+ times for different root causes, the
   assertion is wrong.** Stop fixing production code; question the AC/test premise.
8. **No build task is DONE without a passing executable check.** "Test" means a
   unit test **or** a harness (e.g. `make verify`) — some infra tasks have no
   meaningful unit test, and the harness is then the check. A recorded **spike
   result does NOT count** as the done-gate for production code; spikes de-risk,
   the executable check closes the task.

## Spike gate (Spike → Build → Verify)

Require a spike **only** when a task hits one of: unknown external API behavior;
OS / container boundary behavior; an external pinned dep's real surface; or
unclear filesystem / atomicity semantics. Otherwise skip straight to
Build → Verify — no spike tax on routine tasks.

## Findings contract

Write a findings file **before** authoring a dependent next task — **but only when
the task discovered behavior the dependent task needs** (e.g. the Podman session's
UDS / virtiofs result). No discovery → no findings file. A findings file links
back to the D/B/S/N decisions it affects; it is not a parallel decision store.

## Out of scope for authoring

Commit-message style and other repo-wide policies are not authoring rules; keep
them out of milestone briefs.
