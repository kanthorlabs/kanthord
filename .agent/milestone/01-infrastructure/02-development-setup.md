# 02 Development Setup — Podman Sandbox (Task)

> **Status:** TODO — dedicated session, not yet started.
> **Source rule:** D9 / HARD RULE in `01-plan-revise.md` — "we must run a
> dedicated session to set up and document how to use Podman in this project."
> This is **required, not optional**.

## Why

Local development runs **Core inside Podman** so the agent's tools
(shell/filesystem) can damage only the container, never the host. This is the
**host-level** safety layer that compensates for the permissive in-app security
(D4, default-allow `canRun`). Podman is rootless/daemonless — a better posture
than Docker.

## Goal

Set up a reproducible Podman-based local dev environment for Core **and** write
the usage documentation for it.

## Deliverables

1. **Container setup** — a `Containerfile` (and/or `compose`/`podman kube` file)
   that builds and runs Core in a Linux container.
2. **`.data/` mount** — a single host directory `.data/` (holding the UDS socket
   and the file-based database) mounted into the container (D9 dev volume
   boundary). One mount covers socket + DB.
3. **Run scripts / Makefile targets** — build, start, stop, logs, shell-in.
4. **`PODMAN.md`** (or a section in the project README) — how to install, start,
   stop, reset, and troubleshoot the Podman dev environment. The documentation
   is part of the hard rule, not optional.

## Must verify early (known risks)

- **UDS over the Podman VM boundary (macOS).** Podman on macOS runs a Linux VM
  (`podman machine`), so a bind-mounted path crosses host → VM → container. Plain
  files in `.data/` are fine, but **Unix-socket files specifically can be finicky**
  across virtiofs. Verify the UDS in `.data/sockets/` is reachable from host
  clients early; if it is not, decide a fallback (e.g. TCP loopback into the
  container, or socket inside the VM with a forwarded port).
- **Native capabilities are unavailable in the container.** Inside the Linux
  container `process.platform` is `linux`, so macOS host capabilities throw
  "unsupported" (D9). Two local-dev modes exist on purpose:
  - **Core native on the Mac host** → has macOS host capabilities.
  - **Core in Podman** → sandboxed, no native capabilities until Linux impls
    exist. Document both modes and when to use each.
- **File permissions / ownership** of `.data/` across host↔container (rootless
  Podman uid mapping) — ensure the auth files keep `0600`/`0700` and Core does
  not refuse to start (B4 perms check).
- **File-DB atomicity across the mount** — confirm write-temp-then-rename + file
  locking behave correctly on the mounted volume (N1 single-writer model).

## Out of scope

- Production container hardening / VPS deployment image (covered by `01-plan.md`
  §9; this task is the **local dev** sandbox).
- Server→client capability invocation (deferred, see `01-plan.md` §7).

## References

- `01-plan.md` §4 (security), §5 (storage layout), §7 (capability layer), §9.E.
- `01-plan-revise.md` D9 + the capability-layer and dev-volume decisions.
