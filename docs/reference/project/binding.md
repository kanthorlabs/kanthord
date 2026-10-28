# Manage project bindings

[Reference index](../README.md)

## Function description

A binding connects a project to one resource under a project-local name. The binding set of a project is the complete map of its current bindings. The Project Service reads the set, replaces it as a whole, lists binding revisions and probes repository bindings.

A binding has one of three kinds. The kind and configuration give the resource identity of the binding:

| Kind         | Resource identity                            | Resource                                         |
| ------------ | -------------------------------------------- | ------------------------------------------------ |
| `repository` | `repository:<platform>:<owner>/<repository>` | A Git repository on GitHub, GitLab or Bitbucket. |
| `worker`     | `worker:kanthord:<binding-name>`             | A group of worker instances of one worker.       |
| `storage`    | `storage:s3:<endpoint-host>/<bucket>`        | An S3 bucket.                                    |

Each stored change of a binding is a revision with its own binding ID and a revision number. Revision numbers start at `1` for each resource identity in a project. A removal stores a tombstone revision: a copy of the last configuration with `removed_at` set. The binding set version of a project is `1` plus the number of stored revisions in the project. A binding name follows the project name rule: 1 to 63 characters, `^[a-z][a-z0-9-]*$`.

### project binding list

List the latest revision of each resource identity in the project, highest binding ID first. The `state` filter selects `current` (the default), `removed` or `all` bindings. A current binding has a latest revision that is not a tombstone. The `kind` filter accepts one or more kinds and keeps bindings of any given kind.

### project binding get

Read one binding revision by its binding ID. The revision can be old, current or a tombstone. It must belong to the project.

### project binding export

Read the current binding set in the input form of `project binding apply`. The output holds the current version and each current binding with its kind and configuration. Optional fields with defaults appear with their values.

### project binding apply

Replace the complete binding set of a project. The request gives the expected binding set version and every binding that the project keeps. Export the set, edit it, and apply it with the exported version.

The service compares each submitted name with the current set:

| Change      | Condition                                                        | Effect                                                                         |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `created`   | The name is new, or its resource identity changed.               | Stores revision `1` of the new resource. A replaced resource gets a tombstone. |
| `revised`   | The resource identity is the same and the configuration changed. | Stores the next revision.                                                      |
| `unchanged` | The configuration is the same.                                   | Stores nothing. The change gives the current binding ID.                       |
| `removed`   | A current binding name is absent from the submission.            | Stores a tombstone. The change gives the tombstone binding ID.                 |

An apply without changes keeps the version. Two submitted bindings must not have the same resource identity. A worker binding cannot change its `worker` value.

Before the service commits, it checks each new or changed repository binding over the network. An unchanged binding gets no check. A binding is unchanged when the current set at the submitted version holds a binding of the same name, resource identity and configuration. An unchanged binding with an unreachable address therefore does not block an apply that changes another binding. The same holds for an unchanged binding whose address host has no pin or lies outside the SSH host set. With a stale version, the service checks every submitted repository binding. A failed check refuses the apply first. Otherwise the version check refuses it with `409 project.binding_set.version_conflict`.

The action rules apply to every submitted repository binding. The network check of a new or changed binding has four steps. The first failed step refuses the apply:

1. The address host is a member of the SSH host set of the platform, for example `github.com` or `ssh.github.com` for `github`. Another host refuses with `400 project.bindings.repository.address_invalid`. No name resolution runs.
2. Custody releases the newest live revision of the `ssh_credential`.
3. The address host holds a [host key pin](../repository/host-key.md). A host with no pin refuses with `409 repository.host_key.unpinned`. Then a revision that holds no generated key refuses with `409 repository.credential.ssh_key_legacy`.
4. `git ls-remote` reads the repository through the [SSH agent of the operation](../repository/ssh-key.md#the-agent-of-one-operation), with a 30-second deadline.

A failed read refuses the apply with `422 project.bindings.repository.ssh_unreachable`. Its `details.failure_reason` names the cause with a value of the [failure reason list](#failure-reasons-of-the-address-entry), other than `address_invalid`. The route timeout is also 30 seconds. A read that reaches its deadline therefore gives `504 gateway.invocation.timeout`, and the apply commits nothing.

These checks run before the version check. Inside the commit transaction, the service validates each binding, checks the version, and stores the revisions. A worker binding that the apply removes, or sets to an instance count of `0`, ends the live worker registrations of its group. The instance count of a native worker binding is the length of `worker_instances`. After the commit, the service wakes the scheduler for the project.

### project binding revision list

List every retained revision of the resource identity of one binding revision, highest revision first. Tombstones appear in the list. Any binding ID of the resource selects the same list.

### project binding verify

Probe a stored repository binding revision without a write. The revision must be a repository binding of the project that no later tombstone follows. The service probes three resources:

- `address`: the service checks the address host and its pin, releases the SSH key, and runs `git ls-remote`, with a 10-second deadline.
- `ssh_credential`: the Repository component verifies the `ssh` credential with its local key check, with a 10-second deadline.
- `credential`: the Credential Service checks the optional platform credential. The entry is `null` when the binding has no `credential`.

A failed probe reports `unhealthy` and is not an error. A probe that exceeds its deadline reports `unknown`. Each entry carries a `failure_reason`: `null` for a `healthy` entry only, and a value for every other entry. Every entry carries `deadline_exceeded` when its probe exceeds its deadline.

### project binding check

Probe an unsaved repository configuration with the same three probes as `verify`. The service writes nothing. Before the probes, the service applies the action rules, checks the address form, and checks the credential platforms. A host outside the SSH host set, a host with no pin, or a legacy `ssh` credential does not refuse `check`. The `address` entry reports it with a `failure_reason`. Use `check` to test a repository binding before an apply.

### Binding configuration

The `config` object of each kind accepts only the fields below.

**Repository**

| Field                  | Type                            | Rule                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `available`            | boolean                         | Required.                                                                                                                                                                                                             |
| `platform`             | `github`, `gitlab`, `bitbucket` | Required.                                                                                                                                                                                                             |
| `address`              | string                          | Required. Form `git@<host>:<owner>/<repository>.git` with no port; `<host>` is a member of the [SSH host set](../repository/host-key.md#function-description) of `platform`.                                          |
| `strategy.base_branch` | string                          | Required, nonblank.                                                                                                                                                                                                   |
| `strategy.action`      | object                          | Optional. `name` is `pull_request` or `merge_push`; `follows` is `{ "type": "assessment_passed" }`; `landing` is optional. See [Repository actions](#repository-actions).                                             |
| `ssh_credential`       | string                          | Required. Name of a live `ssh` credential; see [SSH keys](../repository/ssh-key.md).                                                                                                                                  |
| `credential`           | string                          | Optional. Name of a live credential of platform `github`. Required for `pull_request`; refused on `gitlab` and `bitbucket`.                                                                                           |
| `prompts`              | object                          | Optional. One optional text for each agent name `swe@1`, `re@1` and `env@1`. A text holds at most 32768 UTF-8 bytes and no control character other than a tab and a newline. See [Binding prompts](#binding-prompts). |

### Binding prompts

The field `prompts` of a repository binding holds the Binding prompt. The key is the name of an agent of the catalog. A key outside `swe@1`, `re@1` and `env@1` fails with `400 gateway.request.validation_failed`. A text that exceeds 32768 UTF-8 bytes or holds a control character fails with `400 project.bindings.repository.prompt_invalid` and `details.agent_name` and `details.reason`. `reason` is `too_large` or `control_character`.

The server joins the text of `prompts[<agent>]` into the system prompt of that agent as `Instructions of repository <name>:` and the text. A missing key, an empty text and a blank text add nothing. `swe@1` and `re@1` read the prompts of every repository binding of the node at its pinned revision. `env@1` reads the prompt of the binding of its environment run. The text ranks above the Agent prompt and below the framing. See [how the native agent reads its prompt](../../explanation/native-agent.md#the-prompt).

- A change of `prompts` stores the next binding revision. A node keeps the text of the revision that it pins until `mission node rebind` moves the node to the current revision.
- Environment onboarding treats the new binding ID as a changed binding and clears `environment_from_agent`, the mark that a stored environment came from a session of `env@1`.
- The prompts of the agents are separate texts. `re@1` does not read the prompt of `swe@1`. Write a rule that relaxes the default standard into the prompts of both `swe@1` and `re@1`.
- The server and every worker host run the same execution setup contract, so a deploy upgrades them together.

**Worker**

| Field              | Type    | Rule                                                                                                                                                                                                                    |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker`           | string  | Required. Name of a declared worker.                                                                                                                                                                                    |
| `instance_count`   | integer | Required for a worker that declares no agent, an external harness. From `0` to `64`. The value `0` disables the group. Refused for a worker that declares an agent.                                                     |
| `worker_instances` | array   | Required for a worker that declares an agent. Refused for a worker that declares no agent. See [Worker instances of a binding](#worker-instances-of-a-binding).                                                         |
| `environment`      | string  | Optional. The name of one repository binding of the project. Required when the binding lists a `container` instance and the project holds two repository bindings or more.                                              |
| `resource_budget`  | object  | Optional. Positive integers `turns` and `wall_time_ms`. Refused for a worker that declares no agent.                                                                                                                    |
| `tags`             | array   | Optional. A list of unique tags. Each tag matches `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` and holds at most 64 bytes. An absent field reads as `[]`. A change of `tags` stores the next revision.                       |
| `entries`          | array   | Optional. Items `{ "agent", "agent_provider"?, "model_identifier"?, "reasoning_effort"?, "fallback_configurations"? }`. Each `agent` is unique and declared by the worker. Refused for a worker that declares no agent. |

The Agent Service validates the effective configuration of each agent of the worker.

#### Placement

A binding holds no placement. Each [worker instance](../worker/instance.md) holds its own placement, set at its create. One binding can list instances of different placements. [Worker placements](../worker/placement.md) lists the availability of each value.

| Value       | Where the instance runs                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`    | The server runs the instance as one thread.                                                                                                                                                                    |
| `container` | The server runs the instance in one container on its own host, with Podman or Docker. [Isolate worker instances in containers](../../how-to-guides/isolate-worker-instances-in-containers.md) shows the steps. |
| `worker`    | The instance runs as one `kanthord serve worker` process on its own host.                                                                                                                                      |

The server runs each `server` and `container` instance until its archive, also while no binding lists it. A binding with `placement` fails with `project.bindings.worker.field_forbidden` and `details.field` `placement`.

#### Worker instances of a binding

A binding of a worker that declares an agent lists its [worker instances](../worker/instance.md) by name in `worker_instances`, at every placement. The length of the list is the instance count of the binding. To add capacity, add an instance and list it. The service checks the list in this order:

1. `instance_count` and `placement` are absent. A binding with one of them fails with `project.bindings.worker.field_forbidden`, and `details.field` names the field.
2. `worker_instances` is present. A binding without it fails with `project.bindings.worker.instances_required`.
3. The value is a list of at most 64 unique strings. Another value fails with `project.bindings.worker.instances_invalid`.
4. For each name in list order, the name is a live instance of the `worker` of the binding. An unknown or archived name fails with `project.bindings.worker.instance_unknown`. An instance of another worker fails with `project.bindings.worker.instance_worker_mismatch`. The first name that fails stops the check.
5. A `container` instance is listed by no other live worker binding. A second listing fails with `project.bindings.worker.instance_shared`. One container runs one image, and the image belongs to the environment of one binding.

An empty list is valid and disables the group, as `instance_count` `0` of an external harness does. A `server` or a `worker` instance can serve bindings of several projects. Each binding-set write changes the bindings of each listed instance. An instance that leaves the list keeps the binding as `draining` while it holds a live registration in it: its live execution finishes, and the binding gets no new claim from that instance. A `server` or `container` instance keeps running with no binding.

```json
{
  "kind": "worker",
  "config": {
    "worker": "coder@1",
    "worker_instances": ["builder-1", "builder-2"]
  }
}
```

Each listed instance at the `worker` placement needs a live copy of each chain credential, sealed to its current key. A `server` or `container` instance uses the `server` copy. Otherwise the apply fails with `agent.configuration.credential_holder_mismatch`. The [instance list](../worker/instance.md#worker-instance-list) shows the same condition as `holder_mismatch`.

A tag states a fact of the host of the instances, for example `platform.macos`. The Scheduler match admits a node for a worker binding only when the tags of the binding include every tag of the node. The match compares exact strings and reads no version, no range and no operator. Before and after its change, the apply reads the pairs of a node and a claimable state that no current worker binding covers. An apply that adds such a pair fails with `project.bindings.worker.node_unmatched`. A pair that exists before the apply refuses no apply. Configure the worker bindings of a project before the first import.

An entry can name `fallback_configurations`: an array of at most 7 complete `{ agent_provider, model_identifier, reasoning_effort }` items. An entry can hold only this field; the default configuration is then the head of the chain. A named field, also `[]`, replaces the `fallback_configurations` of the enablement whole. An omitted field inherits them. `[]` means no fallback. Each item passes the validation of the default configuration. A repeated `agent_provider` and `model_identifier`, or an item with the `agent_provider` and `model_identifier` of the head of the entry, fails with `agent.configuration.fallback_duplicate`.

**Storage**

| Field        | Type    | Rule                                                  |
| ------------ | ------- | ----------------------------------------------------- |
| `available`  | boolean | Required.                                             |
| `endpoint`   | string  | Required URL.                                         |
| `bucket`     | string  | Required, nonblank.                                   |
| `region`     | string  | Required, nonblank.                                   |
| `prefix`     | string  | Required. Can be empty.                               |
| `credential` | string  | Required. Name of a live credential of platform `s3`. |

A node names zero or more storage bindings as an ordered list. Its uploads use the first binding of that list that accepts the grant. A node names every binding that it uses and takes no binding from the project. A node with no storage binding accepts only inline evidence content.

### Repository actions

`strategy.action` of a repository binding names the external action that a passing node requires.

The schema accepts `follows` type `action_end_state` with a `binding` name, but a refinement refuses it.

`strategy.action.landing` chooses who merges the pull request of a `pull_request` action. The value is `human` or `kanthord`, with the default `human`.

- `human`: a human merges the pull request.
- `kanthord`: after the pull request is recorded, the action performer of the Worker Service reads the required checks of the pull request. It requests the merge as a separate write only when the head commit is the tested commit and no required check is pending or failed. When the read of the required checks fails or answers an unexpected body, the action performer requests no merge. The [deferred check](#the-deferred-check) can then request the merge. The Intake Service merges the pull request with the tested commit as the head guard. A refused merge leaves the pull request open for a human.

Only a `pull_request` action holds `landing`. A `merge_push` action with `landing` fails with `400 gateway.request.validation_failed` at the `landing` path.

#### Required checks

A required check is a status check that a ruleset of the base branch requires. KanthorD reads the rules of the base branch from the GitHub rulesets endpoint only. KanthorD does not read a required check of a classic branch protection rule. KanthorD then reads the check runs and the commit statuses of the head commit of the pull request.

| Result on the head commit                                                                | Outcome |
| ---------------------------------------------------------------------------------------- | ------- |
| The newest check run of the name completed with `success`, `neutral` or `skipped`        | Passed  |
| The newest check run of the name completed with another conclusion                       | Failed  |
| The newest check run of the name did not complete                                        | Pending |
| No check run of the name exists, and the newest commit status is `success`               | Passed  |
| No check run of the name exists, and the newest commit status is `failure` or `error`    | Failed  |
| No check run of the name exists, and the newest commit status is `pending`, or no status | Pending |

The check of an open pull request applies the required checks to the request, for both landings:

- A failed required check returns the node from `External.Requested` to `Available` in the same attempt. The request stays unresolved. The next `coder@1` execution reads the names of the failed checks as its verdict; see [the verdict](../../explanation/coder-worker.md#prepare-steps-1-to-4).
- A pending required check leaves the request unresolved and the node in `External.Requested`.
- When the head commit of the pull request changes between the reads of the check, the required checks count as pending.

The `github` credential of the binding needs read access to the checks and the commit statuses; see [GitHub token permissions](../repository/credential.md#github-token-permissions).

#### The deferred check

After a reviewer release to `External.Requested`, the Mission Service checks the unresolved requests of the node again in the background. It runs at most 60 rounds:

- When a request answers `checks_pending`, or a check call of the round fails, the next round runs after 60 seconds.
- When the request of a `pull_request` action with the landing `kanthord` answers `none`, the Mission Service requests a **service merge**. The request needs no execution claim. The Mission Service requests a service merge only when no live claim holds the node. When the Intake Service accepts the service merge, the next round runs at once and folds the merge.
- A service merge that answers `confirmed_failure`, `retryable_refusal` or `unknown_outcome` counts as a failed call. The next round then runs after 60 seconds. A `final_refusal` answer or a merge call that throws counts as no failed call and no merge.
- The loop stops after a round with no `checks_pending` answer, no failed call and no merge. It also stops after round 60, and when the node leaves `External.Requested`.
- After the loop stops, a human merges the pull request. Then run [`mission node check`](../mission/node-control.md#check), or rely on an Intake inbound of the repository.

The Mission Service authorizes a service merge only in these conditions:

- The node is `External.Requested`, and the request belongs to its open attempt.
- The action is a `pull_request` with the landing `kanthord`.
- The current assessment of the attempt is a `success` with no changed gate file.
- The commit is the tested commit of the binding.
- The binding is not removed and not disabled, and the project is not paused.

The Intake Service stores the service merge under the request key `service_merge/<request key>`. KanthorD reserves the prefix `service_merge/`. An `intake.action.perform` request with a key that starts with `service_merge/` fails with `400 gateway.request.validation_failed`. Each round sends a new request key. A failed service merge logs the warning `Deferred merge failed.`.

At each server start, the Mission Service starts the deferred check again for each `External.Requested` node whose open attempt holds an unresolved request. It starts at most 50 nodes, the newest attempts first. Past that limit, the server logs the warning `Deferred check start limit reached.`. A human checks each other node with `mission node check`.

#### Gate files

A node whose change set changes a gate file lands with `human` for that attempt, whatever value `landing` holds. A gate file is a path of `gate_files` in the [affected test declaration](../../how-to-guides/declare-affected-tests.md#2-write-the-declaration) of the base branch. The pull request body names each changed gate file.

A `merge_push` action of that attempt pushes nothing. The action performer records a `branch_push` request on the base branch with the tested commit, and the node waits in `External.Requested` for a human landing:

1. A human merges the node branch into the base branch and pushes. A merge commit and a fast-forward both keep the tested commit.
2. The check of the request answers `expected` when the tested commit is an ancestor of the base branch head. It answers `none` before that.
3. The deferred check stops at the first `none`. Without a poll or webhook inbound of the repository, no process checks the request again. After the landing, run [`mission node check`](../mission/node-control.md#check).

A squash or a rebase of the node branch does not put the tested commit on the base branch. The request then never resolves, and the node stays `External.Requested`. Land the node branch with a merge commit or a fast-forward. After a squash or a rebase, discard the node: the discard sets the end state `other` on its `branch_push` requests. See [block, discard and override](../mission/node-control.md#block-discard-and-override).

## Expected response

Every operation returns HTTP `200`. The CLI writes one JSON line to stdout and exits `0` (shown formatted here). The CLI adds `idempotency_key` to the output of `apply` only.

### project binding list

```json
{
  "items": [
    {
      "id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D3",
      "project_id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
      "name": "builder",
      "kind": "worker",
      "resource_identity": "worker:kanthord:builder",
      "revision": 2,
      "config": {
        "worker": "<worker-name>",
        "worker_instances": ["builder-1", "builder-2"]
      },
      "created_at": 1759900000000,
      "removed_at": null
    }
  ],
  "next_cursor": null
}
```

| Property            | Type             | Purpose                                                   |
| ------------------- | ---------------- | --------------------------------------------------------- |
| `id`                | string           | Binding ID of this revision, with the `binding` prefix.   |
| `project_id`        | string           | Project ID.                                               |
| `name`              | string           | Binding name.                                             |
| `kind`              | string           | `repository`, `worker` or `storage`.                      |
| `resource_identity` | string           | Resource identity of the binding.                         |
| `revision`          | positive integer | Revision number for the resource identity.                |
| `config`            | object           | Stored configuration of the revision.                     |
| `created_at`        | integer          | Revision time in Unix milliseconds.                       |
| `removed_at`        | integer or null  | Removal time for a tombstone; `null` otherwise.           |
| `next_cursor`       | string or null   | Opaque cursor for the next page; `null` on the last page. |

### project binding get

The response is one binding record with the fields of the list items.

### project binding export

```json
{
  "version": 4,
  "bindings": {
    "builder": {
      "kind": "worker",
      "config": {
        "worker": "<worker-name>",
        "worker_instances": ["builder-1", "builder-2"]
      }
    }
  }
}
```

| Property   | Type             | Purpose                                                     |
| ---------- | ---------------- | ----------------------------------------------------------- |
| `version`  | positive integer | Current binding set version. Submit it with the next apply. |
| `bindings` | object           | Map from binding name to `{ "kind", "config" }`.            |

### project binding apply

```json
{
  "project_id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
  "binding_set_version": 5,
  "bindings": {
    "builder": {
      "id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4",
      "project_id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
      "name": "builder",
      "kind": "worker",
      "resource_identity": "worker:kanthord:builder",
      "revision": 3,
      "config": {
        "worker": "<worker-name>",
        "worker_instances": ["builder-1", "builder-2", "builder-3"]
      },
      "created_at": 1759900100000,
      "removed_at": null
    }
  },
  "changes": [
    { "kind": "revised", "binding_id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4" }
  ],
  "stale_pins": [
    {
      "node_id": "node_01JD3WB7M2N3P4Q5R6S7T8V9W0",
      "binding_name": "builder",
      "pinned_revision": 2,
      "current_revision": 3
    }
  ],
  "idempotency_key": "idempotency_key_01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property              | Type                            | Surface     | Purpose                                                                  |
| --------------------- | ------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `project_id`          | string                          | API and CLI | Project ID.                                                              |
| `binding_set_version` | positive integer                | API and CLI | Binding set version after the apply.                                     |
| `bindings`            | object                          | API and CLI | Map from name to the binding record of each current binding.             |
| `changes`             | array                           | API and CLI | One `{ "kind", "binding_id" }` item for each submitted or removed name.  |
| `stale_pins`          | array                           | API and CLI | One item for each node that pins an older revision of a revised binding. |
| `idempotency_key`     | `idempotency_key_<ulid>` string | CLI only    | Key of this request. Supply it again to retry the same request.          |

`stale_pins` lists each node that is not terminal and not retired. Its current node revision pins an older revision of a binding that the apply revised. A revised binding keeps its name and its resource identity. Each item holds `node_id`, `binding_name`, `pinned_revision` and `current_revision`. The list is in the order of `node_id`, then `binding_name`. A removed binding adds no item. The apply moves no pin. Run [`mission node rebind`](../mission/node.md#node-rebind) to move a node to the current revision. A retry with the same idempotency key answers the list of the first apply until a restart of the daemon.

### project binding revision list

The response has the page form of `project binding list`. Each item is one revision of the same resource identity.

### project binding verify and project binding check

```json
{
  "address": {
    "status": "unhealthy",
    "capability": "network git read",
    "failure_reason": "key_refused"
  },
  "ssh_credential": {
    "status": "healthy",
    "capability": "ssh identity",
    "failure_reason": null
  },
  "credential": null
}
```

| Property           | Type           | Purpose                                                                                                                              |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `address`          | object         | Address probe. `capability` is `network git read`.                                                                                   |
| `ssh_credential`   | object         | `ssh` credential probe. The Credential Service gives `capability`.                                                                   |
| `credential`       | object or null | Platform credential probe; `null` when the configuration has no `credential`.                                                        |
| `*.status`         | string         | `healthy`, `unhealthy` or `unknown`.                                                                                                 |
| `*.failure_reason` | string or null | `null` for a `healthy` entry only. Every other entry carries a value. A probe that exceeds its deadline carries `deadline_exceeded`. |

The `ssh_credential` and `credential` entries are the answers of the credential verify. Their values are in the [repository credential check](../repository/credential.md#verify-and-check).

#### Failure reasons of the address entry

The `address` entry reports a refusal before the read or a failed read as `unhealthy`, and a probe that exceeds its deadline as `unknown`. The server reads only the lines of ssh and of the remote, because git translates its own lines. No remote text reaches the client. The first row that matches decides.

| `failure_reason`       | Cause                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `address_invalid`      | The address host is outside the SSH host set of the platform. No read runs.                                                                                                                                                                                                                                                                                                                                              |
| `host_key_unknown`     | The address host holds no pin, so no read runs. Pin the [host key](../repository/host-key.md).                                                                                                                                                                                                                                                                                                                           |
| `identity_unavailable` | The SSH key does not load: a legacy `ssh` credential, or `repository.connector.ssh_agent_failed`, for example a [temporary directory path above 75 bytes](../repository/ssh-key.md#the-temporary-directory-limit). Verify the `ssh` credential: `unhealthy` means a legacy key, so rotate it. `healthy` means that the SSH agent of the server failed. Today the server log names no agent step for a binding operation. |
| `host_key_changed`     | ssh writes "REMOTE HOST IDENTIFICATION HAS CHANGED": the host presented a key other than its pin. Compare the published fingerprint, then pin again.                                                                                                                                                                                                                                                                     |
| `host_key_unknown`     | ssh writes "Host key verification failed" without the line above.                                                                                                                                                                                                                                                                                                                                                        |
| `key_refused`          | ssh writes "Permission denied (publickey)".                                                                                                                                                                                                                                                                                                                                                                              |
| `repository_not_found` | The remote writes "Repository not found", or GitLab writes "The project you were looking for could not be found". A deploy key of another repository also gives this value.                                                                                                                                                                                                                                              |
| `host_unreachable`     | ssh writes "Could not resolve hostname", "Connection timed out", "Connection refused", "Operation timed out", "No route to host" or "Network is unreachable".                                                                                                                                                                                                                                                            |
| `deadline_exceeded`    | The git read exceeds its deadline. The host answers too slowly or not at all. Verify again.                                                                                                                                                                                                                                                                                                                              |
| `unclassified`         | Any other failure.                                                                                                                                                                                                                                                                                                                                                                                                       |

The same values appear in `details.failure_reason` of `project.bindings.repository.ssh_unreachable`, and in the [resource healthcheck](../gateway/healthcheck.md) entry of the binding.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                                     | Commands                                           | Meaning                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`              | All                                                | Absent, invalid, expired or banned token, or a machine token.                                                                                                                                                                                                                                                                                                           |
| `400 gateway.request.validation_failed`                | All                                                | A parameter, query value or body field fails the schema or a schema refinement.                                                                                                                                                                                                                                                                                         |
| `400 system.pagination.cursor_invalid`                 | `list`, `revision list`                            | The cursor does not decode to a valid position.                                                                                                                                                                                                                                                                                                                         |
| `404 project.project.not_found`                        | `list`, `export`, `apply`, `verify`, `check`       | No project has this ID.                                                                                                                                                                                                                                                                                                                                                 |
| `404 project.binding.not_found`                        | `get`, `revision list`, `verify`                   | No revision with this ID belongs to the project. For `get` and `revision list`, also an unknown project. For `verify`, also a removed or non-repository binding.                                                                                                                                                                                                        |
| `409 project.binding_set.version_conflict`             | `apply`                                            | The submitted version is not current. `details.binding_set_version` holds the current version.                                                                                                                                                                                                                                                                          |
| `400 project.bindings.duplicate_resource`              | `apply`                                            | Two submitted bindings have the same resource identity.                                                                                                                                                                                                                                                                                                                 |
| `409 project.bindings.worker.resource_changed`         | `apply`                                            | A submitted worker binding changes its `worker` value.                                                                                                                                                                                                                                                                                                                  |
| `400 project.bindings.worker.instance_count_range`     | `apply`                                            | A binding of a worker that declares no agent has no `instance_count`, or a value outside `0` to `64`.                                                                                                                                                                                                                                                                   |
| `400 project.bindings.worker.field_forbidden`          | `apply`                                            | A worker binding holds `placement`. A binding of a worker that declares an agent holds `instance_count`. A binding of a worker that declares no agent holds `entries`, `resource_budget`, `environment` or `worker_instances`. `details` holds `binding` and `field`.                                                                                                   |
| `400 project.bindings.worker.instances_required`       | `apply`                                            | A binding of a worker that declares an agent has no `worker_instances`. `details` holds `binding`.                                                                                                                                                                                                                                                                      |
| `400 project.bindings.worker.instances_invalid`        | `apply`                                            | `worker_instances` is no list, holds more than 64 items, repeats a name or holds a nontext item. `details` holds `binding` and `instance`; `instance` is `null` for a nonlist value, a list above 64 items or a nontext item.                                                                                                                                           |
| `400 project.bindings.worker.instance_unknown`         | `apply`                                            | `worker_instances` names no live worker instance. `details` holds `binding` and `instance`.                                                                                                                                                                                                                                                                             |
| `400 project.bindings.worker.instance_worker_mismatch` | `apply`                                            | `worker_instances` names an instance of another worker. `details` holds `binding`, `instance` and `worker`, the worker of the instance.                                                                                                                                                                                                                                 |
| `409 project.bindings.worker.instance_shared`          | `apply`                                            | `worker_instances` names a `container` instance that another live worker binding lists. `details` holds `binding`, `instance` and `listed_by`.                                                                                                                                                                                                                          |
| `400 project.bindings.worker.agent_unknown`            | `apply`                                            | An entry names an agent that the worker does not declare.                                                                                                                                                                                                                                                                                                               |
| `400 project.bindings.worker.tags_invalid`             | `apply`                                            | A worker `tags` value is no list, repeats a tag or holds a malformed tag. `details` holds `binding` and `tag`; `tag` is `null` for a nonlist value or a nontext item.                                                                                                                                                                                                   |
| `409 project.bindings.worker.node_unmatched`           | `apply`                                            | The apply adds a pair of a node and a claimable state that no current worker binding covers. `details.node_ids` names the nodes.                                                                                                                                                                                                                                        |
| `400 agent.configuration.invalid`                      | `apply`                                            | The `worker` value names no declared worker.                                                                                                                                                                                                                                                                                                                            |
| `400 agent.configuration.credential_holder_mismatch`   | `apply`                                            | A holder of the worker binding holds no live copy of a chain credential sealed to its current key. The holders are `server` for each listed `server` or `container` instance, and each listed instance at the `worker` placement. `details` holds `{ agent, agent_provider, credential, holder }`. See [`holder_mismatch`](../worker/instance.md#worker-instance-list). |
| `400 agent.configuration.fallback_duplicate`           | `apply`                                            | A `fallback_configurations` list of an entry repeats an agent provider and model, or repeats those of the head of the entry.                                                                                                                                                                                                                                            |
| `agent.configuration.*`, `agent.enablement.*`          | `apply`                                            | The Agent Service refuses the effective configuration of an agent, for example a disabled agent.                                                                                                                                                                                                                                                                        |
| `400 project.bindings.repository.address_invalid`      | `apply`, `check`                                   | The address does not match the form. For `apply`, also an address host outside the SSH host set of the platform; `check` reports that case as `failure_reason` `address_invalid`.                                                                                                                                                                                       |
| `409 repository.host_key.unpinned`                     | `apply`                                            | The address host of a new or changed binding holds no pin. `details.host` holds the host. No git process starts.                                                                                                                                                                                                                                                        |
| `409 repository.credential.ssh_key_legacy`             | `apply`                                            | The newest live revision of the `ssh_credential` holds no generated key. `details.credential` holds the name. Rotate the key with [`ssh-key-rotate`](../repository/ssh-key.md#ssh-key-rotate).                                                                                                                                                                          |
| `400 project.bindings.repository.action_unsupported`   | `apply`, `check`                                   | A `gitlab` or `bitbucket` binding sets `credential` or the `pull_request` action.                                                                                                                                                                                                                                                                                       |
| `400 project.bindings.repository.credential_required`  | `apply`, `check`                                   | The `pull_request` action has no `credential`.                                                                                                                                                                                                                                                                                                                          |
| `400 project.bindings.repository.prompt_invalid`       | `apply`                                            | A text of `prompts` exceeds 32768 UTF-8 bytes or holds a control character. `details` holds `agent_name` and `reason`.                                                                                                                                                                                                                                                  |
| `422 project.bindings.repository.ssh_unreachable`      | `apply`                                            | `git ls-remote` of a new or changed binding fails. `details.failure_reason` names the cause, for example `key_refused` or `identity_unavailable`.                                                                                                                                                                                                                       |
| `404 credential.credential.not_found`                  | `apply`, `verify`, `check`                         | A named credential has no live revision, or the probe cannot use it.                                                                                                                                                                                                                                                                                                    |
| `400 credential.platform.mismatch`                     | `apply`, `check`                                   | A named credential has a different platform.                                                                                                                                                                                                                                                                                                                            |
| `409 credential.credential.archived`                   | `verify`, `check`                                  | A named credential is archived.                                                                                                                                                                                                                                                                                                                                         |
| `400 credential.check.unsupported`                     | `verify`, `check`                                  | The credential platform has no check.                                                                                                                                                                                                                                                                                                                                   |
| `400 gateway.idempotency.invalid_key`                  | `apply`                                            | Absent or malformed `Idempotency-Key`.                                                                                                                                                                                                                                                                                                                                  |
| `409 gateway.idempotency.conflict`                     | `apply`                                            | The key is in use for a different request, or the first request with the key is in progress.                                                                                                                                                                                                                                                                            |
| `413 gateway.request.body_too_large`                   | `apply`, `check`                                   | The body exceeds 10 MiB.                                                                                                                                                                                                                                                                                                                                                |
| `415 gateway.request.unsupported_media_type`           | `apply`, `check`                                   | The request body is not `application/json`.                                                                                                                                                                                                                                                                                                                             |
| `400 gateway.request.unexpected_body`                  | `list`, `get`, `export`, `revision list`, `verify` | The request has a body.                                                                                                                                                                                                                                                                                                                                                 |
| `504 gateway.invocation.timeout`                       | All                                                | The operation exceeded 30 seconds. An apply can still complete.                                                                                                                                                                                                                                                                                                         |

Within the replay TTL, a repeated apply key with the same request and caller returns the recorded response, success or failure.

The CLI checks its input before it sends a request. Each local failure exits `1` and writes `<code>: <message>` to stderr.

| Code                                               | Commands                         | Meaning                                                                                |
| -------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `cli.project.binding.<command>.invalid_project_id` | All                              | The project argument is not a valid project ID.                                        |
| `cli.project.binding.<command>.invalid_binding_id` | `get`, `verify`, `revision list` | The binding argument is not a valid binding ID.                                        |
| `cli.project.binding.list.invalid_kind`            | `list`                           | A `--kind` value is not a binding kind.                                                |
| `cli.project.binding.list.invalid_state`           | `list`                           | `--state` is not `current`, `removed` or `all`.                                        |
| `cli.pagination.limit_invalid`                     | `list`, `revision list`          | `--limit` is not a positive decimal integer.                                           |
| `cli.pagination.limit_out_of_range`                | `list`, `revision list`          | `--limit` is more than `1000`.                                                         |
| `cli.idempotency_key.invalid`                      | `apply`                          | `--idempotency-key` is not an `idempotency_key_<ulid>` value.                          |
| `cli.file.invalid_path`                            | `apply`, `check`                 | `--file` is `-`. The CLI does not read stdin.                                          |
| `cli.file.not_found`                               | `apply`, `check`                 | The file does not exist.                                                               |
| `cli.file.not_regular`                             | `apply`, `check`                 | The path is not a regular file.                                                        |
| `cli.file.encoding_invalid`                        | `apply`, `check`                 | The file is not valid UTF-8.                                                           |
| `cli.file.not_json`                                | `apply`, `check`                 | The file is not a JSON document.                                                       |
| `cli.file.duplicate_key`                           | `apply`, `check`                 | A JSON object in the file repeats a key.                                               |
| `cli.file.not_object`                              | `apply`, `check`                 | The JSON document is not an object.                                                    |
| `cli.file.schema_invalid`                          | `apply`, `check`                 | The object fails the request schema. The `details` row lists each issue path and code. |
| `cli.option.duplicate`                             | All                              | A single-value option occurs more than once.                                           |
| `cli.project.binding.<command>.token_required`     | All                              | No nonblank token resolves.                                                            |

For `revision list`, `<command>` is `revision.list`, for example `cli.project.binding.revision.list.token_required`.

A declared server failure exits `1`. The CLI writes `<code>: request failed` and the row `status`. For `apply`, it also writes the row `idempotency_key`. A transport failure, a timeout or a malformed response exits `1` with `cli.project.binding.<command>.indeterminate`. For `apply`, the message is `the result is unknown; retry with the same idempotency key`, and the row `idempotency_key` holds the key. For a read, the message is `the result is unknown; retry the command`. There is no automatic retry.

## API shape

| Command         | Method and path                                             | Operation ID                   | Mutation | Timeout    |
| --------------- | ----------------------------------------------------------- | ------------------------------ | -------- | ---------- |
| `list`          | `GET /api/project/:project_id/binding`                      | `project.binding.list`         | No       | 30 seconds |
| `get`           | `GET /api/project/:project_id/binding/:binding_id`          | `project.binding.get`          | No       | 30 seconds |
| `export`        | `GET /api/project/:project_id/binding-set`                  | `project.bindingSet.get`       | No       | 30 seconds |
| `apply`         | `PUT /api/project/:project_id/binding-set`                  | `project.bindingSet.write`     | Yes      | 30 seconds |
| `revision list` | `GET /api/project/:project_id/binding/:binding_id/revision` | `project.bindingRevision.list` | No       | 30 seconds |
| `verify`        | `POST /api/project/:project_id/binding/:binding_id/verify`  | `project.binding.verify`       | No       | 30 seconds |
| `check`         | `POST /api/project/:project_id/binding/check`               | `project.binding.check`        | No       | 30 seconds |

Every operation has `human` access: it requires a human bearer JWT.

| Parameter    | In    | Operations                       | Default   | Rule                                                           |
| ------------ | ----- | -------------------------------- | --------- | -------------------------------------------------------------- |
| `project_id` | path  | All                              | None      | Project ID.                                                    |
| `binding_id` | path  | `get`, `revision list`, `verify` | None      | Binding ID of any revision of the project.                     |
| `kind`       | query | `list`                           | All kinds | `repository`, `worker` or `storage`. Repeat it for more kinds. |
| `state`      | query | `list`                           | `current` | `current`, `removed` or `all`.                                 |
| `limit`      | query | `list`, `revision list`          | `100`     | Integer from `1` to `1000`.                                    |
| `cursor`     | query | `list`, `revision list`          | None      | Nonempty `next_cursor` value.                                  |

| Operation | Request body                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `apply`   | `{ "version": <positive integer>, "bindings": { "<name>": { "kind": "<kind>", "config": { ... } } } }` |
| `check`   | `{ "kind": "repository", "config": { ... } }` with a repository configuration.                         |
| Others    | None. `verify` is a `POST` without a body.                                                             |

The body limit is 10 MiB.

| Header            | Required         | Purpose                                                                          |
| ----------------- | ---------------- | -------------------------------------------------------------------------------- |
| `Authorization`   | Yes              | `Bearer <human-jwt>`.                                                            |
| `Idempotency-Key` | `apply`          | Fresh `idempotency_key_<ulid>` for a new request. Keep it to retry that request. |
| `Content-Type`    | `apply`, `check` | `application/json`.                                                              |

```sh
curl -i 'http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding?kind=repository&kind=worker&state=all' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding-set \
  -H 'Authorization: Bearer <human-jwt>'

curl -i -X PUT http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding-set \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  --data-binary @bindings.json

curl -i -X POST http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding/binding_01JD3WA2K5V6X7Y8Z9A0B1C2D5/verify \
  -H 'Authorization: Bearer <human-jwt>'

curl -i -X POST http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  --data-binary @repository.json
```

An example `bindings.json`:

```json
{
  "version": 4,
  "bindings": {
    "app": {
      "kind": "repository",
      "config": {
        "available": true,
        "platform": "github",
        "address": "git@github.com:acme/app.git",
        "strategy": {
          "base_branch": "main",
          "action": {
            "name": "pull_request",
            "follows": { "type": "assessment_passed" }
          }
        },
        "ssh_credential": "<ssh-credential-name>",
        "credential": "<github-credential-name>"
      }
    },
    "builder": {
      "kind": "worker",
      "config": {
        "worker": "<worker-name>",
        "worker_instances": ["builder-1", "builder-2"]
      }
    },
    "artifacts": {
      "kind": "storage",
      "config": {
        "available": true,
        "endpoint": "https://s3.example.com",
        "bucket": "artifacts",
        "region": "us-east-1",
        "prefix": "",
        "credential": "<s3-credential-name>"
      }
    }
  }
}
```

An example `repository.json` for `check`, with the configuration of `app` above:

```json
{
  "kind": "repository",
  "config": {
    "available": true,
    "platform": "github",
    "address": "git@github.com:acme/app.git",
    "strategy": {
      "base_branch": "main",
      "action": {
        "name": "pull_request",
        "follows": { "type": "assessment_passed" }
      }
    },
    "ssh_credential": "<ssh-credential-name>",
    "credential": "<github-credential-name>"
  }
}
```

## CLI shape

```text
kanthord project binding list <project-id> [--kind <kind>]... [--state <state>] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord project binding get <project-id> <binding-id> [--token <jwt>] [--endpoint <url>]
kanthord project binding export <project-id> [--token <jwt>] [--endpoint <url>]
kanthord project binding apply <project-id> --file <path> [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
kanthord project binding revision list <project-id> <binding-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord project binding verify <project-id> <binding-id> [--token <jwt>] [--endpoint <url>]
kanthord project binding check <project-id> --file <path> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord project binding list project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --kind repository --kind worker --state all
kanthord project binding export project_01JD3W8QF4Q7J8M9N0P1R2S3T4 > bindings.json
kanthord project binding apply project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --file bindings.json
kanthord project binding revision list project_01JD3W8QF4Q7J8M9N0P1R2S3T4 binding_01JD3WA2K5V6X7Y8Z9A0B1C2D3
kanthord project binding verify project_01JD3W8QF4Q7J8M9N0P1R2S3T4 binding_01JD3WA2K5V6X7Y8Z9A0B1C2D5
kanthord project binding check project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --file repository.json
```

`kanthord project binding` and `kanthord project binding revision` without a subcommand display help.

### Positional arguments

| Argument       | Commands                         | Purpose                                  |
| -------------- | -------------------------------- | ---------------------------------------- |
| `<project-id>` | All                              | Project ID.                              |
| `<binding-id>` | `get`, `revision list`, `verify` | Binding ID of a revision of the project. |

### project binding list

| Option              | Default / resolution | Purpose                                                        |
| ------------------- | -------------------- | -------------------------------------------------------------- |
| `--kind <kind>`     | All kinds            | Keeps bindings of this kind. Repeat the option for more kinds. |
| `--state <state>`   | `current`            | `current`, `removed` or `all`.                                 |
| `--limit <count>`   | `100`                | Maximum bindings per page, from `1` to `1000`.                 |
| `--cursor <cursor>` | None                 | Continues from the `next_cursor` of a previous page.           |

### project binding get, export and verify

There are no command options.

### project binding apply

| Option                    | Default / resolution                 | Purpose                                                            |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `--file <path>`           | Required                             | JSON file with the complete binding set: `version` and `bindings`. |
| `--idempotency-key <key>` | A generated `idempotency_key_<ulid>` | Sets `Idempotency-Key`. Supply the same key to retry.              |

The CLI reads the file as UTF-8 JSON, refuses repeated keys, and checks it against the request schema before it sends the request. The output of `export` is a valid input file.

### project binding revision list

| Option              | Default / resolution | Purpose                                              |
| ------------------- | -------------------- | ---------------------------------------------------- |
| `--limit <count>`   | `100`                | Maximum revisions per page, from `1` to `1000`.      |
| `--cursor <cursor>` | None                 | Continues from the `next_cursor` of a previous page. |

### project binding check

| Option          | Default / resolution | Purpose                                                                  |
| --------------- | -------------------- | ------------------------------------------------------------------------ |
| `--file <path>` | Required             | JSON file with one `{ "kind": "repository", "config": { ... } }` object. |

The CLI applies the file rules of `apply` to this file.

The `repository.json` example in [API shape](#api-shape) is a complete file.

### Shared options

Every command accepts these `project` group options.

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). Only `--kind` can occur more than once. The HTTP client has a 31-second deadline for these 30-second operations.
