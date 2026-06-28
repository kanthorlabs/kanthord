# 01 Infrastructure — Deferred Items

> Single backlog of everything **knowingly deferred** while authoring the 15
> milestone-01 epics (`plan/01..15`). Each item records **why** it was deferred and
> the **trigger** to revisit, plus its source (decision ID and/or epic). Nothing
> here blocks milestone 01; this is the "get back to it later" list.

Status legend: **NEXT-MS** = belongs to a later milestone · **TRIGGER** = build
when a named condition is hit · **RISK-ACCEPTED** = won't build unless it becomes a
real requirement · **SPIKE-GATED** = resolved during build, may push more here.

---

## A. Deferred to a later milestone (NEXT-MS)

- **Agent-loop durability / resumability / idempotent replay** — out of infra scope;
  the agent itself is designed next. _Source: S1, epic 12._
- **Web client (SPA)** — milestone 01 is Core infra only; the Web client is built in
  **milestone 02**. _Source: N-SPA; epics 11, 13 forward-reference it._
- **macOS app + iOS app (native clients)** — Web-first; native clients come in a later
  client milestone. _Source: Web-first directive, S6/D6._
- **macOS host capabilities via Swift helper + the Swift-helper IPC contract/spike**
  (auth, lifecycle, versioning, binary discovery, codesigning, OS permission +
  consent, streaming) — the milestone's riskiest slice; deferred with the macOS
  client. _Source: epic 13, §7, D9._
- **connect-swift codegen** — deferred with the native clients; proto stays
  language-neutral so it slots in later with no schema change. _Source: epic 10, S7._
- **UDS transport** (local native clients, Core-native-on-Mac, CLI-over-UDS) — Web
  client uses HTTP/Connect only; add UDS when a native client needs it (cheap — shared
  handlers). _Source: epic 11, N-11a, D8._
- **launchd + macOS app-bundle update + darwin SEA** — deferred with the macOS app;
  milestone 01 ships the systemd unit only. _Source: epic 15, B7, §9._
- **Server→client capability invocation** (Core asking the phone to act) — needs a
  server-initiated channel over the gRPC link; designed later. _Source: §7, epic 13._

## B. Deferred within infra — revisit at a TRIGGER

- **File-DB index strategies beyond full-scan** — TRIGGER: a performance wall. The
  search interface keeps the swap cheap. _Source: N2, epic 02._
- **Vector search** (embeddings + cosine) — TRIGGER: when actually needed; fits behind
  the N2 search interface. _Source: N3._
- **Per-platform config path discovery** (XDG / app-support / `/etc`) — TRIGGER: the
  lifecycle/install work; v1 uses one config location. _Source: epic 03, epic 15._
- **Live config reload** (SIGHUP / watch) — TRIGGER: when needed; v1 loads once at
  startup. _Source: epic 03._
- **Tool contract: `streaming`, `maxOutputBytes`, artifacts, `auditPolicy`/output
  redaction, per-tool `concurrency` classes** — TRIGGER: when a UI consumes them /
  when needed. v1 builds only the corruption-preventing subset. _Source: B9, epic 09._
- **Recurrence (cron-like jobs)** — TRIGGER: a real recurring need; v1 jobs are
  one-shot. _Source: epic 06._
- **Multi-file / batch migration atomicity + half-migrated recovery** — TRIGGER: a real
  multi-file store needs it; v1 migration is per-file. _Source: epic 14._
- **RPC / wire-version compatibility** — TRIGGER: when client/Core version skew
  matters; v1 covers file `version` only. _Source: epic 14, B8._
- **Dual-key credential rotation** — TRIGGER: when single-credential atomic replace is
  insufficient. _Source: B4, epic 08._
- **Concrete migration confirmation channel** (CLI / RPC prompt) — TRIGGER: with the
  client/UX; v1 confirmation is an explicit apply input. _Source: epic 14._
- **Fork location decision** (git fork + npm override vs vendoring under `packages/`)
  — TRIGGER: when we actually fork a pi package; install from npm until then.
  _Source: B2._

## C. Risk-accepted for v1 (RISK-ACCEPTED — won't build unless it becomes a requirement)

- **fsync / power-loss durability** — v1 crash model = process/container kill (SIGKILL)
  only; OS-crash/power-loss durability not guaranteed. Accepted for a single-user local
  daemon. _Source: N-02a, epic 02._
- **Crash-durable operational logging** (flush-on-exit / sync transport) — operational
  logs are best-effort; no decision mandates durability. _Source: epic 05._
- **Event replay onto the bus** — durable event history is a write-only audit log in
  v1, not a resumable queue. _Source: N-04a, epic 04._
- **Backup / rollback for migrations** — epic-02 atomic write is the safety; a separate
  backup policy is not built. _Source: epic 14._
- **Mid-stream auth revocation** — auth is checked at RPC start (per-stream-open);
  revoking a live long stream is out of scope. _Source: epic 11._
- **`canRun` denylist completeness** (obfuscation / glob / symlink / env-expansion /
  prompt-injection) — guardrail only; the Podman sandbox (D9) is the real boundary.
  _Source: epic 07, D4/D9._

## D. Spike-gated (SPIKE-GATED — resolved during build; may push items back here)

- **`retryPolicy` enforceability** — enforced vs advisory depends on whether Core can
  intercept pi-agent-core's transient retries; the epic-09 pi-agent-core spike decides.
  _Source: N-09b, epic 09._
- **SEA packaging of our ESM app + deps** — if Node SEA cannot package it on both
  arches, the spike **escalates the B1 decision** (no silent bundled-Node fallback).
  _Source: epic 15, B1._

---

## Resolved (NOT deferred — recorded so they aren't re-litigated)

- **Crash-replay idempotency (N-09a)** — durable file-based idempotency keys are **in
  v1** (epics 09 + 06): `callId`-keyed call-record, `O_EXCL` lease/WAL marker,
  completed-record dedup, orphan resolved by `retryPolicy`.
- **First-run auth (N-08a)** — auth gates the remote path only; credential provisioned
  at setup; local/loopback dev runs without it via the dev override.
