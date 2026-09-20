---
title: Tracking Service Vocabulary
---

# Tracking Service Vocabulary

This file holds the values and the examples of the terms that [tracking-service.md](viewer.html?p=tracking-service.md) owns.
A product term lives in [overview.vocabulary.md](viewer.html?p=overview.vocabulary.md).
This file is not a design document, and `tracking-service.md` stays the single source of truth.

## telemetry

Telemetry records what the daemon observes about its operations, and what an external harness asserts about its own.
Telemetry for project `Billing` contains the trace of an execution.

## trace

A trace is the set of spans that share one trace identity.
Project `Billing` has a trace for the objective `Add password reset`.

## trace identity

A trace identity names one trace.
The trace identity of `Billing` links the spans of its execution.

## span

A span records one operation inside a trace.
A span records the work pull for `Add password reset`.

## span identity

A span identity names one span.
The root span of the `Billing` execution has its own span identity.

## root span

A root span has no parent span.
The Scheduler opens the root span when it records the execution of `Add password reset`.

## span attribute

A span attribute holds one named value on a span.
The value kind is string, boolean, integer, floating-point number or an array of one primitive kind.
The attribute `kanthord.project.id` identifies project `Billing`.
The attribute `kanthord.repository.id` identifies repository `acme/api`.
Identity attributes can identify workers `general@1`, `reviewer@1` and `claude@1`.
The binding identity can identify `claude-main`.

## span event

A span event records a named event and its attributes.
The execution span records a `work pull` event for `Add password reset`.

## span status

Span status describes the result of a span.
The set has three values.

- **Unset**
- **Ok**
- **Error**

## span link

A span link relates a span to a span in another trace.
A link relates the root span of project `Billing` to another project's root span.

## identity attribute

An identity attribute names a kanthord object that a span operation concerns.
The set has these values.

- **project**
- **node**
- **attempt**
- **node revision**
- **execution**
- **claim**
- **worker binding**
- **worker instance**
- **agent**
- **client identity**
- **external object**
- **repository**

## producer

A producer creates and owns its spans.
The Scheduler Service is the producer of the span for the `Billing` work pull.

## telemetry text

A telemetry text is a record of authored prose.
The transcript of external harness `claude-code` is a telemetry text.

## record disposition

A record disposition states the result of one record in an acknowledgement.
The set has three values.

- **Stored**
- **Refused**
- **Deferred**

`Stored` and `Refused` are terminal.
`Deferred` is not terminal.

## retention

Retention is the period for which the Tracking Service holds a record form.
The daemon holds a span of project `Billing` for ninety days and a telemetry text of the same trace for seven days.

## acknowledgement

An acknowledgement replies to one ingestion call.
The acknowledgement of an import of the `claude-code` log of project `Billing` reports its retained count.
The extension keeps a record after a `Deferred` disposition.

## ingestion

An ingestion is one finite import that a human issues from the local store of an external harness.
A human imports the log of the `claude-code` instance of project `Billing` after its execution of `Add password reset`.

## drop

A drop is a record that the Tracking Service discards under pressure.
The Tracking Service drops a span of project `Billing` when its store is beyond its capacity, and it counts that drop.
