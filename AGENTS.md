# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield, clean slate. Only the **dev setup** exists: the Podman local dev
sandbox (`Containerfile`, `Makefile`, `compose.yaml`, `scripts/dev/`) and the
TDD agent pipeline (`.claude/`, `.opencode/`, `.agent/tdd/`). There is **no
product source code and no tests yet** — do not assume an app to build or run
beyond the sandbox harness. Architecture and design decisions are being
brainstormed from scratch; nothing here is binding yet.

`kanthord` is the daemon ("Core"). The `scripts/dev/*.mjs` files are throwaway
**stand-ins** that only exercise the dev sandbox until real Core exists.

## Development commands

Local dev runs Core **inside Podman** (host safety). Full action reference:
`docs/md/development.md`; `make help` lists targets. Common:

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

## TDD pipeline

Implementation work runs through the four-role TDD loop under `.claude/` and
`.opencode/` (test-engineer, software-engineer, reviewer-engineer, `/work`),
configured by `.agent/tdd/PROFILE.md`. To author milestone work for that loop,
follow the shared rules in `.agent/authoring.md` — Epic/Story/Task structure,
behavior-only ACs, and the TDD task template. Plans live under `.agent/plan/`.
