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

| Platform | Secret shape | Metadata                                  | Validation                              |
| -------- | ------------ | ----------------------------------------- | --------------------------------------- |
| `github` | `api_key`    | None                                      | `GET https://api.github.com/rate_limit` |
| `ssh`    | `none`       | `{ host, hostname, port, identity_file }` | `ssh -G -- <host>`                      |

- A second shape for GitHub is another platform, for example `github-app`.
- The GitHub rate-limit probe reports `rate-limit read` and spends no rate limit.
- An `ssh` record pins the SSH identity of a repository binding. It holds no secret material and belongs to no git platform.
- The `ssh` validation runs `ssh -G -- <host>` through the repository connector. The record reports `ssh identity`.
- The `ssh` validation refuses a resolution with `identitiesonly` other than `yes` or with a number of `identityfile` lines other than 1. The code is 400 `repository.credential.ssh_identity_ambiguous`.
- The `ssh` validation refuses a resolved `hostname`, `port` or `identityfile` that differs from the metadata. The code is 400 `repository.credential.ssh_drift`, and `details` names each differing key.
- Create, rotation and metadata edit of an `ssh` record run the `ssh` validation. `ssh -G` is a local process and no remote call.
- The record verify and the resource healthcheck of an `ssh` record run the `ssh` validation. A refusal answers `unhealthy`.
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
- The dialog offers a checkbox only for a `ready` alias. Create calls `repository.credential.create` once for each ticked alias, with the discovered values as metadata. The record name is the alias in lower case, with each character outside `[a-z0-9-]` replaced by `-`, a prefix `ssh-` before a leading non-letter, and at most 63 characters.
- `repository.credential.get` answers the record with `bindings`, the list of `{ project_id, project_name, binding_id, name }` of every binding revision that names the credential and that is a dependent. The Project collaboration `bindingsNaming(tx, credentialName)` answers that read.

## Platform connector and platform implementations

The GitHub implementation uses `octokit` at 5.0.5 with `X-GitHub-Api-Version: 2022-11-28`.

- The GitHub SSH host set is `github.com` and `ssh.github.com`.
- GitHub event ids carry no order across event types. The events read and the checkpoint rank no event by its id.
- The events read answers the wait of `X-Poll-Interval` in milliseconds. It reads the header only on a 200 or a 304 answer, and it ignores a malformed value.
- A 429 is a rate limit refusal. A 403 is a rate limit refusal when `x-ratelimit-remaining` is `0` or when its message matches "secondary rate limit". A rate limit refusal is a `retryable_refusal`.
- A rate limit refusal answers the wait that GitHub names. `Retry-After` wins over `x-ratelimit-reset`. Both headers take integer seconds only, and an HTTP date names no wait.
- `x-ratelimit-reset` counts only when `x-ratelimit-remaining` is `0`. Its wait is the reset minus the current time, and a reset in the past gives a wait of 0. A refusal with no usable header names no wait.
- The Events API lists an event 30 seconds to 6 hours after it occurs, as GitHub documents. The merge-poll-1 run measured a merge event 15.6 to 32 minutes late, and no `PushEvent` of a base merge within one hour. The events read bounds no detection delay.
- Only the pull request check of the Intake Service reads the pull request again. `getChangeRequests` and the action read read once.
- The check reads again only an open, unmerged pull request whose `mergeable` is null, at most 3 reads 2 seconds apart. It stops when the remaining deadline of the call is at most the delay, and it returns the last read. A failed read again fails the check.
- A null `mergeable` in the last read folds to `none`.
- A test covers a pull request whose first read holds a null `mergeable` and whose second read holds `mergeable_state: dirty`, and it asserts the fold `conflict`.
- Every platform implementation declares its SSH host set.

### The closed pull request read

- The closed pull request read calls `GET /repos/{owner}/{repo}/pulls` with `state=closed`, `sort=updated`, `direction=desc` and `per_page=100`. It sends `If-None-Match` with the ETag that its caller supplies.
- It reads one page and follows no `next` link. The page holds the 100 most recently updated closed pull requests.
- A 200 answer answers the ETag and the items. A 304 answer answers no item. The read answers the wait of `X-Poll-Interval` and the rate limit refusals under the rules of the events read.
- A 200 answer costs one request of the primary rate limit of the credential. A 304 answer costs none. The merge-poll-1 run measured both costs.
- The merge-poll-1 run listed a merge 37 seconds after `closed_at`, at the first read after the merge.
- Each item maps to the event id `pull_request:<number>:<closed_at>` and to the metadata `{ "event": "pull_request_closed" }`. `closed_at` is the exact text of the item. A reopen and a second close give a new event id.
- An item without a positive integer `number` or a `closed_at` text fails the read with the unreadable-body result class.

### The event decoder

`decodeGitHubEvent` is the pure decoder of a GitHub inbound event. `metadata.event` selects its entry, and an unknown value decodes to no address.

| `metadata.event`      | Source                   | Address                                                                                                          |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `pull_request`        | Webhook                  | `pull_request` `{ number }`                                                                                      |
| `push`                | Webhook                  | `branch_push` `{ branch, commit }` from `ref` and `after`                                                        |
| `PullRequestEvent`    | Events read              | `pull_request` `{ number }` from `payload.number`                                                                |
| `PushEvent`           | Events read              | `branch_push` `{ branch, commit }` from `payload.ref` and `payload.head`                                         |
| `pull_request_closed` | Closed pull request read | Merged: `branch_push` `{ branch: base.ref, commit: merge_commit_sha }`. Not merged: `pull_request` `{ number }`. |

- An item of `pull_request_closed` is merged when `merged_at` is a text. A null or absent `merged_at` marks an unmerged item.
- The repository of the event must equal the resource of the inbound: `repository.full_name` of a webhook, `repo.name` of the events read and `base.repo.full_name` of the closed pull request read. Another repository decodes to no address.
- A merged item without a 40-character lower-case hexadecimal `merge_commit_sha` decodes to no address. A `merge_commit_sha` of 40 zeros decodes to no address. An item with an empty or absent `base.ref` decodes to no address.
- A merged item decodes as a push of its base branch. [Delivery admission](mission-service.impl.md#the-request-record) then checks every unresolved `pull_request` request on that base branch: the merged request folds to `expected`, and another request that cannot merge folds to `conflict`.

## Git-only platforms

A git-only platform has an SSH host set and no platform implementation.

| Platform    | SSH host set                            |
| ----------- | --------------------------------------- |
| `gitlab`    | `gitlab.com`, `altssh.gitlab.com`       |
| `bitbucket` | `bitbucket.org`, `altssh.bitbucket.org` |

- A repository binding of a git-only platform names no `credential`, because no credential platform exists for it.
- Its binding permits the action `merge_push` and no action. The action `pull_request` refuses the write with 400 `project.bindings.repository.action_unsupported`.
- A platform implementation of a git-only platform makes it a full platform. Its credential platform, its validator and its `pull_request` support arrive together.

- Pull request read calls `GET /repos/{owner}/{repo}/pulls/{pull_number}`.
- Review comment list calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments`.
- Both return the response body unchanged.
- `limit` maps to `per_page`, defaults to 100 and ranges from 1 to 100.
- `cursor` is base64url canonical JSON `{ page, per_page }`.
- A differing `limit` answers 400 `repository.platform.github.cursor_page_size_mismatch`.
- `next_cursor` is null when no `rel="next"` link exists.
- Review list calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with `per_page` 100. It follows the `next` link for at most 30 pages and answers every review in order. The pull request check calls it after the pull request read.
- Tool discovery embeds each endpoint's dereferenced response schema under `result`.
- The build extracts those schemas from `@octokit/openapi` at 23.0.2.
- A result class answers 502 `repository.platform.github.<class>` with `details: { status }` and the GitHub message. `status` holds the HTTP status of GitHub when the failure carries one, and null otherwise.
- The embedded schema is large; a harness that sends `outputSchema` to its model spends tokens on it.
- Tests assert unchanged bodies, pagination bounds, cursor page-size refusal, schema extraction and result-class details.

A platform implementation is a TypeScript module with its own method signatures and no shared interface.
The platform connector is a registry keyed by the platform value of the binding.
The registry uses static registration and loads no runtime plugin.
The GitHub implementation decodes a GitHub inbound event under [the event decoder](#the-event-decoder).
Every method returns a discriminated union: the success with the result of the operation, or the result class.
The check method folds the state of an external object into `expected`, `other`, `conflict` or `none` against the expected end state that its caller names, and it answers the landed commits of an `expected` repository result. The GitHub fold answers `other` for an open pull request with a current change request. A change request is current when it is the latest `APPROVED`, `CHANGES_REQUESTED` or `DISMISSED` review of its reviewer and names the head commit. The GitHub fold answers `conflict` for another open pull request whose `mergeable_state` is `dirty`.
The GitHub merge of a pull request reads the allowed merge methods of the repository, then calls `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` with the head guard `sha`.
The [retry rules](repository.md#result-classes) use the deadline that the caller supplies.
The platform implementation decides whether a request waits for a reply of the platform or returns after the platform accepts it.
An epic decides that form for each platform.
The read-back of the create of `github.pull_request` calls `GET /repos/{owner}/{repo}/pulls` with `state=open`, `head=<owner>:<node branch>` and `base=<base branch>`, where the node branch is `node_branch` of the claim. The read-back of its reuse fetches the node branch of the claim through the repository connector and runs `git merge-base --is-ancestor <snapshot commit> <node branch>`.
The read-back of `github.pull_request_merge` calls `GET /repos/{owner}/{repo}/pulls/{pull_number}` (`pullRequestMergedAt`). A response where `merged` is true and `head.sha` equals the tested commit is a match.
The read-back of `git.merge_push` fetches the base branch through the repository connector and runs `git merge-base --is-ancestor <snapshot commit> <base branch>`.

## Repository connector

The start requires git 2.40 or later, OpenSSH 9.0 or later and bash on the host.
It refuses a host without a required tool with `repository.connector.tool_missing`, and a tool below its version with `repository.connector.tool_version`.

- Before each network git operation, the connector runs the `ssh` validation of the `ssh_credential` of the binding. A refusal stops the operation with the code of the validation.
- `simple-git` performs every git operation of the connector by spawning the `git` binary of the host.
- The SSH host resolution is no git operation. The connector runs `ssh -G -- <host>` through `execFile` of `node:child_process`, bound by the deadline and the `Context` of the caller.
- The resolution reads the `hostname` line of the output.
- A resolution that fails, is aborted or reaches its deadline answers `repository.connector.ssh_resolve_failed`. The Project Service maps it to `project.bindings.repository.address_invalid`.
- Its timeout plugin bounds each operation by the remaining resource budget that the caller supplies.
- Its abort plugin binds to the `Context` of the caller.
- The `git` child inherits the [SSH environment](#the-ssh-environment) of the user that runs the hosting application.
- Every `git` child that the engine runs reads no global and no system git configuration of the host. The one builder `isolatedGitEnvironment` in `src/kernel/git-environment.ts` sets `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`.
- The builder sets `core.excludesFile=/dev/null` and `core.attributesFile=/dev/null` through `GIT_CONFIG_COUNT=2`. It sets `GIT_ATTR_NOSYSTEM=1`. No attributes file of the host changes a committed file.
- The builder `isolatedGitEnvironment` also removes `PAGER`, `GIT_PAGER`, `EDITOR`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_ASKPASS` and `SSH_ASKPASS`. It removes `GIT_TEMPLATE_DIR`, `GIT_EXTERNAL_DIFF` and `GIT_PROXY_COMMAND`, which the `simple-git` unsafe check rejects. It sets the commit identity `kanthord <kanthord@localhost>` for each name that the environment leaves empty.
- The builder exports the `simple-git` unsafe options `allowUnsafeConfigPaths`, `allowUnsafeConfigEnvCount` and `allowUnsafeSshCommand`. The connector and `local-git` pass them to `simple-git`.
- The connector and `local-git` of the worker unit build the environment of every `simple-git` and `git` child with this builder. A global ignore file of the host therefore never drops a file from a checkpoint.
- `simple-git` kills the `git` process and not the `ssh` child of that process.
- A git operation of the connector that fails, is aborted or reaches its deadline answers `repository.connector.git_failed`, and the message names the operation.
- `fetchAndCheckout(directory, branch, base_branch, pushed, ...)` answers `repository.node_branch.missing` when the remote node branch is missing and either `pushed` is true or the workspace held `refs/remotes/origin/<branch>` before the fetch. With no refusal and no remote node branch, it checks out `refs/heads/<branch>` without a reset when the workspace holds that branch. [worker-service.impl.md](worker-service.impl.md#workspace) names the records behind `pushed`.
- `nodeBranchOf(node_id, k)` builds the node branch name: `kanthord/<node id>` when k is 1, `kanthord/<node id>-a<k>` when k is later. It is the only builder of the name.
- `pushNodeBranch` accepts both forms. It refuses `kanthord/<node id>/a<k>`, `-a0`, `-a1` and a leading zero such as `-a01`.

## The SSH environment

- Custody supplies no secret material for git.
- The `ssh` record of the binding pins the SSH host, the resolved hostname, the port and the one identity file that git uses.
- The inherited environment includes `SSH_AUTH_SOCK`, and SSH uses the host files `~/.ssh/config` and `~/.ssh/known_hosts`.
- The SSH host resolution reads the same `~/.ssh/config`, so it resolves an alias host as the `ssh` child of git resolves it.
- The connector sets no `GIT_SSH_COMMAND` and no `GIT_SSH`. The unsafe options of the builder let a `GIT_SSH` or `GIT_SSH_COMMAND` of the host reach the connector and `local-git`.
- The connector passes no credential inside a URL and no secret on the command line of a child.
- The command line of a process is readable by every user of the host.
- A network git operation names the `ssh` record of its binding in its attribution.
