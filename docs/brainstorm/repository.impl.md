---
title: Repository Implementation
---

# Repository Implementation

This file holds the mechanisms that realize [repository.md](repository.md).
This file is not a design document, and `repository.md` stays the single source of truth.
A mechanism here never overrides a rule there.

The implementation uses `simple-git` at 3.36.0.

## Platform connector and platform implementations

The GitHub implementation uses `octokit` at 5.0.5 with `X-GitHub-Api-Version: 2022-11-28`.

- The GitHub SSH host set is `github.com` and `ssh.github.com`.
- Every platform implementation declares its SSH host set.

- Pull request read calls `GET /repos/{owner}/{repo}/pulls/{pull_number}`.
- Review comment list calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments`.
- Both return the response body unchanged.
- `limit` maps to `per_page`, defaults to 100 and ranges from 1 to 100.
- `cursor` is base64url canonical JSON `{ page, perPage }`.
- A differing `limit` answers 400 `repository.platform.github.cursor_page_size_mismatch`.
- `nextCursor` is null when no `rel="next"` link exists.
- Tool discovery embeds each endpoint's dereferenced response schema under `result`.
- The build extracts those schemas from `@octokit/openapi` at 23.0.2.
- A result class answers `repository.platform.github.<class>` with the HTTP status and GitHub message.
- The embedded schema is large; a harness that sends `outputSchema` to its model spends tokens on it.
- Tests assert unchanged bodies, pagination bounds, cursor page-size refusal, schema extraction and result-class details.

A platform implementation is a TypeScript module with its own method signatures and no shared interface.
The platform connector is a registry keyed by the platform value of the binding.
The registry uses static registration and loads no runtime plugin.
The GitHub implementation decodes a GitHub webhook payload into GitHub event types.
Every method returns a discriminated union: the success with the result of the operation, or the result class.
The check method folds the state of an external object into `expected`, `other` or `none` against the expected end state that its caller names, and it answers the landed commits of an `expected` repository result.
The [retry rules](repository.md#result-classes) use the deadline that the caller supplies.
The platform implementation decides whether a request waits for a reply of the platform or returns after the platform accepts it.
An epic decides that form for each platform.
The read-back of `github.pull_request` calls `GET /repos/{owner}/{repo}/pulls` with `state=open`, `head=<owner>:<node branch>` and `base=<base branch>`.
The read-back of `git.merge_push` fetches the base branch through the repository connector and runs `git merge-base --is-ancestor <snapshot commit> <base branch>`.

## Repository connector

The start requires git 2.40 or later, OpenSSH 9.0 or later and bash on the host.
It refuses a host without a required tool with `repository.connector.tool_missing`, and a tool below its version with `repository.connector.tool_version`.

- `simple-git` performs every git operation of the connector by spawning the `git` binary of the host.
- The SSH host resolution is no git operation. The connector runs `ssh -G -- <host>` through `execFile` of `node:child_process`, bound by the deadline and the `Context` of the caller.
- The resolution reads the `hostname` line of the output.
- A resolution that fails, is aborted or reaches its deadline answers `repository.connector.ssh_resolve_failed`. The Project Service maps it to `project.bindings.repository.address_invalid`.
- Its timeout plugin bounds each operation by the remaining resource budget that the caller supplies.
- Its abort plugin binds to the `Context` of the caller.
- The `git` child inherits the [SSH environment](#the-ssh-environment) of the user that runs the hosting application.
- `simple-git` kills the `git` process and not the `ssh` child of that process.
- A git operation of the connector that fails, is aborted or reaches its deadline answers `repository.connector.git_failed`, and the message names the operation.

## The SSH environment

- Custody supplies no material for git.
- The inherited environment includes `SSH_AUTH_SOCK`, and SSH uses the host files `~/.ssh/config` and `~/.ssh/known_hosts`.
- The SSH host resolution reads the same `~/.ssh/config`, so it resolves an alias host as the `ssh` child of git resolves it.
- The connector sets no `GIT_SSH_COMMAND` and no `GIT_SSH`.
- The connector passes no credential inside a URL and no secret on the command line of a child.
- The command line of a process is readable by every user of the host.
- A network git operation has no attribution to a credential record.
