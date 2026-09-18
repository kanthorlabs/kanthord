---
title: Worker Service Implementation
---

# Worker Service Implementation

This file holds the implementation rulings for the mechanisms that realize [worker-service.md](viewer.html?p=worker-service.md).
A design page holds no mechanism, so a mechanism lives here.
This file is not a design document, and `worker-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
The implementation epics of phase 3 consume this file.
A ruling that names a package, a product or a version is deliberate, and a change to it is a change to the workers that run on it.

## Native agent runtime

The native agent of `general@1` runs the pi-coding-agent SDK in-process behind a kanthord-owned adapter.
The daemon gives pi its own directories.
It disables the discovery of user extensions, skills, prompt templates and themes.
It uses an in-memory session manager.
It disables the version check, the install telemetry and the provider catalog refresh.
It pins the exact pi version, and a pi version bump is a deliberate change to the workers that run on it.
Every runtime setup call carries an abort signal with a deadline.

## Model gateway interception

One interception point carries every inference call of a native agent, including compaction and retries.
It resolves the effective configuration of the agent under the execution identity, maps the model identifier and the reasoning effort, fails closed, and holds per-execution state so that no credential crosses executions.
A custom pi provider that forwards to the model gateway is the candidate.
Environment hygiene of the pi process belongs to the same mechanism.

## Tool table

The tool table of a native agent holds three sources.
The first source is the pi built-in tools: `general@1` enables read, edit, write, grep, find, ls and bash, and `re@1` enables read, grep, find and ls.
The second source is kanthord's own tools, which the daemon serves through an MCP server that it embeds and that pi reaches as a tool source.
The third source is the other tools that a project adds, including other MCP servers.
The first version supports MCP v2, https://ts.sdk.modelcontextprotocol.io/v2/.
The tool register and the abstraction layer for tool instances manage the three sources.
The interactive ask_question tool is excluded.

## Commit attribution

The page requires that every commit of the execution is attributable to its task and its attempt.
The carrier of that attribution is an epic decision.

## Stop and budget

The lease runs in the execution.
On revocation or loss the execution aborts the pi session and dispatches nothing after.
Abort is not proven to kill every descendant process, so the quiescence check before workspace reuse that the page states needs a mechanism.
The budget of a turn count and a wall time is enforced on pi turn events and by abort, with the bash timeout below the remaining budget.

## Traces

The pi session entries of an execution become its transcript telemetry, with the execution identity and the attempt, redacted of secrets.
pi keeps its own compaction logic, and kanthord designs nothing for it.

## Acceptance path

The acceptance path is the `general@1` loop, the handoff, the commit and the verification, the push, the release, the independent `reviewer@1` evaluation, the configured repository action, the authoritative observation of its end state, and the `Completed` outcome.
A scripted fake provider runs it deterministically.
A bounded real-provider smoke run proves the real configuration.
