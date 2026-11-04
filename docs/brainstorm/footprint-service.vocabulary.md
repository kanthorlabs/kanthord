---
title: Footprint Service Vocabulary
---

# Footprint Service Vocabulary

This file holds the values and the examples of the terms that [footprint-service.md](footprint-service.md) owns.
This file is not a design document, and `footprint-service.md` stays the single source of truth.

## footprint kind

A footprint kind is one store that grows with time, with one owner.
The set is closed and it holds fourteen values.

- **`operational_database`**, the used bytes of `kanthord.db`
- **`trace`**, the used bytes of `tracking.db` and its traces
- **`database_backup`**, the backup files of `kanthord.db`, `tracking.db` and `kanthord.yaml`
- **`log`**, the log files of the server and of each instance
- **`environment`**, the environment images and their proof files
- **`cache_volume`**, the dependency cache volumes
- **`slot_image`**, the images of `worker.container_image`
- **`slot_residue`**, the rest of the slot of an instance
- **`intake_mirror`**, the repository mirrors of the Intake Service
- **`workbench`**, the sessions and the agent directories of the Workbench Service
- **`session`**, the agent session directories of the executions of an instance
- **`workspace`**, the workspaces of an instance
- **`tool_output`**, the output files of the agent tools of an instance
- **`disk`**, the free space of one device

The `workspace` kind of the worker instance `e2e-coder-1` of project `Billing` holds 700 workspaces and about 235 GiB.

## measurement

A measurement is one read of the count, the size and the item times of each kind on one host.
The unit of `e2e-coder-1` measures its data directory every 15 minutes and reports 700 workspaces and about 235 GiB.

## candidate

A candidate is one key that a cleanup rule proposes for a cleanup.
The rule `node_closed` proposes 640 workspaces of `Completed`, `Discarded` or retired nodes of `Billing` on `e2e-coder-1`. The 60 workspaces of open nodes are no candidates.

## cleanup rule

A cleanup rule selects the candidates of one kind.
The set is closed and it holds five values.

- **`older_than`**, the items older than a number of days
- **`node_closed`**, the workspace of a closed node, and an execution workspace that a crash left
- **`unbound`**, an environment or a cache volume of a repository that no project binds
- **`superseded`**, an environment of an older digest of a path, or a slot image that the running version does not configure
- **`dangling`**, an untagged environment image with the owner label

Ulrich picks `older_than` with 60 days for the traces of `Billing`.

## cleanup

A cleanup is one recorded request of a human to delete a set of keys of one kind on one host.
Its record states who confirmed, when, the kind, the host, the rule, the keys and the outcome.
Ulrich confirms the cleanup of 640 workspaces on `e2e-coder-1`. The record ends `completed` with 640 keys removed.

## threshold

A threshold is the value of a measure above which a statistic alerts.
The measures are `bytes`, `free_ratio` and `days_to_floor`.
The `trace` kind of the server of `Billing` alerts above 8 GiB.

## days to the floor

The days to the floor are the projected days until the free bytes of a device reach the floor.
The floor is `disk_free_ratio` of the total bytes of the device, 0.1 by default.
The host of `e2e-coder-1` holds 1 TiB with 260 GiB free, and its workspaces grow about 5.9 GiB a day. The floor is 102.4 GiB, so the days to the floor are about 26.8.

## alert episode

An alert episode is one period during which a statistic is above its threshold, from its fire to its resolve.
The set of alert states is closed and it holds four values.

- **`ok`**
- **`pending`**
- **`firing`**
- **`recovering`**

The `disk` statistic of `e2e-coder-1` projects 26.7 days to the floor at two measurements in a row, so one episode fires. It resolves after the cleanup of 640 workspaces.

## acknowledgement

An acknowledgement is the mark of a human that hides an open episode from the banner and the badge until a bound.
Ulrich acknowledges the `disk` episode of `e2e-coder-1` at 260 GiB free. The acknowledgement holds until the free bytes drop below 130 GiB.
