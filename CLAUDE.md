# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield. Only the **infrastructure milestone** exists so far: the Podman local
dev sandbox (`Containerfile`, `Makefile`, `compose.yaml`, `scripts/dev/`) and the
planning docs. There is **no `package.json`, no source code, and no tests yet** —
do not assume an app to build or run beyond the sandbox harness.

`kanthord` is the daemon ("Core"). The `scripts/dev/*.mjs` files are throwaway
**stand-ins** that only exercise the dev sandbox until real Core exists.

## Source of truth for decisions

`.agent/milestone/01-infrastructure/` holds the binding design decisions
(`01-plan.md`, `01-plan-revise.md`) referenced everywhere as **D1–D9 / B / S / N**.
Read these before designing anything; they override assumptions. Each milestone
task lives in its own numbered file (e.g. `02-development-setup.md`).

When **authoring** any milestone (writing task briefs), follow the shared rules
in `.agent/authoring.md` — behavior-only ACs vs. decision-cited Constraints, the
spike gate, and the task-brief template.

## Development commands

Local dev runs Core **inside Podman** (host safety, D9). Full action reference:
`docs/development.md`; `make help` lists targets. Common:

```sh
make machine-up     # start the Podman VM (once per boot)
make up             # single container; host client talks over TCP 127.0.0.1:7777
make compose-up     # server + client containers talking over UDS (named volume)
make logs           # follow logs
make verify         # build, run, probe the .data/ boundary, tear down
make shell          # bash inside the container
make reset          # wipe .data/ (DESTRUCTIVE)
```

## Dev sandbox boundary (non-obvious, learned the hard way)

- **Only `.data/` is shared from the host. Source is COPYed into the image, never
  bind-mounted** — otherwise the agent's tools could damage the host tree, which
  defeats the sandbox. Keep it that way.
- **UDS does not cross the macOS host → VM boundary** (virtiofs): a socket created
  in a bind-mounted dir is visible on the host but not connectable (`ECONNREFUSED`).
  It **does** work container ↔ container over a **named volume**. So:
  - client in a container → UDS over the shared `sock` volume (`compose.yaml`);
  - client on the Mac host → published TCP port;
  - Core native on the Mac → UDS directly.
- The VM uses the `applehv` provider; rootless containers run `--userns=keep-id`
  so files in `.data/` stay host-owned with correct `0600`/`0700` perms.
- Native (macOS) host capabilities throw "unsupported" inside the Linux container
  (`process.platform === "linux"`). Use native-on-Mac mode for capability work.

## Architecture (target design)

One long-running daemon, **Core**, is the product. Every client (Web SPA, macOS/
iOS app, CLI) is **pure visualization** over **one gRPC schema** — no business
logic in clients. Core exposes **two transports** from one schema: **UDS** (local)
and **HTTP/Connect** (browser via gRPC-Web, remote native via gRPC). The HTTP
transport is a Core module, not a separate tier.

State lives in a single host dir **`.data/`**: `database/` `logs/` `auth/`
`cache/` `sockets/` (see `01-plan.md` §5).

## Hard constraints (these shape all future code)

- **File-based storage only — no SQL, no SQLite.** Build our own file DB; markdown
  primary, json/jsonl secondary. Every persisted file carries a `version` field.
  Writes are single-writer + atomic (write-temp-then-rename) + file lock (N1).
- **No native `.node` modules** (D2) — keeps the SEA build and cross-arch (arm64
  dev / amd64 VPS) trivial. Need native code? Fork and build it ourselves.
- **`@earendil-works/pi-agent-core` + `pi-ai` (pinned 0.80.2) ARE the agent/AI
  adapter** (D3). Do **not** wrap them in another abstraction; fork if something
  is missing.
- **proto owns the RPC wire contract — do not re-validate RPC messages with Zod**
  (S5). Use Zod only for config, tool input schemas, and agent outputs.
- **Security is a minimal seam:** every tool call passes one `canRun(tool, args,
  ctx)` chokepoint, default-allow with a small denylist (D4/B3). Real host safety
  is the Podman sandbox, not in-app policy.
- All infra (logging, queue, pub/sub, locking, scheduler) is **file-based,
  in-process** — no Redis, no external brokers (D5).
- Platform-specific behavior lives behind the **capability layer** (`host` vs
  `client` ownership); the default impl **throws "unsupported"** until built (§7).

## Tech stack

Node.js 24+ / TypeScript (Core + clients), Swift (macOS/iOS app + host capability
helpers). gRPC via Connect; codegen with `buf` (TS) and `connect-swift`. Zod for
validation, pino for logs, eventemitter3/Emittery for the in-process event bus.
Ships as a Single Executable Application (SEA).
