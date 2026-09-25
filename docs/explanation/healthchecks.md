# How healthchecks work

A listening HTTP server does not prove that its database or other dependencies work. KanthorD's healthcheck collects component reports and returns a combined view. The [healthcheck reference](../reference/gateway/healthcheck.md) defines requests, response examples, status codes, and timeouts.

## From request to combined report

1. **Register.** During construction, Server, Gateway, Project, and Worker each register a health callback with the shared `HealthRegistry`.
2. **Collect.** A monitor requests `GET /api/healthcheck`. Once Gateway admits the request, the registry snapshots the registered callbacks and starts them concurrently.
3. **Inspect.** Each service checks its own components and returns a component map. These are in-process calls, not HTTP requests to other services.
4. **Respond.** The registry preserves every service's result. Gateway returns HTTP `200` only when at least one service reports and every component is healthy; otherwise it returns HTTP `503` with the complete report.

The rightmost lifeline groups four independent service probes, not a single service. Gateway's HTTP handling and its component probe appear separately to distinguish their roles. The component checks are expanded in the next diagram.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#f5f5f5", "primaryTextColor": "#2d3142", "actorBkg": "#f5f5f5", "actorBorder": "#4f5d75", "actorTextColor": "#2d3142", "actorLineColor": "#bfc0c0", "signalColor": "#4f5d75", "signalTextColor": "#2d3142", "noteBkgColor": "#ececec", "noteBorderColor": "#bfc0c0", "noteTextColor": "#2d3142", "labelBoxBkgColor": "#ececec", "labelBoxBorderColor": "#bfc0c0", "labelTextColor": "#2d3142", "loopTextColor": "#2d3142", "activationBkgColor": "#fbeae1", "activationBorderColor": "#eb6c36"}, "themeCSS": "& { background-color: #f5f5f5; }", "sequence": {"mirrorActors": false, "useMaxWidth": false}}}%%
sequenceDiagram
    accTitle: KanthorD healthcheck collection
    accDescr: Gateway asks the shared health registry to collect concurrent reports from Server, Gateway, Project, and Worker, then returns a complete healthy or unhealthy response.
    autonumber
    participant M as Monitor
    participant G as Gateway endpoint
    participant R as HealthRegistry
    participant S as Server / Gateway /<br/>Project / Worker

    M->>G: GET /api/healthcheck
    G->>R: check(request context)
    R->>R: Snapshot registered probes
    rect rgb(251, 234, 225)
        Note over R,S: Start all probes concurrently<br/>Each has a 5-second deadline
        R->>S: Invoke each registered healthcheck
        activate S
        S-->>R: Per-service component maps<br/>component name → 200 or 503
        deactivate S
        Note over R,S: Throw, rejection, invalid or empty map, timeout:<br/>use {healthcheck: 503} for that service
    end
    R-->>G: Complete service map
    alt Nonempty report, all components healthy
        G-->>M: HTTP 200<br/>{status: "ok", services: ...}
    else Any unavailable component or no services
        G-->>M: HTTP 503 · gateway.healthcheck.unhealthy<br/>Complete map in error.details
    end
```

**Palette:** neutral gray identifies participants and messages; orange highlights collection. Solid arrows are calls, and dashed arrows are replies. Color does not indicate health: the component codes do.

## How services collect component health

The `server` probe illustrates nested collection. It asks Gateway for a component report, reduces that report to one `gateway` status, then checks SQLite and the operational log. This diagram shows a running server; Gateway's internal state checks are summarized, and its database accesses are grouped.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#f5f5f5", "primaryTextColor": "#2d3142", "actorBkg": "#f5f5f5", "actorBorder": "#4f5d75", "actorTextColor": "#2d3142", "actorLineColor": "#bfc0c0", "signalColor": "#4f5d75", "signalTextColor": "#2d3142", "noteBkgColor": "#ececec", "noteBorderColor": "#bfc0c0", "noteTextColor": "#2d3142", "activationBkgColor": "#fbeae1", "activationBorderColor": "#eb6c36"}, "themeCSS": "& { background-color: #f5f5f5; }", "sequence": {"mirrorActors": false, "useMaxWidth": false}}}%%
sequenceDiagram
    accTitle: Server and Gateway component healthchecks
    accDescr: Server obtains Gateway component health, summarizes it, probes SQLite and the log descriptor, and returns three component statuses to the registry.
    autonumber
    participant R as HealthRegistry
    participant S as Server
    participant G as Gateway
    participant D as SQLite store
    participant L as Operational log

    R->>S: healthcheck()
    S->>G: healthcheck()
    Note over G: Check listener, authentication,<br/>idempotency, registry, invocation
    G->>D: Authentication: read token denylist<br/>Invocation: store health query
    D-->>G: Query results or failures
    G-->>S: Five component statuses
    rect rgb(251, 234, 225)
        S->>S: Summarize Gateway map:<br/>all 200 → 200, otherwise 503
    end
    S->>D: store.healthcheck()<br/>SELECT ? AS ok
    D-->>S: Query succeeds with expected value?<br/>true / false
    S->>L: log.healthcheck()<br/>Check descriptor with fstat
    L-->>S: Descriptor is open and accessible?<br/>true / false
    S-->>R: {gateway: 200 or 503,<br/>store: 200 or 503, log: 200 or 503}
```

The registry also calls Gateway's probe independently to populate `gateway`. This is not recursion: Gateway's component probe does not invoke the HTTP endpoint or collect other services' reports.

## Read the whole report

The current composed server reports four groups:

| Service   | Components                                                            | What the probe checks                                                                                                                          |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`  | `gateway`, `store`, `log`                                             | Gateway's aggregate status, a SQLite query, and the log descriptor.                                                                            |
| `gateway` | `listener`, `authentication`, `idempotency`, `registry`, `invocation` | Listener readiness, signing-key and denylist access, in-memory idempotency state, operation registry state, and invocation/store availability. |
| `project` | `bindings`                                                            | Project Service lifecycle: started and not stopped.                                                                                            |
| `worker`  | `registrations`                                                       | Worker Service lifecycle: started and not stopped.                                                                                             |

Project and Worker currently report lifecycle health, not end-to-end binding resolution, provider reachability, or remote worker-instance health. The endpoint does not poll remote worker applications or external providers.

The server summary and Gateway details can observe slightly different moments because they run separate probes. Additional services must explicitly register their own health callbacks; registering an API operation alone does not add a health probe. An absent service is not an implicit healthy service.

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
