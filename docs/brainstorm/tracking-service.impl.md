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
The server stores spans in `tracking.db` at every start.
The implementation reuses attribute names that the semantic conventions define.
A kanthord identity takes the `kanthord.` prefix.
A trace identity is 16 random bytes and a span identity is 8 random bytes, each written as lower-case hexadecimal under the W3C Trace Context representation, and the all-zero value is invalid.

## GenAI mapping

The agent spans follow the [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai).
A kanthord operation name stays the span operation, and `gen_ai.operation.name` maps it to the GenAI operation.

| Span operation  | `gen_ai.operation.name` | GenAI attributes                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent.session` | `invoke_agent`          | `gen_ai.conversation.id`, `gen_ai.request.model`                                                                                                                                                                                                                                                 |
| `agent.turn`    | `chat`                  | `gen_ai.conversation.id`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.provider.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`, `gen_ai.response.finish_reasons`, `error.type` |
| `agent.tool`    | `execute_tool`          | `gen_ai.conversation.id`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `error.type`                                                                                                                                                                                                                |

- `gen_ai.conversation.id` holds the session identity, which is the span identity of the `agent.session` span.
- `gen_ai.request.model` holds the model of the agent configuration. `gen_ai.response.model` holds the model that the provider names in its reply.
- `gen_ai.usage.input_tokens` counts every input token, also the tokens that a cache read or a cache write covers. The two cache attributes count a part of it.
- An attribute that the conventions do not define takes the `kanthord.` prefix, for example `kanthord.usage.cost_usd` and `kanthord.session.entry_id`.
- A span holds no `gen_ai.input.messages`, no `gen_ai.output.messages`, no `gen_ai.tool.call.arguments` and no `gen_ai.tool.call.result`. The session entries hold that content, and a span references them.

## Server spans

A server component writes its span of an execution through `TrackingService.serverSpan(trace, producer, contribution)`.
The call admits the root span, or a span whose parent is the root span. A span elsewhere in the trace fails an assertion.
The call merges the identity attributes of the trace under the attributes of the contribution: `kanthord.execution.id`, `kanthord.node.id`, `kanthord.project.id` and `kanthord.attempt`.
A refused or failed write counts as a drop and raises no error.
The Scheduler Service writes the root span with the producer `scheduler`.
The Mission Service writes the span of a [failed upload check](mission-service.impl.md#object-evidence) with the producer `mission`.

## Primary store

The primary store is a SQLite database.
It uses its own database file, `tracking.db` of the data directory that [architecture.impl.md](architecture.impl.md) rules, and it never reuses the operational database.
`node:sqlite` `DatabaseSync` opens that file in WAL mode, and the file holds its own migration record.
The server opens that file at every start and runs `trackingMigrations` on it.
Its migration record follows the runner contract of [architecture.impl.md](architecture.impl.md).
`kanthord upgrade` also plans and migrates `tracking.db`, as [upgrade.md](../reference/upgrade.md) states.
The schema holds the trace with its summary, the span, the record, the telemetry text and the session entry.
A bulk import runs in bounded transactions, so a concurrent write of the server never waits for a whole import.
The retention sweep deletes in bounded batches for the same reason.
A separate database file separates the locking and the retention sweep of telemetry, and it separates no processor, no memory and no disk bandwidth.

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
The implementation persists the root span when the server opens it, before a child span exists.
It persists the start of a span when the start arrives, and the end of a span when the end arrives.
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
- `tracking_session_entry` holds one row for each entry. Its key is `(trace_id, session_id, entry_id)`, and a unique index covers `(trace_id, session_id, sequence)`.
- A repeat of a stored record identity is `Stored` and changes nothing. A new entry at a taken `sequence` is `Refused` with `value_replaced`.
- No foreign key joins an entry to its session span, so an entry can arrive before its span.
- An entry counts toward the record bound of its execution.
- The record bound of 64 KiB applies to an entry record as to every record.
- The producer bounds the canonical JSON of `entry` to 61440 bytes. Above that bound it cuts every string value of the entry to its first 4096 characters and sets `truncated`.
- When the cut entry stays above the bound, the producer sends only `type`, `id`, `parentId` and `timestamp`, and it sets `truncated`.
- Before the cut, the producer replaces each secret of the execution credentials with `[redacted]` in every string value of the entry.

## Trace summary

The row of `tracking_trace` holds the summary columns of the trace.

- `node_id` and `attempt` come from the execution of the trace when the row opens.
- `started_at`, `ended_at`, `state` and `stop_reason` follow the root span. `state` is `open` while the root span holds no end. It is `ok` when the root span ends with `Ok`, and `error` when it ends with `Error`. `stop_reason` holds `kanthord.stop.reason` of the root span.
- `worker_name` holds the first `kanthord.worker.name` that a span of the trace carries.
- `agent_names`, `models` and `error_types` are JSON arrays of the distinct values of `kanthord.agent.name`, of `gen_ai.request.model` and `gen_ai.response.model`, and of `error.type`. Each array holds at most 128 values.
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` and `cost_usd` add up `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens` and `kanthord.usage.cost_usd` of the spans.
- `span_count`, `turn_count` and `tool_count` count the stored spans, the `agent.turn` spans and the `agent.tool` spans.
- `error_count` counts the spans with the status `Error`. `first_error_span_id` names the first span other than the root span that took the status `Error`.
- The admission of a span updates the summary in the same transaction. It adds only the values that the record adds, because no record replaces a value. A repeat changes nothing.
- A read answers `duration_ms` as `ended_at - started_at`, and `total_tokens` as `input_tokens + output_tokens`.
- `kanthord.usage.cost_usd` holds the cost that pi computes from its model price table. The dashboard labels it as an estimate. A subscription credential costs nothing at the provider.

## Reads

- `tracking.trace.get` answers the trace summary.
- `tracking.trace.list` answers one page of trace summaries, newest first by default. It filters by `project_id`, `node_id`, `execution_id`, `worker_name`, `agent_name`, `model`, `state`, `error_type` and `q`.
  It also filters by a range of `started_at`, and by a minimum and a maximum of `duration_ms`, `total_tokens` and `cost_usd`.
- `q` matches a case-insensitive substring of the trace, execution and node identities.
  It also matches the worker name, an agent name, a model, an error type and the stop reason.
- `sort` takes `started_at`, `duration_ms`, `total_tokens` or `cost_usd`, always in descending order. The cursor holds the sort value and the row position.
- The list scans `tracking_trace`. The retention bounds that table, and no index other than a unique index exists.
- `tracking.facet.get` answers the distinct worker names, agent names, models and error types, at most 200 values each.
  `project_id` limits it to the traces of one project.
- `tracking.span.list` answers the spans of a trace in the order of their admission.
- `tracking.session.entry.list` answers the entries of one session in the order of `sequence`. `tool_call_id` filters it to the result of one tool call.
- `tracking.session.entry.get` answers one entry. An entry that the trace does not hold answers 404 `tracking.entry.not_found`.
- A reader of an open trace reads the span list again and reads the entry list after its last cursor. The dashboard reads every 5 seconds while the trace is `open`.
- A reader renders a span with a parent that the store does not hold at the top level, marked "parent not stored".

## Retention

- `tracking.retention_days` holds the retention of a trace in days. It defaults to `30`.
- The retention of a trace starts at `created_at` of its row.
- The service runs a sweep at its start and then every hour.
- A sweep deletes the rows of `tracking_trace` with `created_at` older than the retention, at most 20 rows in each transaction. `ON DELETE CASCADE` deletes their spans, records, telemetry texts and session entries.
- The table `tracking_telemetry_text` holds no `expired_at`, and its `content` is `NOT NULL`.
- The design answers a reference to a deleted trace as expired. The store keeps no tombstone of a deleted trace, so the read answers `404 tracking.trace.not_found`, the same answer as for an unknown trace.
- `tracking.text.get` answers `{ trace_id, text_id, content, created_at }`.
- `tracking.text.get` checks the trace first. A text of a deleted or unknown trace answers 404 `tracking.trace.not_found`. A text that a held trace does not hold answers 404 `tracking.text.not_found`.
- A late record reuses the predicate of the sweep and needs no tombstone. The time of an execution identity is the time of its ULID. When that time is older than the retention, `tracking.telemetry.write` refuses every record with `trace_expired` and opens no trace row.
- `serverSpan` drops a span of such an execution and counts the drop.

## Configuration

- `tracking.retention_days` holds the retention of a trace in days, as a positive safe integer of at most 3650. It defaults to `30`.

## Ruled values

- `EXECUTION_RECORD_LIMIT` is 50000 records for one trace. A `coder@1` execution of 200 turns writes about 3000 records with its session entries.
- The refusal reasons are a closed set in code: `trace_mismatch`, `execution_bound`, `record_too_large`, `self_parent`, `foreign_producer`, `value_replaced`, `text_exists` and `trace_expired`.
- The record dispositions are `Stored` and `Refused`.
- The producer of the root span is `scheduler`.
- The root span ends with `Error` when the execution stops or when the claim is lost, and with `Ok` otherwise.

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
