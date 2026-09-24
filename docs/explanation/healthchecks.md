# How healthchecks work

A listening HTTP server does not prove that its database or other dependencies work. Kanthord's healthcheck collects component reports and returns a combined view. The [healthcheck reference](../reference/gateway/healthcheck.md) defines requests, response examples, status codes, and timeouts.

## Read the whole report

The current server reports two groups:

- `server`: a Gateway summary, the operational database, and the operational log.
- `gateway`: the listener, authentication, idempotency, operation registry, and request invocation.

The server summary and Gateway details can observe slightly different moments. Future services will report their own components when implemented; an absent service is not an implicit healthy service.

## One failure does not hide the others

An unavailable component makes the overall response unhealthy, but healthy siblings remain in the report. For example, an unavailable log does not erase a healthy database result.

A failed probe is different from an unavailable component: the server has no trustworthy component report. It returns a `healthcheck: 503` marker under that service, rather than guessing which component failed or exposing exception text. An empty report cannot prove health.

## Fresh observations, not an atomic snapshot

Each request collects fresh reports concurrently. The aggregator has no background polling or result cache. Components may change while collection runs, so the combined report is not an atomic snapshot of the whole system.

Probe deadlines bound waiting. A client disconnect or server shutdown cancels collection instead of producing a successful report.

## Reporting is not recovery

A healthcheck does not restart workers, repair logs, reopen databases, or retry work. Before readiness, the Gateway rejects the request without collecting reports. An unreachable listener cannot return diagnostics at all.

Treat this endpoint as operational evidence, not proof that a job succeeded or that every proposed service has been implemented.

[Explanations](README.md) · [Documentation home](../README.md)
