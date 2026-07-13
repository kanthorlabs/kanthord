# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

`kanthord` is the daemon ("Core"): one long-running Node 24 / TypeScript process.
**Phase 1 (foundations) is complete and Phase 2A (single-repo proof) is largely
built** — Core is real product code now, not a stand-in. The pipeline runs end to
end: scheduler dispatch → per-task git worktree → a `pi-agent-core` agent session
driven with `pi-coding-agent` tool factories → ring-1 write-scope/secret gate →
broker delivery (commit → push → open PR) → inbox/escalation + a Connect status
server. As of 2026-07-13 the **LP-A1 live proof passes**: given a compiled feature,
the agent writes real code in its worktree, the daemon commits it, pushes the branch,
and opens a **real PR** on the target repo. ~1016 tests green (`node --test`).

Source lives under `src/` (`scheduler/`, `broker/`, `ring1/`, `agent/`, `daemon/`
run-loop, `git/` + `slots/`, `inbox/`, `config/`, `compiler/`, `store/`,
`foundations/`, the Connect API, `harness/`). Work is planned as Epics/Stories under
`.agent/plan/` — Phase 1 = epics `001`–`010` (done); Phase 2A = `011`–`019.x`. The
`scripts/dev/*.mjs` files are dev-sandbox **probes** (host/UDS/boundary checks), not
Core.

**Still in flux (check `.agent/plan/` + the auto-memory index for live status):**
committer-identity config (`019.17`), PR-merge escalation + review-state polling
(`019.18`), the web control-plane dashboard (Epic `027`, Phase 2B), and multi-repo
(Phase 2B). Design still evolves; nothing in later-phase plans is frozen.

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

## Debugging and error handling (learned the hard way)

- **Logs first, then investigate manually — then close the gap.** If the logs
  cannot tell you the root cause of a bug, do **not** guess: reproduce it and
  investigate by hand (inspect live state, add temporary instrumentation, exec into
  the container, read the DB). Once you have found the real root cause, **self-check:
  "if this bug recurred, which single log line would have pinpointed it?"** — then add
  that log to the code **permanently** (not just as a throwaway probe). A bug that was
  invisible in the logs must never be invisible again.
- **Never silently swallow an error.** Every caught error must be *reported* — logged
  or escalated, depending on severity. Even an "unimportant" / best-effort error is
  logged (at least at `debug`/`warn`) with enough context to identify it; a
  user/operator-facing failure is escalated (inbox) *and* logged. An empty `catch {}`,
  `catch (e) {}` that drops `e`, or `.catch(() => {})` is a defect — at minimum it must
  `logger.*` the error. Use `pino`, never `console.*`, in production paths (see the
  logging idiom in `.agent/tdd/PROFILE.md`).

## TDD pipeline

Implementation work runs through the four-role TDD loop under `.claude/` and
`.opencode/` (test-engineer, software-engineer, reviewer-engineer, `/work`),
configured by `.agent/tdd/PROFILE.md`. To author milestone work for that loop,
follow the shared rules in `.agent/authoring.md` — Epic/Story/Task structure,
behavior-only ACs, and the TDD task template. Plans live under `.agent/plan/`.
