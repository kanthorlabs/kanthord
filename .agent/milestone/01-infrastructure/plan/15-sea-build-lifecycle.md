# 15 SEA Build & Lifecycle

Goal:             Package Core as a Single Executable Application and define its
                  lifecycle contract — a concrete readiness check + a resolved
                  known socket path — with the OS service manager owning
                  start/stop/restart.

Decision anchors: B1 (ship as a SEA), D2 (no native `.node` → SEA + cross-arch is
                  trivial), B7 (service manager owns start/stop/restart; health +
                  known socket for discovery; app bundle owns update), §9
                  Deployment.

ACs:
- Core builds into a **Single Executable Application** that runs **without a
  separate Node install**.
- The SEA **actually runs on both linux/arm64 (dev container on Apple Silicon) and
  linux/amd64 (VPS)** — execution on both arches is required, not just documented
  intent. (A macOS-native/darwin SEA is deferred with the macOS app.)
- Core exposes a **readiness** check whose "ready" means all of: **config loaded,
  auth verifier usable (remote path), storage opened, the HTTP/gRPC-Web listener
  bound, and the RPC handler serving**. Liveness (process up) is distinct from
  readiness. (UDS is deferred — epic 11.)
- The HTTP endpoint resolves to a known address (dev `127.0.0.1:7777`; remote bind
  deployment-owned) and runtime data resolves to a **platform-absolute `<data-dir>`**
  per §9 (VPS `/var/lib/kanthor/` or `${XDG_STATE_HOME}/kanthor`, container
  `/data`; macOS path deferred with the macOS app). Clients discover the resolved
  HTTP endpoint.
- **The OS service manager owns lifecycle:** Core runs in the **foreground** (no
  self-daemonize); **systemd `Restart=always`** (Linux/VPS + container) starts it
  and restarts it on process exit. A systemd unit is provided. **launchd/macOS is
  deferred** with the macOS app (Web-first). The service manager restarts on
  **process exit**; a gRPC health probe is a client-side contract unless a unit
  ships a concrete probe hook.
- **Bad-secret state is surfaced, not hidden:** invalid auth/perms or config makes
  Core **fail to start (non-ready) with a clearly logged reason**; under
  `Restart=always` this is an expected crash-loop until the operator fixes it.

Constraints:
- Ships as a **SEA** (B1); viable only because there are **no native `.node`
  modules** (D2) — the build stays pure-JS, passing the epic-03 native guard.
- Lifecycle = **systemd `Restart=always`** (B7); Core does not manage its own
  daemonization. launchd (macOS) is deferred with the macOS app; **app-bundle-owned
  update** (§9) is also macOS-app work (later). Epic 15 ships the SEA + the systemd
  unit + the discovery contract, not the updater or launchd.
- **No bundled-Node / alternative-packaging fallback** is introduced here — that
  would dilute B1. If SEA cannot package the app, the spike **escalates the
  decision** (see Notes), it does not silently switch packaging.
- Runtime data lives under the §9 paths — also where epic-08 auth + epic-03 config
  resolve.
- **Startup wiring** is owned by this capstone (`server.ts`); epic 15 only verifies
  the **already-built** modules (03/08/10/11/…) start together and fail fast — it
  does not re-own their internal behavior.

Spike?:           YES — Node's **SEA is experimental** (authoring rule 3 / external
                  build boundary): confirm Node 24 can bundle our **ESM app + all
                  deps** (Connect runtime, pino, zod, pi-agent-core/pi-ai), handle
                  assets, and run on **arm64 + amd64**. Record exact **Node
                  version, flags, asset handling, dependency limits, and repro
                  steps**. **Allowed outcome:** SEA works on both arches → proceed;
                  SEA cannot package as-is → **escalate the B1 decision with
                  findings** (no silent fallback).

Verification:     the build produces a SEA binary that **starts, passes readiness**
                  (all checks above), and listens on `127.0.0.1:7777`; it **runs on
                  both linux/arm64 and linux/amd64** (CI matrix /
                  two hosts); the systemd unit starts it and **restarts after a
                  kill** (launchd deferred); an invalid auth/perms/config run fails
                  fast with a clear
                  logged reason. This build+probe is the executable done-gate; the
                  recorded spike does not close it (rule 8).

Dependencies:     01 (build/native guard), 03 (config fail-fast), 08 (auth at
                  startup), 10 (health/readiness RPC), 11 (socket/port + listeners),
                  and the runtime modules it wires (`server.ts`). Capstone epic.

Findings out:     `.agent/milestone/01-infrastructure/plan/findings/15-sea-build.md`
                  — Node SEA caveats (version/flags/ESM/assets/cross-arch/dep
                  limits, repro) + the B1 go/escalate outcome. Release/CI builds
                  on it.
