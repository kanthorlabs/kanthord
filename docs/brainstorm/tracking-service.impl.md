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
The trace of that call names its project and its creation time.
It names a node and an attempt when the operation concerns one node, and the trace row stores them.
A contribution of either call carries telemetry texts as `texts: [{ text_id, text }]`, and its `text_ids` names them.
Each call admits its span and its texts in one transaction of the store before it returns.
A text identity that the trace holds already refuses the whole contribution with `text_exists`.
A refused or failed write counts as a drop and raises no error.
The Scheduler Service writes the root span and the [transition span](scheduler-service.impl.md#the-execution-trace) with the producer `scheduler`.
The Mission Service writes the span of a [failed upload check](mission-service.impl.md#object-evidence) with the producer `mission`.
It writes the [act trace](mission-service.impl.md#the-act-trace) of each human act on a node with the same producer.
The Worker Service writes the [`agent.prompt` span](worker-service.impl.md#prompt-composition) with the producer `worker`.
The Tracking Service writes the [cause label span](#the-cause) with the producer `tracking`.
The Project Service writes the [environment trace](project-service.impl.md#the-environment-trace) with the producer `project`.

## Primary store

The primary store is a SQLite database.
It uses its own database file, `tracking.db` of the data directory that [architecture.impl.md](architecture.impl.md) rules, and it never reuses the operational database.
`node:sqlite` `DatabaseSync` opens that file in WAL mode, and the file holds its own migration record.
The server opens that file at every start and runs `trackingMigrations` on it.
Its migration record follows the runner contract of [architecture.impl.md](architecture.impl.md).
`kanthord upgrade` also plans and migrates `tracking.db`, as [upgrade.md](../reference/upgrade.md) states.
The schema holds the trace with its summary, the span, the record, the telemetry text and the session entry.
The span row holds no copy of a column of its trace row and no column that an attribute derives.
A read joins the trace row and reads the attributes of the span.
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
A span with no end under a root span with an end is a span with no end recorded.
A reader shows no duration for it.
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
- The producer bounds the canonical JSON of `entry` to 61440 bytes. Above that bound it cuts each string value above 4096 characters, and it sets `truncated`.
- A cut keeps the first half and the last half of the limit around the marker `[cut <n> characters]`. `<n>` counts the removed characters.
- When the entry stays above the bound, the producer cuts again with the limits 1024 and then 256.
- When the entry stays above the bound after the limit 256, the producer sends only `type`, `id`, `parentId` and `timestamp`. It also keeps `role`, `toolCallId`, `toolName`, `isError`, `usage` and `stopReason` of `message`.
- Before the cut, the producer replaces each secret of the LLM credential of the agent with `[redacted]` in every string value of the entry. It matches the exact secret strings only, so an identity, a commit or a tool call identity stays whole.
- `entry_id` and `tool_call_id` come from the entry before the redaction.
- A `pi` entry holds its tool call identity in `toolCallId` of a tool result message. A `claude_code` entry holds `tool_call_id: null`, and a reader finds its tool result through the `tool_use_id` of the content blocks.
- When the session opens, the native producer appends one entry of type `custom` with `customType` `kanthord.pinned_context` for the final system prompt. The entry takes its own entry bound.
  The entry holds `{ part: "system_prompt", text }`, the final system prompt of the agent.
  pi writes a `model_change` and a `thinking_level_change` entry at the session open, so this entry follows them.
  The worker injects this text into each model call and pi persists no entry of it, so this entry is the only record of it.
- pi persists each change of the prompt sections as a message with `role` `system`. Such an entry is a session entry as every other.

## Trace summary

The row of `tracking_trace` holds the summary columns of the trace.

- `node_id` and `attempt` come from the execution of the trace when the row opens. A server trace takes them from the trace of `serverTraceSpan`, or holds null.
- `started_at`, `ended_at`, `state` and `stop_reason` follow the root span. `state` is `open` while the root span holds no end. It is `ok` when the root span ends with `Ok`, and `error` when it ends with `Error`. `stop_reason` holds `kanthord.stop.reason` of the root span.
- `worker_name` holds the first `kanthord.worker.name` that a span of the trace carries.
- `agent_names`, `models` and `error_types` are JSON arrays of the distinct values of `kanthord.agent.name`, of `gen_ai.request.model` and `gen_ai.response.model`, and of `error.type`. Each array holds at most 128 values.
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` and `cost_usd` add up `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens` and `kanthord.usage.cost_usd` of the spans.
- `span_count`, `turn_count` and `tool_count` count the stored spans, the `agent.turn` spans and the `agent.tool` spans.
- `error_count` counts the spans with the status `Error`. `first_error_span_id` names the first span other than the root span that took the status `Error` and holds no `error.type` `tool_error` or `stopped`.
- The admission of a span updates the summary in the same transaction. It adds only the values that the record adds, because no record replaces a value. A repeat changes nothing.
- A read answers `duration_ms` as `ended_at - started_at`, and `total_tokens` as `input_tokens + output_tokens`.
- `kanthord.usage.cost_usd` holds the cost that pi computes from its model price table. The dashboard labels it as an estimate. A subscription credential costs nothing at the provider.

## The cause

The cause names the layer that caused a failure event. The Worker Service owns the [cause rule table](worker-service.impl.md#the-cause-of-a-stop), and the Scheduler Service passes the cause to the root span end.

- The root span end holds `kanthord.cause.category`, `kanthord.cause.subcategory` and `kanthord.cause.assigner`. The [assigner](tracking-service.vocabulary.md#cause) is `rule` or `reviewer`. The effective cause of a label holds the assigner `human`.
- A cause of the category `unattributed` holds `kanthord.cause.suspects` instead of a subcategory: the candidate categories, the best guess first.
- The Tracking Service stores these attributes as it receives them. It derives no cause, and it holds no cause column. The schema of `tracking.db` stays unchanged.
- `tracking.cause.label` uses `POST /api/tracking/trace/:trace_id/cause/label` with `human` access. It is a mutation, and it requires an idempotency key.
- The body is `{ category, subcategory, reason }`. `reason` is a nonblank text. The CLI command is `kanthord tracking cause label <trace-id> --category <category> --subcategory <subcategory> --reason <text>`.
- The route schema validates `category` against the enum of the [vocabulary](tracking-service.vocabulary.md#cause-category), without `unattributed`. A failure answers 400 `gateway.request.validation_failed`.
- The operation answers these errors:
  - 404 `tracking.trace.not_found` for an unknown or deleted trace;
  - 409 `tracking.cause.trace_open` for a trace whose state is `open`;
  - 400 `tracking.cause.subcategory_mismatch` for a subcategory outside the set of its category.
- The local CLI errors are `cli.tracking.cause.label.invalid_trace_id`, `cli.tracking.cause.label.invalid_input`, `cli.tracking.cause.label.token_required` and `cli.tracking.cause.label.indeterminate`.
- The operation writes one span `tracking.cause_label` under the root span, with the span identity `<root_span_id>.cause_label` and the producer `tracking`.
- The label span holds `kanthord.cause.category`, `kanthord.cause.subcategory`, `kanthord.human.username`, the `sub` of the `human` token, and the telemetry text `reason`.
- `tracking.cause.label` writes the label span outside the admission of `serverSpan`. It is the only span that the store replaces, and its identity is the only span identity outside the trace model format. The replacement changes no column of `tracking_trace`.
- The operation replaces the span row and the `reason` text in one transaction of the store. A new label replaces the old attributes and the old text.
- The effective cause of a trace is the cause of the label span when the store holds one, else the cause of the root span end.
- Every reader of a cause takes the effective cause: the list filter, the list item, the facet, the rollups and the trace page.
- A reader reads the label span and the root span through the primary key of `tracking_span`.

## Reads

- `tracking.trace.get` answers the trace summary.
- `tracking.trace.list` answers one page of trace summaries, newest first by default.
- Each item of `tracking.trace.list` also holds `root_operation` and `root_attributes`: the `operation` and the `attributes` of the root span.
  Both are null while the store holds no root span. The list reads the root span through the primary key of `tracking_span`.
- Each item of `tracking.trace.list` also holds `cause`: the effective cause as `{ category, subcategory, assigner, suspects }`, or null when the trace holds none. The list joins the label span through the primary key, as the filter does.
- `tracking.trace.list` filters by `project_id`, `node_id`, `execution_id`, `worker_name`, `agent_name`, `model`, `state`, `error_type`, `cause_category` and `q`.
  `cause_category` selects the traces whose [effective cause](#the-cause) holds that category. The filter reads the label span, else the root span, of each scanned trace through the primary key of `tracking_span`.
- `tracking.trace.list` also filters by the time range `from` and `to`, by [the overlap rule](#the-timeline-read) of the timeline read.
- Every time range filter of the Tracking Service is named `from` and `to`, and it selects the traces by that overlap rule.
- A `from` after `to` answers 400 `tracking.filter.range_invalid` on every read that takes `from` and `to`.
- `tracking.trace.list` also filters by a minimum and a maximum of `duration_ms`, `total_tokens` and `cost_usd`.
  A trace with no `duration_ms` fails `min_duration_ms` and `max_duration_ms`.
- `q` matches a case-insensitive substring of the trace, execution and node identities.
  It also matches the worker name, an agent name, a model, an error type and the stop reason.
- `sort` takes `started_at`, `duration_ms`, `total_tokens` or `cost_usd`, always in descending order. The cursor holds the sort value and the row position.
- Equal sort values follow the creation order of the trace in descending order. Under `started_at`, a trace with no start sorts by its creation time.
- An open trace sorts last under `duration_ms`.
- A cursor of another sort answers 400 `system.pagination.cursor_invalid`.
- The list scans `tracking_trace`. The retention bounds that table, and no index other than a unique index exists.
- `tracking.facet.get` answers the distinct worker names, agent names, models, error types and `cause_categories`, at most 200 values each.
  `cause_categories` holds the categories of the effective causes.
  `project_id` limits it to the traces of one project.
- `tracking.span.list` answers the spans of a trace in the order of their admission.
- `tracking.session.entry.list` answers the entries of one session in the order of `sequence`. `tool_call_id` filters it to the result of one tool call.
- `limit` takes 1 to 1000. It defaults to 100 for `tracking.trace.list` and `tracking.session.entry.list`, and to 500 for `tracking.span.list`.
- `tracking.session.entry.get` answers one entry. An entry that the trace does not hold answers 404 `tracking.entry.not_found`.
- A reader of an open trace reads the span list again and reads the entry list after its last cursor. The dashboard reads every 5 seconds while the trace is `open`.
- A reader renders a span with a parent that the store does not hold at the top level, marked "parent not stored".

## The timeline read

`tracking.timeline.list` answers one ordered history of an execution, a node or a project. It uses `GET /api/tracking/timeline` with `human` access.

- The query holds exactly one scope: `execution_id`, `node_id` or `project_id`. Another count of scopes answers 400 `gateway.request.validation_failed`.
- The scope selects every trace whose row names that execution, that node or that project.
- The traces of a node hold its executions and the [act traces](mission-service.impl.md#the-act-trace) of its human acts.
- The start of a trace is `started_at` of its row, else `created_at`. The window of a trace runs from its start to `ended_at`, or stays open with no `ended_at`.
- `from` and `to` bound the range of the read in Unix milliseconds. The read selects each trace whose window overlaps the range.
- A trace overlaps the range when it starts at or before `to`, and it ends at or after `from` or holds no `ended_at`. A missing bound leaves that side open.
- `depth` takes `1` or `2`, and it defaults to `2`. Depth 1 answers the root span of each selected trace.
- Depth 2 also answers each span whose parent is the root span of its trace.
- A depth-2 span is in the answer also when the store holds no row of its root span.
- The timeline of a node or a project holds depths 1 and 2 only.
- These depths hold the roots, the phases, the evaluation, the transition and the other direct children of a root.
- The agent turns, the tool calls, the git steps and the verifications sit deeper. `tracking.span.list` of one trace answers them.
- The order is ascending by the start of the trace, then by `trace_id`.
- Inside one trace, the order is ascending by the timeline time of the span, then by `span_id`. The timeline time of a span is its `start_time`, else its `end_time`.
- `limit` takes 1 to 1000 and defaults to 500.
- An item holds the fields of a span of `tracking.span.list`, plus `depth` and `duration_ms`. `duration_ms` is `end_time - start_time`, or null when the span holds no start or no end.
- An item also holds `project_id`, `node_id`, `execution_id` and `attempt` of its trace row.
- An item of depth 1 holds `worker_name` of its trace row, and an item of depth 2 holds `worker_name: null`.
- The read runs one statement in one read transaction:
  1. It scans `tracking_trace` for the scope, the window and the cursor, as the trace list does. An `execution_id` scope reads the unique index `tracking_trace_execution`.
  2. It keeps at most `limit + 1` traces whose end comes after the cursor, in the order above.
  3. It reads the root span of each kept trace through the primary key of `tracking_span`.
  4. At depth 2, it reads the spans of each kept trace through the primary key of `tracking_span` with its `trace_id`. It keeps each span whose parent is the root span.
  5. It adds one end row for each kept trace, after the items of that trace.
  6. It orders the items and the end rows, and it answers at most `2 * limit + 2` rows.
- The page and its cursor follow the counts of the statement:
  - With more than `limit` items, the page holds the first `limit` items. `next_cursor` names the last item of the page.
  - With at most `limit` items and more than `limit` end rows, the page holds every item. `next_cursor` names the last end row.
  - Otherwise the page holds every item, and `next_cursor` is null.
- `next_cursor` holds 4 values as base64url JSON: the start of a trace, its `trace_id`, a timeline time and a `span_id`.
- The cursor of an item holds the values of that item. The cursor of a trace end holds the timeline time `9007199254740991` and the `span_id` `""`.
- A page can hold fewer than `limit` items, or no item, and still hold a `next_cursor`. A reader reads on until `next_cursor` is null.
- A cursor of another form answers 400 `system.pagination.cursor_invalid`.
- The CLI command is `kanthord tracking timeline list`. It takes exactly one of `--execution <execution-id>`, `--node <node-id>` and `--project <project-id>`.
- It also takes `--depth`, `--from <unix-ms>`, `--to <unix-ms>`, `--limit` and `--cursor`. `--from` and `--to` set `from` and `to`.

## The analytics reads

The analytics reads add up the measurements of the stored spans. They derive no measurement of an operation. A duration is the difference of the two times that the producer of a span set.

- `tracking.analytics.cost` uses `GET /api/tracking/analytics/cost`, and `tracking.analytics.duration` uses `GET /api/tracking/analytics/duration`. Both have `human` access.
- `to` defaults to the time of the read. `from` defaults to 7 days before `to`.
- A range of more than 31 days answers 400 `tracking.filter.range_invalid`. A `from` after `to` answers the same code.
- The range check applies the default of a missing `from` or `to` first.
- The read selects the traces whose window overlaps the range, by the rule of [the timeline read](#the-timeline-read). `project_id` and `node_id` filter the selected traces.
- The read counts each span of a selected trace whose `start_time` lies from `from` to `to`, both inclusive.
- The read takes the identities of the selected traces in one read transaction.
- It then reads their spans in steps of at most 100 traces, through the primary key of `tracking_span`.
- Each step runs in its own read transaction.
- The service yields to the event loop between two steps. A write that commits between two steps can show in a later step.
- A cancelled request stops the read between two steps.
- The service builds the groups and the percentiles in memory from the span rows and their trace rows.
- `bucket` takes `none`, `hour`, `day` or `week`. It defaults to `day` for the cost read and to `none` for the duration read.
- A bucket starts on a UTC boundary of its size, and a week starts on Monday at 00:00 UTC. A span counts in the bucket of its `start_time`.
- `bucket_start` holds the start of the bucket in Unix milliseconds, or null for `none`.
- `worker_name`, `node_id` and `project_id` come from the trace row, and `operation` comes from the span row.
- `worker_instance` is `kanthord.worker.instance` of the root span. The read reads the root span through the primary key of `tracking_span`.
- `agent_name` is `kanthord.agent.name`, `provider_name` is `gen_ai.provider.name` and `tool_name` is `gen_ai.tool.name`. `model` is `gen_ai.response.model`, else `gen_ai.request.model`.
- An item holds `key`, the value of the `group_by` field, or null when the span holds no value. An attribute that holds no string counts as no value.
- A read answers at most 1000 items. The order is by `bucket_start`, then by the order measure in descending order, then by `key` with null last.
- `truncated` is `true` when more items exist.

`tracking.analytics.cost` reads the `agent.turn` spans.

- `group_by` takes `none`, `model`, `agent_name`, `provider_name`, `worker_name`, `node_id` or `project_id`, and it defaults to `model`.
- `none` answers one group with the key null. `group_by=none&bucket=none` answers the totals of the range in one item.
- An item holds `key`, `bucket_start`, `turn_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `total_tokens` and `cost_usd`.
- A token or cost attribute that holds no finite number adds 0. The order measure is `cost_usd`.

`tracking.analytics.duration` reads the percentiles of one measure.

- `measure` is required. It takes one value of this closed set:
  - `span_duration`: `end_time - start_time` of each span with a start and an end. `operation` filters it.
  - `tool_latency`: `end_time - start_time` of each `agent.tool` span.
  - `verification_time`: `end_time - start_time` of each `worker.verification` span.
  - `queue_wait`: `kanthord.queue.wait_ms` of each root span with `kanthord.execution.kind` `steps`.
  - `review_wait`: `kanthord.queue.wait_ms` of each root span with `kanthord.execution.kind` `evaluation`.
  - `revision_turns`: one value for each node attempt with a `scheduler.execution` root span in the range.
  - `instance_busy_ratio`: the sum of `duration_ms` of the root spans in the range for one `kanthord.worker.instance`, divided by the length of the range in milliseconds.
- Every measure other than `span_duration` ignores `operation`.
- `instance_busy_ratio` takes the `group_by` value `worker_instance` only. Another `group_by` with `instance_busy_ratio` answers 400 `gateway.request.validation_failed`.
- The `key` of an `instance_busy_ratio` item is the instance name. Its item holds `key`, `bucket_start`, `count` (the root spans) and `ratio`, and no percentile.
- An open root span adds nothing. A root span that starts inside the range adds its time up to the end of the range or of its bucket. With a `bucket`, the length of the bucket replaces the length of the range.
- The value of `revision_turns` is the count of the `scheduler.transition` spans of the attempt from `Evaluating` to `Available` in the range.
- The range cuts an attempt: a transition outside the range does not count.
- The start of the first root span of the attempt in the range sets its bucket. The trace row of that root span sets its group fields.
- `group_by` takes `none`, `operation`, `tool_name`, `agent_name`, `model`, `worker_name`, `node_id` or `project_id`, and it defaults to `none`. `worker_instance` is a value for `instance_busy_ratio` only.
- Every measure other than `instance_busy_ratio` answers an item with `key`, `bucket_start`, `count`, `p50`, `p90`, `p99`, `mean` and `max`. The unit is milliseconds, and a count for `revision_turns`. The order measure is `count`.
- A percentile `p` of `n` sorted values `x[0]` to `x[n - 1]` is `x[k] + (h - k) * (x[k + 1] - x[k])`.
- In that formula, `h = (n - 1) * p` and `k` is the integer part of `h`. The percentile is `x[n - 1]` when `k` is `n - 1`.
- The CLI commands are `kanthord tracking analytics cost` and `kanthord tracking analytics duration`.
- `--project <project-id>` and `--node <node-id>` set `project_id` and `node_id`. `--from <unix-ms>` and `--to <unix-ms>` set `from` and `to`.
- `--bucket`, `--group-by`, `--measure` and `--operation` set the field of their name.

## Retention

- `tracking.retention_days` holds the retention of a trace in days. It defaults to `30`.
- The retention of a trace starts at `created_at` of its row.
- The service runs a sweep at its start and then every hour.
- A sweep deletes the rows of `tracking_trace` with `created_at` older than the retention, at most 20 rows in each transaction. One sweep runs at most 50 transactions. `ON DELETE CASCADE` deletes their spans, records, telemetry texts and session entries.
- The table `tracking_telemetry_text` holds no `expired_at`, and its `content` is `NOT NULL`.
- The design answers a reference to a deleted trace as expired. The store keeps no tombstone of a deleted trace, so the read answers `404 tracking.trace.not_found`, the same answer as for an unknown trace.
- `tracking.text.get` answers `{ trace_id, text_id, content, created_at }`.
- `tracking.text.get` checks the trace first. A text of a deleted or unknown trace answers 404 `tracking.trace.not_found`. A text that a held trace does not hold answers 404 `tracking.text.not_found`.
- A late record reuses the predicate of the sweep and needs no tombstone. The time of an execution identity is the time of its ULID. When that time is older than the retention, `tracking.telemetry.write` refuses every record with `trace_expired` and opens no trace row.
- `serverSpan` drops a span of such an execution and counts the drop.
- `serverTraceSpan` drops a span when `created_at` of its trace is older than the retention, and counts the drop.

## Configuration

- `tracking.retention_days` holds the retention of a trace in days, as a positive safe integer of at most 3650. It defaults to `30`.

## Ruled values

- RULED 2026-10-22 under the delegation of Ulrich. `EXECUTION_RECORD_LIMIT` is 50000 records for one trace.
- RULED 2026-10-22 under the delegation of Ulrich. The refusal reasons are a closed set in code: `trace_mismatch`, `execution_bound`, `record_too_large`, `self_parent`, `foreign_producer`, `value_replaced`, `text_exists` and `trace_expired`.
- RULED 2026-10-22 under the delegation of Ulrich. The record dispositions are `Stored` and `Refused`.
- RULED 2026-10-22 under the delegation of Ulrich. The producer of the root span is `scheduler`.
- RULED 2026-10-22 under the delegation of Ulrich. The root span ends with `Error` when the execution stops or when the claim is lost, and with `Ok` otherwise.
- RULED 2026-10-22 under the delegation of Ulrich. `tracking.retention_days` defaults to 30. A sweep runs at the start and every hour, with at most 20 rows in each transaction and 50 transactions in one sweep.
- RULED 2026-10-22 under the delegation of Ulrich. The entry bound is 61440 bytes, and the cut limits are 4096, 1024 and 256 characters.
- RULED 2026-10-22 under the delegation of Ulrich. `tracking.facet.get` answers at most 200 values for each facet. The dashboard reads an open trace again every 5 seconds.
- RULED 2026-10-25 by Ulrich. The timeline read answers depth 1 or 2 across traces in the order of the trace start, at most 1000 items, 500 by default.
- RULED 2026-10-25 by Ulrich. The analytics reads select the traces whose window overlaps the range, count only the spans that start inside it, and read their spans in steps of at most 100 traces.
- RULED 2026-10-25 by Ulrich. The analytics reads answer at most 1000 items, and they take a range of 7 days by default and 31 days at most.
- RULED 2026-10-25 by Ulrich. The schema of `tracking.db` stays unchanged. The span row holds no column for a read, and the store adds no index for the timeline or the analytics.
- RULED 2026-10-25 by Ulrich. The cause lives only as `kanthord.cause.*` on the root span end. The Tracking Service derives no cause and adds no cause column. `tracking.trace.list` filters by `cause_category`, and `tracking.facet.get` answers `cause_categories`.
- RULED 2026-10-25 by Ulrich. `tracking.cause.label` writes the span `tracking.cause_label` with the span identity `<root_span_id>.cause_label`. A new label replaces the old one, and every reader takes the label over the rule cause.
- RULED 2026-10-25 by Ulrich. The producer records each fact, and an analytics read only adds up and divides. `instance_busy_ratio` sums the root `duration_ms` per `kanthord.worker.instance`.

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
