---
title: Footprint Service Implementation
---

# Footprint Service Implementation

This file holds the mechanisms that realize [footprint-service.md](footprint-service.md).
This file is not a design document, and `footprint-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## Layout

- The service lives in `src/footprint/`. `contract.ts` holds the operations, the enums, the schemas and the read collaboration `FootprintOwner`.
- `S` is the state directory and `D` is the data directory of the server, under [architecture.impl.md](architecture.impl.md#the-directories-of-the-server). `<unit>` is the data directory `D/workers/<name>/` of a `worker` placement instance.
- Every timestamp field is Unix ms, `footprintTimeSchema = z.int().min(0)`.
- `instanceNameSchema` is the instance name schema of `src/worker/contract.ts`.
- `identitySchema` of `src/kernel/identity.ts` holds the prefixes `cleanup` and `alert`.
- `humanActorSchema` of `src/kernel/actor.ts` is the `human` variant of the actor. The Mission contract builds its `actorSchema` union from it.

## The kinds and their measures

| Kind                   | Measure                                                                                                                                                                                                                                                                 | Count unit   | Device                                                        | Rules                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------- | ----------------------------------- |
| `operational_database` | used bytes `(page_count - freelist_count) × page_size` of `kanthord.db`; `freelist_count × page_size` as `free_bytes`; the `-wal` size as `wal_bytes`                                                                                                                   | tables       | `D`                                                           | none                                |
| `trace`                | the same pragmas of `tracking.db`; `COUNT(*)`, `MIN(created_at)` and `MAX(created_at)` of `tracking_trace`                                                                                                                                                              | traces       | `D`                                                           | `older_than`                        |
| `database_backup`      | `stat` of each `*.bak-<timestamp>` beside `kanthord.db`, `tracking.db` and `kanthord.yaml`                                                                                                                                                                              | files        | `D`                                                           | `older_than`                        |
| `log`                  | `stat` of each log file. Server: `S/kanthord.log`. Instance: the unit `kanthord.log`, and `S/workers/<name>/stderr.log` at the `server` and `container` placements                                                                                                      | files        | none                                                          | none                                |
| `environment`          | for each key `<identity path>@<digest>`: the `UNIQUE SIZE` of its tagged images with the owner label from `<runtime> system df -v`, plus the proof file `S/environments/<identity path>/<digest>.json`; for each untagged image with the owner label: its `UNIQUE SIZE` | environments | runtime store                                                 | `unbound`, `superseded`, `dangling` |
| `cache_volume`         | `<runtime> system df -v`, names `kanthord_cache_*`                                                                                                                                                                                                                      | volumes      | runtime store                                                 | `unbound`                           |
| `slot_image`           | `<runtime> system df -v`: the `UNIQUE SIZE` of each image of the repository `worker.container_image`                                                                                                                                                                    | images       | runtime store                                                 | `superseded`                        |
| `slot_residue`         | `server`, `container`: the unit walk of its slot root less the session root, `workspaces/`, the unit log, the `tool_output` files and, at `container`, `.cache`; `worker`: the unit walk of `<unit>/tmp` less the `tool_output` files                                   | slots        | none                                                          | none                                |
| `intake_mirror`        | walk of `S/intake/repositories/`                                                                                                                                                                                                                                        | mirrors      | `S`                                                           | none                                |
| `workbench`            | walk of `S/pi/sessions/workbench/` and `S/workbench/<agent>/`, and `lstat` of each pi output file `pi-*-<16 hex>.*` in `os.tmpdir()` of the server: one item for each session file, one for the cwd of each agent and one for each output file                          | items        | `S`                                                           | none                                |
| `session`              | `server`: walk on the server of `S/workers/<name>/state/kanthord/pi/sessions/execution/*`; `container`: walk on the server of `S/workers/<name>/sessions/execution/*`; `worker`: walk inside the unit of `<unit>/pi/sessions/execution/*`                               | executions   | `server`, `container`: `S`; `worker`: `<unit>`                | `older_than`                        |
| `workspace`            | walk of `<unit>/workspaces/*`                                                                                                                                                                                                                                           | workspaces   | `server`: `S`; `container`: runtime store; `worker`: `<unit>` | `node_closed`                       |
| `tool_output`          | `lstat` of each pi output file `pi-*-<16 hex>.*` in the temporary directory of the instance: `server`: `S/workers/<name>/tmp/`; `container`: `/var/lib/kanthord/tmp/`; `worker`: `<unit>/tmp/`                                                                          | files        | `server`: `S`; `container`: runtime store; `worker`: `<unit>` | `older_than`                        |
| `disk`                 | server: `fs.statfs` of `D` and of `S`, keyed by `fs.stat(...).dev`; runtime store: read by the Worker Service under [the container runtime store](#the-container-runtime-store); `worker` placement: `fs.statfs` of `<unit>`, read by the unit                          | none         | itself                                                        | none                                |

Closed sets of `src/footprint/contract.ts`:

- `FootprintKind`: the fourteen kinds of the table.
- `CleanableKind`: `trace`, `database_backup`, `environment`, `cache_volume`, `slot_image`, `session`, `workspace`, `tool_output`.
- `InstanceFootprintKind`: `session`, `workspace`, `tool_output`, `log`, `slot_residue`.
- `InstanceCleanableKind`: `session`, `workspace`, `tool_output`.
- `CleanupRule`, `CleanupState`, `CleanupRefusal`, `FootprintAlertState` and `ThresholdMeasure` (`bytes`, `free_ratio`, `days_to_floor`).
- The name `cleanups` is reserved. No kind takes it.
- `slot_image` is a server kind, because the server reads `<runtime> system df -v`. Its `instance_name` is null.

The rules of a measure:

- The "Device" column names the device that receives the growth of the kind in the `disk` projection. "Runtime store" is the device key of the container runtime store. A kind with "none" has no item time, so it adds no growth.
- A file walk uses `lstat` and follows no symlink. It takes a `skip` list of paths relative to its root. It counts each `(dev, ino)` pair once in each walk. The set holds only the files with `nlink` above 1. `src/kernel/footprint-walk.ts` holds the walk.
- The measures use the answering runtime of `answeringRuntime()`. `environment`, `cache_volume` and `slot_image` read `<runtime> system df -v` at Podman and at Docker.
- An image item of `environment` and `slot_image` reports the `UNIQUE SIZE` of `<runtime> system df -v`. The kind total is the sum of the items. A shared layer counts in no item.
- The session walk and the session delete on the server follow one trust rule. The session root is trusted, under [the host read](worker-service.impl.md#the-host-read). The rule: lstat each path below the session root; follow no symlink; a symlink or a changed directory stops the walk for that execution.
- `database_backup` counts every `*.bak-<timestamp>`. The newest backup of each file shows as kept and stays out of the candidates.
- The `tool_output` measure lists the temporary directory with no recursion. It keeps only the regular files whose name matches `pi-*-<16 hex>.*`, checked with `lstat`. It skips a symlink and every other name.
- Each `tool_output` file belongs to one instance at every placement, because each placement gives its instance its own `TMPDIR`, under [worker-service.impl.md](worker-service.impl.md#isolation-of-a-thread-slot).
- The pi output files of the Workbench Service count in `workbench`, because a workbench session runs in the server process.
- At the `server` and `container` placements, `worker.instance.archive` frees the bytes of `slot_residue`. The start removes the slot root and the slot volume of an archived instance only.

### The container runtime store

- The Worker Service reads the store only when a `container` placement instance exists.
- At Podman, it reads `Store.GraphRoot`, `Store.GraphRootAllocated` and `Store.GraphRootUsed` from `podman info` at each measurement. `total_bytes` is `GraphRootAllocated`. `free_bytes` is `GraphRootAllocated - GraphRootUsed`.
- At Docker, it reads `DockerRootDir` and `OperatingSystem` from `docker info`. When `process.platform` is `linux` and `OperatingSystem` is other than `Docker Desktop`, it applies `fs.statfs` to `DockerRootDir`. The device rule below then uses `DockerRootDir` in place of `GraphRoot`.
- Else the runtime store `disk` answers `measure_error` with the code `runtime_store_unmeasured`. This covers Docker Desktop on every host and a Docker Engine in a VM on macOS. The kinds on the runtime store keep their bytes and their candidates.
- The device key is `fs.stat(GraphRoot).dev` when the store is on the server host, else the fixed key `container_runtime`. When the store is on a server disk, the server statistic and the store share one device key, so one statistic and one episode stand.
- `instance_names` of the store lists the `container` placement instances.

### The breakdown of a database kind

- `trace`: one row for each table of `tracking.db`. One row `rollup` holds the three rollup tables with their bytes and their oldest bucket.
- `operational_database`: one row for each table of `kanthord.db`. The row `mission_evidence` links to `mission.evidence.delete`. The row `intake_inbound_event` holds its oldest event and links to `intake.inbound.event.delete`. The row `intake_outbound_request` links to the Intake screen. The rows `footprint_cleanup` and `footprint_alert` hold the Footprint records.
- `intake.inbound.event.delete` and `intake.outbound.request.delete` keep `human` access and take no `requested_by`.
- The breakdown runs only on `footprint.kind.get` of `trace` or `operational_database`. It reads `dbstat … WHERE name = ?` for one table in each turn of the event loop. It stops after `FOOTPRINT_SCAN_BUDGET_MS` and caches the result for one measurement interval. A table that the budget cuts answers `bytes: null`.
- When `dbstat` is absent, every breakdown `bytes` answers null, and the totals of the pragmas stay.

## Statistics

```ts
export const footprintThresholdSchema = z.discriminatedUnion("measure", [
  z.strictObject({
    measure: z.literal(ThresholdMeasure.Bytes),
    value: z.int().min(1),
  }),
  z.strictObject({
    measure: z.literal(ThresholdMeasure.FreeRatio),
    value: z.number().gt(0).lt(1),
  }),
  z.strictObject({
    measure: z.literal(ThresholdMeasure.DaysToFloor),
    value: z.int().min(1),
    free_ratio: z.number().gt(0).lt(1),
  }),
]);

export const footprintStatSchema = z.strictObject({
  kind: z.enum(FootprintKind),
  instance_name: instanceNameSchema.nullable(),
  item_key: z.string().min(1).nullable(),
  instance_names: z.array(instanceNameSchema),
  measured_at: footprintTimeSchema.nullable(),
  stale: z.boolean(),
  measure_error: z
    .strictObject({ code: z.string().min(1), message: z.string() })
    .nullable(),
  count: z.int().min(0).nullable(),
  bytes: z.int().min(0).nullable(),
  wal_bytes: z.int().min(0).nullable(),
  free_bytes: z.int().min(0).nullable(),
  total_bytes: z.int().min(0).nullable(),
  oldest_at: footprintTimeSchema.nullable(),
  newest_at: footprintTimeSchema.nullable(),
  growth_per_day: z
    .strictObject({ count: z.number().min(0), bytes: z.number().min(0) })
    .nullable(),
  days_to_floor: z.number().min(0).nullable(),
  thresholds: z.array(footprintThresholdSchema),
  alert: z.strictObject({
    state: z.enum(FootprintAlertState),
    alert_id: identitySchema("alert").nullable(),
  }),
  delete_operation: z.string().min(1).nullable(),
  rules: z.array(z.enum(CleanupRule)),
  candidates: z
    .strictObject({
      rule: cleanupRuleSchema,
      count: z.int().min(0),
      bytes: z.int().min(0).nullable(),
      bytes_estimated: z.boolean(),
    })
    .nullable(),
});

export const footprintTableSchema = z.strictObject({
  name: z.string().min(1),
  bytes: z.int().min(0).nullable(),
  oldest_at: footprintTimeSchema.nullable(),
  delete_operation: z.string().min(1).nullable(),
});
```

One statistic stands for each kind and host, for each device of `disk` and for each file of `log`.

- `instance_name` is null for the server host and for the runtime store.
- `item_key` holds the device key for `disk` and the file name for `log`. It is null for every other kind.
- `instance_names` lists the instances on the device for `disk`. It is empty for every other kind.
- At the `worker` placement, each instance gives one `disk` statistic with its `instance_name`, its device as `item_key` and `instance_names` of that one instance. A device number is unique only on one host.
- At the `server` and `container` placements, the unit sends no `disk` value. The slot root lives on the device of `S`, and the slot volume lives in the runtime store. The server measures both.
- `measured_at` is null before the first measurement. `stale` is true when `measured_at` is older than three measurement intervals.
- `measure_error` holds the error of the last measurement of the owner, for example an absent `podman` or a `dbstat` error. A failed measurement keeps the last value and the alert state. The service logs one record for each change of the error code.
- `bytes` is null before the first measurement. `wal_bytes` is set only for `operational_database` and `trace`. `free_bytes` holds the freelist bytes of a database kind and the free bytes of a device for `disk`. `total_bytes` is set only for `disk`.
- `oldest_at`, `newest_at` and `growth_per_day` of an instance kind come from the full walk of the unit, never from the cut item list.
- `thresholds` lists the configured thresholds of the statistic. `disk` holds `free_ratio` and `days_to_floor`. A kind with a bytes key holds `bytes`. A kind with a `null` key holds none.
- `delete_operation` names the owner delete operation, or null. `rules` lists the rules of the kind. The dashboard builds its rule picker from `rules`.
- `candidates` holds the count and the bytes of the default rule of the kind with the age `DEFAULT_AGE_DAYS`, or null. `bytes_estimated` is true for `trace`.

The growth and the projection:

- The window is `max(1, min(DEFAULT_AGE_DAYS, (measured_at - oldest_at) / 86400000))` days. With a null `oldest_at`, the window is `DEFAULT_AGE_DAYS`.
- `window_count` is the count of items with a time inside the window.
- `removed` and `removed_bytes` are the sums over each `completed` cleanup of the same kind and host whose `finished_at` lies inside the window. The values come from `footprint_cleanup`.
- A cleanup with the rule `older_than` and `older_than_days >= DEFAULT_AGE_DAYS` adds nothing, because its keys lie outside the window.
- `growth_per_day.count` is `(window_count + removed) / window`.
- `growth_per_day.bytes` is `(window_count × bytes / count + removed_bytes) / window`. The first term is 0 when `count` is 0. A null `removed_bytes` adds `removed × bytes / count` in its place, and that value is 0 when `count` is 0.
- A kind with no item time (`operational_database`, `log`, `slot_residue`, `disk`) answers a null `growth_per_day`.
- `days_to_floor` is set only for `disk`. It is `(free_bytes - disk_free_ratio × total_bytes) / G`. `G` is the sum of `growth_per_day.bytes` of the kinds on the device. It is 0 when the free bytes are below the floor. It is null when `G` is 0 or null.
- The item times give the rate: `created_at`, the end of an execution, the directory `mtime` and the image creation time.

The bytes of a database kind:

- `trace.bytes` is the used bytes of `tracking.db`, `(page_count - freelist_count) × page_size`, with no subtraction. `operational_database.bytes` is the used bytes of `kanthord.db` in the same way.
- The periodic measure reads only the pragmas and the `-wal` size. It reads no `dbstat`.

The measurement cycle:

- The Footprint Service computes every statistic. It keeps the newest measurement of each kind and host in memory. No table holds a measurement.
- The server measures at its start and every `FOOTPRINT_MEASURE_INTERVAL_MS`. `footprint.measure.run` measures the server kinds at once.
- A unit measures its data directory at the same interval with asynchronous directory reads, outside the turn of an execution.
- After a server restart, an instance kind answers `measured_at: null` until the next report of its unit.

## Candidates

```ts
export const cleanupRuleSchema = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal(CleanupRule.OlderThan),
    older_than_days: z.int().min(1).max(3650),
  }),
  z.strictObject({ name: z.literal(CleanupRule.NodeClosed) }),
  z.strictObject({ name: z.literal(CleanupRule.Unbound) }),
  z.strictObject({ name: z.literal(CleanupRule.Superseded) }),
  z.strictObject({ name: z.literal(CleanupRule.Dangling) }),
]);

export const footprintCandidateSchema = z.strictObject({
  key: z.string().min(1).max(FOOTPRINT_KEY_MAX_LENGTH),
  at: footprintTimeSchema,
  bytes: z.int().min(0).nullable(),
  project_id: identitySchema("project").nullable(),
  node_id: identitySchema("node").nullable(),
  execution_id: identitySchema("execution").nullable(),
  refusal: z.enum(CleanupRefusal).nullable(),
  kept: z.boolean(),
});
```

`footprintKeySchema(kind)` validates the key form of each kind.

| Kind              | Key                                                                     | `at`                                                                   | Rules                                   |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| `trace`           | `trace_id`                                                              | `created_at` of the trace                                              | `older_than`                            |
| `database_backup` | the file name, for example `tracking.db.bak-20261003T101500`            | the `mtime`                                                            | `older_than`                            |
| `environment`     | `<identity path>@<digest>`; the image id for a `dangling` item          | the image creation time                                                | `unbound`, `superseded`, `dangling`     |
| `cache_volume`    | the volume name                                                         | the volume creation time                                               | `unbound`                               |
| `slot_image`      | the image reference                                                     | the image creation time                                                | `superseded`                            |
| `session`         | `execution_id`                                                          | `ended_at` of the execution                                            | `older_than`                            |
| `workspace`       | the workspace directory name, a `node_id` or an `execution_id`; `pool`  | the directory `mtime`; for `pool`, the newest return time of its trees | `node_closed`; `pool` is never selected |
| `tool_output`     | the file name, matching `^pi-[a-z0-9-]+-[0-9a-f]{16}(\.[A-Za-z0-9]+)?$` | the file `mtime`                                                       | `older_than`                            |

- `footprint.candidate.list` answers the keys of a rule, page by page, with the totals of the whole set.
- `older_than` selects the items with `at` older than `older_than_days`. The default is `DEFAULT_AGE_DAYS` for every kind.
- `node_closed` selects the workspace of a node that is `Completed`, `Discarded` or retired, with no idle wait. It also selects every execution workspace that a crash left.
- `unbound` selects an `environment` or `cache_volume` item of a repository that no project binds.
- `superseded` selects an `environment` item of another digest of a path that holds a newer proved digest. It covers the tags that a failed operation left. For `slot_image`, it selects an image that is not the configured `worker.container_image` of the running version and that no live container uses.
- `dangling` selects an untagged image with the owner label. The rule ships only when Podman keeps the owner label on a dangling image.
- The candidate set holds no live key. A live key is an open trace, an execution with a null `ended_at` or a held workspace key. The bound current digest of a path, and an image or a volume that a container uses, are also live.
- The candidate set of `database_backup` holds no newest backup of a file.
- `footprint.item.list` marks a live item with `refusal: live` and the newest backup of a file with `kept: true`.
- `candidates.bytes` of `trace` is the candidate count × `trace.bytes / trace.count`. The dashboard shows it as "about".
- The `session` candidates come from the session directories that each instance reports, keyed by `execution_id`. The Footprint Service joins them with `ended_at` of `scheduler_execution` through the collaboration `executionEndTimes(execution_ids)`. A resumed execution can hold directories on two instances, and each instance lists its own directory.
- The preset "Executions older than 30 days" intersects the `trace` candidates with the `session` candidates of every instance by `execution_id`. It sends one cleanup for `trace` and one cleanup for each instance that holds a key.

## Cleanup

```ts
export const cleanupCreateSchema = z.strictObject({
  kind: z.enum(CleanableKind),
  instance_name: instanceNameSchema.nullable(),
  rule: cleanupRuleSchema.nullable(),
  keys: z
    .array(z.string().min(1).max(FOOTPRINT_KEY_MAX_LENGTH))
    .min(1)
    .max(FOOTPRINT_CLEANUP_KEYS_MAX),
});

export const cleanupRecordSchema = z.strictObject({
  cleanup_id: identitySchema("cleanup"),
  kind: z.enum(CleanableKind),
  instance_name: instanceNameSchema.nullable(),
  rule: cleanupRuleSchema.nullable(),
  keys: z.array(z.string()),
  requested_by: humanActorSchema,
  requested_at: footprintTimeSchema,
  state: z.enum(CleanupState),
  finished_at: footprintTimeSchema.nullable(),
  outcome: z
    .strictObject({
      removed: z.int().min(0),
      removed_bytes: z.int().min(0).nullable(),
      absent: z.int().min(0),
      refused: z.array(
        z.strictObject({ key: z.string(), reason: z.enum(CleanupRefusal) }),
      ),
      pending: z.int().min(0),
    })
    .nullable(),
});
```

- The handler validates each key with `footprintKeySchema(kind)` and refuses a repeated key with 400. `rule` records the rule that proposed the keys, or null for a hand-picked set.
- `CleanupState` is `queued`, `running`, `completed`, `failed` or `cancelled`.
- `CleanupRefusal` is `live` or `unreadable`.
- `requested_at` is the ULID time of `cleanup_id`.
- The store holds `removed`, `removed_bytes`, `absent` and `refused` in `outcome`. The read computes `pending` as `keys.length - removed - absent - refused.length`.
- `footprint.cleanup.create` takes `requested_by` from the caller identity.

The handler and the task:

1. `footprint.cleanup.create` checks the kind, the host and the keys. It inserts the `queued` record as a ruled write and answers 201.
2. A background task of the Footprint Service takes each `queued` record and sets it `running`. It calls the owner delete operation through the direct adapter with the Footprint service identity, as a background producer.
3. The body of that call carries `requested_by` for the log of the owner. The owner trusts `requested_by` only from the Footprint service identity. A human caller sends no `requested_by`, and the owner takes the caller identity. An owner answers 400 `gateway.request.validation_failed` with the field `requested_by` when a human caller sends it.
4. A server kind runs in calls of at most `FOOTPRINT_CLEANUP_BATCH_ROWS` keys. The task processes `keys` in array order. It yields with `setImmediate` between two calls, and it writes `outcome` after each call. A concurrent writer waits at most one batch. The resume index is `removed + absent + refused.length`.
5. An instance kind runs as one call. `session` at the `server` and `container` placements and every server kind answer at once with the result. `session` at the `worker` placement and every `workspace` and `tool_output` order queue in the Worker Service and answer 202. Their result arrives later through `worker.footprint.report`.
6. Each key ends as `removed`, `absent` (already gone) or `refused` with a reason.
7. The completion condition: the record moves to `completed` when each key holds a result.
8. `failed` means that the owner cannot run the order, for example for an archived instance. `outcome` holds the keys that the owner removed before the failure. No rollback runs.
9. A human cancels a `queued` record through `footprint.cleanup.cancel`. The service refuses a cancel of a `running` record. The cancel records no actor.

The recovery after an interruption:

- At its start, the Footprint Service runs each `queued` and `running` record of a server kind again from the resume index. A batch that the owner ran before a crash, and that `outcome` does not hold, answers `absent` on the rerun and counts once.
- At its start, the Footprint Service calls the Worker delete operation again for each `queued` and `running` record of an instance kind. The Worker Service holds a queued order in memory only.
- The delivery of [the instance report](#the-instance-report) lists every `queued` and `running` order of the instance until its result arrives. The unit skips an order whose `cleanup_id` it runs now.
- The report handler accepts a result whose `cleanup_id` is a `queued` or `running` record of that instance in `footprint_cleanup`. It accepts the result also when a server restart removed the order from memory. The record then keeps the `removed` and `removed_bytes` of the unit.
- A lost answer, a unit restart or a server restart therefore repeats the order, and the keys that it already removed answer `absent`.

### The owner delete operations

Each owner states its live check on its own page.

| Operation id                              | Route                                                | Access             | Body                            | Answer                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------- | ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `tracking.trace.delete`                   | `POST /api/tracking/trace/delete`                    | `human_or_service` | `{ trace_ids }`, 1 to 20        | `{ removed, absent, refused }`                                                                             |
| `footprint.backup.delete`                 | `POST /api/footprint/backup/delete`                  | `human`            | `{ names }`                     | `{ removed, absent }`                                                                                      |
| `project.environment.delete`              | `POST /api/project/environment/delete`               | `human_or_service` | `{ keys }`                      | `{ removed, absent, refused }`                                                                             |
| `project.environment.cache_volume.delete` | `POST /api/project/environment/cache-volume/delete`  | `human_or_service` | `{ names }`                     | `{ removed, absent, refused }`                                                                             |
| `worker.slot_image.delete`                | `POST /api/worker/slot-image/delete`                 | `human_or_service` | `{ references }`                | `{ removed, absent, refused }`                                                                             |
| `worker.instance.session.delete`          | `POST /api/worker/instance/:name/session/delete`     | `human_or_service` | `{ cleanup_id, execution_ids }` | `server`, `container`: 200 `{ removed, removed_bytes, absent, refused }`; `worker`: 202 `{ queued: true }` |
| `worker.instance.workspace.delete`        | `POST /api/worker/instance/:name/workspace/delete`   | `human_or_service` | `{ cleanup_id, keys }`          | 202 `{ queued: true }`                                                                                     |
| `worker.instance.tool_output.delete`      | `POST /api/worker/instance/:name/tool-output/delete` | `human_or_service` | `{ cleanup_id, keys }`          | 202 `{ queued: true }`                                                                                     |

- Each `human_or_service` body also takes `requested_by: humanActorSchema`, from the service caller only.
- [gateway-service.impl.md](gateway-service.impl.md#access-policy) rules the access policy `human_or_service`. Each operation lists `[FOOTPRINT_SERVICE_NAME]` in `services`.
- `footprint.backup.delete` keeps `human` access, because the Footprint Service owns it and runs it in process. It refuses a name outside the backup form. No candidate set and no checkbox offers the newest backup of a file, because `footprint.item.list` marks it `kept: true`.
- [tracking-service.impl.md](tracking-service.impl.md#writable-period-and-deletes), [project-service.impl.md](project-service.impl.md#garbage-collection) and [worker-service.impl.md](worker-service.impl.md#the-footprint-operations) state the live check of each other operation.

## The instance report

- Every unit calls the Gateway with the client identity of each registration. The unit sends `worker.footprint.report` through the transport of its first registration. No new port and no new connection exist.
- The unit sends a report after each measurement and after each order. No second interval exists.
- The report is no heartbeat. It carries no liveness and changes no `work_version`.

```ts
export const footprintItemSchema = z.strictObject({
  key: z.string().min(1).max(FOOTPRINT_KEY_MAX_LENGTH),
  bytes: z.int().min(0),
  modified_at: footprintTimeSchema,
});

export const footprintReportSchema = z.strictObject({
  measurement: z
    .strictObject({
      measured_at: footprintTimeSchema,
      disk: z
        .strictObject({
          device: z.string().min(1),
          total_bytes: z.int().min(0),
          free_bytes: z.int().min(0),
        })
        .nullable(),
      kinds: z.array(
        z.strictObject({
          kind: z.enum(InstanceFootprintKind),
          count: z.int().min(0),
          bytes: z.int().min(0),
          oldest_at: footprintTimeSchema.nullable(),
          newest_at: footprintTimeSchema.nullable(),
          recent_count: z.int().min(0),
          items: z.array(footprintItemSchema).max(FOOTPRINT_REPORT_ITEMS_MAX),
          items_complete: z.boolean(),
        }),
      ),
    })
    .nullable(),
  results: z.array(
    z.strictObject({
      cleanup_id: identitySchema("cleanup"),
      removed: z.array(z.string()),
      removed_bytes: z.int().min(0),
      absent: z.array(z.string()),
      refused: z.array(
        z.strictObject({ key: z.string(), reason: z.enum(CleanupRefusal) }),
      ),
    }),
  ),
});
```

- A unit at the `server` or `container` placement sends `workspace`, `tool_output`, `log` and `slot_residue`. A unit at the `worker` placement also sends `session`.
- At the `server` and `container` placements, the Worker Service measures `session` on the server side at the same interval, under the session walk rule.
- The unit computes `count`, `bytes`, `oldest_at`, `newest_at` and `recent_count` over the full walk. `recent_count` counts the items inside `DEFAULT_AGE_DAYS`.
- `items` lists the oldest items first, at most `FOOTPRINT_REPORT_ITEMS_MAX`. `items_complete` is false when the walk found more. Only the candidates use `items`. The dashboard then states "The candidates cover the oldest 10000 items."
- The `log` kind lists one item for each log file, keyed by the file name. `slot_residue` lists no item.
- `slot_residue` at the `server` placement walks the four XDG directories and `tmp/` of `S/workers/<name>/`. At the `container` placement, it walks `/var/lib/kanthord` and also skips `.cache`, the mount point of the cache volume. At the `worker` placement, it walks only `<unit>/tmp` and skips the `tool_output` files.
- `disk` is null at the `server` and `container` placements.
- At the `server` and `container` placements, the Worker Service adds the `stderr.log` item of `S/workers/<name>/` to the `log` kind of the instance.
- The handler authorizes the instance of the registration. It accepts the items of every project of that instance.
- The handler calls the Footprint collaborations `recordMeasurement(instance_id, measurement)` and `recordResults(instance_id, results)` inside its transaction on `kanthord.db`. The Footprint Service is the one writer of `footprint_cleanup`.
- A result for a `cleanup_id` that is neither an order in memory nor a `queued` or `running` record of the instance answers 404 `worker.footprint.order_unknown`.

The order delivery:

- `session` at the `server` and `container` placements needs no order. The Worker Service deletes on the server side.
- Every other instance order stays in memory under the instance in the Worker Service: `session` at the `worker` placement, and `workspace` and `tool_output` at every placement.
- At the `worker` placement, the Worker Service raises `work_version` of the instance only when it queues an order. The work read answer `footprint_orders: [{ cleanup_id, kind, keys }]` lists the orders. The Worker Service drops an order after its result, and a result raises no `work_version`.
- At the `server` and `container` placements, the answer of `worker.footprint.report` lists the `queued` and `running` orders of the instance as `{ orders: [{ cleanup_id, kind, keys }] }`. An order waits at most one measurement interval. The answer is empty at the `worker` placement.
- The archive of an instance calls the Footprint collaboration `instanceArchived(name)`. It fails each `queued` and `running` order of the instance and resolves each open alert episode of the instance.

## Thresholds and alerts

`FootprintAlertState` is `ok`, `pending`, `firing` or `recovering`. The Footprint Service evaluates each kind, host and item after each measurement.

| From         | Condition at a measurement                                                               | To                                     |
| ------------ | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| `ok`         | value above the threshold                                                                | `pending`                              |
| `pending`    | value above the threshold, `FOOTPRINT_ALERT_CONFIRMATIONS` measurements in a row         | `firing`; insert an alert episode      |
| `pending`    | value at or below the threshold                                                          | `ok`                                   |
| `firing`     | value at or below the clear value                                                        | `recovering`                           |
| `recovering` | value at or below the clear value, `FOOTPRINT_ALERT_CONFIRMATIONS` measurements in a row | `ok`; set `resolved_at` of the episode |
| `recovering` | value above the clear value                                                              | `firing`                               |

- "Value above the threshold" means `bytes > value` for `bytes`, `free_bytes / total_bytes < value` for `free_ratio` and `days_to_floor <= value` for `days_to_floor`.
- The clear value is `value × FOOTPRINT_ALERT_CLEAR_RATIO` for `bytes`. It is `value / FOOTPRINT_ALERT_CLEAR_RATIO` for `free_ratio` and for `days_to_floor`.
- "At or below the clear value" means `bytes <= clear` for `bytes`, `free_bytes / total_bytes >= clear` for `free_ratio`, and `days_to_floor > clear` or null for `days_to_floor`. A null `days_to_floor` is not above the threshold.
- The `disk` statistic has two conditions: `free_ratio` with `disk_free_ratio`, and `days_to_floor` with `DEFAULT_AGE_DAYS`. It is above the threshold when either condition holds, and at or below the clear value only when both conditions are clear.
- One episode for each device covers both conditions. The episode records in `threshold` the condition that fired first, and in `value` its measured value at the fire.
- A stale measurement and a failed measurement change no state.
- After each successful measurement of a host, the service resolves each open episode of that host whose `item_key` the measurement no longer reports.
- A threshold change takes effect at the next measurement. A `null` threshold sets the state `ok` and resolves an open episode.
- After a restart, an open episode starts as `firing`. Every other kind, host and item starts as `ok`.
- The service logs one record at each fire and each resolve, with `kind`, `instance_name`, `item_key`, `value` and `threshold`.

```ts
export const footprintAlertSchema = z.strictObject({
  alert_id: identitySchema("alert"),
  kind: z.enum(FootprintKind),
  instance_name: instanceNameSchema.nullable(),
  item_key: z.string().min(1).nullable(),
  threshold: footprintThresholdSchema,
  value: z.number().min(0),
  fired_at: footprintTimeSchema,
  resolved_at: footprintTimeSchema.nullable(),
  acknowledged_by: humanActorSchema.nullable(),
  acknowledged_at: footprintTimeSchema.nullable(),
  acknowledged_until: z.int().min(0).nullable(),
  state: z.enum(FootprintAlertState),
});
```

- `fired_at` is the ULID time of `alert_id`. `value` holds bytes, a free ratio or projected days at the fire.
- The service computes `state` from memory for an open episode. A resolved episode answers `ok`.
- `footprint.alert.acknowledge` takes `acknowledged_by` from the caller identity. The acknowledgement hides the episode from the Home banner and the navigation badge. The Footprint screen still shows it.
- `acknowledged_until` holds bytes. The direction comes from `kind`. The service floors each value with `Math.floor`.
- For `disk`, `acknowledged_until` is the larger of half the free bytes at the acknowledgement and the bytes of the floor, `disk_free_ratio × total_bytes`. When the free bytes are below the floor, it is half the free bytes. The acknowledgement holds until the free bytes drop below `acknowledged_until`.
- For `bytes`, `acknowledged_until` is twice the value at the acknowledgement. The acknowledgement holds until the value reaches `acknowledged_until`.
- After the acknowledgement ends, the episode shows again. A new acknowledgement replaces the old one.
- A new episode after a resolve needs a new acknowledgement.

## Configuration

The section `footprint` of `kanthord.yaml` holds the fields below. `src/footprint/config.ts` holds the schema.

```yaml
footprint:
  disk_free_ratio: 0.1
  thresholds:
    operational_database: null
    trace: 8589934592
    database_backup: null
    log: 2147483648
    environment: null
    cache_volume: null
    slot_image: null
    slot_residue: null
    intake_mirror: null
    workbench: null
    session: null
    workspace: null
    tool_output: null
```

- `footprint.disk_free_ratio` holds the floor of the `disk` alert as a number above 0 and below 1. It defaults to `0.1`.
- Each key of `footprint.thresholds` holds bytes as a positive safe integer, or `null` to turn the bytes alert of that kind off. An instance kind applies the value to each instance. `log` applies the value to each file.
- The defaults are null, except `trace` with 8 GiB and `log` with 2 GiB.
- The projection condition of `disk` adds no field.

The constant values:

| Name                            | Value                               | Rule                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_AGE_DAYS`              | 30                                  | `src/tracking/contract.ts` owns it, and Footprint imports it. The `older_than` default of every kind, the growth window, the projection horizon of the `disk` alert and the default of `tracking.trace_writable_days`. |
| `FOOTPRINT_MEASURE_INTERVAL_MS` | 900000                              | The one measure interval for the server, the runtime store and every unit. The unit report follows each measurement.                                                                                                   |
| Stale age                       | 3 × `FOOTPRINT_MEASURE_INTERVAL_MS` | Derived.                                                                                                                                                                                                               |
| `FOOTPRINT_ALERT_CONFIRMATIONS` | 2                                   | One value for the fire and the resolve.                                                                                                                                                                                |
| `FOOTPRINT_ALERT_CLEAR_RATIO`   | 0.9                                 | One value for every measure.                                                                                                                                                                                           |
| `FOOTPRINT_CLEANUP_BATCH_ROWS`  | 20                                  | One value for every server kind.                                                                                                                                                                                       |
| `FOOTPRINT_CLEANUP_KEYS_MAX`    | 1000                                | Equal to `DELETE_IDS_MAX` of Intake.                                                                                                                                                                                   |
| `FOOTPRINT_REPORT_ITEMS_MAX`    | 10000                               | One value for every instance kind. A report of 10000 items stays below the request body limit.                                                                                                                         |
| `FOOTPRINT_SCAN_BUDGET_MS`      | 500                                 | One value for every table breakdown.                                                                                                                                                                                   |
| `FOOTPRINT_KEY_MAX_LENGTH`      | 512                                 | One value for every key form.                                                                                                                                                                                          |

## The store

One migration `src/footprint/migrations.ts` adds two tables to `kanthord.db`. [01-setup.html](../reference/erd/01-setup.html#footprint-service) holds the schema.

```sql
CREATE TABLE footprint_cleanup (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  instance_name TEXT,
  rule TEXT,
  keys TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  state TEXT NOT NULL,
  finished_at INTEGER,
  outcome TEXT
);

CREATE TABLE footprint_alert (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  instance_name TEXT,
  item_key TEXT,
  threshold TEXT NOT NULL,
  value REAL NOT NULL,
  resolved_at INTEGER,
  acknowledged_by TEXT,
  acknowledged_at INTEGER,
  acknowledged_until INTEGER
);

CREATE UNIQUE INDEX footprint_alert_open
  ON footprint_alert (kind, IFNULL(instance_name, ''), IFNULL(item_key, ''))
  WHERE resolved_at IS NULL;
```

- No table holds a `CHECK`. The service validates each closed set and each JSON column with the zod schemas before each write.
- The only index is a partial unique index on expressions: one open episode for each kind, host and item. SQLite treats two NULL values as distinct in a unique index, so the index uses `IFNULL`.
- `footprint_cleanup.kind` holds a `CleanableKind`. `rule` holds `cleanupRuleSchema` JSON. `state` holds a `CleanupState`. `keys` holds a JSON array of `footprintKeySchema(kind)` keys. `outcome` holds JSON `{ removed, removed_bytes, absent, refused[{ key, reason }] }`.
- `footprint_alert.kind` holds a `FootprintKind`. `threshold` holds `footprintThresholdSchema` JSON.

The reason of each column:

| Column                                               | Value                                            | Reason for the store                                                                     |
| ---------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `footprint_cleanup.id`                               | the cleanup, and through its ULID `requested_at` | No other record names the cleanup.                                                       |
| `footprint_cleanup.kind`, `instance_name`            | the store and the host                           | The deleted data is gone. A name stays taken after an archive.                           |
| `footprint_cleanup.rule`                             | the rule that proposed the keys                  | The rule is a choice of the human.                                                       |
| `footprint_cleanup.keys`                             | the keys that the human confirmed                | The "what" of the audit.                                                                 |
| `footprint_cleanup.requested_by`                     | the human who confirmed                          | No other record holds it.                                                                |
| `footprint_cleanup.state`                            | `queued`, `running` or an end state              | An order waits across restarts, and the cancel refuses a `running` record.               |
| `footprint_cleanup.finished_at`                      | the end                                          | No other record holds it.                                                                |
| `footprint_cleanup.outcome`                          | the removed, absent and refused keys             | The owner result is stored nowhere else. `pending` is computed.                          |
| `footprint_alert.id`                                 | the episode, and through its ULID `fired_at`     | No other record names the episode after a restart.                                       |
| `footprint_alert.kind`, `instance_name`              | the store and the host                           | NULL `instance_name` for the server devices and for the runtime store.                   |
| `footprint_alert.item_key`                           | the device or the log file                       | One host can hold two devices or two log files. NULL for every other kind.               |
| `footprint_alert.threshold`                          | the condition that fired                         | The configuration changes after the fire.                                                |
| `footprint_alert.value`                              | the value at the fire                            | The value changes after the fire. `REAL` holds a fraction, and bytes below 2^53 exactly. |
| `footprint_alert.resolved_at`                        | the end of the episode                           | No other record holds it after a restart.                                                |
| `footprint_alert.acknowledged_by`, `acknowledged_at` | the human who acknowledged, and when             | No other record holds it.                                                                |
| `footprint_alert.acknowledged_until`                 | the bound of the acknowledgement, in bytes       | It depends on the value at the acknowledgement, which a later measurement replaces.      |

- No table holds a measurement, because the next measurement computes each value again.
- `footprint_alert` holds no state column. The next measurement computes `pending` and `recovering` of an open episode.

## Operations

| Operation id                  | Route                                                                                   | Access  | Answer                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `footprint.summary.get`       | `GET /api/footprint`                                                                    | `human` | `{ stats: FootprintStat[], open_alerts: number, unacknowledged_alerts: number }`                                |
| `footprint.kind.get`          | `GET /api/footprint/kind/:kind`                                                         | `human` | `{ stats: FootprintStat[], tables: FootprintTable[] \| null }`; `tables` for `trace` and `operational_database` |
| `footprint.candidate.list`    | `GET /api/footprint/kind/:kind/candidate?instance_name=&rule=&older_than_days=&cursor=` | `human` | `Page<FootprintCandidate>` plus `{ total_count, total_bytes, bytes_estimated }`                                 |
| `footprint.item.list`         | `GET /api/footprint/kind/:kind/item?instance_name=&cursor=`                             | `human` | `Page<FootprintCandidate>` of every item, oldest first                                                          |
| `footprint.cleanup.create`    | `POST /api/footprint/cleanup`                                                           | `human` | 201 `FootprintCleanupRecord`                                                                                    |
| `footprint.cleanup.get`       | `GET /api/footprint/cleanup/:cleanup_id`                                                | `human` | `FootprintCleanupRecord`                                                                                        |
| `footprint.cleanup.list`      | `GET /api/footprint/cleanup?kind=&cursor=`                                              | `human` | `Page<FootprintCleanupRecord>`, newest first                                                                    |
| `footprint.cleanup.cancel`    | `POST /api/footprint/cleanup/:cleanup_id/cancel`                                        | `human` | `FootprintCleanupRecord`                                                                                        |
| `footprint.alert.list`        | `GET /api/footprint/alert?open=&cursor=`                                                | `human` | `Page<FootprintAlert>`, newest first                                                                            |
| `footprint.alert.acknowledge` | `POST /api/footprint/alert/:alert_id/acknowledge`                                       | `human` | `FootprintAlert`                                                                                                |
| `footprint.measure.run`       | `POST /api/footprint/measure`                                                           | `human` | `{ stats: FootprintStat[] }` of the server host                                                                 |
| `footprint.backup.delete`     | `POST /api/footprint/backup/delete`                                                     | `human` | `{ removed, absent }`                                                                                           |

- The dashboard and the CLI always delete through `footprint.cleanup.create`.
- [worker-service.impl.md](worker-service.impl.md#the-footprint-operations) declares `worker.footprint.report` and the instance delete operations.

### Error codes

| HTTP  | Code                                         | Operation and condition                                                                                                                                                |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404   | `footprint.instance.not_found`               | `footprint.kind.get`, `footprint.candidate.list`, `footprint.item.list`, `footprint.cleanup.create`: no worker instance has the name.                                  |
| 409   | `footprint.instance.archived`                | `footprint.cleanup.create`: the instance is archived.                                                                                                                  |
| 409   | `footprint.kind.host_mismatch`               | `footprint.cleanup.create`, `footprint.candidate.list`: a server kind with `instance_name`, or an instance kind without it.                                            |
| 409   | `footprint.rule.not_supported`               | `footprint.candidate.list`, `footprint.cleanup.create`: the rule does not apply to the kind.                                                                           |
| 404   | `footprint.cleanup.not_found`                | `footprint.cleanup.get`, `footprint.cleanup.cancel`: no cleanup has the id.                                                                                            |
| 409   | `footprint.cleanup.not_queued`               | `footprint.cleanup.cancel`: the cleanup is not `queued`.                                                                                                               |
| 404   | `footprint.alert.not_found`                  | `footprint.alert.acknowledge`: no alert has the id.                                                                                                                    |
| 409   | `footprint.alert.resolved`                   | `footprint.alert.acknowledge`: the episode is resolved.                                                                                                                |
| 409   | `footprint.alert.acknowledged`               | `footprint.alert.acknowledge`: the acknowledgement holds.                                                                                                              |
| 400   | `gateway.request.validation_failed`          | A key list that is empty, longer than the limit or repeated; a key of the wrong form for the kind; a kind outside `CleanableKind`; `requested_by` from a human caller. |
| 400   | `system.pagination.cursor_invalid`           | A cursor of another query.                                                                                                                                             |
| local | `cli.footprint.cleanup.create.too_many_keys` | `kanthord footprint cleanup create --rule`: the rule selects more than 1000 keys.                                                                                      |

- `worker.footprint.order_unknown` stands on [worker-service.impl.md](worker-service.impl.md#the-footprint-operations), and `gateway.access.service_refused` stands on [gateway-service.impl.md](gateway-service.impl.md#access-policy).
- A measure error is no error code of an operation. Its codes are `runtime_store_unmeasured` and `sessions_unmounted`, plus the code of a failed read of an owner.

## The read collaboration

`src/footprint/contract.ts` declares the read interface that each owner implements, as `HealthRegistry` borrows probes. It holds no delete. A service imports it through `contract.ts`.

```ts
export interface FootprintOwner {
  readonly kinds: readonly FootprintKind[];
  measure(signal: AbortSignal): Promise<readonly FootprintMeasure[]>;
  candidates(query: CandidateQuery): Promise<CandidatePage>;
}
```

- Each `FootprintMeasure` names the device key that receives the growth of the kind, or null.
- The composition root constructs the Footprint Service first. It takes its store, its service identity and a direct-adapter client that resolves at the first call.
- The composition root then constructs each owner with the Footprint collaborations that it calls: `recordMeasurement`, `recordResults` and `instanceArchived`. It then registers each owner with the Footprint Service.
- The Footprint Service starts after the owners and before the Gateway.
- The peer facts reach the candidate rules through collaborations of the composition root: `executionEndTimes(execution_ids)` of the Scheduler for `session`, `nodeStates(node_ids)` of the Mission for `workspace`, and `boundPaths()` of the Project for `environment` and `cache_volume`.

## The CLI

| Synopsis after `kanthord footprint`                                                                  | Operation                     |
| ---------------------------------------------------------------------------------------------------- | ----------------------------- |
| `summary`                                                                                            | `footprint.summary.get`       |
| `kind get <kind>`                                                                                    | `footprint.kind.get`          |
| `candidate list <kind> [--instance <name>] [--rule <rule>] [--older-than-days <n>]`                  | `footprint.candidate.list`    |
| `item list <kind> [--instance <name>]`                                                               | `footprint.item.list`         |
| `cleanup create <kind> [--instance <name>] (--rule <rule> [--older-than-days <n>] \| --file <path>)` | `footprint.cleanup.create`    |
| `cleanup get <cleanup-id>`                                                                           | `footprint.cleanup.get`       |
| `cleanup list [--kind <kind>]`                                                                       | `footprint.cleanup.list`      |
| `cleanup cancel <cleanup-id>`                                                                        | `footprint.cleanup.cancel`    |
| `alert list [--open]`                                                                                | `footprint.alert.list`        |
| `alert acknowledge <alert-id>`                                                                       | `footprint.alert.acknowledge` |
| `measure run`                                                                                        | `footprint.measure.run`       |

- Every command uses the human access. Each list command takes the list options of the CLI.
- `candidate list` is the preview. `cleanup create` sends the request at once, as `mission evidence delete` does. It asks no question.
- `cleanup create --rule` reads the candidate pages of the rule, at most 1000 keys, and sends them. A set above 1000 keys answers `cli.footprint.cleanup.create.too_many_keys` and names `--older-than-days` as the safer path.
- `--file` reads a JSON list of keys.
- `summary` prints one line for each kind, host and item: kind, host, item, count, size, oldest, growth per day, days to the floor, threshold, alert state, stale mark and measure error.
- `engine/docs/cli/footprint.md` holds the command table.

## The dashboard

Navigation and routes:

- The sidebar group "System" follows "Credentials". Its item "Footprint" opens `/footprint` and shows the badge of the unacknowledged alerts.
- The routes are `/footprint` (summary), `/footprint/:kind` (kind detail) and `/footprint/cleanups/:cleanup_id` (cleanup record).
- The shared hook `use-footprint-alerts.ts` polls `footprint.summary.get` every 60 s and answers `unacknowledged_alerts`. The badge and the Home banner read it.

The summary screen:

- One list item for each kind, host and item. The title holds the kind label and the host, and the file name for `log`. The status holds the alert state. The fields hold the size, the count, the oldest item, the growth per day, the threshold, the candidates and, for `disk`, the days to the floor.
- A stale value shows "Measured <age> ago. The instance does not report. Bind the instance to clean its workspaces, or archive it to remove its slot." A measure error shows its own notice.
- The list sorts the firing kinds first, then by size.
- "Measure now" calls `footprint.measure.run`.
- The section "Cleanups" lists the newest 20 records with the state, the kind, the host, the requester and the outcome.
- The section "Alerts" lists the open episodes with an "Acknowledge" action.

The kind screen:

- It shows the statistics of each host, and the breakdown of `trace` and `operational_database`. A breakdown row with `delete_operation` links to the screen of the owner. No second delete path exists.
- When `delete_operation` is set, the screen shows a rule picker built from `rules`, with an age field for `older_than` (default 30). It shows the candidate list with a checkbox for each row and "Select all N". The `trace` and `session` screens add the preset "Executions older than 30 days".
- A refused key shows its reason, for example "In use by a running execution." for `live`. A kept backup shows "Kept: the newest backup of this file." and has no checkbox.
- A kind with no delete shows the path of the owner, for example "The operator rotates `kanthord.log`. KanthorD rotates no log." for `log`.
- `slot_residue` shows "Archive the instance to remove its slot." at the `server` and `container` placements, and "The operator removes the files in `<unit>/tmp` on the host." at the `worker` placement.
- "Clean up" stays visible and disabled while no key is selected or the host is stale.

The confirmation flow:

1. "Clean up" opens an `AlertDialog`, never on a list row.
2. The title is "Delete <count> <kind label>?". The description states the consequence of the kind, from [the cleanup table](footprint-service.md#cleanup), and the size.
3. The safer path is "Narrow the set with a larger age, for example 60 days."
4. For `workspace`, the dialog states "A later execution of the node clones again and installs its dependencies again. Uncommitted files of a closed node are lost."
5. The time text depends on the kind and the placement:
   - `session` at the `server` and `container` placements: "KanthorD deletes these sessions at once."
   - `session`, `workspace` and `tool_output` at the `worker` placement: "The instance runs the cleanup when it reads its work, within 15 seconds while it runs."
   - `workspace` and `tool_output` at the `server` and `container` placements: "The instance runs the cleanup at its next report, within 15 minutes while it runs."
6. The action is the destructive "Delete <count> items". Cancel is "Keep them".
7. The dialog sends the calls in order. A later call can fail after an earlier call committed. The dialog then reports both facts and attempts no rollback.
8. On success, the dialog closes and opens the cleanup record. The record screen polls every 15 s while the state is `queued` or `running`.

The Home banner:

- The banner shows each unacknowledged firing episode below the health alert of the server, with a link to its kind and an "Acknowledge" action.
- The text of a `disk` episode is, for example: "The disk of `e2e-coder-1` reaches 10% free in about 27 days. Node workspaces grow about 5.9 GiB a day. Review the candidates."
- An alert adds no board item and no board tab.

## Tests

- The statistics: each field; the growth per day; the window of a store younger than `DEFAULT_AGE_DAYS`; the `removed` of a `completed` cleanup inside the window; an `older_than` cleanup of 30 days or more adds nothing; a null `removed_bytes`; `days_to_floor` from the sum of the growth on the device, 0 below the floor and null with no growth; stale; one log record for each change of the error code.
- The cleanup task: create answers 201 `queued`; batches of 20 in key order with a yield; a repeat answers `absent`; a server restart between two batches resumes at the resume index and ends `completed`; a batch that ran before a crash counts once; the read computes `pending`; cancel only `queued`; the task calls with the Footprint service identity and `requested_by` in the body.
- The store: a second open episode with NULL `instance_name` and NULL `item_key` for one kind fails; a second open `disk` episode for one device fails; a resolved episode permits a new one.
- The walk: a `--local` clone counts once; a hard link counts once; a symlink is not followed; a `skip` path is not walked.
- The owners: each live refusal; a human caller with `requested_by` answers 400; the Footprint service identity with `requested_by` passes; the newest backup stays kept.
- The runtime store: the device key on the server host and `container_runtime`; no `podman info` read with no `container` placement instance; `runtime_store_unmeasured` at Docker Desktop and at a Docker Engine in a VM on macOS.
- The instance report: the full-walk values; items oldest first; `items_complete`; a held key refused; a running `cleanup_id` skipped; `order_unknown`; a result after a server restart; a lost answer and a unit restart repeat the order.
- The alerts: each transition; no flap between 0.9 and 1.0 of the threshold; a stale and a failed measurement change nothing; a `null` threshold resolves; a restart restores `firing`; two `server` instances on `S` give one episode; two `worker` instances with the same device number give two episodes; a projection fire while the free ratio is above the floor; a resolve only when both conditions clear; each acknowledgement bound.
- The CLI: `cleanup create --rule` sends the candidate keys; `too_many_keys`; no question.
