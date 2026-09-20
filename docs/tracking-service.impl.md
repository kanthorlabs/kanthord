---
title: Tracking Service Implementation
---

# Tracking Service Implementation

This file holds the implementation rulings for the mechanisms that realize [tracking-service.md](viewer.html?p=tracking-service.md).
This file is not a design document, and `tracking-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the workers that run on it.

## Trace model

The trace model reuses the [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/).
The implementation installs `@opentelemetry/api`, `@opentelemetry/resources` and `@opentelemetry/semantic-conventions`.
It installs no OpenTelemetry SDK.
kanthord implements the tracer, the span processor and the exporter itself.
The first phase ships a no-op implementation of the interface that the Tracking Service defines.
Every other service plugs that interface into its implementation.
A working implementation follows in a later phase.
The implementation reuses attribute names that the semantic conventions define.
A kanthord identity takes the `kanthord.` prefix.

## Primary store

The primary store is a SQLite database.
It uses its own database file, and it never reuses the database file of the system.
The schema holds the span and the telemetry text.
A bulk import runs in bounded transactions, so a concurrent write of the daemon never waits for a whole import.
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
The implementation persists the root span when the daemon opens it, before a child span exists.
It persists the start of a span when the start arrives, and the end of a span when the end arrives.
A reader reads a span that holds a start and no end.
No reader waits for the root span.

## Expiry

The store keeps the identity of an expired telemetry text after it removes the content.
A reference to that identity resolves to expired, and an unknown identity resolves to unknown.
The start of the retention of a telemetry text is an epic decision.

## Capture and packaging

The capture points are the hooks of Claude Code and the plugin interface of opencode.
The kanthord extension of Claude Code owns the capture, the local store and the ingestion.
The kanthord plugin of opencode owns the capture, the local store and the ingestion.
A human authenticates the call of an ingestion, and the client identity of the extension authorizes no ingestion.
Their packaging is an epic decision.
