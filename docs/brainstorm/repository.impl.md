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

| Platform | Secret shape | Metadata                      | Validation                                      |
| -------- | ------------ | ----------------------------- | ----------------------------------------------- |
| `github` | `api_key`    | None                          | `GET https://api.github.com/rate_limit`         |
| `ssh`    | `ssh_key`    | `{ public_key, fingerprint }` | Local: decrypt, parse and derive the public key |

- A second shape for GitHub is another platform, for example `github-app`.
- The GitHub rate-limit probe reports `rate-limit read` and spends no rate limit.
- An `ssh` record holds the private key of one [SSH identity](repository.vocabulary.md#ssh-identity). It belongs to no git platform and names no host.
- The key type is ed25519. The server generates the key with `crypto.generateKeyPairSync("ed25519")`.
- `src/repository/ssh-key.ts` writes the private key as an unencrypted `openssh-key-v1` text from the DER export `Buffer`, and it zeroes that buffer. `ssh-add` refuses the PKCS8 PEM that Node exports.
- `private_key` of the secret is the `openssh-key-v1` text. The `ssh` validator parses it: cipher `none`, one key, type `ssh-ed25519` and equal check integers.
- `public_key` is `ssh-ed25519 <base64> kanthord-<credential name>`. `fingerprint` is `SHA256:<unpadded base64 of the SHA-256 of the key blob>`, the form of `ssh-keygen -l`. The server derives both fields.
- `login_modes` of `ssh` is `[]`.
- The private key exists in plaintext only in process memory, in the stdin pipe of `ssh-add` and inside the agent. Process memory reaches a disk only through a core dump. [Core dumps](#core-dumps) covers that path.
- The `ssh` validation is a local check. It decrypts the newest live revision, parses the key, derives the public key and compares it with the stored `public_key`. It makes no remote call.
- The record verify and the resource healthcheck of an `ssh` record run the `ssh` validation and report the capability `ssh identity`. A refusal answers `unhealthy` with `failure_reason: identity_unavailable`.
- An `ssh` record names no host, so it has no remote target. The [binding check](project-service.impl.md#the-binding-check) owns the reachability of each binding. It answers `key_refused` when the remote refuses the key.
- A generic create, rotate or metadata edit of `ssh` answers 400 `credential.entry.unsupported`. The pre-save check of `ssh` answers 400 `credential.check.unsupported`.
- Tests cover the GitHub probe, the local `ssh` validation, the refusal of a platform of another component and the `bindings` list of a get.
- The [credential healthcheck](architecture.impl.md#the-credential-healthcheck) rules apply.

### Legacy `ssh` records

- A legacy record is an `ssh` record whose newest live revision fails the `ssh_key` schema, or whose metadata fails the metadata schema of `ssh`.
- The component refuses a legacy record and drops no row.
- A release of a legacy record answers 409 `repository.credential.ssh_key_legacy` with `details: { credential }`. The message names `Rotate SSH key`.
- The verify of a legacy record answers `unhealthy` with `failure_reason: identity_unavailable`.
- `repository.credential.ssh_key_rotate` accepts a legacy record. It ignores the current metadata and inserts the next revision with a generated key. Custody drains the older revisions under its rules.

## Operations

- The component declares the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) under the prefix `repository`.
- `repository.credential.create` accepts a record of every platform of the component except `ssh`.
- An `ssh` record enters only through `repository.credential.ssh_key_create` and changes only through `repository.credential.ssh_key_rotate`.
- The engine creates an `ssh` record only on a human create. It creates none at start.
- `repository.credential.get` answers the record with `bindings`, the list of `{ project_id, project_name, binding_id, name }` of every binding revision that names the credential and that is a dependent. The Project collaboration `bindingsNaming(tx, credentialName)` answers that read.

The component declares five operations beside its credential route group. Every route uses the `human` access policy, and a mutation requires `Idempotency-Key`.

| Operation id                           | Method and path                                            | Mutation | Body                    | Answer                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `repository.credential.ssh_key_create` | `POST /api/repository/credential/ssh/key`                  | yes      | `{ name }`              | The credential answer. The revision metadata holds `public_key` and `fingerprint`.                      |
| `repository.credential.ssh_key_rotate` | `POST /api/repository/credential/:credential_name/ssh/key` | yes      | `{ expected_revision }` | The credential answer.                                                                                  |
| `repository.host_key.list`             | `GET /api/repository/host-key`                             | no       | None                    | `{ items: [{ host, public_key, fingerprint, source, created_at }], next_cursor }`, by `host` ascending. |
| `repository.host_key.scan`             | `POST /api/repository/host-key/scan`                       | no       | `{ host }`              | `{ host, public_key, fingerprint, source }`                                                             |
| `repository.host_key.pin`              | `PUT /api/repository/host-key/:host`                       | yes      | `{ fingerprint }`       | The item of the host.                                                                                   |

- The static segment `ssh` keeps the reserved name `ssh` of custody.
- `ssh_key_create` and `ssh_key_rotate` answer no private material.
- The workbench agent tool set excludes `ssh_key_create`, `ssh_key_rotate` and `repository.host_key.pin` through `SECRET_OPERATION_IDS`. Only a human confirms a host key.
- `ssh_key_rotate` inserts the next revision with a new key in one transaction. Custody drains each older live revision that no live execution pins.
- A rotation takes effect at once. Every new operation uses the new key, and an execution that pins the older revision keeps it until it ends.
- `scan` writes nothing and takes no mutation key. `scan` and the second read of `pin` each have a 10 s deadline.
- Custody logs the human identity and the row identity of a create and a rotation. The component logs the human identity, the host, the fingerprint and the source of a pin.
- The CLI commands are `repository credential ssh-key-create <name>`, `repository credential ssh-key-rotate <name> --expected-revision <n>`, `repository host-key list`, `repository host-key scan <host>` and `repository host-key pin <host> --fingerprint <SHA256:...>`.
- `ssh-key-create` and `ssh-key-rotate` print the record JSON with `public_key` and `fingerprint`.
- Each new command follows the `token_required` and `indeterminate` codes of the group.

| HTTP  | Code                                              | Condition                                                                                 | Operations                                                  |
| ----- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 400   | `credential.entry.unsupported`                    | A generic `create`, `rotate` or `update_metadata` names the platform `ssh`.               | `repository.credential.create`, `rotate`, `update_metadata` |
| 400   | `credential.check.unsupported`                    | The pre-save check names the platform `ssh`.                                              | `repository.credential.check`                               |
| 409   | `credential.name.conflict`                        | The name exists.                                                                          | `ssh_key_create`                                            |
| 409   | `credential.revision.conflict`                    | `expected_revision` is stale.                                                             | `ssh_key_rotate`                                            |
| 409   | `repository.credential.ssh_key_legacy`            | The newest live revision holds no generated key.                                          | Every release of an `ssh` record                            |
| 400   | `repository.host_key.host_unsupported`            | The host is in no SSH host set.                                                           | `scan`, `pin`                                               |
| 422   | `repository.host_key.scan_failed`                 | The GitHub meta read or `ssh-keyscan` fails or reaches its deadline. `details: { host }`. | `scan`, `pin`                                               |
| 409   | `repository.host_key.changed`                     | The second read answers another fingerprint. `details: { host, fingerprint }`.            | `pin`                                                       |
| 409   | `repository.host_key.unpinned`                    | The address host holds no pin. `details: { host }`.                                       | Binding write, setup read, every network git operation      |
| none  | `repository.connector.ssh_agent_failed`           | The agent does not start, or `ssh-add` refuses the key. A `Diagnostic` like `git_failed`. | Every network git operation                                 |
| local | `cli.repository.host_key.pin.fingerprint_invalid` | The `--fingerprint` value is not `SHA256:` and 43 base64 characters.                      | `repository host-key pin`                                   |

### The dashboard of the SSH identity

- Credentials > Repositories holds `Create SSH key`. The sheet asks for the name only.
- After the create, the sheet shows the public key with Copy, the fingerprint, and these steps: "In the repository, open Settings > Deploy keys > Add deploy key. Paste the key. Select Allow write access."
- The sheet states: "One deploy key serves one repository. Create one SSH key for each repository. An account SSH key serves every repository of the account and gives the server write access to all of them."
- The row of an `ssh` record holds Verify and `Rotate key`, and no `Edit metadata`.
- The detail of an `ssh` record shows the public key and the fingerprint of each revision, with Copy on the newest live revision. Revoke stays on the revision list.
- The rotate dialog shows the new public key and the bindings of the credential from `repository.credential.get`.
- The rotate dialog states the order: add the new deploy key, verify each binding, wait until the older revision shows `ended_at`, then delete the old deploy key at GitHub.
- The revoke confirmation of an `ssh` revision states the GitHub step: delete the deploy key of that revision.
- The generic create form keeps `ssh` out of its platform list. Its pointer names `Create SSH key`.
- The section holds a `Host keys` panel with one row for each pin: its host, fingerprint, source and `Pin again`.

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
- The connector reaches every host of an SSH host set on port 22. `altssh.bitbucket.org` stays in the set, and it answers on port 443 only.

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

The start requires git 2.40 or later, OpenSSH 9.0 or later with `ssh`, `ssh-agent` and `ssh-add`, and bash on the host.
The server also requires `ssh-keyscan`.
It refuses a host without a required tool with `repository.connector.tool_missing`, and a tool below its version with `repository.connector.tool_version`.
A spawn of `ssh-agent` or `ssh-add` that answers `ENOENT` is a missing tool. `ssh -V` keeps its version check.

- Each network git function of the connector takes `ssh: SshAccess` and runs inside one `withSshAgent` call of [the SSH identity](#the-ssh-identity).
- A network git operation whose address host holds no [pin](#host-keys) refuses with 409 `repository.host_key.unpinned` before any child process starts.
- `simple-git` performs every git operation of the connector by spawning the `git` binary of the host.
- Its timeout plugin bounds each operation by the remaining resource budget that the caller supplies.
- Its abort plugin binds to the `Context` of the caller.
- Every `git` child of a network git operation takes the environment of the agent. In `readFilesAtCommit` this covers each `git` child, because `--filter=blob:none` fetches each blob later.
- Every `git` child that the engine runs reads no global and no system git configuration of the host. The one builder `isolatedGitEnvironment` in `src/kernel/git-environment.ts` sets `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`.
- The builder sets `core.excludesFile=/dev/null` and `core.attributesFile=/dev/null` through `GIT_CONFIG_COUNT=2`. It sets `GIT_ATTR_NOSYSTEM=1`. No attributes file of the host changes a committed file.
- The builder `isolatedGitEnvironment` also removes `PAGER`, `GIT_PAGER`, `EDITOR`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_ASKPASS` and `SSH_ASKPASS`. It removes `GIT_TEMPLATE_DIR`, `GIT_EXTERNAL_DIFF` and `GIT_PROXY_COMMAND`, which the `simple-git` unsafe check rejects. It sets the commit identity `kanthord <kanthord@localhost>` for each name that the environment leaves empty.
- The builder removes `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GIT_SSH` and `GIT_SSH_COMMAND` of the host from every `git` child.
- The builder exports the `simple-git` unsafe options `allowUnsafeConfigPaths`, `allowUnsafeConfigEnvCount` and `allowUnsafeSshCommand`. The connector and `local-git` pass them to `simple-git`.
- The connector and `local-git` of the worker unit build the environment of every `simple-git` and `git` child with this builder. A global ignore file of the host therefore never drops a file from a checkpoint.
- `simple-git` kills the `git` process and not the `ssh` child of that process.
- A git operation of the connector that fails, is aborted or reaches its deadline answers `repository.connector.git_failed`, and the message names the operation. The error cause holds the operation and the git stderr, with the user information of every URL replaced by `<redacted>`. The message holds no stderr.
- `fetchAndCheckout(directory, branch, base_branch, pushed, ...)` answers `repository.node_branch.missing` when the remote node branch is missing and either `pushed` is true or the workspace held `refs/remotes/origin/<branch>` before the fetch. With no refusal and no remote node branch, it checks out `refs/heads/<branch>` without a reset when the workspace holds that branch. [worker-service.impl.md](worker-service.impl.md#workspace) names the records behind `pushed`.
- `nodeBranchOf(node_id, k)` builds the node branch name: `kanthord/<node id>` when k is 1, `kanthord/<node id>-a<k>` when k is later. It is the only builder of the name.
- `pushNodeBranch` accepts both forms. It refuses `kanthord/<node id>/a<k>`, `-a0`, `-a1` and a leading zero such as `-a01`.

## The SSH identity

KanthorD owns its SSH identities. It reads and writes no file under `~/.ssh` of the host user.

`src/repository/ssh-agent.ts` holds one function `withSshAgent(access, context, deadlineMs, work)`.
`access` is `SshAccess = { private_key, public_key, known_hosts }`, in memory only, and `known_hosts` holds complete lines.

1. Sweep the expired agent directories under [crash and abort cleanup](#crash-and-abort-cleanup).
2. Create the directory with `mkdtemp(join(tmpdir(), "kd-ssh-<deadline at, base 36>-"))`. Assert mode `0700`.
3. Refuse a socket path above 100 bytes, because `sun_path` holds 104 bytes on macOS and `ssh-agent` fails without a message on a longer path. Refuse a path that holds `'`.
4. Write `id.pub` with the public key and `known_hosts` with the lines of `access`, each with mode `0600` and flag `wx`. The directory holds no private key at any time.
5. Spawn `ssh-agent -a <dir>/a cat` in command mode with the environment `{ PATH }`. Node holds the stdin pipe of `cat`. Wait for the socket, bounded by the deadline and by 5 s.
   - `-a` is mandatory. Without `-a`, OpenSSH 10.1 and later put the socket under `$HOME/.ssh/agent/` and clean stale sockets there at start.
   - In command mode the agent checks every 10 s that `cat` lives, and it exits when `cat` ends. `cat` ends when the pipe closes.
6. Spawn `ssh-add -q -t <seconds> -` with the environment `{ PATH, SSH_AUTH_SOCK: <dir>/a }`. Write the private key to its stdin and close it. `<seconds>` is the remaining deadline rounded up, at least 1. Clear the key buffer after the write.
7. Run `work(environment)`. The environment is the output of `isolatedGitEnvironment`, plus `GIT_SSH_VARIANT=ssh` and the `GIT_SSH_COMMAND` below, with each path in single quotes.
8. In `finally`, run `ssh-add -D` on the socket, close the stdin pipe of `cat`, await the exit of `cat` and remove the directory. The agent then holds no key and exits within 10 s.

```text
ssh -F none -o IdentitiesOnly=yes -o IdentityFile=<dir>/id.pub -o IdentityAgent=<dir>/a
    -o UserKnownHostsFile=<dir>/known_hosts -o GlobalKnownHostsFile=/dev/null
    -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o BatchMode=yes
    -o ForwardAgent=no -o ControlMaster=no -o ControlPath=none
    -o PreferredAuthentications=publickey
```

- A failure of steps 2 to 6 throws the `Diagnostic` `repository.connector.ssh_agent_failed`. Its cause holds the step and the stderr of the tool, never key material.
- `-F none` stops the read of the user and the system SSH configuration files, and it stops the creation of `~/.ssh`.
- `IdentityFile=<dir>/id.pub` is required. With `IdentitiesOnly=yes` and no `IdentityFile`, ssh loads the default files `~/.ssh/id_*` and offers no agent key.
- `GlobalKnownHostsFile=/dev/null` is required, because a version that reads `none` as a relative path reads a file of the repository checkout.
- `GIT_SSH_COMMAND` overrides `core.sshCommand` of the checkout and nothing more. The [trust boundary](worker-service.impl.md#trust-boundary) covers the other paths through which a checkout runs code.
- The process arguments hold paths and options only. The key travels through stdin. The environment of a process is readable by its user only.
- The connector passes no credential inside a URL and no secret on the command line of a child.
- A network git operation names the `ssh` record of its binding in its attribution.

### Crash and abort cleanup

- A cancel of the `Context` aborts git through the abort plugin of `simple-git`. The `finally` of step 8 ends the agent.
- A crash of the process closes the stdin pipe of `cat`, so `cat` ends and the agent exits within 10 s.
- A terminated worker thread closes its child pipes, so the agent also exits within 10 s.
- The key lifetime of `ssh-add -t` removes the key from the agent at the deadline in every case.
- Each `withSshAgent` call first removes each `kd-ssh-*` directory of the same user in the system temporary directory whose deadline lies more than 60 s in the past. The sweep kills no process and reads no pid.

### Core dumps

- No code sets `RLIMIT_CORE`. A V8 heap exhaustion aborts the process, and a host core pattern then writes the heap with the key strings to disk. `ssh-agent` disables tracing and core dumps for itself.
- The container guide and `platforms/homelab/kanthord/run.sh` run the container with `--ulimit core=0`.
- A host install outside a container keeps the core-dump setting of its operator. A core dump of that host can hold an SSH private key.

### The release of a key

- Custody releases the key through the [protected facility](custody.impl.md#the-protected-facility) with the grant kind `ssh_identity`. The Project Service supplies the authorization function, because it owns the binding.
- The holder builds `SshAccess` through `RepositoryComponent.sshAccessOf(tx, material, address)`. It parses the address, reads the pin of its host, parses the key, derives the public key and calls `material.drop()` in `finally`.

## Host keys

The component pins one ed25519 [host key](repository.vocabulary.md#host-key-pin) for each SSH host.
It owns the table `repository_host_key` and its migration `repository` version 1 in `src/repository/migrations.ts`.

```sql
CREATE TABLE repository_host_key (
  id TEXT NOT NULL PRIMARY KEY,
  host TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX repository_host_key_host ON repository_host_key (host);
```

- `id` is `host_key_<ulid>`. `public_key` is `ssh-ed25519 <base64>`.
- `host` is a member of an SSH host set of [the platforms](#git-only-platforms). The component validates the host before the write.
- `source` is derived on read: `github_meta` for `github.com` and `ssh.github.com`, `keyscan` for every other host. No column stores it.
- The fingerprint is derived on read and never stored.
- One host holds one pinned key, of type ed25519. OpenSSH prefers the key type that the known-hosts file holds for the host.
- A pin replaces the row of its host: one transaction deletes the row and inserts the new one.
- No operation deletes a pin. A new pin replaces it.
- `serverMigrations` of `src/apps/server/index.ts` holds `{ service: "repository", migrations: repositoryMigrations }`.
- `github.com` and `ssh.github.com` take their key from `GET https://api.github.com/meta` over TLS with the CA set of Node. The scan takes the `ssh_keys` entry that starts with `ssh-ed25519 `.
- Every other host takes its key from `ssh-keyscan -T 5 -t ed25519 -p 22 -- <host>` through `execFile`. The parser skips the comment lines `# <host>:<port> SSH-2.0-...`. `ssh-keyscan` reads no SSH configuration file.
- A pin names the fingerprint that the human confirmed. The server reads the source again and pins only when the fingerprint is equal.
- For a GitHub host, the dashboard confirms on behalf of the human, because the TLS source is authoritative. Every other host needs the confirmation of a human.
- A pinned key that differs from the key of the host fails ssh with "REMOTE HOST IDENTIFICATION HAS CHANGED". The classifier answers `host_key_changed`.

## The failure reason of a git operation

The classifier `src/repository/git-failure.ts` reads the stderr of ssh and of the remote. It answers a value of `ResourceFailureReason` of `src/kernel/health.ts`.

| Condition                                                                                                  | Value                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| No pin for the address host (`repository.host_key.unpinned`, before git)                                   | `host_key_unknown`     |
| "REMOTE HOST IDENTIFICATION HAS CHANGED"                                                                   | `host_key_changed`     |
| "Host key verification failed" without the line above                                                      | `host_key_unknown`     |
| "Permission denied (publickey)"                                                                            | `key_refused`          |
| "Repository not found", also for a deploy key of another repository                                        | `repository_not_found` |
| "Could not resolve hostname", "Connection timed out", "Connection refused"                                 | `host_unreachable`     |
| Address host outside the SSH host set of the platform                                                      | `address_invalid`      |
| `repository.credential.ssh_key_legacy`, `repository.connector.ssh_agent_failed`, a key that does not parse | `identity_unavailable` |
| Any other text                                                                                             | `unclassified`         |

- `host_key_changed` means that the host presented a key other than the pinned key. The human compares the published fingerprint before a new pin.
- `identity_unavailable` means a local fault of the SSH identity: a legacy record, a key that does not parse, or an agent that does not start or load.
- No remote text reaches the client. The log keeps the redacted stderr.
