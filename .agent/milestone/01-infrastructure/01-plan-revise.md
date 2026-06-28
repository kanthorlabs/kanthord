# 01 Infrastructure — Plan Revision

> Source: adversarial debate on `01-plan.md` (engine: opencode / gpt-5.5) + Aelita review.
> Goal of this file: list every debate **blocker** and **suggestion**, mark what
> Ulrich's new decisions already resolve, and flag what is still open for a call.

## Status legend

- **RESOLVED** — a decision below settles it.
- **DEFERRED** — knowingly postponed; risk accepted.
- **OPEN** — still needs a decision from Ulrich.
- **OBSOLETE** — no longer applies after the file-based pivot.

---

## Decisions captured from Ulrich (2026-06-28)

- **D1 — No SQL database.** Build our own file-based database. Markdown is the
  primary format; json/jsonl secondary for different purposes. Reason: LLMs
  integrate easily with markdown/yaml/json/jsonl.
- **D2 — No native `.node` modules.** If something needs native code, we fork /
  build our own version.
- **D3 — `@pi/agent` + `@pi/ai` at exact pinned versions ARE the AI/Agent
  adapter.** Do NOT add another abstraction layer over them. If something is
  missing, fork the package and build it there.
- **D4 — Security is a minimal seam for now.** Default decision returns `true`
  (allow everything). Safe because it runs only on Ulrich's machine under his
  observation. Real enforcement comes later.
- **D5 — Everything infra (logging, queue, pub/sub, atomic locking, …) is
  file-based.** Adapt an existing file-based solution; otherwise build our own
  file-based one. No Redis, no external brokers.
- **D6 — File-based first, then S3-compatible cloud** (Cloudflare primary, not
  exclusive). VPN is assumed for any remote access (Cloudflare or Tailscale;
  Tailscale is the default). With a VPN, auth is a single **key id / secret**.
  Single user only — no multi-user, no multi-tenant.
- **D7 (REFERENCE ONLY — agentic-design milestone, not this one).** Long-term
  direction: Claude is the standard and we aim to be a drop-in replacement that
  reads Claude's `CLAUDE.md`, skills, agents, commands, and plugins out of the
  box. Captured here only as a reference to keep in mind; it is **not an
  infrastructure-milestone decision** and does not constrain this milestone.
- **D8 — Client = pure visualization; Core owns a pluggable transport layer.**
  Clients (Web SPA, macOS/iOS App) are visualization only; the only contract is
  one gRPC schema between Core and clients. See "Client / Transport Architecture".
- **D9 — Local development runs inside Podman (host safety).** For local dev, Core
  runs in a **Podman** container so the agent's tools (shell/filesystem) can damage
  only the container, never the host. This is the **host-level** safety layer that
  compensates for the permissive in-app security (D4). Podman is rootless/daemonless
  (better posture than Docker).
  - **Native capabilities via a capability layer (Flutter-style, refined by debate).**
    Adopt Flutter's *shape* — one capability API, many platform implementations —
    but **not** its machinery (no method channels / federated-plugin registration).
    The model is **capability-first and ownership-aware**, not folder/Core-first:
    - **One shared contract + registry per capability**, even though
      implementations live in different runtimes/languages. ("Shared definition,
      distributed implementation.")
    - **Ownership tag per capability:** `host` (Core-owned, e.g. screen capture,
      keychain, clipboard) vs `client` (app-owned, e.g. camera, push, share sheet).
      `iOS is NOT a Core runtime` — so `./ios` holds **client-side** capability
      impls, never Core.
    - **Structure encodes ownership:**
      ```text
      /capabilities
        /host            # Core-owned (runs where Core runs)
          /screen-capture
            interface.ts      # the one contract
            unsupported.ts    # default: throw (D9)
            macos.ts          # TS adapter -> Swift helper (IPC)
            linux.ts          # stub until built
        /client          # app-owned (runs in the UI)
          /camera          # ios.ts, web.ts, ...
          /push
          /share
      ```
    - **Selection = runtime-mode + feature probing**, not just `process.platform`
      (must handle macOS+Podman, host-Linux vs container-Linux, VPS, CI, sandboxed
      macOS, future Windows). Model **environment limits**, not only the OS string.
    - **Capability registry/manifest:** clients discover *what exists*, *why it is
      unavailable*, and *whether a user action can enable it* (e.g. macOS
      screen-recording permission).
    - **Unsupported-default throws** until an impl is built (D9 core rule).
    - Name it **"host capabilities" / "client capabilities"** — distinct from the
      existing tools/jobs **plugin system** (avoid the naming collision).
    - **YAGNI:** build the contract + `host/macos` (dev host) + unsupported-default
      first; leave `host/linux` and `client/*` as stubs until needed.
    - (Implication unchanged: Core native on a Mac host gets macOS host capabilities;
      Core in Podman is `linux` -> sandboxed, none until built.)
    - **Hard part = the Swift-helper IPC contract** (auth, lifecycle, versioning,
      binary discovery, codesigning, OS permission + user consent, streaming for
      screen capture, failure modes) — budget for this, it dwarfs the TS interface.
    - **Known gap (deferred, out of this milestone):** how Core *requests a
      client-side action* (e.g. tell the phone to take a photo). gRPC links them
      but does not define **server→client capability invocation**; needs a
      server-initiated/streaming channel — designed later.
  - **Dev volume boundary:** a single host directory **`.data/`** holds **both** the
    UDS socket and the file-based database directory; mount `.data/` into the
    Podman container. One mount covers socket + DB.
  - **HARD RULE:** we must run a **dedicated session to set up and document how to
    use Podman in this project** (deliverable: a Podman usage doc + the
    container/compose setup). This is required, not optional.

---

## Client / Transport Architecture (decided 2026-06-28)

Replaces the original "SwiftUI desktop + separate iOS app + CLI" client model
and the debate's "add Connect alongside UDS" framing.

```
                  +--------------- Core ----------------+
                  |  Transport layer (pluggable)        |
  Web SPA --gRPC-Web/HTTP-->  - HTTP/Connect transport  |
  App (remote VPS) -gRPC/H2->  (gRPC-Web + gRPC API only)| --> Infra + Agentic
                  |                                      |     + auth + ...
  App (local) --gRPC/UDS--->  - UDS transport (local)    |
                  +-------------------------------------+
```

- **One Core, one gRPC schema, two transports:** `UDS` (local) and
  `HTTP/Connect` (browser via gRPC-Web, remote native via gRPC). The HTTP
  transport is the former "Web backend", now a **Core module — not a separate
  deploy tier** (resolves the earlier S1 alternative).
- **App transport is pinnable:** UDS when Core is local; HTTP/Connect when the
  App is pointed at a **remote VPS Core** (over Tailscale). Same App, swap
  transport.
- **Web backend stays a thin adapter** (B1): gRPC ↔ gRPC-Web translation only.
  **No business logic, no static-file serving** — all logic stays in Core.
- **Auth is single-source in Core** (B2): the key id/secret travels in the gRPC
  **`authorization` metadata** (maps to the HTTP `Authorization` header for
  gRPC-Web), so browser / native app / CLI all carry it the same way. Every
  transport just **forwards** that metadata to Core's auth; the HTTP transport
  keeps **no session of its own**. Value format = `Basic base64(keyId:secret)`
  or a Bearer token (decide at build). Verifier is hashed (B4); provider keys
  stay plaintext (B10).
- **Tailscale carries gRPC/HTTP-2 transparently** (it is a WireGuard tunnel below
  HTTP); native apps may use **h2c** since the tunnel is already encrypted.
- Streaming: server→client (agent tokens) works over gRPC-Web; client/bidi is
  not needed.
- **Static web hosting = nginx** (not Core): deployed to the **VPS** via nginx;
  for local testing Ulrich runs **nginx himself**. nginx serves the SPA and can
  reverse-proxy `/api` → Core's gRPC-Web endpoint. (Cloudflare remains a possible
  host per D6 but the default is self-hosted nginx.)
- ⚠️ Accepted risk: the browser holds the raw key in memory/storage and sends it
  in the `authorization` header each call — fine for single-user behind Tailscale;
  an XSS in the SPA could read it. The browser must still be on the tailnet to
  reach Core (matches D6).

---

## Blockers (wrong / needs revising)

### B1 — SEA vs native modules
- **Debate:** "Single executable" conflicts with native addons (better-sqlite3,
  sqlite-vec). Needs a per-arch packaging matrix.
- **Status: RESOLVED** by **D1 + D2.** No SQLite, no native `.node` → SEA path is
  viable again. **SEA confirmed as a real target** to reduce packaging headache.

### B2 — pi packages: real names + versions
- **Debate:** Whole architecture rests on these; verify names/API/license,
  pin versions, wrap behind own interface.
- **Status: RESOLVED (with override)** by **D3.** The plan's `@pi/agent` /
  `@pi/ai` names were wrong. Real, pinned dependencies:
  - `@earendil-works/pi-ai@0.80.2`
  - `@earendil-works/pi-agent-core@0.80.2`
- These ARE the adapter; do **not** add our own abstraction layer. Fork only when
  something is missing. The "wrap behind own interface" advice is **rejected**.
- **Fork-location (deferred):** "vendored in `packages/`" = copying the package's
  source into our monorepo so we can patch it directly, instead of installing it
  from npm. We install from npm now; if/when we fork, decide then between a git
  fork (npm override) or vendoring the source under `packages/`.

### B3 — Minimal security seam
- **Debate:** LLM gets Shell/Keychain/Filesystem/etc with no permission, approval,
  audit, or prompt-injection defense.
- **Status: RESOLVED (minimal).** Build a single chokepoint `canRun(tool, args) →
  allow | deny` that every tool call passes through (the "seam" — one place to
  hold policy). Default = allow (D4), **except a small denylist of obviously
  dangerous operations**: e.g. `rm -rf /`, reading `~/.ssh`, `~/.aws`. Grow the
  policy later without touching call sites.

### B4 — Auth boundary
- **Debate:** VPS auth was "may use API keys / OAuth" — too vague for a daemon
  that runs shell commands.
- **Status: RESOLVED (transport)** by **D6.** VPN-gated (Tailscale default) +
  single key id/secret, single user. **Trust the VPN tunnel — no TLS layer**
  (no extra overhead). Network exposure handled entirely at the VPN layer.
- **Storage RESOLVED** via debate round (was: where the key lives). Relates to
  B10 (plaintext provider keys vs hashed auth verifier).
- **DEBATE OUTCOME (accepted by Ulrich):**
  - Credentials are NOT config → store in the daemon **data/state dir**, not the
    config dir (config is too easy to sync/back-up/commit).
  - Locations: macOS `~/Library/Application Support/Kanthor/auth/credential`;
    Linux user `${XDG_STATE_HOME:-~/.local/state}/kanthor/auth/credential`;
    Linux system/VPS + Docker `/var/lib/kanthor/auth/credential` (Docker: mounted
    file or Docker secret).
  - Format: ssh-style versioned **line** file (not JSON) — matches B10.
  - Perms: file `0600`, dir `0700`; daemon **refuses to start** on loose perms
    unless an explicit dev override is passed.
  - Env vars: **dev/bootstrap fallback only, NOT default precedence** (env leaks
    via `docker inspect`, crash dumps, CI logs, child processes).
  - Rotation: single credential; atomic replace + reload. Dual-key deferred.
  - Separate the daemon's **verifier** credential from the client's presented one.
  - **RESOLVED — hash the verifier.** The daemon stores only a **hashed** copy of
    the secret (it only verifies a presented secret, never replays it). Apache-style
    *shape* (store hash, re-hash on check) but **not** Apache's algorithm:
    - Use **salted SHA-256 + constant-time compare**, via Node built-in `crypto`
      (no native dep — satisfies D2). Store self-describing `sha256$<salt>$<hash>`.
    - Rationale: the secret is **high-entropy random**, so a slow KDF
      (bcrypt/scrypt/Argon2) is unnecessary; bcrypt also tends to need a native
      module. `scrypt` (also built-in) is available if ever wanted, but overkill.
    - **Distinction vs B10:** only the auth *verifier* is hashed. **Provider API
      keys (pi-ai) stay plaintext (B10)** because the daemon must replay them to
      the provider — they cannot be hashed. The client still holds its own secret
      in cleartext to present it.

### B5 — Scheduler execution-model mismatch
- **Debate:** Bree (workers) can't share in-process state; node-cron (in-process)
  can. Real fix: scheduler only enqueues durable jobs; runtime claims them.
- **Status: RESOLVED (approach)** by **D5.** File-based, in-process; build our own
  durable job store. Bree is dropped.
- 👉 Your call: confirm in-process timer + file-based job queue (no Bree).

### B6 — Logs in SQLite
- **Debate:** Storing logs in SQLite contradicts pino; split operational logs
  (files) from audit/events/state.
- **Status: RESOLVED** by **D1 + D5.** Everything is file-based. Operational logs
  → log files (jsonl); audit/events/state → their own files.
- 👉 Your call: confirm split — operational vs audit/state as separate file sets.

### B7 — Lifecycle ownership (debate caught, not in original plan)
- **Debate:** Need one clear owner for the 7 lifecycle jobs: install, start on
  login/boot, stop, restart after crash, update, health-check (is it alive?),
  socket discovery (how a client finds where to connect).
- **Status: PARTIAL.** OS service manager owns start/stop/restart: **launchd**
  (macOS), **systemd `Restart=always`** (Linux). The **app bundle owns update**
  (copy/replace/restart, per plan).
- **Deferred to implementation:** the daemon-side contract — a **health endpoint**
  and a **known socket path** so clients reliably discover and connect.

### B8 — Migrations / versioning
- **Debate:** Auto-update without DB migrations + rollback + RPC version compat
  corrupts user state.
- **Status: RESOLVED.** Every file carries a `version` field, starting at
  `version: 1`. Migration logic lives in the new code that needs it. The upgrade
  flow must **show what will auto-apply and what needs user action**, and must
  **never run any upgrade without explicit user confirmation.**

### B9 — Tool execution contract (debate caught)
- **Debate:** Every tool needs timeout, cancellation, permission, input/output
  schema, streaming behavior, audit record.
- **Status: RESOLVED** via debate round. Permission part = B3 (minimal canRun).
  Contract shape researched against Claude Code / Anthropic tool-use (D7 reference).
- **DEBATE OUTCOME (accepted by Ulrich — v1 subset):** use Anthropic's
  `tool_use`/`tool_result` shape only at the **model boundary**; the daemon needs
  a richer **daemon-first** contract. Every tool declares:
  - `name`, `version`, `description`
  - `inputSchema` as **canonical JSON Schema** (Zod is an impl detail only)
  - `outputSchema` / **result-envelope schema required** (payload may be loose)
  - `capabilities` (read/write/delete files, network, spawn process, external
    side effects) — replaces the vague "danger level"
  - `permissionHints` (sensitive args, sensitive outputs, approval need)
  - `timeoutMs` (only **config/policy** may raise it — never the model)
  - `maxOutputBytes` (truncation + artifact refs for large output)
  - `streaming` (none / chunks / events) — to **UI + audit first, NOT auto-fed
    back to the model** (token bloat + prompt-injection risk)
  - `concurrency` (parallel-safe / workspace-lock / resource-lock / serial)
  - `retryPolicy` (retryable / idempotent / never-retry) — **required**, because
    pi-agent-core retries transient errors; without it, duplicate writes/commands
  - `cancellation` (supported / best-effort) + a defined terminal status
  - `auditPolicy` (which args/results are logged / redacted / omitted / artifact)
  - Invocation: `runId`/`stepId`/`callId` → validate args → policy timeout +
    `canRun(tool,args,context)` → deny emits `ToolFinished status=denied` →
    execute with AbortSignal + locks + output limits → emit `ToolExecuting` →
    optional chunks → **exactly one** `ToolFinished` (succeeded/failed/timed_out/
    cancelled/denied) → append-only JSONL event (runId/stepId/callId/seq/ts/
    status) → return model-safe `tool_result` by `callId` → large/sensitive raw
    data stored as **artifacts**, not inline.
  - **RESOLVED — build the v1 corruption-preventing subset now:** `name`,
    `version`, `inputSchema`, result-envelope schema, `capabilities`, `timeoutMs`,
    `cancellation` (+ terminal `ToolFinished` status), `retryPolicy`, append-only
    JSONL events, and the `canRun` gate. **Defer** `streaming`, `maxOutputBytes`,
    and artifact handling until a UI consumes them.

### B10 — Secret boundary (debate caught)
- **Debate:** Plan named Keychain but never said which secrets live where.
- **Status: RESOLVED.** OS Keychain dropped. Secrets live **plaintext in a file**,
  treated like an SSH key file — i.e. restrictive file permissions (`0600`),
  owner-only. Security rests on the machine + VPN model (D4 + D6).

---

## Suggestions (needs improving)

### S1 — Agent-loop durability
- **Debate:** No crash recovery / resumability / idempotency for in-flight runs.
- **Status: DEFERRED.** Out of scope for this infrastructure milestone. It is a
  tech-design topic for the **next milestone** when we design the agent itself.

### S2 — Cost & loop control
- **Debate:** No max-iteration cap / token budget / cost tracking.
- **Status: RESOLVED — we build it.** `@pi/agent` only does context/token
  **compaction** and **retry on transient errors**. Max-iteration caps, token
  budgets, and cost tracking are **ours to add** on top of `@pi/agent`.

### S3 — Durable task model
- **Debate:** PQueue is in-memory; tasks lost on restart. Need explicit states.
- **Status: RESOLVED (approach)** by **D1 + D5.** File-based job store with states
  (`queued → claimed → running → {done|failed|cancelled}`).
- 👉 Your call: confirm the state set and the file layout (one jsonl? per-job file?).

### S4 — Storage discipline
- **Debate (was SQLite):** short transactions, WAL, no big blobs on hot path.
- **Status: OBSOLETE → REPLACED.** No SQLite. New concern is file-DB atomicity
  (see N1 below).

### S5 — Schema ownership (proto vs Zod)
- **Debate:** proto owns wire contract; Zod owns config / tool schemas / outputs.
- **Status: RESOLVED.** We **build our own gRPC schema, derived from `@pi/agent`**.
  gRPC stays as the wire contract; the schema tracks `@pi/agent`'s types rather
  than being invented separately. (This keeps S7 codegen in scope — see below.)

### S6 — iOS wording
- **Debate:** "Same binary everywhere" is false for iOS.
- **Status: RESOLVED** by **D6.** iOS is a remote RPC client over VPN; no local
  daemon. Just fix the wording in the plan.

### S7 — Codegen toolchain
- **Debate:** gRPC/Connect needs buf + connect-swift; web/iOS need Connect/gRPC-web.
- **Status: IN SCOPE** (S5 kept gRPC). We need a codegen path for TS (daemon +
  clients) and Swift (macOS/iOS). Web/iOS still cannot speak raw gRPC →
  Connect/gRPC-web required.
- 👉 Your call: adopt `buf` + connect-swift, or build our own codegen too?

### S8 — Plugin trust boundary
- **Debate:** Dynamic plugins = main attack surface; v1 first-party only.
- **Status: DEFERRED** by **D4.** Single machine → first-party only implied.
- **D7 note (reference only):** later (agentic-design milestone) we want plugin /
  command / agent / skill formats to match Claude's. Not a constraint for this
  milestone; trust model stays minimal (single machine).

---

## New concerns introduced by the file-based pivot

These are NOT from the debate — they are the cost of trading SQLite for files.
They hit the same risks the debate cared about (durability, concurrency).

### N1 — File-DB atomicity & concurrency
- Multiple writers (RPC server, scheduler, agent, plugins) writing the same
  markdown/json files. Need atomic write (write-temp-then-rename), a file-based
  lock (D5), and crash-safe partial-write handling.
- **Status: RESOLVED.** **Single-writer process** model, **and** treat every write
  as atomic-write + file lock. (Both: single writer for ordering, atomic+lock for
  crash safety.)

### N2 — Query / index without SQL
- Markdown/jsonl have no indexes. Listing/filtering conversations, tasks, memory
  may need an in-memory index rebuilt on startup, or sidecar index files.
- **Status: RESOLVED.** Define our own **search interface**. For now the only
  implementation is **full-scan** (simple). Add more search strategies later, only
  when we hit a performance wall — the interface keeps that swap cheap.

### N3 — Vector search without sqlite-vec
- The plan wanted `sqlite-vec`. File-based means embeddings in jsonl + brute-force
  cosine in memory (fine at small scale), or a custom file index.
- **Status: DEFERRED.** Out of scope now. We bring our own vector solution later,
  only when we actually need it. Fits behind the N2 search interface when it comes.
