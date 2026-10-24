---
title: Tracking Service Implementation
---

# Tracking Service Implementation

This file holds the implementation rulings for the mechanisms that realize [tracking-service.md](tracking-service.md).
This file is not a design document, and `tracking-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the workers that run on it.

## Trace model

The trace model reuses the [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/).
The implementation installs `@opentelemetry/api`, `@opentelemetry/resources` and `@opentelemetry/semantic-conventions`.
It installs no OpenTelemetry SDK.
kanthord implements the tracer, the span processor and the exporter itself.
The Tracking Service defines the interface of the tracer.
Every other service plugs that interface into its implementation.
The server stores spans in `tracking.duckdb` at every start.
The implementation reuses attribute names that the semantic conventions define.
A kanthord identity takes the `kanthord.` prefix.
A trace identity is 16 random bytes and a span identity is 8 random bytes, each written as lower-case hexadecimal under the W3C Trace Context representation, and the all-zero value is invalid.

## GenAI mapping

The agent spans follow the [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai).
A kanthord operation name stays the span operation, and `gen_ai.operation.name` maps it to the GenAI operation.

| Span operation  | `gen_ai.operation.name` | GenAI attributes                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent.session` | `invoke_agent`          | `gen_ai.conversation.id`, `gen_ai.agent.name`, `gen_ai.request.model`                                                                                                                                                                                                                            |
| `agent.turn`    | `chat`                  | `gen_ai.conversation.id`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.provider.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`, `gen_ai.response.finish_reasons`, `error.type` |
| `agent.tool`    | `execute_tool`          | `gen_ai.conversation.id`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `error.type`                                                                                                                                                                                                                |

- `gen_ai.conversation.id` holds the session identity, which is the span identity of the `agent.session` span.
- `gen_ai.request.model` holds the model of the agent configuration. `gen_ai.response.model` holds the model that the provider names in its reply.
- `gen_ai.agent.name` and `kanthord.agent.name` hold the agent name, for example `swe@1`.
- `error.type` of an `agent.turn` holds the provider failure code. `error.type` of an `agent.tool` holds `tool_error` on an error end. A turn or a tool that the close of the agent trace ends holds `stopped`.
- `kanthord.turn.model_duration_ms` holds `durationMs` of the model reply. Without it, the producer measures the time from the start of the turn to the end of the reply.
- `gen_ai.usage.input_tokens` counts every input token, also the tokens that a cache read or a cache write covers. The two cache attributes count a part of it.
- An attribute that the conventions do not define takes the `kanthord.` prefix, for example `kanthord.usage.cost_usd` and `kanthord.session.entry_id`.
- A span holds no `gen_ai.input.messages`, no `gen_ai.output.messages`, no `gen_ai.tool.call.arguments` and no `gen_ai.tool.call.result`. The session entries hold that content, and a span references them.

## Server spans

A server component writes its span of an execution through `TrackingService.serverSpan(trace, producer, contribution)`.
The call admits the root span, or a span whose parent is the root span. A span elsewhere in the trace fails an assertion.
The call merges the identity attributes of the trace under the attributes of the contribution: `kanthord.execution.id`, `kanthord.node.id`, `kanthord.project.id` and `kanthord.attempt`.
A server component writes the span of an operation that has no execution through `TrackingService.serverTraceSpan(trace, producer, contribution)`.
The trace of that call names its project and its creation time. It names a node and an attempt when the operation concerns one node, and the trace row stores them.
A contribution of either call carries telemetry texts as `texts: [{ text_id, text }]`, and its `text_ids` names them. The admission stores each text with its span in one batch.
Both calls put the contribution into the [write queue](#the-write-path) and return at once. They never wait for the store.
A refused record, a failed batch and a full queue count as a drop and raise no error.
The Scheduler Service writes the root span and the [settlement span](scheduler-service.impl.md#the-execution-trace) with the producer `scheduler`.
The Mission Service writes the span of a [failed upload check](mission-service.impl.md#object-evidence) and the [act trace](mission-service.impl.md#the-act-trace) of each human act on a node with the producer `mission`.

## Primary store

The primary store is a DuckDB database.
It uses its own database file, `tracking.duckdb` of the data directory that [architecture.impl.md](architecture.impl.md) rules, with the write-ahead log `tracking.duckdb.wal`. It never reuses the operational database.
The binding is `@duckdb/node-api` at the exact version `1.5.6-r.2`, with the DuckDB engine `v1.5.6`, under the MIT license.
The prebuilt packages of that version cover `darwin-arm64`, `linux-x64` and `linux-arm64` with glibc, which are the targets of the release.

- The server process opens `tracking.duckdb` once at every start, in its main thread, and runs `trackingMigrations` on it.
- One `DuckDBInstance` of the process owns the file. No module opens a second instance on that path, and no worker thread opens the file.
- DuckDB holds the file lock as a POSIX `fcntl` lock, and the close of any file descriptor of that file in the process releases it. While the store is open, no module of the process opens a file descriptor on `tracking.duckdb` or on `tracking.duckdb.wal`: no copy, no read and no second instance.
- The store keys each open file by the real path of its directory plus its base name, so two spellings of one file meet one guard. `:memory:` takes no key, and each open of it is a separate database.
- A worker thread of the `server` placement, a worker application and a container write telemetry through `tracking.telemetry.write` alone.
- DuckDB locks the file at the open. A second process that opens the file fails, and its start stops with `system.database.initialization_failed`. The message names the path and the DuckDB reason, for example `Could not set lock on file`.
- The instance runs with the settings `threads` `2`, `memory_limit` `1GB` and `temp_directory` set to `tracking.duckdb.tmp` of the data directory. A query above `memory_limit` spills into that directory.
- The store holds three connections: the writer connection, the reader connection and the analytics connection. Each connection runs one statement at a time, in the order of its calls.
- Every write runs on the writer connection. The analytics reads run on the analytics connection, and every other read of an operation runs on the reader connection.
- A read runs its statements in one `BEGIN TRANSACTION READ ONLY` and `COMMIT`, so it sees one snapshot: each batch that committed before the read started.
- The health of the Tracking Service answers from the open state of the store and the state of the write queue. It runs no query.
- The query API of the binding is asynchronous. Every function of the store returns a promise, and a transaction of the writer connection awaits its statements.
- The file holds its own `migration(service, version, applied_at)` table, and its runner follows the runner contract of [architecture.impl.md](architecture.impl.md#the-migration).
- The schema check of that runner compares the `sql` text of each table and each index of the service in `duckdb_tables()` and `duckdb_indexes()` with an in-memory DuckDB database that ran the migrations. The error codes are the codes of the operational store.
- The schema declares no foreign key, no sequence, no view and no partial index. DuckDB supports no `ON DELETE CASCADE` and no partial index.
- `kanthord upgrade` also plans and migrates `tracking.duckdb`, as [upgrade.md](../reference/upgrade.md) states. The backup of a pending migration runs inside the open instance: `ATTACH '<backup path>' AS backup`, `COPY FROM DATABASE <main> TO backup` and `DETACH backup`. The lock stays held, and the backup is a DuckDB file with every table, index and migration row.
- At the stop, the service drains the write queue, runs `CHECKPOINT` and closes the instance, so `tracking.duckdb.wal` holds no record at rest.
- A crash loses each batch that did not commit and each queued record. The next open replays the write-ahead log.
- The server never reads, migrates or deletes a `tracking.db` file of the SQLite store. The [reset procedure](../reference/upgrade.md#reset-a-pre-release-database) names it.
- The schema holds the trace with its summary, the span, the record, the telemetry text and the session entry. [ERD 4](../reference/erd/04-tracking.md) holds the columns.
- A separate database file separates the locking and the retention sweep of telemetry, and it separates no processor, no memory and no disk bandwidth.

## The write path

- The Tracking Service holds one write queue in the server process.
- `serverSpan`, `serverTraceSpan`, `executionOpened` and `executionEnded` put a contribution into the queue. `tracking.telemetry.write` puts its records into the queue and awaits the commit of their batch.
- The writer takes the queue in arrival order. One batch holds at most 2000 records. A batch starts at most 50 ms after its first record enters the queue.
- A batch holds whole write calls and whole server contributions. A write call never splits across two batches, so it commits in one transaction. A write call holds at most 1000 records, so it always fits.
- One transaction of the writer connection admits one batch.
- The admission applies the rules of [ingestion](#ingestion) and of the [trace summary](#trace-summary) to each record of a batch in arrival order. A record sees every earlier record of its batch.
- A batch reads the stored rows of the spans that it names with one query for each trace, and it writes each changed row once.
- `Stored` follows the commit of the batch. The write call answers its acknowledgement after that commit.
- A failed batch rolls back. The writer then runs each item of that batch alone in its own writer transaction, in arrival order. A write call that fails alone answers 500 `gateway.invocation.unknown`, and a server contribution that fails alone counts as a drop. Every other item commits. The next batch runs after that pass.
- The queue holds at most 10000 server contributions. The service drops a server contribution beyond that bound and counts the drop.
- A write call waits for its batch, so the body bound and the timeout of the Gateway bound the waiting write calls.
- The retention sweep runs on the writer connection between two batches.
- `TrackingService.drain()` resolves when the queue is empty and the last batch committed. The stop and the tests await it.

## Local store

The local store of an external harness is an append-only log.
The log records the trace identity and the root span identity of the execution with every capture of that execution.
One writer process owns each log.
The writer writes each record with one write call, and it treats a short write as a failure.
After a failure the writer repairs the tail before it appends again.
The log sets a bound on each record size.
The writer calls `fsync` on a bound of records and a bound of time.
An append is durable after the next `fsync` completes, and it can survive a crash before that.
Newline framing and one writer keep a torn record at the tail of a segment.
They establish no durable prefix, and the bound of the `fsync` establishes it.

## Log framing and segments

A record is newline-framed.
A torn last line does not parse.
One process repairs a log, and that process is the writer.
A reader that meets an unparsable last line reports an incomplete tail, and it repairs nothing.
The repair before an append keeps damage in the tail, so no interior record becomes malformed.
The log is a sequence of segments.
The extension rotates a segment at a bound.
It discards the oldest whole segment when the local bound is reached.
A single segment cannot discard its oldest records.
A rotation syncs the directory of the log, because a new segment name needs durable filesystem metadata.

## Ingestion

An ingestion fixes its endpoint at the last record that the log holds when it starts.
It imports no record after that endpoint.
A segment that the local bound discards removes records before their import.
The ingestion reports such a record as discarded, and never as retained.
A cursor beside the log holds the position of the last acknowledged record.
The extension keeps every record after that position.
The extension updates the cursor after the Tracking Service answers, and a crash before that update repeats a delivery.
A batch carries a bounded record count and a bounded byte count.

## Span persistence

A root span of an execution stays open for hours.
The implementation persists the root span in the first batch after the server opens it, before a child span exists.
It persists the start of a span in the batch of the start record, and the end of a span in the batch of the end record.
A reader reads a span that holds a start and no end.
No reader waits for the root span.

## Session entries

A session entry is a record of the kind `session_entry` in `tracking.telemetry.write` and in an ingestion.

| Field             | Value                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `record_id`       | `<session_id>:entry.<entry_id>`                                                                    |
| `trace_id`        | The trace of the execution                                                                         |
| `kind`            | `session_entry`                                                                                    |
| `session_id`      | The span identity of the `agent.session` span                                                      |
| `entry_id`        | The identity of the entry in its session: 1 to 64 characters of lower-case letters, digits and `-` |
| `parent_entry_id` | The `parentId` of the entry, or `null`                                                             |
| `sequence`        | The position of the entry in the session, from 1                                                   |
| `entry_type`      | The `type` of the entry, for example `message`, `compaction` or `model_change`                     |
| `entry_time`      | The time of the entry in Unix milliseconds                                                         |
| `tool_call_id`    | The `toolCallId` of a tool result message, otherwise `null`                                        |
| `truncated`       | `true` when the producer cut the entry to the entry bound                                          |
| `entry`           | The JSON object of the entry in its session format                                                 |

- A record identity matches `^[0-9a-f]{16}:[a-z][a-z0-9_.-]*$` and holds at most 128 characters. The `-` admits the UUID form of an entry identity.
- The schema refuses a record whose `record_id` differs from `<session_id>:entry.<entry_id>`.
- `tracking_session_entry` holds one row for each entry. Its key is `(trace_id, session_id, entry_id)`, and a unique index covers `(trace_id, session_id, sequence)`. The table is insert-only.
- A repeat of a stored record identity is `Stored` and changes nothing. A new entry at a taken `sequence` is `Refused` with `value_replaced`.
- No foreign key joins an entry to its session span, so an entry can arrive before its span.
- An entry counts toward the record bound of its execution.
- The record bound of 64 KiB applies to an entry record as to every record.
- The producer bounds the canonical JSON of `entry` to 61440 bytes. Above that bound it cuts each string value above 4096 characters, and it sets `truncated`.
- A cut keeps the first half and the last half of the limit around the marker `[cut <n> characters]`. `<n>` counts the removed characters.
- When the entry stays above the bound, the producer cuts again with the limits 1024 and then 256.
- When the entry stays above the bound after the limit 256, the producer sends only `type`, `id`, `parentId` and `timestamp`. It also keeps `role`, `toolCallId`, `toolName`, `isError`, `usage` and `stopReason` of `message`.
- Before the cut, the producer replaces each secret of the LLM credential of the agent with `[redacted]` in every string value of the entry. It matches the exact secret strings only, so an identity, a commit or a tool call identity stays whole.
- `entry_id` and `tool_call_id` come from the entry before the redaction.
- A `pi` entry holds its tool call identity in `toolCallId` of a tool result message. A `claude_code` entry holds `tool_call_id: null`, and a reader finds its tool result through the `tool_use_id` of the content blocks.
- When the session opens, the native producer appends one entry of type `custom` with `customType` `kanthord.pinned_context` for each part of the pinned context. Each part takes its own entry bound.
  The first part holds `{ part: "system_prompt", text }`, the final system prompt of the agent. Each pinned prompt layer follows as `{ part: "layer", index, text }`, with `index` from 1.
  pi writes a `model_change` and a `thinking_level_change` entry at the session open, so these entries follow them.
  The worker injects these texts into each model call and pi persists no entry of them, so these entries are the only record of them.
- pi persists each change of the prompt sections as a message with `role` `system`. Such an entry is a session entry as every other.

## Trace summary

The row of `tracking_trace` holds the summary columns of the trace.

- `node_id` and `attempt` come from the execution of the trace when the row opens. A server trace takes them from the trace of `serverTraceSpan`, or holds null.
- `started_at`, `ended_at`, `state` and `stop_reason` follow the root span. `state` is `open` while the root span holds no end. It is `ok` when the root span ends with `Ok`, and `error` when it ends with `Error`. `stop_reason` holds `kanthord.stop.reason` of the root span.
- `worker_name` holds the first `kanthord.worker.name` that a span of the trace carries.
- `agent_names`, `models` and `error_types` are `VARCHAR[]` lists of the distinct values of `kanthord.agent.name`, of `gen_ai.request.model` and `gen_ai.response.model`, and of `error.type`, in the order of their first admission. Each list holds at most 128 values.
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` and `cost_usd` add up `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens` and `kanthord.usage.cost_usd` of the spans.
- `span_count`, `turn_count` and `tool_count` count the stored spans, the `agent.turn` spans and the `agent.tool` spans.
- `record_count` counts the stored records of the trace. The record bound of an execution reads it.
- `error_count` counts the spans with the status `Error`. `first_error_span_id` names the first span other than the root span that took the status `Error`.
- `position` holds the admission order of the trace row. The writer assigns it from the highest stored `position` plus 1.
- The admission of a batch updates each trace row of the batch once, in the transaction of the batch. It adds only the values that the records add, because no record replaces a value. A repeat changes nothing.
- A read answers `duration_ms` as `ended_at - started_at`, and `total_tokens` as `input_tokens + output_tokens`.
- `kanthord.usage.cost_usd` holds the cost that pi computes from its model price table. The dashboard labels it as an estimate. A subscription credential costs nothing at the provider.

## The span row

`tracking_span` holds one row for each span. It serves the span list, the timeline and the analytics, and no view stands between them.

- A record only adds values to its span row. It fills a column that holds null, or it adds an attribute, an event, a link or a text identity. No record replaces a value, under [producer and ownership](tracking-service.md#producer-and-ownership).
- `tracking_record`, `tracking_telemetry_text` and `tracking_session_entry` are insert-only.
- The insert of a span row copies `project_id`, `node_id`, `execution_id` and `attempt` from its trace row.
- `position` holds the admission order of the first record of the span. The writer assigns it from the highest stored `position` plus 1.
- `duration_ms` holds `end_time - start_time` when the row holds both times, and null otherwise.
- The derived columns below take the value of their attribute when that attribute first appears with its kind. A derived column holds null when its attribute is absent or holds another kind.

| Column                  | Attribute                                  | Kind    |
| ----------------------- | ------------------------------------------ | ------- |
| `agent_name`            | `kanthord.agent.name`                      | string  |
| `request_model`         | `gen_ai.request.model`                     | string  |
| `response_model`        | `gen_ai.response.model`                    | string  |
| `provider_name`         | `gen_ai.provider.name`                     | string  |
| `tool_name`             | `gen_ai.tool.name`                         | string  |
| `worker_name`           | `kanthord.worker.name`                     | string  |
| `error_type`            | `error.type`                               | string  |
| `input_tokens`          | `gen_ai.usage.input_tokens`                | integer |
| `output_tokens`         | `gen_ai.usage.output_tokens`               | integer |
| `cache_read_tokens`     | `gen_ai.usage.cache_read.input_tokens`     | integer |
| `cache_creation_tokens` | `gen_ai.usage.cache_creation.input_tokens` | integer |
| `cost_usd`              | `kanthord.usage.cost_usd`                  | number  |

## Reads

- `tracking.trace.get` answers the trace summary.
- `tracking.trace.list` answers one page of trace summaries, newest first by default. It filters by `project_id`, `node_id`, `execution_id`, `worker_name`, `agent_name`, `model`, `state`, `error_type` and `q`.
  It also filters by a range of `started_at`, and by a minimum and a maximum of `duration_ms`, `total_tokens` and `cost_usd`.
- `q` matches a case-insensitive substring of the trace, execution and node identities.
  It also matches the worker name, an agent name, a model, an error type and the stop reason.
- `sort` takes `started_at`, `duration_ms`, `total_tokens` or `cost_usd`, always in descending order. The cursor holds the sort value and the `position` of the trace row.
- The list scans `tracking_trace`. The retention bounds that table, and no index other than a unique index exists.
- A member filter and a facet read the `VARCHAR[]` lists of the trace row.
- `tracking.facet.get` answers the distinct worker names, agent names, models and error types, at most 200 values each.
  `project_id` limits it to the traces of one project.
- `tracking.span.list` answers the spans of a trace in the order of their admission, by `position` of the span row.
- `tracking.session.entry.list` answers the entries of one session in the order of `sequence`. `tool_call_id` filters it to the result of one tool call.
- `tracking.session.entry.get` answers one entry. An entry that the trace does not hold answers 404 `tracking.entry.not_found`.
- A reader of an open trace reads the span list again and reads the entry list after its last cursor. The dashboard reads every 5 seconds while the trace is `open`.
- A reader renders a span with a parent that the store does not hold at the top level, marked "parent not stored".

## The timeline read

`tracking.timeline.list` answers one ordered history of an execution, a node or a project. It uses `GET /api/tracking/timeline` with `human` access.

- The query holds exactly one scope: `execution_id`, `node_id` or `project_id`. Another count of scopes answers 400 `gateway.request.validation_failed`.
- The scope selects every trace whose row names that execution, that node or that project. The traces of a node hold its executions and the [act traces](mission-service.impl.md#the-act-trace) of its human acts.
- The timeline of a node or a project holds depths 1 and 2 only: the roots, the phases, the evaluation, the settlement and the other direct children of a root. The agent turns, the tool calls, the git steps and the verifications sit deeper, and `tracking.span.list` of one trace answers them.
- `depth` takes `1` or `2`, and it defaults to `2`. Depth 1 answers the root span of each selected trace. Depth 2 also answers each span whose parent is the root span of its trace.
- The timeline time of a span is its `start_time`, else its `end_time`. `started_from` and `started_to` bound the timeline time in Unix milliseconds.
- The order is ascending by timeline time, then by `trace_id`, then by `span_id`. The cursor holds these three values. A cursor of another form answers 400 `system.pagination.cursor_invalid`.
- `limit` takes 1 to 1000 and defaults to 500.
- An item holds the fields of a span of `tracking.span.list`, plus `depth`, `duration_ms`, `project_id`, `node_id`, `execution_id` and `attempt` of the span row. An item of depth 1 also holds `worker_name` of its trace row, and an item of depth 2 holds `worker_name: null`.
- A span of depth 2 appears also when the store holds no row of its root span.
- A reader reads the whole tree of one execution through `tracking.span.list` of its trace.
- The CLI command is `kanthord tracking timeline list` with exactly one of `--execution <execution-id>`, `--node <node-id>` and `--project <project-id>`, plus `--depth`, `--from <unix-ms>`, `--to <unix-ms>`, `--limit` and `--cursor`.

## The analytics reads

The analytics reads add up the measurements of the stored spans. They derive no measurement of an operation. A duration is the difference of the two times that the producer of a span set.

- `tracking.analytics.cost` uses `GET /api/tracking/analytics/cost`, and `tracking.analytics.duration` uses `GET /api/tracking/analytics/duration`. Both have `human` access.
- Both reads select the spans whose `start_time` lies from `started_from` to `started_to`. `started_from` defaults to 7 days before the read, and `started_to` defaults to the time of the read.
- `project_id` and `node_id` filter both reads.
- `bucket` takes `none`, `hour`, `day` or `week`, and it defaults to `day`. A bucket starts on a UTC boundary of its size, and a week starts on Monday at 00:00 UTC. `bucket_start` holds the start in Unix milliseconds, or null for `none`.
- An item holds `key`, the value of the `group_by` column, or null when the span holds no value.
- A read answers at most 1000 items, ordered by `bucket_start`, then by the measure in descending order, then by `key`. `truncated` is `true` when more groups exist.

`tracking.analytics.cost` reads the `agent.turn` spans.

- `group_by` takes `none`, `model`, `agent_name`, `provider_name`, `worker_name`, `node_id` or `project_id`, and it defaults to `model`. `model` is `response_model`, else `request_model`. `none` answers one group with the key null, so `group_by=none&bucket=none` answers the totals of the range in one item.
- An item holds `key`, `bucket_start`, `turn_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `total_tokens` and `cost_usd`. The order measure is `cost_usd`.

`tracking.analytics.duration` reads the percentiles of one measure.

- `measure` is required. It takes one value of this closed set:
  - `span_duration`: `duration_ms` of each span with a start and an end. `operation` filters it.
  - `tool_latency`: `duration_ms` of each `agent.tool` span.
  - `verification_time`: `duration_ms` of each `worker.verification` span.
  - `queue_wait`: `kanthord.queue.wait_ms` of each root span with `kanthord.execution.kind` `steps`.
  - `review_wait`: `kanthord.queue.wait_ms` of each root span with `kanthord.execution.kind` `evaluation`.
  - `revision_turns`: for each node attempt, the count of its `steps` root spans that start after its first `evaluation` root span. The time of the attempt is the start of its first root span.
- `group_by` takes `none`, `operation`, `tool_name`, `agent_name`, `model`, `worker_name`, `node_id` or `project_id`, and it defaults to `none`.
- An item holds `key`, `bucket_start`, `count`, `p50`, `p90`, `p99`, `mean` and `max`. The percentiles are `quantile_cont` of DuckDB. The unit is milliseconds, and a count for `revision_turns`. The order measure is `count`.
- The CLI commands are `kanthord tracking analytics cost` and `kanthord tracking analytics duration`. `--project <project-id>`, `--node <node-id>`, `--from <unix-ms>` and `--to <unix-ms>` set `project_id`, `node_id`, `started_from` and `started_to`, as in `trace list` and `timeline list`. `--bucket`, `--group-by`, `--measure` and `--operation` set the field of their name.

## Retention

- `tracking.retention_days` holds the retention of a trace in days. It defaults to `30`.
- The retention of a trace starts at `created_at` of its row.
- The service runs a sweep at its start and then every hour, on the writer connection between two batches.
- One sweep transaction selects at most 20 rows of `tracking_trace` with `created_at` older than the retention, oldest first. It deletes the rows of `tracking_session_entry`, `tracking_telemetry_text`, `tracking_record` and `tracking_span` that name those traces, then the trace rows. One sweep runs at most 50 transactions.
- The store declares no foreign key and no `ON DELETE CASCADE`, so the sweep deletes the rows of each table itself.
- The table `tracking_telemetry_text` holds no `expired_at`, and its `content` is `NOT NULL`.
- The design answers a reference to a deleted trace as expired. The store keeps no tombstone of a deleted trace, so the read answers `404 tracking.trace.not_found`, the same answer as for an unknown trace.
- `tracking.text.get` answers `{ trace_id, text_id, content, created_at }`.
- `tracking.text.get` checks the trace first. A text of a deleted or unknown trace answers 404 `tracking.trace.not_found`. A text that a held trace does not hold answers 404 `tracking.text.not_found`.
- A late record reuses the predicate of the sweep and needs no tombstone. The time of an execution identity is the time of its ULID. When that time is older than the retention, `tracking.telemetry.write` refuses every record with `trace_expired` and opens no trace row.
- `serverSpan` drops a span of such an execution and counts the drop.

## Configuration

- `tracking.retention_days` holds the retention of a trace in days, as a positive safe integer of at most 3650. It defaults to `30`.

## The native binding in the release

- The npm package lists `@duckdb/node-api` and `@duckdb/node-bindings` as dependencies at one exact version. The loader requires `@duckdb/node-bindings` directly. The package manager installs the platform package of the host.
- The single executable application carries `duckdb.node` and the shared library of its target as SEA assets under `duckdb/`. The shared library is `libduckdb.so` on Linux and `libduckdb.dylib` on macOS.
- The release build bundles the engine with the alias of `@duckdb/node-bindings` to the binding loader of the engine, `src/tracking/duckdb-binding.cjs`.
- Outside a single executable application, the loader requires `@duckdb/node-bindings`.
- Inside a single executable application, the loader writes both assets into `duckdb/<binding version>/` of the state directory before the first open. It checks the SHA-256 of each file against the manifest asset `duckdb/manifest.json` of the build, writes each file through a temporary file and a rename, and loads `duckdb.node` with `process.dlopen`. A file with the right digest stays in place.
- A missing asset or a wrong digest stops the start with `system.tracking.binding_unavailable`, which names the file.
- The container image carries the Linux single executable application, so the image installs no package.

## Ruled values

- RULED 2026-10-22 under the delegation of Ulrich. `EXECUTION_RECORD_LIMIT` is 50000 records for one trace.
- RULED 2026-10-22 under the delegation of Ulrich. The refusal reasons are a closed set in code: `trace_mismatch`, `execution_bound`, `record_too_large`, `self_parent`, `foreign_producer`, `value_replaced`, `text_exists` and `trace_expired`.
- RULED 2026-10-22 under the delegation of Ulrich. The record dispositions are `Stored` and `Refused`.
- RULED 2026-10-22 under the delegation of Ulrich. The producer of the root span is `scheduler`.
- RULED 2026-10-22 under the delegation of Ulrich. The root span ends with `Error` when the execution stops or when the claim is lost, and with `Ok` otherwise.
- RULED 2026-10-22 under the delegation of Ulrich. `tracking.retention_days` defaults to 30. A sweep runs at the start and every hour, with at most 20 rows in each transaction and 50 transactions in one sweep.
- RULED 2026-10-22 under the delegation of Ulrich. The entry bound is 61440 bytes, and the cut limits are 4096, 1024 and 256 characters.
- RULED 2026-10-22 under the delegation of Ulrich. `tracking.facet.get` answers at most 200 values for each facet. The dashboard reads an open trace again every 5 seconds.
- DECIDED 2026-10-24 by Aelita, pending Ulrich. The primary store is DuckDB through `@duckdb/node-api` `1.5.6-r.2` in `tracking.duckdb`. The store keeps no data of `tracking.db`, and the reset procedure replaces it.
- DECIDED 2026-10-24 by Aelita, pending Ulrich. The instance runs with `threads` 2, `memory_limit` `1GB` and `temp_directory` `tracking.duckdb.tmp`, with one writer connection, one reader connection and one analytics connection.
- DECIDED 2026-10-24 by Aelita, pending Ulrich. A batch holds at most 2000 records and starts at most 50 ms after its first record. The queue holds at most 10000 server contributions.
- DECIDED 2026-10-24 by Aelita, pending Ulrich. `tracking_span` is the summary table of the span, and no view serves a read. A span row only gains values.
- DECIDED 2026-10-24 by Aelita, pending Ulrich. The timeline read answers depth 1 or 2 across traces, at most 1000 items, 500 by default. The analytics reads answer at most 1000 items, over 7 days by default, in UTC buckets.

## Capture and packaging

The capture points are the hooks of Claude Code.
At `Stop`, `StopFailure` and `SessionEnd`, the extension appends the new entries of the file at `transcript_path` as session entries of the format `claude_code`.
The `uuid` of a transcript entry is its `entry_id`, and its `parentUuid` is its `parent_entry_id`.
The kanthord extension of Claude Code owns the capture, the local store and the ingestion.
A human authenticates the call of an ingestion, and the client identity of the extension authorizes no ingestion.
Their packaging is an epic decision.

## Claude Code hooks

The kanthord extension of Claude Code obeys these rules when it registers and runs its hooks:

- The extension registers only the hook events that the installed Claude Code version knows. The settings loader of Claude Code rejects an event that is newer than the running version.
- The extension registers `SessionStart`. A resumed or an idle session sends no other event before its first prompt.
- A turn ends at `Stop` or at `StopFailure`. After an API error or a model error, Claude Code sends `StopFailure` and no `Stop`.
- A manual `/compact` ends at `PostCompact`, because it sends no `Stop`.
- The extension registers no `PreCompact`. An aborted compact sends `PreCompact` and no other compact event.
- `SubagentStart`, `SubagentStop` and `TeammateIdle` record each child agent. A child agent can run after the turn of the lead agent ends, and the execution stays active until the last child ends.
- Each hook writes the JSON object `{}` as its output. A permission hook with an empty output fails closed.
- A hook that runs with `CLAUDE_JOB_DIR` set captures nothing. A background session inherits the environment of the session that started it, so its capture identifies the wrong execution.
