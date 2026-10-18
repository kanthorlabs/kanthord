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
The schema holds the span and the telemetry text.
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

## Expiry

The trace is the only unit of retention.
A delete of a trace row deletes its spans, its records and its telemetry texts through `ON DELETE CASCADE`.
The table `tracking_telemetry_text` holds no `expired_at`, and its `content` is `NOT NULL`.
The design answers a reference to a deleted trace as expired. Today the store keeps no tombstone of a deleted trace, so the read answers `404 tracking.trace.not_found`, the same answer as for an unknown trace.
`tracking.text.get` answers `{ trace_id, text_id, content, created_at }`.
`tracking.text.get` checks the trace first. A text of a deleted or unknown trace answers 404 `tracking.trace.not_found`. A text that a held trace does not hold answers 404 `tracking.text.not_found`.
Today no sweep and no operation deletes a trace. The retention value and its start are an epic decision.
When the retention sweep exists, the refusal of a late record reuses its predicate, so it needs no tombstone. Today no record meets that case.

## Capture and packaging

The capture points are the hooks of Claude Code.
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
