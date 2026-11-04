---
title: Footprint Service
---

# Footprint Service

## Scope

This document describes the Footprint Service.
It describes the statistics of the stores that grow with time, the cleanup candidates, the cleanup and the alerts.
It describes no mechanism of another service.

## The rule of no automatic delete

KanthorD deletes no user data automatically.
A run deletes only the scratch that it created, before it ends.
No start, no timer and no later run deletes data that an earlier run left.
Key material, secret files and a ruled checkout reset are the exceptions, under [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters).
No alert deletes anything.
A human picks each cleanup, and the owner of the data deletes it.

## Boundary

- The Footprint Service measures, proposes, records and alerts. It deletes no data of another owner.
- Each owner measures its own stores through a read collaboration.
- Each owner deletes the data of its stores only through its own delete operation.
- The owners are the Tracking, Worker, Intake, Project, Workbench and Footprint Services.
- The Tracking Service owns the traces.
- The Worker Service owns the unit stores of each instance, the slot images and the container runtime store.
- The Intake Service owns the repository mirrors of its inbounds.
- The Project Service owns the environments and the cache volumes.
- The Workbench Service owns its sessions and its agent directories.
- The Footprint Service owns the files of the server host: the operational database, the database backups and the server log.
- The Footprint Service owns the [cleanup](footprint-service.vocabulary.md#cleanup) record and the [alert episode](footprint-service.vocabulary.md#alert-episode).
- The Footprint Service is the durable obligation owner of each cleanup.

## Footprint kinds

A [footprint kind](footprint-service.vocabulary.md#footprint-kind) is one store that grows with time.
The set of kinds is closed.

| Kind                   | Host             | Owner                                          | Owner delete operation                    |
| ---------------------- | ---------------- | ---------------------------------------------- | ----------------------------------------- |
| `operational_database` | server           | Footprint                                      | none                                      |
| `trace`                | server           | Tracking                                       | `tracking.trace.delete`                   |
| `database_backup`      | server           | Footprint                                      | `footprint.backup.delete`                 |
| `log`                  | server, instance | Footprint at the server, Worker at an instance | none                                      |
| `environment`          | server           | Project                                        | `project.environment.delete`              |
| `cache_volume`         | server           | Project                                        | `project.environment.cache_volume.delete` |
| `slot_image`           | server           | Worker                                         | `worker.slot_image.delete`                |
| `slot_residue`         | instance         | Worker                                         | none                                      |
| `intake_mirror`        | server           | Intake                                         | none                                      |
| `workbench`            | server           | Workbench                                      | none                                      |
| `session`              | instance         | Worker                                         | `worker.instance.session.delete`          |
| `workspace`            | instance         | Worker                                         | `worker.instance.workspace.delete`        |
| `tool_output`          | instance         | Worker                                         | `worker.instance.tool_output.delete`      |
| `disk`                 | each device      | Footprint, Worker                              | none                                      |

- No kind measures bytes that another kind measures.
- `trace` measures the whole `tracking.db`. `operational_database` measures the whole `kanthord.db`.
- The tables of a database show as rows of the breakdown of its kind. A row of a table that has its own owner delete links to that operation, for example `mission.evidence.delete` and `intake.inbound.event.delete`.
- `disk` measures the free space of each device that holds a kind: the devices of the data and state directories, the container runtime store and the data directory of each `worker` placement instance.
- A pulled base image holds no owner label, so no kind measures it. The `disk` statistic of its device counts its bytes.
- `workbench` holds statistics only, with no delete and no rule.
- `log` holds no delete, because the operator rotates each log file. KanthorD rotates no log.
- `slot_residue` holds no delete. At the `server` and `container` placements, `worker.instance.archive` frees its bytes. At the `worker` placement, the operator removes the files of the temporary directory of the instance.

## Statistics

- A [measurement](footprint-service.vocabulary.md#measurement) reads the count, the size, the oldest item time and the newest item time of each kind on each host.
- A statistic adds the growth per day, the days to the floor for `disk`, the measure error, the stale mark and the alert state.
- The Footprint Service computes every statistic from the newest measurement. No store holds a measurement.
- The growth per day comes from the item times and from the cleanups inside the window. No history table exists.
- A failed measurement keeps the last value and the alert state.
- An instance kind is stale while its instance sends no measurement.

## Cleanup candidates

- A [cleanup rule](footprint-service.vocabulary.md#cleanup-rule) proposes the [candidates](footprint-service.vocabulary.md#candidate) of a kind. A rule deletes nothing.
- The rules are `older_than`, `node_closed`, `unbound`, `superseded` and `dangling`.
- The default age of `older_than` is 30 days for every kind.
- `node_closed` proposes the workspace of a node that is `Completed`, `Discarded` or retired, with no idle wait. It also proposes each execution workspace that a crash left.
- The candidate set holds no live key. An open trace, a running execution, a held workspace, the bound current digest of a path and an image or a volume that a container uses are live.
- The candidate set holds no newest backup of a file.
- A human can also pick keys from the item list of a kind that holds an owner delete.
- "Delete an execution" deletes the trace and the agent session directory of that execution. The `scheduler_execution` row and every Mission record stay.

## Cleanup

- A human confirms a set of keys of one kind on one host. The Footprint Service records the cleanup with the human, the time, the kind, the host, the rule and the keys.
- A background task of the Footprint Service calls the owner delete operation under the Footprint service identity. The body names the human who confirmed.
- A cleanup deletes only the keys that the human confirmed.
- Each key ends as removed, absent or refused. The owner refuses a live key.
- A cleanup is idempotent. The Footprint Service resumes it after an interruption.
- A cleanup holds no rollback. A failed cleanup keeps the keys that the owner removed before the failure.
- The cleanup record is the audit of a cleanup. It covers no other human act.
- A human can call an owner delete operation directly. Such a call writes no cleanup record.

What each cleanup removes and what stays:

| Kind              | Removes                                                                      | Stays                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `trace`           | the trace with its spans, records, telemetry texts and session entries       | the flow rollups, the `scheduler_execution` row, every Mission record and the agent session on the host             |
| `session`         | the agent session directory of the execution on its host                     | the trace and its cut session entries. A rebuild of a cut entry then answers that the host did not keep the session |
| `workspace`       | the workspace directory on the host                                          | the node branch on the remote and the evidence. Uncommitted files of a closed node are lost                         |
| `tool_output`     | the output file in the temporary directory of the instance                   | the session entry that names the path. A later read of the path by the agent fails                                  |
| `database_backup` | the backup file                                                              | the database                                                                                                        |
| `environment`     | the image tags and the proof file of the key, or the image of a dangling key | the binding. The next proof builds again                                                                            |
| `cache_volume`    | the volume                                                                   | the binding. The next build fills a new volume                                                                      |
| `slot_image`      | the image                                                                    | the configured image of the running version                                                                         |

## Thresholds and alerts

- The main alert is the `disk` alert of each device.
- The `disk` alert fires when the free ratio is below 0.1, or when the projected time to the 0.1 [floor](footprint-service.vocabulary.md#days-to-the-floor) is 30 days or less.
- The projection divides the free bytes above the floor by the sum of the growth per day of the kinds on the device.
- A [threshold](footprint-service.vocabulary.md#threshold) of bytes applies to each kind. Every kind holds no threshold by default, except `trace` with 8 GiB and `log` with 2 GiB for each file.
- An alert moves through `ok`, `pending`, `firing` and `recovering`. Two measurements in a row and a clear margin stop a flap.
- An alert deletes nothing and starts no cleanup. Its text proposes the candidates of its kind.
- A human [acknowledges](footprint-service.vocabulary.md#acknowledgement) an open episode. A `disk` acknowledgement holds until the free bytes drop below half the free bytes at the acknowledgement, but never below the floor bytes. Below the floor, it holds until the free bytes drop below half the free bytes. A bytes acknowledgement holds until the value reaches twice the value at the acknowledgement.
- The alert channels are the banner and the badge of the dashboard, the CLI `kanthord footprint summary` and one server log record at each fire and each resolve. No webhook and no health component carry an alert.

## Placements

- At the `server` and `container` placements, the server measures and deletes the agent sessions of an instance on the server host. The session directory of a `container` instance is on the server host.
- At every placement, the [worker unit](worker-service.vocabulary.md#worker-unit) measures its own data directory and runs the cleanup orders of its instance.
- A unit sends its measurement and its results through one `client` operation on the current Gateway port. No new port exists.
- At the `worker` placement, an order reaches the instance through the work read. The heartbeat carries no footprint payload.
- At the `server` and `container` placements, an order reaches the instance in the answer of its next report, within one measurement interval.
- The unit of an instance measures and cleans its unit kinds only while it runs and holds a registration. Otherwise the statistics of the instance show as stale.
- The archive of an instance fails each open cleanup order of the instance and resolves each open alert episode of the instance.

## Dashboard

- The dashboard holds a "Footprint" section in the navigation group "System".
- An alert shows as a banner on the Overview, below the health alert of the server, and as a badge on the "Footprint" navigation item.
- An alert adds no board item and no board tab.
- A cleanup opens a confirmation dialog that states the consequence of the kind and a safer path.
- [footprint-service.impl.md](footprint-service.impl.md#the-dashboard) holds the screens.
