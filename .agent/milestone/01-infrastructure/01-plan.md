# Kanthor Agent Runtime Architecture

> **Version:** v2 (2026-06-28)
>
> Goal: Build an agentic system centered around a single long-running daemon
> ("Core") that powers macOS, iOS, and self-hosted VPS deployments, built on the
> pinned packages:
>
> - `@earendil-works/pi-agent-core@0.80.2`
> - `@earendil-works/pi-ai@0.80.2`
>
> v2 folds in the decisions agreed in `01-plan-revise.md` (file-based pivot, no
> native modules, transport model, auth, Podman dev sandbox, capability layer).
> Decision IDs below (D1–D9, B/S/N) reference that file.

---

# 1. Core Principles

## Daemon First (Core)

The daemon — referred to as **Core** — is the product.

Every client (Web SPA, macOS App, iOS App, CLI) is simply another interface to
the same runtime.

```
                Client
                    │
                    ▼
              Kanthor Core
                    │
        Agent Runtime + AI Runtime
                    │
              Tools / Memory
```

Core owns:

- Agent execution
- AI providers
- Memory
- Tool execution
- Scheduling
- Configuration
- Storage
- Secrets
- RPC server + transports

The client owns:

- Rendering
- User interaction
- Streaming responses (display)
- Local UX

The client never contains business logic.

---

## Single Source of Truth

There is exactly one runtime (Core).

Clients never duplicate:

- conversations
- agent state
- tool state
- memory
- configuration

Clients are **pure visualization** (D8). The only contract between Core and any
client is **one gRPC schema**.

---

## Tool-first Design

Agents never perform work directly. Everything is exposed as deterministic tools.

```
User → Agent → Tool → Result → Agent decides next step
```

Examples: Filesystem, Git, Browser, Calendar, Screen Capture, Clipboard,
Keychain, Terminal.

Every tool passes through a single permission chokepoint (`canRun`, see §4) and
follows the tool-execution contract (see §6).

---

## Event-driven

Subsystems communicate through events instead of direct coupling.

```
UserMessage → AgentStarted → ToolExecuting → ToolFinished
            → LLMStreaming → LLMFinished → ConversationSaved
```

The event bus is **in-process** (eventemitter3 / Emittery). Durable history is
written as append-only JSONL (see §5, §6) — not kept only in memory.

Benefits: easy logging, easy debugging, plugin-friendly, low coupling.

---

## Plugin Architecture

The runtime supports loading plugins. Each plugin may provide tools, scheduled
jobs, event listeners, and configuration.

For this milestone, plugins are **first-party / built-in only** (S8) — dynamic
third-party plugins are the main attack surface and are out of scope. A stable
manifest format and a real trust boundary come later.

```
plugins/
    browser/  filesystem/  git/  calendar/  clipboard/  screencapture/
```

---

## Platform Independence via a Capability Layer

Core does not hard-code platform behavior. Anything that is **not
cross-platform** lives behind a **capability layer** (see §7) that is
capability-first and ownership-aware (`host` vs `client`). Unsupported platforms
throw an explicit "unsupported" error until an implementation is built (D9).

---

# 2. Architecture

```
   Web SPA ──gRPC-Web/HTTP──┐
   App (remote) ─gRPC/H2────┤        ┌──────────── Kanthor Core ───────────┐
                            ├──────► │ Transport layer (pluggable)         │
   App (local) ──gRPC/UDS───┘        │   • UDS transport (local)           │
                                     │   • HTTP/Connect transport          │
                                     │     (gRPC-Web + gRPC API only)      │
                                     ├─────────────────────────────────────┤
                                     │ pi-agent-core   pi-ai    Event Bus   │
                                     │ Memory  Tools  Storage  Scheduler    │
                                     │ Capability layer (host caps)         │
                                     │ Security seam (canRun)               │
                                     └─────────────────────────────────────┘
                                            │
                                  File-based storage (.data/)
```

- **One Core, one gRPC schema, two transports** (D8): `UDS` (local native) and
  `HTTP/Connect` (browser via gRPC-Web, remote native via gRPC). The HTTP
  transport is a **Core module, not a separate deploy tier**.
- `pi-agent-core` and `pi-ai` **are** the agent/AI adapter (D3). We do not add
  another abstraction layer over them; if something is missing we fork the
  package.

---

# Repository Structure

```
repo/
├── packages/
│   ├── core/          # Core runtime (daemon)
│   ├── memory/
│   ├── tools/
│   ├── plugins/       # first-party only (this milestone)
│   ├── capabilities/  # host + client capability impls (§7)
│   └── rpc/           # gRPC schema (derived from pi-agent-core) + transports
│
├── apps/
│   ├── daemon/        # Core entrypoint (kanthord)
│   ├── web/           # SPA (visualization)
│   ├── app/           # macOS + iOS wrapper(s)
│   └── cli/
│
└── proto/             # .proto sources + codegen (buf, connect-swift)
```

> `pi-agent-core` / `pi-ai` are external pinned dependencies (installed from
> npm), not local packages — so there is no `packages/agent` or `packages/ai`.

---

# Daemon Modules

```
daemon/src/
    agent/        # uses pi-agent-core directly (no extra abstraction)
    ai/           # uses pi-ai directly
    memory/
    tools/        # tool contract + canRun seam
    plugins/
    capabilities/ # host capability layer
    scheduler/    # in-process timer + file-based durable jobs
    storage/      # file-based DB (markdown/json/jsonl)
    transport/    # UDS + HTTP/Connect
    events/
    security/     # canRun seam
    config/
    server.ts
```

---

# 3. Technology Choices

## Programming Language

- **TypeScript** (primary, Core + clients)
- **Swift** (macOS host capability helpers + macOS/iOS app)

## Runtime

- **Node.js 24+**
- Ships as a **Single Executable Application (SEA)** (B1) — viable because there
  are **no native `.node` modules** (D2). If native code is ever needed, we fork
  and build our own (no third-party native addons).

## Agent Runtime — `@earendil-works/pi-agent-core@0.80.2`

Responsibilities: planning, orchestration, execution, agent lifecycle. Note:
pi-agent-core only does context/token **compaction** and **retry on transient
errors**. Max-iteration caps, token budgets, and cost tracking are **ours to
add** on top (S2).

## AI Runtime — `@earendil-works/pi-ai@0.80.2`

Responsibilities: provider abstraction, model selection, retries, streaming,
tool calling. These packages ARE the adapter (D3) — no wrapper layer.

## RPC / Transport

- **gRPC** is the wire contract; we build **our own gRPC schema derived from
  pi-agent-core** (S5).
- **Connect** serves gRPC + gRPC-Web + the Connect protocol from one schema and
  one server, so the browser works with no proxy.
- **Codegen** (S7): `buf` for TypeScript, `connect-swift` for the Swift app.
- Two transports: **UDS** (local native) and **HTTP/Connect** (browser + remote).
- Streaming: server→client (agent tokens) only; client/bidi not needed.

## Validation

- **Zod** for: configuration, **tool input schemas** (emitted to the model as
  JSON Schema), and agent outputs.
- **proto owns the RPC wire contract** — do NOT re-validate RPC messages with Zod
  (S5).

## Event Bus

- In-process: **eventemitter3** or **Emittery**.

## Storage — file-based (D1, B6, N1–N3)

- **No SQL database. No SQLite / better-sqlite3.** Build our own file-based DB.
- **Markdown is the primary format**; **json / jsonl** secondary.
- Stores: conversations, tasks, configuration, memory, audit/events/state.
- **Atomicity (N1):** single-writer process **and** atomic write
  (write-temp-then-rename) + file lock for every write.
- **Query/index (N2):** a custom **search interface**; v1 is full-scan. Add
  index strategies only at a performance wall.
- Every persisted file carries a `version` field (see §8).

## Vector Search

- **Deferred (N3).** No `sqlite-vec`. Bring our own vector solution later, only
  when needed; it fits behind the N2 search interface.

## Logging

- **pino**, structured. **Operational logs → rotating jsonl files.** Audit /
  events / state go to their own files in storage — never mixed with operational
  logs (B6).

## Scheduler & Queue (D5, B5, S3)

- **In-process timer** + a **file-based durable job store** — no Bree, no
  PQueue, no Redis.
- Jobs have explicit states: `queued → claimed → running → {done|failed|
  cancelled}`. The runtime claims jobs from the store so restarts resume.

## Infra primitives (D5)

- Logging, queue, pub/sub, atomic locking, etc. are **file-based**. Adapt an
  existing file-based solution, otherwise build our own. No external brokers.

## Native Integration

- Via the **capability layer** (§7). macOS host capabilities are implemented as
  **Swift helper processes** Core talks to over IPC.

---

# 4. Security & Auth

## Minimal security seam (D4, B3)

Every tool call passes through one chokepoint: `canRun(tool, args, context) →
allow | deny`. Default is **allow** (single-machine, observed), **except a small
denylist of obviously dangerous operations** (e.g. destructive root wipes,
reading `~/.ssh`, `~/.aws`). The policy can grow later without touching call
sites. Real host safety for local dev comes from the **Podman sandbox** (D9, §9).

## Auth (D6, B4, B10)

- **VPN-gated.** All remote access assumes a VPN (Tailscale default). **Trust the
  tunnel — no app-level TLS** (Tailscale/WireGuard already encrypts). Native apps
  may use **h2c**.
- **Single user**, single **key id / secret**. No multi-user, no multi-tenant.
- The credential travels in the gRPC **`authorization` metadata** (maps to the
  HTTP `Authorization` header for gRPC-Web), so browser / app / CLI carry it
  identically. Transports just **forward** it to Core's auth — no per-transport
  session. Value format `Basic base64(keyId:secret)` or Bearer (decide at build).
- **Verifier is hashed:** Core stores only `sha256$<salt>$<hash>` (salted
  SHA-256 + constant-time compare, via Node built-in `crypto` — no native dep).
  The secret is high-entropy random, so a slow KDF is unnecessary.
- **Provider API keys (pi-ai) stay plaintext** in a file (they must be replayed
  to the provider), SSH-style: file `0600`, dir `0700`, owner-only. Core refuses
  to start on loose perms unless an explicit dev override is passed.
- Env vars are a **dev/bootstrap fallback only**, never default precedence.

---

# 5. Storage Layout

A single host directory **`.data/`** holds both the **UDS socket** and the
**file-based database** directory (D9 dev volume boundary); for local dev this
one directory is mounted into the Podman container.

```
.data/
    sockets/      # UDS socket
    database/     # conversations, tasks, memory, config, audit/events/state
    logs/         # operational logs (jsonl, rotating)
    auth/         # hashed verifier + plaintext provider keys (0600)
    cache/
```

---

# 6. Tool Execution Contract (B9)

Use Anthropic's `tool_use` / `tool_result` shape only at the **model boundary**;
Core uses a richer **daemon-first** contract. Every tool declares: `name`,
`version`, `description`, `inputSchema` (canonical JSON Schema), result-envelope
schema, `capabilities`, `permissionHints`, `timeoutMs`, `maxOutputBytes`,
`streaming`, `concurrency`, `retryPolicy`, `cancellation`, `auditPolicy`.

Invocation: `runId`/`stepId`/`callId` → validate args → policy timeout +
`canRun` → deny emits `ToolFinished status=denied` → execute with AbortSignal +
locks + output limits → emit `ToolExecuting` → optional chunks → **exactly one**
`ToolFinished` (succeeded/failed/timed_out/cancelled/denied) → append-only JSONL
event → return model-safe `tool_result` by `callId`.

**v1 subset to build now:** `name`, `version`, `inputSchema`, result-envelope,
`capabilities`, `timeoutMs`, `cancellation` (+ terminal status), `retryPolicy`,
append-only JSONL events, and the `canRun` gate. **`retryPolicy` is required**
because pi-agent-core retries transient errors — without it, side-effecting tools
can run twice. **Defer** `streaming`, `maxOutputBytes`, and artifacts until a UI
consumes them.

---

# 7. Capability Layer (D9, Flutter-style)

Adopt Flutter's *shape* (one capability API, many platform implementations), not
its machinery (no method channels / federated registration). Capability-first
and ownership-aware:

- **One shared contract + registry per capability**; implementations may live in
  different runtimes/languages ("shared definition, distributed implementation").
- **Ownership tag:** `host` (Core-owned: screen capture, keychain, clipboard) vs
  `client` (app-owned: camera, push, share sheet). **iOS is NOT a Core runtime**,
  so `ios` holds **client-side** capability impls only.
- **Selection = runtime-mode + feature probing**, not just `process.platform`
  (handle macOS+Podman, host-Linux vs container-Linux, VPS, CI, sandboxed macOS,
  future Windows). Model environment limits.
- **Registry/manifest:** clients discover what exists, why it is unavailable, and
  whether a user action can enable it (e.g. macOS screen-recording permission).
- **Unsupported-default throws** until built. Naming: **"host capabilities" /
  "client capabilities"** — distinct from the plugin system.

```
/capabilities
  /host            # Core-owned
    /screen-capture
      interface.ts   unsupported.ts   macos.ts (→ Swift helper IPC)   linux.ts (stub)
  /client          # app-owned
    /camera  /push  /share          # ios.ts, web.ts, ...
```

- **YAGNI:** build the contract + `host/macos` + unsupported-default first; leave
  `host/linux` and `client/*` as stubs.
- **Hard part = the Swift-helper IPC contract** (auth, lifecycle, versioning,
  binary discovery, codesigning, OS permission + user consent, streaming).
- **Known gap (deferred):** Core requesting a **client-side** action (e.g. tell
  the phone to take a photo) needs server→client invocation over the gRPC link —
  designed in a later milestone.

---

# 8. Versioning & Migrations (B8)

Every persisted file carries a `version` field, starting at `version: 1`.
Migration logic lives in the code that needs it. The upgrade flow must **show
what will auto-apply and what needs user action**, and must **never run any
upgrade without explicit user confirmation**.

---

# 9. Deployment & Integration

## A. macOS

Ship as a standard macOS app (drag into Applications). The app bundle carries the
latest Core binary and **owns updates** (copy → replace → restart); no separate
installer.

```
Kanthor.app/Contents/
    MacOS/Kanthor
    Resources/daemon/kanthord
```

Runtime data lives under `~/Library/Application Support/Kanthor/` (see §5
`.data/` layout). **Lifecycle (B7):** `launchd` owns start/stop/restart; Core
exposes a **health endpoint** and a **known socket path** for client discovery.
**Local transport = UDS.**

## B. iOS

iOS is a **remote-only client** (S6) — it never runs Core. It connects over the
VPN to a Core on a home server or VPS via the HTTP/Connect (or gRPC) transport.
No agent logic on iOS. Client-side native features live in the app via the
capability layer (§7).

## C. VPS

The same Core. Install via standalone binary, npm, or Docker.

```
/var/lib/kanthor/   (or ${XDG_STATE_HOME}/kanthor for a user service)
    database/  logs/  auth/  cache/  sockets/
```

**Lifecycle:** `systemd` with `Restart=always`. **Network:** access is
**VPN-gated** (Tailscale); auth is the single key id/secret in `authorization`
metadata (no app-level TLS — the tunnel encrypts).

## D. Web hosting

The SPA is **static** and served by **nginx** (deployed to the VPS; local testing
runs nginx locally). nginx serves the SPA and can reverse-proxy `/api` to Core's
gRPC-Web endpoint. Cloudflare remains a possible host but self-hosted nginx is
the default. The browser must be on the tailnet to reach Core.

## E. Docker / Podman

The same Core binary runs in a container with `.data/` on a persistent
volume/mount. **Local development runs Core inside Podman** for host safety — see
the dedicated setup in `02-development-setup.md`.

---

# 10. Design Philosophy

- Core is the product; every client is pure visualization over one gRPC schema.
- All business logic lives in Core.
- Agents orchestrate; tools perform deterministic work behind a permission seam.
- Communication is event-driven; durable history is append-only on disk.
- Storage is file-based (markdown/json/jsonl), single-writer, atomic.
- Platform-specific functionality is isolated in the capability layer.
- The same Core runs locally, on a server, or inside a container with minimal
  platform-specific change; local dev is sandboxed in Podman.
```
