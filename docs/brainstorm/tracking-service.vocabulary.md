---
title: Tracking Service Vocabulary
---

# Tracking Service Vocabulary

This file holds the values and the examples of the terms that [tracking-service.md](tracking-service.md) owns.
A product term lives in [overview.vocabulary.md](overview.vocabulary.md).
This file is not a design document, and `tracking-service.md` stays the single source of truth.

## telemetry

Telemetry records what the server observes about its operations, and what an external harness asserts about its own.
Telemetry for project `Billing` contains the trace of an execution.

## trace

A trace is the set of spans that share one trace identity.
Project `Billing` has a trace for the node `Add password reset`.

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
The Scheduler opens the root span of the execution of `Add password reset` after it records that execution.

## span attribute

A span attribute holds one named value on a span.
The value kind is string, boolean, integer, floating-point number or an array of one primitive kind.
The attribute `kanthord.project.id` identifies project `Billing`.
The attribute `kanthord.repository.id` identifies repository `acme/api`.
Identity attributes can identify workers `coder@1`, `reviewer@1` and `claude-code@1`.
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
- **agent enablement**
- **client identity**
- **evidence**
- **evidence asset**
- **repository**
- **storage binding**

The span of a failed upload check carries the evidence asset and the storage binding.

## producer

A producer creates and owns its spans.
The Scheduler Service is the producer of the span for the `Billing` work pull.

## telemetry text

A telemetry text is a record of authored prose.
The `output` of a verification of `Add password reset` is a telemetry text.

## agent session

An agent session is the conversation of one agent inside one execution.
The `swe@1` agent of the execution of `Add password reset` holds one agent session.
The span `agent.session` names it, and the identity of that span is the session identity.

## session entry

A session entry is one entry of an agent session. It is a record of its own kind and no telemetry text.
A model reply, a tool result and a compaction summary of `swe@1` are session entries.
The entry identity, the session identity and the position of the entry identify it inside its trace.

## session format

A session format names the shape of the entries of an agent session.
The set is closed and it holds two values.

- **pi**
- **claude_code**

The `swe@1` session of the `Billing` execution has the format `pi`.

## trace summary

A trace summary holds the totals of the stored spans of one trace.
The summary of the `Billing` execution holds 42 turns, 118 tool calls, 2 errors and 310000 tokens.

## trace state

A trace state describes the root span of a trace in its summary.
The set is closed and it holds three values.

- **open**: the store holds no end of the root span.
- **ok**: the root span ended with the status `Ok`.
- **error**: the root span ended with the status `Error`.

The trace of a running execution of `Add password reset` is `open`.

## timeline

A timeline is one ordered history of the stored traces of an execution, a node or a project.
It orders the traces of its scope by their start.
It holds the root span of each trace and the spans directly below that root.
The timeline of the node `Add password reset` holds each execution, each transition and each human act on that node.

## analytics

Analytics are the totals and the percentiles of the measurements that the stored spans hold, by group and by time bucket.
The analytics of project `Billing` hold the cost of each model by day and the p90 of the tool latency.

## analytics measure

An analytics measure names the value of one duration read.
The set is closed and it holds six values.

- **span_duration**
- **tool_latency**
- **verification_time**
- **queue_wait**
- **review_wait**
- **revision_turns**

## act trace

An act trace is the trace of one human act on a node. Its root span names the operation of the act.
The pause of `Add password reset` by a human opens one act trace.

## record disposition

A record disposition states the result of one record in an acknowledgement.
The set is closed and it holds two values.

- **Stored**
- **Refused**

## retention

Retention is the period for which the Tracking Service holds a trace.
The trace is the only unit of retention.
The server deletes the trace of an execution of project `Billing` when its retention ends.
The deletion removes every span, record, telemetry text and session entry of that trace.
The retention of a trace of project `Billing` ends 30 days after the trace opens.

## acknowledgement

An acknowledgement replies to one ingestion call.
The acknowledgement of an import of the `claude-code` log of project `Billing` reports its retained count.

## ingestion

An ingestion is one finite import that a human issues from the local store of an external harness.
A human imports the log of the `claude-code` instance of project `Billing` after its execution of `Add password reset`.

## drop

A drop is a record that the Tracking Service discards under pressure.
The Tracking Service drops a span of project `Billing` when its store is beyond its capacity, and it counts that drop.
