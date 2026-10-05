---
title: Repository Implementation
---

# Repository Implementation

This file holds the mechanisms that realize [repository.md](repository.md).
This file is not a design document, and `repository.md` stays the single source of truth.
A mechanism here never overrides a rule there.

The implementation uses `simple-git` at 3.36.0.

## Platform validators

The component owns a dedicated platform validator for every platform of the Repository component.

| Platform | Secret shape | Metadata | Validation |
| --- | --- | --- | --- |
| `github` | `api_key` | None | `GET https://api.github.com/rate_limit` |
| `ssh` | `none` | `{ host, hostname, port, identity_file }` | `ssh -G -- <host>` |

- A second shape for GitHub is another platform, for example `github-app`.
- The GitHub rate-limit probe reports `rate-limit read` and spends no rate limit.
- An `ssh` record pins the SSH identity of a repository binding. It holds no secret material and belongs to no git platform.
- The `ssh` validation runs `ssh -G -- <host>` through the repository connector. The record reports `ssh identity`.
- The `ssh` validation refuses a resolution with `identitiesonly` other than `yes` or with a number of `identityfile` lines other than 1. The code is 400 `repository.credential.ssh_identity_ambiguous`.
- The `ssh` validation refuses a resolved `hostname`, `port` or `identityfile` that differs from the metadata. The code is 400 `repository.credential.ssh_drift`, and `details` names each differing key.
- Create, rotation and metadata edit of an `ssh` record run the `ssh` validation. `ssh -G` is a local process and no remote call.
- Tests cover the GitHub probe, the refusal of a platform of another component and the `bindings` list of a get.
- The [credential healthcheck](architecture.impl.md#the-credential-healthcheck) rules apply.

## Operations

- The component declares the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) under the prefix `repository`.
- `repository.credential.create` accepts a record of every platform of the component.
- `repository.credential.ssh_discover` reads the SSH aliases at `GET /api/repository/credential/ssh/discover`. It is a read under `human` access and writes nothing.
- It reads the `Host` lines of the top-level `~/.ssh/config` and follows no `Include`. It skips each pattern that holds `*`, `?` or `!`.
- It runs `ssh -G -- <host>` for each alias and keeps the aliases whose resolved `hostname` contains `github`, `gitlab` or `bitbucket`. The keyword set is an enum in code.
- It answers `{ host, hostname, port, identity_file, state, reason }` for each alias. `state` is `ready`, `refused` or `present`. `present` means that a live `ssh` record holds the host, and `reason` holds the refusal code of a `refused` alias.
- An unreadable `~/.ssh/config` answers 422 `repository.credential.ssh_config_unreadable`.
- The engine creates an `ssh` record only on a human create. It creates none at start.
- The Repository credentials screen of the dashboard holds `Import from ~/.ssh/config`. The dialog calls `repository.credential.ssh_discover` and shows one row for each alias with its state and its reason.
- The dialog offers a checkbox only for a `ready` alias. Create calls `repository.credential.create` once for each ticked alias, with the alias as the record name and the discovered values as metadata.
- `repository.credential.get` answers the record with `bindings`, the list of `{ projectId, projectName, bindingId, name }` of every binding revision that names the credential and that is a dependent. The Project collaboration `bindingsNaming(tx, credentialName)` answers that read.

## Platform connector and platform implementations

The GitHub implementation uses `octokit` at 5.0.5 with `X-GitHub-Api-Version: 2022-11-28`.

- The GitHub SSH host set is `github.com` and `ssh.github.com`.
- Every platform implementation declares its SSH host set.

## Git-only platforms

A git-only platform has an SSH host set and no platform implementation.

| Platform | SSH host set |
| --- | --- |
| `gitlab` | `gitlab.com`, `altssh.gitlab.com` |
| `bitbucket` | `bitbucket.org`, `altssh.bitbucket.org` |

- A repository binding of a git-only platform names no `credential`, because no credential platform exists for it.
- Its binding permits the action `merge_push` and no action. The action `pull_request` refuses the write with 400 `project.bindings.repository.action_unsupported`.
- A platform implementation of a git-only platform makes it a full platform. Its credential platform, its validator and its `pull_request` support arrive together.

- Pull request read calls `GET /repos/{owner}/{repo}/pulls/{pull_number}`.
- Review comment list calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments`.
- Both return the response body unchanged.
- `limit` maps to `per_page`, defaults to 100 and ranges from 1 to 100.
- `cursor` is base64url canonical JSON `{ page, perPage }`.
- A differing `limit` answers 400 `repository.platform.github.cursor_page_size_mismatch`.
- `nextCursor` is null when no `rel="next"` link exists.
- Tool discovery embeds each endpoint's dereferenced response schema under `result`.
- The build extracts those schemas from `@octokit/openapi` at 23.0.2.
- A result class answers 502 `repository.platform.github.<class>` with `details: { status }` and the GitHub message. `status` holds the HTTP status of GitHub when the failure carries one, and null otherwise.
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
The read-back of the create of `github.pull_request` calls `GET /repos/{owner}/{repo}/pulls` with `state=open`, `head=<owner>:<node branch>` and `base=<base branch>`. The read-back of its reuse fetches the node branch through the repository connector and runs `git merge-base --is-ancestor <snapshot commit> <node branch>`.
The read-back of `git.merge_push` fetches the base branch through the repository connector and runs `git merge-base --is-ancestor <snapshot commit> <base branch>`.

## Repository connector

The start requires git 2.40 or later, OpenSSH 9.0 or later and bash on the host.
It refuses a host without a required tool with `repository.connector.tool_missing`, and a tool below its version with `repository.connector.tool_version`.

- Before each network git operation, the connector runs the `ssh` validation of the `sshCredential` of the binding. A refusal stops the operation with the code of the validation.
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

- Custody supplies no secret material for git.
- The `ssh` record of the binding pins the SSH host, the resolved hostname, the port and the one identity file that git uses.
- The inherited environment includes `SSH_AUTH_SOCK`, and SSH uses the host files `~/.ssh/config` and `~/.ssh/known_hosts`.
- The SSH host resolution reads the same `~/.ssh/config`, so it resolves an alias host as the `ssh` child of git resolves it.
- The connector sets no `GIT_SSH_COMMAND` and no `GIT_SSH`.
- The connector passes no credential inside a URL and no secret on the command line of a child.
- The command line of a process is readable by every user of the host.
- A network git operation names the `ssh` record of its binding in its attribution.
