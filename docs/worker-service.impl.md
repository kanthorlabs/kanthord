---
title: Worker Service Implementation
---

# Worker Service Implementation

This file holds the implementation rulings for the mechanisms that realize [worker-service.md](viewer.html?p=worker-service.md).
This file is not a design document, and `worker-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate, and a change to it is a change to the workers that run on it.

## Native agent runtime

The first version supplies the workers `general@1` and `reviewer@1`.
The workers `claude@1` and `opencode@1` follow with the registration of an externally hosted instance, and `tdd@1` is postponed to phase 2.
The native agent `swe@1` of `general@1` runs the pi-coding-agent SDK in-process behind a kanthord-owned adapter.
The daemon gives pi its own directories.
It disables the discovery of user extensions, skills, prompt templates and themes.
It uses an in-memory session manager.
It disables the version check, the install telemetry and the provider catalog refresh.
It pins the exact pi version, and a pi version bump is a deliberate change to the workers that run on it.
Every runtime setup call carries an abort signal with a deadline.

## Externally hosted worker

The kanthord extension of Claude Code and the kanthord plugin of opencode register the instance under its client identity, issue the work pull, drive the execution operations through the CLI and the MCP server, and release.
Their design, and the packaging of the `/work` orchestration skill that they carry, are epic decisions.

## Prompt composition

The prompt composer resolves the global prompt from the daemon configuration, then `~/.agents/AGENTS.md`, then `~/.claude/CLAUDE.md`.
It resolves the project prompt from the repository binding, then `AGENTS.md` of the workspace root, then `CLAUDE.md` of the workspace root.
For an evaluation method that resolution stops at the repository binding, and the composer reads no agent file of the workspace.
It reads an agent file as UTF-8 Markdown, it rejects a control character outside tab and newline, and it resolves no `@` import.
It rejects a path of the workspace that a link resolves outside the workspace.
It follows a link of the host location, because the operator manages the dotfiles of the host.
A deadline bounds every read.
The repository context-file discovery of pi stays disabled, and the composer performs every load, so one loader holds the order and the provenance.
pi receives the base prompt and the agent prompt as its system prompt, with the framing that states the layers and their precedence.
It receives the global prompt, the project prompt and the work prompt as separate marked content, each one attributed to its source.
The adapter pins the composed layers against the compaction of pi, so every layer survives a compacted context.
The tool table enforces every obligation that a tool can enforce, and `re@1` holds no write tool.
The first version supplies one base prompt for `swe@1` and `re@1`, `docs/assets/prompt/base.md`, and the agent prompts `docs/assets/prompt/swe@1.md` and `docs/assets/prompt/re@1.md`.
The source of the three texts is the ideals file of Ulrich, split by single obligation: a standard of the product and a shared conduct go to the base prompt, the act of producing goes to `swe@1`, the act of judging goes to `re@1`, and a rule that presupposes a human interlocutor is adapted or dropped.
The recommendation-first format of a confirmation request returns with the clarification interface.
The bound of the global prompt and the bound of the project prompt are epic decisions.
The acceptance path proves the configured precedence, an absent source, an invalid source, a disabled layer and a link that leaves the workspace.
It proves that a reviewer execution takes no agent file of the workspace.

## Model connector interception

One interception point carries every inference call of a native agent, including compaction and retries.
It resolves the effective configuration of the agent under the execution identity, maps the model identifier and the reasoning effort, fails closed, and holds per-execution state so that no credential crosses executions.
A custom pi provider that forwards to the model connector is the candidate.
Environment hygiene of the pi process belongs to the same mechanism.

## Tool table

The tool table of a native agent holds three sources.
The first source is the pi built-in tools: `swe@1` enables read, edit, write, grep, find, ls and bash, and `re@1` enables read, grep, find and ls.
The second source is kanthord's own tools, which the daemon serves through its MCP server.
An external harness reaches the same server, and pi reaches it as a tool source.
The third source is the other tools that a project adds, including other MCP servers.
The first version supports MCP v2, https://ts.sdk.modelcontextprotocol.io/v2/.
The tool register and the abstraction layer for tool instances manage the three sources.

## Platform connector and platform implementations

The GitHub implementation calls the GitHub REST API through Octokit at a pinned version.
A platform implementation is a TypeScript module with its own method signatures and no shared interface.
The platform connector is a registry keyed by the platform value of the binding.
The registry uses static registration and loads no runtime plugin.
The GitHub implementation decodes a GitHub webhook payload into GitHub event types.
Every method returns a discriminated union: the success with the result of the operation, or the result class.
A deadline bounds the retry of a read on a transport error.
The platform implementation retries no write.
The platform implementation decides whether a request waits for a reply of the platform or returns after the platform accepts it.
An epic decides that form for each platform.

## Repository connector

The git CLI performs the network git read and the network git write.
The daemon serves a credential helper for one operation.
The credential helper writes no credential to a file in the workspace.

## Action performer

One internal function implements the action performer.
The evaluation method of `reviewer@1` and the MCP tool both call that function.
A per-execution-identity mutex serializes invocations inside the daemon.
The mutex establishes the no-redispatch invariant inside one daemon process only.
A durable dispatch record that survives a daemon restart is the B9 item W2, and it is an epic decision.
The action performer creates a fresh clone through the repository connector for a network git write.
It removes that checkout after the call.

## MCP server

The MCP v2 server in [Tool table](#tool-table) is the one MCP server of the daemon.
An external harness connects over HTTP with its client identity and client secret.
The first version approves two read methods of the GitHub implementation.

- The read of a pull request.
- The list of the review comments of a pull request.

The tool of the action performer takes the execution identity only.

## Commit attribution

The page requires that every commit of the execution is attributable to its task and its attempt.
The carrier of that attribution is an epic decision.

## Stop and budget

The lease runs in the execution.
On revocation or loss the execution aborts the pi session and dispatches nothing after.
Abort is not proven to kill every descendant process, so the quiescence check before workspace reuse that the page states needs a mechanism.
The budget of a turn count and a wall time is enforced on pi turn events and by abort, with the bash timeout below the remaining budget.

## Trust boundary

The operator provides the trust boundary as a disposable host that the operator trusts, or as an OS container around the daemon.

## Traces

The pi session entries of an execution become its transcript telemetry, with the execution identity, the attempt and the trace identity, redacted of secrets.
pi keeps its own compaction logic, and kanthord designs nothing for it.

## Acceptance path

The acceptance path is the `general@1` loop, the commit and the verification, the push, the release, the independent `reviewer@1` evaluation, the configured repository action, the authoritative observation of its end state, and the `Completed` outcome.
A scripted fake provider runs it deterministically.
A bounded real-provider smoke run proves the real configuration.
