---
title: Agent Implementation
---

# Agent Implementation

This file holds the mechanisms that realize [agent.md](agent.md).
This file is not a design document, and `agent.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## Session file

- The adapter stores an agent session as the JSONL session file of `@earendil-works/pi-coding-agent` at 0.86.0.
- The session file lives under `sessions/` of the pi agent directory that `PI_CODING_AGENT_DIR` names.
- pi appends each entry of the session to that file.
- A resume opens that file through the `SessionManager` of pi.
